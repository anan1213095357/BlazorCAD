// Match the visibility of selectable stock edges to the displayed edge cuts.
// Work only at scene rebuild time; never change mesh tessellation while dragging.
function roundOutside(p,row,start,radius,epsilon,fallback){
    const joint=row[start?'roundStart':'roundEnd'];if(!joint)return fallback;
    const axis=[row[4],row[5],row[6]],dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
    const local=p.map((v,i)=>(v-row[i]-axis[i]*(start?0:row[7]))/radius);
    const common=joint.common.toArray(),height=dot(local,common),t=dot(local,axis),knots=joint.knots;let boundary;
    if(height<knots[0].height-1e-8||height>knots.at(-1).height+1e-8){
        const wall=joint.wall.toArray(),denominator=dot(wall,axis);if(Math.abs(denominator)<1e-8)return fallback;
        boundary=-dot(local.map((v,i)=>v-axis[i]*t),wall)/denominator;
    }else{
        let index=0;while(index<knots.length-2&&knots[index+1].height<height)index++;
        const a=knots[index],b=knots[index+1],fraction=Math.max(0,Math.min(1,(height-a.height)/(b.height-a.height)));
        boundary=a.shift+(b.shift-a.shift)*fraction;
        if(Math.abs(height)<epsilon/radius){const width=a.width+(b.width-a.width)*fraction;if(Math.abs(width)>1e-8){const transverse=joint.common.clone().cross({x:axis[0],y:axis[1],z:axis[2]}).toArray();boundary*=dot(local,transverse)/width;}}
    }
    return start?t<boundary-epsilon/radius:t>boundary+epsilon/radius;
}
function removed(p,row){
    const radius=row[36],bevel=row[37],ratio=row[38];if(radius<0)return false;
    if(p[0]<row[28]||p[1]<row[29]||p[2]<row[30]||p[0]>row[32]||p[1]>row[33]||p[2]>row[34])return false;
    const q=[p[0]-row[0],p[1]-row[1],p[2]-row[2]],dot=(a,offset)=>a[0]*row[offset]+a[1]*row[offset+1]+a[2]*row[offset+2];
    const epsilon=Math.max(row[19]??0,.00005,Math.max(Math.abs(row[0]),Math.abs(row[1]),Math.abs(row[2]))*.0000005+radius*.000002);
    let alpha,beta;
    if(row[3]>.5){
        const relative=[p[0]-row[24],p[1]-row[25],p[2]-row[26]],height=dot(relative,20),planar=relative.map((value,i)=>value-height*row[20+i]);
        let angle=Math.atan2(dot(planar,12),dot(planar,8));
        if(row[3]>1.5){const angularTolerance=Math.max(.00001,epsilon/Math.max(Math.hypot(...planar),.00001));if(angle< -angularTolerance)angle+=2*Math.PI;if(angle>row[39]+angularTolerance)return false;}
        const step=2*Math.PI/row[11],local=((angle%step)+step)%step-step/2,chord=Math.cos(step/2)/Math.cos(local);
        alpha=-(Math.hypot(...planar)/chord-row[23])*row[27];beta=-dot(q,20);
        const tolerance=Math.max(epsilon,row[23]*.000002);
        if(bevel>.5)return alpha>=-tolerance&&beta>=-tolerance&&alpha+beta/ratio<radius-tolerance;
        if(Math.abs(alpha)<=tolerance&&beta>=-tolerance&&beta<radius+tolerance)return true;
        if(Math.abs(beta)<=tolerance&&alpha>=-tolerance&&alpha<radius+tolerance)return true;
        return alpha>=-tolerance&&beta>=-tolerance&&alpha+beta<=radius+tolerance&&(alpha-radius)**2+(beta-radius)**2>radius*radius-Math.max(.000001,radius*radius*.000001);
    }else{
        const t=dot(q,4),endTolerance=Math.max(.002,row[7]*.000002,epsilon);
        for(const [offset,start,limit,unionBit] of [[40,true,48,2],[44,false,52,4]]){
            const planeHeight=row[offset+3]+(row[start?31:35]??0)*radius;
            let outside=row[offset]**2+row[offset+1]**2+row[offset+2]**2>.25?dot(p,offset)-planeHeight>endTolerance:(start?t< -endTolerance:t>row[7]+endTolerance);
            if(row.length>=limit+4&&row[limit]**2+row[limit+1]**2+row[limit+2]**2>.25){
                const outsideLimit=dot(p,limit)-row[limit+3]>endTolerance;
                outside=(row[15]&unionBit)!==0?outside&&outsideLimit:outside||outsideLimit;
            }
            outside=roundOutside(p,row,start,radius,endTolerance,outside);
            if(outside)return false;
        }
        alpha=dot(q,8);beta=dot(q,12);
    }
    if(alpha< -epsilon||beta< -epsilon)return false;
    if(bevel>.5)return alpha+beta/ratio<radius-.00001;
    const d=radius*row[11];if(row[3]<.5&&alpha+beta>d+epsilon)return false;
    if(Math.abs(alpha)<=epsilon&&beta<d+epsilon||Math.abs(beta)<=epsilon&&alpha<d+epsilon)return true;
    const t=dot(q,4),radial=q.map((value,i)=>value-row[4+i]*t-row[16+i]*radius);
    return radial.reduce((sum,value)=>sum+value*value,0)>radius*radius-Math.max(.000001,radius*radius*.000001);
}
export function trimDisplayEdges(edges,records){
    const cuts=(records??[]).filter(row=>row[36]>=0);if(!cuts.length)return edges;
    const result=[];
    for(const edge of edges){
        if(edge.kind==='curve'){result.push(edge);continue;}
        const a=edge.a.toArray(),b=edge.b.toArray(),delta=b.map((v,i)=>v-a[i]),knots=[0,1],active=[];
        for(const row of cuts){
            let from=0,to=1;
            for(let i=0;i<3;i++){
                if(Math.abs(delta[i])<1e-12){if(a[i]<row[28+i]||a[i]>row[32+i]){to=-1;break;}}
                else {let lo=(row[28+i]-a[i])/delta[i],hi=(row[32+i]-a[i])/delta[i];if(lo>hi)[lo,hi]=[hi,lo];from=Math.max(from,lo);to=Math.min(to,hi);}
            }
            if(to<=from)continue;active.push(row);
            for(let i=0;i<=32;i++)knots.push(from+(to-from)*i/32);
        }
        if(!active.length){result.push(edge);continue;}
        const hidden=t=>{const p=a.map((value,i)=>value+delta[i]*t);return active.some(row=>removed(p,row));};
        const samples=[...new Set(knots)].sort((a,b)=>a-b);let start=hidden(0)?null:0,previous=hidden(0);
        const emit=(from,to)=>{if(to-from>1e-7)result.push({...edge,a:edge.a.clone().lerp(edge.b,from),b:edge.a.clone().lerp(edge.b,to),displayRange:[from,to]});};
        for(let i=1;i<samples.length;i++){
            const state=hidden(samples[i]);if(state===previous)continue;
            let low=samples[i-1],high=samples[i];for(let step=0;step<24;step++){const middle=(low+high)/2;if(hidden(middle)===previous)low=middle;else high=middle;}
            const boundary=(low+high)/2;if(previous)start=boundary;else {emit(start??0,boundary);start=null;}previous=state;
        }
        if(start!==null)emit(start,1);
    }
    return result;
}
