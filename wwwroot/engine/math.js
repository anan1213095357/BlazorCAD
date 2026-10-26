// CAD CPU mathematics. Independent implementation; column-major matrices,
// right-handed coordinates, model units in millimetres.
export const MathUtils={clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),degToRad:x=>x*Math.PI/180,radToDeg:x=>x*180/Math.PI,lerp:(a,b,t)=>a+(b-a)*t};
export class Vector2 {
 constructor(x=0,y=0){this.x=x;this.y=y;this.isVector2=true;}
 set(x,y){this.x=x;this.y=y;return this;} setScalar(s){return this.set(s,s);}
 copy(v){return this.set(v.x,v.y);} clone(){return new Vector2(this.x,this.y);}
 add(v){this.x+=v.x;this.y+=v.y;return this;} sub(v){this.x-=v.x;this.y-=v.y;return this;}
 addVectors(a,b){return this.copy(a).add(b);} subVectors(a,b){return this.copy(a).sub(b);}
 addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;return this;}
 multiplyScalar(s){this.x*=s;this.y*=s;return this;} divideScalar(s){return this.multiplyScalar(1/s);}
 negate(){return this.multiplyScalar(-1);} dot(v){return this.x*v.x+this.y*v.y;} cross(v){return this.x*v.y-this.y*v.x;}
 lengthSq(){return this.dot(this);} length(){return Math.hypot(this.x,this.y);} normalize(){return this.divideScalar(this.length()||1);}
 setLength(s){return this.normalize().multiplyScalar(s);} distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2;} distanceTo(v){return Math.sqrt(this.distanceToSquared(v));}
 lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;return this;}
 min(v){this.x=Math.min(this.x,v.x);this.y=Math.min(this.y,v.y);return this;} max(v){this.x=Math.max(this.x,v.x);this.y=Math.max(this.y,v.y);return this;}
 equals(v){return this.x===v.x&&this.y===v.y;} getComponent(i){return i===0?this.x:this.y;}
 fromArray(a,o=0){return this.set(a[o],a[o+1]);} toArray(a=[],o=0){a[o]=this.x;a[o+1]=this.y;return a;}
 fromBufferAttribute(a,i){return this.set(a.getX(i),a.getY(i));}
}
export class Vector3 {
 constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;this.isVector3=true;}
 set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} setScalar(s){return this.set(s,s,s);}
 copy(v){return this.set(v.x,v.y,v.z);} clone(){return new Vector3(this.x,this.y,this.z);}
 add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;} sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
 addScalar(s){this.x+=s;this.y+=s;this.z+=s;return this;}
 addVectors(a,b){return this.copy(a).add(b);} subVectors(a,b){return this.copy(a).sub(b);}
 addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
 multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;} divideScalar(s){return this.multiplyScalar(1/s);}
 multiply(v){this.x*=v.x;this.y*=v.y;this.z*=v.z;return this;} negate(){return this.multiplyScalar(-1);}
 dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;} cross(v){const x=this.x,y=this.y,z=this.z;return this.set(y*v.z-z*v.y,z*v.x-x*v.z,x*v.y-y*v.x);}
 crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
 lengthSq(){return this.dot(this);} length(){return Math.hypot(this.x,this.y,this.z);} normalize(){return this.divideScalar(this.length()||1);}
 setLength(s){return this.normalize().multiplyScalar(s);} distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;} distanceTo(v){return Math.sqrt(this.distanceToSquared(v));}
 lerp(v,t){this.x+=(v.x-this.x)*t;this.y+=(v.y-this.y)*t;this.z+=(v.z-this.z)*t;return this;}
 lerpVectors(a,b,t){return this.copy(a).lerp(b,t);}
 min(v){this.x=Math.min(this.x,v.x);this.y=Math.min(this.y,v.y);this.z=Math.min(this.z,v.z);return this;}
 max(v){this.x=Math.max(this.x,v.x);this.y=Math.max(this.y,v.y);this.z=Math.max(this.z,v.z);return this;}
 equals(v){return this.x===v.x&&this.y===v.y&&this.z===v.z;} getComponent(i){return [this.x,this.y,this.z][i];}
 setComponent(i,s){this[['x','y','z'][i]]=s;return this;}
 fromArray(a,o=0){return this.set(a[o],a[o+1],a[o+2]);} toArray(a=[],o=0){a[o]=this.x;a[o+1]=this.y;a[o+2]=this.z;return a;}
 fromBufferAttribute(a,i){return this.set(a.getX(i),a.getY(i),a.getZ(i));}
 applyMatrix4(m){const a=m.elements,x=this.x,y=this.y,z=this.z,w=a[3]*x+a[7]*y+a[11]*z+a[15];return this.set((a[0]*x+a[4]*y+a[8]*z+a[12])/w,(a[1]*x+a[5]*y+a[9]*z+a[13])/w,(a[2]*x+a[6]*y+a[10]*z+a[14])/w);}
 transformDirection(m){const a=m.elements,x=this.x,y=this.y,z=this.z;return this.set(a[0]*x+a[4]*y+a[8]*z,a[1]*x+a[5]*y+a[9]*z,a[2]*x+a[6]*y+a[10]*z).normalize();}
 applyQuaternion(q){const x=this.x,y=this.y,z=this.z,tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);return this.set(x+q.w*tx+q.y*tz-q.z*ty,y+q.w*ty+q.z*tx-q.x*tz,z+q.w*tz+q.x*ty-q.y*tx);}
 applyAxisAngle(axis,angle){return this.applyQuaternion(new Quaternion().setFromAxisAngle(axis,angle));}
 project(camera){camera.updateMatrixWorld();return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);}
 unproject(camera){camera.updateMatrixWorld();return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);}
 setFromMatrixPosition(m){return this.fromArray(m.elements,12);}
}
export class Quaternion {
 constructor(x=0,y=0,z=0,w=1){this.set(x,y,z,w);}
 set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;}
 copy(q){return this.set(q.x,q.y,q.z,q.w);} clone(){return new Quaternion(this.x,this.y,this.z,this.w);}
 identity(){return this.set(0,0,0,1);} dot(q){return this.x*q.x+this.y*q.y+this.z*q.z+this.w*q.w;}
 normalize(){const n=Math.sqrt(this.dot(this));return n?this.set(this.x/n,this.y/n,this.z/n,this.w/n):this.identity();}
 invert(){const d=this.dot(this)||1;return this.set(-this.x/d,-this.y/d,-this.z/d,this.w/d);}
 multiply(q){return this.multiplyQuaternions(this.clone(),q);} premultiply(q){return this.multiplyQuaternions(q,this.clone());}
 multiplyQuaternions(a,b){return this.set(a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z);}
 setFromAxisAngle(axis,angle){const s=Math.sin(angle/2);return this.set(axis.x*s,axis.y*s,axis.z*s,Math.cos(angle/2));}
 setFromUnitVectors(a,b){const d=a.dot(b);if(d< -1+1e-10){const axis=Math.abs(a.x)<.8?new Vector3(1,0,0):new Vector3(0,1,0);axis.cross(a).normalize();return this.setFromAxisAngle(axis,Math.PI);}const c=a.clone().cross(b);return this.set(c.x,c.y,c.z,1+d).normalize();}
 setFromRotationMatrix(m){const e=m.elements,t=e[0]+e[5]+e[10];if(t>0){const s=Math.sqrt(1+t)*2;return this.set((e[6]-e[9])/s,(e[8]-e[2])/s,(e[1]-e[4])/s,s/4).normalize();}let i=e[0]>e[5]?0:1;if(e[10]>e[i*5])i=2;const j=(i+1)%3,k=(j+1)%3,s=Math.sqrt(Math.max(0,1+e[i*5]-e[j*5]-e[k*5]))*2,q=[0,0,0];q[i]=s/4;q[j]=(e[j*4+i]+e[i*4+j])/s;q[k]=(e[k*4+i]+e[i*4+k])/s;return this.set(q[0],q[1],q[2],(e[j*4+k]-e[k*4+j])/s).normalize();}
 slerp(other,t){let q=other,d=this.dot(q);if(d<0){q=new Quaternion(-q.x,-q.y,-q.z,-q.w);d=-d;}if(d>.9995)return this.set(this.x+(q.x-this.x)*t,this.y+(q.y-this.y)*t,this.z+(q.z-this.z)*t,this.w+(q.w-this.w)*t).normalize();const angle=Math.acos(MathUtils.clamp(d,-1,1)),s=Math.sin(angle),a=Math.sin((1-t)*angle)/s,b=Math.sin(t*angle)/s;return this.set(this.x*a+q.x*b,this.y*a+q.y*b,this.z*a+q.z*b,this.w*a+q.w*b);}
}
export class Matrix4 {
 constructor(){this.elements=new Float64Array(16);this.identity();}
 identity(){this.elements.fill(0);for(let i=0;i<4;i++)this.elements[i*5]=1;return this;}
 copy(m){this.elements.set(m.elements);return this;} clone(){return new Matrix4().copy(this);}
 set(...rows){for(let r=0;r<4;r++)for(let c=0;c<4;c++)this.elements[c*4+r]=rows[r*4+c];return this;}
 fromArray(a,o=0){this.elements.set(Array.from(a).slice(o,o+16));return this;}
 multiply(m){return this.multiplyMatrices(this.clone(),m);} premultiply(m){return this.multiplyMatrices(m,this.clone());}
 multiplyMatrices(a,b){const result=new Float64Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)result[c*4+r]+=a.elements[k*4+r]*b.elements[c*4+k];this.elements.set(result);return this;}
 transpose(){for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){const a=i*4+j,b=j*4+i,t=this.elements[a];this.elements[a]=this.elements[b];this.elements[b]=t;}return this;}
 invert(){const rows=Array.from({length:4},(_,r)=>[...Array.from({length:4},(_,c)=>this.elements[c*4+r]),...Array.from({length:4},(_,c)=>r===c?1:0)]);for(let c=0;c<4;c++){let pivot=c;for(let r=c+1;r<4;r++)if(Math.abs(rows[r][c])>Math.abs(rows[pivot][c]))pivot=r;if(Math.abs(rows[pivot][c])<1e-30)throw new Error('几何变换矩阵不可逆。');[rows[c],rows[pivot]]=[rows[pivot],rows[c]];const d=rows[c][c];for(let k=0;k<8;k++)rows[c][k]/=d;for(let r=0;r<4;r++)if(r!==c){const s=rows[r][c];for(let k=0;k<8;k++)rows[r][k]-=s*rows[c][k];}}for(let r=0;r<4;r++)for(let c=0;c<4;c++)this.elements[c*4+r]=rows[r][c+4];return this;}
 makeBasis(x,y,z){return this.set(x.x,y.x,z.x,0,x.y,y.y,z.y,0,x.z,y.z,z.z,0,0,0,0,1);}
 setPosition(v,y,z){if(typeof v==='number')return this.setPosition(new Vector3(v,y,z));this.elements[12]=v.x;this.elements[13]=v.y;this.elements[14]=v.z;return this;}
 compose(position,q,scale){const x=new Vector3(1,0,0).applyQuaternion(q).multiplyScalar(scale.x),y=new Vector3(0,1,0).applyQuaternion(q).multiplyScalar(scale.y),z=new Vector3(0,0,1).applyQuaternion(q).multiplyScalar(scale.z);return this.makeBasis(x,y,z).setPosition(position);}
 makeTranslation(x,y,z){return this.identity().setPosition(x,y,z);}
 makeRotationX(a){return this.makeBasis(new Vector3(1,0,0),new Vector3(0,Math.cos(a),Math.sin(a)),new Vector3(0,-Math.sin(a),Math.cos(a)));}
 makeRotationY(a){return this.makeBasis(new Vector3(Math.cos(a),0,-Math.sin(a)),new Vector3(0,1,0),new Vector3(Math.sin(a),0,Math.cos(a)));}
 makeRotationZ(a){return this.makeBasis(new Vector3(Math.cos(a),Math.sin(a),0),new Vector3(-Math.sin(a),Math.cos(a),0),new Vector3(0,0,1));}
}
export class Box2 {
 constructor(min=new Vector2(Infinity,Infinity),max=new Vector2(-Infinity,-Infinity)){this.min=min;this.max=max;}
 makeEmpty(){this.min.set(Infinity,Infinity);this.max.set(-Infinity,-Infinity);return this;}
 setFromPoints(points){this.makeEmpty();for(const point of points)this.expandByPoint(point);return this;}
 expandByPoint(p){this.min.min(p);this.max.max(p);return this;} expandByScalar(s){this.min.add(new Vector2(-s,-s));this.max.add(new Vector2(s,s));return this;}
 isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y;}
 getCenter(out){return this.isEmpty()?out.set(0,0):out.copy(this.min).add(this.max).multiplyScalar(.5);}
 getSize(out){return this.isEmpty()?out.set(0,0):out.copy(this.max).sub(this.min);}
 containsPoint(p){return p.x>=this.min.x&&p.x<=this.max.x&&p.y>=this.min.y&&p.y<=this.max.y;}
 intersectsBox(b){return this.max.x>=b.min.x&&this.min.x<=b.max.x&&this.max.y>=b.min.y&&this.min.y<=b.max.y;}
 clone(){return new Box2(this.min.clone(),this.max.clone());}
}
export class Box3 {
 constructor(min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity)){this.min=min;this.max=max;}
 makeEmpty(){this.min.setScalar(Infinity);this.max.setScalar(-Infinity);return this;}
 setFromPoints(points){this.makeEmpty();for(const point of points)this.expandByPoint(point);return this;}
 expandByPoint(p){this.min.min(p);this.max.max(p);return this;} expandByScalar(s){this.min.addScalar(-s);this.max.addScalar(s);return this;}
 isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z;}
 getCenter(out){return this.isEmpty()?out.set(0,0,0):out.copy(this.min).add(this.max).multiplyScalar(.5);}
 getSize(out){return this.isEmpty()?out.set(0,0,0):out.copy(this.max).sub(this.min);}
 containsPoint(p){return [0,1,2].every(i=>p.getComponent(i)>=this.min.getComponent(i)&&p.getComponent(i)<=this.max.getComponent(i));}
 intersectsBox(b){return [0,1,2].every(i=>this.max.getComponent(i)>=b.min.getComponent(i)&&this.min.getComponent(i)<=b.max.getComponent(i));}
 copy(b){this.min.copy(b.min);this.max.copy(b.max);return this;} clone(){return new Box3().copy(this);}
 union(b){this.min.min(b.min);this.max.max(b.max);return this;}
}
export class Plane {
 constructor(normal=new Vector3(1,0,0),constant=0){this.normal=normal;this.constant=constant;}
 setFromNormalAndCoplanarPoint(n,p){this.normal.copy(n);this.constant=-n.dot(p);return this;}
 distanceToPoint(p){return this.normal.dot(p)+this.constant;}
 projectPoint(p,out){return out.copy(p).addScaledVector(this.normal,-this.distanceToPoint(p)/this.normal.lengthSq());}
}
export class Line3 {
 constructor(start=new Vector3(),end=new Vector3()){this.start=start;this.end=end;}
 closestPointToPointParameter(p,clamp=false){const d=this.end.clone().sub(this.start),t=p.clone().sub(this.start).dot(d)/(d.lengthSq()||1);return clamp?MathUtils.clamp(t,0,1):t;}
 closestPointToPoint(p,clamp,out){return out.copy(this.start).lerp(this.end,this.closestPointToPointParameter(p,clamp));}
}
export class Triangle {
 constructor(a=new Vector3(),b=new Vector3(),c=new Vector3()){this.a=a;this.b=b;this.c=c;}
 closestPointToPoint(p,out){
  const a=this.a,b=this.b,c=this.c,ab=b.clone().sub(a),ac=c.clone().sub(a),ap=p.clone().sub(a),d1=ab.dot(ap),d2=ac.dot(ap);
  if(d1<=0&&d2<=0)return out.copy(a);const bp=p.clone().sub(b),d3=ab.dot(bp),d4=ac.dot(bp);if(d3>=0&&d4<=d3)return out.copy(b);
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return out.copy(a).addScaledVector(ab,d1/(d1-d3));
  const cp=p.clone().sub(c),d5=ab.dot(cp),d6=ac.dot(cp);if(d6>=0&&d5<=d6)return out.copy(c);
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return out.copy(a).addScaledVector(ac,d2/(d2-d6));
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return out.copy(b).addScaledVector(c.clone().sub(b),(d4-d3)/(d4-d3+d5-d6));
  const sum=va+vb+vc;if(Math.abs(sum)<1e-30){let best=Infinity;for(const [x,y] of [[a,b],[b,c],[c,a]]){const q=new Line3(x,y).closestPointToPoint(p,true,new Vector3()),d=p.distanceToSquared(q);if(d<best){best=d;out.copy(q);}}return out;}
  return out.copy(a).addScaledVector(ab,vb/sum).addScaledVector(ac,vc/sum);
 }
}
export class Ray {
 constructor(origin=new Vector3(),direction=new Vector3(0,0,-1)){this.origin=origin;this.direction=direction;}
 copy(r){this.origin.copy(r.origin);this.direction.copy(r.direction);return this;} clone(){return new Ray().copy(this);}
 at(t,out){return out.copy(this.origin).addScaledVector(this.direction,t);}
 applyMatrix4(m){this.origin.applyMatrix4(m);this.direction.transformDirection(m);return this;}
 intersectPlane(plane,out){const d=plane.normal.dot(this.direction);if(Math.abs(d)<1e-20)return Math.abs(plane.distanceToPoint(this.origin))<1e-12?out.copy(this.origin):null;const t=-plane.distanceToPoint(this.origin)/d;return t<0?null:this.at(t,out);}
 intersectBox(box,out){let low=0,high=Infinity;for(let i=0;i<3;i++){const origin=this.origin.getComponent(i),d=this.direction.getComponent(i),min=box.min.getComponent(i),max=box.max.getComponent(i);if(Math.abs(d)<1e-30){if(origin<min||origin>max)return null;continue;}let a=(min-origin)/d,b=(max-origin)/d;if(a>b)[a,b]=[b,a];low=Math.max(low,a);high=Math.min(high,b);if(low>high)return null;}return this.at(box.containsPoint(this.origin)?high:low,out);}
 intersectTriangle(a,b,c,cull,out){const e1=b.clone().sub(a),e2=c.clone().sub(a),p=this.direction.clone().cross(e2),det=e1.dot(p);if(cull?det<=1e-14:Math.abs(det)<1e-14)return null;const tvec=this.origin.clone().sub(a),u=tvec.dot(p)/det;if(u<0||u>1)return null;const q=tvec.cross(e1),v=this.direction.dot(q)/det;if(v<0||u+v>1)return null;const t=e2.dot(q)/det;return t<0?null:this.at(t,out);}
 distanceSqToSegment(a,b,onRay=new Vector3(),onSegment=new Vector3()){
  const segment=b.clone().sub(a),w=this.origin.clone().sub(a),aa=this.direction.lengthSq(),bb=this.direction.dot(segment),cc=segment.lengthSq(),dd=this.direction.dot(w),ee=segment.dot(w),den=aa*cc-bb*bb;
  let u=den>1e-20?MathUtils.clamp((aa*ee-bb*dd)/den,0,1):MathUtils.clamp(ee/(cc||1),0,1),t=Math.max(0,(bb*u-dd)/(aa||1));
  if(t===0)u=MathUtils.clamp(ee/(cc||1),0,1);this.at(t,onRay);onSegment.copy(a).addScaledVector(segment,u);return onRay.distanceToSquared(onSegment);
 }
}
