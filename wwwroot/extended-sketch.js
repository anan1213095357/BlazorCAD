import {outline} from './sketch-tools.js';

const relation=(point,target)=>target?{id:crypto.randomUUID(),point,target:point==='perimeter'&&target.kind==='modelEdge'?{...target,kind:'modelEdgePoint'}:target}:null;
const entity=(kind,values)=>({id:crypto.randomUUID(),kind,x:0,y:0,width:1,height:1,radius:1,angle:0,sides:6,startAngle:0,sweepAngle:90,fixedPoint:'none',construction:false,dimensionedEdges:[],modelDimensions:[],coincidences:[],dimensionPlacements:{},...values});
function circumcircle(a,b,c){
    const bx=b.x-a.x,by=b.y-a.y,cx=c.x-a.x,cy=c.y-a.y,d=2*(bx*cy-by*cx);
    if(Math.abs(d)<1e-6)throw new Error('三点接近共线，请重新选择第三点');
    const u=bx*bx+by*by,v=cx*cx+cy*cy,x=a.x+(cy*u-by*v)/d,y=a.y+(bx*v-cx*u)/d;
    return {x,y,radius:Math.hypot(x-a.x,y-a.y)};
}
export class ExtendedSketch {
    constructor(commit,hint){this.commit=commit;this.hint=hint;this.points=[];this.version=0;}
    owns(tool){return ['circle3','arc','polygon','polyline'].includes(tool);}
    configure(sketchId,tool,entities=[]){const key=sketchId+'/'+tool;if(this.context!==key){this.context=key;this.cancel();}else if(this.points.some(p=>p.reference?.kind==='sketch'&&!entities.some(e=>e.id===p.reference.entityId)))this.cancel();this.tool=tool;}
    cancel(){this.version++;const active=this.points.length>0;this.points=[];this.first=null;return active;}
    build(point,sides=6){
        const points=[...this.points,{point}],a=points[0]?.point,b=points[1]?.point,c=points[2]?.point;
        if(!a||!b)return null;
        if(this.tool==='polygon'){const radius=a.distanceTo(b);if(radius<1)return null;return entity('polygon',{x:a.x,y:a.y,radius,sides,angle:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI});}
        if(this.tool==='polyline')return a.distanceTo(b)>=1?entity('line',{x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y}):null;
        if(this.tool==='circle3')return c?entity('circle',circumcircle(a,b,c)):null;
        if(this.tool==='arc'){
            const radius=a.distanceTo(b),startAngle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
            const end=c??b,angle=Math.atan2(end.y-a.y,end.x-a.x)*180/Math.PI;
            const sweepAngle=c?((angle-startAngle)%360+360)%360:90;
            if(radius<1||sweepAngle<1||sweepAngle>359)return null;
            return entity('arc',{x:a.x,y:a.y,radius,startAngle,sweepAngle});
        }
        return null;
    }
    preview(point,sides){
        if(!this.points.length)return [];
        try{const e=this.build(point,sides);return e?[outline(e)]:[[this.points[0].point.toArray(),point.toArray()]];}catch{return [this.points.map(p=>p.point.toArray()).concat([point.toArray()])];}
    }
    async click(point,reference,sides){
        if(this.busy)return;
        const needed=['circle3','arc'].includes(this.tool)?3:2;
        if(this.points.length<needed-1){this.points.push({point:point.clone(),reference:reference?structuredClone(reference):null});this.hint(this.tool==='arc'?(this.points.length===1?'已定圆心，请选择圆弧起点':'请沿逆时针选择圆弧终点'):this.tool==='circle3'?'继续选择圆上的点':this.tool==='polygon'?'请选择多边形的第一个顶点':'继续点选折线端点，吸附首点闭合，Esc 结束');return;}
        let e;try{e=this.build(point,sides);}catch(error){this.hint(error.message);return;}
        if(!e){this.hint('图形太小或圆弧扫角无效，请重新选择终点');return;}
        const all=[...this.points,{point,reference}],attach=(name,target)=>{const c=relation(name,target);if(c)e.coincidences.push(c);};
        if(this.tool==='circle3')for(const p of all)attach('perimeter',p.reference);
        if(this.tool==='polygon'){attach('center',all[0].reference);attach('vertex0',reference);}
        if(this.tool==='polyline'){attach('start',all[0].reference);attach('end',reference);}
        if(this.tool==='arc'){
            attach('center',all[0].reference);attach('start',all[1].reference);
            if(reference&&Math.abs(Math.hypot(point.x-e.x,point.y-e.y)-e.radius)>.001){this.hint('吸附终点不在当前圆弧半径上，请选择圆弧上的点或按 Alt 暂停吸附');return;}
            attach('end',reference);
        }
        const tool=this.tool,context=this.context,version=this.version;this.busy=true;
        try{
            const error=await this.commit(e,tool);if(this.context!==context||this.version!==version)return;
            if(error){this.hint(error);return;}
            if(tool==='polyline'){
                const closes=this.first&&reference?.kind==='sketch'&&reference.entityId===this.first.id&&reference.point==='start';
                if(!this.first)this.first={id:e.id};
                this.points=closes?[]:[{point:point.clone(),reference:{kind:'sketch',entityId:e.id,point:'end',faces:[]}}];if(closes)this.first=null;
            }else this.points=[];
        }catch{this.hint('图形未保存，请重试');}finally{this.busy=false;}
    }
}
