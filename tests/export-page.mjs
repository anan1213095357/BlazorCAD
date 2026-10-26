import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const projectPath=process.argv[2],before=fs.readFileSync(projectPath),project=JSON.parse(before).document;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5195/');
 await page.waitForFunction(count=>document.querySelector('.panel-count')?.textContent.trim()===count+' 步',project.features.length,{timeout:60000});
 assert.equal((await page.locator('.panel-count').innerText()).trim(),project.features.length+' 步');
 const start=performance.now(),downloadPromise=page.waitForEvent('download',{timeout:60000});
 await page.getByRole('button',{name:'导出 STL',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('tests/export-page-current.stl');
 await page.getByText(/STL 已导出，单位毫米/).waitFor({timeout:10000});
 console.log(JSON.stringify({clickToDownloadMs:performance.now()-start,status:await page.getByText(/STL 已导出，单位毫米/).innerText(),bytes:fs.statSync('tests/export-page-current.stl').size,errors}));
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'tests/export-page.png'});
}finally{await browser.close();}
assert.deepEqual(fs.readFileSync(projectPath),before,'original project must remain unchanged');
const buffer=fs.readFileSync('tests/export-page-current.stl'),count=buffer.readUInt32LE(80),edges=new Map();assert.equal(buffer.length,84+count*50);
for(let i=0;i<count;i++){const points=Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>buffer.readFloatLE(84+i*50+12+j*12+k*4)).join('/'));for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3],key=a<b?a+'>'+b:b+'>'+a,edge=edges.get(key)??[0,0];edge[0]++;edge[1]+=a<b?1:-1;edges.set(key,edge);}}
assert([...edges.values()].every(([count,balance])=>count===2&&balance===0));console.log('actual page STL closed:',count,'triangles');
