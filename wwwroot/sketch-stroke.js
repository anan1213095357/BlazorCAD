import * as THREE from 'three';

// WebGL LineBasicMaterial linewidth is usually limited to one pixel. Expand
// independent segment quads in screen space to keep sketch borders legible.
export function sketchStroke(points,frame,color,width=6,dashed=false) {
    const positions=[],starts=[],ends=[],corners=[];
    const world=p=>!frame?(p.isVector3?p.clone():new THREE.Vector3(...p)):frame.o.clone().addScaledVector(frame.u,p[0]).addScaledVector(frame.v,p[1]).addScaledVector(frame.n,.16);
    const triangles=[[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]];
    for(let i=0;i<points.length-1;i++) {
        const a=world(points[i]),b=world(points[i+1]);if(a.distanceToSquared(b)<1e-12)continue;
        for(const [t,side] of triangles){positions.push(...a.clone().lerp(b,t).toArray());starts.push(...a.toArray());ends.push(...b.toArray());corners.push(t,side);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('segmentStart',new THREE.Float32BufferAttribute(starts,3));
    geometry.setAttribute('segmentEnd',new THREE.Float32BufferAttribute(ends,3));
    geometry.setAttribute('corner',new THREE.Float32BufferAttribute(corners,2));
    const material=new THREE.ShaderMaterial({
        uniforms:{resolution:{value:new THREE.Vector2(1,1)},strokeColor:{value:new THREE.Color(color)},strokeWidth:{value:width},dashed:{value:dashed}},
        vertexShader:`attribute vec3 segmentStart;attribute vec3 segmentEnd;attribute vec2 corner;
            uniform vec2 resolution;uniform float strokeWidth;varying float lateral;varying float along;
            void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(segmentStart,1.0),b=projectionMatrix*modelViewMatrix*vec4(segmentEnd,1.0);
            vec2 direction=(b.xy/b.w-a.xy/a.w)*resolution;float lengthD=length(direction);
            vec2 normal=lengthD>0.0001?vec2(-direction.y,direction.x)/lengthD:vec2(0.0,1.0);
            vec4 p=mix(a,b,corner.x);p.xy+=normal*corner.y*strokeWidth/resolution*p.w;gl_Position=p;lateral=corner.y;along=corner.x*lengthD*0.5;}`,
        fragmentShader:`uniform vec3 strokeColor;uniform bool dashed;varying float lateral;varying float along;
            void main(){if(dashed&&mod(along,13.0)>8.0)discard;float t=abs(lateral);float core=1.0-smoothstep(0.48,0.7,t);
            gl_FragColor=vec4(mix(vec3(0.035,0.075,0.11),strokeColor,core),1.0-smoothstep(0.86,1.0,t));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            }`,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide
    });
    const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=6;mesh.frustumCulled=false;
    mesh.onBeforeRender=renderer=>{const viewport=renderer.domElement;material.uniforms.resolution.value.set(viewport.clientWidth||1,viewport.clientHeight||1);};
    mesh.raycast=()=>{};return mesh;
}
