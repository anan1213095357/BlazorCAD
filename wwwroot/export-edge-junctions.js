import {section} from './edge-section.js';
import {edgeEndPlanes} from './edge-end-planes.js';
import {roundJunction} from './round-junction.js';

// Use a planar mitre only when the sampled surfaces agree. Otherwise solve
// their intersection at shared support depths, as the displayed bands do.
export function exportEdgeJunctions(edges,feature,stock=[]){
    // Generated rails already carry authoritative cap normals. Original rails
    // recover them from their actual support faces, not an axis-aligned cap.
    const result=edges.map(edge=>{
        if(edge.kind==='curve')return [0,1].map(side=>!edge.closed&&edge.endPlanes?.[side]?{normal:edge.endPlanes[side],origin:side?edge.frames.at(-1).point:edge.frames[0].point,domain:true}:null);
        return edgeEndPlanes(edge,stock).map((plane,side)=>plane?{normal:plane.normal,origin:side?edge.b:edge.a,domain:true}:null);
    });
    if(feature.edgeTreatment!=='fillet')return result;
    const profiles=edges.map(edge=>edge.kind==='curve'?null:section(edge.normalA,edge.normalB));
    for(let i=0;i<edges.length;i++)for(let side=0;side<2;side++){
        if(!profiles[i]||result[i][side]?.joint)continue;
        const origin=side?edges[i].b:edges[i].a,away=(side?edges[i].a:edges[i].b).clone().sub(origin).normalize(),matches=[];
        const incident=edges.filter((edge,index)=>index!==i&&[edge.a,edge.b].some(point=>point.distanceToSquared(origin)<1e-10));
        if(incident.length!==1)continue;
        for(let j=i+1;j<edges.length;j++)for(let other=0;other<2;other++){
            if(!profiles[j]||result[j][other]?.joint)continue;
            const endpoint=other?edges[j].b:edges[j].a;
            if(origin.distanceToSquared(endpoint)>1e-10)continue;
            const direction=(other?edges[j].a:edges[j].b).clone().sub(endpoint).normalize();
            if(Math.abs(away.dot(direction))>.9995)continue;
            const normal=direction.clone().sub(away).normalize();
            const project=(offset,axis)=>offset.clone().addScaledVector(axis,-normal.dot(offset)/normal.dot(axis));
            let matched=false;
            for(const reverse of [false,true]){
                let error=0;
                for(let k=0;k<=32;k++)error=Math.max(error,project(profiles[i].offsets[k],away).distanceToSquared(project(profiles[j].offsets[reverse?32-k:k],direction)));
                if(error<1e-16){matches.push({j,other,normal,origin,joint:true});matched=true;break;}
            }
            if(!matched){
                const first=[edges[i].normalA,edges[i].normalB],second=[edges[j].normalA,edges[j].normalB];
                for(let a=0;a<2;a++)for(let b=0;b<2;b++)if(first[a].dot(second[b])>1-1e-7){
                    const round=roundJunction(profiles[i],profiles[j],away,direction,first[a],second[1-b],first[1-a]);
                    if(round)matches.push({j,other,normal,origin,joint:true,round});
                }
            }
        }
        // A three-way vertex needs its own corner construction.
        if(matches.length!==1)continue;
        const joint=matches[0];result[i][side]={...joint,round:joint.round?.a};result[joint.j][joint.other]={...joint,round:joint.round?.b};
    }
    return result;
}
