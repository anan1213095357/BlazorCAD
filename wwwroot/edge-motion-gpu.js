import {BufferAttribute} from './engine/core.js';
// Native vertex displacement: pointer movement changes one draw uniform.
export function installEdgeMotionGpu(mesh,motion){
 mesh.geometry.setAttribute('cadEdgeMotion',new BufferAttribute(motion.movement,3));
 mesh.geometry.setAttribute('cadEdgeUvMotion',new BufferAttribute(motion.uvMovement,2));
 const session={delta:0,set(value){this.delta=value-motion.radius;},dispose(){if(mesh.userData.edgeMotionGpu===this)delete mesh.userData.edgeMotionGpu;}};
 mesh.frustumCulled=false;mesh.userData.edgeMotionGpu=session;return session;
}
