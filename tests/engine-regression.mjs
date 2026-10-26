// Native CPU engine invariants. This file is not executed by source migration.
import assert from 'node:assert/strict';
import * as CAD from '../wwwroot/engine/core.js';
const near=(actual,expected,tolerance=1e-8)=>assert(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const v=(x,y,z)=>new CAD.Vector3(x,y,z);
const rotation=new CAD.Quaternion().setFromAxisAngle(v(0,0,1),Math.PI/2);
near(v(1,0,0).applyQuaternion(rotation).distanceTo(v(0,1,0)),0);
const transform=new CAD.Matrix4().compose(v(7,-13,9),rotation,v(2,3,4));
near(v(2,-5,8).applyMatrix4(transform).applyMatrix4(transform.clone().invert()).distanceTo(v(2,-5,8)),0);
const restored=new CAD.Quaternion().setFromRotationMatrix(new CAD.Matrix4().compose(v(0,0,0),rotation,v(1,1,1)));
near(Math.abs(restored.dot(rotation)),1);
for(const camera of [new CAD.PerspectiveCamera(38,1.6,.1,1000),new CAD.OrthographicCamera(-10,10,8,-8,.1,1000)]){
 camera.up.set(0,0,1);camera.position.set(20,-30,40);camera.lookAt(v(0,0,0));camera.updateMatrixWorld();
 near(v(2,3,4).project(camera).unproject(camera).distanceTo(v(2,3,4)),0,1e-7);
 const ray=new CAD.Raycaster().setFromCamera(new CAD.Vector2(),camera);
 const hit=ray.ray.intersectPlane(new CAD.Plane().setFromNormalAndCoplanarPoint(v(0,0,1),v(0,0,0)),v(0,0,0));
 assert(hit);near(hit.length(),0,1e-7);
}
const outer=[[0,0],[20,0],[20,15],[0,15]].map(p=>new CAD.Vector2(...p));
const holes=[[[2,2],[2,6],[6,6],[6,2]],[[11,8],[11,12],[16,12],[16,8]]].map(loop=>loop.map(p=>new CAD.Vector2(...p)));
const shape=new CAD.Shape(outer);shape.holes=holes.map(hole=>new CAD.Path(hole));
const triangles=CAD.ShapeUtils.triangulateShape(outer,holes),flat=[outer,...holes].flat();
const area=triangles.reduce((sum,triangle)=>sum+Math.abs(CAD.ShapeUtils.area(triangle.map(i=>flat[i]))),0);
near(area,300-16-20);
const extruded=new CAD.ExtrudeGeometry(shape,{depth:7}),p=extruded.attributes.position;
let volume=0;const incidence=new Map();
for(let i=0;i<p.count;i+=3){const points=[0,1,2].map(j=>v(0,0,0).fromBufferAttribute(p,i+j));volume+=points[0].dot(points[1].clone().cross(points[2]))/6;
 for(let j=0;j<3;j++){const a=points[j].toArray().join('/'),b=points[(j+1)%3].toArray().join('/'),key=a<b?a+'>'+b:b+'>'+a,item=incidence.get(key)??[0,0];item[0]++;item[1]+=a<b?1:-1;incidence.set(key,item);}}
near(volume,(300-16-20)*7);
assert([...incidence.values()].every(([count,balance])=>count===2&&balance===0));
const mesh=new CAD.Mesh(extruded,new CAD.MeshBasicMaterial({side:CAD.DoubleSide}));mesh.updateMatrixWorld();
assert(new CAD.Raycaster(v(1,1,20),v(0,0,-1)).intersectObject(mesh).length);
assert.equal(new CAD.Raycaster(v(4,4,20),v(0,0,-1)).intersectObject(mesh).length,0);
const preview=new CAD.Mesh(new CAD.PlaneGeometry());preview.matrixAutoUpdate=false;preview.matrix.makeTranslation(5,6,7);preview.updateMatrixWorld();
near(v(0,0,0).applyMatrix4(preview.matrixWorld).distanceTo(v(5,6,7)),0);
console.log('Native CAD engine invariants passed.');
