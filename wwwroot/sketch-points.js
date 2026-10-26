export const geometryValues=e=>[e.x,e.y,e.width,e.height,e.radius];
export const hasRelations=e=>!!(e.modelDimensions?.length||e.coincidences?.length||e.referenceLineId);
export function pointRows(e,name) {
    const x=[1,0,0,0,0],y=[0,1,0,0,0];
    const finish=()=>{
        if(!['slot','ellipse'].includes(e.kind)||!e.angle)return [x,y];
        const a=e.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
        return [[1,0,.5+c*(x[2]-.5)-s*y[2],c*x[3]-s*(y[3]-.5),0],[0,1,s*(x[2]-.5)+c*y[2],.5+s*x[3]+c*(y[3]-.5),0]];
    };
    const points={bottomLeft:[0,0],bottomRight:[1,0],topRight:[1,1],topLeft:[0,1],bottomMid:[.5,0],rightMid:[1,.5],topMid:[.5,1],leftMid:[0,.5],center:[.5,.5],start:[0,0],end:[1,1]};
    if(e.kind==='polygon'||e.kind==='arc'){
        if(name==='center')return [x,y];
        let a,b;
        if(e.kind==='arc'){a=(e.startAngle+(name==='end'?e.sweepAngle:name==='midArc'?e.sweepAngle/2:0))*Math.PI/180;b=a;}
        else {const index=Number(name.replace(/^(vertex|mid)/,''));a=(e.angle??0)*Math.PI/180+index*2*Math.PI/e.sides;b=name.startsWith('mid')?a+2*Math.PI/e.sides:a;}
        x[4]=(Math.cos(a)+Math.cos(b))/2;y[4]=(Math.sin(a)+Math.sin(b))/2;return [x,y];
    }
    if(e.kind==='ellipse'){
        const p={center:[.5,.5],east:[1,.5],north:[.5,1],west:[0,.5],south:[.5,0]}[name];if(!p)throw new Error('椭圆参照点无效');x[2]=p[0];y[3]=p[1];return finish();
    }
    if(e.kind==='circle') {
        const radii={center:[0,0],east:[1,0],north:[0,1],west:[-1,0],south:[0,-1]}[name];
        if(!radii)throw new Error('圆的重合点引用无效。');x[4]=radii[0];y[4]=radii[1];return [x,y];
    }
    if(e.kind==='slot'&&(name==='leftCenter'||name==='rightCenter')){x[2]=name==='rightCenter'?1:0;x[3]=name==='rightCenter'?-.5:.5;y[3]=.5;return finish();}
    const p=points[name];if(!p)throw new Error('草图点引用无效。');x[2]=p[0];y[3]=p[1];return finish();
}
export function pointValue(e,name) {
    const v=geometryValues(e);return pointRows(e,name).map(row=>row.reduce((sum,a,i)=>sum+a*v[i],0));
}
export function entitySnapPoints(e) {
    let names;
    if(e.kind==='polygon')names=['center',...Array.from({length:e.sides},(_,i)=>'vertex'+i),...Array.from({length:e.sides},(_,i)=>'mid'+i)];
    else if(e.kind==='arc')names=['center','start','end','midArc'];
    else if(e.kind==='circle'||e.kind==='ellipse')names=['center','east','north','west','south'];
    else if(e.kind==='line')names=['start','end','center'];
    else if(e.kind==='slot')names=['leftCenter','rightCenter','center','topMid','bottomMid'];
    else names=['bottomLeft','bottomRight','topRight','topLeft','bottomMid','rightMid','topMid','leftMid','center'];
    return names.map(name=>({point:pointValue(e,name),name,kind:name==='center'||name.endsWith('Center')?'center':(name.endsWith('Mid')||name.startsWith('mid'))?'midpoint':'vertex',label:e.kind==='circle'?(name==='center'?'圆心':'圆象限点'):name.endsWith('Mid')?'草图边中点':name==='center'?'草图中心':'草图点'}));
}
