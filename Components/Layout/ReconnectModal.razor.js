import {readDraft,downloadRecovery,downloadDiagnostics,recordDiagnostic} from '/cad-recovery.js';
const reconnectModal=document.getElementById('components-reconnect-modal');
const recovery=document.getElementById('components-recovery');
let reconnecting=false;
reconnectModal.addEventListener('components-reconnect-state-changed',event=>{
    const state=event.detail.state;recordDiagnostic('connection-state',state);
    if(state==='show'){if(!reconnectModal.open)reconnectModal.showModal();}
    else if(state==='hide'){recovery.hidden=true;reconnectModal.close();}
    else if(state==='failed'){
        showRecovery('连接中断。画面和最近完成的草稿已保留，可以重试连接。');
        document.addEventListener('visibilitychange',retryWhenVisible);
    }
    else if(state==='rejected')showRecovery('原编辑会话已失效。页面不会自动刷新；可先下载草稿，再恢复连接。');
});
document.getElementById('components-reconnect-button').addEventListener('click',retry);
document.getElementById('components-resume-button').addEventListener('click',resume);
document.getElementById('components-recovery-download').addEventListener('click',()=>{
    if(!downloadRecovery())document.getElementById('components-recovery-message').textContent='当前标签页没有可下载的草稿。';
});
document.getElementById('components-recovery-diagnostics').addEventListener('click',downloadDiagnostics);
// Reload is only allowed after this explicit user action; a valid checkpoint is
// restored by Home before rendering the next editor session.
document.getElementById('components-recovery-restart').addEventListener('click',()=>location.reload());
function showRecovery(message){
    document.getElementById('components-recovery-message').textContent=message;
    document.getElementById('components-recovery-status').textContent=readDraft()?'本标签页有可恢复草稿':'当前标签页尚无草稿';
    recovery.hidden=false;if(!reconnectModal.open)reconnectModal.showModal();
}
async function retry(){
    if(reconnecting)return;reconnecting=true;
    document.removeEventListener('visibilitychange',retryWhenVisible);
    try {
        if(await Blazor.reconnect()){recovery.hidden=true;reconnectModal.close();}
        else if(await Blazor.resumeCircuit()){recovery.hidden=true;reconnectModal.close();}
        else showRecovery('原会话无法恢复。可下载最近完成的草稿，或恢复草稿并重新连接。');
    }catch(error){recordDiagnostic('reconnect',error);showRecovery('暂时无法连接服务器，草稿已保留。');document.addEventListener('visibilitychange',retryWhenVisible);}
    finally{reconnecting=false;}
}
async function resume(){
    if(reconnecting)return;reconnecting=true;
    try{if(await Blazor.resumeCircuit()){recovery.hidden=true;reconnectModal.close();}else showRecovery('会话无法恢复，草稿已保留。');}
    catch(error){recordDiagnostic('resume',error);showRecovery('无法恢复连接，草稿已保留。');}
    finally{reconnecting=false;}
}
async function retryWhenVisible(){if(document.visibilityState==='visible')await retry();}
