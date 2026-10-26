import * as CAD from './engine/core.js';
import {buildSolid,documentGeometry} from './geometry.js';
import {referencedEdgeOptions,resolveChamferEdge} from './advanced-features.js';

// Segment numbers are only local to one topology state. A cut can turn segment
// zero into several descendants; inherit by the original geometric rail instead.
const sources=new Map();
// Prepared in the geometry worker. Keep this document's source rails separate
// from the small on-demand history cache so eviction cannot trigger a rebuild
// of an already prepared historical solid in the viewport thread.
let preparedSources=new Map();
const sameFace=(a,b)=>a?.featureId===b?.featureId&&a?.face===b?.face;
function matching(edge,reference){return (edge.kind??'line')===(reference.kind??'line')&&(sameFace(edge.faceA,reference.faceA)&&sameFace(edge.faceB,reference.faceB)||sameFace(edge.faceA,reference.faceB)&&sameFace(edge.faceB,reference.faceA));}
function sourceContext(document,feature,reference){
    const index=document.features.findIndex(item=>item.id===feature.id),prefix={...document,features:document.features.slice(0,index)};
    return {prefix,key:documentGeometry(prefix)+'/'+JSON.stringify(reference)};
}
function originalEdge(document,feature,reference,solid){
    const {prefix,key}=sourceContext(document,feature,reference);
    if(preparedSources.has(key)){const edge=preparedSources.get(key);if(edge.error)throw new Error(edge.error);return edge;}
    if(sources.has(key))return sources.get(key);
    const before=solid&&documentGeometry(prefix)===documentGeometry(document)?solid:buildSolid(prefix),edge=resolveChamferEdge(before,reference);
    sources.set(key,edge);while(sources.size>48)sources.delete(sources.keys().next().value);return edge;
}
export function prepareVisualEdgeHistory(document,solid){
    const result=new Map();
    for(const feature of document.features){
        if(feature.mode!=='chamfer'||!feature.visualOnly)continue;
        for(const reference of feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge]){
            if(!reference||reference.faceA?.face?.startsWith('visual-cap|'))continue;
            // Missing descendants are omitted by the existing display path too.
            if(solid&&!referencedEdgeOptions(solid,reference).some(edge=>matching(edge,reference)))continue;
            try{
                const {key}=sourceContext(document,feature,reference);if(result.has(key))continue;
                const edge=originalEdge(document,feature,reference,solid);
                result.set(key,{kind:edge.kind??'line',a:edge.a.toArray(),b:edge.b.toArray(),closed:edge.closed,points:edge.points?.map(point=>point.toArray())});
            }catch(error){result.set(sourceContext(document,feature,reference).key,{error:error.message});}
        }
    }
    return [...result];
}
export function importVisualEdgeHistory(records){
    preparedSources=new Map(records.map(([key,edge])=>[key,edge.error?edge:{...edge,a:new CAD.Vector3(...edge.a),b:new CAD.Vector3(...edge.b),points:edge.points?.map(point=>new CAD.Vector3(...point))}]));
}
export function visualEdgeDescendants(document,feature,reference,solid){
    const candidates=referencedEdgeOptions(solid,reference).filter(edge=>matching(edge,reference));if(!candidates.length)return [];
    const source=originalEdge(document,feature,reference,solid),tolerance=1e-4;
    if((source.kind??'line')==='line'){
        const axis=source.b.clone().sub(source.a),length=axis.length();if(length<tolerance)return [];axis.divideScalar(length);
        const result=[];
        for(const edge of candidates){
            const a=edge.a.clone().sub(source.a),b=edge.b.clone().sub(source.a),ta=a.dot(axis),tb=b.dot(axis);
            if(a.clone().addScaledVector(axis,-ta).length()>tolerance||b.clone().addScaledVector(axis,-tb).length()>tolerance)continue;
            const from=Math.max(0,Math.min(ta,tb)),to=Math.min(length,Math.max(ta,tb));if(to-from<=tolerance)continue;
            result.push({...edge,a:source.a.clone().addScaledVector(axis,ta<=tb?from:to),b:source.a.clone().addScaledVector(axis,ta<=tb?to:from)});
        }
        return result;
    }
    const points=source.points,closest=new CAD.Vector3(),rail=[];
    for(let i=0;i<(source.closed?points.length:points.length-1);i++)rail.push(new CAD.Line3(points[i],points[(i+1)%points.length]));
    return candidates.filter(edge=>edge.points.every(point=>rail.some(segment=>{segment.closestPointToPoint(point,true,closest);return closest.distanceToSquared(point)<=tolerance*tolerance;})));
}
export function clearVisualEdgeHistory(){sources.clear();preparedSources.clear();}
