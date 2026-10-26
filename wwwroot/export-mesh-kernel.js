import Module from './vendor/manifold.js';
import * as THREE from './vendor/three.module.js';
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
        else{const center=polygon.vertices.reduce((sum,point)=>sum.add(point),new THREE.Vector3()).multiplyScalar(1/polygon.vertices.length);for(let i=0;i<polygon.vertices.length;i++)triangle(center,polygon.vertices[i],polygon.vertices[(i+1)%polygon.vertices.length]);}
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
                let value=inputMesh(module,polygons,`第 ${index+1} 组第 ${i+1} 个切削体`);allocated.push(value);
                for(const plane of polygons.endDomains??[]){value=value.trimByPlane(plane.normal.clone().negate().toArray(),-plane.w);allocated.push(value);}
                return value;
            });
            // Adjacent mitred tools share an end face. Unite the cutting
            // volume first so those internal faces never reach the stock cut.
            const operand=tools.length===1?tools[0]:module.Manifold.union(tools);if(tools.length!==1)allocated.push(operand);
            const next=operation.subtract?module.Manifold.difference([result,operand]):module.Manifold.union([result,operand]);allocated.push(next);result=next;
        }
        const status=result.status();if(status!=='NoError')throw new Error(`网格布尔失败（${status}）。`);
        const mesh=result.getMesh(),vertices=[];
        for(let i=0;i<mesh.vertProperties.length;i+=mesh.numProp)vertices.push(new THREE.Vector3(mesh.vertProperties[i],mesh.vertProperties[i+1],mesh.vertProperties[i+2]));
        const polygons=[];
        for(let i=0;i<mesh.triVerts.length;i+=3)polygons.push({vertices:[vertices[mesh.triVerts[i]],vertices[mesh.triVerts[i+1]],vertices[mesh.triVerts[i+2]]]});
        return polygons;
    }finally{for(const value of allocated.reverse())value.delete();}
}
