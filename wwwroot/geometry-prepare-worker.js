import {buildSolid,solidGeometry,validateSupportPlanes,exportSolidState,importSolidState,documentGeometry,retainDocumentSolid} from './geometry.js';
import {bodyInfo} from './solid-bodies.js';
import {applyModelDimensions} from './model-dimensions.js';
import {buildRegions} from './regions.js';
import {prepareVisualEdgeHistory} from './visual-edge-history.js';
self.onmessage=({data})=>prepare(data);
function prepare(data){
    const {id,document,preferredId,intent,seed,retainedGeometry,validateOnly=false}=data;
    const started=performance.now();
    try{
        if(seed)importSolidState(document,seed);
        const adjustments=applyModelDimensions(document,validateOnly,preferredId,intent);
        // Visit source rails in feature order before completing the final solid,
        // allowing buildSolid to reuse the preceding historical prefix.
        const visualHistory=prepareVisualEdgeHistory(document);
        buildSolid(document);validateSupportPlanes(document);
        for(const sketch of document.sketches)buildRegions(sketch);
        retainDocumentSolid(document);
        if(documentGeometry(document)===retainedGeometry){self.postMessage({id,adjustments,state:null,visualHistory,elapsed:performance.now()-started});return;}
        const solid=buildSolid(document),bodies=bodyInfo(document,solid),indices=new Map(),sourceIndices=new Map(solid.map((p,i)=>[p,i]));
        bodies.forEach((body,index)=>body.polygons.forEach(p=>indices.set(p,index)));
        const prepared=solidGeometry(solid,indices),geometry=prepared.geometry,tagSources=new Map(solid.map((p,i)=>[p.tag,i]));
        const draw={position:geometry.attributes.position.array,normal:geometry.attributes.normal.array,uv:geometry.attributes.uv.array,tangent:geometry.attributes.tangent.array,groups:geometry.groups,
            order:Uint32Array.from(prepared.polygons,p=>sourceIndices.get(p)),tagSources:Uint32Array.from(prepared.tags,tag=>tagSources.get(tag))};
        const state=exportSolidState(document,true);
        self.postMessage({id,adjustments,state,draw,visualHistory,elapsed:performance.now()-started},[state.positions.buffer,state.offsets.buffer,state.tagIds.buffer,draw.position.buffer,draw.normal.buffer,draw.uv.buffer,draw.tangent.buffer,draw.order.buffer,draw.tagSources.buffer]);
        geometry.dispose();
    }catch(error){self.postMessage({id,error:error.message});}
}
