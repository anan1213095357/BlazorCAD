import * as CAD from './engine/core.js';

// Keep the original triangle numbers: face provenance remains unchanged.
const trees=new WeakMap();
const clipData=new WeakMap();
// Flatten the already-built picking tree for replacement-surface containment.
// Nodes have forward escape offsets, so the GPU needs no recursion or stack.
export function stockClipData(mesh){
    const tree=mesh.userData.stockPickingTree,geometry=mesh.geometry,position=geometry.attributes.position;
    if(!tree)return null;
    const motionAttribute=geometry.attributes.cadEdgeMotion,motionRange=mesh.userData.edgeMotionGpu;
    const key=geometry.groups.map(group=>[group.start,group.count,group.materialIndex].join('/')).join('|'),cached=clipData.get(geometry);
    if(cached?.position===position&&cached.version===position.version&&cached.key===key&&cached.motion===motionAttribute&&cached.minDelta===(motionRange?.minDelta??0)&&cached.maxDelta===(motionRange?.maxDelta??0))return cached;
    const values=[],motion=geometry.attributes.cadEdgeMotion,range=mesh.userData.edgeMotionGpu;
    const moving=!!motion&&!!range;
    // Bound every moving leaf over the reusable topology interval once.
    // Radius drags then update only a uniform, including stock containment.
    const minDelta=moving?range.minDelta:0,maxDelta=moving?range.maxDelta:0;
    const bounded=!moving||Number.isFinite(minDelta)&&Number.isFinite(maxDelta);
    let magnitude=1;
    const append=node=>{
        const start=values.length,box=node.box.clone();
        values.push(node.box.min.x,node.box.min.y,node.box.min.z,0,node.box.max.x,node.box.max.y,node.box.max.z,node.indices?.length??0);
        if(node.indices)for(const index of node.indices){
            const material=geometry.groups.find(group=>index*3>=group.start&&index*3<group.start+group.count)?.materialIndex??0;
            for(let corner=0;corner<3;corner++){
                const vertex=index*3+corner,x=position.getX(vertex),y=position.getY(vertex),z=position.getZ(vertex);
                magnitude=Math.max(magnitude,Math.abs(x),Math.abs(y),Math.abs(z));values.push(x,y,z,corner===0?material:0);
            }
            if(moving)for(let corner=0;corner<3;corner++){
                const vertex=index*3+corner,velocity=new CAD.Vector3().fromBufferAttribute(motion,vertex),point=new CAD.Vector3().fromBufferAttribute(position,vertex);
                values.push(velocity.x,velocity.y,velocity.z,0);
                if(bounded){box.expandByPoint(point.clone().addScaledVector(velocity,minDelta));box.expandByPoint(point.addScaledVector(velocity,maxDelta));}
            }
        }else{box.union(append(node.left));box.union(append(node.right));}
        values[start]=box.min.x;values[start+1]=box.min.y;values[start+2]=box.min.z;
        values[start+4]=box.max.x;values[start+5]=box.max.y;values[start+6]=box.max.z;
        values[start+3]=values.length/4;
        return box;
    };
    append(tree);
    const data={data:new Float32Array(values),count:values.length/4,epsilon:Math.max(.00001,magnitude*Math.pow(2,-21)),moving,bounded,motion:motionAttribute,minDelta,maxDelta,position,version:position.version,key};
    clipData.set(geometry,data);return data;
}
function buildTree(position,indices,centers){
    const box=new CAD.Box3(),v=new CAD.Vector3();
    for(const index of indices)for(let corner=0;corner<3;corner++)box.expandByPoint(v.fromBufferAttribute(position,index*3+corner));
    if(indices.length<=24)return {box,indices};
    const size=box.getSize(new CAD.Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
    const component=axis==='x'?0:axis==='y'?1:2,center=index=>centers[index*3+component];
    indices.sort((a,b)=>center(a)-center(b));
    const middle=Math.floor(indices.length/2);
    return {box,left:buildTree(position,indices.slice(0,middle),centers),right:buildTree(position,indices.slice(middle),centers)};
}
export function attachSolidPicking(mesh,polygons){
    let tree=trees.get(polygons);
    if(!tree){const position=mesh.geometry.attributes.position,count=position.count/3,centers=new Float64Array(count*3);
        for(let i=0;i<count;i++)for(let corner=0;corner<3;corner++){const j=i*3+corner;centers[i*3]+=position.getX(j);centers[i*3+1]+=position.getY(j);centers[i*3+2]+=position.getZ(j);}
        tree=buildTree(position,Array.from({length:count},(_,i)=>i),centers);trees.set(polygons,tree);}
    mesh.raycast=function(raycaster,hits){
        const inverse=new CAD.Matrix4().copy(this.matrixWorld).invert(),ray=raycaster.ray.clone().applyMatrix4(inverse);
        const position=this.geometry.attributes.position,a=new CAD.Vector3(),b=new CAD.Vector3(),c=new CAD.Vector3(),point=new CAD.Vector3(),boxPoint=new CAD.Vector3();
        let nearest=null,best=Infinity;
        const visit=node=>{
            if(!ray.intersectBox(node.box,boxPoint))return;
            if(!node.box.containsPoint(ray.origin)&&boxPoint.distanceToSquared(ray.origin)>best)return;
            if(!node.indices){visit(node.left);visit(node.right);return;}
            for(const index of node.indices){
                a.fromBufferAttribute(position,index*3);b.fromBufferAttribute(position,index*3+1);c.fromBufferAttribute(position,index*3+2);
                const group=Array.isArray(this.material)?this.geometry.groups.find(group=>index*3>=group.start&&index*3<group.start+group.count):null,material=Array.isArray(this.material)?this.material[group?.materialIndex??0]:this.material;
                const hit=material.side===CAD.BackSide?ray.intersectTriangle(c,b,a,true,point):ray.intersectTriangle(a,b,c,material.side!==CAD.DoubleSide,point);
                if(!hit)continue;
                const localDistance=point.distanceToSquared(ray.origin);if(localDistance>=best)continue;
                const world=point.clone().applyMatrix4(this.matrixWorld),distance=world.distanceTo(raycaster.ray.origin);
                if(distance<raycaster.near||distance>raycaster.far)continue;
                best=localDistance;nearest={distance,point:world,object:this,faceIndex:index};
            }
        };
        visit(tree);if(nearest)hits.push(nearest);
    };
    mesh.userData.stockPickingTree=tree;
}
