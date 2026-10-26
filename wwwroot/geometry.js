// Convex polygon BSP boolean operations. Coordinates remain in model millimetres.
// Face provenance survives splitting so a resulting planar face can host a sketch.
import * as CAD from './engine/core.js';
import {recordBodyHistory,connectedBodies} from './solid-bodies.js';
import {advancedFaces,chamferFaces,solidEdgeOptions,edgeTreatmentOptions,resolveChamferEdge,resolveSolidEdge,sweepGuideData} from './advanced-features.js';
export {solidEdgeOptions,edgeTreatmentOptions,resolveSolidEdge};
import { outline,slotToWorld,slotToLocal,rotationEdges } from './sketch-tools.js';
import { faceBoundarySegments } from './snapping.js';
import {topologyBevelWidth,sewTopologyBevel} from './topology-bevel.js';
import {topologyBevelTools,topologyBevelEndPlanes} from './topology-bevel-ends.js';
import {bevelControlCage} from './bevel-control-cage.js';
import {rimBevelProfiles} from './rim-bevel-profile.js';
import {exportEdgeJunctions} from './export-edge-junctions.js';
import { buildRegions, selectRegions, mergeRegions, regionShape } from './regions.js';
const EPS = 1e-5;
class Polygon {
    constructor(vertices, tag, vertexTolerance=EPS) {
        this.vertexTolerance=vertexTolerance;
        this.vertices = vertices.filter((v, i) => v.distanceToSquared(vertices[(i + vertices.length - 1) % vertices.length]) > vertexTolerance * vertexTolerance);
        this.tag = tag;
        this.normal = new CAD.Vector3();
        // Splitting can introduce collinear vertices; use the complete polygon normal.
        for (let i = 1; i < this.vertices.length-1; i++) this.normal.add(this.vertices[i].clone().sub(this.vertices[0]).cross(this.vertices[i+1].clone().sub(this.vertices[0])));
        this.normal.normalize();
        this.w = this.vertices.length ? this.normal.dot(this.vertices[0]) : 0;
    }
    clone() { return new Polygon(this.vertices.map(v => v.clone()), this.tag,this.vertexTolerance); }
    flip() { this.vertices.reverse(); this.normal.negate(); this.w = -this.w; }
}
class Node {
    constructor(polygons = [],epsilon=EPS) { this.epsilon=epsilon;this.polygons = []; this.front = null; this.back = null; this.normal = null; this.w = 0; if (polygons.length) this.build(polygons); }
    split(p, coplanarFront, coplanarBack, front, back) {
        let type = 0;
        const types = p.vertices.map(v => { const t = this.normal.dot(v) - this.w; const k = t < -this.epsilon ? 2 : t > this.epsilon ? 1 : 0; type |= k; return k; });
        if (!type) { (this.normal.dot(p.normal) > 0 ? coplanarFront : coplanarBack).push(p); return; }
        if (type === 1) { front.push(p); return; }
        if (type === 2) { back.push(p); return; }
        const f = [], b = [];
        for (let i = 0; i < p.vertices.length; i++) {
            const j = (i + 1) % p.vertices.length, vi = p.vertices[i], vj = p.vertices[j], ti = types[i], tj = types[j];
            if (ti !== 2) f.push(vi.clone());
            if (ti !== 1) b.push(vi.clone());
            if ((ti | tj) === 3) { const t = (this.w - this.normal.dot(vi)) / this.normal.dot(vj.clone().sub(vi)); const v = vi.clone().lerp(vj, t); f.push(v.clone()); b.push(v); }
        }
        for (const [vertices, target] of [[f, front], [b, back]]) {
            if (vertices.length < 3) continue;
            const polygon = new Polygon(vertices, p.tag,p.vertexTolerance);
            if (polygon.vertices.length >= 3 && polygon.normal.lengthSq() > .5) target.push(polygon);
        }
    }
    build(polygons) {
        const pending=[{node:this,polygons}];
        while(pending.length){const {node,polygons}=pending.pop();if(!polygons.length)continue;
            if(!node.normal){node.normal=polygons[0].normal.clone();node.w=polygons[0].w;}
            const front=[],back=[];for(const polygon of polygons)node.split(polygon,node.polygons,node.polygons,front,back);
            if(back.length){node.back??=new Node([],node.epsilon);pending.push({node:node.back,polygons:back});}
            if(front.length){node.front??=new Node([],node.epsilon);pending.push({node:node.front,polygons:front});}
        }
    }
    invert(){const pending=[this];while(pending.length){const node=pending.pop();for(const polygon of node.polygons)polygon.flip();node.normal?.negate();node.w=-node.w;[node.front,node.back]=[node.back,node.front];if(node.back)pending.push(node.back);if(node.front)pending.push(node.front);}}
    clipPolygons(polygons){
        const pending=[{node:this,polygons}],result=[];
        while(pending.length){const {node,polygons}=pending.pop();if(!polygons.length)continue;if(!node.normal){for(const polygon of polygons)result.push(polygon);continue;}
            const front=[],back=[];for(const polygon of polygons)node.split(polygon,front,back,front,back);
            if(node.back&&back.length)pending.push({node:node.back,polygons:back});
            if(node.front&&front.length)pending.push({node:node.front,polygons:front});else if(!node.front)for(const polygon of front)result.push(polygon);
        }return result;
    }
    clipTo(other){const pending=[this];while(pending.length){const node=pending.pop();node.polygons=other.clipPolygons(node.polygons);if(node.back)pending.push(node.back);if(node.front)pending.push(node.front);}}
    all(){const pending=[this],result=[];while(pending.length){const node=pending.pop();for(const polygon of node.polygons)result.push(polygon);if(node.back)pending.push(node.back);if(node.front)pending.push(node.front);}return result;}

}
function boolean(a, b, subtract,epsilon=EPS) {
    const A = new Node(a.map(p => p.clone()),epsilon), B = new Node(b.map(p => p.clone()),epsilon);
    if (subtract) A.invert();
    A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert(); A.build(B.all());
    if (subtract) A.invert();
    return A.all().filter(p => p.normal.lengthSq() > .5);
}
function sewBoundary(polygons){
    const tolerance=1e-8,buckets=new Map(),faces=new Map();let nextVertexId=0;
    const vertex=point=>{const x=Math.floor(point.x/tolerance),y=Math.floor(point.y/tolerance),z=Math.floor(point.z/tolerance);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++)for(const candidate of buckets.get(`${x+i}/${y+j}/${z+k}`)??[])if(candidate.point.distanceToSquared(point)<=tolerance*tolerance)return candidate;
        const key=`${x}/${y}/${z}`,entry={point:point.clone(),id:nextVertexId++};if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(entry);return entry;};
    for(const source of polygons){const entries=source.vertices.map(vertex),polygon=new Polygon(entries.map(entry=>entry.point),source.tag,source.vertexTolerance);if(polygon.vertices.length<3||polygon.normal.lengthSq()<.5)continue;
        const key=[...new Set(entries.map(entry=>entry.id))].sort().join('|'),other=faces.get(key);
        if(!other)faces.set(key,polygon);else if(other.normal.dot(polygon.normal)<-.999999)faces.delete(key);
    }
    return [...faces.values()];
}
// Export tool construction shares the displayed edge references. The worker
// materializes these tools using the dedicated manifold mesh kernel.
export function exportEdgeTools(feature,edges,stock=[]){
    const tools=[],profiles=rimBevelProfiles(edges,feature),joints=exportEdgeJunctions(profiles,feature,stock);
    for(const [index,source] of profiles.entries()){
        const edge=source.bevelProfile?{...source,topologyProfile:{first:source.bevelProfile.scale,second:source.bevelProfile.scale*source.bevelProfile.ratio}}:source;
        const tool=chamferFaces([],{...feature,exportSegments:32},{...edge,exportEndJunctions:joints[index]}).map(face=>new Polygon(face.vertices,{featureId:feature.id,face:face.face==='curved'?'curved':`export|${index}|${face.face}`,smooth:face.smooth},1e-8));
        tool.endDomains=[];
        for(let side=0;side<2;side++){
            const cap=joints[index][side];if(!cap?.domain)continue;
            const frame=edge.kind==='curve'?edge.frames[side?edge.frames.length-1:0]:null,axis=frame?frame.normalA.clone().cross(frame.normalB).normalize():edge.b.clone().sub(edge.a).normalize();
            if(Math.abs(axis.dot(cap.normal))>=1e-8)continue;
            const interior=edge.kind==='curve'?edge.frames[side?edge.frames.length-2:1].point.clone().sub(cap.origin):(side?edge.a:edge.b).clone().sub(cap.origin),normal=cap.normal.clone();
            if(normal.dot(interior)>0)normal.negate();tool.endDomains.push({normal,w:normal.dot(cap.origin)});
        }
        tools.push(tool);
    }
    return tools;
}
export function closeExportSolid(polygons){
    // Export needs the existing BSP boundaries welded and validated, not a
    // second hull merge / planar reconstruction before its own triangulation.
    try{return sewTopologyBevel(sewBoundary(polygons),Polygon,false,true);}
    catch(error){throw new Error('导出网格未闭合：'+error.message,{cause:error});}
}
export function exportOperationTools(document,feature){
    const operand=featurePolygons(document,feature);
    return feature.mode==='chamfer'?geometryState(document).context.ends.get(feature.id).operands:[operand];
}
const vec = (x = 0, y = 0, z = 0) => new CAD.Vector3(x, y, z);
function frame(o, u, v) { return { o, u, v, n: u.clone().cross(v).normalize() }; }
export function world(f, x, y, z = 0) { return f.o.clone().addScaledVector(f.u, x).addScaledVector(f.v, y).addScaledVector(f.n, z); }
const states = new WeakMap();
const solidCache=new Map();
let cachedVertices=0,lastSolidResult=null,retainedDocumentState=null;
// Constraint solving visits historical prefixes. That must not evict the current
// completed fillet and force another full boolean when returning to the document.
export function retainDocumentSolid(doc){retainedDocumentState=geometryState(doc);}
export function releaseDocumentSolid(){retainedDocumentState=null;}
export const entityGeometry=e=>[e.id,e.kind,e.x,e.y,e.width,e.height,e.radius,e.angle??0,e.sides??6,e.startAngle??0,e.sweepAngle??90,!!e.construction];
export const sketchGeometry=s=>JSON.stringify([s.plane,s.entities.map(entityGeometry)]);
const featureSketchIds=f=>[f.sketchId,f.pathSketchId,f.axisSketchId,...(f.sections??[]).map(s=>s.sketchId)].filter(Boolean);
function sketchDependencies(doc,ids){const result=new Set(ids),pending=[...ids];while(pending.length){const parent=doc.sketches.find(s=>s.id===pending.pop())?.plane.sourceSketchId;if(parent&&!result.has(parent)){result.add(parent);pending.push(parent);}}return [...result];}
export const featureDependsOnSketch=(doc,feature,id)=>sketchDependencies(doc,featureSketchIds(feature)).includes(id);
const featureGeometry=({appearanceSourceId,...feature})=>feature;
export const documentGeometry=doc=>{const physical=doc.features.filter(f=>!(f.mode==='chamfer'&&f.visualOnly)),consumed=new Set(sketchDependencies(doc,physical.flatMap(featureSketchIds)));return JSON.stringify([physical.map(featureGeometry),doc.sketches.filter(s=>consumed.has(s.id)).map(s=>[s.id,sketchGeometry(s)])]);};
function rememberSolid(key,state){
    if(solidCache.has(key))cachedVertices-=solidCache.get(key).cost;
    const cost=state.solid.reduce((sum,p)=>sum+p.vertices.length,0);
    solidCache.delete(key);solidCache.set(key,{...state,cost});cachedVertices+=cost;
    while(solidCache.size>1&&(solidCache.size>24||cachedVertices>200000)){
        const oldest=solidCache.keys().next().value;cachedVertices-=solidCache.get(oldest).cost;solidCache.delete(oldest);
    }
}

