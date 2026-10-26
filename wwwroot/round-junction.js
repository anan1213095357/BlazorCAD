// Intersect sampled round bands at common support depths. The overlap uses
// shared points; an unmatched tail terminates on the actual neighbouring wall.
function profileAt(profile,common,height){
    for(let index=0;index<32;index++){
        const a=common.dot(profile.offsets[index]),b=common.dot(profile.offsets[index+1]);
        if(height<Math.min(a,b)-1e-8||height>Math.max(a,b)+1e-8)continue;
        const fraction=Math.abs(b-a)<1e-12?0:Math.max(0,Math.min(1,(height-a)/(b-a)));
        return {sample:index+fraction,offset:profile.offsets[index].clone().lerp(profile.offsets[index+1],fraction),normal:profile.normals[index].clone().lerp(profile.normals[index+1],fraction).normalize()};
    }
    return null;
}
export function roundJunction(a,b,awayA,awayB,common,limitA,limitB){
    const direction=awayB.clone().cross(common),denominator=direction.dot(awayA);
    if(Math.abs(denominator)<1e-8)return null;
    // The source vertex moves along the intersection of the two non-shared
    // support planes as common depth changes. On inclined loft walls this
    // is NOT the common face normal, and its axial/transverse shifts matter.
    const spine=limitA.clone().cross(limitB),depth=spine.dot(common);
    if(Math.abs(depth)<1e-10)return null;
    spine.divideScalar(depth);
    const range=profile=>{const heights=profile.offsets.map(p=>common.dot(p)),increasing=heights.at(-1)>heights[0];
        if(heights.some((h,i)=>i&&(increasing?h<heights[i-1]-1e-8:h>heights[i-1]+1e-8)))return null;
        return {heights,low:Math.min(...heights),high:Math.max(...heights)};};
    const first=range(a),second=range(b);if(!first||!second)return null;
    const low=Math.max(first.low,second.low),high=Math.min(first.high,second.high);
    if(high-low<1e-8)return null;
    const heights=[low,high,...first.heights,...second.heights].filter(h=>h>=low-1e-9&&h<=high+1e-9).map(h=>Math.max(low,Math.min(high,h))).sort((x,y)=>x-y).filter((h,i,array)=>!i||Math.abs(h-array[i-1])>1e-9);
    const knots=[];
    for(const height of heights){
        const p=profileAt(a,common,height),q=profileAt(b,common,height);if(!p||!q)return null;
        const point=p.offset.clone().addScaledVector(awayA,direction.dot(q.offset.clone().sub(p.offset))/denominator);
        if(!point.toArray().every(Number.isFinite))return null;
        knots.push({height,point,a:p,b:q});
    }
    const view=(profile,own,other,wall)=>({profile,common,spine,knots:knots.map(k=>({height:k.height,point:k.point,ownNormal:k[own].normal,otherNormal:k[other].normal})),samples:knots.map(k=>k[own].sample),wall});
    return {a:view(a,'a','b',limitA),b:view(b,'b','a',limitB)};
}
export function roundEnd(offset,axis,joint,boundary){
    const height=joint.common.dot(offset),knots=joint.knots;
    if(height>=knots[0].height-1e-8&&height<=knots.at(-1).height+1e-8){
        const exact=knots.find(k=>Math.abs(k.height-height)<1e-9);
        if(exact)return {offset:exact.point.clone(),normal:exact.ownNormal,otherNormal:exact.otherNormal,boundary,seam:true};
        let index=0;while(index<knots.length-2&&knots[index+1].height<height)index++;
        const a=knots[index],b=knots[index+1],fraction=Math.max(0,Math.min(1,(height-a.height)/(b.height-a.height)));
        return {offset:a.point.clone().lerp(b.point,fraction),normal:a.ownNormal.clone().lerp(b.ownNormal,fraction).normalize(),otherNormal:a.otherNormal.clone().lerp(b.otherNormal,fraction).normalize(),boundary,seam:true};
    }
    const denominator=axis.dot(joint.wall);if(Math.abs(denominator)<1e-10)return null;
    return {offset:offset.clone().addScaledVector(axis,-offset.dot(joint.wall)/denominator),otherNormal:joint.wall,boundary:joint.wall,seam:false};
}
