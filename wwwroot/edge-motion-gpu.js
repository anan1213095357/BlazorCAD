import {BufferAttribute} from './engine/core.js';
// Native vertex displacement: pointer movement changes one draw uniform.
export function installEdgeMotionGpu(mesh,motion){
 mesh.geometry.setAttribute('cadEdgeMotion',new BufferAttribute(motion.movement,3));
 mesh.geometry.setAttribute('cadEdgeUvMotion',new BufferAttribute(motion.uvMovement,2));
 const session={delta:0,minDelta:motion.min-motion.radius,maxDelta:motion.max-motion.radius,set(value){this.delta=value-motion.radius;},dispose(){if(mesh.userData.edgeMotionGpu===this)delete mesh.userData.edgeMotionGpu;}};
 mesh.frustumCulled=false;mesh.userData.edgeMotionGpu=session;return session;
}
