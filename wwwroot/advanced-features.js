import {circleOf} from './curved-boundary.js';
import {roundEnd} from './round-junction.js';
// Section-based solid generation. Returned faces are passed through the existing BSP kernel.
import * as CAD from './engine/core.js';
import {outline} from './sketch-tools.js';
import {faceBoundarySegments} from './snapping.js';
const EPS=1e-5;
const v2=p=>new CAD.Vector2(p.x,p.y);
function clean(points){
    const result=points.map(v2).filter((p,i,a)=>!i||p.distanceToSquared(a[i-1])>EPS*EPS);
    if(result.length>1&&result[0].distanceToSquared(result.at(-1))<EPS*EPS)result.pop();
    let changed=true;while(changed&&result.length>3){changed=false;for(let i=0;i<result.length;i++){const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length],ab=b.clone().sub(a),bc=c.clone().sub(b);if(Math.abs(ab.cross(bc))<EPS&&ab.dot(bc)>=0){result.splice(i,1);changed=true;break;}}}
    if(result.length<3)throw new Error('截面轮廓无法闭合。');
    const tolerance=new CAD.Box2().setFromPoints(result).getSize(new CAD.Vector2()).length()*.003;
    while(result.length>48){let best=Infinity,index=-1;for(let i=0;i<result.length;i++){const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length],d=c.clone().sub(a),t=CAD.MathUtils.clamp(b.clone().sub(a).dot(d)/(d.lengthSq()||1),0,1),error=b.distanceTo(a.clone().addScaledVector(d,t));if(error<best){best=error;index=i;}}if(best>tolerance)throw new Error('截面边界过于复杂，请拆分为多个特征。');result.splice(index,1);}
    return result;
}
function loops(shape){return [shape,...shape.holes].map((path,i)=>{const points=clean(path.getPoints(24));if((CAD.ShapeUtils.area(points)>0)!==(i===0))points.reverse();return points;});}
function resample(points,count){
    const lengths=[0];for(let i=0;i<points.length;i++)lengths.push(lengths.at(-1)+points[i].distanceTo(points[(i+1)%points.length]));
    const total=lengths.at(-1);if(total<EPS)throw new Error('放样截面长度为零。');
    return Array.from({length:count},(_,i)=>{const distance=i/count*total;let j=0;while(j<points.length-1&&lengths[j+1]<distance)j++;return points[j].clone().lerp(points[(j+1)%points.length],(distance-lengths[j])/(lengths[j+1]-lengths[j]));});
}
function addFace(result,vertices,face,minimumAreaSq=1e-14){if(vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).lengthSq()>minimumAreaSq)result.push({vertices,face});}
function skin(rings,capLoops,{closed=false,planarSides=false,normalRings=null,planarQuads=false,minimumAreaSq=1e-14}={}){
    if(rings.length<(closed?3:2)||!rings[0]?.length)throw new Error('圆角路径缺少有效截面，请重新选择完整边界。');
    const counts=rings[0].map(loop=>loop.length);
    if(rings.some(ring=>ring.length!==counts.length||ring.some((loop,i)=>loop.length!==counts[i]||loop.some(point=>!point||![point.x,point.y,point.z].every(Number.isFinite)))))throw new Error('相邻截面的采样点不一致，无法连接圆角曲面。');
    const result=[],steps=closed?rings.length:rings.length-1;
    for(let step=0;step<steps;step++)for(let loop=0;loop<rings[step].length;loop++){
        const a=rings[step][loop],b=rings[(step+1)%rings.length][loop];
        for(let i=0;i<a.length;i++){const j=(i+1)%a.length,quad=[a[i],a[j],b[j],b[i]];
            const normal=quad[1].clone().sub(quad[0]).cross(quad[2].clone().sub(quad[0])).normalize();
            const planar=Math.abs(quad[3].clone().sub(quad[0]).dot(normal))<EPS;
            const selectable=typeof planarSides==='function'?planarSides(step,loop,i):planarSides;
            const face=selectable&&planar?`surface|${step}|${loop}|${i}`:'curved';
            // A planar convex loft wall is one BSP polygon. Splitting it along
            // a render diagonal makes later cuts subdivide both halves again.
            if(planarQuads&&selectable&&planar&&normal.lengthSq()>.5&&quad.every((point,index)=>{
                const next=quad[(index+1)%4],after=quad[(index+2)%4];return next.clone().sub(point).cross(after.clone().sub(next)).dot(normal)>EPS*EPS;
            })){result.push({vertices:quad,face});continue;}
            for(const indices of [[0,1,2],[0,2,3]]){
                const before=result.length;addFace(result,indices.map(index=>quad[index]),face,minimumAreaSq);
                if(normalRings&&face==='curved'&&result.length>before){const normals=[normalRings[step][loop][i],normalRings[step][loop][j],normalRings[(step+1)%rings.length][loop][j],normalRings[(step+1)%rings.length][loop][i]];if(indices.every(index=>normals[index]))result.at(-1).smooth={kind:'patch',points:indices.map(index=>quad[index]),normals:indices.map(index=>normals[index])};}
            }
        }
    }
    if(!closed)for(const [index,name,reverse] of [[0,'bottom',true],[rings.length-1,'top',false]]){
        const flat=rings[index].flat(),triangles=CAD.ShapeUtils.triangulateShape(capLoops[index===0?0:capLoops.length-1][0],capLoops[index===0?0:capLoops.length-1].slice(1));
        for(const triangle of triangles){const local=capLoops[index===0?0:capLoops.length-1].flat(),[a,b,c]=triangle.map(i=>local[i]),vertices=triangle.map(i=>flat[i]);if(b.clone().sub(a).cross(c.clone().sub(a))*CAD.ShapeUtils.area(capLoops[index===0?0:capLoops.length-1][0])<0)vertices.reverse();if(reverse)vertices.reverse();addFace(result,vertices,name,minimumAreaSq);}
    }
    const origin=rings[0][0][0];let volume=0;for(const face of result)for(let index=1;index<face.vertices.length-1;index++)volume+=face.vertices[0].clone().sub(origin).dot(face.vertices[index].clone().sub(origin).cross(face.vertices[index+1].clone().sub(origin)))/6;
    if(Math.abs(volume)<.001)throw new Error('所选截面和参数无法生成有效体积。');
    if(volume<0)for(const face of result)face.vertices.reverse();return result;
}
function straightBoundary(sketch,a,b){
    for(const entity of sketch.entities){if(entity.construction||!['rectangle','polygon','line','slot'].includes(entity.kind))continue;const points=outline(entity),indices=entity.kind==='slot'?[32,65]:Array.from({length:points.length-1},(_,i)=>i);
        for(const i of indices){const p=new CAD.Vector2(...points[i]),q=new CAD.Vector2(...points[i+1]),direction=q.clone().sub(p),length=direction.length();if(length<EPS)continue;direction.divideScalar(length);
            const on=point=>{const delta=point.clone().sub(p),along=delta.dot(direction);return Math.abs(delta.cross(direction))<1e-4&&along>=-EPS&&along<=length+EPS;};if(on(a)&&on(b))return true;
        }
    }return false;
}
function rotate(point,origin,axis,angle){return point.clone().sub(origin).applyAxisAngle(axis,angle).add(origin);}
function curvePoints2D(sketch,entityId,{construction=true,maxCurvePoints=49}={}){
    let points;
    if(entityId){
        const entity=sketch.entities.find(e=>e.id===entityId&&(construction||!e.construction));
        const allowed=construction?['line','arc','circle','ellipse']:['line','arc'];
        if(!entity||!allowed.includes(entity.kind))throw new Error(construction?'路径支持直线、圆弧、圆、椭圆或连续直线链。':'开放薄壁截面请选择直线、圆弧或连续直线链。');
        points=outline(entity);if(points.length>maxCurvePoints)points=Array.from({length:maxCurvePoints},(_,i)=>points[Math.round(i*(points.length-1)/(maxCurvePoints-1))]);
    }else{
        const remaining=sketch.entities.filter(e=>e.kind==='line'&&(construction||!e.construction)).map(e=>[[e.x,e.y],[e.x+e.width,e.y+e.height]]);
        if(!remaining.length)throw new Error(construction?'路径草图中没有直线。':'截面中没有开放直线，请选择一条圆弧或更换截面草图。');
        const degree=p=>remaining.reduce((sum,line)=>sum+line.filter(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<EPS).length,0);
        const endpoints=remaining.flat().filter(p=>degree(p)===1);
        if(endpoints.length!==0&&endpoints.length!==2||remaining.flat().some(p=>degree(p)>2))throw new Error('轮廓必须首尾相接且没有分叉。');
        points=[endpoints[0]??remaining[0][0]];
        while(remaining.length){const tip=points.at(-1),index=remaining.findIndex(line=>line.some(p=>Math.hypot(p[0]-tip[0],p[1]-tip[1])<EPS));if(index<0)throw new Error('轮廓存在断点，请让各线段端点重合。');const line=remaining.splice(index,1)[0];points.push(Math.hypot(line[0][0]-tip[0],line[0][1]-tip[1])<EPS?line[1]:line[0]);}
    }
    return points.filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>EPS);
}
function pathPoints(doc,feature,frame,world){
    const sketch=doc.sketches.find(s=>s.id===feature.pathSketchId);
    if(!sketch||sketch.id===feature.sketchId)throw new Error('路径可开放或闭合；请选择另一草图中的连续曲线。');
    const basis=frame(doc,sketch.plane);let points=curvePoints2D(sketch,feature.pathEntityId).map(p=>world(basis,...p));
    if(feature.pathInterpolation==='spline'){
        const entity=sketch.entities.find(e=>e.id===feature.pathEntityId);if(entity&&entity.kind!=='line')throw new Error('圆弧、圆和椭圆请使用原始路径；样条模式使用连续直线链的顶点作为控制点。');
        if(points.length>=3){const closed=points[0].distanceToSquared(points.at(-1))<EPS*EPS,control=closed?points.slice(0,-1):points;points=new CAD.CatmullRomCurve3(control,closed,'centripetal').getSpacedPoints(Math.min(96,Math.max(24,control.length*8)));}
    }
    if(points.length<2)throw new Error('扫描路径长度不足。');if(points.length>130)throw new Error('扫描路径过于复杂，请拆分路径。');return points;
}
function thinSweepShape(sketch,feature){
    const thickness=feature.wallThickness;
    if(!Number.isFinite(thickness)||thickness<.1||thickness>1000)throw new Error('薄壁扫描厚度必须为 0.1–1000 mm。');
    const points=curvePoints2D(sketch,feature.openProfileEntityId,{construction:false,maxCurvePoints:24}).map(p=>new CAD.Vector2(...p));
    if(points.length<2||points[0].distanceToSquared(points.at(-1))<EPS*EPS)throw new Error('薄壁模式请选择开放轮廓；闭合轮廓可用实体扫描。');
    for(let i=points.length-2;i>0;i--){const a=points[i].clone().sub(points[i-1]),b=points[i+1].clone().sub(points[i]);if(Math.abs(a.cross(b))<EPS&&a.dot(b)>0)points.splice(i,1);}
    if(points.length>24)throw new Error('薄壁截面的拐点过多，请拆分为多个扫描特征。');
    const normals=points.slice(1).map((p,i)=>{const delta=p.clone().sub(points[i]).normalize();return new CAD.Vector2(-delta.y,delta.x);});
    const offset=distance=>points.map((p,i)=>{
        if(!i)return p.clone().addScaledVector(normals[0],distance);
        if(i===points.length-1)return p.clone().addScaledVector(normals.at(-1),distance);
        const direction=normals[i-1].clone().add(normals[i]);if(direction.lengthSq()<1e-4)throw new Error('薄壁截面不能原路折返。');direction.normalize();const cosine=direction.dot(normals[i]);if(Math.abs(cosine)<.1)throw new Error('轮廓转角过尖，请增大转角或拆分扫描。');return p.clone().addScaledVector(direction,distance/cosine);
    });
    const [left,right]=feature.wallSide==='left'?[thickness,0]:feature.wallSide==='right'?[0,-thickness]:[thickness/2,-thickness/2];
    const contour=offset(left).concat(offset(right).reverse());
    const on=(p,a,b)=>{const d=b.clone().sub(a),v=p.clone().sub(a);return Math.abs(d.cross(v))<EPS&&v.dot(d)>=-EPS&&v.dot(d)<=d.lengthSq()+EPS;};
    for(let i=0;i<contour.length;i++)for(let j=i+2;j<contour.length;j++){
        if(i===0&&j===contour.length-1)continue;const a=contour[i],b=contour[(i+1)%contour.length],c=contour[j],d=contour[(j+1)%contour.length],ab=b.clone().sub(a),cd=d.clone().sub(c),cross=ab.cross(cd),delta=c.clone().sub(a);
        const intersects=Math.abs(cross)<EPS?(on(c,a,b)||on(d,a,b)||on(a,c,d)||on(b,c,d)):(()=>{const t=delta.cross(cd)/cross,u=delta.cross(ab)/cross;return t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS;})();
        if(intersects)throw new Error('壁厚导致开放轮廓加厚后自交，请减小厚度或调整轮廓。');
    }
    if(Math.abs(CAD.ShapeUtils.area(contour))<EPS)throw new Error('开放轮廓无法生成有效的薄壁截面。');
    const shape=new CAD.Shape(contour);shape.closePath();return shape;
}
function sweepFrames(doc,feature,{resolve,world}){
    const sketch=doc.sketches.find(s=>s.id===feature.sketchId),base=resolve(doc,sketch.plane);
        const points=pathPoints(doc,feature,resolve,world),closed=points[0].distanceToSquared(points.at(-1))<EPS*EPS;
        if(closed)points.pop();
        if(feature.reversed)points.reverse();
        const tangent=points.map((p,i)=>{const previous=i?points[i-1]:closed?points.at(-1):p,next=i<points.length-1?points[i+1]:closed?points[0]:p;const a=p.clone().sub(previous),b=next.clone().sub(p);if(a.lengthSq()<EPS)return b.normalize();if(b.lengthSq()<EPS)return a.normalize();a.normalize();b.normalize();if(a.dot(b)<-.99)throw new Error('扫描路径不能原路折返。');return a.add(b).normalize();});
        const follow=(feature.sweepOrientation??'follow')==='follow';
        if(!follow&&Math.abs(base.n.dot(tangent[0]))<1e-3)throw new Error('保持截面方向时，路径起始方向不能沿截面平面延伸。请选择“自动对齐路径方向”，或调整路径方向。');
        const frames=[follow?new CAD.Quaternion().setFromUnitVectors(base.n.clone().multiplyScalar(base.n.dot(tangent[0])<0?-1:1),tangent[0]):new CAD.Quaternion()];for(let i=1;i<points.length;i++)frames.push(new CAD.Quaternion().setFromUnitVectors(tangent[i-1],tangent[i]).multiply(frames[i-1]));
        if(closed){const finish=new CAD.Quaternion().setFromUnitVectors(tangent.at(-1),tangent[0]).multiply(frames.at(-1)),initial=base.u.clone().applyQuaternion(frames[0]),u=base.u.clone().applyQuaternion(finish);initial.addScaledVector(tangent[0],-initial.dot(tangent[0])).normalize();u.addScaledVector(tangent[0],-u.dot(tangent[0])).normalize();const twist=Math.atan2(tangent[0].dot(u.clone().cross(initial)),u.dot(initial));for(let i=1;i<frames.length;i++)frames[i].premultiply(new CAD.Quaternion().setFromAxisAngle(tangent[i],twist*i/frames.length));}
    return {base,points,closed,frames};
}
// Shape coordinates are independent of the source sketch position and path position.
// Center the outer contour once, then reuse the same offsets for mesh and animation.
function sweepSection(shape,base){
    const contour=loops(shape),center=new CAD.Box2().setFromPoints(contour[0]).getCenter(new CAD.Vector2());
    const local=contour.map(loop=>loop.map(p=>p.clone().sub(center)));
    const offsets=local.map(loop=>loop.map(p=>base.u.clone().multiplyScalar(p.x).addScaledVector(base.v,p.y)));
    return {contour,local,offsets};
}
export function sweepGuideData(doc,feature,options){
    const sketch=doc.sketches.find(s=>s.id===feature.sketchId),shapes=feature.thinWall?[thinSweepShape(sketch,feature)]:options.shapes(sketch,feature);
    if(shapes.length!==1)throw new Error('扫描截面请选择一个连通闭合区域。');
    const {base,points,closed,frames}=sweepFrames(doc,feature,options),section=sweepSection(shapes[0],base),contours=section.local.map(loop=>loop.map(p=>[p.x,p.y])),lengths=[0];
    const count=closed?points.length:points.length-1;for(let i=0;i<count;i++)lengths.push(lengths.at(-1)+points[i].distanceTo(points[(i+1)%points.length]));
    return {contours,at(progress){const distance=CAD.MathUtils.clamp(progress,0,1)*lengths.at(-1);let i=0;while(i<count-1&&lengths[i+1]<distance)i++;const t=(distance-lengths[i])/(lengths[i+1]-lengths[i]||1),next=(i+1)%points.length,q=frames[i].clone().slerp(frames[next],t),u=base.u.clone().applyQuaternion(q),v=base.v.clone().applyQuaternion(q);return {o:points[i].clone().lerp(points[next],t),u,v,n:u.clone().cross(v).normalize()};}};
}
export function advancedFaces(doc,feature,{shapes,resolve,world,axisLine=null,faceSections=[]}){
    const sketch=doc.sketches.find(s=>s.id===feature.sketchId),base=resolve(doc,sketch.plane),sourceShapes=feature.mode==='sweep'&&feature.thinWall?[thinSweepShape(sketch,feature)]:shapes(sketch,feature);
    if(sourceShapes.length!==1)throw new Error('实体截面请选择一个连通封闭区域；开放扫描截面请启用薄壁模式。');
    if(feature.mode==='loft'&&(feature.sections?.length>8||new Set([feature.sketchId,...(feature.sections??[]).map(s=>s.face?JSON.stringify(s.face)+':'+s.faceX+':'+s.faceY:s.sketchId)]).size!==(feature.sections?.length??0)+1))throw new Error('放样截面不能重复，最多添加 8 个后续截面。');
    if(feature.mode==='revolve'){
        const axisEntity=feature.axisEntityId?sketch.entities.find(e=>e.id===feature.axisEntityId&&e.kind==='line'):null;
        if(feature.axisEntityId&&!axisEntity&&!axisLine)throw new Error('旋转轴已失效。');
        const axis=axisLine?axisLine.b.clone().sub(axisLine.a).normalize():axisEntity?base.u.clone().multiplyScalar(axisEntity.width).addScaledVector(base.v,axisEntity.height).normalize():(feature.axis==='X'?base.u:base.v).clone();
        const origin=axisLine?axisLine.a.clone():axisEntity?world(base,axisEntity.x,axisEntity.y):feature.axis==='X'?world(base,0,feature.axisOffset??0):world(base,feature.axisOffset??0,0);
        const angle=(feature.angle??360)*Math.PI/180*(feature.reversed?-1:1),closed=Math.abs(feature.angle-360)<EPS,result=[];
        for(const shape of sourceShapes){
            const contour=loops(shape),bounds=new CAD.Box2().setFromPoints(contour[0]),center=bounds.getCenter(new CAD.Vector2()),pivot=world(base,center.x,center.y);
            // A remote or tilted axis defines the working meridian plane. Move
            // the section by a rigid rotation only: never project/scale its width.
            const radial=pivot.clone().sub(origin).addScaledVector(axis,-pivot.clone().sub(origin).dot(axis));
            let normal=axis.clone().cross(radial);
            if(normal.lengthSq()<EPS*EPS){normal=base.n.clone().addScaledVector(axis,-base.n.dot(axis));if(normal.lengthSq()<EPS*EPS)normal=base.u.clone().addScaledVector(axis,-base.u.dot(axis));}
            normal.normalize();if(normal.dot(base.n)<0)normal.negate();
            const alignment=new CAD.Quaternion().setFromUnitVectors(base.n,normal);
            const initial=contour.map(loop=>loop.map(p=>world(base,p.x,p.y).sub(pivot).applyQuaternion(alignment).add(pivot)));
            const radius=Math.max(EPS,...initial.flat().map(p=>{const delta=p.clone().sub(origin);return delta.addScaledVector(axis,-delta.dot(axis)).length();})),size=bounds.getSize(new CAD.Vector2()),tolerance=Math.max(.005,Math.min(.05,Math.min(size.x,size.y)*.003));
            const stepAngle=Math.min(Math.PI/60,2*Math.acos(CAD.MathUtils.clamp(1-tolerance/radius,-1,1))),steps=Math.max(2,Math.min(360,Math.ceil(Math.abs(angle)/Math.max(stepAngle,1e-4))));
            const rings=Array.from({length:steps+(closed?0:1)},(_,i)=>initial.map(loop=>loop.map(p=>rotate(p,origin,axis,angle*i/steps))));
            result.push(...skin(rings,[contour,contour],{closed,planarSides:(_,loop,i)=>{const j=(i+1)%contour[loop].length;return Math.abs(initial[loop][j].clone().sub(initial[loop][i]).dot(axis))<EPS&&straightBoundary(sketch,contour[loop][i],contour[loop][j]);}}));
        }return result;
    }
    if(feature.mode==='sweep'){
        const {points,closed,frames}=sweepFrames(doc,feature,{resolve,world});
        const result=[];for(const shape of sourceShapes){const {contour,offsets:initial}=sweepSection(shape,base),rings=points.map((p,i)=>initial.map(loop=>loop.map(v=>v.clone().applyQuaternion(frames[i]).add(p))));result.push(...skin(rings,[contour,contour],{closed,planarSides:(_,loop,i)=>feature.thinWall&&(!feature.openProfileEntityId||sketch.entities.find(e=>e.id===feature.openProfileEntityId)?.kind==='line')||straightBoundary(sketch,contour[loop][i],contour[loop][(i+1)%contour[loop].length])}));}return result;
    }
    if(feature.mode==='loft'){
        if(sourceShapes.length!==1)throw new Error('放样的每个截面请选择一个连通封闭区域。');
        const sections=[{sketch,shape:sourceShapes[0]}];
        for(const [index,section] of (feature.sections??[]).entries()){if(section.face){if(!faceSections[index])throw new Error('请选择有效的实体平面截面。');sections.push(faceSections[index]);continue;}const next=doc.sketches.find(s=>s.id===section.sketchId);if(!next)throw new Error('放样截面已失效。');const selected=shapes(next,section);if(selected.length!==1)throw new Error('放样的每个截面请选择一个连通封闭区域。');sections.push({sketch:next,shape:selected[0]});}
        if(sections.length<2)throw new Error('放样至少需要两个截面。');
        const contours=sections.map(s=>loops(s.shape)),holeCount=contours[0].length;
        if(contours.some(loop=>loop.length!==holeCount))throw new Error('放样截面的孔数量必须一致。');
        const counts=contours[0].map((_,i)=>Math.min(128,Math.max(...contours.map(loop=>loop[i].length))));
        // Preserve matching polygon vertices; otherwise use arc-length correspondence.
        const locals=contours.map(section=>section.map((loop,i)=>loop.length===counts[i]?loop:resample(loop,counts[i])));
        const rings=sections.map((section,i)=>{const basis=resolve(doc,section.sketch.plane);return locals[i].map(loop=>loop.map(p=>world(basis,p.x,p.y)));});
        for(let i=1;i<rings.length;i++){
            if(rings[i].flat().every((p,j)=>p.distanceToSquared(rings[i-1].flat()[j])<EPS*EPS))throw new Error('相邻截面完全重合，请设置基准面偏移或选择不同位置的面。');
            for(let loop=0;loop<holeCount;loop++){
                const previous=rings[i-1][loop],current=rings[i][loop];let best=Infinity,offset=0,flip=false;
                // Correspondence may rotate a closed loop, but must not mirror
                // one parallel section independently and twist its side walls.
                const ringNormal=points=>{const normal=new CAD.Vector3(),origin=points[0];for(let j=1;j<points.length-1;j++)normal.add(points[j].clone().sub(origin).cross(points[j+1].clone().sub(origin)));return normal.normalize();};
                const alignment=ringNormal(previous).dot(ringNormal(current));
                const orientations=Math.abs(alignment)<1e-6?[false,true]:[alignment<0];
                for(const reversed of orientations)for(let shift=0;shift<current.length;shift++){let cost=0;for(let j=0;j<current.length;j++)cost+=previous[j].distanceToSquared(current[(shift+(reversed?-j:j)+current.length)%current.length]);if(cost<best){best=cost;offset=shift;flip=reversed;}}
                rings[i][loop]=current.map((_,j)=>current[(offset+(flip?-j:j)+current.length)%current.length]);
                locals[i][loop]=locals[i][loop].map((_,j,a)=>a[(offset+(flip?-j:j)+a.length)%a.length]);
            }
        }
        return skin(rings,locals,{planarQuads:true,planarSides:(step,loop,i)=>{const j=(i+1)%locals[step][loop].length;return straightBoundary(sections[step].sketch,locals[step][loop][i],locals[step][loop][j])&&straightBoundary(sections[step+1].sketch,locals[step+1][loop][i],locals[step+1][loop][j]);}});
    }
    throw new Error('未知截面特征。');
}

