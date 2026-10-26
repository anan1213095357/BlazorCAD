// In-memory timing only: no storage, console, network, or per-frame UI updates.
const stages=new Map(),slow=[];
export function recordTiming(stage,milliseconds,details=null){
    let entry=stages.get(stage);if(!entry){entry={count:0,total:0,max:0,last:0};stages.set(stage,entry);}
    entry.count++;entry.total+=milliseconds;entry.max=Math.max(entry.max,milliseconds);entry.last=milliseconds;
    if(milliseconds>=32){slow.push({stage,milliseconds,details});if(slow.length>64)slow.shift();}
}
export function measure(stage,action,details=null){const started=performance.now();try{return action();}finally{recordTiming(stage,performance.now()-started,details);}}
export function performanceStats(){return {stages:Object.fromEntries([...stages].map(([key,value])=>[key,{...value,average:value.total/value.count}])),slow:slow.slice()};}
export function clearPerformanceStats(){stages.clear();slow.length=0;}
