import {bandEnd,bandOrigin,sectionSample} from './edge-band-layout.js';

// The straight common seam can shorten an end section. Preserve the stock's
// original contact rail and connect it to the shortened band with coplanar
// triangles. Both boundaries come from the same cut, not a guessed fill polygon.
export function railContact(strip,side,sample){
    const index=side==='start'?0:strip.frames.length-1,frame=strip.frames[index];
    const axis=strip.frames.at(-1).point.clone().sub(strip.frames[0].point).normalize();
    const cross=strip.sections[index],profile=sectionSample(cross,sample),end=bandEnd(profile.offset,axis,strip.settings,side);
    const anchor=bandOrigin(frame.point,strip.settings,side);
    if(!strip.settings[side+'StraightSection'])return {anchor,offset:end.offset};
    const plane=strip.settings[side],denominator=axis.dot(plane);
    if(Math.abs(denominator)<1e-10)return {anchor,offset:end.offset};
    const contact=profile.offset.clone().addScaledVector(axis,-profile.offset.dot(plane)/denominator);
    const support=sample===0?frame.normalA:frame.normalB;
    return {anchor,offset:support.dot(end.offset.clone().sub(contact))<0?contact:end.offset};
}

export function stitchBandRails(strip,buffers){
    if(!strip.settings.bevel||strip.settings.curve||strip.frames.length!==2)return;
    const axis=strip.frames.at(-1).point.clone().sub(strip.frames[0].point).normalize(),cross=strip.sections[0];
    const delta=cross.offsets[32].clone().sub(cross.offsets[0]);
    for(const sample of [0,32]){
        const ends=['start','end'].map((side,index)=>{
            const contact=railContact(strip,side,sample);
            const moved=bandEnd(sectionSample(strip.sections[index],sample).offset,axis,strip.settings,side).offset;
            const support=sample===0?strip.frames[index].normalA:strip.frames[index].normalB;
            return {...contact,moved,gap:-support.dot(moved.clone().sub(contact.offset))};
        });
        if(ends.every(end=>end.gap<=1e-10))continue;
        let from=0,to=1;
        if(ends[0].gap<0)from=-ends[0].gap/(ends[1].gap-ends[0].gap);
        if(ends[1].gap<0)to=ends[0].gap/(ends[0].gap-ends[1].gap);
        const at=(t,moved)=>({anchor:ends[0].anchor.clone().lerp(ends[1].anchor,t),offset:(moved?ends[0].moved:ends[0].offset).clone().lerp(moved?ends[1].moved:ends[1].offset,t),t});
        const vertices=[at(from,false),at(to,false),at(to,true),at(from,true)],base=buffers.positions.length/3;
        const normal=cross.normals[0],tangent=axis.clone();
        for(const vertex of vertices){
            buffers.positions.push(...vertex.anchor.toArray());buffers.offsets.push(...vertex.offset.toArray());
            buffers.normals.push(...normal.toArray());buffers.tangents.push(tangent.x,tangent.y,tangent.z,1);
            const profile=vertex.offset.clone().sub(cross.offsets[0]).dot(delta)/delta.lengthSq();
            buffers.uv.push(vertex.t,profile);buffers.seams.push(1,1);
        }
        for(const triangle of [[0,1,2],[0,2,3]]){
            const points=triangle.map(index=>vertices[index].anchor.clone().add(vertices[index].offset));
            const area=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
            if(area.lengthSq()<1e-20)continue;
            if(area.dot(normal)<0)triangle.reverse();buffers.indices.push(...triangle.map(index=>base+index));
        }
    }
}