function geometryState(doc) {
    const key = documentGeometry(doc);
    let state = states.get(doc);
    if (!state || state.key !== key) { buildSolid(doc); state = states.get(doc); }
    return state;
}
function selectedShapes(sketch, feature) {
    return feature.regionKeys?.length ? mergeRegions(selectRegions(sketch, feature.regionKeys)).map(regionShape) : [profileShape(sketch.entities.find(e => e.id === feature.profileId))];
}
// Keep the clicked connected face region, including its holes, as a live reference.
export function loftFaceSection(doc,reference,x,y,solid,context=null){
    if(reference?.face==='curved'||!solid.some(p=>p.tag.featureId===reference?.featureId&&p.tag.face===reference.face))throw new Error('放样截面面已失效，请重新选择实体平面。');
    const basis=resolvePlane(doc,reference,new Map(),context),segments=faceBoundarySegments(coplanarFaces(solid,basis),basis);
    const sketch={id:'loft-face',plane:reference,entities:segments.map(({a,b},i)=>({id:'face-edge-'+i,kind:'line',x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y,construction:false}))};
    const inside=(p,points)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
    const point={x,y},regions=buildRegions(sketch),region=regions.find(r=>inside(point,r.outer.points)&&!r.holes.some(h=>inside(point,h.points)));
    if(!region)throw new Error('所选实体面区域已改变，请点击面内部重新选择放样截面。');
    return {sketch,shape:regionShape(region)};
}
function profilePoints(sketch, feature) {
    return selectedShapes(sketch, feature).flatMap(s => [s.getPoints(64), ...s.holes.map(h => h.getPoints(64))].flat());
}
// Resolve limits against the solid immediately before this feature. This is
// recomputed on regeneration; through-all is not a stored arbitrary long depth.
function resolveEnd(doc, feature, before, context) {
    if(feature.mode==='chamfer'){
        const raw=(feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge]).map(reference=>resolveChamferEdge(before,reference)),edges=feature.topologyBevel?bevelControlCage(raw,feature):raw,edge=edges[0],base=frame(edge.a.clone().add(edge.b).multiplyScalar(.5),edge.b.clone().sub(edge.a).normalize(),edge.normalA.clone().cross(edge.b.clone().sub(edge.a).normalize()));
        if(!Number.isFinite(feature.depth)||feature.depth<.1)throw new Error('半径或倒角距离必须是大于等于 0.1 mm 的有限数值。');
        const width=feature.topologyBevel?topologyBevelWidth(feature,edges):{distance:feature.depth,maximum:Infinity};
        return {base,sign:1,height:()=>width.distance,min:width.distance,max:width.distance,maximum:width.maximum,topologyEndPlanes:feature.topologyBevel?topologyBevelEndPlanes(before,{...feature,depth:width.distance},edges):null,mode:'chamfer',edge,edges,surfaces:new Map()};
    }
    if(feature.mode&&feature.mode!=='extrude'){
        if(feature.endCondition&&feature.endCondition!=='blind')throw new Error('此特征请使用自身的生成参数。');
        if(feature.mode==='revolve'&&(!Number.isFinite(feature.angle)||feature.angle<1||feature.angle>360))throw new Error('旋转角度范围为 1–360 度。');
        const source=doc.sketches.find(s=>s.id===feature.sketchId),base=resolvePlane(doc,source.plane,new Map(),context);
        let axisLine=feature.mode==='revolve'&&feature.axisModelEdge?resolveSolidEdge(before,feature.axisModelEdge):null;
        if(feature.mode==='revolve'&&feature.axisEntityId){const axisSketch=doc.sketches.find(s=>s.id===(feature.axisSketchId??feature.sketchId)),line=axisSketch?.entities.find(e=>e.id===feature.axisEntityId);const edge=line?rotationEdges(line).find(edge=>edge.index===(feature.axisEdgeIndex??0)):null;if(!edge)throw new Error('旋转参照直边已失效，请重新选择。');const basis=resolvePlane(doc,axisSketch.plane,new Map(),context);axisLine={a:world(basis,...edge.a),b:world(basis,...edge.b)};}

        const faceSections=feature.mode==='loft'?(feature.sections??[]).map(section=>section.face?loftFaceSection(doc,section.face,section.faceX,section.faceY,before,context):null):[];
        return {base,axisLine,faceSections,sign:1,height:()=>feature.depth,min:feature.mode==='revolve'?feature.angle:feature.depth,max:feature.mode==='revolve'?feature.angle:feature.depth,mode:feature.mode,surfaces:new Map()};
    }
    const sketch = doc.sketches.find(s => s.id === feature.sketchId);
    const base = resolvePlane(doc, sketch.plane, new Map(), context);
    const sign = (feature.kind === 'cut' ? -1 : 1) * (feature.reversed ? -1 : 1);
    const direction = base.n.clone().multiplyScalar(sign);
    const mode = feature.endCondition ?? 'blind';
    let target = null, depth = feature.depth;
    if (mode === 'throughAll') {
        if (!before.length) throw new Error('贯穿全部需要已有实体，请为首个实体指定距离。');
        let far = -Infinity;
        const box = new CAD.Box3();
        for (const polygon of before) for (const v of polygon.vertices) { box.expandByPoint(v); far = Math.max(far, v.clone().sub(base.o).dot(direction)); }
        if (far <= EPS) throw new Error('当前方向没有可贯穿的实体，请勾选反向或更换草图面。');
        depth = far + Math.max(1, box.getSize(vec()).length() * .01);
    } else if (mode === 'upToFace') {
        const ref = feature.targetFace;
        if (!ref?.featureId) throw new Error('请点击“选择终止面”，然后在实体上选择一个平面。');
        if (!before.some(p => p.tag.featureId === ref.featureId && p.tag.face === ref.face)) throw new Error('所选终止面已不存在，请重新选择。');
        if (ref.face === 'curved') throw new Error('目前只能选择平面作为终止面。');
        target = resolvePlane(doc, ref, new Map(), context);
        if (Math.abs(target.n.dot(direction)) < 1e-6) throw new Error('终止面与拉伸方向平行，无法确定终止位置。');
    } else if (mode !== 'blind') throw new Error('不支持的特征终止条件。');
    const height = (x, y) => target ? target.o.clone().sub(world(base, x, y)).dot(target.n) / direction.dot(target.n) : depth;
    const points = profilePoints(sketch, feature);
    let min = Infinity, max = -Infinity;
    for (const p of points) { const d = height(p.x, p.y); min = Math.min(min, d); max = Math.max(max, d); }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= EPS) throw new Error('终止面位于当前方向背面或与草图相交，请反向或更换终止面。');
    return { base, sign, height, target, min, max, mode };
}
export function featureEndInfo(doc, feature) {
    const state = geometryState(doc);
    const end = state.context.ends.get(feature.id) ?? resolveEnd(doc, feature, state.solid, state.context);
    return { valid: true, min: end.min, max: end.max, message: end.mode==='revolve'?'按所选旋转轴与角度生成特征':end.mode==='sweep'?(feature.thinWall?'开放截面按壁厚加厚后沿路径扫描':'封闭截面沿路径扫描，路径无需闭合'):end.mode==='loft'?'按截面顺序生成放样特征':end.mode==='chamfer'?'按等距离切除所选直线棱边':end.mode === 'throughAll' ? '按当前实体范围自动贯穿全部' : end.mode === 'upToFace' ? '沿拉伸方向终止于所选平面' : '按指定距离生成特征' };
}
export function resolvePlane(doc, plane, cache = new Map(), context = null) {
    if(plane?.sourceSketchId){
        const key='center-plane/'+plane.sourceSketchId;if(cache.has(key))throw new Error('中心路径平面存在循环引用。');cache.set(key,true);
        const source=doc.sketches.find(s=>s.id===plane.sourceSketchId);if(!source)throw new Error('中心路径引用的截面草图已删除。');
        const base=resolvePlane(doc,source.plane,cache,context),shapes=selectedShapes(source,{regionKeys:plane.centerRegionKeys});
        if(shapes.length!==1)throw new Error('中心路径需要一个连通闭合截面。');
        const center=new CAD.Box2().setFromPoints(shapes[0].getPoints(64)).getCenter(new CAD.Vector2());
        cache.delete(key);return frame(world(base,center.x,center.y),base.u.clone(),base.n.clone());
    }
    if (!plane?.featureId) {
        switch (plane?.reference ?? 'XY') {
            case 'XZ': {const result=frame(vec(),vec(1,0,0),vec(0,0,1));result.o.addScaledVector(result.n,plane?.offset??0);return result;}
            case 'YZ': {const result=frame(vec(),vec(0,1,0),vec(0,0,1));result.o.addScaledVector(result.n,plane?.offset??0);return result;}
            default: {const result=frame(vec(), vec(1, 0, 0), vec(0, 1, 0));result.o.addScaledVector(result.n,plane?.offset??0);return result;}
        }
    }
    const key = plane.featureId + '/' + plane.face;
    if (cache.has(key)) return cache.get(key);
    const feature = doc.features.find(f => f.id === plane.featureId);
    if (!feature) throw new Error('草图依附特征不存在。');
    context ??= geometryState(doc).context;
    const end = context.ends.get(feature.id);
    if (!end) throw new Error('依附面必须来自已重建的更早特征。');
    if(feature.mode&&feature.mode!=='extrude'){const surface=end.surfaces?.get(plane.face);if(!surface)throw new Error('该曲面不能承载平面草图，或原平面已失效。');cache.set(key,surface);return surface;}
    const sketch = doc.sketches.find(s => s.id === feature.sketchId);
    let e = sketch.entities.find(e => e.id === feature.profileId);
    const base = resolvePlane(doc, sketch.plane, cache, context);
    const sign = end.sign;
    let cx, cy;
    if (feature.regionKeys?.length) {
        const regions = selectRegions(sketch, feature.regionKeys);
        const points = regions.flatMap(r => r.outer.points);
        const center = new CAD.Box2().setFromPoints(points).getCenter(new CAD.Vector2());
        cx = center.x; cy = center.y;
    } else { cx = ['circle','arc','polygon'].includes(e.kind) ? e.x : e.x + e.width / 2; cy = ['circle','arc','polygon'].includes(e.kind) ? e.y : e.y + e.height / 2; }
    let result;
    if (plane.face === 'top' || plane.face === 'bottom') {
        const top = plane.face === 'top';
        const capSign = feature.reversed ? -1 : 1;
        if (top && end.target) {
            const normal = end.target.n.clone(); if (normal.dot(base.n) * capSign < 0) normal.negate();
            const dx = end.height(cx + 1, cy) - end.height(cx, cy);
            const u = base.u.clone().addScaledVector(base.n, sign * dx).normalize();
            result = frame(world(base, cx, cy, sign * end.height(cx, cy)), u, normal.clone().cross(u));
        } else result = frame(world(base, cx, cy, top ? sign * end.height(cx, cy) : 0), base.u.clone(), base.v.clone().multiplyScalar((top ? 1 : -1) * capSign));
    } else {
        let sideSign = 1;
        let i;
        if (plane.face.startsWith('edge|')) {
            const parts = plane.face.split('|'); e = sketch.entities.find(e => e.id === parts[1]); i = Number(parts[2]); sideSign = Number(parts[3]);
        } else i = Number(plane.face.replace('side', ''));
        if (e?.kind !== 'rectangle' && !(e?.kind==='slot'&&(i===0||i===2)) && !(e?.kind==='line'&&!e.construction&&i===0) && !(e?.kind==='polygon'&&i>=0&&i<e.sides)) throw new Error('曲面不能承载平面草图。');
        cx = e.x + e.width / 2; cy = e.y + e.height / 2;
        if(e.kind==='line'||e.kind==='polygon'){
            const points=e.kind==='polygon'?outline(e):[[e.x,e.y],[e.x+e.width,e.y+e.height]],a=points[e.kind==='polygon'?i:0],b=points[e.kind==='polygon'?i+1:1];cx=(a[0]+b[0])/2;cy=(a[1]+b[1])/2;
            const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),u=base.u.clone().multiplyScalar(dx/length).addScaledVector(base.v,dy/length),normal=u.clone().cross(base.n).multiplyScalar((feature.kind==='cut'?-1:1)*sideSign);
            result=frame(world(base,cx,cy,sign*end.height(cx,cy)/2),u,normal.clone().cross(u));cache.set(key,result);return result;
        }
        const centers = [[cx, e.y], [e.x + e.width, cy], [cx, e.y + e.height], [e.x, cy]].map(p=>slotToWorld(e,p));
        if (!centers[i]) throw new Error('无效的草图依附面。');
        const angle=(e.kind==='slot'?e.angle??0:0)*Math.PI/180;
        const axisU=base.u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(base.v,Math.sin(angle)),axisV=base.v.clone().multiplyScalar(Math.cos(angle)).addScaledVector(base.u,-Math.sin(angle));
        const u = [axisU,axisV,axisU.clone().negate(),axisV.clone().negate()][i];
        const normal = u.clone().cross(base.n).multiplyScalar((feature.kind === 'cut' ? -1 : 1) * sideSign);
        result = frame(world(base, ...centers[i], sign * end.height(...centers[i]) / 2), u, normal.clone().cross(u));
    }
    cache.set(key, result); return result;
}
export function profileShape(e) {
    const s = new CAD.Shape();
    if (e.kind === 'circle') s.absarc(e.x, e.y, e.radius, 0, Math.PI * 2, false);
    else { const points=outline(e);s.moveTo(...points[0]);for(const p of points.slice(1))s.lineTo(...p);s.closePath(); }
    return s;
}
export function featurePolygons(doc, feature, context = null) {
    const sketch = doc.sketches.find(s => s.id === feature.sketchId), e = sketch.entities.find(e => e.id === feature.profileId);
    if (!context) { const state = geometryState(doc); context = { ends: new Map(state.context.ends) }; if (!context.ends.has(feature.id)) context.ends.set(feature.id, resolveEnd(doc, feature, state.solid, context)); }
    const end = context.ends.get(feature.id);
    if(feature.mode&&feature.mode!=='extrude'){
        let faceGroups;
        if(feature.mode==='chamfer'){
            const actual={...feature,depth:end.max};let tools=end.edges.map(edge=>chamferFaces([],actual,edge));
            if(feature.topologyBevel)tools=topologyBevelTools([],actual,end.edges,tools,end.topologyEndPlanes);
            faceGroups=tools.map((faces,index)=>faces.map(face=>({...face,face:face.face.startsWith('surface|')?'surface|'+index+'|'+face.face:face.face==='curved'?'curved':face.face+'|'+index})));
        }else faceGroups=[advancedFaces(doc,feature,{shapes:selectedShapes,resolve:(document,plane)=>resolvePlane(document,plane,new Map(),context),world,axisLine:end.axisLine,faceSections:end.faceSections})];
        const operands=faceGroups.map(faces=>faces.map(face=>new Polygon(face.vertices,{featureId:feature.id,face:face.face,smooth:face.smooth},feature.topologyBevel?1e-8:EPS)).filter(p=>p.normal.lengthSq()>.5));
        // A \ (B union C) = (A \ B) \ C. Avoid constructing a huge union of
        // overlapping fillet tools before clipping the actual solid.
        const polygons=operands.flat();if(feature.mode==='chamfer')end.operands=operands;
        const planarGroups=[];
        for(const polygon of polygons){if(!polygon.tag.face.startsWith('surface|'))continue;const same=planarGroups.find(p=>p.normal.dot(polygon.normal)>.999999&&Math.abs(p.w-polygon.w)<EPS);if(same)polygon.tag.face=same.tag.face;else planarGroups.push(polygon);}
        end.surfaces=new Map();
        const groups=new Map();for(const polygon of polygons){if(polygon.tag.face==='curved')continue;if(!groups.has(polygon.tag.face))groups.set(polygon.tag.face,[]);groups.get(polygon.tag.face).push(polygon);}
        for(const [name,faces] of groups){const polygon=faces[0],n=polygon.normal.clone().multiplyScalar(feature.kind==='cut'?-1:1),box=new CAD.Box3();for(const face of faces)for(const point of face.vertices)box.expandByPoint(point);const center=box.getCenter(vec());center.addScaledVector(n,-center.clone().sub(polygon.vertices[0]).dot(n));
            let u=end.base.u.clone().addScaledVector(n,-end.base.u.dot(n));if(u.lengthSq()<1e-6)u=end.base.v.clone().addScaledVector(n,-end.base.v.dot(n));u.normalize();end.surfaces.set(name,frame(center,u,n.clone().cross(u)));
        }
        return polygons;
    }
    const f = end.base, sign = end.sign;
    const shapes = selectedShapes(sketch, feature);
    const geometry = new CAD.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, curveSegments: 64 });
    const p = geometry.attributes.position, result = [];
    for (let i = 0; i < p.count; i += 3) {
        const local = [0, 1, 2].map(j => vec().fromBufferAttribute(p, i + j));
        const normal = local[1].clone().sub(local[0]).cross(local[2].clone().sub(local[0])).normalize();
        let face = normal.z > .9 ? 'top' : normal.z < -.9 ? 'bottom' : 'curved';
        if (face === 'curved' && !feature.regionKeys?.length && e.kind === 'rectangle') face = normal.y < -.9 ? 'side0' : normal.x > .9 ? 'side1' : normal.y > .9 ? 'side2' : 'side3';
        else if (face === 'curved' && (feature.regionKeys?.length||e.kind==='slot'||e.kind==='polygon')) {
            const middle = local[0].clone().add(local[1]).add(local[2]).divideScalar(3);
            for (const source of sketch.entities.filter(e => !e.construction&&(e.kind === 'rectangle'||e.kind==='slot'||e.kind==='line'||e.kind==='polygon'))) {
                if(source.kind==='polygon'){
                    const points=outline(source);
                    for(let edge=0;edge<source.sides;edge++){
                        const a=points[edge],b=points[edge+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),tx=dx/length,ty=dy/length,distance=Math.abs((middle.x-a[0])*-ty+(middle.y-a[1])*tx),along=(middle.x-a[0])*tx+(middle.y-a[1])*ty,alignment=normal.x*ty-normal.y*tx;
                        if(distance<1e-4&&along>=-1e-4&&along<=length+1e-4&&Math.abs(alignment)>.999){face=`edge|${source.id}|${edge}|${alignment>0?1:-1}`;break;}
                    }
                    if(face!=='curved')break;continue;
                }
                if(source.kind==='line'){
                    const length=Math.hypot(source.width,source.height),tx=source.width/length,ty=source.height/length;
                    const distance=Math.abs((middle.x-source.x)*-ty+(middle.y-source.y)*tx),along=(middle.x-source.x)*tx+(middle.y-source.y)*ty,alignment=normal.x*ty-normal.y*tx;
                    if(distance<1e-4&&along>=-1e-4&&along<=length+1e-4&&Math.abs(alignment)>.999){face=`edge|${source.id}|0|${alignment>0?1:-1}`;break;}
                    continue;
                }
                const [mx,my]=slotToLocal(source,[middle.x,middle.y]),angle=(source.kind==='slot'?source.angle??0:0)*Math.PI/180;
                const nx=normal.x*Math.cos(angle)+normal.y*Math.sin(angle),ny=-normal.x*Math.sin(angle)+normal.y*Math.cos(angle);
                const sides = [
                    { distance: Math.abs(my-source.y), alignment: -ny },
                    { distance: Math.abs(mx-source.x-source.width), alignment: nx },
                    { distance: Math.abs(my-source.y-source.height), alignment: ny },
                    { distance: Math.abs(mx-source.x), alignment: -nx }
                ];
                const index = sides.findIndex((s,i) => (source.kind!=='slot'||i===0||i===2)&&s.distance < 1e-4 && Math.abs(s.alignment) > .999);
                if (index >= 0) { face = `edge|${source.id}|${index}|${sides[index].alignment > 0 ? 1 : -1}`; break; }
            }
        }
        const vertices = local.map(v => world(f, v.x, v.y, sign * v.z * end.height(v.x, v.y)));
        if (sign < 0) [vertices[1], vertices[2]] = [vertices[2], vertices[1]];
        let smooth=null;
        if(face==='curved'){
            const circle=sketch.entities.find(source=>!source.construction&&source.kind==='circle'&&local.every(point=>Math.abs(Math.hypot(point.x-source.x,point.y-source.y)-source.radius)<Math.max(1e-4,source.radius*1e-5)));
            if(circle)smooth={kind:'cylinder',center:world(f,circle.x,circle.y),axis:f.n};
            if(!circle){
                const slot=sketch.entities.find(source=>!source.construction&&source.kind==='slot'&&local.every(point=>{const [x,y]=slotToLocal(source,[point.x,point.y]),r=source.height/2,cx=Math.max(source.x+r,Math.min(source.x+source.width-r,x));return Math.abs(Math.hypot(x-cx,y-source.y-r)-r)<Math.max(1e-4,r*1e-5);}));
                if(slot){const r=slot.height/2,a=slotToWorld(slot,[slot.x+r,slot.y+r]),b=slotToWorld(slot,[slot.x+slot.width-r,slot.y+r]);smooth={kind:'capsule',start:world(f,...a),end:world(f,...b),axis:f.n};}
            }
        }
        const polygon = new Polygon(vertices, { featureId: feature.id, face,smooth });
        if (polygon.normal.lengthSq() > .5) result.push(polygon);
    }
    geometry.dispose(); return result;
}
export function featureSweepGuide(doc,feature){
    const context=geometryState(doc).context;
    return sweepGuideData(doc,feature,{shapes:selectedShapes,resolve:(document,plane)=>resolvePlane(document,plane,new Map(),context),world});
}
export function volume(polygons) {
    let value = 0;
    for (const p of polygons) for (let i = 1; i < p.vertices.length - 1; i++) value += p.vertices[0].dot(p.vertices[i].clone().cross(p.vertices[i + 1])) / 6;
    return Math.abs(value);
}
export function buildSolid(doc) {
    const key=documentGeometry(doc),own=states.get(doc);
    if(own?.key===key){lastSolidResult=own;return own.solid;}
    if(doc.features.some(f=>f.mode==='chamfer'&&f.visualOnly)){
        const base={...doc,features:doc.features.filter(f=>!(f.mode==='chamfer'&&f.visualOnly))},solid=buildSolid(base),state=geometryState(base);
        states.set(doc,state);return solid;
    }
    const cached=lastSolidResult?.key===key?lastSolidResult:retainedDocumentState?.key===key?retainedDocumentState:null;
    if(cached){states.set(doc,{...cached,key});return cached.solid;}
    let solid=[],prefixKey='',start=0;
    const context={ends:new Map()},prefixes=[];
    for(let i=0;i<doc.features.length;i++){
        const feature=doc.features[i],source=doc.sketches.find(s=>s.id===feature.sketchId);
        prefixKey+=JSON.stringify([featureGeometry(feature),sketchDependencies(doc,featureSketchIds(feature)).map(id=>{const sketch=doc.sketches.find(s=>s.id===id);if(!sketch)throw new Error("特征引用的草图已不存在。");return [id,sketchGeometry(sketch)];})]);prefixes.push(prefixKey);
        const cachedPrefix=solidCache.get(prefixKey)??(retainedDocumentState?.prefixKey===prefixKey?retainedDocumentState:null);
        if(cachedPrefix){solid=cachedPrefix.solid;context.ends=new Map(cachedPrefix.context.ends);start=i+1;}
    }
    for(let featureIndex=start;featureIndex<doc.features.length;featureIndex++){
        const feature=doc.features[featureIndex],source=doc.sketches.find(s=>s.id===feature.sketchId);prefixKey=prefixes[featureIndex];
        try {
        if (feature.mode!=="chamfer" && source.plane.featureId && !solid.some(p => p.tag.featureId === source.plane.featureId && p.tag.face === source.plane.face))
            throw new Error('草图依附面已被更早的特征移除，请重新选择承载面。');
        if(feature.mode==='chamfer'&&feature.visualOnly){
            const end=resolveEnd(doc,feature,solid,context);context.ends.set(feature.id,end);
            rememberSolid(prefixKey,{solid,context:{ends:new Map(context.ends)}});continue;
        }
        context.ends.set(feature.id, resolveEnd(doc, feature, solid, context));
        const operand = featurePolygons(doc, feature, context);
        const before = volume(solid);
        if (!solid.length && feature.kind === 'cut') throw new Error('切除需要已有实体。');
        let clipped=solid,alreadySewn=false;
        if(feature.mode==='chamfer'){
            const tools=context.ends.get(feature.id).operands;
            if(feature.topologyBevel){
                alreadySewn=true;
                const selected=context.ends.get(feature.id).edges;
                clipped=connectedBodies(solid).flatMap(body=>{
                    const target=selected.some(edge=>body.box.clone().expandByScalar(1e-6).containsPoint(edge.a.clone().add(edge.b).multiplyScalar(.5))&&body.polygons.some(p=>[edge.faceA,edge.faceB].some(ref=>p.tag.featureId===ref.featureId&&p.tag.face===ref.face)));
                    if(!target)return body.polygons;
                    let part=body.polygons.map(p=>new Polygon(p.vertices,p.tag,1e-8));
                    for(const tool of tools){const box=new CAD.Box3().setFromPoints(tool.flatMap(p=>p.vertices));if(body.box.intersectsBox(box))part=boolean(part,tool.map(p=>new Polygon(p.vertices,p.tag,1e-8)),true,1e-8);}
                    return sewTopologyBevel(sewBoundary(part),Polygon);
                });
            }else for(const tool of tools)clipped=boolean(clipped,tool,true);
        }
        else if(solid.length){
            // A distant body cannot participate in this operation. Keeping it
            // out of the BSP also avoids subdividing all of its faces by the
            // new tool's infinite supporting planes.
            const bounds=new CAD.Box3();for(const polygon of operand)for(const point of polygon.vertices)bounds.expandByPoint(point);bounds.expandByScalar(EPS);
            const affected=[],unchanged=[];
            for(const body of connectedBodies(solid)){
                const target=body.box.intersectsBox(bounds)?affected:unchanged;
                for(const polygon of body.polygons)target.push(polygon);
            }
            if(!affected.length)clipped=feature.kind==='cut'?solid:[...solid,...sewBoundary(operand)];
            else{
                const changed=sewBoundary(boolean(affected,operand,feature.kind==='cut'));
                clipped=[...unchanged,...changed];
            }
            alreadySewn=true;
        }else clipped=operand;
        const next=alreadySewn?clipped:sewBoundary(clipped);
        const after = volume(next);
        if (feature.kind === 'cut' && before - after < .001) throw new Error('切除轮廓未与实体相交，请检查草图位置和切除深度。');
        if (after < .001) throw new Error('此操作将移除整个实体，请减小切除范围或深度。');
        solid = recordBodyHistory(next,solid,operand,feature.id);
        } catch(error) {
            const label=feature.mode==='chamfer'?(feature.edgeTreatment==='fillet'?'圆角':'倒角'):feature.mode??'extrude';
            throw new Error(`第 ${featureIndex+1} 项特征（${label}，${feature.id}）重建失败：${error.message}`,{cause:error});
        }
        rememberSolid(prefixKey,{solid,context:{ends:new Map(context.ends)}});
    }
    lastSolidResult={key,solid,context,prefixKey:prefixes.at(-1)??''};
    states.set(doc,lastSolidResult);
    return solid;
}
const smoothSurfaceCache=new WeakMap();
function smoothSurfaceNormals(polygons){
    if(smoothSurfaceCache.has(polygons))return smoothSurfaceCache.get(polygons);
    const vertices=new Map(),key=(p,v)=>p.tag.featureId+'/'+[v.x,v.y,v.z].map(n=>Math.round(n/1e-5)).join('/');
    for(const p of polygons){if(p.tag.face!=='curved'||p.tag.smooth)continue;const area=new CAD.Vector3();for(let i=1;i<p.vertices.length-1;i++)area.add(p.vertices[i].clone().sub(p.vertices[0]).cross(p.vertices[i+1].clone().sub(p.vertices[0])));const entry={normal:p.normal,weight:Math.max(1e-8,area.length())};
        for(const v of p.vertices){const id=key(p,v);if(!vertices.has(id))vertices.set(id,[]);vertices.get(id).push(entry);}}
    const result=(p,v)=>{if(p.tag.face!=='curved')return p.normal;
        const surface=p.tag.smooth;
        if(surface?.kind==='patch'){const weights=new CAD.Vector3();CAD.Triangle.getBarycoord(v,...surface.points,weights);const normal=new CAD.Vector3();surface.normals.forEach((n,i)=>normal.addScaledVector(n,weights.getComponent(i)));if(normal.lengthSq()>1e-12){normal.normalize();if(normal.dot(p.normal)<0)normal.negate();return normal;}}
        else if(surface?.kind==='capsule'){
            const delta=v.clone().sub(surface.start),rail=surface.end.clone().sub(surface.start),length=rail.lengthSq(),t=length>1e-12?CAD.MathUtils.clamp(delta.dot(rail)/length,0,1):0;
            const normal=delta.addScaledVector(rail,-t);normal.addScaledVector(surface.axis,-normal.dot(surface.axis));
            if(normal.lengthSq()>1e-12){normal.normalize();if(normal.dot(p.normal)<0)normal.negate();return normal;}
        }
        else if(surface?.kind==='torus'){
            const delta=v.clone().sub(surface.center),planar=delta.clone().addScaledVector(surface.axis,-delta.dot(surface.axis));
            if(planar.lengthSq()>1e-12){const normal=delta.addScaledVector(planar.normalize(),-surface.majorRadius).normalize();if(normal.dot(p.normal)<0)normal.negate();return normal;}
        }
        else if(surface){const radial=v.clone().sub(surface.center);if(surface.kind==='cylinder')radial.addScaledVector(surface.axis,-radial.dot(surface.axis));if(radial.lengthSq()>1e-12){radial.normalize();if(radial.dot(p.normal)<0)radial.negate();return radial;}}
        const normal=new CAD.Vector3();for(const entry of vertices.get(key(p,v))??[])if(entry.normal.dot(p.normal)>.6)normal.addScaledVector(entry.normal,entry.weight);return normal.lengthSq()>0?normal.normalize():p.normal;};
    smoothSurfaceCache.set(polygons,result);return result;
}
function surfaceUvs(p,triangle,u,vAxis){
    const surface=p.tag.smooth;
    if(!surface||!['cylinder','torus'].includes(surface.kind))return triangle.map(v=>[v.dot(u),v.dot(vAxis)]);
    const axis=surface.axis,basis=(Math.abs(axis.z)<.8?vec(0,0,1):vec(0,1,0)).cross(axis).normalize(),across=axis.clone().cross(basis);
    const samples=triangle.map(v=>{const d=v.clone().sub(surface.center),height=d.dot(axis),radial=d.clone().addScaledVector(axis,-height),radius=radial.length();return {angle:Math.atan2(radial.dot(across),radial.dot(basis)),height,radius};});
    const reference=samples[0].angle;
    for(const sample of samples){while(sample.angle-reference>Math.PI)sample.angle-=2*Math.PI;while(sample.angle-reference< -Math.PI)sample.angle+=2*Math.PI;}
    if(surface.kind==='cylinder'){const radius=samples.reduce((sum,s)=>sum+s.radius,0)/3;return samples.map(s=>[s.angle*radius,s.height]);}
    const minor=samples.map(s=>Math.atan2(s.height,s.radius-surface.majorRadius)),base=minor[0];
    for(let i=0;i<minor.length;i++){while(minor[i]-base>Math.PI)minor[i]-=2*Math.PI;while(minor[i]-base< -Math.PI)minor[i]+=2*Math.PI;}
    const radius=samples.reduce((sum,s)=>sum+Math.hypot(s.height,s.radius-surface.majorRadius),0)/3;
    return samples.map((s,i)=>[s.angle*surface.majorRadius,minor[i]*radius]);
}
const materialOrderCache=new WeakMap();
export function solidGeometry(polygons,materialIndices=null) {
    if(materialIndices){let ordered=materialOrderCache.get(polygons);if(!ordered){ordered=[...polygons].sort((a,b)=>(materialIndices.get(a)??0)-(materialIndices.get(b)??0));materialOrderCache.set(polygons,ordered);}polygons=ordered;}
    const groups=[],normalAt=smoothSurfaceNormals(polygons);
    const positions = [], normals = [], tags = [],uvs=[],tangents=[];
    for (const p of polygons){const u=(Math.abs(p.normal.z)<.8?vec(0,0,1):vec(0,1,0)).cross(p.normal).normalize(),vAxis=p.normal.clone().cross(u).normalize();for (let i = 1; i < p.vertices.length - 1; i++) {
        const triangle = [p.vertices[0], p.vertices[i], p.vertices[i + 1]];
        if (triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).lengthSq() < 1e-12) continue;
        const textureCoordinates=surfaceUvs(p,triangle,u,vAxis);
        for (let corner=0;corner<3;corner++) {const v=triangle[corner]; positions.push(v.x, v.y, v.z); const n=normalAt(p,v);normals.push(n.x,n.y,n.z);
            // A projected world-X tangent has a pole on a cylinder. Switching
            // axes at that pole leaves a bright stripe in anisotropic metals.
            // Use the surface's continuous axial/circumferential frame instead.
            const surface=p.tag.smooth;
            const tangent=surface?.axis&&['cylinder','capsule','torus'].includes(surface.kind)
                ?surface.axis.clone().cross(surface.kind==='torus'?v.clone().sub(surface.center):n)
                :u.clone().addScaledVector(n,-u.dot(n));
            if(tangent.lengthSq()<1e-8)tangent.copy(vAxis).addScaledVector(n,-vAxis.dot(n));tangent.normalize();tangents.push(tangent.x,tangent.y,tangent.z,1);
            uvs.push(...textureCoordinates[corner]); }
        tags.push(p.tag);
        if(materialIndices){const index=materialIndices.get(p)??0,last=groups.at(-1);if(last?.materialIndex===index)last.count+=3;else groups.push({start:positions.length/3-3,count:3,materialIndex:index});}
    }
    }
    const geometry = new CAD.BufferGeometry();
    geometry.setAttribute('position', new CAD.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('tangent',new CAD.Float32BufferAttribute(tangents,4));
    geometry.setAttribute('normal', new CAD.Float32BufferAttribute(normals, 3));geometry.setAttribute('uv',new CAD.Float32BufferAttribute(uvs,2));
    for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);geometry.computeBoundingSphere(); return { geometry, tags,polygons };
}

