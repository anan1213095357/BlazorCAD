// Per-tab checkpoints survive reloads without mixing independent CAD tabs.
const projectDraftKey='blazorcad.projectDraft.v2',activeProjectKey='blazorcad.activeProject.v1';
const draftKey='blazorcad.draft.v1',logKey='blazorcad.diagnostics.v1';
export function recordDiagnostic(source,error) {
    const entry={time:new Date().toISOString(),source,message:String(error?.stack??error?.message??error).slice(0,3000)};
    try {const entries=JSON.parse(sessionStorage.getItem(logKey)??'[]');entries.push(entry);sessionStorage.setItem(logKey,JSON.stringify(entries.slice(-30)));}catch{}
    if(source==='connection-state')console.info(`[CAD ${source}]`,error);else console.error(`[CAD ${source}]`,error);
}
export function writeDraft(json) {
    try {JSON.parse(json);if(new TextEncoder().encode(json).length>2*1024*1024)throw new Error('草稿超过浏览器恢复大小上限，请保存项目文件');sessionStorage.setItem(draftKey,json);return true;}
    catch(error){recordDiagnostic('draft-save',error);return false;}
}
export function readDraft() {
    const current=readProjectDraft();if(current)return current.json;
    try{const json=sessionStorage.getItem(draftKey);if(json&&new TextEncoder().encode(json).length>2*1024*1024)throw new Error('恢复草稿过大，请使用保存的项目文件');return json;}catch(error){recordDiagnostic('draft-read',error);return null;}
}
export function downloadRecovery() {
    let draft;try{draft=sessionStorage.getItem('blazorcad.rejectedDraft.v1');}catch{}draft??=readDraft();if(!draft)return false;
    download('恢复草稿.cad.json',draft,'application/json');return true;
}
export function downloadDiagnostics() {
    let entries=[];try{entries=JSON.parse(sessionStorage.getItem(logKey)??'[]');}catch{}
    download('CAD-诊断记录.json',JSON.stringify(entries,null,2),'application/json');
}
function download(name,content,type) {
    const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.addEventListener('error',event=>recordDiagnostic('browser-error',event.error??event.message));
window.addEventListener('unhandledrejection',event=>recordDiagnostic('unhandled-promise',event.reason));

document.addEventListener('click',event=>{
    const action=event.target instanceof Element?event.target.closest('[data-cad-recovery]')?.dataset.cadRecovery:null;
    if(action==='draft')downloadRecovery();else if(action==='diagnostics')downloadDiagnostics();
});

export function readProjectDraft(){
    try{const raw=sessionStorage.getItem(projectDraftKey);if(!raw)return null;const draft=JSON.parse(raw);if(typeof draft.json!=='string'||draft.json.length>3*1024*1024||!Number.isSafeInteger(draft.serverRevision)||draft.serverRevision<0)throw new Error('项目草稿格式无效');JSON.parse(draft.json);return draft;}
    catch(error){recordDiagnostic('project-draft-read',error);return null;}
}
export function writeProjectDraft(draft){
    try{JSON.parse(draft.json);if(new TextEncoder().encode(draft.json).length>2*1024*1024)throw new Error('项目草稿超过大小上限');sessionStorage.setItem(projectDraftKey,JSON.stringify(draft));sessionStorage.removeItem(draftKey);return true;}
    catch(error){recordDiagnostic('project-draft-save',error);return false;}
}
export function activeProject(){
    try{const tab=sessionStorage.getItem(activeProjectKey);if(tab)return tab;}catch{}
    try{return localStorage.getItem(activeProjectKey);}catch{return null;}
}
export function rememberProject(id){
    let remembered=false;
    try{sessionStorage.setItem(activeProjectKey,id);remembered=true;}catch{}
    try{localStorage.setItem(activeProjectKey,id);remembered=true;}catch{}
    return remembered;
}

// Keep a rejected draft available for recovery before replacing the active checkpoint.
export function preserveRecoveryDraft(){
    try{const raw=sessionStorage.getItem(projectDraftKey)??sessionStorage.getItem(draftKey);if(!raw)return true;let json=raw;try{const envelope=JSON.parse(raw);if(typeof envelope.json==='string')json=envelope.json;}catch{}sessionStorage.setItem('blazorcad.rejectedDraft.v1',json);return true;}
    catch(error){recordDiagnostic('recovery-preserve',error);return false;}
}

export function forgetProject(id){
    const matches=value=>typeof value==='string'&&value.toLowerCase()===id.toLowerCase();
    try{const draft=readProjectDraft();if(matches(draft?.projectId)||!draft&&matches(sessionStorage.getItem(activeProjectKey))){sessionStorage.removeItem(projectDraftKey);sessionStorage.removeItem(draftKey);sessionStorage.removeItem('blazorcad.rejectedDraft.v1');}if(matches(sessionStorage.getItem(activeProjectKey)))sessionStorage.removeItem(activeProjectKey);}catch(error){recordDiagnostic('project-forget',error);}
    try{if(matches(localStorage.getItem(activeProjectKey)))localStorage.removeItem(activeProjectKey);}catch{}
}
