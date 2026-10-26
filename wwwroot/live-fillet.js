import {edgeEndPlanes} from './edge-end-planes.js';
import {section} from './edge-section.js';
import {joinEdgeBands} from './edge-junctions.js';
import {bandEnd,bandOrigin,bandSamples,sectionSample} from './edge-band-layout.js';
import {circleOf,arcOf} from './curved-boundary.js';
import {edgeEndCap} from './edge-end-cap.js';
import {railContact,stitchBandRails} from './edge-rail-stitch.js';
import {rimBevelProfiles} from './rim-bevel-profile.js';
// Clip positions use centroid interpolation in BOTH shader stages. With MSAA,
// ordinary varyings can be evaluated outside a partially covered triangle; the
// extrapolated point then escapes the cut domain and leaves dotted old edges.
// Centroid evaluates inside covered geometry, including very thin BSP triangles,
// without eroding neighbouring faces with a screen-space clipping tolerance.
// Display-only fillet: original surface fragments are clipped analytically and
// the replacement arc strips are displaced by one radius uniform. No BSP per drag.
import * as THREE from './vendor/three.module.js';
const v=()=>new THREE.Vector3();
const clipShader=`
uniform highp sampler2D liveCuts;
uniform highp sampler2D liveRoundCuts;
uniform int liveCount,liveSkip,liveSkipEnd;
uniform int liveJoinedFirst,liveJoinedSecond;
uniform float liveRadius;
uniform float liveBevel,liveRatio;
centroid varying highp vec3 livePoint;
flat varying highp vec3 liveFaceNormal;
flat varying highp vec3 liveFacePoint;
vec4 liveRead(int row,int col){return texture2D(liveCuts,vec2((float(col)+.5)/14.,(float(row)+.5)/float(liveCount)));}
vec4 roundRead(int row,int col){return texture2D(liveRoundCuts,vec2((float(col)+.5)/68.,(float(row)+.5)/float(liveCount*2)));}
bool roundOutside(int row,bool start,vec3 q,vec4 along,float radius,float epsilon,bool fallback){
    int index=row*2+(start?0:1);vec4 meta=roundRead(index,0);int count=int(meta.w+.5);if(count<2)return fallback;
    vec3 local=(q-along.xyz*(start?0.:along.w))/radius;
    float height=dot(local,meta.xyz),t=dot(local,along.xyz),boundary=0.;
    vec4 first=roundRead(index,2),last=roundRead(index,count+1);
    if(height<first.x-.00000001||height>last.x+.00000001){
        vec3 wall=roundRead(index,1).xyz;float denominator=dot(wall,along.xyz);if(abs(denominator)<.00000001)return fallback;
        boundary=-dot(local-along.xyz*t,wall)/denominator;
    }else{
        int low=0,high=count-1;
        for(int k=0;k<7;k++){if(high-low<=1)break;int middle=(low+high)/2;vec4 knot=roundRead(index,middle+2);if(height>knot.x)low=middle;else high=middle;}
        vec4 a=roundRead(index,low+2),b=roundRead(index,high+2);
        float fraction=clamp((height-a.x)/max(.000000000001,b.x-a.x),0.,1.);boundary=mix(a.y,b.y,fraction);
        // The common planar contact is a wedge ending at the source vertex,
        // rather than a constant axial cutoff across the whole flat face.
        if(abs(height)<epsilon/radius){float width=mix(a.z,b.z,fraction);if(abs(width)>.00000001)boundary*=dot(local,cross(meta.xyz,along.xyz))/width;}
    }
    return start?t<boundary-epsilon/radius:t>boundary+epsilon/radius;
}
bool liveRemoved(vec3 point,int row,vec3 faceNormal){
    vec4 options=liveRead(row,9);float radius=options.x<0.?liveRadius:options.x,bevel=options.y,ratio=options.z;
    vec4 origin=liveRead(row,0),along=liveRead(row,1),du=liveRead(row,2),dv=liveRead(row,3),center=liveRead(row,4),cap=liveRead(row,5),circle=liveRead(row,6);
    float alpha,beta;vec3 q=point-origin.xyz;float clipEpsilon=max(.00005,max(max(abs(origin.x),abs(origin.y)),abs(origin.z))*.0000005+radius*.000002);clipEpsilon=max(clipEpsilon,center.w);
    if(origin.w>.5){
        vec3 planar=point-circle.xyz-cap.xyz*dot(point-circle.xyz,cap.xyz);
        float radial=length(planar),angle=atan(dot(planar,dv.xyz),dot(planar,du.xyz));
        if(origin.w>1.5){float angularTolerance=max(.00001,clipEpsilon/max(radial,.00001));if(angle< -angularTolerance)angle+=6.283185307179586;if(angle>options.w+angularTolerance)return false;}
        float step=6.283185307179586/du.w,local=mod(angle,step)-step*.5;
        // Use the same polygonal circle as the arc strip and original cylinder.
        // Dividing out the chord factor makes an entire wall facet alpha=0,
        // rather than leaving its triangular interior uncut between the corners.
        float chord=cos(step*.5)/cos(local);
        alpha=-(radial/chord-cap.w)*circle.w;beta=-dot(q,cap.xyz);
        float r=radius,tolerance=max(clipEpsilon,cap.w*.000002);
        // Classify the original planar contact using one face anchor. Its
        // interpolated positions can straddle the plane by a few ULPs at grazing
        // angles; the face itself has not left the plane.
        if(abs(dot(faceNormal,cap.xyz))> .99999&&abs(dot(liveFacePoint-origin.xyz,cap.xyz))<=tolerance)beta=0.;
        if(dot(faceNormal,faceNormal)>.5&&abs(dot(faceNormal,cap.xyz))<.00001){
            vec3 faceRelative=liveFacePoint-circle.xyz;
            vec3 faceRadial=faceRelative-cap.xyz*dot(faceRelative,cap.xyz);
            float faceAngle=atan(dot(faceRadial,dv.xyz),dot(faceRadial,du.xyz));
            float faceChord=cos(step*.5)/cos(mod(faceAngle,step)-step*.5);
            if(abs(length(faceRadial)/faceChord-cap.w)<=tolerance&&abs(dot(faceNormal,normalize(faceRadial)))>.9)alpha=0.;
        }
        if(bevel>.5)return alpha>=-tolerance&&beta>=-tolerance&&alpha+beta/ratio<r-tolerance;
        // Remove the original contact bands right up to tangency. The quadratic
        // tolerance below must not leave a thin old wall covering the new arc.
        if(abs(alpha)<=tolerance&&beta>=-tolerance&&beta<r+tolerance)return true;
        if(abs(beta)<=tolerance&&alpha>=-tolerance&&alpha<r+tolerance)return true;
        return alpha>=-tolerance&&beta>=-tolerance&&alpha+beta<=r+tolerance&&dot(vec2(alpha-r,beta-r),vec2(alpha-r,beta-r))>r*r-max(.000001,r*r*.000001);
    }
    float t=dot(q,along.xyz),endTolerance=max(max(.002,along.w*.000002),clipEpsilon);vec4 startPlane=liveRead(row,10),endPlane=liveRead(row,11);
    startPlane.w+=liveRead(row,7).w*radius;endPlane.w+=liveRead(row,8).w*radius;
    bool outsideStart=length(startPlane.xyz)>.5?dot(point,startPlane.xyz)-startPlane.w>endTolerance:t< -endTolerance;
    bool outsideEnd=length(endPlane.xyz)>.5?dot(point,endPlane.xyz)-endPlane.w>endTolerance:t>along.w+endTolerance;
    if(dv.w>.5){
        vec4 startLimit=liveRead(row,12),endLimit=liveRead(row,13);
        if(length(startLimit.xyz)>.5){
            bool outsideLimit=dot(point,startLimit.xyz)-startLimit.w>endTolerance;
            outsideStart=mod(floor(dv.w/2.),2.)>.5?(outsideStart&&outsideLimit):(outsideStart||outsideLimit);
        }
        if(length(endLimit.xyz)>.5){
            bool outsideLimit=dot(point,endLimit.xyz)-endLimit.w>endTolerance;
            outsideEnd=mod(floor(dv.w/4.),2.)>.5?(outsideEnd&&outsideLimit):(outsideEnd||outsideLimit);
        }
    }
    if(mod(floor(dv.w/8.),2.)>.5)outsideStart=roundOutside(row,true,q,along,radius,endTolerance,outsideStart);
    if(mod(floor(dv.w/16.),2.)>.5)outsideEnd=roundOutside(row,false,q,along,radius,endTolerance,outsideEnd);
    if(outsideStart||outsideEnd)return false;
    alpha=dot(q,du.xyz);beta=dot(q,dv.xyz);
    if(abs(dot(faceNormal,normalize(du.xyz)))>.99999&&abs(dot(liveFacePoint-origin.xyz,du.xyz))<=clipEpsilon)alpha=0.;
    if(abs(dot(faceNormal,normalize(dv.xyz)))>.99999&&abs(dot(liveFacePoint-origin.xyz,dv.xyz))<=clipEpsilon)beta=0.;
    float d=radius*du.w;if(alpha< -clipEpsilon||beta< -clipEpsilon||(bevel<.5&&alpha+beta>d+clipEpsilon))return false;
    if(bevel>.5)return alpha+beta/ratio<radius-.00001;
    // Explicitly clear the old planar strips all the way to tangency.
    if(abs(alpha)<=clipEpsilon&&beta<d+clipEpsilon||abs(beta)<=clipEpsilon&&alpha<d+clipEpsilon)return true;
    vec3 radial=q-along.xyz*t-center.xyz*radius;
    return dot(radial,radial)>radius*radius-max(.000001,radius*radius*.000001);
}
// Every replacement remains inside the other edge treatments. Skipping ancestor
// cuts exposes entire untrimmed strips beyond the previously rounded body.
void liveClip(){
    vec3 faceNormal=liveFaceNormal;
    #ifdef CAD_LIVE_PATCH
    // Use the displaced triangle's plane, not its interpolated lighting normal.
    // Compute derivatives before divergent cut/discard branches. This requires
    // no per-frame mesh rebuild or duplicate per-triangle vertex attributes.
    faceNormal=cross(dFdx(livePoint),dFdy(livePoint));
    faceNormal*=inversesqrt(max(dot(faceNormal,faceNormal),1.e-20));
    #endif
    for(int row=0;row<liveCount;row++){if(row>=liveSkip&&row<liveSkipEnd||row==liveJoinedFirst||row==liveJoinedSecond)continue;vec3 low=liveRead(row,7).xyz,high=liveRead(row,8).xyz;if(any(lessThan(livePoint,low))||any(greaterThan(livePoint,high)))continue;if(liveRemoved(livePoint,row,faceNormal))discard;}
}
`;
export class LiveFillet {
    constructor(mesh,group,edges,value,host,feature={},polygons=[]){
        this.bevel=feature.edgeTreatment==='chamfer';this.ratio=Math.tan((feature.chamferAngle??45)*Math.PI/180);
        this.mesh=mesh;this.group=group;this.original=mesh.material;this.patches=[];this.materials=[];this.originalDepth=mesh.customDepthMaterial;this.radius={value};this.records=[];
        this.max=Infinity;this.boundsRadius=Math.max(1,value)*2;this.recordBounds=[];
        if(!Number.isFinite(value)||value<.1)throw new Error('请输入不小于 0.1 mm 的有限尺寸。');
        edges=rimBevelProfiles(edges,feature);
        const strips=[];
        for(const edge of edges){
            const settings=edge.visualFeature??feature,bevel=settings.edgeTreatment==='chamfer',ratio=edge.bevelProfile?.ratio??Math.tan((settings.chamferAngle??45)*Math.PI/180);
            this.current={bevel,ratio,scale:edge.bevelProfile?.scale??1,coherentRim:edge.bevelProfile?.coherentRim??false,radius:edge.visualFeature?settings.depth:-1,treatment:settings.id,owner:edge.faceA?.featureId,curve:edge.kind==='curve'};
            const axis=edge.b.clone().sub(edge.a).normalize();
            const [startFace,endFace]=edgeEndPlanes(edge,polygons);
            this.current.start=startFace?.normal??null;this.current.end=endFace?.normal??null;this.current.a=edge.a;this.current.b=edge.b;
            this.current.startClosure=startFace?.closureNormal??null;this.current.endClosure=endFace?.closureNormal??null;
            const firstRecord=this.records.length,firstStrip=strips.length,circle=edge.kind==='curve'?(circleOf(edge)??arcOf(edge)):null;
            if(circle){const index=this.addRecord(edge.a,edge.b,edge.normalA,edge.frames[0].normalB,circle,edge.points);strips.push({index,frames:circle.frames,closed:edge.closed});}
            else if(edge.kind==='curve'){
                const frames=edge.frames,indices=[];
                for(let i=0;i<(edge.closed?frames.length:frames.length-1);i++){
                    const a=frames[i],b=frames[(i+1)%frames.length],normal=a.normalB.clone().add(b.normalB).normalize(),normalA=a.normalA.clone().add(b.normalA).normalize(),index=this.addRecord(a.point,b.point,normalA,normal);
                    // Adjacent rail domains meet on their shared tangent bisector.
                    const row=this.records[index],axis=b.point.clone().sub(a.point).normalize();
                    for(const [frame,col,sign] of [[a,10,-1],[b,11,1]]){const tangent=frame.normalA.clone().cross(frame.normalB).normalize();if(tangent.dot(axis)<0)tangent.negate();tangent.multiplyScalar(sign);row.set([...tangent.toArray(),tangent.dot(frame.point)],col*4);}
                    indices.push(index);
                }
                strips.push({index:indices[0],frames,closed:edge.closed});
            }else {const index=this.addRecord(edge.a,edge.b,edge.normalA,edge.normalB);strips.push({index,frames:[{point:edge.a,normalA:edge.normalA,normalB:edge.normalB},{point:edge.b,normalA:edge.normalA,normalB:edge.normalB}],closed:false});}
            for(let i=firstStrip;i<strips.length;i++){strips[i].skipStart=firstRecord;strips[i].skipEnd=this.records.length;strips[i].settings={...this.current};}
        }
        joinEdgeBands(strips,this.records,section);
        if(!this.records.length)throw new Error('请选择有效的圆角边界。');
        for(const strip of strips){
            strip.sections=strip.frames.map(frame=>section(frame.normalA,frame.normalB,strip.settings.bevel,strip.settings.ratio,strip.settings.scale));
            const axis=strip.settings.b.clone().sub(strip.settings.a).normalize();
            strip.samples=bandSamples(strip.sections[0],axis,strip.settings);
            let extent=0;
            strip.frames.forEach((frame,i)=>strip.samples.forEach(sample=>{
                const offset=sectionSample(strip.sections[i],sample).offset;
                const side=i===0?'start':i===strip.frames.length-1?'end':null;
                extent=Math.max(extent,(side?bandEnd(offset,axis,strip.settings,side).offset:offset).length());
            }));
            if(!strip.settings.curve)for(const side of ['start','end'])for(const sample of [0,32])extent=Math.max(extent,railContact(strip,side,sample).offset.length());
            // Endpoint projection can extend far beyond a section's own width
            // on an acute mitre. The clipping AABB must cover those vertices too.
            for(let index=strip.skipStart;index<strip.skipEnd;index++){
                const bounds=this.recordBounds[index],row=this.records[index];bounds.scale=Math.max(bounds.scale,1+extent);
                const box=bounds.base.clone().expandByScalar((row[36]<0?this.boundsRadius:row[36])*bounds.scale);
                row.set(box.min.toArray(),28);row.set(box.max.toArray(),32);
            }
        }
        const textureData=new Float32Array(this.records.length*56);this.records.forEach((record,i)=>textureData.set(record,i*56));this.texture=new THREE.DataTexture(textureData,14,this.records.length,THREE.RGBAFormat,THREE.FloatType);this.texture.minFilter=THREE.NearestFilter;this.texture.magFilter=THREE.NearestFilter;this.texture.needsUpdate=true;
        const roundData=new Float32Array(68*this.records.length*2*4);
        this.records.forEach((record,index)=>{for(const [side,end] of [['roundStart',0],['roundEnd',1]]){const joint=record[side];if(!joint)continue;const offset=(index*2+end)*68*4;roundData.set([...joint.common.toArray(),joint.knots.length],offset);roundData.set(joint.wall.toArray(),offset+4);joint.knots.forEach((k,i)=>roundData.set([k.height,k.shift,k.width,0],offset+(i+2)*4));}});
        this.roundTexture=new THREE.DataTexture(roundData,68,this.records.length*2,THREE.RGBAFormat,THREE.FloatType);this.roundTexture.minFilter=this.roundTexture.magFilter=THREE.NearestFilter;this.roundTexture.needsUpdate=true;
        // Cached with the stock geometry, not rebuilt on radius or camera moves.
        // Use geometric triangle normals, never smoothed shading normals, for
        // contact classification so rounded faces cannot be mistaken for planes.
        if(!mesh.geometry.getAttribute('liveFaceNormalAttribute')){
            const position=mesh.geometry.getAttribute('position'),faceNormals=new Float32Array(position.count*3);
            const a=v(),b=v(),c=v(),normal=v();
            for(let i=0;i<position.count;i+=3){a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);normal.crossVectors(b.sub(a),c.sub(a)).normalize();for(let j=0;j<3;j++)normal.toArray(faceNormals,(i+j)*3);}
            mesh.geometry.setAttribute('liveFaceNormalAttribute',new THREE.BufferAttribute(faceNormals,3));
        }
        const original=Array.isArray(this.original)?this.original:[this.original];mesh.material=original.map(material=>this.material(material,-1,false));
        for(const strip of strips){const positions=[],offsets=[],normals=[],uv=[],indices=[],tangents=[],seams=[],sections=strip.sections,count=strip.samples.length;
            strip.frames.forEach((frame,i)=>strip.samples.forEach(sample=>{
                const {offset,normal:profileNormal}=sectionSample(sections[i],sample),axis=strip.settings.b.clone().sub(strip.settings.a).normalize(),side=i===0?'start':i===strip.frames.length-1?'end':null;
                const end=side?bandEnd(offset,axis,strip.settings,side):null,moved=end?.offset??offset;
                const normal=end?.normal??profileNormal;
                const origin=side?bandOrigin(frame.point,strip.settings,side):frame.point;
                positions.push(...origin.toArray());
                seams.push(side==='start'&&end?.seam?0:1,side==='end'&&end?.seam?0:1);
                offsets.push(...moved.toArray());normals.push(...normal.toArray());
                const tangent=frame.normalA.clone().cross(frame.normalB).addScaledVector(normal,-frame.normalA.clone().cross(frame.normalB).dot(normal));if(tangent.lengthSq()<1e-8)tangent.set(0,1,0).addScaledVector(normal,-normal.y);tangent.normalize();tangents.push(tangent.x,tangent.y,tangent.z,1);uv.push(i,sample/32);}));
            for(let i=0;i<(strip.closed?strip.frames.length:strip.frames.length-1);i++)for(let j=0;j<count-1;j++){const a=i*count+j,b=((i+1)%strip.frames.length)*count+j;for(const tri of [[a,b,a+1],[a+1,b,b+1]]){const point=k=>new THREE.Vector3().fromArray(positions,k*3).add(new THREE.Vector3().fromArray(offsets,k*3)),p=tri.map(point),normal=new THREE.Vector3().fromArray(normals,tri[0]*3);if(p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).dot(normal)<0)tri.reverse();indices.push(...tri);}}
            stitchBandRails(strip,{positions,offsets,normals,uv,indices,tangents,seams});
            const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('liveOffset',new THREE.Float32BufferAttribute(offsets,3));geometry.setAttribute('liveSeamCoordinate',new THREE.Float32BufferAttribute(seams,2));geometry.setAttribute('tangent',new THREE.Float32BufferAttribute(tangents,4));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);
            // Match the owning body's existing material at the selected edge.
            let materialIndex=0;const groups=mesh.geometry.groups,point=strip.frames[0].point,position=mesh.geometry.attributes.position;let distance=Infinity;
            // Resolve the owning material by the edge's actual surface position.
            // One source feature can contain several disconnected bodies/materials.
            // Its feature id alone is therefore not a material-group identity.
            const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),closest=new THREE.Vector3(),triangle=new THREE.Triangle(a,b,c);
            for(const item of groups){
                let nearest=Infinity;
                for(let vertex=item.start;vertex<item.start+item.count;vertex+=3){a.fromBufferAttribute(position,vertex);b.fromBufferAttribute(position,vertex+1);c.fromBufferAttribute(position,vertex+2);triangle.closestPointToPoint(point,closest);nearest=Math.min(nearest,closest.distanceToSquared(point));if(nearest<1e-12)break;}
                if(nearest<distance){distance=nearest;materialIndex=item.materialIndex;}
                if(distance<1e-12)break;
            }
            const joined=[...(strip.roundPeers??[])].map(peer=>peer.index);
            const patch=new THREE.Mesh(geometry,this.material(original[materialIndex]??original[0],strip.skipStart,true,strip.skipEnd,strip.settings.radius,false,joined));patch.receiveShadow=true;patch.castShadow=true;patch.layers.enable(1);
            const depthSource=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});patch.customDepthMaterial=this.material(depthSource,strip.skipStart,true,strip.skipEnd,strip.settings.radius,false,joined);depthSource.dispose();patch.frustumCulled=false;patch.raycast=()=>{};patch.userData.sharedMaterial=true;patch.renderOrder=1;group.add(patch);this.patches.push(patch);
            for(const side of ['start','end']){
                const capGeometry=edgeEndCap(strip,side);if(!capGeometry)continue;
                const capNormal=strip.settings[side+'Closure'],capPoint=strip.frames[side==='start'?0:strip.frames.length-1].point;
                let capIndex=materialIndex,capDistance=Infinity;
                for(const item of groups)for(let vertex=item.start;vertex<item.start+item.count;vertex+=3){
                    a.fromBufferAttribute(position,vertex);b.fromBufferAttribute(position,vertex+1);c.fromBufferAttribute(position,vertex+2);
                    const faceNormal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
                    if(faceNormal.dot(capNormal)<.99999||Math.abs(capPoint.clone().sub(a).dot(capNormal))>1e-4)continue;
                    triangle.closestPointToPoint(capPoint,closest);const squared=closest.distanceToSquared(capPoint);
                    if(squared<capDistance){capDistance=squared;capIndex=item.materialIndex;}
                }
                const capMaterial=this.material(original[capIndex]??original[0],strip.skipStart,true,strip.skipEnd,strip.settings.radius,true,joined);
                const cap=new THREE.Mesh(capGeometry,capMaterial);cap.customDepthMaterial=patch.customDepthMaterial;
                cap.receiveShadow=true;cap.castShadow=true;cap.layers.enable(1);cap.frustumCulled=false;cap.raycast=()=>{};
                cap.userData.sharedMaterial=true;cap.renderOrder=1;group.add(cap);this.patches.push(cap);
            }
        }
        const depthSource=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});mesh.customDepthMaterial=this.material(depthSource,-1,false);depthSource.dispose();
        this.overlays=[];
        for(const overlay of group.children.filter(object=>object.userData.edgeClipOverlay)){this.overlays.push([overlay,overlay.material]);overlay.material=this.material(overlay.material,-1,false);}
        if(feature.visualPersistent){this.set(value);return;}
        const labelStrip=strips.find(strip=>strip.settings.radius<0)??strips[0];
        const anchor=labelStrip.frames[Math.floor(labelStrip.frames.length/2)],cross=section(anchor.normalA,anchor.normalB,labelStrip.settings.bevel,labelStrip.settings.ratio,labelStrip.settings.scale);this.anchor=anchor.point.clone();this.anchorOffset=cross.offsets[16];
        this.host=host;this.label=document.createElement('div');this.label.className='live-fillet-radius';this.label.style.cssText='position:absolute;pointer-events:none;z-index:12;padding:6px 10px;border:1px solid #d9bd82;border-radius:5px;background:#172330e8;color:#f0d89e;font:600 13px Segoe UI;font-variant-numeric:tabular-nums;white-space:nowrap;';host.appendChild(this.label);
        this.set(value);
    }
    addRecord(a,b,n1,n2,circle=null,points=[a,b]){
        const data=new Float32Array(56),axis=b.clone().sub(a),length=axis.length();axis.normalize();const s=section(n1,n2,this.current.bevel,this.current.ratio,this.current.scale),boundScale=1+Math.max(1,...s.offsets.map(offset=>offset.length())),box=new THREE.Box3().setFromPoints(points).expandByScalar((this.current.radius<0?this.boundsRadius:this.current.radius)*boundScale);
        const write=(col,p,w=0)=>data.set([p.x,p.y,p.z,w],col*4);
        // Use the uncertainty of this actual rail, not a radius-only epsilon.
        // Circle fitting accepts slightly imperfect/BSP-split rails; their
        // original wall must still be classified as contact with the cut.
        const magnitude=Math.max(1,...box.min.toArray().map(Math.abs),...box.max.toArray().map(Math.abs));
        let contactError=0;
        if(circle){const step=2*Math.PI/circle.count;
            for(const point of points){const delta=point.clone().sub(circle.center),planar=delta.clone().addScaledVector(n1,-delta.dot(n1));
                const angle=Math.atan2(planar.dot(circle.basis),planar.dot(circle.u)),local=((angle%step)+step)%step-step*.5,chord=Math.cos(step*.5)/Math.cos(local);
                contactError=Math.max(contactError,Math.abs(planar.length()/chord-circle.radius),Math.abs(point.clone().sub(a).dot(n1)));
            }
        }
        const contactTolerance=contactError*1.5+magnitude*Math.pow(2,-21);
        write(0,a,circle?(circle.closed===false?2:1):0);write(1,axis,length);write(2,circle?.u??s.dualU,circle?.count??s.d);write(3,circle?.basis??s.dualV);write(4,s.center,contactTolerance);write(5,n1,circle?.radius??0);write(6,circle?.center??v(),circle?.sign??0);write(7,box.min);write(8,box.max);write(9,new THREE.Vector3(this.current.radius,this.current.bevel?1:0,this.current.ratio),circle?.sweep??0);
        if(this.current.start)write(10,this.current.start,this.current.start.dot(this.current.a));
        if(this.current.end)write(11,this.current.end,this.current.end.dot(this.current.b));this.recordBounds.push({base:new THREE.Box3().setFromPoints(points),scale:boundScale});this.records.push(data);return this.records.length-1;
    }
    material(source,skip,patch,skipEnd=skip+1,fixedRadius=-1,closure=false,joined=[]){
        const material=source.clone(),previous=source.onBeforeCompile,cache=source.customProgramCacheKey.bind(source);
        if(patch)material.defines={...material.defines,CAD_LIVE_PATCH:1};
        material.onBeforeCompile=(shader,...args)=>{
            previous.call(material,shader,...args);Object.assign(shader.uniforms,{liveCuts:{value:this.texture},liveRoundCuts:{value:this.roundTexture},liveCount:{value:this.records.length},liveSkip:{value:skip},liveSkipEnd:{value:skipEnd},liveRadius:this.radius,livePatchRadius:fixedRadius<0?this.radius:{value:fixedRadius},liveBevel:{value:this.bevel?1:0},liveRatio:{value:this.ratio}});
            shader.uniforms.liveJoinedFirst={value:joined[0]??-1};shader.uniforms.liveJoinedSecond={value:joined[1]??-1};
            shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float liveRadius;uniform float livePatchRadius;centroid varying highp vec3 livePoint;flat varying highp vec3 liveFaceNormal;flat varying highp vec3 liveFacePoint;'+(!patch?'attribute vec3 liveFaceNormalAttribute;':'')+(patch?'attribute vec3 liveOffset;attribute vec2 liveSeamCoordinate;centroid varying highp vec2 liveSeam;centroid varying highp float liveProfile;':''));
            shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+(patch?'transformed+=liveOffset*livePatchRadius;liveProfile=uv.y;liveSeam=liveSeamCoordinate;':'')+'livePoint=transformed;liveFacePoint='+(patch?'transformed;':'position;')+'liveFaceNormal='+ (patch?'vec3(0.);':'liveFaceNormalAttribute;')).replace('cadPosition=position;','cadPosition=transformed;');
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+clipShader).replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nliveClip();').replace('#include <clearcoat_normal_fragment_begin>','#include <clearcoat_normal_fragment_begin>\n#ifdef USE_CLEARCOAT\nclearcoatNormal=normal;\n#endif');
            if(patch&&!source.isMeshDepthMaterial&&!closure){
                // Only the two surface junctions; no artificial line through the arc.
                // Feature rails are evaluated on the same displaced
                // triangles. Screen-space width stays steady without extra geometry,
                // floating offsets, tessellation wires or work during radius dragging.
                shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\ncentroid varying highp float liveProfile;centroid varying highp vec2 liveSeam;').replace('#include <opaque_fragment>',`float railWidth=max(fwidth(liveProfile),.000001);
                    float junction=min(liveProfile,1.-liveProfile);
                    float border=1.-smoothstep(railWidth*.35,railWidth*1.35,junction);
                    vec2 seamWidth=max(fwidth(liveSeam),vec2(.000001));
                    vec2 seamBorder=vec2(1.)-smoothstep(seamWidth*.35,seamWidth*1.35,liveSeam);
                    border=max(border,max(seamBorder.x,seamBorder.y));
                    outgoingLight=mix(outgoingLight,vec3(.075,.095,.115),border*.85);
                    #include <opaque_fragment>`);
            }
        };material.defaultAttributeValues={...source.defaultAttributeValues,liveFaceNormalAttribute:[0,0,0]};material.customProgramCacheKey=()=>cache()+'/live-edge-v26/'+patch+'/'+closure;if(source.isMeshDepthMaterial){material.polygonOffset=false;}material.side=source.isMeshDepthMaterial?THREE.DoubleSide:source.side;material.shadowSide=THREE.FrontSide;this.materials.push(material);return material;
    }
    set(value){
        if(!Number.isFinite(value)||value<.1)throw new Error('请输入不小于 0.1 mm 的有限尺寸。');
        if(value>this.boundsRadius){this.boundsRadius=value*2;this.records.forEach((row,index)=>{if(row[36]>=0)return;const bounds=this.recordBounds[index],box=bounds.base.clone().expandByScalar(this.boundsRadius*bounds.scale);row.set(box.min.toArray(),28);row.set(box.max.toArray(),32);this.texture.image.data.set(row,index*56);});this.texture.needsUpdate=true;}
        this.radius.value=value;this.value=value;return true;
    }
    frame(camera){if(!this.label)return;const point=this.anchor.clone().addScaledVector(this.anchorOffset,this.value).project(camera);this.label.hidden=point.z< -1||point.z>1;this.label.style.left=Math.max(8,Math.min(this.host.clientWidth-130,(point.x+1)*this.host.clientWidth/2+14))+'px';this.label.style.top=Math.max(8,Math.min(this.host.clientHeight-40,(1-point.y)*this.host.clientHeight/2-18))+'px';this.label.textContent=(this.bevel?'D ':'R ')+Number(this.value.toFixed(2))+' mm';}
    dispose(){this.label?.remove();this.mesh.material=this.original;this.mesh.customDepthMaterial=this.originalDepth;for(const [overlay,material] of this.overlays??[])overlay.material=material;for(const patch of this.patches){patch.removeFromParent();patch.geometry.dispose();}for(const material of this.materials)material.dispose();this.texture.dispose();this.roundTexture?.dispose();this.patches=[];}
}
