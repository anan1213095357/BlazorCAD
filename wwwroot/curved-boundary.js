import * as THREE from './vendor/three.module.js';
const v=()=>new THREE.Vector3();
export function circleOf(edge){
    if(!edge.closed||edge.points.length<6)return null;
    // BSP inserts points along existing chords. Remove those points before
    // fitting the circle, preserving the original polygon's actual corners.
    const points=edge.points.map(point=>point.clone());let changed=true;
    while(changed&&points.length>6){changed=false;for(let i=points.length-1;i>=0;i--){const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length],ab=b.clone().sub(a),bc=c.clone().sub(b);if(ab.dot(bc)>=0&&ab.clone().cross(bc).length()<=1e-6*Math.max(1,ab.length()*bc.length())){points.splice(i,1);changed=true;}}}
    const center=v();let perimeter=0;
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],length=a.distanceTo(b);center.addScaledVector(a.clone().add(b).multiplyScalar(.5),length);perimeter+=length;}
    if(perimeter<1e-5)return null;center.divideScalar(perimeter);
    const radius=points.reduce((sum,p)=>sum+p.distanceTo(center),0)/points.length,tolerance=Math.max(.0001,radius*.0002);
    if(points.some(p=>Math.abs(p.distanceTo(center)-radius)>tolerance))return null;
    const normal=edge.normalA,u=points[0].clone().sub(center).normalize(),basis=normal.clone().cross(u).normalize(),step=2*Math.PI/points.length;
    if(points.some((point,i)=>{const a=point.clone().sub(center).normalize(),b=points[(i+1)%points.length].clone().sub(center).normalize();return Math.abs(Math.acos(THREE.MathUtils.clamp(a.dot(b),-1,1))-step)>1e-4;}))return null;
    const sign=Math.sign(u.dot(edge.frames[0].normalB));if(!sign||Math.abs(normal.dot(edge.frames[0].normalB))>1e-4)return null;
    return {center,radius,sign,u,basis,count:points.length,points,frames:points.map(point=>({point,normalA:normal,normalB:point.clone().sub(center).normalize().multiplyScalar(sign)}))};
}

// Open circular rails (including the two semicircles of a slot) use the same
// analytic normals and clipping coordinates as complete circles.
export function arcOf(edge){
    if(edge.closed||!edge.points||edge.points.length<3)return null;
    const points=edge.points.map(p=>p.clone());
    for(let i=points.length-2;i>0;i--){const ab=points[i].clone().sub(points[i-1]),bc=points[i+1].clone().sub(points[i]);if(ab.dot(bc)>=0&&ab.clone().cross(bc).length()<=1e-6*Math.max(1,ab.length()*bc.length()))points.splice(i,1);}
    if(points.length<3)return null;
    const a=points[0],b=points[points.length>>1],c=points.at(-1),ab=b.clone().sub(a),ac=c.clone().sub(a),cross=ab.clone().cross(ac),denominator=2*cross.lengthSq();
    if(denominator<1e-16)return null;
    const center=a.clone().add(ac.clone().cross(cross).multiplyScalar(ab.lengthSq()).add(cross.clone().cross(ab).multiplyScalar(ac.lengthSq())).divideScalar(denominator));
    const radius=a.distanceTo(center),tolerance=Math.max(.0001,radius*.0002),normal=edge.normalA;
    if(radius<1e-5||points.some(p=>Math.abs(p.distanceTo(center)-radius)>tolerance||Math.abs(p.clone().sub(center).dot(normal))>tolerance))return null;
    const u=a.clone().sub(center).normalize(),basis=normal.clone().cross(u).normalize();
    if(points[1].clone().sub(center).dot(basis)<0)basis.negate();
    const angles=points.map(p=>{const delta=p.clone().sub(center);let angle=Math.atan2(delta.dot(basis),delta.dot(u));if(angle< -1e-6)angle+=2*Math.PI;return Math.max(0,angle);});
    if(angles.some((angle,i)=>i&&angle<=angles[i-1]+1e-8))return null;
    const steps=angles.slice(1).map((angle,i)=>angle-angles[i]),step=Math.min(...steps.filter(value=>value>1e-6));
    // A truncated last chord is allowed, but irregular curves stay on the rail path.
    if(!Number.isFinite(step)||steps.some(value=>Math.abs(value-step)>1e-4))return null;
    const sign=Math.sign(u.dot(edge.frames[0].normalB));
    if(!sign||Math.abs(normal.dot(edge.frames[0].normalB))>1e-4)return null;
    return {center,radius,sign,u,basis,count:2*Math.PI/step,sweep:angles.at(-1),closed:false,points,frames:points.map(point=>({point,normalA:normal,normalB:point.clone().sub(center).normalize().multiplyScalar(sign)}))};
}
