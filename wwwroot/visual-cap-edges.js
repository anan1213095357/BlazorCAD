import {edgeEndPlanes} from './edge-end-planes.js';
import {joinEdgeBands} from './edge-junctions.js';
import * as CAD from './engine/core.js';
import {section} from './edge-section.js';
import {bandEnd,bandOrigin,bandSamples,sectionSample} from './edge-band-layout.js';
import {railContact} from './edge-rail-stitch.js';
import {rimBevelProfiles} from './rim-bevel-profile.js';

// Saved display topology, including both sides of a planar chamfer. Synthetic
// identities stay in the existing visual-cap namespace for persisted references.
export function visualCapEdges(feature,edges,polygons){
    edges=rimBevelProfiles(edges,feature);
    const bevel=feature.edgeTreatment==='chamfer',ratio=Math.tan((feature.chamferAngle??45)*Math.PI/180),r=feature.depth,result=[];
    const add=(edge,suffix,points,frames,closed=false,endPlanes=null,endClosures=null)=>{
        const retained=[];
        for(let i=0;i<points.length;i++)if(!retained.length||points[i].distanceToSquared(points[retained.at(-1)])>1e-16)retained.push(i);
        if(closed&&retained.length>1&&points[retained[0]].distanceToSquared(points[retained.at(-1)])<1e-16)retained.pop();
        points=retained.map(i=>points[i]);frames=retained.map(i=>frames[i]);
        if(points.length<(closed?3:2))return;
        // Infer the rail from its actual points, independently of its history.
        const delta=points.at(-1).clone().sub(points[0]),length=delta.length(),tolerance=Math.max(1e-6,length*1e-7);
        const straight=!closed&&length>tolerance&&points.every(point=>point.clone().sub(points[0]).cross(delta).length()<=tolerance*length);
        const kind=straight?'line':'curve';
        if(straight){points=[points[0],points.at(-1)];frames=[frames[0],frames.at(-1)];}
        result.push({kind,closed,points,frames,a:points[0],b:kind==='line'?points.at(-1):points[1],normalA:frames[0].normalA,normalB:frames[0].normalB,endPlanes,endClosures,limit:Infinity,segment:0,visualBoundary:true,
            faceA:{featureId:feature.id,face:'visual-cap|'+edge.visualReferenceIndex+'|'+edge.segment+'|'+suffix},faceB:{featureId:feature.id,face:'curved'}});
    };
    // Reuse the renderer's end/junction solution when publishing selectable
    // edges. Otherwise subsequent treatments target the unjoined old endpoints.
    const prepared=new Map(),strips=[],records=[];
    for(const edge of edges){
        if(edge.kind==='curve')continue;
        const [startFace,endFace]=edgeEndPlanes(edge,polygons),strip={index:records.length,closed:false,frames:[{point:edge.a,normalA:edge.normalA,normalB:edge.normalB},{point:edge.b,normalA:edge.normalA,normalB:edge.normalB}],settings:{curve:false,bevel,ratio,radius:r,treatment:feature.id,start:startFace?.normal??null,end:endFace?.normal??null}};
        strip.settings.ratio=edge.bevelProfile?.ratio??ratio;strip.settings.scale=edge.bevelProfile?.scale??1;strip.settings.coherentRim=edge.bevelProfile?.coherentRim??false;
        strip.settings.startClosure=startFace?.closureNormal??null;strip.settings.endClosure=endFace?.closureNormal??null;
        strips.push(strip);records.push(new Float32Array(56));prepared.set(edge,strip.settings);
    }
    joinEdgeBands(strips,records,section);
    for(const edge of edges){
        if(edge.kind==='curve'){
            // A junction is selectable when its actual adjacent normals differ.
            // Tangent joins are not new corners; no feature-type whitelist.
            for(const [sample,side] of [[0,'rail-0'],[32,'rail-1']]){
                const frames=edge.frames.map(frame=>{const cross=section(frame.normalA,frame.normalB,bevel,ratio);return {point:frame.point.clone().addScaledVector(cross.offsets[sample],r),normalA:sample===0?frame.normalA:frame.normalB,normalB:cross.normals[sample]};});
                if(frames.some(frame=>frame.normalA.clone().cross(frame.normalB).lengthSq()>1e-10))add(edge,side,frames.map(frame=>frame.point),frames,edge.closed);
            }
            continue;
        }
        const axis=edge.b.clone().sub(edge.a).normalize(),settings=prepared.get(edge),cross=section(edge.normalA,edge.normalB,bevel,settings.ratio,settings.scale),ends=[];
        const adjacentNormal=(side,sample,boundary)=>{
            if(boundary===settings[side+'Limit'])return settings[side+'LimitSurfaceNormal']??boundary;
            const normals=settings[side+'SurfaceNormals'];
            if(boundary!==settings[side]||!normals)return boundary;
            const low=Math.floor(sample),high=Math.min(32,low+1);
            return normals[low].clone().lerp(normals[high],sample-low).normalize();
        };
        for(const [point,side] of [[edge.a,'start'],[edge.b,'end']]){
            const at=sample=>{const section=sectionSample(cross,sample),end=bandEnd(section.offset,axis,settings,side);return {point:bandOrigin(point,settings,side).clone().addScaledVector(end.offset,r),normalA:end.otherNormal??adjacentNormal(side,sample,end.boundary),normalB:end.normal??section.normal,boundary:end.boundary};};
            ends.push(at);
            if(!settings[side])continue;
            const samples=bevel&&!settings[side+'Limit']&&!settings[side+'Joint']?[0,32]:bandSamples(cross,axis,settings),runs=[];
            for(let i=1;i<samples.length;i++){
                const boundary=at((samples[i-1]+samples[i])/2).boundary,last=runs.at(-1);
                if(last?.boundary===boundary)last.samples.push(samples[i]);
                else runs.push({boundary,samples:[samples[i-1],samples[i]]});
            }
            runs.forEach((run,index)=>{
                if(!run.boundary)return;
                const values=bevel?[run.samples[0],run.samples.at(-1)]:run.samples,frames=values.map(sample=>{const frame=at(sample);return settings[side+'RoundJoint']?frame:{...frame,normalA:adjacentNormal(side,sample,run.boundary)};});
                // At a split, the third incident surface is the other run's
                // support; at the profile ends it is the original support.
                const planeAt=(sample,other)=>sample===0?edge.normalA:sample===32?edge.normalB:other;
                const before=runs[index-1],after=runs[index+1];
                const capPlanes=[planeAt(values[0],before?adjacentNormal(side,values[0],before.boundary):null),planeAt(values.at(-1),after?adjacentNormal(side,values.at(-1),after.boundary):null)];
                add(edge,index===0?side:side+'-'+index,frames.map(frame=>frame.point),frames,false,capPlanes);
            });
        }
        for(const [sample,side] of [[0,'rail-0'],[32,'rail-1']]){
            const endFrames=ends.map(at=>at(sample)),points=endFrames.map(frame=>frame.point),support=sample===0?edge.normalA:edge.normalB,frames=points.map(point=>({point,normalA:support,normalB:cross.normals[sample]}));
            const strip={settings,frames:[{point:edge.a,normalA:edge.normalA,normalB:edge.normalB},{point:edge.b,normalA:edge.normalA,normalB:edge.normalB}],sections:[cross,cross]};
            for(let index=0;index<2;index++){const contact=railContact(strip,index===0?'start':'end',sample);points[index]=contact.anchor.clone().addScaledVector(contact.offset,r);frames[index].point=points[index];}
            if(frames.some(frame=>frame.normalA.clone().cross(frame.normalB).lengthSq()>1e-10))add(edge,side,points,frames,false,endFrames.map(frame=>frame.normalA),[settings.startClosure,settings.endClosure]);
        }
    }
    return result;
}
