import * as THREE from 'three';

// Depth changes stay local while dragging; only the released value crosses to Blazor.
export class FeatureDepth {
    constructor(host,scene,camera,requestRender,onPreview,onCommit,onStart,onEnd){
        Object.assign(this,{host,scene,camera,requestRender,onPreview,onCommit,onStart,onEnd});
        this.root=document.createElement('div');this.root.className='feature-depth-panel';this.root.dataset.featureDepth='';this.root.hidden=true;
        this.title=document.createElement('div');this.title.className='feature-depth-title';
        this.name=document.createElement('span');this.valueLabel=document.createElement('strong');this.title.append(this.name,this.valueLabel);
        this.canvas=document.createElement('canvas');this.canvas.width=640;this.canvas.height=144;this.canvas.tabIndex=0;this.canvas.setAttribute('role','slider');this.canvas.setAttribute('aria-label','拖动刻度调整特征深度');this.canvas.setAttribute('aria-valuemin','-1000');this.canvas.setAttribute('aria-valuemax','1000');
        this.hint=document.createElement('small');this.hint.textContent='越过零点反向 · Shift 精调 · Esc 撤回';
        this.error=document.createElement('div');this.error.className='feature-depth-error';this.error.setAttribute('role','status');
        this.root.append(this.canvas);host.appendChild(this.root);
        this.readout=document.createElement('div');this.readout.className='feature-depth-readout';this.readout.dataset.featureDepth='';this.readout.hidden=true;this.readout.append(this.valueLabel,this.hint,this.error);host.appendChild(this.readout);
        this.grip=document.createElement('button');this.grip.type='button';this.grip.className='feature-depth-grip';this.grip.dataset.featureDepth='';this.grip.textContent='▲';this.grip.title='拖动调整深度；方向正对视线时上下拖动';this.grip.setAttribute('aria-label','特征深度游标');this.grip.hidden=true;host.appendChild(this.grip);
        this.arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),20,0xc0ec88,3,1.5);
        this.arrow.visible=false;this.arrow.traverse(o=>{o.raycast=()=>{};if(o.material){o.material.depthTest=false;o.material.depthWrite=false;}o.renderOrder=14;});scene.add(this.arrow);
        for(const [element,mode] of [[this.canvas,'axis'],[this.grip,'axis']]){
            element.addEventListener('pointerdown',event=>this.start(event,mode));
            element.addEventListener('pointermove',event=>this.move(event));
            element.addEventListener('pointerup',event=>{event.stopPropagation();void this.finish(true);});
            element.addEventListener('pointercancel',event=>{event.stopPropagation();void this.finish(false);});
            element.addEventListener('keydown',event=>this.key(event));
            element.addEventListener('wheel',event=>event.stopPropagation());
        }
    }
    configure(config){
        if(!config){this.hide();return;}
        if(this.config?.key!==config.key){this.release();this.busy=false;this.error.textContent='';}
        this.config=config;if(!this.drag)this.value=config.value;
        this.root.hidden=false;this.readout.hidden=false;this.grip.hidden=false;this.arrow.visible=true;
        this.name.textContent=config.kind==='cut'?'切除深度':'拉伸深度';
        this.arrow.setColor(config.kind==='cut'?0xf08c82:0xc0ec88);
        this.grip.style.borderColor=config.kind==='cut'?'#f49b91':'#d8efb6';this.valueLabel.style.color=config.kind==='cut'?'#ffb0a5':'#e1f4bf';
        this.updateReadout();this.blockConfirm();this.requestRender();
    }
    hide(canConfirm=null){
        this.release();this.config=null;this.root.hidden=true;this.readout.hidden=true;this.grip.hidden=true;this.arrow.visible=false;const button=document.getElementById('feature-confirm');if(button&&canConfirm!==null)button.disabled=!canConfirm;this.requestRender();
    }
    project(point){const p=point.clone().project(this.camera);return {x:(p.x+1)*this.host.clientWidth/2,y:(1-p.y)*this.host.clientHeight/2,z:p.z};}
    tip(value=this.value){return this.config.origin.clone().addScaledVector(this.config.direction,value);}
    start(event,mode){
        if(event.button!==0||!this.config||this.busy)return;
        event.preventDefault();event.stopPropagation();this.onStart();
        const p=this.project(this.tip()),q=this.project(this.tip(this.value+1)),dx=q.x-p.x,dy=q.y-p.y;
        this.drag={element:event.currentTarget,pointer:event.pointerId,mode,x:event.clientX,y:event.clientY,value:this.value,initialValue:this.value,fine:event.shiftKey,dx,dy,key:this.config.key};
        event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);
        this.root.classList.add('is-dragging');this.error.textContent='';this.blockConfirm();
    }
    move(event){
        if(!this.drag)return;event.preventDefault();event.stopPropagation();
        const d=this.drag;
        if(d.fine!==event.shiftKey){d.x=event.clientX;d.y=event.clientY;d.value=this.value;d.fine=event.shiftKey;this.updateReadout();return;}
        const dx=event.clientX-d.x,dy=event.clientY-d.y,axisLength=d.dx*d.dx+d.dy*d.dy;
        let delta=d.mode==='ruler'?dx/6:axisLength>.09?(dx*d.dx+dy*d.dy)/axisLength:-dy/6;
        d.fine=event.shiftKey;
        if(event.shiftKey)delta*=.1;
        const step=event.shiftKey ? .1 : 1;
        this.setValue(Math.round((d.value+delta)/step)*step);
    }
    setValue(value){
        value=Math.max(-1000,Math.min(1000,Number(value.toFixed(1))));if(value===this.value)return;
        this.value=value;this.updateReadout();this.onPreview(value);this.requestRender();
    }
    updateReadout(){
        const text=Number(this.value.toFixed(1)).toString();this.valueLabel.textContent=text+' mm';this.canvas.setAttribute('aria-valuenow',text);
        const input=document.getElementById('feature-depth-input');if(input)input.value=text;const reversed=document.getElementById('feature-reversed-input');if(reversed)reversed.checked=this.value<0;
    }
    drawRuler(){
        const origin=this.project(this.config.origin),tip=this.project(this.tip()),positive=this.project(this.tip(1));
        const dx=positive.x-origin.x,dy=positive.y-origin.y,pixels=Math.hypot(dx,dy),length=pixels*Math.abs(this.value);
        // A depth axis viewed end-on has no honest screen direction to display.
        if(pixels<.02||origin.z < -1||origin.z>1||tip.z < -1||tip.z>1){this.root.hidden=true;this.grip.textContent='•';this.grip.style.transform='translate(-50%,-50%)';this.hint.textContent='稍微旋转视角可查看轴向刻度';return;}
        this.root.hidden=false;this.grip.textContent='▲';this.hint.textContent='越过零点反向 · Shift 精调 · Esc 撤回';
        const ux=dx/pixels,uy=dy/pixels,angle=Math.atan2(dy,dx),nx=-uy,ny=ux;
        const raw=7/pixels,power=10**Math.floor(Math.log10(raw)),ratio=raw/power,step=(ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power;
        const minor=Math.max(this.drag?.fine ? .1 : 1,step);
        let low=Math.max(-1000,Math.min(0,this.value)-minor*10),high=Math.min(1000,Math.max(0,this.value)+minor*10);
        // Keep the local ruler compact on very long features, while its values
        // remain distances measured from the actual sketch plane.
        if(length>460){low=Math.max(-1000,this.value-minor*30);high=Math.min(1000,this.value+minor*30);}
        let start=this.project(this.tip(low)),end=this.project(this.tip(high));
        for(let i=0;i<12&&(start.z < -1||start.z>1||end.z < -1||end.z>1||Math.hypot(end.x-start.x,end.y-start.y)>700);i++){low=(low+this.value)/2;high=(high+this.value)/2;start=this.project(this.tip(low));end=this.project(this.tip(high));}
        const width=Math.max(30,Math.min(900,Math.hypot(end.x-start.x,end.y-start.y))),height=56,dpr=Math.min(devicePixelRatio||1,2);
        if(this.canvas.width!==Math.round(width*dpr)||this.canvas.height!==Math.round(height*dpr)){this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);}
        this.root.style.left=(start.x+nx*18)+'px';this.root.style.top=(start.y+ny*18)+'px';this.root.style.width=width+'px';this.root.style.transform=`rotate(${angle}rad)`;
        this.canvas.style.width=width+'px';this.canvas.style.height=height+'px';
        const c=this.canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);
        c.font='11px Segoe UI';c.textAlign='center';c.lineWidth=1;c.shadowColor='#101923';c.shadowBlur=3;
        c.strokeStyle='#c7dce5b3';c.beginPath();c.moveTo(0,12);c.lineTo(width,12);c.stroke();
        const first=Math.ceil(low/minor),last=Math.min(first+240,Math.floor(high/minor));
        for(let i=first;i<=last;i++){
            const value=i*minor,p=this.project(this.tip(value)),x=(p.x-start.x)*ux+(p.y-start.y)*uy;if(x<0||x>width||p.z < -1||p.z>1)continue;
            const big=i%5===0;c.strokeStyle=big?'#e5f2f7e6':'#b5cfdd99';c.beginPath();c.moveTo(x,12);c.lineTo(x,big?29:21);c.stroke();
            if(big&&x>10&&x<width-10){c.fillStyle='#e5f2f7e6';c.fillText(Number(value.toFixed(2)).toString(),x,44);}
        }
        const cursor=(tip.x-start.x)*ux+(tip.y-start.y)*uy;
        c.strokeStyle=this.config.kind==='cut'?'#f5a294':'#d0eea7';c.lineWidth=2;c.beginPath();c.moveTo(cursor,0);c.lineTo(cursor,31);c.stroke();
        c.beginPath();c.moveTo(cursor-5,0);c.lineTo(cursor+5,0);c.lineTo(cursor,7);c.closePath();c.fillStyle=c.strokeStyle;c.fill();
        this.grip.style.transform=`translate(-50%,-50%) rotate(${angle*180/Math.PI+90+(this.value<0?180:0)}deg)`;
        this.readout.style.left=Math.max(8,Math.min(this.host.clientWidth-150,tip.x+nx*64))+'px';
        this.readout.style.top=Math.max(8,Math.min(this.host.clientHeight-70,tip.y+ny*64))+'px';
    }
    release(){
        if(this.drag){const {element,pointer}=this.drag;this.drag=null;if(pointer>=0&&element.hasPointerCapture(pointer))element.releasePointerCapture(pointer);this.onEnd();}
        this.root.classList.remove('is-dragging');
    }
    async finish(save){
        const drag=this.drag;if(!drag)return;
        this.release();this.updateReadout();
        if(!save){this.setValue(drag.initialValue);this.blockConfirm();return;}
        if(this.value===drag.initialValue){this.blockConfirm();return;}
        this.busy=true;this.blockConfirm();
        try{
            const error=await this.onCommit(this.value,drag.key);
            if(this.config?.key!==drag.key)return;
            if(error){this.setValue(drag.initialValue);this.error.textContent=error;}
        }catch{
            if(this.config?.key===drag.key){this.setValue(drag.initialValue);this.error.textContent='深度未同步，请重试';}
        }finally{if(this.config?.key===drag.key){this.busy=false;this.blockConfirm();this.requestRender();}}
    }
    key(event){
        if(event.key==='Escape'&&this.drag){event.preventDefault();event.stopPropagation();void this.finish(false);return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||this.busy||!this.config)return;
        event.preventDefault();event.stopPropagation();
        if(!this.drag)this.drag={element:event.currentTarget,pointer:-1,value:this.value,initialValue:this.value,key:this.config.key};
        this.setValue(this.value+(['ArrowRight','ArrowUp'].includes(event.key)?1:-1)*(event.shiftKey ? .1 : 1));void this.finish(true);
    }
    blockConfirm(){const button=document.getElementById('feature-confirm');if(button&&this.config)button.disabled=!!this.drag||this.busy||!this.config.valid||Math.abs(this.value)<1;}
    frame(){
        if(!this.config)return;
        const tip=this.tip(),screen=this.project(tip),origin=this.config.origin;
        this.grip.hidden=screen.z < -1||screen.z>1;
        this.grip.style.left=screen.x+'px';this.grip.style.top=screen.y+'px';
        this.readout.style.left=Math.max(8,Math.min(this.host.clientWidth-150,screen.x+24))+'px';this.readout.style.top=Math.max(8,Math.min(this.host.clientHeight-70,screen.y+24))+'px';
        this.drawRuler();
        const worldPerPixel=(this.camera.isOrthographicCamera?(this.camera.top-this.camera.bottom)/this.camera.zoom:2*this.camera.position.distanceTo(tip)*Math.tan(this.camera.fov*Math.PI/360))/Math.max(1,this.host.clientHeight);
        const magnitude=Math.abs(this.value);this.arrow.visible=magnitude>1e-6;this.arrow.position.copy(origin);this.arrow.setDirection(this.config.direction.clone().multiplyScalar(this.value<0?-1:1));this.arrow.setLength(Math.max(magnitude,1e-6),Math.min(magnitude*.35,worldPerPixel*15),Math.min(magnitude*.15,worldPerPixel*7));
    }
    dispose(){this.release();this.root.remove();this.readout.remove();this.grip.remove();this.arrow.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.arrow.removeFromParent();}
}
