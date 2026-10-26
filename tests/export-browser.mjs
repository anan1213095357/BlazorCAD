import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=path.resolve('wwwroot'),project=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).document;
const server=http.createServer((request,response)=>{
 if(request.url==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><div id="cad-test" style="position:fixed;inset:0"></div>');return;}
 const filename=path.resolve(root,'.'+decodeURIComponent(request.url.split('?')[0]));
 if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)){response.writeHead(404).end();return;}
 response.setHeader('Content-Type',filename.endsWith('.wasm')?'application/wasm':filename.endsWith('.js')?'text/javascript':'application/octet-stream');fs.createReadStream(filename).pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1100,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(async document=>{
  const cad=await import('/cad.js');window.cad=cad;window.exportEvents=[];
  cad.init('cad-test',{invokeMethodAsync:async(name,...args)=>{if(name==='StlExportProgress')window.exportEvents.push(args);return null;}});
  await cad.prepareLoadedDocument(document);
  cad.update(document,{operation:null,editingId:null,editingFeatureId:null,sketchId:null,profileId:null,regionKeys:[],tool:'select',featureMode:'extrude',distance:20,endCondition:'blind',featureDraft:{mode:'extrude',sections:[]}});
 },project);
 const started=performance.now(),downloadPromise=page.waitForEvent('download',{timeout:60000});
 await page.evaluate(()=>window.cad.exportStl('current-project',1));
 const download=await downloadPromise;await download.saveAs('tests/export-browser-current.stl');
 await page.waitForFunction(()=>window.exportEvents.some(event=>event[1]===true));
 const events=await page.evaluate(()=>window.exportEvents);console.log(JSON.stringify({downloadMs:performance.now()-started,events,errors}));
 assert.deepEqual(errors,[]);assert(events.at(-1)[0].startsWith('STL 已导出'));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
// Independent verification of the actual downloaded binary, not worker objects.
const buffer=fs.readFileSync('tests/export-browser-current.stl'),count=buffer.readUInt32LE(80);assert.equal(buffer.length,84+count*50);
const edges=new Map();let volume=0;
for(let triangle=0;triangle<count;triangle++){
 const offset=84+triangle*50,points=Array.from({length:3},(_,i)=>Array.from({length:3},(_,axis)=>buffer.readFloatLE(offset+12+i*12+axis*4)));
 assert(points.flat().every(Number.isFinite));
 for(let i=0;i<3;i++){const a=points[i].join('/'),b=points[(i+1)%3].join('/'),key=a<b?a+'>'+b:b+'>'+a,item=edges.get(key)??[0,0];item[0]++;item[1]+=a<b?1:-1;edges.set(key,item);}
 const [a,b,c]=points;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
}
const bad=[...edges.values()].filter(([count,balance])=>count!==2||balance!==0);assert.equal(bad.length,0);assert(volume>0);
console.log(JSON.stringify({triangles:count,bytes:buffer.length,invalidEdges:bad.length,signedVolume:volume}));
