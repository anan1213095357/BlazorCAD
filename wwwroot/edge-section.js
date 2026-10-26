import * as CAD from './engine/core.js';
export function section(a,b,bevel=false,ratio=1,scale=1){
    const tangent=a.clone().cross(b).normalize(),u=tangent.clone().cross(a).normalize(),w=tangent.clone().cross(b).normalize();if(u.dot(b)>0)u.negate();if(w.dot(a)>0)w.negate();
    const cosine=CAD.MathUtils.clamp(u.dot(w),-.999999,.999999),theta=Math.acos(cosine),d=1/Math.tan(theta/2),center=u.clone().add(w).normalize().multiplyScalar(1/Math.sin(theta/2)),basis=w.clone().addScaledVector(u,-cosine).normalize(),p=u.clone().multiplyScalar(d).sub(center),q=w.clone().multiplyScalar(d).sub(center),from=Math.atan2(p.dot(basis),p.dot(u));let sweep=Math.atan2(q.dot(basis),q.dot(u))-from;while(sweep>Math.PI)sweep-=2*Math.PI;while(sweep< -Math.PI)sweep+=2*Math.PI;
    const offsets=Array.from({length:33},(_,i)=>center.clone().addScaledVector(u,Math.cos(from+sweep*i/32)).addScaledVector(basis,Math.sin(from+sweep*i/32)));
    offsets[0]=u.clone().multiplyScalar(d);offsets[32]=w.clone().multiplyScalar(d);
    if(bevel){const first=u.clone().multiplyScalar(scale),last=w.clone().multiplyScalar(ratio*scale),normal=a.clone().addScaledVector(b,ratio).normalize();
        return {offsets:Array.from({length:33},(_,i)=>first.clone().lerp(last,i/32)),normals:Array.from({length:33},()=>normal.clone()),center,d:1,dualU:u.clone().addScaledVector(w,-cosine).divideScalar((1-cosine*cosine)*scale),dualV:w.clone().addScaledVector(u,-cosine).divideScalar((1-cosine*cosine)*scale)};
    }
    return {offsets,normals:offsets.map(p=>p.clone().sub(center).normalize()),center,d,dualU:u.clone().addScaledVector(w,-cosine).divideScalar(1-cosine*cosine),dualV:w.clone().addScaledVector(u,-cosine).divideScalar(1-cosine*cosine)};
}
