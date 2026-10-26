import {compileFilletMotion} from './fillet-motion.js';
// Pure geometry work only: no renderer, DOM, persistence or project mutation.
import {buildSolid,solidGeometry,exportSolidState,importSolidState,retainDocumentSolid,featureEndInfo} from './geometry.js';
import {bodyInfo} from './solid-bodies.js';
self.onmessage=({data})=>{
    const {id,epoch,document,feature,seed}=data;
    try{
        if(seed)importSolidState(document,seed);buildSolid(document);retainDocumentSolid(document);
        const candidate={...document,features:[...document.features,feature]},polygons=buildSolid(candidate),bodies=bodyInfo(candidate,polygons),indices=new Map();
        bodies.forEach((body,index)=>body.polygons.forEach(p=>indices.set(p,index)));
        const {geometry,polygons:ordered}=solidGeometry(polygons,indices),position=geometry.attributes.position.array,normal=geometry.attributes.normal.array,uv=geometry.attributes.uv.array,tangent=geometry.attributes.tangent.array;
        const actualDistance=feature.topologyBevel?featureEndInfo(candidate,feature).max:feature.depth;
        let motion=null;try{motion=compileFilletMotion(document,feature,polygons,ordered);}catch{}
        const transfers=[position.buffer,normal.buffer,uv.buffer,tangent.buffer];if(motion&&motion.movement.length!==position.length)motion=null;if(motion)transfers.push(motion.movement.buffer,motion.uvMovement.buffer,motion.normalMotion.buffer);
        self.postMessage({id,epoch,feature,motion,actualDistance,state:feature.previewSegments?null:exportSolidState(candidate),position,normal,uv,tangent,groups:geometry.groups,bodies:bodies.map(({id,featureIds})=>({id,featureIds}))},transfers);
        geometry.dispose();
    }catch(error){self.postMessage({id,epoch,feature,error:error.message});}
};
