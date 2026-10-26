import * as THREE from './vendor/three.core.js';

// The CPU geometry stays at the worker's seed radius. Dragging changes one
// uniform; all mesh and debug passes share the same deformation attributes.
export function installEdgeMotionGpu(mesh,motion){
    const delta={value:0},owned=[];
    mesh.geometry.setAttribute('cadEdgeMotion',new THREE.BufferAttribute(motion.movement,3));
    mesh.geometry.setAttribute('cadEdgeUvMotion',new THREE.BufferAttribute(motion.uvMovement,2));
    const deform=(shader)=>{
        shader.uniforms.cadEdgeDelta=delta;
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float cadEdgeDelta;attribute vec3 cadEdgeMotion;attribute vec2 cadEdgeUvMotion;')
            .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=cadEdgeMotion*cadEdgeDelta;')
            .replace('#include <uv_vertex>','#define uv (uv + cadEdgeUvMotion * cadEdgeDelta)\n#include <uv_vertex>\n#undef uv')
            .replace('cadPosition=position;','cadPosition=transformed;')
            .replace('cadSurfaceUv=uv;','cadSurfaceUv=uv+cadEdgeUvMotion*cadEdgeDelta;');
    };
    const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(source=>{
        const material=source.clone(),compile=source.onBeforeCompile,cache=source.customProgramCacheKey.bind(source);
        material.cadLive=source.cadLive;material.cadSurface=source.cadSurface;
        material.defaultAttributeValues={...source.defaultAttributeValues};
        material.onBeforeCompile=(shader,...args)=>{compile.call(material,shader,...args);deform(shader);};
        material.customProgramCacheKey=()=>cache()+'/edge-motion-gpu-v1';owned.push(material);return material;
    });
    mesh.material=Array.isArray(mesh.material)?materials:materials[0];
    const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});depth.onBeforeCompile=deform;depth.customProgramCacheKey=()=>'/edge-motion-depth-v1';mesh.customDepthMaterial=depth;owned.push(depth);
    mesh.frustumCulled=false;
    const session={get delta(){return delta.value;},set(value){delta.value=value-motion.radius;},dispose(){for(const material of owned)material.dispose();}};
    mesh.userData.edgeMotionGpu=session;return session;
}
