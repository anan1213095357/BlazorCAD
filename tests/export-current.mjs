// Real export worker, read-only project input. Writes only test artifacts.
import fs from 'node:fs';
import {buildSolid,exportSolidState,packExportEdges} from '../wwwroot/geometry.js';
import {visualEdgeDescendants} from '../wwwroot/visual-edge-history.js';
import {visualCapEdges} from '../wwwroot/visual-cap-edges.js';
const saved=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),document=saved.document??saved;
const started=performance.now(),solid=buildSolid(document),entries=[],catalog=[];
console.log('base',solid.length,'polygons',Math.round(performance.now()-started),'ms');
for(const feature of document.features.filter(f=>f.mode==='chamfer'&&f.visualOnly)){
    const edges=[],refs=feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge];
    for(const [index,ref] of refs.entries()){
        const resolved=ref.faceA.face.startsWith('visual-cap|')?catalog.filter(edge=>edge.faceA.featureId===ref.faceA.featureId&&edge.faceA.face===ref.faceA.face&&edge.segment===ref.segment):visualEdgeDescendants(document,feature,ref,solid);
        for(const edge of resolved)edges.push({...edge,visualFeature:feature,visualReferenceIndex:index});
    }
    entries.push(...edges);catalog.push(...visualCapEdges(feature,edges,solid));
}
globalThis.self={postMessage(data){
    if(data.progress)console.log(data.progress,Math.round(performance.now()-started),'ms');
    if(data.error){fs.writeFileSync('tests/export-diagnostics.json',JSON.stringify(data,null,2));console.error(data.error);process.exitCode=1;}
    if(data.buffer){fs.writeFileSync('tests/export-current.stl',Buffer.from(data.buffer));console.log('EXPORTED',data.buffer.byteLength,'bytes',data.elapsed,'ms');}
}};
await import('../wwwroot/export-solid-worker.js');
await self.onmessage({data:{document,seed:exportSolidState(document,true),edges:packExportEdges(entries)}});
