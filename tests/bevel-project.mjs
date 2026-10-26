// Read-only compatibility check; project contents are never written.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildSolid,solidEdgeOptions,solidGeometry,volume} from '../wwwroot/geometry.js';
import {compileFilletMotion} from '../wwwroot/fillet-motion.js';
const saved=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),doc=saved.document??saved;
let started=performance.now();const solid=buildSolid(doc);console.log('project base',solid.length,'polygons, ms',performance.now()-started);
const target=doc.features.filter(f=>f.mode==='loft').at(-1);assert(target);
started=performance.now();const edges=solidEdgeOptions(solid).filter(e=>[e.faceA.featureId,e.faceB.featureId].includes(target.id));console.log('loft edge selection',edges.length,'ms',performance.now()-started);
assert(edges.length);
const height=Math.max(...edges.flatMap(e=>[e.a.z,e.b.z])),rim=edges.filter(e=>Math.abs(e.a.z-height)<1e-5&&Math.abs(e.b.z-height)<1e-5);assert(rim.length);
const feature={id:'readonly-bevel-check',kind:'cut',mode:'chamfer',sketchId:target.sketchId,edgeTreatment:'chamfer',topologyBevel:true,depth:1,chamferAngle:45,chamferEdges:rim.map(e=>({kind:'line',faceA:e.faceA,faceB:e.faceB,segment:e.segment}))},candidate={...doc,features:[...doc.features,feature]};
started=performance.now();const result=buildSolid(candidate);assert(volume(result)<volume(solid));console.log('project bevel',result.length,'polygons, ms',performance.now()-started);
started=performance.now();const render=solidGeometry(result),motion=compileFilletMotion(doc,feature,result,render.polygons);console.log('project motion',motion&&[motion.min,motion.max],'ms',performance.now()-started);assert(motion);render.geometry.dispose();
