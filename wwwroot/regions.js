// Planar arrangement of analytic rectangle edges and circles. Intersections split
// half-edges; their left-hand cycles define atomic selectable sketch regions.
import * as THREE from './vendor/three.core.js';
import { outline } from './sketch-tools.js';
const TAU = Math.PI * 2, EPS = 1e-7, STEP = Math.PI / 64;
const cross = (a,b) => a.x*b.y-a.y*b.x;
const point = (x,y) => new THREE.Vector2(x,y);
const mod = a => ((a % TAU) + TAU) % TAU;
function primitives(entities) {
    const result=[];
    for(const e of entities) {
        if(e.construction)continue;
        if(e.kind==='line'){result.push({key:e.id+':0',entityId:e.id,edge:0,kind:'line',a:point(e.x,e.y),b:point(e.x+e.width,e.y+e.height),cuts:[0,1]});continue;}
        if(e.kind==='arc'){const a=e.startAngle*Math.PI/180,b=(e.startAngle+e.sweepAngle)*Math.PI/180,start=Math.min(a,b),end=Math.max(a,b);result.push({key:e.id+':a',entityId:e.id,kind:'arc',c:point(e.x,e.y),r:e.radius,start,end,cuts:[start,end]});continue;}
        if(e.kind==='circle') result.push({key:e.id+':c',entityId:e.id,kind:'arc',c:point(e.x,e.y),r:e.radius,cuts:[0]});
        else {
            const p=outline(e).slice(0,-1).map(v=>point(...v));
            for(let i=0;i<p.length;i++) if(p[i].distanceToSquared(p[(i+1)%p.length])>EPS*EPS)result.push({key:e.id+':'+i,entityId:e.id,edge:i,kind:'line',a:p[i],b:p[(i+1)%p.length],cuts:[0,1]});
        }
    }
    return result;
}
function at(p,t) { return p.kind==='line'?p.a.clone().lerp(p.b,t):point(p.c.x+p.r*Math.cos(t),p.c.y+p.r*Math.sin(t)); }
function parameter(p,v) {if(p.kind==='line')return v.clone().sub(p.a).dot(p.b.clone().sub(p.a))/p.a.distanceToSquared(p.b);const angle=Math.atan2(v.y-p.c.y,v.x-p.c.x);return p.start===undefined?mod(angle):angle+Math.round(((p.start+p.end)/2-angle)/TAU)*TAU;}
function onPrimitive(p,v){const t=parameter(p,v);return p.kind==='line'?t>=-EPS&&t<=1+EPS:p.start===undefined||t>=p.start-EPS&&t<=p.end+EPS;}
function addCut(p,v){const t=parameter(p,v);p.cuts.push(p.kind==='line'?Math.max(0,Math.min(1,t)):t);}
function cutPair(a,b,v){if(onPrimitive(a,v)&&onPrimitive(b,v)){addCut(a,v);addCut(b,v);}}
function intersect(a,b) {
    if(a.kind==='arc'&&b.kind==='line')return intersect(b,a);
    if(a.kind==='line'&&b.kind==='line') {
        const r=a.b.clone().sub(a.a),s=b.b.clone().sub(b.a),q=b.a.clone().sub(a.a),d=cross(r,s);
        if(Math.abs(d)>EPS) {const t=cross(q,s)/d,u=cross(q,r)/d;if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS){const v=at(a,t);cutPair(a,b,v);}}
        else if(Math.abs(cross(q,r))<EPS) for(const v of [a.a,a.b,b.a,b.b]){const t=parameter(a,v),u=parameter(b,v);if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS){cutPair(a,b,v);}}
    } else if(a.kind==='line') {
        const d=a.b.clone().sub(a.a),q=a.a.clone().sub(b.c),A=d.lengthSq(),B=2*q.dot(d),C=q.lengthSq()-b.r*b.r,D=B*B-4*A*C;
        if(D < -EPS)return;
        for(const t of [(-B-Math.sqrt(Math.max(0,D)))/(2*A),(-B+Math.sqrt(Math.max(0,D)))/(2*A)])if(t>=-EPS&&t<=1+EPS){const v=at(a,t);cutPair(a,b,v);}
    } else {
        const d=a.c.distanceTo(b.c);if(d<EPS&&Math.abs(a.r-b.r)<EPS){for(const p of [a,b])if(p.start!==undefined)for(const t of [p.start,p.end])cutPair(a,b,at(p,t));return;}if(d<EPS||d>a.r+b.r+EPS||d<Math.abs(a.r-b.r)-EPS)return;
        const x=(a.r*a.r-b.r*b.r+d*d)/(2*d),h=Math.sqrt(Math.max(0,a.r*a.r-x*x)),dir=b.c.clone().sub(a.c).divideScalar(d),mid=a.c.clone().addScaledVector(dir,x);
        for(const sign of [-1,1]){const v=mid.clone().add(point(-dir.y,dir.x).multiplyScalar(h*sign));cutPair(a,b,v);}
    }
}
function signedArea(points) {let a=0;for(let i=0;i<points.length;i++)a+=cross(points[i],points[(i+1)%points.length]);return a/2;}
export function insideLoop(p,loop) {
    let inside=false;
    for(let i=0,j=loop.length-1;i<loop.length;j=i++) {const a=loop[i],b=loop[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}
    return inside;
}
export function containsRegion(region,p) {return insideLoop(p,region.outer.points)&&!region.holes.some(h=>insideLoop(p,h.points));}
function samples(edge) {
    const p=edge.primitive,n=p.kind==='line'?1:Math.max(1,Math.ceil(Math.abs(edge.to-edge.from)/STEP)),points=[];
    for(let i=0;i<n;i++)points.push(at(p,edge.from+(edge.to-edge.from)*i/n));
    return points;
}
function leftPoint(edge) {
    const p=edge.primitive,t=(edge.from+edge.to)/2,dir=p.kind==='line'?p.b.clone().sub(p.a):point(-Math.sin(t),Math.cos(t));
    dir.normalize().multiplyScalar(Math.sign(edge.to-edge.from));
    const length=Math.abs(edge.to-edge.from)*(p.kind==='line'?p.a.distanceTo(p.b):p.r);
    const offset=Math.max(1e-9,Math.min(1e-5,length*1e-7));
    return at(p,t).add(point(-dir.y,dir.x).multiplyScalar(offset));
}
function makeLoop(edges) {const points=edges.flatMap(samples);return {edges,points,area:signedArea(points),witness:leftPoint(edges[0])};}
function canonical(edges) {
    let tokens=edges.map(e=>e.primitive.key+(e.to>e.from?'+':'-'));
    tokens=tokens.filter((t,i)=>t!==tokens[(i+tokens.length-1)%tokens.length]);
    if(!tokens.length)tokens=[edges[0].primitive.key+(edges[0].to>edges[0].from?'+':'-')];
    let best=null;for(let i=0;i<tokens.length;i++){const s=tokens.slice(i).concat(tokens.slice(0,i)).join('/');if(best===null||s<best)best=s;}return best;
}
function assignHoles(loops) {
    const positives=loops.filter(l=>l.area>EPS).map(outer=>({outer,holes:[]}));
    for(const hole of loops.filter(l=>l.area < -EPS)) {
        const candidates=positives.filter(r=>insideLoop(hole.witness,r.outer.points)).sort((a,b)=>a.outer.area-b.outer.area);
        if(candidates.length)candidates[0].holes.push(hole);
    }
    return positives;
}
const regionResults=new Map();
export function buildRegions(sketch){
    const key=JSON.stringify(sketch.entities.map(e=>[e.id,e.kind,e.x,e.y,e.width,e.height,e.radius,e.angle??0,e.sides??6,e.startAngle??0,e.sweepAngle??90,!!e.construction]));
    if(regionResults.has(key))return regionResults.get(key);
    const result=computeRegions(sketch);regionResults.set(key,result);
    while(regionResults.size>128)regionResults.delete(regionResults.keys().next().value);
    return result;
}
function computeRegions(sketch) {
    const ps=primitives(sketch.entities),vertices=new Map(),halfEdges=[],dedup=new Set();
    for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)intersect(ps[i],ps[j]);
    function vertex(p) {const key=Math.round(p.x/1e-6)+','+Math.round(p.y/1e-6);if(!vertices.has(key))vertices.set(key,{key,p,outs:[]});return vertices.get(key);}
    for(const p of ps) {
        const cuts=p.cuts.sort((a,b)=>a-b).filter((t,i,a)=>i===0||Math.abs(t-a[i-1])>EPS);
        if(p.kind==='arc'&&p.start===undefined) {if(cuts[0]>EPS)cuts.unshift(0);cuts.push(TAU);}
        for(let i=0;i<cuts.length-1;i++) {
            const from=cuts[i],to=cuts[i+1];if(to-from<EPS)continue;
            const a=vertex(at(p,from)),b=vertex(at(p,to)),mid=at(p,(from+to)/2);
            // Shared/coincident straight edges and identical circles become one graph edge.
            const key=[a.key,b.key].sort().join('|')+'|'+Math.round(mid.x/1e-6)+','+Math.round(mid.y/1e-6);
            if(dedup.has(key))continue;dedup.add(key);
            const forward={id:halfEdges.length,primitive:p,from,to,a,b},reverse={id:halfEdges.length+1,primitive:p,from:to,to:from,a:b,b:a};
            forward.twin=reverse;reverse.twin=forward;a.outs.push(forward);b.outs.push(reverse);halfEdges.push(forward,reverse);
        }
    }
    for(const v of vertices.values())v.outs.sort((a,b)=> {
        const direction=e=>{const near=at(e.primitive,e.from+(e.to-e.from)*1e-6).sub(at(e.primitive,e.from));return Math.atan2(near.y,near.x);};
        return direction(a)-direction(b)||a.id-b.id;
    });
    for(const e of halfEdges){const outgoing=e.b.outs,i=outgoing.indexOf(e.twin);e.next=outgoing[(i+outgoing.length-1)%outgoing.length];}
    const loops=[],visited=new Set();
    for(const first of halfEdges) {
        if(visited.has(first.id))continue;const edges=[];let e=first;
        do {if(visited.has(e.id))break;visited.add(e.id);edges.push(e);e=e.next;}while(e!==first&&edges.length<=halfEdges.length);
        if(e===first&&edges.length) {const loop=makeLoop(edges);if(Math.abs(loop.area)>EPS)loops.push(loop);}
    }
    // Every bounded face is selectable, including slot portions beyond another contour.
    const regions=assignHoles(loops);
    for(const r of regions) {
        r.key=canonical(r.outer.edges)+';holes='+r.holes.map(h=>canonical(h.edges)).sort().join(';');
        r.area=r.outer.area+r.holes.reduce((a,h)=>a+h.area,0);
        r.sourceIds=[...new Set([r.outer,...r.holes].flatMap(l=>l.edges.map(e=>e.primitive.entityId)))].sort();
    }
    const keys=new Set();for(const r of regions){if(keys.has(r.key))throw new Error('草图区域拓扑存在歧义，请调整重合或相切的轮廓。');keys.add(r.key);}
    return regions.filter(r=>r.area>EPS);
}
export function regionShape(region) {
    const shape=new THREE.Shape(region.outer.points);
    for(const hole of region.holes)shape.holes.push(new THREE.Path(hole.points));
    return shape;
}
export function selectRegions(sketch,keys) {
    const all=buildRegions(sketch),selected=keys.map(key=>all.find(r=>r.key===key));
    if(selected.some(r=>!r))throw new Error('草图交叉关系已改变，原特征区域失效，请重新选择区域。');
    return selected;
}
export function mergeRegions(regions) {
    const boundary=new Map();
    for(const r of regions)for(const loop of [r.outer,...r.holes])for(const e of loop.edges){if(boundary.has(e.twin.id))boundary.delete(e.twin.id);else boundary.set(e.id,e);}
    const loops=[],used=new Set();
    for(const start of boundary.values()) {
        if(used.has(start.id))continue;const edges=[];let e=start;
        do {
            if(used.has(e.id))throw new Error('所选区域的边界无法闭合。');used.add(e.id);edges.push(e);
            const outs=e.b.outs,index=outs.indexOf(e.twin);let next=null;
            for(let i=1;i<=outs.length;i++){const candidate=outs[(index+outs.length-i)%outs.length];if(boundary.has(candidate.id)){next=candidate;break;}}
            if(!next)throw new Error('所选区域的边界存在断点。');e=next;
        }while(e!==start&&edges.length<=boundary.size);
        if(e!==start)throw new Error('所选区域的边界无法闭合。');loops.push(makeLoop(edges));
    }
    return assignHoles(loops);
}
