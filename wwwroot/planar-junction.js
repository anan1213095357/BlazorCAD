// Intersect the two extended bevel planes, then bound their shared line by
// the three incident stock support planes. Coordinates are per unit distance
// relative to the common source vertex, so the seam scales with the drag uniform.
export function planarJunction(crossA, crossB, supports, origin) {
    const a = crossA.normals[0], b = crossB.normals[0];
    const direction = a.clone().cross(b), denominator = direction.lengthSq();
    if (denominator < 1e-16) return null;
    const hA = a.dot(crossA.offsets[0]), hB = b.dot(crossB.offsets[0]);
    const point = b.clone().cross(direction).multiplyScalar(hA)
        .add(direction.clone().cross(a).multiplyScalar(hB)).divideScalar(denominator);
    direction.normalize();
    let from = -Infinity, to = Infinity;
    for (const support of supports) {
        const normal = support.normal ?? support;
        const slope = normal.dot(direction), height = normal.dot(point) - (support.w ?? 0);
        if (Math.abs(slope) < 1e-10) {
            if (height > 1e-9) return null;
            continue;
        }
        const boundary = -height / slope;
        if (slope > 0) to = Math.min(to, boundary);
        else from = Math.max(from, boundary);
    }
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 1e-9) return null;
    return {
        origin: origin.clone(),
        from: point.clone().addScaledVector(direction, from),
        to: point.clone().addScaledVector(direction, to),
        direction,
        length: to - from
    };
}

// A common cross-section angle does not imply equal seam intervals. Decide
// whether THIS face has a tail by its actual projected endpoints, not by its
// sample correspondence to the other face or by either rail's total length.
export function junctionHasTail(cross, along, plane, joint) {
    if (!joint) return false;
    const denominator = along.dot(plane);
    if (Math.abs(denominator) < 1e-10) return false;
    const epsilon = 1e-9 * Math.max(1, joint.length);
    return [cross.offsets[0], cross.offsets[32]].some(offset => {
        const point = offset.clone().addScaledVector(along, -offset.dot(plane) / denominator);
        const distance = point.sub(joint.from).dot(joint.direction);
        return distance < -epsilon || distance > joint.length + epsilon;
    });
}
