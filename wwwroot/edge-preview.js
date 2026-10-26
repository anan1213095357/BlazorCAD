// One calculation in flight, one replaceable pending value. Keep expensive BSP
// work off the pointer/render thread; an invalidated scene never receives old results.
export class EdgePreview {
    constructor(result,error){this.result=result;this.error=error;this.worker=null;this.pending=null;this.active=null;this.epoch=0;this.sequence=0;}
    request(document,feature,seed=null){const signature=JSON.stringify(feature);if([this.active,this.pending].some(task=>task?.epoch===this.epoch&&task.signature===signature))return;this.pending={id:++this.sequence,epoch:this.epoch,document,feature,seed,signature};this.pump();}
    pump(){
        if(this.active||!this.pending)return;
        try{
            if(!this.worker){this.worker=new Worker(new URL('./edge-preview-worker.js',import.meta.url),{type:'module'});
                this.worker.onmessage=({data})=>{if(data.id!==this.active?.id)return;this.active=null;try{if(data.epoch===this.epoch){if(data.error)this.error(data.error,data);else this.result(data);}}catch(error){this.error('预览显示失败：'+error.message);}finally{this.pump();}};
                this.worker.onerror=event=>{event.preventDefault();const current=this.active?.epoch===this.epoch;this.dispose();if(current)this.error('后台预览计算失败，请松开鼠标重新生成预览。');};
            }
            this.active=this.pending;this.pending=null;const seed=this.active.seed;this.worker.postMessage(this.active,seed?.format==='packed-mesh'?[seed.positions.buffer,seed.offsets.buffer,seed.tagIds.buffer]:[]);
        }catch(error){this.dispose();this.error('后台预览暂不可用：'+error.message);}
    }
    invalidate(){this.epoch++;this.pending=null;}
    dispose(){this.invalidate();this.worker?.terminate();this.worker=null;this.active=null;}
}
