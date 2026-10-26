import {slotToWorld,outline,radial} from './sketch-tools.js';
import {edgePoint,dimensionReference} from './model-dimensions.js';
// Dimension layout is independent of geometric constraints. Saved X/Y values
// are offsets from automatic placement, so labels follow their source geometry.
export function displayEdges(e) {
    return [...new Set(e.dimensionedEdges??[])];
}
const number=n=>Number(n.toFixed(2)).toString();
export function dimensionLayout(sketch,e,index,override=null,modelEdges=[]) {
    let a,b,base,text,circle=false,arc=false;
    const manual=index<0||(e.dimensionedEdges??[]).includes(index);
    if(index < -1) {
        const d=e.modelDimensions?.find(d=>d.index===index);if(!d)return null;
        const reference=dimensionReference(sketch,d,modelEdges),[nx,ny]=reference.normal;
        a=edgePoint(e,d.edge);const gap=nx*a[0]+ny*a[1]-reference.constant;b=[a[0]-nx*gap,a[1]-ny*gap];
        base=[(a[0]+b[0])/2-ny*12,(a[1]+b[1])/2+nx*12];text=`间距 ${number(d.distance)}`;
    } else if(index===-1) {
        const line=sketch.entities.find(l=>l.id===e.referenceLineId);if(!line)return null;
        const length=Math.hypot(line.width,line.height),nx=-line.height/length,ny=line.width/length;
        a=[radial(e)?e.x:e.x+e.width/2,radial(e)?e.y:e.y+e.height/2];
        b=[a[0]-nx*e.referenceOffset,a[1]-ny*e.referenceOffset];
        base=[(a[0]+b[0])/2+line.width/length*10,(a[1]+b[1])/2+line.height/length*10];
        text=`参考 ${number(e.referenceOffset)}`;
    } else if(e.kind==='arc') {
        arc=true;const angle=(e.startAngle+e.sweepAngle/2)*Math.PI/180;a=[e.x,e.y];b=[e.x+e.radius*Math.cos(angle),e.y+e.radius*Math.sin(angle)];base=[b[0]+Math.cos(angle)*12,b[1]+Math.sin(angle)*12];text=`R ${number(e.radius)}`;
    } else if(e.kind==='polygon'){
        const points=outline(e);a=points[index];b=points[index+1];const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);base=[(a[0]+b[0])/2+dy/length*12,(a[1]+b[1])/2-dx/length*12];text=number(length);
    } else if(e.kind==='ellipse'){
        const cx=e.x+e.width/2,cy=e.y+e.height/2;a=index===0?[e.x,cy]:[cx,e.y];b=index===0?[e.x+e.width,cy]:[cx,e.y+e.height];base=index===0?[cx,cy-e.height/2-12]:[cx+e.width/2+12,cy];text=`Ø ${number(index===0?e.width:e.height)}`;
        a=slotToWorld(e,a);b=slotToWorld(e,b);base=slotToWorld(e,base);
    } else if(e.kind==='circle') {
        circle=true;base=[e.x+e.radius+12,e.y+e.radius+8];text=`Ø ${number(e.radius*2)}`;
    } else if(e.kind==='line') {
        a=[e.x,e.y];b=[e.x+e.width,e.y+e.height];const length=Math.hypot(e.width,e.height);
        base=[(a[0]+b[0])/2-e.height/length*10,(a[1]+b[1])/2+e.width/length*10];text=number(length);
    } else {
        const points=[[e.x,e.y],[e.x+e.width,e.y],[e.x+e.width,e.y+e.height],[e.x,e.y+e.height]];
        if(e.kind==='slot') {
            a=index===0?points[0]:points[1];b=index===0?points[1]:points[2];
            base=index===0?[e.x+e.width/2,e.y-12]:[e.x+e.width+12,e.y+e.height/2];
        } else {
            a=points[index];b=points[(index+1)%4];
            const offsets=[[0,-12],[12,0],[0,12],[-12,0]][index];base=[(a[0]+b[0])/2+offsets[0],(a[1]+b[1])/2+offsets[1]];
        }
        text=number(index%2===0?e.width:e.height);
    }
    if(e.kind==='slot'&&index>=0){a=slotToWorld(e,a);b=slotToWorld(e,b);base=slotToWorld(e,base);}
    const saved=e.dimensionPlacements?.[index]??{x:0,y:0};
    const position=override??[base[0]+saved.x,base[1]+saved.y];
    const lines=[],extensions=[],arrows=[];
    const arrow=(p,dx,dy,size=1.6)=>{
        arrows.push([p,[p[0]+dx*size-dy*.55*size,p[1]+dy*size+dx*.55*size]]);
        arrows.push([p,[p[0]+dx*size+dy*.55*size,p[1]+dy*size-dx*.55*size]]);
    };
    if(arc){const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);lines.push([a,b],[b,position]);arrow(b,-dx/length,-dy/length);}
    else if(circle) {
        const dx=position[0]-e.x,dy=position[1]-e.y,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d;
        a=[e.x-ux*e.radius,e.y-uy*e.radius];b=[e.x+ux*e.radius,e.y+uy*e.radius];
        lines.push([a,b],[b,position]);arrow(a,ux,uy);arrow(b,-ux,-uy);
    } else {
        const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
        // Zero reference distance still has a draggable label and leader.
        const ux=len>1e-7?dx/len:0,uy=len>1e-7?dy/len:1,nx=-uy,ny=ux;
        const offset=(position[0]-a[0])*nx+(position[1]-a[1])*ny;
        const p=[a[0]+nx*offset,a[1]+ny*offset],q=[b[0]+nx*offset,b[1]+ny*offset];
        extensions.push([a,p],[b,q]);lines.push([p,q]);
        const along=(position[0]-p[0])*ux+(position[1]-p[1])*uy;
        if(along<0)lines.push([p,position]);else if(along>len)lines.push([q,position]);
        const size=Math.max(.5,Math.min(1.6,len/4));arrow(p,ux,uy,size);arrow(q,-ux,-uy,size);
    }
    return {position,base,text,manual,lines,extensions,arrows};
}
