import {EventDispatcher,MOUSE,Vector3,Quaternion} from './engine/core.js';

// Screen-axis camera control owned by CAD. No third-party controller.
export class CadControls extends EventDispatcher {
 constructor(camera,element){
  super();this.object=camera;this.domElement=element;this.target=new Vector3();this.enabled=true;
  this.enableRotate=true;this.enablePan=true;this.enableZoom=true;this.rotateSpeed=1;this.panSpeed=1;this.zoomSpeed=1;
  this.mouseButtons={LEFT:MOUSE.ROTATE,MIDDLE:MOUSE.ROTATE,RIGHT:MOUSE.PAN};this.pointers=new Map();this.handlers=[];
  this.lastPosition=camera.position.clone();this.lastRotation=camera.quaternion.clone();this.lastZoom=camera.zoom;
  this.touchAction=element.style.touchAction;element.style.touchAction='none';
  const listen=(name,handler,options)=>{element.addEventListener(name,handler,options);this.handlers.push([name,handler,options]);};
  listen('pointerdown',event=>this.down(event));listen('pointermove',event=>this.move(event));listen('pointerup',event=>this.up(event));listen('pointercancel',event=>this.up(event));
  listen('wheel',event=>{if(!this.enabled||!this.enableZoom)return;event.preventDefault();this.dispatchEvent({type:'start'});this.zoom(event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1));this.dispatchEvent({type:'end'});},{passive:false});
 }
 down(event){if(!this.enabled)return;const action=this.mouseButtons[['LEFT','MIDDLE','RIGHT'][event.button]];if(event.pointerType!=='touch'&&action==null)return;if(!this.pointers.size)this.dispatchEvent({type:'start'});this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,action:event.pointerType==='touch'?MOUSE.ROTATE:action});this.domElement.setPointerCapture(event.pointerId);event.preventDefault();}
 move(event){const previous=this.pointers.get(event.pointerId);if(!previous)return;const dx=event.clientX-previous.x,dy=event.clientY-previous.y;if(!this.enabled){previous.x=event.clientX;previous.y=event.clientY;return;}
  if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==event.pointerId)[1],before=Math.hypot(previous.x-other.x,previous.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);if(this.enableZoom&&before>1&&after>1)this.zoom(Math.log(before/after)/.001);if(this.enablePan)this.pan(dx/2,dy/2);}
  else if(previous.action===MOUSE.PAN&&this.enablePan)this.pan(dx,dy);else if(previous.action===MOUSE.DOLLY&&this.enableZoom)this.zoom(dy*4);else if(this.enableRotate)this.orbit(dx,dy);
  previous.x=event.clientX;previous.y=event.clientY;event.preventDefault();
 }
 up(event){if(!this.pointers.delete(event.pointerId))return;if(this.domElement.hasPointerCapture(event.pointerId))this.domElement.releasePointerCapture(event.pointerId);if(!this.pointers.size)this.dispatchEvent({type:'end'});}
 orbit(dx,dy){const length=Math.hypot(dx,dy);if(length<1e-8)return;const right=new Vector3(1,0,0).applyQuaternion(this.object.quaternion),up=new Vector3(0,1,0).applyQuaternion(this.object.quaternion),axis=up.clone().multiplyScalar(-dx).addScaledVector(right,-dy).normalize(),rotation=new Quaternion().setFromAxisAngle(axis,2*Math.PI*length*this.rotateSpeed/Math.max(1,this.domElement.clientHeight));this.object.position.sub(this.target).applyQuaternion(rotation).add(this.target);this.object.up.copy(up.applyQuaternion(rotation));this.update();}
 pan(dx,dy){const camera=this.object,span=camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom:2*camera.position.distanceTo(this.target)*Math.tan(camera.fov*Math.PI/360),scale=span/Math.max(1,this.domElement.clientHeight)*this.panSpeed,shift=new Vector3(-dx,dy,0).applyQuaternion(camera.quaternion).multiplyScalar(scale);camera.position.add(shift);this.target.add(shift);this.update();}
 zoom(delta){const camera=this.object,factor=Math.exp(Math.max(-2,Math.min(2,delta*.001*this.zoomSpeed)));if(camera.isOrthographicCamera){camera.zoom=Math.max(1e-8,Math.min(1e8,camera.zoom/factor));camera.updateProjectionMatrix();}else{const offset=camera.position.clone().sub(this.target),distance=Math.max(camera.near*2,Math.min(camera.far*.8,offset.length()*factor));camera.position.copy(this.target).add(offset.setLength(distance));}this.update();}
 update(){this.object.lookAt(this.target);this.object.updateMatrixWorld();const changed=this.lastPosition.distanceToSquared(this.object.position)>1e-18||Math.abs(this.lastRotation.dot(this.object.quaternion))<1-1e-12||this.lastZoom!==this.object.zoom;if(changed){this.lastPosition.copy(this.object.position);this.lastRotation.copy(this.object.quaternion);this.lastZoom=this.object.zoom;this.dispatchEvent({type:'change'});}return changed;}
 dispose(){for(const [name,handler,options] of this.handlers)this.domElement.removeEventListener(name,handler,options);this.handlers=[];for(const id of this.pointers.keys())if(this.domElement.hasPointerCapture(id))this.domElement.releasePointerCapture(id);this.pointers.clear();this.domElement.style.touchAction=this.touchAction;this.listeners.clear();}
}
