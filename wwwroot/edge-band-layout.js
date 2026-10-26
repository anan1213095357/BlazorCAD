import {roundEnd} from './round-junction.js';
// A band end is the intersection of its surface with an end plane. At an
// asymmetric mitre it must ALSO remain inside the original terminating face.
// All offsets are per unit size, so changing size only changes a GPU uniform.
export function bandEnd(offset, axis, settings, side) {
    const round=settings[side+'RoundJoint'];
    if(round){const end=roundEnd(offset,axis,round,settings[side]);if(end)return end;}
    const straight=settings[side+'StraightSection'],shared=settings[side+'Joint'];
    if(straight&&shared){
        const first=straight.offsets[0],delta=straight.offsets[32].clone().sub(first);
        const fraction=Math.max(0,Math.min(1,offset.clone().sub(first).dot(delta)/delta.lengthSq()));
        const plane=settings[side],project=p=>p.clone().addScaledVector(axis,-p.dot(plane)/axis.dot(plane));
        const forward=project(first).sub(shared.from).dot(shared.direction)<project(straight.offsets[32]).sub(shared.from).dot(shared.direction);
        const from=forward?shared.from:shared.to,to=forward?shared.to:shared.from;
        return {offset:fraction===0?from.clone():fraction===1?to.clone():from.clone().lerp(to,fraction),boundary:plane,seam:true};
    }
    let shift = null, boundary = null;
    const takeMaximum = (side === 'start') !== Boolean(settings[side + 'Union']);
    for (const normal of [settings[side], settings[side + 'Limit']]) {
        if (!normal) continue;
        const denominator = axis.dot(normal);
        if (Math.abs(denominator) < 1e-10) continue;
        const height=normal===settings[side]?(settings[side+'PlaneOffset']??0):0;
        const candidate = (height-offset.dot(normal)) / denominator;
        if (shift === null || (takeMaximum ? candidate > shift : candidate < shift)) {
            shift = candidate;
            boundary = normal;
        }
    }
    const moved = offset.clone().addScaledVector(axis, shift ?? 0);
    const joint = boundary === settings[side + 'Limit'] ? settings[side + 'LimitJoint'] : settings[side + 'Joint'];
    let seam = false;
    if (joint) {
        const distance = moved.clone().sub(joint.from).dot(joint.direction);
        const epsilon = 1e-9 * Math.max(1, joint.length);
        if (distance >= -epsilon && distance <= joint.length + epsilon) {
            const along = Math.abs(distance) <= epsilon ? 0 : Math.abs(distance - joint.length) <= epsilon ? joint.length : distance;
            if (along === 0) moved.copy(joint.from);
            else if (along === joint.length) moved.copy(joint.to);
            else moved.copy(joint.from).addScaledVector(joint.direction, along);
            seam = true;
        }
    }
    return { offset: moved, boundary, seam };
}

export function bandOrigin(point, settings, side) {
    return settings[side + 'Joint']?.origin ?? point;
}

export function sectionSample(cross, sample) {
    const low = Math.floor(sample), high = Math.min(32, low + 1), fraction = sample - low;
    if (fraction === 0) return { offset: cross.offsets[low], normal: cross.normals[low] };
    return {
        offset: cross.offsets[low].clone().lerp(cross.offsets[high], fraction),
        normal: cross.normals[low].clone().lerp(cross.normals[high], fraction).normalize()
    };
}

export function bandSamples(cross, axis, settings) {
    const samples = Array.from({ length: 33 }, (_, i) => i);
    if (!settings.bevel){
        for(const side of ['start','end'])for(const sample of settings[side+'RoundJoint']?.samples??[])if(!samples.some(value=>Math.abs(value-sample)<1e-9))samples.push(sample);
        return samples.sort((a,b)=>a-b);
    }
    for (const side of ['start', 'end']) {
        if(settings[side+'StraightSection'])continue;
        for (const joint of [settings[side + 'Joint'], settings[side + 'LimitJoint']]) {
            if (!joint) continue;
            const delta = cross.offsets[32].clone().sub(cross.offsets[0]), squared = delta.lengthSq();
            for (const point of [joint.from, joint.to]) {
                const projected = point.clone().addScaledVector(axis, -point.dot(axis));
                const sample = 32 * projected.sub(cross.offsets[0]).dot(delta) / squared;
                if (sample > 0 && sample < 32 && !samples.some(value => Math.abs(value - sample) < 1e-10)) samples.push(sample);
            }
        }
        const mitre = settings[side], limit = settings[side + 'Limit'];
        if (!mitre || !limit) continue;
        const a = axis.dot(mitre), b = axis.dot(limit);
        if (Math.abs(a) < 1e-10 || Math.abs(b) < 1e-10) continue;
        const difference = offset => -offset.dot(mitre) / a + offset.dot(limit) / b;
        const from = difference(cross.offsets[0]), to = difference(cross.offsets[32]);
        if (from * to >= 0) continue;
        // Insert the exact intersection of the two clipping planes. Connecting
        // only the two profile endpoints cuts across this corner with a triangle.
        const sample = 32 * from / (from - to);
        if (!samples.some(value => Math.abs(value - sample) < 1e-10)) samples.push(sample);
    }
    return samples.sort((a, b) => a - b);
}
