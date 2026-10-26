import {Vector2,Vector3} from './math.js';

const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const same=(a,b)=>a.x===b.x&&a.y===b.y;
export function area(points){let total=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];total+=a.x*b.y-b.x*a.y;}return total/2;}
function contains(point,loop){let inside=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
function crosses(a,b,c,d){const t1=turn(a,b,c),t2=turn(a,b,d),t3=turn(c,d,a),t4=turn(c,d,b);return t1*t2< -1e-24&&t3*t4< -1e-24;}
function clean(points,offset){const ring=[];for(let i=0;i<points.length;i++)if(!i||!same(points[i],points[i-1]))ring.push({x:points[i].x,y:points[i].y,index:offset+i});if(ring.length>1&&same(ring[0],ring.at(-1)))ring.pop();return ring;}
export function triangulateShape(contour,holes=[]){
 let offset=contour.length,outer=clean(contour,0);const inner=holes.map(hole=>{const ring=clean(hole,offset);offset+=hole.length;return ring;});
 if(outer.length<3)return [];if(area(outer)<0)outer.reverse();for(const hole of inner)if(area(hole)>0)hole.reverse();
 const original=outer.slice(),triangles=[];
 for(const hole of inner.sort((a,b)=>Math.max(...b.map(p=>p.x))-Math.max(...a.map(p=>p.x)))){
  if(hole.length<3)continue;let hi=0;for(let i=1;i<hole.length;i++)if(hole[i].x>hole[hi].x)hi=i;const h=hole[hi];
  const boundaries=[outer,...inner];let best=-1,distance=Infinity;
  for(let i=0;i<outer.length;i++){
   const candidate=outer[i],length=(h.x-candidate.x)**2+(h.y-candidate.y)**2;if(length>=distance||same(candidate,h))continue;
   if(boundaries.some(ring=>ring.some((p,j)=>!same(p,h)&&!same(p,candidate)&&!same(ring[(j+1)%ring.length],h)&&!same(ring[(j+1)%ring.length],candidate)&&crosses(h,candidate,p,ring[(j+1)%ring.length]))))continue;
   const midpoint={x:(h.x+candidate.x)/2,y:(h.y+candidate.y)/2};if(!contains(midpoint,original)||inner.some(ring=>contains(midpoint,ring)))continue;
   best=i;distance=length;
  }
  if(best<0)throw new Error('孔轮廓无法连接到外边界，请检查自交或重叠截面。');
  const walk=Array.from({length:hole.length},(_,i)=>hole[(hi+i)%hole.length]);
  outer=[...outer.slice(0,best+1),...walk,h,outer[best],...outer.slice(best+1)];
 }
 let ring=outer.slice();
 while(ring.length>3){
  let removed=false;
  for(let i=0;i<ring.length;i++){
   const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length],cross=turn(a,b,c);
   if(cross<=1e-16)continue;
   const blocked=ring.some((point,j)=>j!==i&&j!==(i+1)%ring.length&&j!==(i+ring.length-1)%ring.length&&!same(point,a)&&!same(point,b)&&!same(point,c)&&turn(a,b,point)>=-1e-14&&turn(b,c,point)>=-1e-14&&turn(c,a,point)>=-1e-14);
   if(blocked)continue;
   triangles.push([a.index,b.index,c.index]);ring.splice(i,1);removed=true;break;
  }
  if(removed)continue;
  const collinear=ring.findIndex((b,i)=>Math.abs(turn(ring[(i+ring.length-1)%ring.length],b,ring[(i+1)%ring.length]))<1e-16);
  if(collinear>=0){ring.splice(collinear,1);continue;}
  throw new Error('截面三角化失败：存在自交或无法消除的退化边界。');
 }
 if(ring.length===3&&turn(...ring)>1e-16)triangles.push(ring.map(point=>point.index));
 // Independent area accounting prevents a bridge from silently filling a hole.
 const flat=[contour,...holes].flat(),expected=Math.abs(area(contour))-holes.reduce((sum,hole)=>sum+Math.abs(area(hole)),0),actual=triangles.reduce((sum,triangle)=>sum+Math.abs(turn(...triangle.map(i=>flat[i])))/2,0);
 if(Math.abs(actual-expected)>Math.max(1e-7,Math.abs(expected)*1e-9))throw new Error('截面三角化面积不一致，已停止生成错误面。');
 return triangles;
}
export const ShapeUtils={area,isClockWise:points=>area(points)<0,triangulateShape};
export class Path {
 constructor(points=[]){this.commands=[];this.current=new Vector2();for(const [i,p] of points.entries())i?this.lineTo(p.x,p.y):this.moveTo(p.x,p.y);}
 moveTo(x,y){this.commands.push({kind:'move',point:new Vector2(x,y)});this.current.set(x,y);return this;}
 lineTo(x,y){this.commands.push({kind:'line',point:new Vector2(x,y)});this.current.set(x,y);return this;}
 closePath(){this.closed=true;return this;}
 absarc(x,y,r,from,to,clockwise=false){return this.absellipse(x,y,r,r,from,to,clockwise,0);}
 absellipse(x,y,rx,ry,from,to,clockwise=false,rotation=0){this.commands.push({kind:'ellipse',x,y,rx,ry,from,to,clockwise,rotation});return this;}
 getPoints(divisions=12){const points=[];const push=point=>{if(!points.length||points.at(-1).distanceToSquared(point)>1e-24)points.push(point);};for(const command of this.commands){if(command.kind!=='ellipse'){push(command.point.clone());continue;}let sweep=command.to-command.from;const full=Math.abs(sweep)>=2*Math.PI-1e-12;if(full)sweep=command.clockwise?-2*Math.PI:2*Math.PI;else if(command.clockwise){while(sweep>0)sweep-=2*Math.PI;}else while(sweep<0)sweep+=2*Math.PI;const steps=Math.max(1,Math.ceil(divisions*2*Math.abs(sweep)/(2*Math.PI))),c=Math.cos(command.rotation),s=Math.sin(command.rotation);for(let i=0;i<=steps;i++){const t=command.from+sweep*i/steps,a=command.rx*Math.cos(t),b=command.ry*Math.sin(t);push(new Vector2(command.x+a*c-b*s,command.y+a*s+b*c));}}if(this.closed&&points.length&&!same(points[0],points.at(-1)))points.push(points[0].clone());return points;}
}
export class Shape extends Path {
 constructor(points=[]){super(points);this.holes=[];}
 extractPoints(divisions=12){return {shape:this.getPoints(divisions),holes:this.holes.map(hole=>hole.getPoints(divisions))};}
}
export class CatmullRomCurve3 {
 constructor(points,closed=false){this.points=points;this.closed=closed;}
 getPoint(t){const n=this.points.length,position=t*(this.closed?n:n-1),i=Math.min(Math.floor(position),n-1),u=position-i,at=j=>this.points[this.closed?(j%n+n)%n:Math.max(0,Math.min(n-1,j))];const a=at(i-1),b=at(i),c=at(i+1),d=at(i+2);
  // Centripetal nonuniform knots avoid loops at unequal control spacing.
  const dt=(p,q)=>Math.max(1e-4,Math.sqrt(p.distanceTo(q))),t0=0,t1=dt(a,b),t2=t1+dt(b,c),t3=t2+dt(c,d),s=t1+u*(t2-t1);
  const mix=(p,q,l,h)=>p.clone().multiplyScalar((h-s)/(h-l)).addScaledVector(q,(s-l)/(h-l));
  const p=mix(a,b,t0,t1),q=mix(b,c,t1,t2),r=mix(c,d,t2,t3),left=mix(p,q,t0,t2),right=mix(q,r,t1,t3);return mix(left,right,t1,t2);
 }
 getSpacedPoints(count=32){const samples=Array.from({length:Math.max(count*8,128)+1},(_,i,array)=>i);const steps=samples.length-1,points=Array.from({length:steps+1},(_,i)=>this.getPoint(i/steps)),lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+points[i].distanceTo(points[i-1]));return Array.from({length:count+1},(_,i)=>{const distance=lengths.at(-1)*i/count;let low=0,high=steps;while(high-low>1){const mid=(low+high)>>1;if(lengths[mid]<distance)low=mid;else high=mid;}return points[low].clone().lerp(points[high],(distance-lengths[low])/(lengths[high]-lengths[low]||1));});}
}
