import {slotToWorld,outline,radial} from './sketch-tools.js';
import {geometryValues,pointRows,pointValue,hasRelations} from './sketch-points.js';
import {buildSolid,resolvePlane,world,coplanarFaces,documentGeometry} from './geometry.js';
import {faceBoundarySegments} from './snapping.js';
const EPS=1e-4;
const sameFace=(a,b)=>a.featureId===b.featureId&&a.face===b.face;
const fractions=[[.5,0],[1,.5],[.5,1],[0,.5]];

// A straight model edge is the intersection of the support face and a second
// planar face. Referencing their identities survives parent size changes.
const modelEdgeResults=new Map();
export function modelEdges(doc,sketch,solid=null) {
    const cacheKey=documentGeometry(doc)+'/'+JSON.stringify(sketch.plane);
    if(modelEdgeResults.has(cacheKey))return modelEdgeResults.get(cacheKey);
    if(!sketch.plane.featureId)return [];
    solid??=buildSolid(doc);
    const frame=resolvePlane(doc,sketch.plane),face=coplanarFaces(solid,frame);
    const segments=faceBoundarySegments(face,frame),result=[];
    for(const segment of segments) {
        const middle=world(frame,(segment.a.x+segment.b.x)/2,(segment.a.y+segment.b.y)/2);
        let neighbor=null;
        for(const polygon of solid) {
            if(Math.abs(polygon.normal.dot(frame.n))>1-1e-6||polygon.tag.face==='curved')continue;
            if(Math.abs(polygon.normal.dot(middle.clone().sub(polygon.vertices[0])))>EPS)continue;
            const inside=polygon.vertices.every((a,i)=>{
                const b=polygon.vertices[(i+1)%polygon.vertices.length];
                const direction=b.clone().sub(a);return direction.clone().cross(middle.clone().sub(a)).dot(polygon.normal)>=-EPS*direction.length();
            });
            if(inside)neighbor=polygon.tag;
            if(neighbor)break;
        }
        if(!neighbor)continue;
        const referenceFace={featureId:neighbor.featureId,face:neighbor.face,reference:'XY'};
        const other=resolvePlane(doc,referenceFace),nx=other.n.dot(frame.u),ny=other.n.dot(frame.v),length=Math.hypot(nx,ny);
        if(length<EPS)continue;
        result.push({a:segment.a.toArray(),b:segment.b.toArray(),normal:[nx/length,ny/length],constant:other.o.clone().sub(frame.o).dot(other.n)/length,referenceFace});
    }
    // Circle and capsule centers retain their source feature and sketch-point identities.
    result.profilePoints=[];
    for(const feature of doc.features){
        if(!solid.some(p=>p.tag.featureId===feature.id))continue;
        const source=doc.sketches.find(s=>s.id===feature.sketchId);if(!source)continue;
        const base=resolvePlane(doc,source.plane);if(Math.abs(base.n.dot(frame.n))<.99999)continue;
        for(const entity of source.entities.filter(e=>e.kind==='circle'||e.kind==='arc'||e.kind==='ellipse'||e.kind==='slot'))for(const point of ['circle','arc','ellipse'].includes(entity.kind)?['center']:['leftCenter','rightCenter']){
            const local=pointValue(entity,point),delta=world(base,...local).sub(frame.o);
            const center=[delta.dot(frame.u),delta.dot(frame.v)],radius=['circle','arc'].includes(entity.kind)?entity.radius:entity.height/2;
            const angle=(entity.angle??0)*Math.PI/180,axis=[base.u.dot(frame.u)*Math.cos(angle)+base.v.dot(frame.u)*Math.sin(angle),base.u.dot(frame.v)*Math.cos(angle)+base.v.dot(frame.v)*Math.sin(angle)],direction=point==='leftCenter'?-1:1;
            const onCircle=p=>Math.abs(Math.hypot(p.x-center[0],p.y-center[1])-radius)<Math.max(EPS,radius*.002)&&(['circle','arc'].includes(entity.kind)||((p.x-center[0])*axis[0]+(p.y-center[1])*axis[1])*direction>=-EPS);
            const axisV=[-base.u.dot(frame.u)*Math.sin(angle)+base.v.dot(frame.u)*Math.cos(angle),-base.u.dot(frame.v)*Math.sin(angle)+base.v.dot(frame.v)*Math.cos(angle)];
            const onArc=entity.kind==='ellipse'?p=>{const dx=p.x-center[0],dy=p.y-center[1];return Math.abs(Math.hypot((dx*axis[0]+dy*axis[1])/(entity.width/2),(dx*axisV[0]+dy*axisV[1])/(entity.height/2))-1)<.002;}:onCircle;
            if(segments.filter(segment=>onArc(segment.a)&&onArc(segment.b)).length<2)continue;
            result.profilePoints.push({point:[delta.dot(frame.u),delta.dot(frame.v)],kind:'center',label:entity.kind==='ellipse'?'椭圆中心 · 重合':['circle','arc'].includes(entity.kind)?'圆心 · 重合':'半圆圆心 · 重合',reference:{kind:'modelProfilePoint',entityId:entity.id,point,faces:[{featureId:feature.id,face:'top',reference:'XY'}]}});
        }
    }
    modelEdgeResults.set(cacheKey,result);while(modelEdgeResults.size>48)modelEdgeResults.delete(modelEdgeResults.keys().next().value);
    return result;
}
export function sketchLine(entity,edge) {
    let a,b,fraction;
    if(entity.kind==='line'&&edge===0){a=[entity.x,entity.y];b=[entity.x+entity.width,entity.y+entity.height];fraction=[.5,.5];}
    else if(entity.kind==='polygon'){const points=outline(entity);if(edge<0||edge>=entity.sides)throw new Error('多边形边无效');a=points[edge];b=points[edge+1];fraction=[0,0];}
    else if(entity.kind==='rectangle'&&edge>=0&&edge<4) {
        const points=[[entity.x,entity.y],[entity.x+entity.width,entity.y],[entity.x+entity.width,entity.y+entity.height],[entity.x,entity.y+entity.height]];
        a=points[edge];b=points[(edge+1)%4];fraction=fractions[edge];
    } else if(entity.kind==='slot'&&(edge===0||edge===2)) {
        const r=entity.height/2,y=entity.y+(edge===2?entity.height:0);a=[entity.x+r,y];b=[entity.x+entity.width-r,y];fraction=fractions[edge];
    } else throw new Error('请选择直线边；圆弧继续使用直径尺寸。');
    if(entity.kind==='slot'){a=slotToWorld(entity,a);b=slotToWorld(entity,b);}
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(length<1e-6)throw new Error('这条边长度为零，无法创建线间距。');
    return {a,b,fraction,rows:pointRows(entity,entity.kind==='polygon'?'mid'+edge:entity.kind==='line'?'center':['bottomMid','rightMid','topMid','leftMid'][edge]),tangent:[dx/length,dy/length],normal:[-dy/length,dx/length]};
}
export function edgePoint(entity,edge) {
    const line=sketchLine(entity,edge),values=geometryValues(entity);return line.rows.map(row=>row.reduce((sum,v,i)=>sum+v*values[i],0));
}
export function resolveModelEdge(edges,reference) {
    const edge=edges.find(e=>sameFace(e.referenceFace,reference));
    if(!edge)throw new Error('标注引用的实体直边已不存在，请重新选择或解除该距离约束。');return edge;
}
export function resolveModelPoint(target,edges) {
    if(target.kind==='origin')return [0,0];
    if(target.kind==='modelProfilePoint'){const match=edges.profilePoints?.find(p=>p.reference.entityId===target.entityId&&p.reference.point===target.point&&p.reference.faces[0].featureId===target.faces[0].featureId);if(!match)throw new Error('引用的圆弧中心已失效，请重新关联。');return match.point;}
    if(target.kind==='modelCenter') {
        if(!edges.length)throw new Error('重合约束引用的实体面中心已失效。');
        const points=edges.flatMap(e=>[e.a,e.b]);return [(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2];
    }
    const first=resolveModelEdge(edges,target.faces[0]),[nx,ny]=first.normal;
    if(target.kind==='modelMidpoint'||target.kind==='modelEdgePoint') {
        const intervals=edges.filter(e=>sameFace(e.referenceFace,target.faces[0])).map(e=>{const values=[e.a,e.b].map(p=>-ny*p[0]+nx*p[1]);return [Math.min(...values),Math.max(...values)];}).sort((a,b)=>a[0]-b[0]);
        let start=intervals[0][0],end=intervals[0][1];for(const interval of intervals.slice(1)){if(interval[0]>end+EPS)throw new Error('参照边被分割，原边中点已失效，请重新建立重合关系。');end=Math.max(end,interval[1]);}
        const t=start+(end-start)*(target.kind==='modelEdgePoint'?target.parameter:.5);return [nx*first.constant-ny*t,ny*first.constant+nx*t];
    }
    const second=resolveModelEdge(edges,target.faces[1]),[mx,my]=second.normal,det=nx*my-ny*mx;
    if(Math.abs(det)<1e-6)throw new Error('重合约束引用的实体顶点已失效。');
    const point=[(first.constant*my-ny*second.constant)/det,(nx*second.constant-first.constant*mx)/det];
    const onSegment=e=>{const dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1],len=dx*dx+dy*dy,t=((point[0]-e.a[0])*dx+(point[1]-e.a[1])*dy)/len;return t>=-EPS&&t<=1+EPS&&Math.hypot(e.a[0]+t*dx-point[0],e.a[1]+t*dy-point[1])<EPS;};
    if(!target.faces.every(face=>edges.some(e=>sameFace(e.referenceFace,face)&&onSegment(e))))throw new Error('原实体顶点已被移除，请重新建立重合约束。');
    return point;
}
export function modelSnapPoints(edges) {
    const points=[],seen=new Set(),faceKey=face=>face.featureId+'/'+face.face;
    for(const edge of edges)for(const p of [edge.a,edge.b]) {
        const key=p.map(v=>Math.round(v/EPS)).join(',');if(seen.has(key))continue;
        const touching=edges.filter(e=>[e.a,e.b].some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<EPS));
        const other=touching.find(e=>Math.abs(e.normal[0]*edge.normal[1]-e.normal[1]*edge.normal[0])>1e-6);if(!other)continue;
        const reference={kind:'modelVertex',faces:[edge.referenceFace,other.referenceFace]};
        try{const point=resolveModelPoint(reference,edges);points.push({point,kind:'vertex',label:'实体顶点 · 重合',reference});seen.add(key);}catch{}
    }
    const faces=new Map(edges.map(e=>[faceKey(e.referenceFace),e.referenceFace]));
    for(const face of faces.values()){const reference={kind:'modelMidpoint',faces:[face]};try{points.push({point:resolveModelPoint(reference,edges),kind:'midpoint',label:'实体边中点 · 重合',reference});}catch{}}
    if(edges.length){const reference={kind:'modelCenter',faces:[]};points.push({point:resolveModelPoint(reference,edges),kind:'center',label:'实体面中心 · 重合',reference});}
    return [...points,...(edges.profilePoints??[])];
}
export function dimensionReference(sketch,dimension,edges) {
    if(!dimension.referenceEntityId)return resolveModelEdge(edges,dimension.referenceFace);
    const entity=sketch.entities.find(e=>e.id===dimension.referenceEntityId);if(!entity)throw new Error('标注引用的草图边已不存在。');
    const line=sketchLine(entity,dimension.referenceEdge),[nx,ny]=line.normal;
    return {...line,constant:nx*line.a[0]+ny*line.a[1],entity};
}
function solve(rows,current) {
    const n=current.length,a=rows.map(row=>[...row.slice(0,n),row[n]-row.slice(0,n).reduce((sum,v,i)=>sum+v*current[i],0)]),pivots=[];
    let r=0;
    for(let col=0;col<n&&r<a.length;col++) {
        let pivot=r;for(let i=r+1;i<a.length;i++)if(Math.abs(a[i][col])>Math.abs(a[pivot][col]))pivot=i;
        if(Math.abs(a[pivot][col])<1e-8)continue;
        [a[r],a[pivot]]=[a[pivot],a[r]];const scale=a[r][col];for(let j=0;j<=n;j++)a[r][j]/=scale;
        for(let i=0;i<a.length;i++)if(i!==r){const factor=a[i][col];if(Math.abs(factor)<1e-12)continue;for(let j=0;j<=n;j++)a[i][j]-=factor*a[r][j];}
        pivots.push(col);r++;
    }
    if(a.some(row=>row.slice(0,n).every(v=>Math.abs(v)<1e-7)&&Math.abs(row[n])>EPS))return null;
    const delta=Array(n).fill(0);for(let i=0;i<pivots.length;i++)delta[pivots[i]]=a[i][n];return current.map((v,i)=>v+delta[i]);
}
function componentEquations(base,entities,sketch,edges,freezeSize,freezeReference,intent) {
    const n=entities.length*5,offsets=new Map(entities.map((e,i)=>[e.id,i*5])),rows=[],byId=new Map(entities.map(e=>[e.id,e]));
    const row=()=>Array(n+1).fill(0),allValues=entities.flatMap(geometryValues);
    const add=(entity,coefficients,value)=>{const r=row(),offset=offsets.get(entity.id);for(let i=0;i<5;i++)r[offset+i]=coefficients[i]??0;r[n]=value;rows.push(r);};
    const addPoint=(entity,name,target)=>{const own=pointRows(entity,name);for(let axis=0;axis<2;axis++){
        const r=row(),at=offsets.get(entity.id);own[axis].forEach((v,i)=>r[at+i]+=v);
        if(target.entity){const ref=offsets.get(target.entity.id);target.rows[axis].forEach((v,i)=>r[ref+i]-=v);r[n]=0;}
        else r[n]=target.point[axis];rows.push(r);
    }};
    const rigidLines=new Set();for(const e of entities){if(e.referenceLineId)rigidLines.add(e.referenceLineId);for(const d of e.modelDimensions??[]){if(e.kind==='line')rigidLines.add(e.id);if(d.referenceEntityId&&byId.get(d.referenceEntityId)?.kind==='line')rigidLines.add(d.referenceEntityId);}}
    for(let ei=0;ei<entities.length;ei++) {
        const e=entities[ei],original=base[ei],dims=e.dimensionedEdges??[],values=geometryValues(original);
        const scalar=(index,value)=>{const coefficients=[0,0,0,0,0];coefficients[index]=1;add(e,coefficients,value);};
        if(freezeSize||radial(e)||rigidLines.has(e.id)||(e.kind!=='line'&&dims.some(i=>i%2===0)))scalar(2,original.width);
        if(freezeSize||radial(e)||rigidLines.has(e.id)||(e.kind!=='line'&&dims.some(i=>i%2===1)))scalar(3,original.height);
        if(freezeSize||!radial(e)||dims.length)scalar(4,original.radius);
        if(e.kind==='line'&&dims.length&&!rigidLines.has(e.id)) {
            const length=Math.hypot(e.width,e.height);if(length<1e-8)throw new Error('参考线端点重合，无法保持长度约束。');
            add(e,[0,0,e.width/length,e.height/length,0],Math.hypot(original.width,original.height));
        }
        if(e.fixedPoint&&e.fixedPoint!=='none')addPoint(e,e.fixedPoint,{point:pointValue(original,original.fixedPoint)});
        else if(freezeReference&&!hasRelations(original))for(let i=0;i<5;i++)scalar(i,values[i]);
        if(intent?.entityId===e.id){const index={x:0,y:1,width:2,height:3,radius:4}[intent.field];if(index!==undefined)scalar(index,intent.value);}
        if(intent?.entityId===e.id&&intent.field==='length'){const length=Math.hypot(e.width,e.height);if(length<1e-8)throw new Error('参考线长度无效。');add(e,[0,0,e.width/length,e.height/length,0],intent.value);}
        if(e.referenceLineId) {
            const reference=byId.get(e.referenceLineId),line=sketchLine(reference,0),[nx,ny]=line.normal,center=pointRows(e,'center'),r=row(),at=offsets.get(e.id),ref=offsets.get(reference.id);
            center[0].forEach((v,i)=>r[at+i]+=nx*v);center[1].forEach((v,i)=>r[at+i]+=ny*v);
            r[ref]-=nx;r[ref+1]-=ny;r[n]=e.referenceOffset;rows.push(r);
        }
        for(const d of e.modelDimensions??[]) {
            const own=sketchLine(e,d.edge),reference=dimensionReference({...sketch,entities},d,edges),[nx,ny]=reference.normal,[fx,fy]=own.fraction;
            if(Math.abs(nx*own.tangent[0]+ny*own.tangent[1])>1e-5)throw new Error('两条直线不平行，不能用平行线间距约束。');
            const r=row(),at=offsets.get(e.id);own.rows[0].forEach((v,i)=>r[at+i]+=nx*v+ny*own.rows[1][i]);r[n]=d.side*d.distance;
            if(reference.entity){const ref=offsets.get(reference.entity.id),[rx,ry]=reference.fraction;reference.rows[0].forEach((v,i)=>r[ref+i]-=nx*v+ny*reference.rows[1][i]);}else r[n]+=reference.constant;
            rows.push(r);
        }
        for(const coincidence of e.coincidences??[]) {
            const reference=coincidence.target,target=reference.kind==='sketch'?byId.get(reference.entityId):null;
            if(reference.kind==='modelEdge'){
                const edge=resolveModelEdge(edges,reference.faces[0]),own=pointRows(e,coincidence.point),[nx,ny]=edge.normal;
                add(e,own[0].map((v,i)=>nx*v+ny*own[1][i]),edge.constant);continue;
            }
            const targetRows=target?pointRows(target,reference.point):null,targetPoint=target?pointValue(target,reference.point):resolveModelPoint(reference,edges);
            if(coincidence.point!=='perimeter')addPoint(e,coincidence.point,target?{entity:target,rows:targetRows}:{point:targetPoint});
            else {
                const dx=e.x-targetPoint[0],dy=e.y-targetPoint[1],length=Math.hypot(dx,dy),nx=length>1e-8?dx/length:1,ny=length>1e-8?dy/length:0,r=row(),at=offsets.get(e.id);
                r[at]=nx;r[at+1]=ny;r[at+4]=-1;
                if(target){const ref=offsets.get(target.id);targetRows[0].forEach((v,i)=>r[ref+i]-=nx*v);targetRows[1].forEach((v,i)=>r[ref+i]-=ny*v);}
                r[n]=r.slice(0,n).reduce((sum,v,i)=>sum+v*allValues[i],0)-(length-e.radius);rows.push(r);
            }
        }
    }
    return rows;
}
export function constrainSketch(sketch,edges,preferredId=null,intent=null) {
    const byId=new Map(sketch.entities.map(e=>[e.id,e])),graph=new Map(sketch.entities.map(e=>[e.id,new Set()]));
    const connect=(a,b)=>{if(!byId.has(b))throw new Error('约束引用的草图图元已不存在。');graph.get(a).add(b);graph.get(b).add(a);};
    for(const e of sketch.entities){for(const d of e.modelDimensions??[])if(d.referenceEntityId)connect(e.id,d.referenceEntityId);if(e.referenceLineId)connect(e.id,e.referenceLineId);for(const c of e.coincidences??[])if(c.target.kind==='sketch')connect(e.id,c.target.entityId);}
    const result=new Map(),visited=new Set();
    for(const seed of sketch.entities.filter(hasRelations)) {
        if(visited.has(seed.id))continue;
        const ids=[],stack=[seed.id];while(stack.length){const id=stack.pop();if(visited.has(id))continue;visited.add(id);ids.push(id);for(const next of graph.get(id))stack.push(next);}
        const base=ids.map(id=>byId.get(id)).sort((a,b)=>Number(b.id===preferredId)-Number(a.id===preferredId));
        let accepted=null;
        for(const [sizes,refs] of [[true,true],[false,true],[true,false],[false,false]]) {
            let working=base.map(e=>structuredClone(e));
            for(let iteration=0;iteration<24;iteration++) {
                const current=working.flatMap(geometryValues),rows=componentEquations(base,working,sketch,edges,sizes,refs,intent),solved=solve(rows,current);
                if(!solved||solved.some(v=>!Number.isFinite(v)))break;
                working=working.map((e,i)=>{const [x,y,width,height,radius]=solved.slice(i*5,i*5+5);return {...e,x,y,width,height,radius};});
                const nextRows=componentEquations(base,working,sketch,edges,sizes,refs,intent),n=solved.length;
                if(nextRows.every(row=>Math.abs(row.slice(0,n).reduce((sum,v,i)=>sum+v*solved[i],0)-row[n])<1e-5)){accepted=working;break;}
            }
            if(accepted)break;
        }
        if(!accepted)throw new Error('重合关系、间距、固定点或尺寸约束冲突，已保留原图形。请先解除冲突的约束。');
        for(const e of accepted){
            for(const relation of e.coincidences??[])if(relation.target.kind==='modelEdge'){
                const p=pointValue(e,relation.point),reference=relation.target.faces[0];
                const onEdge=edges.filter(edge=>sameFace(edge.referenceFace,reference)).some(edge=>{
                    const dx=edge.b[0]-edge.a[0],dy=edge.b[1]-edge.a[1],length=dx*dx+dy*dy,t=((p[0]-edge.a[0])*dx+(p[1]-edge.a[1])*dy)/length;
                    return t>=-EPS&&t<=1+EPS&&Math.hypot(edge.a[0]+t*dx-p[0],edge.a[1]+t*dy-p[1])<EPS;
                });
                if(!onEdge)throw new Error('重合点已超出实体边界，请解除或重新选择边吸附。');
            }
            if((e.kind!=='line'&&(e.width<1||e.height<1))||(e.kind==='slot'&&e.width<e.height)||e.radius<1)throw new Error('约束会导致无效尺寸，已保留原图形。');result.set(e.id,e);}
    }
    return result;
}
export function constrainRectangle(entity,sketch,edges) {
    if(!sketch.entities.some(hasRelations))return structuredClone(entity);
    const candidate=structuredClone(sketch);candidate.entities[candidate.entities.findIndex(e=>e.id===entity.id)]=structuredClone(entity);
    return constrainSketch(candidate,edges,entity.id).get(entity.id)??structuredClone(entity);
}
export function applyModelDimensions(document,validateOnly=false,preferredId=null,intent=null) {
    if(!document.sketches.some(s=>s.entities.some(hasRelations)))return [];
    const changes=[],processed=new Set(),prefix={...document,features:[]};
    function process(sketch) {
        if(processed.has(sketch.id))return;processed.add(sketch.id);if(!sketch.entities.some(hasRelations))return;
        const needsModel=sketch.entities.some(e=>e.modelDimensions?.some(d=>!d.referenceEntityId)||e.coincidences?.some(c=>c.target.kind.startsWith('model'))),edges=needsModel?modelEdges(prefix,sketch):[];
        const solved=constrainSketch(sketch,edges,preferredId,intent);
        for(const e of sketch.entities){const next=solved.get(e.id);if(!next)continue;const changed=['x','y','width','height','radius'].some(k=>Math.abs(e[k]-next[k])>1e-6);
            if(changed&&validateOnly)throw new Error('保存的数据没有满足重合或尺寸约束，请恢复有效草稿。');
            if(changed){Object.assign(e,{x:next.x,y:next.y,width:next.width,height:next.height,radius:next.radius});changes.push({sketchId:sketch.id,entityId:e.id,x:e.x,y:e.y,width:e.width,height:e.height,radius:e.radius});}
        }
    }
    for(const feature of document.features){for(const id of [feature.sketchId,feature.pathSketchId,...(feature.sections??[]).map(s=>s.sketchId)].filter(Boolean))process(document.sketches.find(s=>s.id===id));prefix.features.push(feature);}
    for(const sketch of document.sketches)process(sketch);return changes;
}
