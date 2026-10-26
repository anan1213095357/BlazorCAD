// Compile an exact affine motion for a fixed straight-edge BSP topology.
// Every supporting plane has a fixed normal and an affine offset in radius.
// Vertex velocities follow the intersection of three independent planes.
import * as THREE from './vendor/three.core.js';
import {buildSolid} from './geometry.js';
import {resolveChamferEdge,chamferFaces} from './advanced-features.js';
import {topologyBevelWidth} from './topology-bevel.js';
import {compileTopologyBevelMotion} from './topology-bevel-motion.js';
const key=p=>[p.x,p.y,p.z].map(v=>Math.round(v/1e-6)).join('/');
export function compileFilletMotion(document,feature,polygons,ordered){
    const bevel=feature.topologyBevel&&feature.edgeTreatment==='chamfer';
    if(bevel)return compileTopologyBevelMotion(document,feature,polygons,ordered);
    if((feature.edgeTreatment!=='fillet'&&!bevel)||feature.previewSegments)return null;
    const before=buildSolid(document),refs=feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge],edges=refs.map(ref=>resolveChamferEdge(before,ref));
    if(edges.some(edge=>edge.kind==='curve'))return null;
    if(bevel&&topologyBevelWidth(feature,edges).distance!==feature.depth)return null;
    const radius=feature.depth,delta=Math.max(.001,radius*.001),planes=[],seen=new Set();
    const add=(n,w,slope)=>{const id=[n.x,n.y,n.z,w,slope].map(v=>Math.round(v/1e-7)).join('/');if(!seen.has(id)){seen.add(id);planes.push({n,w,slope});}};
    for(const p of before)add(p.normal,p.w,0);
    for(const edge of edges){let first,second;try{first=chamferFaces([],feature,edge);second=chamferFaces([],{...feature,depth:radius+delta},edge);}catch{return null;}
        if(first.length!==second.length)return null;
        for(let i=0;i<first.length;i++){
            // Outside tool faces never bound the retained solid. End caps lie
            // beyond the original edge; original face planes already bound it.
            if(!bevel&&first[i].face!=='curved')continue;
            const normal=face=>face.vertices[1].clone().sub(face.vertices[0]).cross(face.vertices[2].clone().sub(face.vertices[0])).normalize(),n=normal(first[i]),other=normal(second[i]);
            if(n.dot(other)<1-1e-10)return null;
            const w=n.dot(first[i].vertices[0]);add(n,w,(n.dot(second[i].vertices[0])-w)/delta);
        }
    }
    const widthLimit=bevel?topologyBevelWidth(feature,edges).maximum:Infinity;
    let min=.1,max=bevel?widthLimit:Math.min(1000,...edges.map(edge=>edge.limit*Math.tan((Math.PI-Math.acos(THREE.MathUtils.clamp(edge.normalA.dot(edge.normalB),-1,1)))/2)*.98));const velocities=new Map(),unresolved=new Map();
    const constrain=(point,velocity)=>{
        for(const plane of planes){const distance=plane.n.dot(point)-plane.w,slope=plane.n.dot(velocity)-plane.slope;if(Math.abs(distance)<2e-5||Math.abs(slope)<1e-8)continue;const crossing=radius-distance/slope;if(crossing>radius)max=Math.min(max,crossing);else min=Math.max(min,crossing);}
    };
    for(const polygon of polygons)for(const point of polygon.vertices){
        const id=key(point);if(velocities.has(id)||unresolved.has(id))continue;
        const incident=planes.filter(p=>Math.abs(p.n.dot(point)-p.w)<2e-5);let velocity=null;
        for(let i=0;i<incident.length&&!velocity;i++)for(let j=i+1;j<incident.length&&!velocity;j++)for(let k=j+1;k<incident.length;k++){
            const [a,b,c]=[incident[i],incident[j],incident[k]],cross=b.n.clone().cross(c.n),det=a.n.dot(cross);if(Math.abs(det)<1e-5)continue;
            velocity=cross.multiplyScalar(a.slope).add(a.n.clone().cross(b.n).multiplyScalar(c.slope)).add(c.n.clone().cross(a.n).multiplyScalar(b.slope)).divideScalar(det);break;
        }
        if(!velocity){if(!bevel)return null;unresolved.set(id,{point,incident});continue;}
        if(incident.some(p=>Math.abs(p.n.dot(velocity)-p.slope)>2e-5))return null;
        constrain(point,velocity);
        velocities.set(id,velocity);
    }
    // Sewn T-junction points need not lie on three independent planes. Their
    // location along a straight mesh edge is arbitrary; interpolate its two
    // endpoint velocities rather than disabling all interactive motion.
    while(unresolved.size){
        let progress=false;
        for(const [id,{point,incident}] of unresolved){
            let velocity=null;
            for(const polygon of polygons){
                const index=polygon.vertices.findIndex(vertex=>key(vertex)===id);if(index<0)continue;
                let a=null,b=null;
                for(let step=1;step<polygon.vertices.length;step++){const vertex=polygon.vertices[(index-step+polygon.vertices.length)%polygon.vertices.length];if(velocities.has(key(vertex))){a=vertex;break;}}
                for(let step=1;step<polygon.vertices.length;step++){const vertex=polygon.vertices[(index+step)%polygon.vertices.length];if(velocities.has(key(vertex))){b=vertex;break;}}
                if(!a||!b)continue;
                const delta=b.clone().sub(a),length=delta.lengthSq();if(length<1e-12)continue;
                const t=point.clone().sub(a).dot(delta)/length;
                if(t<0||t>1||a.clone().addScaledVector(delta,t).distanceToSquared(point)>1e-10)continue;
                const candidate=velocities.get(key(a)).clone().lerp(velocities.get(key(b)),t);
                if(incident.every(p=>Math.abs(p.n.dot(candidate)-p.slope)<=2e-5)){velocity=candidate;break;}
            }
            if(!velocity)continue;
            constrain(point,velocity);velocities.set(id,velocity);unresolved.delete(id);progress=true;
        }
        if(!progress)return null;
    }
    // Leave a numerical margin at any topology event. Never extrapolate across it.
    if(min>.1)min+=1e-4;if(max<widthLimit||!bevel)max-=1e-4;if(radius<min||radius>max||max-min<.05)return null;
    const centerSpeeds=new Map();for(const edge of edges){const curved=chamferFaces([],feature,edge).find(face=>face.smooth?.kind==='cylinder');if(curved)centerSpeeds.set(key(curved.smooth.center),curved.smooth.center.clone().sub(edge.a).divideScalar(radius));}
    const movement=[],uvMovement=[],normalMotion=[];
    for(const p of ordered){const u=(Math.abs(p.normal.z)<.8?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0)).cross(p.normal).normalize(),v=p.normal.clone().cross(u);
        for(let i=1;i<p.vertices.length-1;i++){const triangle=[p.vertices[0],p.vertices[i],p.vertices[i+1]];if(triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).lengthSq()<1e-12)continue;for(const point of triangle){const speed=velocities.get(key(point));movement.push(speed.x,speed.y,speed.z);uvMovement.push(speed.dot(u),speed.dot(v));const surface=p.tag.featureId===feature.id?p.tag.smooth:null,centerSpeed=surface?.kind==='cylinder'?centerSpeeds.get(key(surface.center)):null;if(centerSpeed)normalMotion.push(...surface.center.toArray(),...surface.axis.toArray(),...centerSpeed.toArray());else normalMotion.push(NaN,0,0,0,0,0,0,0,0);}}
    }
    return {radius,min,max,movement:new Float32Array(movement),uvMovement:new Float32Array(uvMovement),normalMotion:new Float32Array(normalMotion),centers:polygons.map(p=>p.tag.featureId===feature.id&&p.tag.smooth?.kind==='cylinder'?centerSpeeds.get(key(p.tag.smooth.center))?.toArray()??null:null),vertices:polygons.map(p=>p.vertices.map(point=>velocities.get(key(point)).toArray()))};
}
