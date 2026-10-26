import * as THREE from './vendor/three.core.js';

const near=(a,b)=>a.distanceToSquared(b)<1e-10;
function intersect(a,ha,b,hb,c,hc){
    const cross=b.clone().cross(c),det=a.dot(cross);if(Math.abs(det)<1e-10)return null;
    return cross.multiplyScalar(ha).add(c.clone().cross(a).multiplyScalar(hb)).add(a.clone().cross(b).multiplyScalar(hc)).divideScalar(det);
}
function profilePlane(edge){
    const tangent=edge.normalA.clone().cross(edge.normalB).normalize(),a=tangent.clone().cross(edge.normalA).normalize(),b=tangent.clone().cross(edge.normalB).normalize();
    if(a.dot(edge.normalB)>0)a.negate();if(b.dot(edge.normalA)>0)b.negate();
    const first=a.multiplyScalar(edge.topologyProfile.first),last=b.multiplyScalar(edge.topologyProfile.second),n=last.clone().sub(first).cross(tangent).normalize();
    return {n,h:n.dot(first)};
}

// Control points precede tessellation. On a planar rim, a distance along an
// inclined wall is not a common depth. Use the shortest available wall depth,
// then solve the upper/lower shared vertices from supporting planes.
export function bevelControlCage(edges,feature){
    const ratio=Math.tan((feature.chamferAngle??45)*Math.PI/180),result=edges.map(edge=>({...edge,topologyProfile:{first:1,second:ratio},topologyCageEnds:[null,null]})),groups=[];
    result.forEach((edge,index)=>{
        if(edge.kind==='curve')return;
        for(const [side,n] of [[0,edge.normalA],[1,edge.normalB]]){
            const w=n.dot(edge.a);let group=groups.find(g=>g.n.dot(n)>1-1e-8&&Math.abs(g.w-w)<1e-6);
            if(!group){group={n,w,items:[]};groups.push(group);}group.items.push({edge,index,side});
        }
    });
    for(const group of groups){
        const remaining=new Set(group.items);
        while(remaining.size){
            const component=[],pending=[remaining.values().next().value];remaining.delete(pending[0]);
            while(pending.length){const item=pending.pop();component.push(item);for(const other of remaining)if([item.edge.a,item.edge.b].some(a=>[other.edge.a,other.edge.b].some(b=>near(a,b)))){remaining.delete(other);pending.push(other);}}
            if(component.length<2)continue;
            const indices=new Set(component.map(item=>item.index));
            if(result.some((edge,index)=>!indices.has(index)&&component.some(item=>[edge.a,edge.b].some(a=>[item.edge.a,item.edge.b].some(b=>near(a,b))))))continue;
            if(component.some(item=>[item.edge.a,item.edge.b].some(p=>component.filter(other=>other!==item&&[other.edge.a,other.edge.b].some(q=>near(p,q))).length>1)))continue;
            const depth=Math.min(...component.map(({edge,side})=>edge.normalA.clone().cross(edge.normalB).length()*(side===0?ratio:1)));
            if(depth<1e-8)continue;
            for(const {edge,side} of component){const setback=depth/edge.normalA.clone().cross(edge.normalB).length();edge.topologyProfile=side===0?{first:1,second:setback}:{first:setback,second:ratio};}
            for(const item of component)for(const [end,origin] of [[0,item.edge.a],[1,item.edge.b]]){
                if(item.edge.topologyCageEnds[end])continue;
                const other=component.find(candidate=>candidate!==item&&[candidate.edge.a,candidate.edge.b].some(p=>near(p,origin)));if(!other)continue;
                const away=(entry,p)=>entry.edge.a.clone().add(entry.edge.b).multiplyScalar(.5).sub(p).normalize();
                if(Math.abs(away(item,origin).dot(away(other,origin)))>.9995)continue;
                const a=profilePlane(item.edge),b=profilePlane(other.edge),wallA=item.side===0?item.edge.normalB:item.edge.normalA,wallB=other.side===0?other.edge.normalB:other.edge.normalA;
                const top=intersect(a.n,a.h,b.n,b.h,group.n,0),foot=intersect(wallA,0,wallB,0,group.n,-depth);
                if(!top||!foot)continue;
                // These exact two points bound the shared bevel seam. All
                // participating faces reference the same control record.
                if(Math.abs(a.n.dot(foot)-a.h)>1e-7||Math.abs(b.n.dot(foot)-b.h)>1e-7)throw new Error('倒角控制点不满足相邻面的约束。');
                const normal=top.clone().cross(foot).normalize();if(normal.lengthSq()<.5)continue;
                const control={origin:origin.clone(),top,foot,normal};
                item.edge.topologyCageEnds[end]=control;other.edge.topologyCageEnds[near(other.edge.a,origin)?0:1]=control;
            }
        }
    }
    return result;
}
