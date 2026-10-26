// A vertex may touch several faces. Pick the face most transverse to the rail,
// rather than whichever polygon happens to appear first in the BSP result.
export function edgeEndPlanes(edge,polygons){
    if(edge.kind==='curve')return [null,null];
    const axis=edge.b.clone().sub(edge.a).normalize();
    // Generated boundaries carry the planes of the displayed feature. Looking
    // them up in the unchanged BSP stock loses them after the first treatment.
    if(edge.endPlanes)return edge.endPlanes.map((source,index)=>{
        if(!source)return null;
        const normal=source.clone();
        // These are domain caps: their retained half-space must contain the
        // interior of this rail, irrespective of the parent surface's winding.
        if(normal.dot(axis)*(index===0?-1:1)<0)normal.negate();
        return {normal,closureNormal:edge.endClosures?.[index]??null};
    });
    return [[edge.a,-1],[edge.b,1]].map(([point,sign])=>{
        let best=null,score=.01;
        for(const polygon of polygons){const alignment=Math.abs(polygon.normal.dot(axis));
            if(alignment<=score||Math.abs(polygon.normal.dot(point)-polygon.w)>1e-4)continue;
            if(!polygon.vertices.every((a,i)=>polygon.vertices[(i+1)%polygon.vertices.length].clone().sub(a).cross(point.clone().sub(a)).dot(polygon.normal)>=-1e-4))continue;
            best=polygon;score=alignment;
        }
        if(!best)return null;
        // At a fused foot the old end face no longer exists. The neighbouring
        // base face still bounds this rail, but its outward normal points into
        // it. Orient the domain cap independently from the source face winding.
        const normal=best.normal.clone(),opensBase=normal.dot(axis)*sign<0;if(opensBase)normal.negate();
        return {...best,normal,closureNormal:edge.concave?best.normal:opensBase?best.normal:null};
    });
}
