import {Vector3} from './engine/core.js';

const cache=new WeakMap();
// A closure is supported by the material immediately BEHIND its plane.
// Sampling the solid section also preserves fused feet, whose old internal
// coplanar face no longer exists, and holes introduced by later physical cuts.
export function capStockSection(polygons,origin,outward){
    if(!polygons.length)return null;
    const normal=outward.clone().normalize(),w=normal.dot(origin),key=[...normal.toArray(),w].map(value=>value.toFixed(7)).join('/');
    let sections=cache.get(polygons);if(!sections){sections=new Map();cache.set(polygons,sections);}
    if(sections.has(key))return sections.get(key);
    const u=new Vector3(...(Math.abs(normal.z)<.8?[0,0,1]:[0,1,0])).cross(normal).normalize(),v=normal.clone().cross(u);
    const inset=Math.max(1e-5,Math.abs(w)*1e-8),planeW=w-inset,segments=[];
    for(const polygon of polygons){
        const distances=polygon.vertices.map(point=>normal.dot(point)-planeW);
        if(distances.every(distance=>distance>1e-9)||distances.every(distance=>distance< -1e-9))continue;
        const points=[];
        const add=point=>{if(!points.some(other=>other.distanceToSquared(point)<1e-18))points.push(point);};
        for(let i=0;i<polygon.vertices.length;i++){
            const next=(i+1)%polygon.vertices.length,a=polygon.vertices[i],b=polygon.vertices[next],da=distances[i],db=distances[next];
            if(Math.abs(da)<=1e-9)add(a);
            if(da*db<0)add(a.clone().lerp(b,da/(da-db)));
        }
        if(points.length<2)continue;
        let a=points[0],b=points[1],length=a.distanceToSquared(b);
        for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const distance=points[i].distanceToSquared(points[j]);if(distance>length){a=points[i];b=points[j];length=distance;}}
        if(length<1e-16)continue;
        const first=a.clone().sub(origin),last=b.clone().sub(origin);
        segments.push(first.dot(u),first.dot(v),last.dot(u),last.dot(v));
    }
    const result=segments.length?{u,v,origin:origin.clone(),data:new Float32Array(segments),count:segments.length/4}:null;
    sections.set(key,result);return result;
}
