import * as CAD from './engine/core.js';
const cache=new WeakMap();
export function connectedBodies(polygons){
    if(cache.has(polygons))return cache.get(polygons);
    const parent=polygons.map((_,i)=>i),vertices=new Map(),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    polygons.forEach((polygon,i)=>{for(const p of polygon.vertices){const key=[p.x,p.y,p.z].map(v=>Math.round(v/1e-5)).join('/');if(vertices.has(key)){const a=find(i),b=find(vertices.get(key));parent[a]=b;}else vertices.set(key,i);}});
    const groups=new Map();polygons.forEach((p,i)=>{const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(p);});
    let result=[...groups.values()].map(faces=>({polygons:faces,featureIds:[...new Set([...new Set(faces.map(p=>p.tag.bodyFeatures??p.tag.featureId))].flatMap(value=>Array.isArray(value)?value:[value]))],box:new CAD.Box3().setFromPoints(faces.flatMap(p=>p.vertices))}));const volume=body=>body.polygons.reduce((sum,p)=>sum+p.vertices.slice(1,-1).reduce((v,b,i)=>v+p.vertices[0].dot(b.clone().cross(p.vertices[i+2]))/6,0),0);
    for(const cavity of result.filter(body=>volume(body)<-1e-6)){const enclosing=result.filter(body=>body!==cavity&&volume(body)>1e-6&&contains(body,cavity.polygons[0].vertices[0])).sort((a,b)=>a.box.getSize(new CAD.Vector3()).length()-b.box.getSize(new CAD.Vector3()).length())[0];if(enclosing){for(const polygon of cavity.polygons)enclosing.polygons.push(polygon);enclosing.featureIds=[...new Set([...enclosing.featureIds,...cavity.featureIds])];result=result.filter(body=>body!==cavity);}}
    cache.set(polygons,result);return result;
}
function contains(body,point){
    if(!body.box.clone().expandByScalar(1e-5).containsPoint(point))return false;
    const ray=new CAD.Ray(point,new CAD.Vector3(.819,.337,.464).normalize()),hit=new CAD.Vector3(),distances=[];
    for(const polygon of body.polygons)for(let i=1;i<polygon.vertices.length-1;i++)if(ray.intersectTriangle(polygon.vertices[0],polygon.vertices[i],polygon.vertices[i+1],false,hit)){const d=hit.distanceTo(point);if(d<1e-5)return true;if(!distances.some(v=>Math.abs(v-d)<1e-5))distances.push(d);}
    return distances.length%2===1;
}
export function recordBodyHistory(polygons,previous,operand,featureId){
    const bodies=connectedBodies(polygons),prior=connectedBodies(previous);
    for(const body of bodies){const ids=new Set(body.featureIds);for(const old of prior)if(old.featureIds.some(id=>ids.has(id))||contains(body,old.polygons[0].vertices[0]))for(const id of old.featureIds)ids.add(id);
        if(ids.has(featureId)||operand.length&&contains(body,operand[0].vertices[0]))ids.add(featureId);
        const history=[...ids];for(const polygon of body.polygons)polygon.tag={...polygon.tag,bodyFeatures:history};
        body.featureIds=history;
    }
    return polygons;
}
const infoCache=new WeakMap();
export function bodyInfo(doc,polygons){
    const key=JSON.stringify(doc.features.map(f=>[f.id,f.visualOnly,f.chamferEdges,f.chamferEdge])),cached=infoCache.get(polygons);if(cached?.key===key)return cached.value;
    const groups=connectedBodies(polygons),leaders=groups.map(body=>doc.features.find(f=>body.featureIds.includes(f.id))?.id??body.featureIds[0]);
    const value=groups.map((body,index)=>{const inherited=new Set(body.featureIds);for(const f of doc.features)if(f.mode==='chamfer'&&f.visualOnly&&(f.chamferEdges?.length?f.chamferEdges:[f.chamferEdge]).some(edge=>edge&&(inherited.has(edge.faceA.featureId)||inherited.has(edge.faceB.featureId))))inherited.add(f.id);const ids=doc.features.filter(f=>inherited.has(f.id)).map(f=>f.id),leader=leaders[index],id=leaders.filter(value=>value===leader).length>1?leader+'~'+groups.slice(0,index).filter((_,i)=>leaders[i]===leader).length:leader;for(const polygon of body.polygons)polygon.tag.bodyId=id;return {id,name:'实体 '+(index+1),featureIds:ids,polygons:body.polygons};});
    infoCache.set(polygons,{key,value});return value;
}
