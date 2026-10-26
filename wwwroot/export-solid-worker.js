import * as CAD from './engine/core.js';
import {buildSolid,featurePolygons,importSolidState,unpackExportEdges,exportEdgeTools,exportOperationTools} from './geometry.js';
import {exportMeshOperations} from './export-mesh-kernel.js';
import {visualEdgeDescendants} from './visual-edge-history.js';
import {visualCapEdges} from './visual-cap-edges.js';
let exportStage='初始化';
function progress(message){exportStage=message;self.postMessage({progress:message});}

async function bakeFinalStock(document,stock,edges){
    const grouped=new Map();for(const edge of edges){const id=edge.visualFeature?.id;if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(edge);}
    const additions=new Map(),tools=[];
    const box=polygons=>new CAD.Box3().setFromPoints(polygons.flatMap(p=>p.vertices)).expandByScalar(1e-5);
    for(const [index,feature] of document.features.entries()){
        if(feature.mode!=='chamfer'||!feature.visualOnly)continue;
        const resolved=grouped.get(feature.id)??[],references=feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge];
        // If later cuts completely consumed a saved rail, use chronological
        // replay rather than silently omitting that historical feature.
        if(references.some((_,ordinal)=>!resolved.some(edge=>edge.visualReferenceIndex===ordinal)))return null;
        const batch=exportEdgeTools(feature,resolved,stock),toolBounds=batch.map(box);
        for(let later=index+1;later<document.features.length;later++){
            const addition=document.features[later];if(addition.kind==='cut'||addition.mode==='chamfer')continue;
            if(!additions.has(addition.id))additions.set(addition.id,box(featurePolygons(document,addition)));
            // A later union overlapping an earlier cut cannot be reordered.
            if(toolBounds.some(bounds=>bounds.intersectsBox(additions.get(addition.id))))return null;
        }
        tools.push(...batch);
    }
    progress('正在将倒角写入当前实体…');
    return exportMeshOperations(stock,[{subtract:true,tools}],progress);
}
async function materialize(document,seed,packedEdges){
    if(seed){
        const stock=importSolidState(document,seed);
        if(packedEdges){
            progress('正在复用当前模型与已解析的倒角边…');
            const baked=await bakeFinalStock(document,stock,unpackExportEdges(packedEdges));
            if(baked!==null)return baked;
        }
    }
    let solid=null;const catalog=[],operations=[];
    for(let index=0;index<document.features.length;index++){
        const feature=document.features[index],prefix={...document,features:document.features.slice(0,index+1)};
        progress(`正在生成导出实体：${index+1} / ${document.features.length}`);
        try{
            if(feature.mode==='chamfer'&&feature.visualOnly){
                const before={...document,features:document.features.slice(0,index)},stock=buildSolid(before);
                solid??=stock;
                const references=feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge],edges=[];
                for(const [referenceIndex,reference] of references.entries()){
                    const generated=reference?.faceA?.face?.startsWith('visual-cap|');
                    const resolved=generated?catalog.filter(edge=>edge.faceA.featureId===reference.faceA.featureId&&edge.faceA.face===reference.faceA.face&&edge.segment===reference.segment):visualEdgeDescendants(prefix,feature,reference,stock);
                    if(!resolved.length)throw new Error(`第 ${referenceIndex+1} 条倒角边无法恢复（${reference?.faceA?.face??'缺少面引用'}），已停止导出，避免遗漏该倒角。`);
                    // visualCapEdges publishes identities using this original
                    // reference ordinal. The viewport sets it too; omitting it
                    // produced visual-cap|undefined|... in the export catalog.
                    for(const edge of resolved)edges.push({...edge,visualFeature:feature,visualReferenceIndex:referenceIndex});
                }
                operations.push({subtract:true,tools:exportEdgeTools(feature,edges,stock)});
                catalog.push(...visualCapEdges(feature,edges,stock));
            }else if(solid!==null)operations.push({subtract:feature.kind==='cut'||feature.mode==='chamfer',tools:exportOperationTools(prefix,feature)});
        }catch(error){throw new Error(`第 ${index+1} 项特征无法导出：${error.message}`);}
    }
    progress('正在缝合并检查导出网格…');
    return exportMeshOperations(solid??buildSolid(document),operations,progress);
}
export function binaryStl(polygons){
    progress('正在检查三角边并写入 STL…');
    const triangles=[],incidence=new Map(),key=point=>point.toArray().map(value=>value===0?0:value).join('/'),splits=new Map();
    const floatPoint=point=>new CAD.Vector3(Math.fround(point.x),Math.fround(point.y),Math.fround(point.z));
    const edgeKey=(a,b)=>{const x=key(a),y=key(b);return x<y?x+'>'+y:y+'>'+x;};
    // Float32 conversion can flatten a very thin triangle into three collinear
    // points. Its middle vertex still belongs to the neighbouring boundary.
    // Transfer that vertex to the long edge instead of tearing a T-junction.
    for(const polygon of polygons){
        if(polygon.vertices.length!==3)continue;
        const vertices=polygon.vertices.map(floatPoint);
        if(new Set(vertices.map(key)).size!==3||vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).lengthSq()!==0)continue;
        let longest=0;for(let i=1;i<3;i++)if(vertices[i].distanceToSquared(vertices[(i+1)%3])>vertices[longest].distanceToSquared(vertices[(longest+1)%3]))longest=i;
        const id=edgeKey(vertices[longest],vertices[(longest+1)%3]),point=vertices[(longest+2)%3];
        if(!splits.has(id))splits.set(id,[]);if(!splits.get(id).some(value=>key(value)===key(point)))splits.get(id).push(point);
    }
    const add=points=>{
        const vertices=points.map(point=>point.clone().set(Math.fround(point.x),Math.fround(point.y),Math.fround(point.z))),normal=vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0]));
        if(!vertices.every(p=>p.toArray().every(Number.isFinite)))throw new Error('导出网格包含无效坐标。');
        // A tiny but non-zero triangle can be the only closure between two
        // Float32 boundary vertices. An area threshold tears that seam open.
        if(normal.lengthSq()===0)return;
        for(let i=0;i<3;i++){
            const a=vertices[i],b=vertices[(i+1)%3],insert=splits.get(edgeKey(a,b));if(!insert)continue;
            const direction=b.clone().sub(a),ordered=[...insert].sort((p,q)=>p.clone().sub(a).dot(direction)-q.clone().sub(a).dot(direction)),chain=[a,...ordered,b];
            for(let j=1;j<chain.length;j++)add([chain[j-1],chain[j],vertices[(i+2)%3]]);
            return;
        }
        triangles.push({vertices,normal:normal.normalize()});
        for(let index=0;index<3;index++){const a=key(vertices[index]),b=key(vertices[(index+1)%3]),id=a<b?a+'>'+b:b+'>'+a,edge=incidence.get(id)??{count:0,balance:0};edge.count++;edge.balance+=a<b?1:-1;incidence.set(id,edge);}
    };
    for(const polygon of polygons){
        if(polygon.vertices.length===3)add(polygon.vertices);
        else{
            // The welded boundary may contain collinear T-junction vertices.
            // A corner fan drops these; a centre fan preserves every boundary edge.
            const center=polygon.vertices.reduce((sum,point)=>sum.add(point),polygon.vertices[0].clone().set(0,0,0)).multiplyScalar(1/polygon.vertices.length);
            for(let index=0;index<polygon.vertices.length;index++)add([center,polygon.vertices[index],polygon.vertices[(index+1)%polygon.vertices.length]]);
        }
    }
    if(!triangles.length)throw new Error('没有可导出的有效实体。');
    const failed=[...incidence.entries()].filter(([,edge])=>edge.count!==2||edge.balance!==0);
    if(failed.length){const error=new Error('最终 STL 三角网格未闭合或存在重叠边，已停止导出，避免生成破面文件。');error.boundaryEdges=failed.map(([key,edge])=>({key,...edge}));throw error;}
    const buffer=new ArrayBuffer(84+triangles.length*50),view=new DataView(buffer);view.setUint32(80,triangles.length,true);
    let offset=84;
    for(const triangle of triangles){for(const vector of [triangle.normal,...triangle.vertices])for(const value of vector.toArray()){view.setFloat32(offset,value,true);offset+=4;}view.setUint16(offset,0,true);offset+=2;}
    return buffer;
}
self.onmessage=async({data})=>{const started=performance.now();exportStage='初始化';try{const buffer=binaryStl(await materialize(data.document,data.seed,data.edges));self.postMessage({buffer,elapsed:performance.now()-started},[buffer]);}catch(error){self.postMessage({error:`STL 导出失败（${exportStage}）：${error.message}`,stack:error.stack,boundaryEdges:error.boundaryEdges??error.cause?.boundaryEdges});}};
