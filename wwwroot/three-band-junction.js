import {planarJunction} from './planar-junction.js';

// Three selected bevels at one vertex form three trimmed faces, not one pair
// plus an independently capped third face. Each shared seam ends on the third
// bevel plane; the two seam constraints together bound each replacement face.
export function joinThreeBands(endpoints, cells, tolerance, records, section, used) {
    const visited = new Set();
    for (const entry of endpoints) {
        if (visited.has(entry) || !entry.strip.settings.bevel) continue;
        const group = [];
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
            for (const other of cells.get([entry.cell[0] + x, entry.cell[1] + y, entry.cell[2] + z].join('/')) ?? []) {
                const a = entry.strip.settings, b = other.strip.settings;
                if (b.bevel && a.treatment === b.treatment && a.radius === b.radius && entry.point.distanceToSquared(other.point) <= tolerance * tolerance) group.push(other);
            }
        }
        group.forEach(item => visited.add(item));
        if (group.length !== 3 || new Set(group.map(item => item.strip)).size !== 3) continue;
        const origin = group[0].point;
        const data = group.map(item => {
            const frame = item.strip.frames[item.index], settings = item.strip.settings;
            const cross = section(frame.normalA, frame.normalB, true, settings.ratio, settings.scale);
            return { entry: item, frame, cross, away: item.strip.frames[1 - item.index].point.clone().sub(item.point).normalize() };
        });
        const pairs = [];
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
            const a = data[i], b = data[j], third = data[3 - i - j];
            let common = null;
            for (const n of [a.frame.normalA, a.frame.normalB]) {
                if ([b.frame.normalA, b.frame.normalB].some(other => other.dot(n) > 1 - 1e-6)) { common = n; break; }
            }
            if (!common) continue;
            const nA = a.cross.normals[0], nB = b.cross.normals[0];
            const hA = nA.dot(a.cross.offsets[0]), hB = nB.dot(b.cross.offsets[0]);
            if (Math.abs(hA) < 1e-10 || Math.abs(hB) < 1e-10) continue;
            const plane = nA.clone().divideScalar(hA).sub(nB.clone().divideScalar(hB));
            if (plane.lengthSq() < 1e-12) continue;
            plane.normalize(); if (plane.dot(a.away) > 0) plane.negate();
            if (plane.dot(a.away) >= -1e-8 || plane.dot(b.away) <= 1e-8) continue;
            const normal = third.cross.normals[0], w = normal.dot(third.cross.offsets[0]);
            const joint = planarJunction(a.cross, b.cross, [common, { normal, w }], origin);
            if (joint) pairs.push({ a, b, plane, joint });
        }
        if (pairs.length !== 3) continue;
        // All seam tips are one three-plane intersection. Share its coordinates
        // explicitly, including the middle vertex inserted in each end profile.
        const tipCandidates = pairs.map(pair => {
            const third = data.find(item => item !== pair.a && item !== pair.b);
            const n = third.cross.normals[0], h = n.dot(third.cross.offsets[0]);
            return Math.abs(n.dot(pair.joint.from) - h) < Math.abs(n.dot(pair.joint.to) - h) ? pair.joint.from : pair.joint.to;
        });
        const tip = tipCandidates[0];
        if (tipCandidates.some(point => point.distanceToSquared(tip) > 1e-12 * Math.max(1, tip.lengthSq()))) continue;
        for (let i = 0; i < pairs.length; i++) {
            const joint = pairs[i].joint;
            if (joint.from === tipCandidates[i]) joint.from = tip;
            else joint.to = tip;
            joint.direction = joint.to.clone().sub(joint.from).normalize();
            joint.length = joint.from.distanceTo(joint.to);
        }
        for (const item of data) {
            const constraints = pairs.filter(pair => pair.a === item || pair.b === item).map(pair => ({
                normal: pair.a === item ? pair.plane : pair.plane.clone().negate(),
                surface: (pair.a === item ? pair.b : pair.a).cross.normals[0], joint: pair.joint
            }));
            const [primary, secondary] = constraints, side = item.entry.index === 0 ? 'start' : 'end';
            const settings = item.entry.strip.settings, row = records[item.entry.strip.index];
            settings[side] = primary.normal;
            settings[side + 'Joint'] = primary.joint;
            settings[side + 'SurfaceNormals'] = Array.from({ length: 33 }, () => primary.surface);
            settings[side + 'Limit'] = secondary.normal;
            settings[side + 'LimitJoint'] = secondary.joint;
            settings[side + 'LimitSurfaceNormal'] = secondary.surface;
            settings[side + 'Union'] = false;
            row.set([...primary.normal.toArray(), primary.normal.dot(origin)], (item.entry.index === 0 ? 10 : 11) * 4);
            row.set([...secondary.normal.toArray(), secondary.normal.dot(origin)], (item.entry.index === 0 ? 12 : 13) * 4);
            row[15] = row[15] | 1;
            used.add(item.entry);
        }
    }
}
