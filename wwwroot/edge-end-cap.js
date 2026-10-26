import * as CAD from './engine/core.js';
import {bandEnd,sectionSample} from './edge-band-layout.js';

// Fusing a boss to a base removes the base's internal top polygons. Bevelling
// the boss exposes a part of that old internal face; clipping alone cannot
// recover it. Recreate only the removed wedge on its actual terminating plane.
export function edgeEndCap(strip, side) {
    const normal=strip.settings[side+'Closure'];
    if(!normal||strip.closed||strip.settings.curve||strip.settings[side+'Joint']||strip.settings[side+'RoundJoint'])return null;
    const index=side==='start'?0:strip.frames.length-1,frame=strip.frames[index];
    const cross=strip.sections[index],axis=strip.settings.b.clone().sub(strip.settings.a).normalize();
    const offsets=[new CAD.Vector3(),...strip.samples.map(sample=>bandEnd(sectionSample(cross,sample).offset,axis,strip.settings,side).offset)];
    const position=[],displacement=[],normals=[],tangents=[],uv=[],seams=[],indices=[];
    const tangent=new CAD.Vector3(...(Math.abs(normal.z)<.8?[0,0,1]:[0,1,0])).cross(normal).normalize();
    const across=normal.clone().cross(tangent);
    for(const offset of offsets){
        position.push(...frame.point.toArray());displacement.push(...offset.toArray());normals.push(...normal.toArray());
        const point=frame.point.clone().add(offset);
        tangents.push(tangent.x,tangent.y,tangent.z,1);uv.push(point.dot(tangent),point.dot(across));seams.push(1,1);
    }
    for(let i=1;i<offsets.length-1;i++){
        const area=offsets[i].clone().cross(offsets[i+1]);if(area.lengthSq()<1e-20)continue;
        indices.push(...(area.dot(normal)>0?[0,i,i+1]:[0,i+1,i]));
    }
    if(!indices.length)return null;
    const geometry=new CAD.BufferGeometry();
    geometry.setAttribute('position',new CAD.Float32BufferAttribute(position,3));
    geometry.setAttribute('liveOffset',new CAD.Float32BufferAttribute(displacement,3));
    geometry.setAttribute('normal',new CAD.Float32BufferAttribute(normals,3));
    geometry.setAttribute('tangent',new CAD.Float32BufferAttribute(tangents,4));
    geometry.setAttribute('uv',new CAD.Float32BufferAttribute(uv,2));
    geometry.setAttribute('liveSeamCoordinate',new CAD.Float32BufferAttribute(seams,2));
    geometry.setIndex(indices);return geometry;
}
