import assert from 'node:assert/strict';
import {buildSolid,solidEdgeOptions,volume,solidGeometry} from '../wwwroot/geometry.js';
import {compileFilletMotion} from '../wwwroot/fillet-motion.js';
const sketch=(id,x,y,width,height,z=0)=>({id,plane:{reference:'XY',offset:z},entities:[{id:id+'r',kind:'rectangle',x,y,width,height}]});
const reference=e=>({kind:'line',faceA:e.faceA,faceB:e.faceB,segment:e.segment});
for(const taper of [0,5,-5]){
 const a=sketch('s',0,0,40,30),b=sketch('t',taper,taper,40-2*taper,30-2*taper,25);
 let doc={sketches:[a,b],features:[{id:'body',kind:'add',mode:'loft',sketchId:'s',profileId:'sr',sections:[{sketchId:'t',profileId:'tr'}],depth:25}]};
 let solid=buildSolid(doc);const initial=volume(solid),edges=solidEdgeOptions(solid);
 const rim=edges.filter(e=>Math.abs(e.a.z-25)<1e-5&&Math.abs(e.b.z-25)<1e-5);
 assert.equal(rim.length,4);
 doc={...doc,features:[...doc.features,{id:'bevel',kind:'cut',mode:'chamfer',sketchId:'s',edgeTreatment:'chamfer',topologyBevel:true,depth:2,chamferAngle:45,chamferEdges:rim.map(reference)}]};
 solid=buildSolid(doc);assert(volume(solid)<initial);console.log('rim',taper,solid.length,volume(solid));
 const before={...doc,features:doc.features.slice(0,-1)},feature=doc.features.at(-1),render=solidGeometry(solid),motion=compileFilletMotion(before,feature,solid,render.polygons);
 console.log('motion',taper,motion&&[motion.min,motion.max]);
 assert(motion,'straight rim must support cached dragging');
 for(const distance of [.15,1,2.1,4,8].filter(d=>d>=motion.min&&d<=motion.max)){
  const moved=solid.map((p,i)=>({...p,vertices:p.vertices.map((v,j)=>v.clone().addScaledVector({x:motion.vertices[i][j][0],y:motion.vertices[i][j][1],z:motion.vertices[i][j][2]},distance-2))})),exact=buildSolid({...before,features:[...before.features,{...feature,depth:distance}]});
  assert(Math.abs(volume(moved)-volume(exact))<1e-5,'affine preview matches committed volume');
  for(const p of moved)for(const point of p.vertices)assert(exact.some(q=>q.vertices.some(v=>v.distanceToSquared(point)<1e-10)),'preview boundary matches rebuilt boundary');
 }
 render.geometry.dispose();
 for(let i=0;i<2;i++){
  const edge=solidEdgeOptions(solid).find(e=>e.faceA.featureId===doc.features.at(-1).id||e.faceB.featureId===doc.features.at(-1).id);assert(edge,'generated edge selectable');
  doc={...doc,features:[...doc.features,{id:'repeat'+i,kind:'cut',mode:'chamfer',sketchId:'s',edgeTreatment:'chamfer',topologyBevel:true,depth:.3,chamferAngle:45,chamferEdges:[reference(edge)]}]};
  solid=buildSolid(doc);assert(Number.isFinite(volume(solid)));console.log('repeat',taper,i,solid.length);
 }
}
{
 const source=sketch('cube',0,0,40,30),base={sketches:[source],features:[{id:'cube',kind:'add',mode:'extrude',sketchId:'cube',profileId:'cuber',depth:25}]},vertical=solidEdgeOptions(buildSolid(base)).filter(e=>Math.abs(e.a.z-e.b.z)>24);
 assert.equal(vertical.length,4);
 let doc={...base,features:[...base.features,{id:'vertical',kind:'cut',mode:'chamfer',sketchId:'cube',edgeTreatment:'chamfer',topologyBevel:true,depth:2,chamferAngle:45,chamferEdges:vertical.map(reference)}]},solid=buildSolid(doc);
 const octagon=solidEdgeOptions(solid).filter(e=>Math.abs(e.a.z-25)<1e-5&&Math.abs(e.b.z-25)<1e-5);assert.equal(octagon.length,8);
 doc={...doc,features:[...doc.features,{id:'octagon',kind:'cut',mode:'chamfer',sketchId:'cube',edgeTreatment:'chamfer',topologyBevel:true,depth:.5,chamferAngle:45,chamferEdges:octagon.map(reference)}]};solid=buildSolid(doc);
 const next=solidEdgeOptions(solid).filter(e=>e.faceA.featureId==='octagon'||e.faceB.featureId==='octagon');assert(next.length>=16);
 for(const edge of next.slice(0,2))assert(buildSolid({...doc,features:[...doc.features,{id:'third',kind:'cut',mode:'chamfer',sketchId:'cube',edgeTreatment:'chamfer',topologyBevel:true,depth:.1,chamferAngle:45,chamferEdges:[reference(edge)]}]}).length);
 console.log('four vertical edges, eight top edges, and third bevel passed');
}
// Hollow tapered loft: the two inner sides have different lengths and slopes.
for(const angle of [30,45,60])for(const depth of [1,2,3.9]){
 const sketches=[sketch('outer',-10,-10,70,60),sketch('end',-10,-10,70,60,25),sketch('hole',0,0,40,30),sketch('holeEnd',5,3,27,19,25)];
 const base={sketches,features:[{id:'outer',kind:'add',mode:'loft',sketchId:'outer',profileId:'outerr',sections:[{sketchId:'end',profileId:'endr'}],depth:25},{id:'hole',kind:'cut',mode:'loft',sketchId:'hole',profileId:'holer',sections:[{sketchId:'holeEnd',profileId:'holeEndr'}],depth:25}]};
 const solid=buildSolid(base),rim=solidEdgeOptions(solid).filter(e=>Math.abs(e.a.z-25)<1e-5&&Math.abs(e.b.z-25)<1e-5&&[e.faceA.featureId,e.faceB.featureId].includes('hole'));
 assert.equal(rim.length,4,'inner rim');
 for(let mask=1;mask<16;mask++){
  const selected=rim.filter((_,i)=>mask&(1<<i)),feature={id:'inner-bevel',kind:'cut',mode:'chamfer',sketchId:'hole',topologyBevel:true,edgeTreatment:'chamfer',depth,chamferAngle:angle,chamferEdges:selected.map(reference)},candidate={...base,features:[...base.features,feature]},result=buildSolid(candidate);
  assert(volume(result)<volume(solid));
  for(const p of result)for(const v of p.vertices)assert(Math.abs(p.normal.dot(v)-p.w)<1e-5,'every ordinary bevel face remains planar');
  if(mask===15){const render=solidGeometry(result),motion=compileFilletMotion(base,feature,result,render.polygons);assert(motion,'inner rim supports cached dragging');const distance=Math.min(depth+.05,motion.max),moved=result.map((p,i)=>({...p,vertices:p.vertices.map((v,j)=>v.clone().addScaledVector({x:motion.vertices[i][j][0],y:motion.vertices[i][j][1],z:motion.vertices[i][j][2]},distance-depth))})),exact=buildSolid({...base,features:[...base.features,{...feature,depth:distance}]});assert(Math.abs(volume(moved)-volume(exact))<1e-5,'inner rim preview agrees with commit');render.geometry.dispose();console.log('inner motion',depth,motion.min,motion.max);}
 }
 console.log('asymmetric inner rim: all 15 edge combinations, D',depth,'angle',angle);
}