const faceKey=tag=>String(tag.featureId)+'/'+tag.face;
function mergeIntervals(values){const result=[];for(const interval of values.sort((a,b)=>a[0]-b[0])){const last=result.at(-1);if(last&&interval[0]<=last[1]+EPS)last[1]=Math.max(last[1],interval[1]);else result.push([...interval]);}return result;}
function intervals(polygons,normal,w,direction){const result=[];for(const polygon of polygons){const points=[];for(let i=0;i<polygon.vertices.length;i++){const a=polygon.vertices[i],b=polygon.vertices[(i+1)%polygon.vertices.length],da=a.dot(normal)-w,db=b.dot(normal)-w;if(Math.abs(da)<EPS)points.push(a.dot(direction));if(da*db<-EPS*EPS)points.push(a.clone().lerp(b,da/(da-db)).dot(direction));}if(points.length>1&&Math.max(...points)-Math.min(...points)>EPS)result.push([Math.min(...points),Math.max(...points)]);}return mergeIntervals(result);}
function rayFaceLimit(origin,direction,polygons){
    const values=[];for(const polygon of polygons){let low=0,high=Infinity;for(let i=0;i<polygon.vertices.length;i++){const a=polygon.vertices[i],edge=polygon.vertices[(i+1)%polygon.vertices.length].clone().sub(a),constant=edge.clone().cross(origin.clone().sub(a)).dot(polygon.normal),slope=edge.clone().cross(direction).dot(polygon.normal);if(Math.abs(slope)<EPS){if(constant< -EPS){high=-1;break;}}else if(slope>0)low=Math.max(low,(-EPS-constant)/slope);else high=Math.min(high,(-EPS-constant)/slope);}if(high>=low)values.push([low,high]);}
    const intervals=mergeIntervals(values);return intervals.find(v=>v[0]<1e-3)?.[1]??0;
}
const straightEdgeCache=new WeakMap();
export function solidEdgeOptions(solid,convexOnly=false,reference=null){
    let cached=straightEdgeCache.get(solid);if(!reference&&cached?.has(convexOnly))return cached.get(convexOnly);
    const groups=new Map();for(const polygon of solid){if(polygon.tag.face==='curved'||reference&&!matchesFace(polygon.tag,reference.faceA)&&!matchesFace(polygon.tag,reference.faceB))continue;const key=faceKey(polygon.tag);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(polygon);}
    const faces=[...groups.values()],result=[],boxes=faces.map(polygons=>{const box=new CAD.Box3();for(const polygon of polygons)for(const vertex of polygon.vertices)box.expandByPoint(vertex);return box.expandByScalar(EPS*2);});
    for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
        if(reference&&!matchesEdgeFaces(faces[i][0].tag,faces[j][0].tag,reference))continue;
        if(!boxes[i].intersectsBox(boxes[j]))continue;
        const a=faces[i][0],b=faces[j][0],dot=a.normal.dot(b.normal);if(Math.abs(dot)>1-1e-10)continue;
        const cross=a.normal.clone().cross(b.normal),direction=cross.clone().normalize(),origin=b.normal.clone().cross(cross).multiplyScalar(a.w).add(cross.clone().cross(a.normal).multiplyScalar(b.w)).divideScalar(cross.lengthSq());
        const first=intervals(faces[i],b.normal,b.w,direction),second=intervals(faces[j],a.normal,a.w,direction),shared=[];
        for(const x of first)for(const y of second){const from=Math.max(x[0],y[0]),to=Math.min(x[1],y[1]);if(to-from>EPS)shared.push([from,to]);}
        const segments=mergeIntervals(shared);
        const insideFace=(p,polygons)=>polygons.some(poly=>poly.vertices.every((a,i)=>{const b=poly.vertices[(i+1)%poly.vertices.length],d=b.clone().sub(a);return d.clone().cross(p.clone().sub(a)).dot(poly.normal)>=-EPS*d.length();}));
        for(let segment=0;segment<segments.length;segment++){const [from,to]=segments[segment];const middle=origin.clone().addScaledVector(direction,(from+to)/2),inward=direction.clone().cross(a.normal);if(inward.dot(b.normal)>0)inward.negate();const concave=!insideFace(middle.clone().addScaledVector(inward,Math.min(.001,(to-from)*.01)),faces[i]);if(convexOnly&&concave)continue;if(concave)inward.negate();const other=direction.clone().cross(b.normal);if(other.dot(a.normal)>0)other.negate();if(concave)other.negate();const limit=Math.min(rayFaceLimit(middle,inward,faces[i]),rayFaceLimit(middle,other,faces[j]));result.push({concave,faceA:{featureId:a.tag.featureId,face:a.tag.face},faceB:{featureId:b.tag.featureId,face:b.tag.face},segment,limit,a:origin.clone().addScaledVector(direction,from),b:origin.clone().addScaledVector(direction,to),normalA:a.normal,normalB:b.normal});}
    }
    if(!reference){if(!cached){cached=new Map();straightEdgeCache.set(solid,cached);}cached.set(convexOnly,result);}return result;
}
const treatmentCache=new WeakMap();
function curvedBoundaryOptions(solid,reference=null){
    const planes=new Map(),sides=new Map();
    for(const polygon of solid){if(reference&&!matchesFace(polygon.tag,reference.faceA)&&!matchesFace(polygon.tag,reference.faceB))continue;const key=faceKey(polygon.tag);if(polygon.tag.face!=='curved'){if(!planes.has(key))planes.set(key,[]);planes.get(key).push(polygon);}else{const n=polygon.normal,id=key+'/'+[n.x,n.y,n.z,polygon.w].map(v=>Math.round(v/1e-5)).join('/');if(!sides.has(id))sides.set(id,{faces:[],normal:n,tag:polygon.tag});sides.get(id).faces.push(polygon);}}
    const onFace=(point,polygon)=>Math.abs(point.dot(polygon.normal)-polygon.w)<EPS*4&&polygon.vertices.every((a,i)=>{const direction=polygon.vertices[(i+1)%polygon.vertices.length].clone().sub(a);return direction.clone().cross(point.clone().sub(a)).dot(polygon.normal)>=-EPS*4*direction.length();});
    const options=[];
    for(const faces of planes.values()){
        const normalA=faces[0].normal,u=(Math.abs(normalA.z)<.8?new CAD.Vector3(0,0,1):new CAD.Vector3(0,1,0)).cross(normalA).normalize(),v=normalA.clone().cross(u),origin=faces[0].vertices[0],frame={o:origin,u,v,n:normalA},groups=new Map();
        const world=p=>origin.clone().addScaledVector(u,p.x).addScaledVector(v,p.y);
        for(const segment of faceBoundarySegments(faces,frame)){
            const a=world(segment.a),b=world(segment.b),mid=a.clone().add(b).multiplyScalar(.5),side=[...sides.values()].find(side=>Math.abs(side.normal.dot(normalA))<.999&&side.faces.some(p=>onFace(mid,p)));
            if(!side)continue;
            const inwardA=side.normal.clone().negate().addScaledVector(normalA,side.normal.dot(normalA)).normalize(),inwardB=normalA.clone().negate().addScaledVector(side.normal,normalA.dot(side.normal)).normalize();
            const limit=Math.min(rayFaceLimit(mid,inwardA,faces),rayFaceLimit(mid,inwardB,side.faces));if(limit<.1001)continue;
            const key=faceKey(side.tag);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({a,b,normalB:side.normal,limit,tag:side.tag});
        }
        for(const segments of groups.values()){
            const key=p=>[p.x,p.y,p.z].map(v=>Math.round(v/1e-5)).join('/'),vertices=new Map(),graph=new Map();
            segments.forEach((segment,index)=>{for(const p of [segment.a,segment.b]){const id=key(p);vertices.set(id,p);if(!graph.has(id))graph.set(id,[]);graph.get(id).push(index);}});
            const used=new Set(),chains=[];
            for(const seed of [...graph.keys()].sort((a,b)=>(graph.get(a).length===2)-(graph.get(b).length===2)||a.localeCompare(b))){
                while(graph.get(seed).some(index=>!used.has(index))){let current=seed,previous=null;const points=[vertices.get(seed)],normals=[],limits=[];
                    while(true){const index=graph.get(current).find(index=>!used.has(index));if(index===undefined)break;const segment=segments[index];if(previous&&previous.dot(segment.normalB)<.9)break;used.add(index);const next=key(segment.a)===current?key(segment.b):key(segment.a);points.push(vertices.get(next));normals.push(segment.normalB);limits.push(segment.limit);current=next;previous=segment.normalB;if(current===seed||graph.get(current).length!==2)break;}
                    if(points.length<2)break;const closed=key(points[0])===key(points.at(-1));if(closed)points.pop();if(points.length<(closed?3:2)||points[0].distanceToSquared(points[1])<EPS*EPS)continue;
                    const frames=points.map((point,index)=>{const n=new CAD.Vector3();if(index>0)n.add(normals[index-1]);else if(closed)n.add(normals.at(-1));if(index<normals.length)n.add(normals[index]);return {point,normalA,normalB:n.normalize()};});
                    let curvature=Infinity;for(let i=closed?0:1;i<(closed?points.length:points.length-1);i++){const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length],ab=b.clone().sub(a),bc=c.clone().sub(b),cross=ab.clone().cross(bc).length();if(cross>EPS)curvature=Math.min(curvature,ab.length()*bc.length()*a.distanceTo(c)/(2*cross));}
                    chains.push({kind:'curve',closed,points,frames,a:points[0],b:points[1],normalA,normalB:frames[0].normalB,limit:Math.min(...limits,curvature*.9),faceA:{featureId:faces[0].tag.featureId,face:faces[0].tag.face},faceB:{featureId:segments[0].tag.featureId,face:'curved'}});
                }
            }
            chains.sort((a,b)=>{const center=edge=>new CAD.Box3().setFromPoints(edge.points).getCenter(new CAD.Vector3());const x=center(a),y=center(b);return x.x-y.x||x.y-y.y||x.z-y.z;});chains.forEach((edge,segment)=>options.push({...edge,segment}));
        }
    }
    return options;
}
export function edgeTreatmentOptions(solid){if(!treatmentCache.has(solid))treatmentCache.set(solid,[...solidEdgeOptions(solid,false),...curvedBoundaryOptions(solid)]);return treatmentCache.get(solid);}
const matchesFace=(a,b)=>a?.featureId===b?.featureId&&a?.face===b?.face;
const matchesEdgeFaces=(a,b,reference)=>matchesFace(a,reference.faceA)&&matchesFace(b,reference.faceB)||matchesFace(a,reference.faceB)&&matchesFace(b,reference.faceA);
const referencedEdgeCache=new WeakMap();
export function referencedEdgeOptions(solid,reference){
    const key=JSON.stringify([reference.kind??'line',...[reference.faceA,reference.faceB].map(face=>faceKey(face)).sort()]);
    let entries=referencedEdgeCache.get(solid);if(!entries){entries=new Map();referencedEdgeCache.set(solid,entries);}
    if(!entries.has(key))entries.set(key,(reference.kind??'line')==='curve'?curvedBoundaryOptions(solid,reference):solidEdgeOptions(solid,false,reference));
    return entries.get(key);
}
export function resolveSolidEdge(solid,reference,convexOnly=false){
    const edge=solidEdgeOptions(solid,convexOnly).find(edge=>edge.segment===reference?.segment&&(matchesFace(edge.faceA,reference.faceA)&&matchesFace(edge.faceB,reference.faceB)||matchesFace(edge.faceA,reference.faceB)&&matchesFace(edge.faceB,reference.faceA)));
    if(!edge)throw new Error('所选实体直边已不存在，请重新选择参照边。');return edge;
}
export function resolveChamferEdge(solid,reference){const edge=referencedEdgeOptions(solid,reference).find(edge=>(edge.kind??'line')===(reference?.kind??'line')&&edge.segment===reference?.segment&&(matchesFace(edge.faceA,reference.faceA)&&matchesFace(edge.faceB,reference.faceB)||matchesFace(edge.faceA,reference.faceB)&&matchesFace(edge.faceB,reference.faceA)));if(!edge)throw new Error('所选边已改变，请重新选择直边或曲线边。');return edge;}
function treatmentSection(feature,edge,n1,n2,arcSteps=null){
    const distance=feature.depth,tangent=n1.clone().cross(n2).normalize();
    const inward1=tangent.clone().cross(n1).normalize(),inward2=tangent.clone().cross(n2).normalize();if(inward1.dot(n2)>0)inward1.negate();if(inward2.dot(n1)>0)inward2.negate();if(edge.concave){inward1.negate();inward2.negate();}
    const fillet=feature.edgeTreatment==='fillet',theta=Math.acos(CAD.MathUtils.clamp(inward1.dot(inward2),-1,1)),d1=fillet?distance/Math.tan(theta/2):distance*(edge.topologyProfile?.first??1),d2=fillet?d1:distance*(edge.topologyProfile?.second??Math.tan((feature.chamferAngle??45)*Math.PI/180));
    if(!Number.isFinite(d1)||!Number.isFinite(d2))throw new Error('请输入有效的边缘尺寸。');
    const epsilon=(edge.concave?-1:1)*(feature.topologyBevel ? .002 : Math.max(.002,distance*.0002)),outside=n1.clone().add(n2).multiplyScalar(feature.topologyBevel?epsilon/(1+n1.dot(n2)):epsilon),p1=inward1.clone().multiplyScalar(d1),p2=inward2.clone().multiplyScalar(d2),offsets=[outside,p1.clone().addScaledVector(n1,epsilon),p1];
    const u=inward1,v=inward2.clone().addScaledVector(u,-inward2.dot(u)).normalize();
    if(fillet){const center=inward1.clone().add(inward2).normalize().multiplyScalar(distance/Math.sin(theta/2)),a=p1.clone().sub(center),b=p2.clone().sub(center),from=Math.atan2(a.dot(v),a.dot(u)),to=Math.atan2(b.dot(v),b.dot(u));let sweep=to-from;while(sweep>Math.PI)sweep-=Math.PI*2;while(sweep< -Math.PI)sweep+=Math.PI*2;
        const steps=arcSteps??feature.exportSegments??(feature.previewSegments===8?8:null)??Math.max(8,Math.min(48,Math.ceil(Math.abs(sweep)/(Math.PI/48)-1e-8)));for(let i=1;i<=steps;i++){const angle=from+sweep*i/steps;offsets.push(i===steps?p2.clone():center.clone().addScaledVector(u,distance*Math.cos(angle)).addScaledVector(v,distance*Math.sin(angle)));}
    }else offsets.push(p2);
    const arcStart=2,arcEnd=offsets.length-1;offsets.push(p2.clone().addScaledVector(n2,epsilon));
    return {arcStart,arcEnd,center:fillet?inward1.clone().add(inward2).normalize().multiplyScalar(distance/Math.sin(theta/2)):null,offsets,local:[offsets.map(offset=>new CAD.Vector2(offset.dot(u),offset.dot(v)))],fillet};
}

