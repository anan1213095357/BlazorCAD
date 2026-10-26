import assert from 'node:assert/strict';
import * as CAD from '../wwwroot/engine/core.js';
import {exportEdgeTools} from '../wwwroot/geometry.js';
import {exportMeshOperations} from '../wwwroot/export-mesh-kernel.js';
import {exportEdgeJunctions} from '../wwwroot/export-edge-junctions.js';
import {section} from '../wwwroot/edge-section.js';

const v=(x,y,z)=>new CAD.Vector3(x,y,z),feature={id:'round',depth:2,edgeTreatment:'fillet'};
const edges=[
    {a:v(0,-10,0),b:v(0,0,0),normalA:v(0,0,1),normalB:v(1,0,0)},
    {a:v(-10,0,0),b:v(0,0,0),normalA:v(0,0,1),normalB:v(0,1,0)}
];
const geometry=new CAD.BoxGeometry(10,10,10).toNonIndexed();geometry.translate(-5,-5,-5);
const points=geometry.getAttribute('position'),stock=[];
for(let i=0;i<points.count;i+=3)stock.push({vertices:[0,1,2].map(j=>new CAD.Vector3().fromBufferAttribute(points,i+j))});
const result=await exportMeshOperations(stock,[{subtract:true,tools:exportEdgeTools(feature,edges)}]);
const incidence=new Map();
for(const face of result){
    const [a,b,c]=face.vertices,n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const center=a.clone().add(b).add(c).divideScalar(3);
    // No artificial mitre cap may survive inside the rounded corner.
    if(center.x> -2&&center.y> -2&&center.z> -2)assert(Math.abs(n.x*n.y)<1e-5,'internal cutter cap leaked into the exported surface');
    for(let i=0;i<3;i++){
        const a=face.vertices[i].toArray().join('/'),b=face.vertices[(i+1)%3].toArray().join('/'),key=a<b?a+'>'+b:b+'>'+a;
        const counts=incidence.get(key)??[0,0];counts[0]++;counts[1]+=a<b?1:-1;incidence.set(key,counts);
    }
}
assert([...incidence.values()].every(([count,balance])=>count===2&&balance===0));
// A valid round has the prescribed cylindrical profile right up to its seam.
const meshGeometry=new CAD.BufferGeometry().setFromPoints(result.flatMap(face=>face.vertices));
const mesh=new CAD.Mesh(meshGeometry,new CAD.MeshBasicMaterial({side:CAD.DoubleSide}));mesh.updateMatrixWorld();
for(const t of [.15,.5,1,1.5,1.85]){
    const hits=new CAD.Raycaster(v(-t,-t,1),v(0,0,-1)).intersectObject(mesh);
    assert(hits.length,'missing surface at the shared round seam');
    const expected=-2+Math.sqrt(4-(2-t)**2);
    assert(Math.abs(hits[0].point.z-expected)<.005,'round profile changed at the seam');
}
console.log('Round export: shared seam profile, no internal cap, and closed mesh verified.');

// The next operation inherits an oblique end face from the previous operation.
// Its cutter must terminate on that face instead of the old perpendicular cap.
const inherited={...edges[1],endPlanes:[v(-1,0,0),v(1,0,1).normalize()]};
const inheritedTools=exportEdgeTools({...feature,id:'next'},[inherited]);
const end=inheritedTools[0].filter(face=>face.tag.face.endsWith('|top')).flatMap(face=>face.vertices);
assert(end.length>0);
assert(end.some(point=>point.x>.1),'inherited oblique cap was replaced by the old axis cap');
assert(end.every(point=>Math.abs(point.x+point.z-.002)<1e-8),'cutter crossed its inherited end domain');

// Different dihedral angles require a curved seam, not an equal-section test.
const oblique=[edges[0],{...edges[1],normalB:v(0,1,.35).normalize()}];
const constraints=exportEdgeJunctions(oblique,feature);
assert(constraints[0][1]?.round&&constraints[1][1]?.round,'unequal round sections were not joined');
const first=constraints[0][1].round,second=constraints[1][1].round;
assert.equal(first.knots.length,second.knots.length);
first.knots.forEach((k,i)=>assert(k.point.distanceToSquared(second.knots[i].point)<1e-20,'two surfaces use different seam vertices'));
const wedgeStock=stock.map(face=>({vertices:face.vertices.map(point=>v(point.x,point.y-.35*point.z,point.z))}));
const wedge=await exportMeshOperations(wedgeStock,[{subtract:true,tools:exportEdgeTools(feature,oblique)}]);
for(const face of wedge){
    for(const point of face.vertices)assert(point.x<=1e-5&&point.z<=1e-5&&point.y+.35*point.z<=1e-5,'exported round protrudes outside its support');
}
globalThis.self={postMessage(){}};
const {binaryStl}=await import('../wwwroot/export-solid-worker.js');
assert(binaryStl(wedge).byteLength>84); // Includes strict serialized edge incidence checks.
const cross=section(edges[0].normalA,edges[0].normalB);
const frames=cross.offsets.map((offset,i)=>({point:edges[0].a.clone().addScaledVector(offset,2),normalA:v(0,-1,0),normalB:cross.normals[i]}));
const nextEdge={kind:'curve',closed:false,frames,points:frames.map(frame=>frame.point),a:frames[0].point,b:frames[1].point,normalA:frames[0].normalA,normalB:frames[0].normalB,endPlanes:[v(0,0,1),v(1,0,0)]};
const nextTools=exportEdgeTools({id:'second',edgeTreatment:'chamfer',depth:.2},[nextEdge]);
assert(nextTools[0].endDomains.length===2,'tangent inherited constraints were discarded');
const repeated=await exportMeshOperations(result,[{subtract:true,tools:nextTools}]);
assert(binaryStl(repeated).byteLength>84);
console.log('Inherited end plane and unequal round section seam verified.');

// A collapsed, collinear triangle must hand its boundary vertex to the
// neighbouring face before binary STL serialization drops its zero area.
const a=v(0,0,0),b=v(2,0,0),c=v(0,1,0),d=v(0,0,1),m=v(1,0,0);
const binary=binaryStl([[a,c,m],[m,c,b],[a,b,d],[a,d,c],[b,c,d],[a,m,b]].map(vertices=>({vertices})));
assert.equal(new DataView(binary).getUint32(80,true),6);
console.log('Collinear Float32 boundary transfer verified.');
