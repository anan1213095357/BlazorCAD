import {measure} from './cad-performance.js';
// Snap only to geometric face boundaries; triangulation diagonals are removed.
import * as CAD from './engine/core.js';
const EPS=1e-4;
const key=p=>`${Math.round(p.x/EPS)},${Math.round(p.y/EPS)}`;
const cross=(a,b)=>a.x*b.y-a.y*b.x;
// Index projected vertices once. A split edge only needs vertices inside its
// bounding rectangle, not every vertex of every fillet fragment on the face.
function vertexIndex(points){
    const build=items=>{
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        for(const p of items){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
        const node={minX,minY,maxX,maxY};
        if(items.length<=24){node.points=items;return node;}
        const axis=maxX-minX>=maxY-minY?'x':'y';items.sort((a,b)=>a[axis]-b[axis]);const mid=items.length>>1;
        node.left=build(items.slice(0,mid));node.right=build(items.slice(mid));return node;
    };
    const root=build(points.slice());
    return (a,b,margin)=>{
        const minX=Math.min(a.x,b.x)-margin,maxX=Math.max(a.x,b.x)+margin,minY=Math.min(a.y,b.y)-margin,maxY=Math.max(a.y,b.y)+margin,result=[],pending=[root];
        while(pending.length){const node=pending.pop();if(node.maxX<minX||node.minX>maxX||node.maxY<minY||node.minY>maxY)continue;
            if(node.points){for(const p of node.points)if(p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY)result.push(p);}
            else {pending.push(node.left,node.right);}
        }
        return result;
    };
}
function boundaryGraph(polygons,frame){return measure('face-boundary',()=>buildBoundaryGraph(polygons,frame),{polygons:polygons.length});}
function buildBoundaryGraph(polygons,frame) {
    const vertices=new Map(),segments=[];
    const local=v=>{const d=v.clone().sub(frame.o);return new CAD.Vector2(d.dot(frame.u),d.dot(frame.v));};
    for(const polygon of polygons) {
        const points=polygon.vertices.map(local);
        for(let i=0;i<points.length;i++) {
            const a=points[i],b=points[(i+1)%points.length];
            vertices.set(key(a),a);vertices.set(key(b),b);if(a.distanceToSquared(b)>EPS*EPS)segments.push([a,b]);
        }
    }
    const all=[...vertices.values()],parts=new Map(),nearby=vertexIndex(all);
    for(const [a,b] of segments) {
        const d=b.clone().sub(a),len=d.lengthSq();
        const length=Math.sqrt(len),cuts=[];
        for(const p of nearby(a,b,EPS*(length+1))){const x=p.x-a.x,y=p.y-a.y,t=(x*d.x+y*d.y)/len;if(t>=-EPS&&t<=1+EPS&&Math.abs(d.x*y-d.y*x)<=EPS*length)cuts.push({p,t});}
        cuts.sort((a,b)=>a.t-b.t);
        for(let i=0;i<cuts.length-1;i++) {
            const u=key(cuts[i].p),v=key(cuts[i+1].p);if(u===v)continue;
            const id=[u,v].sort().join('|');const part=parts.get(id);
            if(part)part.count++;else parts.set(id,{u,v,count:1});
        }
    }
    const graph=new Map();
    const connect=(a,b)=>{if(!graph.has(a))graph.set(a,new Set());graph.get(a).add(b);};
    for(const e of parts.values())if(e.count%2===1){connect(e.u,e.v);connect(e.v,e.u);}
    return {graph,vertices,parts,all};
}
export function faceBoundarySegments(polygons,frame) {
    const {graph,vertices}=boundaryGraph(polygons,frame),segments=[];
    for(const [id,neighbors] of graph)for(const other of neighbors)if(id<other)segments.push({a:vertices.get(id),b:vertices.get(other)});
    return segments;
}
export function faceSnapPoints(polygons,frame) {
    const {graph,vertices,parts,all}=boundaryGraph(polygons,frame);
    const result=[],seenPoints=new Set();
    const add=(p,kind,label)=>{const id=key(p);if(!seenPoints.has(id)){seenPoints.add(id);result.push({point:p.clone(),kind,label});}};
    const corners=new Set();
    for(const [id,neighbors] of graph) {
        const center=vertices.get(id),ns=[...neighbors];
        if(ns.length!==2){corners.add(id);continue;}
        const a=vertices.get(ns[0]).clone().sub(center).normalize(),b=vertices.get(ns[1]).clone().sub(center).normalize();
        // Small turns around tessellated circles are not CAD vertices.
        if(a.dot(b)>-Math.cos(.15))corners.add(id);
    }
    for(const id of corners)add(vertices.get(id),'vertex','顶点');
    const visited=new Set();
    for(const [start,neighbors] of graph)for(const first of neighbors) {
        const initial=[start,first].sort().join('|');if(visited.has(initial))continue;
        const walk=[start];let previous=start,current=first;
        while(true) {
            visited.add([previous,current].sort().join('|'));walk.push(current);
            const next=[...graph.get(current)].find(n=>n!==previous);
            if(!next||current===start||walk.length>parts.size+1)break;
            if(visited.has([current,next].sort().join('|')))break;
            previous=current;current=next;
        }
        if(walk[0]===walk[walk.length-1]) {
            const pivot=walk.findIndex(id=>corners.has(id));
            if(pivot>0){const ring=walk.slice(0,-1);const rotated=ring.slice(pivot).concat(ring.slice(0,pivot));walk.splice(0,walk.length,...rotated,rotated[0]);}
        }
        const points=walk.map(id=>vertices.get(id));
        if(walk[0]===walk[walk.length-1]) {
            const box=new CAD.Box2().setFromPoints(points);add(box.getCenter(new CAD.Vector2()),'center','轮廓中心');
        }
        // Follow each straight run between true vertices for its actual midpoint.
        const cornerIndices=walk.map((id,i)=>corners.has(id)?i:-1).filter(i=>i>=0);
        if(cornerIndices.length>1)for(let i=0;i<cornerIndices.length-1;i++) {
            const from=cornerIndices[i],to=cornerIndices[i+1],a=points[from],b=points[to],d=b.clone().sub(a);
            if(d.lengthSq()<EPS*EPS)continue;
            if(points.slice(from,to+1).every(p=>Math.abs(cross(d,p.clone().sub(a)))<=EPS*d.length()))add(a.clone().add(b).multiplyScalar(.5),'midpoint','边中点');
        }
    }
    if(all.length)add(new CAD.Box2().setFromPoints(all).getCenter(new CAD.Vector2()),'center','面中心');
    return result;
}
export function closestScreenSnap(candidates,frame,camera,width,height,x,y,tolerance=14) {
    let best=null,score=Infinity;
    for(const candidate of candidates) {
        const project=p=>{const world=frame.o.clone().addScaledVector(frame.u,p.x).addScaledVector(frame.v,p.y),screen=world.clone().project(camera);return {screen,depth:-world.clone().applyMatrix4(camera.matrixWorldInverse).z};};
        let local=candidate.point,reference=candidate.reference;
        if(candidate.segment){
            const [a,b]=candidate.segment,pa=project(a),pb=project(b);if(pa.depth<=0||pb.depth<=0)continue;
            const sa=new CAD.Vector2((pa.screen.x+1)*width/2,(1-pa.screen.y)*height/2),sb=new CAD.Vector2((pb.screen.x+1)*width/2,(1-pb.screen.y)*height/2),delta=sb.clone().sub(sa),length=delta.lengthSq();
            if(length<1e-8)continue;
            const t=Math.max(0,Math.min(1,new CAD.Vector2(x,y).sub(sa).dot(delta)/length)),ratio=camera.isOrthographicCamera?t:t*pa.depth/((1-t)*pb.depth+t*pa.depth);
            local=a.clone().lerp(b,ratio);
            const [nx,ny]=candidate.normal,[start,end]=candidate.range;
            reference={...reference,parameter:Math.max(0,Math.min(1,(-ny*local.x+nx*local.y-start)/(end-start)))};
        }
        if(!local)continue;
        const {screen}=project(local);if(screen.z < -1 || screen.z > 1)continue;
        const sx=(screen.x+1)*width/2,sy=(1-screen.y)*height/2,distance=Math.hypot(sx-x,sy-y);
        const rank=distance+(candidate.kind==='vertex'?0:candidate.kind==='edge'?5:2);
        if(distance<=tolerance&&rank<score){score=rank;best={...candidate,point:local,reference,screenX:sx,screenY:sy};}
    }
    return best;
}