// Coplanar faces from additive features form one visible support surface.
export function coplanarFaces(polygons,frame){
    return polygons.filter(p=>Math.abs(p.normal.dot(frame.n))>1-1e-6&&p.vertices.every(v=>Math.abs(v.clone().sub(frame.o).dot(frame.n))<1e-4));
}

export function validateSupportPlanes(doc){
    const state=geometryState(doc),cache=new Map();
    for(const sketch of doc.sketches)resolvePlane(doc,sketch.plane,cache,state.context);
}

// Transfer a validated geometry result between the worker and renderer. Functions
// are reconstructed explicitly; only plain data, vectors and Maps cross threads.
function packState(value){
    if(value?.isVector3)return {$cad:'v3',v:value.toArray()};
    if(value?.isVector2)return {$cad:'v2',v:value.toArray()};
    if(value instanceof Map)return {$cad:'map',v:[...value].map(([k,v])=>[k,packState(v)])};
    if(Array.isArray(value))return value.map(packState);
    if(value&&typeof value==='object'){const out={};for(const [key,item] of Object.entries(value))if(typeof item!=='function'&&key!=='operands')out[key]=packState(item);return out;}
    return value;
}
function unpackState(value){
    if(value?.$cad==='v3')return new CAD.Vector3(...value.v);
    if(value?.$cad==='v2')return new CAD.Vector2(...value.v);
    if(value?.$cad==='map')return new Map(value.v.map(([k,v])=>[k,unpackState(v)]));
    if(Array.isArray(value))return value.map(unpackState);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,unpackState(v)]));
    return value;
}
export function packExportEdges(edges){return packState(edges);}
export function unpackExportEdges(edges){return unpackState(edges);}
export function exportSolidState(doc,compact=false){
    const state=geometryState(doc);
    if(!compact)return {key:state.key,solid:packState(state.solid.map(p=>({vertices:p.vertices,tag:p.tag}))),ends:packState(state.context.ends)};
    // One typed buffer for coordinates and a shared tag table: BSP splits share
    // their source tag instead of cloning its analytic surface for every fragment.
    const offsets=new Uint32Array(state.solid.length+1),tagIds=new Uint32Array(state.solid.length),tags=[],table=new Map();
    let count=0;state.solid.forEach((p,i)=>{offsets[i]=count;count+=p.vertices.length;if(!table.has(p.tag)){table.set(p.tag,tags.length);tags.push(p.tag);}tagIds[i]=table.get(p.tag);});offsets[state.solid.length]=count;
    const positions=new Float64Array(count*3);let at=0;
    for(const p of state.solid)for(const v of p.vertices){positions[at++]=v.x;positions[at++]=v.y;positions[at++]=v.z;}
    return {key:state.key,format:'packed-mesh',positions,offsets,tagIds,tags:packState(tags),ends:packState(state.context.ends)};
}
export function importSolidState(doc,data){
    const key=documentGeometry(doc);if(key!==data.key)throw new Error('后台计算与当前项目不一致，请重新确认。');
    let solid;const vertexTolerance=doc.features.some(f=>f.topologyBevel)?1e-8:EPS;
    if(data.format==='packed-mesh'){
        const tags=unpackState(data.tags);solid=[];
        for(let i=0;i<data.tagIds.length;i++){const vertices=[];for(let j=data.offsets[i];j<data.offsets[i+1];j++)vertices.push(vec(data.positions[j*3],data.positions[j*3+1],data.positions[j*3+2]));solid.push(new Polygon(vertices,tags[data.tagIds[i]],vertexTolerance));}
    }else solid=unpackState(data.solid).map(p=>new Polygon(p.vertices,p.tag,vertexTolerance));
    const ends=unpackState(data.ends);
    for(const end of ends.values())end.height=(x,y)=>end.target?end.target.o.clone().sub(world(end.base,x,y)).dot(end.target.n)/end.base.n.clone().multiplyScalar(end.sign).dot(end.target.n):end.min;
    const last=doc.features.at(-1);if(last?.mode==='chamfer'&&!last.visualOnly){const end=ends.get(last.id);if(end){const distance=last.depth;end.min=end.max=distance;end.maximum=Infinity;end.height=()=>distance;featurePolygons(doc,last,{ends});}}
    const state={key,solid,context:{ends}};states.set(doc,state);lastSolidResult=state;retainedDocumentState=state;
    let prefixKey='';for(const feature of doc.features.filter(f=>!(f.mode==='chamfer'&&f.visualOnly)))prefixKey+=JSON.stringify([featureGeometry(feature),sketchDependencies(doc,featureSketchIds(feature)).map(id=>{const sketch=doc.sketches.find(s=>s.id===id);return [id,sketchGeometry(sketch)];})]);state.prefixKey=prefixKey;
    if(prefixKey)rememberSolid(prefixKey,state);
    return solid;
}
