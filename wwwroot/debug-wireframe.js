import * as THREE from './vendor/three.module.js';

// Shares the rendered geometry and its displacement/clipping uniforms. No BSP,
// edge catalogue, mesh extraction or geometry upload is needed while dragging.
export class DebugWireframe {
    constructor(){this.enabled=false;this.sources=[];this.overlays=[];}
    setEnabled(value){this.enabled=!!value;if(!this.enabled)this.clear();}
    sync(sources){
        sources=[...new Set(sources.filter(mesh=>mesh?.isMesh))];
        if(!this.enabled)return;
        if(sources.length===this.sources.length&&sources.every((mesh,i)=>mesh===this.sources[i]))return;
        this.clear();this.sources=sources;
        for(const source of sources)for(const hidden of [true,false]){
            const materials=(Array.isArray(source.material)?source.material:[source.material]).map(original=>{
                const material=original.clone(),compile=original.onBeforeCompile,cache=original.customProgramCacheKey.bind(original);
                material.defaultAttributeValues={...original.defaultAttributeValues};
                material.wireframe=true;material.side=THREE.DoubleSide;material.depthTest=true;material.depthWrite=false;
                material.depthFunc=hidden?THREE.GreaterDepth:THREE.LessEqualDepth;
                material.transparent=false;material.opacity=1;material.toneMapped=false;
                material.polygonOffset=!hidden;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-1;
                material.onBeforeCompile=(shader,...args)=>{
                    compile.call(material,shader,...args);
                    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','#include <opaque_fragment>\ngl_FragColor=vec4('+(hidden?'1.0,0.12,0.65':'0.05,1.0,0.72')+',1.0);');
                };
                material.customProgramCacheKey=()=>cache()+'/debug-wire/'+hidden;
                return material;
            });
            const overlay=new THREE.Mesh(source.geometry,Array.isArray(source.material)?materials:materials[0]);
            overlay.userData.sharedGeometry=true;overlay.userData.sharedMaterial=true;
            overlay.renderOrder=hidden?10000:10001;overlay.frustumCulled=false;overlay.raycast=()=>{};
            source.add(overlay);this.overlays.push({overlay,materials});
        }
    }
    clear(){for(const {overlay,materials} of this.overlays){overlay.removeFromParent();for(const material of materials)material.dispose();}this.overlays=[];this.sources=[];}
    dispose(){this.clear();}
}
