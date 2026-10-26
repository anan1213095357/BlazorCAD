import {recordTiming} from './cad-performance.js';
export class GeometryPrepare {
    constructor(){this.worker=null;this.pending=new Map();this.sequence=0;}
    request(document,preferredId,intent,seed=null,retainedGeometry=null,validateOnly=false){
        return new Promise((resolve,reject)=>{
            try{
                if(!this.worker){this.worker=new Worker(new URL('./geometry-prepare-worker.js',import.meta.url),{type:'module'});
                    this.worker.onmessage=({data})=>{const task=this.pending.get(data.id);if(!task)return;this.pending.delete(data.id);if(Number.isFinite(data.elapsed))recordTiming('geometry-worker',data.elapsed);if(data.error)task.reject(new Error(data.error));else task.resolve(data);};
                    this.worker.onerror=event=>{event.preventDefault();this.dispose(new Error('后台几何计算失败，修改未提交。'));};
                }
                const id=++this.sequence;this.pending.set(id,{resolve,reject});this.worker.postMessage({id,document,preferredId,intent,seed,retainedGeometry,validateOnly});
            }catch(error){this.dispose(error);reject(error);}
        });
    }
    dispose(error=new Error('几何计算已取消')){this.worker?.terminate();this.worker=null;for(const task of this.pending.values())task.reject(error);this.pending.clear();}
}
