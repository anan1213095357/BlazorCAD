import Module from './vendor/manifold.js';
import * as CAD from './engine/core.js';
import {closeExportSolid} from './geometry.js';
let loaded;
async function kernel(){
    loaded??=Module({locateFile:()=>new URL('./vendor/manifold.wasm',import.meta.url).href}).then(module=>{module.setup();return module;});
    return loaded;
}
function inputMesh(module,polygons,label){
    const sewn=closeExportSolid(polygons),positions=[],triangles=[],indices=new Map();
    const vertex=point=>{const coordinates=point.toArray().map(Math.fround),key=coordinates.join('/');if(!indices.has(key)){indices.set(key,positions.length/3);positions.push(...coordinates);}return indices.get(key);};
    const triangle=(a,b,c)=>{const ids=[vertex(a),vertex(b),vertex(c)];if(new Set(ids).size===3)triangles.push(...ids);};
    for(const polygon of sewn){
        if(polygon.vertices.length===3)triangle(...polygon.vertices);
        else{const center=polygon.vertices.reduce((sum,point)=>sum.add(point),new CAD.Vector3()).multiplyScalar(1/polygon.vertices.length);for(let i=0;i<polygon.vertices.length;i++)triangle(center,polygon.vertices[i],polygon.vertices[(i+1)%polygon.vertices.length]);}
    }
    const mesh=new module.Mesh({numProp:3,vertProperties:new Float32Array(positions),triVerts:new Uint32Array(triangles)});mesh.merge();
    const result=new module.Manifold(mesh),status=result.status();
    if(status!=='NoError'){result.delete();throw new Error(`${label}无法形成闭合网格（${status}）。`);}
    return result;
}
export async function exportMeshOperations(stock,operations,onProgress=()=>{}){
    const module=await kernel(),allocated=[];
    try{
        let result=inputMesh(module,stock,'基础实体');allocated.push(result);
        for(const [index,operation] of operations.entries()){
            onProgress(`网格实体运算：${index+1} / ${operations.length}`);
            const tools=operation.tools.map((polygons,i)=>{
                let value;
                if(polygons.exportSweepCells){
                    const cells=[];
                    for(const points of polygons.exportSweepCells){
                        const cell=module.Manifold.hull(points.map(point=>point.toArray()));allocated.push(cell);
                        const status=cell.status();if(status!=='NoError')throw new Error(`曲线倒角分段体生成失败（${status}）。`);
                        // A station exactly on the collapse axis has zero volume.
                        // It contributes no cutting region; its neighbours do.
                        if(!cell.isEmpty())cells.push(cell);
                    }
                    if(!cells.length)throw new Error('曲线倒角未生成有效切削体积。');
                    value=cells.length===1?cells[0]:module.Manifold.union(cells);
                    if(cells.length!==1)allocated.push(value);
                }else{
                    value=inputMesh(module,polygons,`第 ${index+1} 组第 ${i+1} 个切削体`);allocated.push(value);
                }
                for(const plane of polygons.endDomains??[]){value=value.trimByPlane(plane.normal.clone().negate().toArray(),-plane.w);allocated.push(value);}
                return value;
            });
            // Adjacent mitred tools share an end face. Unite the cutting
            // volume first so those internal faces never reach the stock cut.
            const operand=tools.length===1?tools[0]:module.Manifold.union(tools);if(tools.length!==1)allocated.push(operand);
            const next=operation.subtract?module.Manifold.difference([result,operand]):module.Manifold.union([result,operand]);allocated.push(next);result=next;
        }
        const status=result.status();if(status!=='NoError')throw new Error(`网格布尔失败（${status}）。`);
        // STL stores Float32 positions and has no merge-vertex metadata.
        // Remove only detail below that representation's coordinate precision
        // while the manifold kernel still owns the connected topology.
        onProgress('正在按 STL 坐标精度整理实体拓扑…');
        const bounds=result.boundingBox(),magnitude=Math.max(...bounds.min.map(Math.abs),...bounds.max.map(Math.abs));
        const spacing=magnitude>0?Math.max(2**-149,2**(Math.floor(Math.log2(magnitude))-23)):2**-149;
        // Quantize BEFORE simplifying: getMesh() converts internal doubles
        // to Float32. Simplifying doubles first leaves edges which only become
        // coincident during that final conversion, too late for kernel repair.
        // Batch mapping crosses the WASM boundary once, not once per vertex.
        // History/face IDs are useful while editing, but may protect short
        // seams from simplification. STL has no such provenance: rebuild the
        // face grouping before repairing its Float32-sized vertex clusters.
        const original=result.asOriginal();allocated.push(original);
        const quantized=original.warpBatch(coordinates=>{
            for(let i=0;i<coordinates.length;i++)coordinates[i]=Math.fround(coordinates[i]);
        });allocated.push(quantized);
        const quantizedStatus=quantized.status();
        if(quantizedStatus!=='NoError')throw new Error(`STL 坐标转换失败（${quantizedStatus}）。`);
        const simplified=quantized.simplify(spacing*2);allocated.push(simplified);
        const simplifiedStatus=simplified.status();
        if(simplifiedStatus!=='NoError')throw new Error(`STL 精度整理失败（${simplifiedStatus}）。`);
        const mesh=simplified.getMesh(),vertices=[],parents=new Uint32Array(mesh.numVert);
        for(let i=0;i<parents.length;i++)parents[i]=i;
        const root=index=>{let current=index;while(parents[current]!==current)current=parents[current];while(parents[index]!==index){const next=parents[index];parents[index]=current;index=next;}return current;};
        // Property/face seams may duplicate vertices. Their authoritative merge
        // pairs define one topological vertex; coordinate hashing alone loses it.
        for(let i=0;i<(mesh.mergeFromVert?.length??0);i++){
            const from=mesh.mergeFromVert[i],to=mesh.mergeToVert[i];
            if(from>=parents.length||to>=parents.length)throw new Error('导出实体包含无效的缝合顶点引用。');
            const a=root(from),b=root(to);if(a!==b)parents[a]=b;
        }
        const roots=Array.from(parents,(_,i)=>root(i)),topology=new Map();
        for(let i=0;i<mesh.triVerts.length;i+=3)for(let side=0;side<3;side++){
            const a=roots[mesh.triVerts[i+side]],b=roots[mesh.triVerts[i+(side+1)%3]];
            if(a===b)throw new Error('导出内核返回退化拓扑边。');
            const key=a<b?a+'/'+b:b+'/'+a,edge=topology.get(key)??{count:0,balance:0};
            edge.count++;edge.balance+=a<b?1:-1;topology.set(key,edge);
        }
        if([...topology.values()].some(edge=>edge.count!==2||edge.balance!==0))throw new Error('导出内核的索引拓扑未闭合，不能用坐标调整代替修复。');
        // Preserve the kernel's positions and merge identities. Never move
        // distinct surface fans apart merely to satisfy the STL edge check.
        for(let i=0;i<parents.length;i++){
            const offset=roots[i]*mesh.numProp;
            vertices.push(new CAD.Vector3(Math.fround(mesh.vertProperties[offset]),Math.fround(mesh.vertProperties[offset+1]),Math.fround(mesh.vertProperties[offset+2])));
        }
        const polygons=[];
        for(let i=0;i<mesh.triVerts.length;i+=3)polygons.push({vertices:[vertices[mesh.triVerts[i]],vertices[mesh.triVerts[i+1]],vertices[mesh.triVerts[i+2]]]});
        return polygons;
    }finally{for(const value of allocated.reverse())value.delete();}
}
