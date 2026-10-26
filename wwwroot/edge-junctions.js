import {planarJunction} from './planar-junction.js';
import {joinThreeBands} from './three-band-junction.js';
import {roundJunction} from './round-junction.js';

// Solve coincident end sections geometrically. Nearby endpoints are compared by
// distance across neighbouring spatial cells; rounding a coordinate is not a
// topological identity. More than two incident bands must not disable all joins.
export function joinEdgeBands(strips,records,section){
    const cells=new Map(),tolerance=1e-4,endpoints=[];
    for(const strip of strips){
        if(strip.closed||strip.settings.curve||strip.frames.length!==2)continue;
        for(const index of [0,1]){
            const point=strip.frames[index].point,cell=point.toArray().map(v=>Math.floor(v/tolerance)),entry={strip,index,point,cell};
            endpoints.push(entry);const key=cell.join('/');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);
        }
    }
    const used=new Set();
    joinThreeBands(endpoints,cells,tolerance,records,section,used);
    for(const a of endpoints){
        if(used.has(a))continue;
        const candidates=[];
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const b of cells.get([a.cell[0]+x,a.cell[1]+y,a.cell[2]+z].join('/'))??[]){
            if(a===b||used.has(b)||a.strip===b.strip||a.point.distanceToSquared(b.point)>tolerance*tolerance)continue;
            const sa=a.strip.settings,sb=b.strip.settings;
            // History is sequential: a later treatment clips the saved surfaces,
            // it must not remitre them retroactively when a draft is confirmed.
            // The saved edge catalogue is built with this same per-feature scope.
            if(sa.treatment!==sb.treatment)continue;
            if(!!sa.concave!==!!sb.concave||sa.bevel!==sb.bevel||(!sa.bevel&&Math.abs(sa.ratio-sb.ratio)>1e-8)||Math.abs(sa.radius-sb.radius)>1e-8)continue;
            const af=a.strip.frames[a.index],bf=b.strip.frames[b.index],an=[af.normalA,af.normalB],bn=[bf.normalA,bf.normalB];
            const awayA=a.strip.frames[1-a.index].point.clone().sub(a.point).normalize(),awayB=b.strip.frames[1-b.index].point.clone().sub(b.point).normalize();
            if(Math.abs(awayA.dot(awayB))>.9995)continue;
            const crossA=section(af.normalA,af.normalB,sa.bevel,sa.ratio,sa.scale,sa.concave),crossB=section(bf.normalA,bf.normalB,sb.bevel,sb.ratio,sb.scale,sb.concave);
            for(let i=0;i<2;i++)for(let j=0;j<2;j++){
                if(an[i].dot(bn[j])<1-1e-6)continue;
                let plane=awayB.clone().sub(awayA).normalize();
                if(sa.bevel){
                    // Intersect the actual bevel planes on non-orthogonal supports.
                    const normalA=crossA.normals[0],normalB=crossB.normals[0],heightA=normalA.dot(crossA.offsets[0]),heightB=normalB.dot(crossB.offsets[0]);
                    if(Math.abs(heightA)<1e-10||Math.abs(heightB)<1e-10)continue;
                    plane=normalA.clone().divideScalar(heightA).sub(normalB.clone().divideScalar(heightB));
                    if(plane.lengthSq()<1e-12)continue;plane.normalize();
                    if(plane.dot(awayA)>0)plane.negate();
                }
                if(plane.dot(awayA)>=-1e-8||plane.dot(awayB)<=1e-8)continue;
                const project=(offset,away)=>offset.clone().addScaledVector(away,-offset.dot(plane)/away.dot(plane));
                const reverse=i!==j,round=!sa.bevel?roundJunction(crossA,crossB,awayA,awayB,an[i],bn[1-j],an[1-i]):null;let error=0;
                for(let sample=0;sample<crossA.offsets.length;sample++)error=Math.max(error,project(crossA.offsets[sample],awayA).distanceToSquared(project(crossB.offsets[reverse?32-sample:sample],awayB)));
                // Planar bevels intersect along a line even when their end
                // segments have different lengths. Requiring all 33 points to
                // coincide rejects a valid intersection on oblique supports.
                // Round/round joins still require the existing surface match.
                // The non-shared support of the OTHER rail terminates this
                // band at a three-face corner. Use that actual surface, rather
                // than whichever stock polygon an endpoint search returned.
                const limitA=bn[1-j],limitB=an[1-i];
                const joint=sa.bevel?planarJunction(crossA,crossB,[an[i],limitA,limitB],a.point):null;
                // An inside corner needs extension past its old cap. Requiring
                // both caps to face away from the rails rejects that operation;
                // its cap is a UNION domain, rather than an intersection. It
                // still terminates the tail beyond the finite shared seam.
                if(round||error<=1e-8||sa.bevel&&joint)candidates.push({b,plane,reverse,crossA,crossB,error,joint,round});
            }
        }
        candidates.sort((a,b)=>a.error-b.error);const match=candidates[0];if(!match)continue;
        const {b,plane,reverse,crossA,crossB,joint,round}=match;
        if(round){
            (a.strip.roundPeers??=new Set()).add(b.strip);
            (b.strip.roundPeers??=new Set()).add(a.strip);
        }
        for(const [entry,n,own,other] of [[a,plane,crossA,crossB],[b,plane.clone().negate(),crossB,crossA]]){
            const side=entry.index===0?'start':'end';
            entry.strip.settings[side]=n;
            if(round){
                const data=entry===a?round.a:round.b,away=entry.strip.frames[1-entry.index].point.clone().sub(entry.point).normalize();
                entry.strip.settings[side+'RoundJoint']=data;
                entry.strip.settings[side+'PlaneOffset']=0;
                const row=records[entry.strip.index];row[entry.index===0?31:35]=0;
                row[15]|=entry.index===0?8:16;
                // A round seam is a depth-dependent boundary, not the union of
                // two half-spaces: that union cuts rectangular holes in stock.
                const axis=entry.strip.frames[1].point.clone().sub(entry.strip.frames[0].point).normalize(),transverse=data.common.clone().cross(axis);
                row[side==='start'?'roundStart':'roundEnd']={common:data.common,wall:data.wall,spineShift:data.spine.dot(axis),spineWidth:data.spine.dot(transverse),knots:data.knots.map((k,index)=>{
                    const sample=data.samples[index],low=Math.floor(sample),high=Math.min(32,low+1),offset=own.offsets[low].clone().lerp(own.offsets[high],sample-low);
                    return {height:k.height,shift:k.point.dot(axis),width:offset.dot(transverse)};
                })};
            }
            // Both faces use the very same bounded line and origin. Do not
            // independently extrapolate two nearly matching seam polylines.
            if(joint){entry.strip.settings[side+'Joint']=joint;if(!entry.strip.settings.coherentRim)entry.strip.settings[side+'StraightSection']=own;}
            // The end plane is only a trimming plane. Its adjacent surface is
            // the OTHER band, not this artificial plane, when selected again.
            entry.strip.settings[side+'SurfaceNormals']=other.normals.map((_,i)=>other.normals[reverse?32-i:i]);
            records[entry.strip.index].set([...n.toArray(),n.dot(joint?.origin??entry.point)],(entry.index===0?10:11)*4);
        }
        used.add(a);used.add(b);
    }
}
