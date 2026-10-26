// A connected planar rim needs one inner depth plane. Equal distances measured
// along differently inclined loft walls give different corner depths, so four
// incident faces cannot share a vertex. Derive each wall's setback from that
// common depth instead, before building either the mesh or the clipping records.
export function rimBevelProfiles(edges,feature){
    const result=edges.map(edge=>({...edge})),groups=[];
    for(let index=0;index<result.length;index++){
        const edge=result[index],settings=edge.visualFeature??feature;
        if(edge.concave||edge.kind==='curve'||settings.edgeTreatment!=='chamfer')continue;
        for(const [side,normal] of [[0,edge.normalA],[1,edge.normalB]]){
            const w=normal.dot(edge.a),owner=settings.id;
            let group=groups.find(item=>item.owner===owner&&item.normal.dot(normal)>1-1e-7&&Math.abs(item.w-w)<1e-4);
            if(!group){group={owner,normal,w,items:[]};groups.push(group);}
            group.items.push({index,side,edge,settings});
        }
    }
    for(const group of groups){
        if(group.items.length<2)continue;
        const remaining=new Set(group.items);
        while(remaining.size){
            const component=[],pending=[remaining.values().next().value];remaining.delete(pending[0]);
            while(pending.length){
                const current=pending.pop();component.push(current);
                for(const other of remaining){
                    if([current.edge.a,current.edge.b].some(a=>[other.edge.a,other.edge.b].some(b=>a.distanceToSquared(b)<1e-8))){remaining.delete(other);pending.push(other);}
                }
            }
            if(component.length<2)continue;
            const simple=component.every(item=>[item.edge.a,item.edge.b].every(point=>component.filter(other=>other!==item&&[other.edge.a,other.edge.b].some(p=>p.distanceToSquared(point)<1e-8)).length<=1));
            if(!simple)continue;
            // Three incident selected edges belong to the separate three-band
            // corner solver; do not assign one of its faces two depth frames.
            const indices=new Set(component.map(item=>item.index));
            const branched=result.some((edge,index)=>!indices.has(index)&&(edge.visualFeature??feature).id===group.owner&&edge.kind!=='curve'&&component.some(item=>[item.edge.a,item.edge.b].some(a=>[edge.a,edge.b].some(b=>a.distanceToSquared(b)<1e-8))));
            if(branched)continue;
            const profiles=component.map(item=>{
                const a=item.edge.normalA,b=item.edge.normalB;
                const sine=a.clone().cross(b).length();if(sine<1e-8)return null;
                const depth=Math.tan((item.settings.chamferAngle??45)*Math.PI/180);
                // Profile endpoint 0 belongs to normalA; endpoint 32 to normalB.
                const first=item.side===0?1:depth/sine,last=item.side===0?depth/sine:1;
                return {scale:first,ratio:last/first,coherentRim:true};
            });
            if(profiles.some(profile=>!profile))continue;
            component.forEach((item,index)=>{result[item.index].bevelProfile=profiles[index];});
        }
    }
    return result;
}
