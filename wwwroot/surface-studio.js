import * as THREE from 'three';
export class SurfaceStudio {
    constructor(renderer,scene,redraw){Object.assign(this,{renderer,scene,redraw});this.environmentKey=null;this.environmentTarget=null;this.materials=new Map();}
    environment(kind='studio'){
        if(this.environmentKey===kind)return;this.environmentKey=kind;this.scene.environment=null;this.environmentTarget?.dispose();this.environmentTarget=null;
        if(kind==='none')return;
        // Linear half-float radiance: keep softboxes brighter than white so
        // PMREM produces real specular highlights instead of a flat LDR tint.
        const width=1024,height=512,data=new Uint16Array(width*height*4),panels=[];
        const panel=(position,w,h,power,color)=>{const n=new THREE.Vector3(...position).normalize(),u=new THREE.Vector3(0,0,1).cross(n);if(u.lengthSq()<.01)u.set(1,0,0);u.normalize();panels.push({n,u,v:n.clone().cross(u),w,h,power,color});};
        const soft=kind==='soft';
        panel([-1,-.45,1.25],soft ? .85 : .42,soft ? .65 : .48,soft?3:4.5,[1,.96,.9]);
        panel([.9,.35,.8],.18,.85,soft?2.5:4,[.88,.94,1]);
        panel([.2,1,.6],.6,.28,kind==='workshop'?4:2.5,[1,.96,.87]);
        panel([.12,-.1,1],.45,.16,soft?1.5:2,[1,1,1]);
        const d=new THREE.Vector3(),smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*(3-2*x);};
        for(let y=0;y<height;y++){const latitude=((y+.5)/height-.5)*Math.PI,cy=Math.cos(latitude),dy=Math.sin(latitude);
            for(let x=0;x<width;x++){const longitude=((x+.5)/width-.5)*Math.PI*2;d.set(cy*Math.cos(longitude),dy,cy*Math.sin(longitude));
                const sky=d.z>0 ? .09+.15*d.z : .035+.035*(1+d.z);let r=sky,g=sky*1.015,b=sky*1.045;
                for(const light of panels){const facing=d.dot(light.n);if(facing<=0)continue;const u=Math.abs(d.dot(light.u)/facing)/light.w,v=Math.abs(d.dot(light.v)/facing)/light.h,weight=smooth((1.04-u)/.08)*smooth((1.04-v)/.08)*light.power;
                    r+=weight*light.color[0];g+=weight*light.color[1];b+=weight*light.color[2];}
                const i=(y*width+x)*4;data[i]=THREE.DataUtils.toHalfFloat(r);data[i+1]=THREE.DataUtils.toHalfFloat(g);data[i+2]=THREE.DataUtils.toHalfFloat(b);data[i+3]=THREE.DataUtils.toHalfFloat(1);
            }
        }
        const source=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.HalfFloatType);source.mapping=THREE.EquirectangularReflectionMapping;source.colorSpace=THREE.LinearSRGBColorSpace;source.minFilter=source.magFilter=THREE.LinearFilter;source.needsUpdate=true;
        const generator=new THREE.PMREMGenerator(this.renderer);this.environmentTarget=generator.fromEquirectangular(source);this.scene.environment=this.environmentTarget.texture;source.dispose();generator.dispose();this.redraw();
    }
    material(settings={},editing=false){
        const key=JSON.stringify([settings,editing]),cached=this.materials.get(key);
        if(cached){this.materials.delete(key);this.materials.set(key,cached);return cached;}
        const preset=settings.preset??'steel',metal=['steel','aluminum','copper','brass'].includes(preset),grain=settings.grain??(metal ? .18 : .12),anisotropy=settings.anisotropy??(preset==='steel' ? .55 : preset==='aluminum' ? .3 : 0),angle=(settings.brushAngle??0)*Math.PI/180;
        const material=new THREE.MeshPhysicalMaterial({color:settings.color??'#b8bdc3',metalness:settings.metalness??.98,roughness:settings.roughness??.24,clearcoat:settings.clearcoat??.02,clearcoatRoughness:.16,specularIntensity:settings.specular??1,envMapIntensity:(settings.environmentStrength??1)*(.1+.85*(settings.specular??1)),anisotropy:metal?anisotropy:0,anisotropyRotation:angle,transparent:false,opacity:1,depthWrite:true});
        const aspect={value:1};
        if(settings.textureId){
            const loader=new THREE.TextureLoader(),texture=loader.load('/cad-textures/'+settings.textureId,loaded=>{aspect.value=Math.max(.001,loaded.image.width/loaded.image.height);material.needsUpdate=true;this.redraw();},undefined,()=>{material.userData.textureError=true;this.redraw();});texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=this.renderer.capabilities.getMaxAnisotropy();material.map=texture;
        }
        material.onBeforeCompile=shader=>{
            Object.assign(shader.uniforms,{cadAspect:aspect,cadMapping:{value:settings.mapping==='triplanar'?1:0},cadTile:{value:settings.textureSize??25},cadAngle:{value:(settings.textureAngle??0)*Math.PI/180},cadGrain:{value:grain},cadBrush:{value:metal?anisotropy:0},cadBrushAngle:{value:angle}});
            shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 cadPosition; varying vec3 cadNormal; varying vec2 cadSurfaceUv;').replace('#include <begin_vertex>','#include <begin_vertex>\ncadPosition=position;cadNormal=normal;cadSurfaceUv=uv;');
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
                varying vec3 cadPosition;varying vec3 cadNormal;varying vec2 cadSurfaceUv;
                uniform float cadTile,cadAngle,cadMapping,cadAspect,cadGrain,cadBrush,cadBrushAngle;
                float cadHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
                float cadNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(cadHash(i),cadHash(i+vec3(1,0,0)),f.x),mix(cadHash(i+vec3(0,1,0)),cadHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(cadHash(i+vec3(0,0,1)),cadHash(i+vec3(1,0,1)),f.x),mix(cadHash(i+vec3(0,1,1)),cadHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
                vec2 cadUv(vec2 uv){float c=cos(cadAngle),s=sin(cadAngle);return mat2(c,-s,s,c)*uv/vec2(cadTile*cadAspect,cadTile);}`)
                .replace('#include <map_fragment>',`#ifdef USE_MAP
                    vec3 blend=pow(abs(normalize(cadNormal)),vec3(6.));blend/=max(dot(blend,vec3(1.)),.0001);
                    vec4 texel=texture2D(map,cadUv(cadPosition.yz))*blend.x+texture2D(map,cadUv(cadPosition.xz))*blend.y+texture2D(map,cadUv(cadPosition.xy))*blend.z;
                    if(cadMapping<.5)texel=texture2D(map,cadUv(vMapUv));diffuseColor*=texel;
                #endif`)
                .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
                    float cadMicro=cadNoise(cadPosition*7.);float cadMacro=cadNoise(cadPosition*.22);
                    vec3 cadDirection=normalize(vec3(-sin(cadBrushAngle),cos(cadBrushAngle),.371));float cadPhase=dot(cadPosition,cadDirection)*145.;
                    float cadStripe=sin(cadPhase)*(1.-smoothstep(.5,2.,fwidth(cadPhase)));
                    roughnessFactor=clamp(roughnessFactor+cadGrain*((cadMacro-.5)*.008+(cadMicro-.5)*.018)+cadBrush*cadStripe*.003,.045,1.);`);
        };
        material.customProgramCacheKey=()=> 'cad-industrial-surface-v5';
        this.materials.set(key,material);return material;
    }
    trim(protectedMaterials=[]){
        if(this.materials.size<=64)return;
        const used=new Set(protectedMaterials);this.scene.traverse(object=>{if(object.material)for(const material of Array.isArray(object.material)?object.material:[object.material])used.add(material);});
        for(const [key,material] of this.materials){if(this.materials.size<=64)break;if(used.has(material))continue;material.map?.dispose();material.dispose();this.materials.delete(key);}
    }
    dispose(){for(const material of this.materials.values()){material.map?.dispose();material.dispose();}this.materials.clear();this.scene.environment=null;this.environmentTarget?.dispose();this.environmentTarget=null;}
}
