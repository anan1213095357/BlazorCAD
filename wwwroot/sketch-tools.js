export const radial=e=>['circle','arc','polygon'].includes(e.kind);
export function slotToWorld(e,p){
    if(!['slot','ellipse'].includes(e.kind)||!e.angle)return [...p];
    const a=e.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=e.x+e.width/2,cy=e.y+e.height/2,dx=p[0]-cx,dy=p[1]-cy;
    return [cx+c*dx-s*dy,cy+s*dx+c*dy];
}
export function slotToLocal(e,p){return slotToWorld({...e,angle:-(e.angle??0)},p);}
// Shared sketch geometry and remaining degrees of freedom.
export function outline(e) {
    if(e.kind==='line')return [[e.x,e.y],[e.x+e.width,e.y+e.height]];
    if(e.kind==='circle')return Array.from({length:97},(_,i)=>[e.x+e.radius*Math.cos(i*Math.PI/48),e.y+e.radius*Math.sin(i*Math.PI/48)]);
    if(e.kind==='polygon')return Array.from({length:e.sides+1},(_,i)=>{const a=(e.angle??0)*Math.PI/180+i*2*Math.PI/e.sides;return [e.x+e.radius*Math.cos(a),e.y+e.radius*Math.sin(a)];});
    if(e.kind==='ellipse')return Array.from({length:97},(_,i)=>slotToWorld(e,[e.x+e.width/2+e.width/2*Math.cos(i*Math.PI/48),e.y+e.height/2+e.height/2*Math.sin(i*Math.PI/48)]));
    if(e.kind==='arc'){const n=Math.max(8,Math.ceil(Math.abs(e.sweepAngle)/3));return Array.from({length:n+1},(_,i)=>{const a=(e.startAngle+e.sweepAngle*i/n)*Math.PI/180;return [e.x+e.radius*Math.cos(a),e.y+e.radius*Math.sin(a)];});}
    if(e.kind==='slot') {
        const r=e.height/2,left=e.x+r,right=e.x+e.width-r,cy=e.y+r,points=[];
        for(let i=0;i<=32;i++){const a=-Math.PI/2+i*Math.PI/32;points.push([right+r*Math.cos(a),cy+r*Math.sin(a)]);}
        for(let i=0;i<=32;i++){const a=Math.PI/2+i*Math.PI/32;points.push([left+r*Math.cos(a),cy+r*Math.sin(a)]);}
        return [...points,points[0]].map(p=>slotToWorld(e,p));
    }
    return [[e.x,e.y],[e.x+e.width,e.y],[e.x+e.width,e.y+e.height],[e.x,e.y+e.height],[e.x,e.y]];
}
export const edgeCount=e=>e.kind==='polygon'?e.sides:e.kind==='circle'||e.kind==='arc'||e.kind==='line'?1:['slot','ellipse'].includes(e.kind)?2:4;
export function effectiveAnchor(e) {
    if(e.fixedPoint&&e.fixedPoint!=='none')return e.fixedPoint;
    const allowed=radial(e)?['center']:e.kind==='line'?['start','end']:['bottomLeft','bottomRight','topLeft','topRight','center'];
    return e.coincidences?.find(c=>allowed.includes(c.point)&&c.target.kind!=='modelEdge')?.point??'none';
}
export function anchor(e) {
    if(['slot','ellipse'].includes(e.kind)&&e.angle)return slotToWorld(e,anchor({...e,angle:0}));
    const name=effectiveAnchor(e);
    if(radial(e)||name==='start')return [e.x,e.y];
    if(name==='end')return [e.x+e.width,e.y+e.height];
    if(name==='center')return [e.x+e.width/2,e.y+e.height/2];
    if(name==='topLeft')return [e.x,e.y+e.height];
    if(name==='topRight')return [e.x+e.width,e.y+e.height];
    if(name==='bottomRight')return [e.x+e.width,e.y];
    return [e.x,e.y];
}
export function handles(e) {
    const center=radial(e)?[e.x,e.y]:[e.x+e.width/2,e.y+e.height/2];
    if(e.kind==='polygon')return [{point:center,handle:'move'},...outline(e).slice(0,-1).map(point=>({point,handle:'radius'}))];
    if(e.kind==='arc'){const points=outline(e);return [{point:center,handle:'move'},...[points[0],points[Math.floor(points.length/2)],points.at(-1)].map(point=>({point,handle:'radius'}))];}
    if(e.kind==='circle')return [{point:center,handle:'move'},...[0,1,2,3].map(i=>({point:[e.x+Math.cos(i*Math.PI/2)*e.radius,e.y+Math.sin(i*Math.PI/2)*e.radius],handle:'radius'}))];
    if(e.kind==='line')return [{point:[e.x,e.y],handle:'start'},{point:[e.x+e.width,e.y+e.height],handle:'end'},{point:center,handle:'move'}];
    if(['slot','ellipse'].includes(e.kind))return [{point:[e.x,center[1]],handle:'left'},{point:[e.x+e.width,center[1]],handle:'right'},{point:[center[0],e.y],handle:'bottom'},{point:[center[0],e.y+e.height],handle:'top'},{point:center,handle:'move'}].map(h=>({...h,point:slotToWorld(e,h.point)}));
    return [{point:[e.x,e.y],handle:'bottomLeft'},{point:[e.x+e.width,e.y],handle:'bottomRight'},{point:[e.x+e.width,e.y+e.height],handle:'topRight'},{point:[e.x,e.y+e.height],handle:'topLeft'},{point:center,handle:'move'}];
}
const fractions={bottomLeft:[0,0],bottomRight:[1,0],topRight:[1,1],topLeft:[0,1],center:[.5,.5],left:[0,null],right:[1,null],bottom:[null,0],top:[null,1]};
const fixed=e=>effectiveAnchor(e)!=='none';
export function dragMode(e,handle,translate=false) {
    const dims=e.dimensionedEdges??[],locked=fixed(e);
    if(translate||handle==='move')return locked?'locked':'move';
    if(radial(e))return !dims.length?'radius':locked?'locked':'move';
    if(e.kind==='line') {
        if(!locked)return dims.length||handle==='body'?'move':'endpoint';
        if(handle==='body'||(effectiveAnchor(e)==='start'&&handle==='start')||(effectiveAnchor(e)==='end'&&handle==='end'))return 'locked';
        return dims.length?'rotate':'endpoint';
    }
    const point=fractions[handle]??[null,null],a=locked?(fractions[effectiveAnchor(e)]??[0,0]):null;
    const axes=[0,1].filter(axis=>point[axis]!==null&&!dims.some(i=>i%2===axis)&&(!a||Math.abs(point[axis]-a[axis])>1e-7));
    if(!axes.length)return locked?'locked':'move';
    return axes.length===2?'resize-both':axes[0]===0?'resize-x':'resize-y';
}
export function dragEntity(source,start,p,handle,translate=false) {
    if(['slot','ellipse'].includes(source.kind)&&source.angle){
        const a=slotToLocal(source,[start.x,start.y]),b=slotToLocal(source,[p.x,p.y]);
        const result=dragEntity({...source,angle:0},{x:a[0],y:a[1]},{x:b[0],y:b[1]},handle,translate);
        const center=slotToWorld(source,[result.x+result.width/2,result.y+result.height/2]);
        return {...result,angle:source.angle,x:center[0]-result.width/2,y:center[1]-result.height/2};
    }
    const e=structuredClone(source),mode=dragMode(e,handle,translate),locked=fixed(e),dx=p.x-start.x,dy=p.y-start.y;
    if(mode==='locked')return e;
    if(mode==='move'){e.x+=dx;e.y+=dy;return e;}
    if(radial(e)) {
        e.radius=Math.max(1,e.radius+Math.hypot(p.x-e.x,p.y-e.y)-Math.hypot(start.x-e.x,start.y-e.y));return e;
    }
    if(e.kind==='line') {
        const movingStart=handle==='start',a=movingStart?[source.x+source.width,source.y+source.height]:[source.x,source.y];
        let x=(movingStart?source.x:source.x+source.width)+dx,y=(movingStart?source.y:source.y+source.height)+dy;
        if(mode==='rotate'){const length=Math.hypot(source.width,source.height),distance=Math.hypot(x-a[0],y-a[1]);if(distance<1e-7)return e;x=a[0]+(x-a[0])/distance*length;y=a[1]+(y-a[1])/distance*length;}
        if(movingStart){e.x=x;e.y=y;e.width=a[0]-x;e.height=a[1]-y;}else{e.width=x-a[0];e.height=y-a[1];}
        return Math.hypot(e.width,e.height)<1?structuredClone(source):e;
    }
    const point=fractions[handle],a=locked?fractions[effectiveAnchor(e)]:null;
    for(const axis of [0,1]) {
        if(point[axis]===null||(e.dimensionedEdges??[]).some(i=>i%2===axis))continue;
        const anchorFraction=a?a[axis]:1-point[axis],denominator=point[axis]-anchorFraction;
        if(Math.abs(denominator)<1e-7)continue;
        const size=axis===0?'width':'height',origin=axis===0?'x':'y',delta=axis===0?dx:dy;
        let value=Math.max(1,source[size]+delta/denominator);
        if(e.kind==='slot')value=axis===0?Math.max(value,e.height):Math.min(value,e.width);
        e[size]=value;e[origin]=source[origin]+anchorFraction*(source[size]-value);
    }
    return e;
}

// Analytic straight edges only: never treat curve tessellation as a rotation axis.
export function rotationEdges(e){
    if(e.kind==='line')return [{index:0,a:[e.x,e.y],b:[e.x+e.width,e.y+e.height]}];
    if(e.kind==='rectangle'||e.kind==='polygon'){const points=outline(e);return points.slice(0,-1).map((a,index)=>({index,a,b:points[index+1]}));}
    if(e.kind==='slot'&&e.width>e.height){const r=e.height/2;return [{index:0,a:slotToWorld(e,[e.x+r,e.y]),b:slotToWorld(e,[e.x+e.width-r,e.y])},{index:2,a:slotToWorld(e,[e.x+e.width-r,e.y+e.height]),b:slotToWorld(e,[e.x+r,e.y+e.height])}];}
    return [];
}