function treatmentFaceNames(faces,section){
    // Added exterior safety strips must not renumber the actual bevel face used
    // by existing sketches. Original bevel index 1 remains index 1.
    for(const face of faces){if(!face.face.startsWith('surface|'))continue;const parts=face.face.split('|'),index=Number(parts.at(-1));
        parts[parts.length-1]=index===1?'trimStart':index===section.arcEnd?'trimEnd':String(index>section.arcEnd?section.arcEnd-1:index>=section.arcStart?index-1:index);face.face=parts.join('|');}
    return faces;
}
export function chamferFaces(solid,feature,resolved=null){
    const edge=resolved??resolveChamferEdge(solid,feature.chamferEdge);
    if(edge.kind==='curve'){
        if(!edge.frames?.length||edge.frames.some(frame=>!frame.point||!frame.normalA||!frame.normalB))throw new Error('圆形边界数据无效，请重新选择边界。');
        const circle=circleOf(edge),frames=circle?.frames??edge.frames;
        let sections=frames.map(frame=>treatmentSection(feature,edge,frame.normalA,frame.normalB));
        // A rail needs the same topology at every station. Floating point angle
        // noise (24 versus 25 samples) and changing dihedral angles must not create
        // mismatched rings; both cause missing vertices when the skin is connected.
        if(feature.edgeTreatment==='fillet'){
            const samples=Math.max(...sections.map(section=>section.arcEnd-section.arcStart));
            if(sections.some(section=>section.arcEnd-section.arcStart!==samples))sections=frames.map(frame=>treatmentSection(feature,edge,frame.normalA,frame.normalB,samples));
        }
        const rings=sections.map((section,index)=>[section.offsets.map(offset=>offset.clone().add(frames[index].point))]);
        if(!edge.closed)for(const side of [0,1]){
            const cap=edge.exportEndJunctions?.[side];if(!cap)continue;
            const index=side?frames.length-1:0,axis=frames[index].normalA.clone().cross(frames[index].normalB).normalize(),denominator=axis.dot(cap.normal);
            // A tangent end constraint has no axial projection. Export clips
            // that cutter by the real half-space after mesh construction.
            if(Math.abs(denominator)<1e-8)continue;
            const interior=frames[side?index-1:1].point.clone().sub(frames[index].point),sign=axis.dot(interior)>0?-1:1;
            rings[index][0]=rings[index][0].map(point=>point.clone().addScaledVector(axis,-point.clone().sub(cap.origin).dot(cap.normal)/denominator+sign*Math.max(.002,feature.depth*.0002)));
        }
        // Offsetting a curved rail can reverse its inner stations. Skinning
        // those rings as one shell folds the cutter through itself, even if
        // every mesh edge still has two incident triangles. Export must use
        // the swept VOLUME there, not this self-intersecting oriented shell.
        let exportSweepCells=null;
        if(feature.exportSegments){
            const steps=edge.closed?frames.length:frames.length-1;
            let folded=false;
            for(let step=0;step<steps&&!folded;step++){
                const next=(step+1)%frames.length,direction=frames[next].point.clone().sub(frames[step].point);
                for(let vertex=0;vertex<rings[step][0].length;vertex++)if(rings[next][0][vertex].clone().sub(rings[step][0][vertex]).dot(direction)<0){folded=true;break;}
            }
            if(folded){
                const triangles=CAD.ShapeUtils.triangulateShape(sections[0].local[0]);exportSweepCells=[];
                // Each triangular section sweeps a small convex cell between
                // stations. Union regularizes overlaps at a curvature collapse;
                // triangulating first preserves a non-convex cutter profile.
                for(let step=0;step<steps;step++)for(const triangle of triangles){
                    const next=(step+1)%frames.length;
                    exportSweepCells.push([...triangle.map(i=>rings[step][0][i]),...triangle.map(i=>rings[next][0][i])]);
                }
            }
        }
        const normalRings=feature.edgeTreatment==='fillet'?sections.map(section=>[section.offsets.map((offset,index)=>index>=section.arcStart&&index<=section.arcEnd?offset.clone().sub(section.center).normalize():null)]):null;
        const faces=treatmentFaceNames(skin(rings,[sections[0].local,sections.at(-1).local],{closed:edge.closed,planarSides:(_,loop,index)=>!(feature.edgeTreatment==='fillet'&&index>=sections[0].arcStart&&index<sections[0].arcEnd),normalRings}),sections[0]);
        if(circle&&feature.edgeTreatment==='fillet'){
            const surface={kind:'torus',center:circle.center.clone().addScaledVector(edge.normalA,-feature.depth),axis:edge.normalA,majorRadius:circle.radius-circle.sign*feature.depth};
            for(const face of faces)if(face.face==='curved')face.smooth=surface;
        }
        if(exportSweepCells)faces.exportSweepCells=exportSweepCells;
        return faces;
    }
    const section=treatmentSection(feature,edge,edge.normalA,edge.normalB),tangent=edge.b.clone().sub(edge.a).normalize(),epsilon=feature.topologyBevel?feature.depth*4/Math.sqrt(Math.max(1e-6,(1+edge.normalA.dot(edge.normalB))/2)):Math.max(.002,feature.depth*.0002),start=edge.a.clone().addScaledVector(tangent,-epsilon),end=edge.b.clone().addScaledVector(tangent,epsilon),rings=[start,end].map(p=>[section.offsets.map(offset=>offset.clone().add(p))]);
    for(let side=0;side<2;side++){
        const joint=edge.exportEndJunctions?.[side];if(!joint)continue;
        if(Math.abs(tangent.dot(joint.normal))<1e-8)continue;
        // Extend the complete cutter ring, including its exterior safety
        // strips, through the shared mitre. Keeping the old epsilon-length
        // cap here leaves a thin, but watertight, notch.
        const endpoint=side?edge.b:edge.a;
        rings[side]=[section.offsets.map((offset,index)=>{
            let point;
            if(joint.round&&index>=section.arcStart&&index<=section.arcEnd){
                const end=roundEnd(offset.clone().divideScalar(feature.depth),tangent,joint.round,joint.normal);
                if(!end)throw new Error('圆角交接曲线无法求解。');
                point=endpoint.clone().addScaledVector(end.offset,feature.depth);
            }else{
                point=endpoint.clone().add(offset);
                point.addScaledVector(tangent,-point.clone().sub(joint.origin).dot(joint.normal)/tangent.dot(joint.normal));
            }
            // The cutting volumes must overlap across the seam. Merely
            // touching caps leave a zero-thickness contact in mesh booleans.
            // Use only the existing exterior safety overlap. A full-radius
            // extension crosses unrelated support faces at short corners.
            // Retain the same exterior overlap at inherited stock caps too,
            // avoiding a coincident cutter/stock face in the boolean kernel.
            return point.addScaledVector(tangent,(side?1:-1)*Math.max(.002,feature.depth*.0002));
        })];
    }
    return treatmentFaceNames(skin(rings,[section.local,section.local],{minimumAreaSq:feature.exportSegments?0:1e-14,planarSides:(_,loop,index)=>!(section.fillet&&index>=section.arcStart&&index<section.arcEnd)}),section).map(face=>({...face,smooth:section.fillet&&face.face==='curved'?{kind:'cylinder',center:edge.a.clone().add(section.center),axis:tangent}:null}));
}

