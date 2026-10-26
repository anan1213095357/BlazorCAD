// Native WGSL. No Three.js shader chunks or GLSL translation at runtime.
export const cadShader=/* wgsl */`
struct Draw {
 model:mat4x4f, viewProjection:mat4x4f, normalMatrix:mat4x4f,
 eye:vec4f, color:vec4f, surface:vec4f, live:vec4f,
 cuts:vec4f, flags:vec4f, viewport:vec4f, style:vec4f,
 textureTransform:vec4f, textureOptions:vec4f,
}
@group(0) @binding(0) var<uniform> draw:Draw;
@group(0) @binding(1) var<storage,read> cuts:array<vec4f>;
@group(0) @binding(2) var<storage,read> rounds:array<vec4f>;
@group(0) @binding(3) var imageSampler:sampler;
@group(0) @binding(4) var image:texture_2d<f32>;
struct Vertex {
 @location(0) position:vec3f, @location(1) normal:vec3f,
 @location(2) uv:vec2f, @location(3) offset:vec3f,
 @location(4) motion:vec3f, @location(5) seam:vec2f,
 @location(6) faceNormal:vec3f, @location(7) facePoint:vec3f,
 @location(8) start:vec3f, @location(9) end:vec3f,
 @location(10) corner:vec2f, @location(11) bary:vec3f,
 @location(12) uvMotion:vec2f,
}
struct Varying {
 @builtin(position) position:vec4f,
 @location(0) world:vec3f, @location(1) normal:vec3f,
 @location(2) @interpolate(perspective,centroid) local:vec3f,
 @location(3) @interpolate(flat) faceNormal:vec3f,
 @location(4) @interpolate(flat) facePoint:vec3f,
 @location(5) uv:vec2f, @location(6) seam:vec2f,
 @location(7) bary:vec3f, @location(8) stroke:vec2f,
}
fn safeNormal(v:vec3f)->vec3f {return v*inverseSqrt(max(dot(v,v),1e-20));}
@vertex fn vertexMain(v:Vertex)->Varying {
 var out:Varying;
 let local=v.position+v.offset*draw.live.y+v.motion*draw.live.z;
 let world=draw.model*vec4f(local,1);
 var clip=draw.viewProjection*world;
 out.stroke=vec2f(0);
 if(draw.flags.w>1.5){
  clip=vec4f(clip.xy+v.corner*draw.viewport.z/draw.viewport.xy*clip.w,clip.zw);
  out.stroke=v.corner;
 }else if(draw.flags.w>0.5){
  let a=draw.viewProjection*draw.model*vec4f(v.start,1);
  let b=draw.viewProjection*draw.model*vec4f(v.end,1);
  let direction=(b.xy/b.w-a.xy/a.w)*draw.viewport.xy;
  let lengthD=length(direction);
  let side=vec2f(-direction.y,direction.x)/max(lengthD,1e-5);
  clip=mix(a,b,v.corner.x);
  clip=vec4f(clip.xy+side*v.corner.y*draw.viewport.z/draw.viewport.xy*clip.w,clip.zw);
  out.stroke=vec2f(v.corner.y,v.corner.x*lengthD*.5);
 }
 // The CAD camera's projection uses -w..w depth; WebGPU uses 0..w.
 out.position=vec4f(clip.xy,(clip.z+clip.w)*.5,clip.w);
 out.world=world.xyz;out.local=local;
 out.normal=safeNormal((draw.normalMatrix*vec4f(v.normal,0)).xyz);
 out.faceNormal=v.faceNormal;out.facePoint=v.facePoint;
 out.uv=v.uv+v.uvMotion*draw.live.z;out.seam=v.seam;out.bary=v.bary;
 return out;
}
fn cut(row:u32,col:u32)->vec4f {return cuts[row*14u+col];}
fn roundRead(row:u32,col:u32)->vec4f {return rounds[row*68u+col];}
fn roundOutside(row:u32,start:bool,q:vec3f,along:vec4f,r:f32,e:f32,fallback:bool)->bool {
 let index=row*2u+select(1u,0u,start);let meta=roundRead(index,0u);let count=u32(meta.w+.5);
 if(count<2u){return fallback;}
 let local=(q-along.xyz*select(along.w,0.,start))/r;
 let height=dot(local,meta.xyz);let t=dot(local,along.xyz);var boundary=0.;
 let first=roundRead(index,2u);let last=roundRead(index,count+1u);
 if(height<first.x-1e-8||height>last.x+1e-8){
  let wall=roundRead(index,1u).xyz;let denominator=dot(wall,along.xyz);
  if(abs(denominator)<1e-8){return fallback;}
  boundary=-dot(local-along.xyz*t,wall)/denominator;
 }else{
  var low=0u;var high=count-1u;
  for(var k=0u;k<7u;k++){if(high-low<=1u){break;}let middle=(low+high)/2u;
   if(height>roundRead(index,middle+2u).x){low=middle;}else{high=middle;}}
  let a=roundRead(index,low+2u);let b=roundRead(index,high+2u);
  let fraction=clamp((height-a.x)/max(1e-12,b.x-a.x),0.,1.);boundary=mix(a.y,b.y,fraction);
  if(abs(height)<e/r){let width=mix(a.z,b.z,fraction);if(abs(width)>1e-8){boundary*=dot(local,cross(meta.xyz,along.xyz))/width;}}
 }
 return select(t>boundary+e/r,t<boundary-e/r,start);
}
fn glmod(x:f32,y:f32)->f32 {return x-y*floor(x/y);}
fn removed(point:vec3f,row:u32,faceNormal:vec3f,facePoint:vec3f)->bool {
 let options=cut(row,9u);let radius=select(options.x,draw.live.x,options.x<0.);
 let bevel=options.y;let ratio=options.z;
 let origin=cut(row,0u);let along=cut(row,1u);let du=cut(row,2u);let dv=cut(row,3u);
 let center=cut(row,4u);let cap=cut(row,5u);let circle=cut(row,6u);let q=point-origin.xyz;
 let epsilon=max(max(.00005,max(max(abs(origin.x),abs(origin.y)),abs(origin.z))*.0000005+radius*.000002),center.w);
 var alpha=0.;var beta=0.;
 if(origin.w>.5){
  let planar=point-circle.xyz-cap.xyz*dot(point-circle.xyz,cap.xyz);
  let radial=length(planar);var angle=atan2(dot(planar,dv.xyz),dot(planar,du.xyz));
  if(origin.w>1.5){let tolerance=max(.00001,epsilon/max(radial,.00001));if(angle< -tolerance){angle+=6.28318530718;}if(angle>options.w+tolerance){return false;}}
  let step=6.28318530718/du.w;let local=glmod(angle,step)-step*.5;
  let chord=cos(step*.5)/cos(local);alpha=-(radial/chord-cap.w)*circle.w;beta=-dot(q,cap.xyz);
  let tolerance=max(epsilon,cap.w*.000002);
  if(abs(dot(faceNormal,cap.xyz))>.99999&&abs(dot(facePoint-origin.xyz,cap.xyz))<=tolerance){beta=0.;}
  if(dot(faceNormal,faceNormal)>.5&&abs(dot(faceNormal,cap.xyz))<.00001){
   let relative=facePoint-circle.xyz;let radialFace=relative-cap.xyz*dot(relative,cap.xyz);
   let angleFace=atan2(dot(radialFace,dv.xyz),dot(radialFace,du.xyz));
   let faceChord=cos(step*.5)/cos(glmod(angleFace,step)-step*.5);
   if(abs(length(radialFace)/faceChord-cap.w)<=tolerance&&abs(dot(faceNormal,safeNormal(radialFace)))>.9){alpha=0.;}
  }
  if(bevel>.5){return alpha>= -tolerance&&beta>= -tolerance&&alpha+beta/ratio<radius-tolerance;}
  if(abs(alpha)<=tolerance&&beta>= -tolerance&&beta<radius+tolerance){return true;}
  if(abs(beta)<=tolerance&&alpha>= -tolerance&&alpha<radius+tolerance){return true;}
  let delta=vec2f(alpha-radius,beta-radius);
  return alpha>= -tolerance&&beta>= -tolerance&&alpha+beta<=radius+tolerance&&dot(delta,delta)>radius*radius-max(.000001,radius*radius*.000001);
 }
 let t=dot(q,along.xyz);let endTolerance=max(max(.002,along.w*.000002),epsilon);
 var startPlane=cut(row,10u);var endPlane=cut(row,11u);
 startPlane.w+=cut(row,7u).w*radius;endPlane.w+=cut(row,8u).w*radius;
 var outsideStart=select(t< -endTolerance,dot(point,startPlane.xyz)-startPlane.w>endTolerance,length(startPlane.xyz)>.5);
 var outsideEnd=select(t>along.w+endTolerance,dot(point,endPlane.xyz)-endPlane.w>endTolerance,length(endPlane.xyz)>.5);
 let bits=u32(dv.w);
 if(bits>0u){
  let startLimit=cut(row,12u);let endLimit=cut(row,13u);
  if(length(startLimit.xyz)>.5){let limit=dot(point,startLimit.xyz)-startLimit.w>endTolerance;outsideStart=select(outsideStart||limit,outsideStart&&limit,(bits&2u)!=0u);}
  if(length(endLimit.xyz)>.5){let limit=dot(point,endLimit.xyz)-endLimit.w>endTolerance;outsideEnd=select(outsideEnd||limit,outsideEnd&&limit,(bits&4u)!=0u);}
 }
 if((bits&8u)!=0u){outsideStart=roundOutside(row,true,q,along,radius,endTolerance,outsideStart);}
 if((bits&16u)!=0u){outsideEnd=roundOutside(row,false,q,along,radius,endTolerance,outsideEnd);}
 if(outsideStart||outsideEnd){return false;}
 alpha=dot(q,du.xyz);beta=dot(q,dv.xyz);
 if(abs(dot(faceNormal,safeNormal(du.xyz)))>.99999&&abs(dot(facePoint-origin.xyz,du.xyz))<=epsilon){alpha=0.;}
 if(abs(dot(faceNormal,safeNormal(dv.xyz)))>.99999&&abs(dot(facePoint-origin.xyz,dv.xyz))<=epsilon){beta=0.;}
 let d=radius*du.w;if(alpha< -epsilon||beta< -epsilon||(bevel<.5&&alpha+beta>d+epsilon)){return false;}
 if(bevel>.5){return alpha+beta/ratio<radius-.00001;}
 if((abs(alpha)<=epsilon&&beta<d+epsilon)||(abs(beta)<=epsilon&&alpha<d+epsilon)){return true;}
 let radial=q-along.xyz*t-center.xyz*radius;
 return dot(radial,radial)>radius*radius-max(.000001,radius*radius*.000001);
}
fn srgb(color:vec3f)->vec3f {return select(color*12.92,1.055*pow(max(color,vec3f(0)),vec3f(1./2.4))-.055,color>vec3f(.0031308));}
fn tone(color:vec3f)->vec3f {let x=max(color,vec3f(0))*.9;return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0),vec3f(1));}
fn textureUv(p:vec2f)->vec2f {
 let c=draw.textureTransform.x;let s=draw.textureTransform.y;
 let rotated=vec2f(c*p.x-s*p.y,s*p.x+c*p.y)/max(draw.textureTransform.z,.001);
 return rotated/vec2f(max(draw.textureTransform.w,.001),1.);
}
fn light(n:vec3f,v:vec3f,l:vec3f,base:vec3f,rough:f32,metal:f32)->vec3f {
 let h=safeNormal(v+l);let nl=max(dot(n,l),0.);let nv=max(dot(n,v),.001);let nh=max(dot(n,h),0.);let vh=max(dot(v,h),0.);
 let a=max(rough*rough,.002);let a2=a*a;let d=a2/(3.14159265*pow(nh*nh*(a2-1.)+1.,2.));
 let k=pow(rough+1.,2.)/8.;let g=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);
 let f0=mix(vec3f(.04),base,metal);let fresnel=f0+(vec3f(1)-f0)*pow(1.-vh,5.);
 let specular=d*g*fresnel/max(4.*nv*nl,.001);
 return ((vec3f(1)-fresnel)*(1.-metal)*base/3.14159265+specular)*nl;
}
@fragment fn fragmentMain(in:Varying,@builtin(front_facing) front:bool)->@location(0) vec4f {
 // Derivatives are evaluated before clipping, outside divergent control flow.
 let geometric=safeNormal(cross(dpdx(in.local),dpdy(in.local)));
 let profileWidth=max(fwidth(in.uv.y),.000001);let seamWidth=max(fwidth(in.seam),vec2f(.000001));
 let baryWidth=max(fwidth(in.bary),vec3f(.000001));
 let count=u32(draw.cuts.x);
 let faceNormal=select(in.faceNormal,geometric,draw.live.w>.5);
 let facePoint=select(in.facePoint,in.local,draw.live.w>.5);
 for(var row=0u;row<count;row++){
  let index=f32(row);if((index>=draw.cuts.y&&index<draw.cuts.z)||index==draw.cuts.w||index==draw.flags.x){continue;}
  if(any(in.local<cut(row,7u).xyz)||any(in.local>cut(row,8u).xyz)){continue;}
  if(removed(in.local,row,faceNormal,facePoint)){discard;}
 }
 var base=draw.color.rgb;var opacity=draw.color.a;
 if(draw.flags.w>1.5){
  let distance=length(in.stroke);if(distance>1.){discard;}opacity*=1.-smoothstep(.85,1.,distance);
 }else if(draw.flags.w>.5){
  if(draw.viewport.w>.5&&glmod(in.stroke.y,13.)>8.){discard;}
  base=mix(vec3f(.035,.075,.11),base,1.-smoothstep(.48,.7,abs(in.stroke.x)));
  opacity*=1.-smoothstep(.86,1.,abs(in.stroke.x));
 }
 if(draw.style.x>.5){
  var texel=textureSampleLevel(image,imageSampler,textureUv(in.uv),0.);
  if(draw.textureOptions.x>.5){
   let weights=pow(abs(safeNormal(in.normal)),vec3f(6));let blend=weights/max(dot(weights,vec3f(1)),.0001);
   texel=textureSampleLevel(image,imageSampler,textureUv(in.local.yz),0.)*blend.x
    +textureSampleLevel(image,imageSampler,textureUv(in.local.xz),0.)*blend.y
    +textureSampleLevel(image,imageSampler,textureUv(in.local.xy),0.)*blend.z;
  }
  base*=texel.rgb;opacity*=texel.a;
 }
 var color=base;
 if(draw.surface.z>.5){
  let n=safeNormal(in.normal)*select(-1.,1.,front);let v=safeNormal(draw.eye.xyz-in.world);
  let rough=clamp(draw.surface.y,.045,1.);let metal=clamp(draw.surface.x,0.,1.);
  color=base*(.09+.08*max(n.z,0.))*(1.-metal*.85);
  color+=(light(n,v,safeNormal(vec3f(-.4,-.5,1.)),base,rough,metal)*4.
   +light(n,v,safeNormal(vec3f(1.,.35,.7)),base,rough,metal)*2.
   +light(n,v,safeNormal(vec3f(.1,1.,.6)),base,rough,metal)*1.5)*draw.textureOptions.y;
 }
 if(draw.live.w>.5&&draw.style.z<.5){
  let border=1.-smoothstep(profileWidth*.35,profileWidth*1.35,min(in.uv.y,1.-in.uv.y));
  let seamBorder=vec2f(1)-smoothstep(seamWidth*.35,seamWidth*1.35,in.seam);
  color=mix(color,vec3f(.075,.095,.115),max(border,max(seamBorder.x,seamBorder.y))*.85);
 }
 if(draw.surface.w>.5){let edge=min(min(in.bary.x/baryWidth.x,in.bary.y/baryWidth.y),in.bary.z/baryWidth.z);if(edge>1.2){discard;}color=draw.color.rgb;}
 if(draw.style.y>.5){return vec4f(color,opacity);}
 return vec4f(srgb(select(color,tone(color),draw.surface.z>.5)),opacity);
}
`;
