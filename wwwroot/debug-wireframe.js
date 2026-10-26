import {Mesh,DoubleSide,GreaterDepth,LessEqualDepth} from './engine/core.js';
export class DebugWireframe {
 constructor(){this.enabled=false;this.sources=[];this.overlays=[];}
 setEnabled(value){this.enabled=!!value;if(!this.enabled)this.clear();}
 sync(sources){sources=[...new Set(sources.filter(mesh=>mesh?.isMesh))];if(!this.enabled)return;if(sources.length===this.sources.length&&sources.every((mesh,i)=>mesh===this.sources[i]))return;this.clear();this.sources=sources;
  for(const source of sources)for(const hidden of [true,false]){
   const materials=(Array.isArray(source.material)?source.material:[source.material]).map(original=>{const material=original.clone();Object.assign(material,{wireframe:true,side:DoubleSide,depthTest:true,depthWrite:false,depthFunc:hidden?GreaterDepth:LessEqualDepth,transparent:false,opacity:1,toneMapped:false,polygonOffset:!hidden,polygonOffsetFactor:-1,polygonOffsetUnits:-1});return material;});
   const overlay=new Mesh(source.geometry,Array.isArray(source.material)?materials:materials[0]);overlay.userData.sharedGeometry=true;overlay.userData.sharedMaterial=true;overlay.renderOrder=hidden?10000:10001;overlay.raycast=()=>{};source.add(overlay);this.overlays.push({overlay,materials});
  }
 }
 clear(){for(const {overlay,materials} of this.overlays){overlay.removeFromParent();for(const material of materials)material.dispose();}this.overlays=[];this.sources=[];}
 dispose(){this.clear();}
}
