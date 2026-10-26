import * as THREE from './vendor/three.module.js';

function bevelPlane(edge,feature,origin){
    const tangent=edge.b.clone().sub(edge.a).normalize(),a=tangent.clone().cross(edge.normalA).normalize(),b=tangent.clone().cross(edge.normalB).normalize();
    if(a.dot(edge.normalB)>0)a.negate();if(b.dot(edge.normalA)>0)b.negate();
    const p=edge.a.clone().sub(origin).addScaledVector(a,feature.depth*(edge.topologyProfile?.first??1)),q=edge.a.clone().sub(origin).addScaledVector(b,feature.depth*(edge.topologyProfile?.second??Math.tan((feature.chamferAngle??45)*Math.PI/180))),n=q.clone().sub(p).cross(tangent).normalize();
    return {n,w:n.dot(p)};
}

// Each endpoint is trimmed in a shared geometric plane, not by independently
// extending rectangular cutters through neighbouring material.
export function topologyBevelEndPlanes(solid,feature,edges){
    const joints=new Map();
    return edges.map((edge,index)=>{
        const planes=[];
        for(const [endpoint,other] of [[edge.a,edge.b],[edge.b,edge.a]]){
            const interior=other.clone().sub(endpoint).normalize(),neighbours=edges.map((value,i)=>({value,i})).filter(({value,i})=>i!==index&&[value.a,value.b].some(p=>p.distanceToSquared(endpoint)<1e-10));
            const control=edge.topologyCageEnds?.[endpoint===edge.a?0:1]??null;
            let n=control?.normal.clone()??null,point=control?.origin??endpoint;
            if(!control&&neighbours.length===1){
                const neighbour=neighbours[0],id=[index,neighbour.i].sort((a,b)=>a-b).join('/');
                let joint=joints.get(id);
                if(!joint){
                    // Work relative to the shared vertex. Subtracting large
                    // world-space plane intersections loses precision here.
                    const a=bevelPlane(edge,feature,endpoint),b=bevelPlane(neighbour.value,feature,endpoint);
                    if(Math.abs(a.w)>1e-10&&Math.abs(b.w)>1e-10){
                        const normal=a.n.clone().divideScalar(a.w).sub(b.n.clone().divideScalar(b.w));
                        const far=neighbour.value.a.distanceToSquared(endpoint)>neighbour.value.b.distanceToSquared(endpoint)?neighbour.value.a:neighbour.value.b;
                        if(normal.lengthSq()>1e-12&&normal.dot(interior)*normal.dot(far.clone().sub(endpoint))<0){
                            normal.normalize();joint={normal,point:endpoint.clone()};joints.set(id,joint);
                        }
                    }
                }
                if(joint){n=joint.normal.clone();point=joint.point;}
            }
            if(!n||Math.abs(n.dot(interior))<1e-8){
                const candidates=solid.filter(p=>Math.abs(p.normal.dot(endpoint)-p.w)<1e-6&&Math.abs(p.normal.dot(interior))>1e-6&&p.vertices.every((a,i)=>p.vertices[(i+1)%p.vertices.length].clone().sub(a).cross(endpoint.clone().sub(a)).dot(p.normal)>=-1e-6));
                candidates.sort((a,b)=>Math.abs(b.normal.dot(interior))-Math.abs(a.normal.dot(interior)));
                n=candidates[0]?.normal.clone()??interior.clone().negate();point=endpoint;
            }
            if(n.dot(interior)>0)n.negate();
            planes.push({n,w:n.dot(point),control,name:'surface|junction|'+index+'|'+(endpoint===edge.a?'a':'b')});
        }
        return planes;
    });
}
export function topologyBevelTools(solid,feature,edges,tools,endPlanes=null){
    const planes=endPlanes??topologyBevelEndPlanes(solid,feature,edges);
    return tools.map((faces,i)=>{for(const plane of planes[i]){const control=plane.control,points=control?[control.origin.clone().addScaledVector(control.top,feature.depth),control.origin.clone().addScaledVector(control.foot,feature.depth)]:[];faces=clip(faces,plane.n,plane.w,plane.name,points);}return faces;});
}

function clip(faces,n,w,name,controls=[]){
    const result=[],cut=[],epsilon=1e-8;
    let outside=false,inside=false;
    for(const face of faces)for(const point of face.vertices){const distance=n.dot(point)-w;outside ||= distance>epsilon;inside ||= distance< -epsilon;}
    // Merely touching an existing face is not a new section. Adding another
    // cap in this case duplicates its coplanar triangles.
    if(!outside)return faces;
    if(!inside)return [];
    for(const face of faces){const ring=[];
        for(let i=0;i<face.vertices.length;i++){
            const a=face.vertices[i],b=face.vertices[(i+1)%face.vertices.length],da=n.dot(a)-w,db=n.dot(b)-w;
            if(da<=epsilon)ring.push(a);
            if((da< -epsilon&&db>epsilon)||(da>epsilon&&db< -epsilon)){const point=a.clone().lerp(b,da/(da-db));ring.push(point);cut.push(point);}
            if(Math.abs(da)<=epsilon)cut.push(a);
        }
        const clean=ring.filter((point,i)=>point.distanceToSquared(ring[(i+ring.length-1)%ring.length])>epsilon*epsilon);
        if(clean.length>=3)result.push({...face,vertices:clean});
    }
    // Authoritative seam endpoints are inserted first so incidental triangle
    // intersections cannot choose two independent versions of the same point.
    const contained=controls.filter(point=>Math.abs(n.dot(point)-w)<1e-6&&faces.every(face=>{
        const normal=new THREE.Vector3();for(let i=1;i<face.vertices.length-1;i++)normal.add(face.vertices[i].clone().sub(face.vertices[0]).cross(face.vertices[i+1].clone().sub(face.vertices[0])));
        if(normal.lengthSq()<1e-20)return true;normal.normalize();return normal.dot(point.clone().sub(face.vertices[0]))<=1e-6;
    }));
    const points=[];for(const p of [...contained,...cut])if(!points.some(q=>q.distanceToSquared(p)<1e-16))points.push(p);
    if(points.length>=3){
        const origin=points[0],u=(Math.abs(n.z)<.8?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0)).cross(n).normalize(),v=n.clone().cross(u);
        const projected=points.map(point=>{const d=point.clone().sub(origin);return {point,x:d.dot(u),y:d.dot(v)};}).sort((a,b)=>a.x-b.x||a.y-b.y);
        const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
        const half=values=>{const hull=[];for(const item of values){while(hull.length>1){const a=hull.at(-2),b=hull.at(-1),scale=Math.max(epsilon,Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(item.x-b.x,item.y-b.y));if(turn(a,b,item)>epsilon*scale)break;hull.pop();}hull.push(item);}return hull;};
        const lower=half(projected),upper=half([...projected].reverse()),boundary=[...lower.slice(0,-1),...upper.slice(0,-1)].map(item=>item.point);
        // All cutters are convex. Their true section is the convex hull, not
        // an angular polygon through internal triangulation/coplanar points.
        if(boundary.length>=3)result.push({vertices:boundary,face:name});
    }
    return result;
}
