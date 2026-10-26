import * as CAD from './engine/core.js';

// Native screen-space stroke geometry. Expand
// independent segment quads in screen space to keep sketch borders legible.
export function sketchStroke(points,frame,color,width=6,dashed=false) {
    const positions=[],starts=[],ends=[],corners=[];
    const world=p=>!frame?(p.isVector3?p.clone():new CAD.Vector3(...p)):frame.o.clone().addScaledVector(frame.u,p[0]).addScaledVector(frame.v,p[1]).addScaledVector(frame.n,.16);
    const triangles=[[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]];
    for(let i=0;i<points.length-1;i++) {
        const a=world(points[i]),b=world(points[i+1]);if(a.distanceToSquared(b)<1e-12)continue;
        for(const [t,side] of triangles){positions.push(...a.clone().lerp(b,t).toArray());starts.push(...a.toArray());ends.push(...b.toArray());corners.push(t,side);}
    }
    const geometry=new CAD.BufferGeometry();
    geometry.setAttribute('position',new CAD.Float32BufferAttribute(positions,3));
    geometry.setAttribute('segmentStart',new CAD.Float32BufferAttribute(starts,3));
    geometry.setAttribute('segmentEnd',new CAD.Float32BufferAttribute(ends,3));
    geometry.setAttribute('corner',new CAD.Float32BufferAttribute(corners,2));
    const material=new CAD.Material({
        uniforms:{resolution:{value:new CAD.Vector2(1,1)},strokeColor:{value:new CAD.Color(color)},strokeWidth:{value:width},dashed:{value:dashed}},
        transparent:true,depthTest:false,depthWrite:false,side:CAD.DoubleSide
    });
    const mesh=new CAD.Mesh(geometry,material);mesh.renderOrder=6;mesh.frustumCulled=false;
    mesh.onBeforeRender=renderer=>{const viewport=renderer.domElement;material.uniforms.resolution.value.set(viewport.clientWidth||1,viewport.clientHeight||1);};
    mesh.raycast=()=>{};return mesh;
}
