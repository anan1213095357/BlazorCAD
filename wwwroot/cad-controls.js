import {Quaternion,Vector3} from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';

// Keep the bundled controller's pan, zoom and pointer handling. Mouse rotation
// uses screen axes instead of spherical angles around a face-dependent pole.
export class CadControls extends OrbitControls {
    update(deltaTime=null){
        if(this._quat){
            this._quat.setFromUnitVectors(this.object.up.clone().normalize(),new Vector3(0,1,0));
            this._quatInverse.copy(this._quat).invert();
        }
        return super.update(deltaTime);
    }

    _handleMouseMoveRotate(event){
        this._rotateEnd.set(event.clientX,event.clientY);
        this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);
        this._rotateStart.copy(this._rotateEnd);
        const dx=this._rotateDelta.x,dy=this._rotateDelta.y,length=Math.hypot(dx,dy);
        if(length<1e-8)return;

        const right=new Vector3(1,0,0).applyQuaternion(this.object.quaternion);
        const up=new Vector3(0,1,0).applyQuaternion(this.object.quaternion);
        const axis=up.clone().multiplyScalar(-dx).addScaledVector(right,-dy).normalize();
        const rotation=new Quaternion().setFromAxisAngle(axis,2*Math.PI*length/Math.max(1,this.domElement.clientHeight));
        const offset=this.object.position.clone().sub(this.target).applyQuaternion(rotation);
        this.object.position.copy(this.target).add(offset);
        this.object.up.copy(up.applyQuaternion(rotation)).normalize();
        this._sphericalDelta.set(0,0,0);
        this.update();
    }
}
