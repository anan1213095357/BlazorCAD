import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:5189/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><script type="importmap">{"imports":{"three":"/vendor/three.core.js"}}</script><link rel="stylesheet" href="/app.css"></head><body></body></html>'}));
 await page.goto('http://127.0.0.1:5189/');
 const project=process.env.BEVEL_PROJECT?JSON.parse(fs.readFileSync(process.env.BEVEL_PROJECT,'utf8')).document:null;
 const handle=await page.evaluate(async({hollow,project})=>{
  const cad=await import('/cad.js'),g=await import('/geometry.js');
  // Isolated canvas and in-memory document: do not save or replace a project.
  cad.dispose();const host=document.createElement('div');host.id='bevel-test';host.style='position:fixed;inset:0;background:#1b2430';document.body.append(host);
  const panel=document.createElement('div');panel.id='test-panel';panel.style='position:fixed;left:10px;top:10px;z-index:100';panel.innerHTML='<canvas id="edge-profile-canvas" style="width:320px;height:240px" tabindex="0"></canvas><button id="feature-confirm">确认</button>';document.body.append(panel);
  window.__edgeRequests=0;const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(data,...args){if(data.feature?.topologyBevel)window.__edgeRequests++;return post.call(this,data,...args);};
  let ui;const events=[];await cad.init(host.id,{invokeMethodAsync:async(name,...args)=>{events.push({name,args});if(name==='SetEdgeRadius'){ui.distance=args[2];ui.featureDraft.depth=args[2];}return null;}});
  const sketch=(id,x,y,w,h,z)=>({id,finished:true,hidden:true,plane:{reference:'XY',offset:z},entities:[{id:id+'r',kind:'rectangle',x,y,width:w,height:h,construction:false}]});
  const doc=project??{sketches:[sketch('s',0,0,40,30,0),sketch('t',5,3,27,19,25)],features:[{id:'body',kind:'add',mode:'loft',sketchId:'s',profileId:'sr',sections:[{sketchId:'t',profileId:'tr'}],depth:25}]};
  if(hollow&&!project){doc.sketches.push(sketch('o',-10,-10,70,60,0),sketch('p',-10,-10,70,60,25));doc.features[0].kind='cut';doc.features.unshift({id:'outer',kind:'add',mode:'loft',sketchId:'o',profileId:'or',sections:[{sketchId:'p',profileId:'pr'}],depth:25});}
  const target=project?doc.features.filter(f=>f.mode==='loft').at(-1):doc.features.find(f=>f.id==='body'),all=g.solidEdgeOptions(g.buildSolid(doc)).filter(e=>[e.faceA.featureId,e.faceB.featureId].includes(target.id)),height=Math.max(...all.flatMap(e=>[e.a.z,e.b.z])),edges=all.filter(e=>Math.abs(e.a.z-height)<1e-5&&Math.abs(e.b.z-height)<1e-5),distance=project?1:2;
  const feature={id:'feature-preview',kind:'cut',mode:'chamfer',sketchId:target.sketchId,edgeTreatment:'chamfer',topologyBevel:true,visualOnly:false,depth:distance,chamferAngle:45,chamferEdges:edges.map(e=>({kind:'line',faceA:e.faceA,faceB:e.faceB,segment:e.segment}))};
  ui={operation:'cut',featureMode:'chamfer',featureDraft:feature,sketchId:target.sketchId,regionKeys:[],distance,endCondition:'blind',tool:'select'};
  await cad.prepareDocument(doc);cad.update(doc,ui);cad.fit(true);
  const end=performance.now()+15000;while(!events.some(e=>e.name==='UpdateEdgePreview'&&e.args[5]===true)&&performance.now()<end)await new Promise(r=>setTimeout(r,30));
  const preview=events.filter(e=>e.name==='UpdateEdgePreview');
  if(!preview.some(e=>e.args[5]===true))throw new Error('preview not accepted: '+JSON.stringify(preview));
  const range=distance*2.8,edge=edges[0],theta=Math.PI-Math.acos(Math.max(-1,Math.min(1,edge.normalA.dot(edge.normalB)))),negative=Math.max(0,-Math.cos(theta)),scale=160/(range*(1+negative)),origin=32+negative*range*scale;
  window.__bevelSession={cad,g,doc,feature,ui,events};
  return {x:10+origin+distance*(1+Math.cos(theta))*scale/2,y:10+208-distance*Math.sin(theta)*scale/2,requests:window.__edgeRequests};
 },{hollow:process.env.BEVEL_HOLLOW==='1',project});
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();
 for(let i=1;i<=8;i++){await page.mouse.move(handle.x+2*i,handle.y-i);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}
 const during=await page.evaluate(()=>({requests:window.__edgeRequests,disabled:document.getElementById('feature-confirm').disabled}));
 assert.equal(during.requests,handle.requests,'dragging within cached topology does not request a BSP rebuild');assert(during.disabled,'confirmation disabled while dragging');
 await page.mouse.up();await page.waitForFunction(()=>window.__bevelSession.events.some(e=>e.name==='SetEdgeRadius'));
 const result=await page.evaluate(async()=>{
  const {cad,g,doc,feature,ui,events}=window.__bevelSession;
  const saved={...doc,features:[...doc.features,{...feature,id:'saved',depth:ui.distance}]};
  const start=performance.now();await cad.prepareDocument(saved);const confirmMs=performance.now()-start;
  cad.update(saved,{...ui,operation:null,featureDraft:null});cad.fit(true);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  document.getElementById('test-panel').hidden=true;
  return {preview:events.filter(e=>e.name==='UpdateEdgePreview'),confirmMs,distance:ui.distance,requests:window.__edgeRequests,polygons:g.buildSolid(saved).length,canvas:document.getElementById('bevel-test').querySelector('canvas').width};
 });
 assert(result.polygons>0);assert(result.canvas>0);assert.deepEqual(errors,[]);
 await page.screenshot({path:process.env.BEVEL_HOLLOW==='1'?'tests/bevel-hollow.png':'tests/bevel-browser.png'});
 console.log(JSON.stringify(result));
}finally{await browser.close();}

