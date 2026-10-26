import * as THREE from './vendor/three.module.js';
import {buildSolid} from './geometry.js';
import {topologyBevelWidth} from './topology-bevel.js';
import {resolveChamferEdge,chamferFaces} from './advanced-features.js';
import {topologyBevelEndPlanes} from './topology-bevel-ends.js';
import {connectedBodies} from './solid-bodies.js';
import {bevelControlCage} from './bevel-control-cage.js';

// Use only planes of faces actually incident to each welded vertex. Infinite
// tool planes can pass through unrelated vertices and must not constrain them.
export function compileTopologyBevelMotion(document,feature,polygons,ordered){
    const refs=feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge];
    const before=buildSolid(document),width=topologyBevelWidth(feature,refs.map(ref=>resolveChamferEdge(before,ref))),radius=feature.depth;
    if(width.distance!==radius)return null;
    const step=Math.max(.001,radius*.001),tools=[];
    const edges=bevelControlCage(refs.map(ref=>resolveChamferEdge(before,ref)),feature),ends=topologyBevelEndPlanes(before,feature,edges),current=edges.map(edge=>chamferFaces([],feature,edge)),shifted=edges.map(edge=>chamferFaces([],{...feature,depth:radius+step},edge));
    for(let edgeIndex=0;edgeIndex<edges.length;edgeIndex++){const a=current[edgeIndex],b=shifted[edgeIndex];
        if(a.length!==b.length)return null;
        const plane=face=>{const n=new THREE.Vector3();for(let i=1;i<face.vertices.length-1;i++)n.add(face.vertices[i].clone().sub(face.vertices[0]).cross(face.vertices[i+1].clone().sub(face.vertices[0])));n.normalize();return {n,w:n.dot(face.vertices[0])};};
        for(let i=0;i<a.length;i++){const p=plane(a[i]),q=plane(b[i]);if(p.n.dot(q.n)<1-1e-10)return null;tools.push({...p,slope:(q.w-p.w)/step});}
    }
    // Clipping adds stationary end planes. Do not finite-difference the clipped
    // cap vertex lists: hull/triangulation changes can alter their length while
    // the supporting planes and the valid vertex motion remain unchanged.
    for(const pair of ends)for(const end of pair)tools.push({n:end.n,w:end.w,slope:0});
    const planes=[];
    for(const p of polygons){let slope=0;if(p.tag.featureId===feature.id){const match=tools.find(t=>Math.abs(t.n.dot(p.normal))>1-1e-10&&Math.abs(t.w*p.normal.dot(t.n)-p.w)<1e-6);if(!match)return null;slope=match.slope*Math.sign(match.n.dot(p.normal));}planes.push({n:p.normal,w:p.w,slope});}
    const key=p=>p.toArray().map(v=>Math.round(v/1e-6)).join('/'),speeds=new Map(),incidents=new Map();
    polygons.forEach((p,i)=>p.vertices.forEach(point=>{const id=key(point);if(!incidents.has(id))incidents.set(id,[]);incidents.get(id).push(planes[i]);}));
    for(const [id,incident] of incidents){
        if(incident.every(p=>Math.abs(p.slope)<1e-10)){speeds.set(id,new THREE.Vector3());continue;}
        let speed=null;
        for(let i=0;i<incident.length&&!speed;i++)for(let j=i+1;j<incident.length&&!speed;j++)for(let k=j+1;k<incident.length;k++){
            const [a,b,c]=[incident[i],incident[j],incident[k]],cross=b.n.clone().cross(c.n),det=a.n.dot(cross);if(Math.abs(det)<1e-8)continue;
            speed=cross.multiplyScalar(a.slope).add(c.n.clone().cross(a.n).multiplyScalar(b.slope)).add(a.n.clone().cross(b.n).multiplyScalar(c.slope)).divideScalar(det);break;
        }
        // Subdivision points may have only one or two independent constraints.
        // Their tangential position is arbitrary; minimum-norm motion keeps all
        // adjacent faces planar and every shared point identical.
        if(!speed)for(let i=0;i<incident.length&&!speed;i++)for(let j=i+1;j<incident.length;j++){const a=incident[i],b=incident[j],dot=a.n.dot(b.n),det=1-dot*dot;if(det<1e-10)continue;speed=a.n.clone().multiplyScalar((a.slope-dot*b.slope)/det).addScaledVector(b.n,(b.slope-dot*a.slope)/det);break;}
        speed??=incident[0].n.clone().multiplyScalar(incident[0].slope);
        if(incident.some(p=>Math.abs(p.n.dot(speed)-p.slope)>1e-6))return null;
        speeds.set(id,speed);
    }
    const vertices=polygons.map(p=>p.vertices.map(point=>speeds.get(key(point)).toArray()));
    let min=.1,max=width.maximum;
    const bound=delta=>{if(delta>1e-7)max=Math.min(max,radius+delta);else if(delta< -1e-7)min=Math.max(min,radius+delta);};
    // Only retained boundaries can change this mesh topology. Exterior safety
    // planes and removed source faces produce spurious events on hollow parts.
    const affected=new Set(connectedBodies(polygons).filter(body=>body.polygons.some(p=>p.tag.featureId===feature.id)).flatMap(body=>body.polygons));
    const uniquePlanes=[...new Map(planes.filter((_,i)=>affected.has(polygons[i])).map(p=>[[...p.n.toArray(),p.w,p.slope].map(v=>Math.round(v/1e-7)).join('/'),p])).values()];
    // Welded vertices occur in several BSP fragments. Their event constraints
    // are identical; evaluate each shared point once, preserving every plane.
    const checked=new Set();
    for(const p of polygons)for(const point of p.vertices){const id=key(point);if(checked.has(id))continue;checked.add(id);const speed=speeds.get(id);if(speed.lengthSq()<1e-20)continue;for(const plane of uniquePlanes){const distance=plane.n.dot(point)-plane.w,slope=plane.n.dot(speed)-plane.slope;if(Math.abs(distance)>1e-6&&Math.abs(slope)>1e-9)bound(-distance/slope);}}
    // No triangle may turn over within the reusable interval.
    for(const p of polygons)if(affected.has(p))for(let i=1;i<p.vertices.length-1;i++){
        const a=p.vertices[0],b=p.vertices[i],c=p.vertices[i+1],u=b.clone().sub(a),v=c.clone().sub(a),du=speeds.get(key(b)).clone().sub(speeds.get(key(a))),dv=speeds.get(key(c)).clone().sub(speeds.get(key(a)));
        const A=du.clone().cross(dv).dot(p.normal),B=du.clone().cross(v).add(u.clone().cross(dv)).dot(p.normal),C=u.clone().cross(v).dot(p.normal);
        if(Math.abs(C)<1e-10)continue;
        if(Math.abs(A)<1e-10){if(Math.abs(B)>1e-10)bound(-C/B);}else{const d=B*B-4*A*C;if(d>=0){bound((-B-Math.sqrt(d))/(2*A));bound((-B+Math.sqrt(d))/(2*A));}}
    }
    if(min>.1)min+=1e-4;if(max<width.maximum)max-=1e-4;
    if(radius<min||radius>max||max-min<.01)return null;
    const movement=[],uvMovement=[],normalMotion=[];
    for(const p of ordered){const u=(Math.abs(p.normal.z)<.8?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0)).cross(p.normal).normalize(),v=p.normal.clone().cross(u);
        for(let i=1;i<p.vertices.length-1;i++){const triangle=[p.vertices[0],p.vertices[i],p.vertices[i+1]];if(triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).lengthSq()<1e-12)continue;for(const point of triangle){const speed=speeds.get(key(point));movement.push(...speed.toArray());uvMovement.push(speed.dot(u),speed.dot(v));normalMotion.push(NaN,0,0,0,0,0,0,0,0);}}
    }
    return {radius,min,max,movement:new Float32Array(movement),uvMovement:new Float32Array(uvMovement),normalMotion:new Float32Array(normalMotion),vertices,centers:polygons.map(()=>null)};
}
