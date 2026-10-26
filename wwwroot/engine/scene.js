import {Vector2,Vector3,Quaternion,Matrix4,Box3,Ray,Triangle,MathUtils} from './math.js';
import {ShapeUtils} from './shapes.js';
export class EventDispatcher {
 constructor(){this.listeners=new Map();}
 addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
 removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
 dispatchEvent(event){event.target=this;for(const listener of [...(this.listeners.get(event.type)??[])])listener.call(this,event);}
}
export class Layers {constructor(){this.mask=1;}set(i){this.mask=1<<i;}enable(i){this.mask|=1<<i;}disable(i){this.mask&=~(1<<i);}test(other){return (this.mask&other.mask)!==0;}enableAll(){this.mask=-1;}}
let nextId=1;
export class Object3D extends EventDispatcher {
 constructor(){super();this.id=nextId++;this.uuid='cad-'+this.id;this.position=new Vector3();this.quaternion=new Quaternion();this.scale=new Vector3(1,1,1);this.up=new Vector3(0,1,0);this.matrix=new Matrix4();this.matrixWorld=new Matrix4();this.children=[];this.parent=null;this.layers=new Layers();this.userData={};this.visible=true;this.renderOrder=0;}
 add(...objects){for(const object of objects){if(object===this)throw new Error('场景节点不能成为自己的子节点。');for(let parent=this;parent;parent=parent.parent)if(parent===object)throw new Error('场景节点存在循环引用。');object.removeFromParent();object.parent=this;this.children.push(object);}return this;}
 remove(object){const index=this.children.indexOf(object);if(index>=0){this.children.splice(index,1);object.parent=null;}return this;}
 removeFromParent(){this.parent?.remove(this);return this;}
 traverse(callback){callback(this);for(const child of this.children.slice())child.traverse(callback);}
 updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);return this;}
 updateMatrixWorld(){if(this.matrixAutoUpdate!==false)this.updateMatrix();this.matrixWorld.copy(this.matrix);if(this.parent)this.matrixWorld.premultiply(this.parent.matrixWorld);for(const child of this.children)child.updateMatrixWorld();return this;}
 lookAt(target,y,z){if(typeof target==='number')target=new Vector3(target,y,z);const backward=(this.isCamera?this.position.clone().sub(target):target.clone().sub(this.position)).normalize();if(!backward.lengthSq())backward.z=1;let right=this.up.clone().cross(backward);if(right.lengthSq()<1e-16)right=(Math.abs(backward.z)<.9?new Vector3(0,0,1):new Vector3(0,1,0)).cross(backward);right.normalize();this.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right,backward.clone().cross(right),backward));return this;}
 getWorldPosition(out){this.updateMatrixWorld();return out.setFromMatrixPosition(this.matrixWorld);}
 localToWorld(point){this.updateMatrixWorld();return point.applyMatrix4(this.matrixWorld);}
 worldToLocal(point){this.updateMatrixWorld();return point.applyMatrix4(this.matrixWorld.clone().invert());}
}
export class Group extends Object3D {}
export class Scene extends Group {constructor(){super();this.isScene=true;this.background=null;this.environment=null;}}
class Camera extends Object3D {
 constructor(){super();this.isCamera=true;this.matrixWorldInverse=new Matrix4();this.projectionMatrix=new Matrix4();this.projectionMatrixInverse=new Matrix4();this.zoom=1;}
 clone(){const camera=new this.constructor();camera.position.copy(this.position);camera.quaternion.copy(this.quaternion);camera.up.copy(this.up);camera.scale.copy(this.scale);camera.layers.mask=this.layers.mask;for(const name of ['fov','aspect','near','far','zoom','left','right','top','bottom'])if(this[name]!==undefined)camera[name]=this[name];camera.updateProjectionMatrix();camera.updateMatrixWorld();return camera;}
 updateMatrixWorld(){super.updateMatrixWorld();this.matrixWorldInverse.copy(this.matrixWorld).invert();return this;}
}
export class PerspectiveCamera extends Camera {
 constructor(fov=50,aspect=1,near=.1,far=2000){super();Object.assign(this,{fov,aspect,near,far,isPerspectiveCamera:true});this.updateProjectionMatrix();}
 updateProjectionMatrix(){const y=1/Math.tan(this.fov*Math.PI/360)*this.zoom,x=y/this.aspect,n=this.near,f=this.far;this.projectionMatrix.set(x,0,0,0,0,y,0,0,0,0,-(f+n)/(f-n),-2*f*n/(f-n),0,0,-1,0);this.projectionMatrixInverse.copy(this.projectionMatrix).invert();}
}
export class OrthographicCamera extends Camera {
 constructor(left=-1,right=1,top=1,bottom=-1,near=.1,far=2000){super();Object.assign(this,{left,right,top,bottom,near,far,isOrthographicCamera:true});this.updateProjectionMatrix();}
 updateProjectionMatrix(){const width=(this.right-this.left)/this.zoom,height=(this.top-this.bottom)/this.zoom,cx=(this.right+this.left)/2,cy=(this.top+this.bottom)/2,n=this.near,f=this.far;this.projectionMatrix.set(2/width,0,0,-2*cx/width,0,2/height,0,-2*cy/height,0,0,-2/(f-n),-(f+n)/(f-n),0,0,0,1);this.projectionMatrixInverse.copy(this.projectionMatrix).invert();}
}
export const FrontSide=0,BackSide=1,DoubleSide=2,LessEqualDepth=3,GreaterDepth=6;
export const MOUSE={ROTATE:0,DOLLY:1,PAN:2};
export const RGBAFormat='rgba',FloatType='float32',NearestFilter='nearest',LinearFilter='linear',RepeatWrapping='repeat',SRGBColorSpace='srgb',LinearSRGBColorSpace='linear',RGBADepthPacking='depth';
const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
export class Color {
 constructor(value=0xffffff){this.set(value);}
 set(value){if(value&&typeof value==='object'){this.r=value.r;this.g=value.g;this.b=value.b;return this;}if(typeof value==='string'){const text=value.replace('#','');value=parseInt(text.length===3?text.split('').map(c=>c+c).join(''):text,16);}this.r=linear(((value>>16)&255)/255);this.g=linear(((value>>8)&255)/255);this.b=linear((value&255)/255);return this;}
 copy(value){return this.set(value);}clone(){return new Color(this);}setRGB(r,g,b){this.r=r;this.g=g;this.b=b;return this;}
}
export class Material extends EventDispatcher {
 constructor(options={}){super();Object.assign(this,{id:nextId++,color:new Color(),opacity:1,visible:true,side:FrontSide,depthTest:true,depthWrite:true,depthFunc:LessEqualDepth,transparent:false,toneMapped:true,wireframe:false,userData:{},defines:{},defaultAttributeValues:{},uniforms:{}},options);this.color=options.color instanceof Color?options.color.clone():new Color(options.color??0xffffff);}
 clone(){const material=new this.constructor();for(const [key,value] of Object.entries(this))if(key!=='listeners'&&key!=='id')material[key]=key==='color'?value.clone():['defines','userData','defaultAttributeValues'].includes(key)?{...value}:value;return material;}
 onBeforeCompile(){} customProgramCacheKey(){return this.constructor.name;}dispose(){this.dispatchEvent({type:'dispose'});}
}
export class MeshBasicMaterial extends Material {}
export class MeshPhysicalMaterial extends Material {constructor(options={}){super({metalness:0,roughness:.5,...options});this.isMeshPhysicalMaterial=true;}}
export class MeshDepthMaterial extends Material {constructor(options={}){super(options);this.isMeshDepthMaterial=true;}}
export class LineBasicMaterial extends Material {}
export class LineDashedMaterial extends LineBasicMaterial {}
export class PointsMaterial extends Material {}
export class SpriteMaterial extends Material {constructor(options={}){super({transparent:true,depthWrite:false,...options});}}
export class ShaderMaterial extends Material {}
export class BufferAttribute {
 constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.version=0;this.count=array.length/itemSize;}
 set needsUpdate(value){if(value)this.version++;} getX(i){return this.array[i*this.itemSize];} getY(i){return this.array[i*this.itemSize+1];} getZ(i){return this.array[i*this.itemSize+2];}getW(i){return this.array[i*this.itemSize+3];}
 setX(i,x){this.array[i*this.itemSize]=x;return this;}setY(i,y){this.array[i*this.itemSize+1]=y;return this;}setZ(i,z){this.array[i*this.itemSize+2]=z;return this;}
 setXY(i,x,y){this.setX(i,x);this.setY(i,y);return this;}setXYZ(i,x,y,z){this.setXY(i,x,y);this.setZ(i,z);return this;}
 clone(){return new BufferAttribute(this.array.slice(),this.itemSize);}
}
export class Float32BufferAttribute extends BufferAttribute {constructor(array,size){super(new Float32Array(array),size);}}
export class BufferGeometry extends EventDispatcher {
 constructor(){super();this.attributes={};this.index=null;this.groups=[];this.drawRange={start:0,count:Infinity};this.userData={};}
 setAttribute(name,value){this.attributes[name]=value;return this;}getAttribute(name){return this.attributes[name];}deleteAttribute(name){delete this.attributes[name];return this;}
 setIndex(value){this.index=value===null?null:value instanceof BufferAttribute?value:new BufferAttribute(new Uint32Array(value),1);return this;}getIndex(){return this.index;}
 addGroup(start,count,materialIndex=0){this.groups.push({start,count,materialIndex});return this;}clearGroups(){this.groups=[];}
 setDrawRange(start,count){this.drawRange={start,count};}
 setFromPoints(points){return this.setAttribute('position',new Float32BufferAttribute(points.flatMap(p=>[p.x,p.y,p.z??0]),3));}
 applyMatrix4(matrix){const position=this.attributes.position,normal=this.attributes.normal,normalMatrix=matrix.clone().invert().transpose(),point=new Vector3();for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(matrix);position.setXYZ(i,point.x,point.y,point.z);}position.needsUpdate=true;if(normal){for(let i=0;i<normal.count;i++){point.fromBufferAttribute(normal,i).transformDirection(normalMatrix);normal.setXYZ(i,point.x,point.y,point.z);}normal.needsUpdate=true;}this.boundingBox=null;this.boundingSphere=null;return this;}
 translate(x,y,z){return this.applyMatrix4(new Matrix4().makeTranslation(x,y,z));}rotateX(angle){return this.applyMatrix4(new Matrix4().makeRotationX(angle));}rotateY(angle){return this.applyMatrix4(new Matrix4().makeRotationY(angle));}rotateZ(angle){return this.applyMatrix4(new Matrix4().makeRotationZ(angle));}
 scale(x,y,z){return this.applyMatrix4(new Matrix4().compose(new Vector3(),new Quaternion(),new Vector3(x,y,z)));}
 clone(){const geometry=new BufferGeometry();for(const [name,attribute] of Object.entries(this.attributes))geometry.setAttribute(name,attribute.clone());geometry.index=this.index?.clone()??null;geometry.groups=this.groups.map(group=>({...group}));geometry.drawRange={...this.drawRange};return geometry;}
 toNonIndexed(){if(!this.index)return this.clone();const geometry=new BufferGeometry();for(const [name,attribute] of Object.entries(this.attributes)){const data=new attribute.array.constructor(this.index.count*attribute.itemSize);for(let i=0;i<this.index.count;i++)for(let j=0;j<attribute.itemSize;j++)data[i*attribute.itemSize+j]=attribute.array[this.index.getX(i)*attribute.itemSize+j];geometry.setAttribute(name,new BufferAttribute(data,attribute.itemSize));}geometry.groups=this.groups.map(group=>({...group}));return geometry;}
 computeVertexNormals(){const position=this.attributes.position,normal=new Float32Array(position.count*3),count=this.index?.count??position.count,point=i=>new Vector3().fromBufferAttribute(position,i);for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>this.index?this.index.getX(i+j):i+j),[a,b,c]=ids.map(point),n=b.sub(a).cross(c.sub(a));for(const id of ids){normal[id*3]+=n.x;normal[id*3+1]+=n.y;normal[id*3+2]+=n.z;}}for(let i=0;i<position.count;i++){const n=new Vector3().fromArray(normal,i*3).normalize();n.toArray(normal,i*3);}this.setAttribute('normal',new BufferAttribute(normal,3));return this;}
 computeBoundingBox(){this.boundingBox=new Box3().setFromPoints(Array.from({length:this.attributes.position.count},(_,i)=>new Vector3().fromBufferAttribute(this.attributes.position,i)));}
 computeBoundingSphere(){this.computeBoundingBox();const center=this.boundingBox.getCenter(new Vector3());let radius=0;for(let i=0;i<this.attributes.position.count;i++)radius=Math.max(radius,center.distanceTo(new Vector3().fromBufferAttribute(this.attributes.position,i)));this.boundingSphere={center,radius};}
 dispose(){this.dispatchEvent({type:'dispose'});}
}
function trianglesGeometry(triangles,uv=null){const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(triangles.flatMap(p=>p.toArray()),3));if(uv)geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;}
export class PlaneGeometry extends BufferGeometry {constructor(width=1,height=1){super();const x=width/2,y=height/2,g=trianglesGeometry([new Vector3(-x,-y,0),new Vector3(x,-y,0),new Vector3(x,y,0),new Vector3(-x,-y,0),new Vector3(x,y,0),new Vector3(-x,y,0)],[0,0,1,0,1,1,0,0,1,1,0,1]);this.attributes=g.attributes;}}
export class BoxGeometry extends BufferGeometry {constructor(width=1,height=1,depth=1){super();const x=width/2,y=height/2,z=depth/2,vertices=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].map(p=>new Vector3(...p)),faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],points=[];for(const [a,b,c,d] of faces)points.push(vertices[a],vertices[b],vertices[c],vertices[a],vertices[c],vertices[d]);this.attributes=trianglesGeometry(points).attributes;}}
function shapeLoops(shape,segments){const {shape:outer,holes}=shape.extractPoints(segments),clean=points=>points.length>1&&points[0].distanceToSquared(points.at(-1))<1e-24?points.slice(0,-1):points;return [clean(outer),...holes.map(clean)];}
export class ShapeGeometry extends BufferGeometry {constructor(shapes,segments=12){super();const points=[],uv=[];for(const shape of Array.isArray(shapes)?shapes:[shapes]){const loops=shapeLoops(shape,segments),flat=loops.flat();for(const triangle of ShapeUtils.triangulateShape(loops[0],loops.slice(1)))for(const i of triangle){const p=flat[i];points.push(new Vector3(p.x,p.y,0));uv.push(p.x,p.y);}}this.attributes=trianglesGeometry(points,uv).attributes;}}
export class ExtrudeGeometry extends BufferGeometry {constructor(shapes,{depth=1,curveSegments=12}={}){super();const points=[],uv=[],push=triangle=>{for(const p of triangle){points.push(p);uv.push(p.x,p.y);}};for(const shape of Array.isArray(shapes)?shapes:[shapes]){const loops=shapeLoops(shape,curveSegments),flat=loops.flat();for(const triangle of ShapeUtils.triangulateShape(loops[0],loops.slice(1))){push([...triangle].reverse().map(i=>new Vector3(flat[i].x,flat[i].y,0)));push(triangle.map(i=>new Vector3(flat[i].x,flat[i].y,depth)));}for(let ring=0;ring<loops.length;ring++){const loop=loops[ring].slice();if((ShapeUtils.area(loop)>0)!==(ring===0))loop.reverse();for(let i=0;i<loop.length;i++){const p=loop[i],q=loop[(i+1)%loop.length],a=new Vector3(p.x,p.y,0),b=new Vector3(q.x,q.y,0),c=new Vector3(q.x,q.y,depth),d=new Vector3(p.x,p.y,depth);push([a,b,c]);push([a,c,d]);}}}this.attributes=trianglesGeometry(points,uv).attributes;}}
export class Mesh extends Object3D {
 constructor(geometry=new BufferGeometry(),material=new MeshBasicMaterial()){super();this.geometry=geometry;this.material=material;this.isMesh=true;}
 raycast(raycaster,hits){const ray=raycaster.ray.clone().applyMatrix4(this.matrixWorld.clone().invert()),position=this.geometry.attributes.position;if(!position)return;const count=this.geometry.index?.count??position.count;
  for(let i=0;i<count;i+=3){const vertices=[0,1,2].map(j=>new Vector3().fromBufferAttribute(position,this.geometry.index?this.geometry.index.getX(i+j):i+j)),group=this.geometry.groups.find(group=>i>=group.start&&i<group.start+group.count),material=Array.isArray(this.material)?this.material[group?.materialIndex??0]:this.material;if(!material)continue;const [a,b,c]=vertices,hit=material.side===BackSide?ray.intersectTriangle(c,b,a,true,new Vector3()):ray.intersectTriangle(a,b,c,material.side!==DoubleSide,new Vector3());if(!hit)continue;hit.applyMatrix4(this.matrixWorld);const distance=hit.distanceTo(raycaster.ray.origin);if(distance>=raycaster.near&&distance<=raycaster.far)hits.push({object:this,point:hit,distance,faceIndex:i/3,face:{normal:b.clone().sub(a).cross(c.clone().sub(a)).normalize(),a:i,b:i+1,c:i+2}});}
 }
}
export class Line extends Object3D {
 constructor(geometry=new BufferGeometry(),material=new LineBasicMaterial()){super();this.geometry=geometry;this.material=material;this.isLine=true;}
 computeLineDistances(){return this;}
 raycast(raycaster,hits){const position=this.geometry.attributes.position,count=this.geometry.index?.count??position.count,step=this.isLineSegments?2:1;for(let i=0;i<count-1;i+=step){const a=new Vector3().fromBufferAttribute(position,this.geometry.index?this.geometry.index.getX(i):i).applyMatrix4(this.matrixWorld),b=new Vector3().fromBufferAttribute(position,this.geometry.index?this.geometry.index.getX(i+1):i+1).applyMatrix4(this.matrixWorld),point=new Vector3(),onRay=new Vector3();if(raycaster.ray.distanceSqToSegment(a,b,onRay,point)>(raycaster.params.Line.threshold??1)**2)continue;const distance=onRay.distanceTo(raycaster.ray.origin);if(distance>=raycaster.near&&distance<=raycaster.far)hits.push({object:this,point,distance,index:i});}}
}
export class LineSegments extends Line {constructor(...args){super(...args);this.isLineSegments=true;}}
export class Points extends Line {constructor(...args){super(...args);this.isLine=false;this.isPoints=true;}raycast(raycaster,hits){const p=this.geometry.attributes.position;for(let i=0;i<p.count;i++){const point=new Vector3().fromBufferAttribute(p,i).applyMatrix4(this.matrixWorld),t=point.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction),nearest=raycaster.ray.at(t,new Vector3());if(t>=raycaster.near&&t<=raycaster.far&&point.distanceTo(nearest)<(raycaster.params.Points.threshold??1))hits.push({object:this,point,distance:t,index:i});}}}
export class Sprite extends Mesh {constructor(material=new SpriteMaterial()){super(new PlaneGeometry(1,1),material);this.isSprite=true;}}
export class Raycaster {
 constructor(origin=new Vector3(),direction=new Vector3(0,0,-1),near=0,far=Infinity){this.ray=new Ray(origin,direction);this.near=near;this.far=far;this.layers=new Layers();this.params={Line:{threshold:1},Points:{threshold:1}};}
 setFromCamera(point,camera){camera.updateMatrixWorld();if(camera.isOrthographicCamera){this.ray.origin.set(point.x,point.y,-1).unproject(camera);this.ray.direction.set(0,0,-1).applyQuaternion(camera.quaternion);}else{this.ray.origin.copy(camera.position);this.ray.direction.set(point.x,point.y,.5).unproject(camera).sub(this.ray.origin).normalize();}return this;}
 intersectObject(object,recursive=true,hits=[]){if(object.layers.test(this.layers))object.raycast?.(this,hits);if(recursive)for(const child of object.children)this.intersectObject(child,true,hits);return hits.sort((a,b)=>a.distance-b.distance);}
 intersectObjects(objects,recursive=true,hits=[]){for(const object of objects)this.intersectObject(object,recursive,hits);return hits.sort((a,b)=>a.distance-b.distance);}
}
export class Texture extends EventDispatcher {constructor(image=null){super();this.image=image;this.version=0;this.flipY=true;}set needsUpdate(value){if(value)this.version++;}dispose(){this.dispatchEvent({type:'dispose'});}}
export class CanvasTexture extends Texture {constructor(canvas){super(canvas);this.needsUpdate=true;}}
export class DataTexture extends Texture {constructor(data,width,height){super({data,width,height});this.flipY=false;this.needsUpdate=true;}}
export class TextureLoader {load(url,onLoad,_progress,onError){const texture=new Texture(),image=new Image();image.onload=()=>{texture.image=image;texture.needsUpdate=true;onLoad?.(texture);};image.onerror=onError;image.src=url;return texture;}}
export class HemisphereLight extends Object3D {constructor(sky,ground,intensity=1){super();this.color=new Color(sky);this.groundColor=new Color(ground);this.intensity=intensity;}}
export class DirectionalLight extends Object3D {constructor(color,intensity=1){super();this.color=new Color(color);this.intensity=intensity;this.target=new Object3D();this.shadow={camera:new OrthographicCamera(-100,100,100,-100),mapSize:new Vector2(1024,1024),dispose(){},updateMatrices:light=>{this.shadow.camera.position.copy(light.position);this.shadow.camera.up.set(0,0,1);this.shadow.camera.lookAt(light.target.position);this.shadow.camera.updateMatrixWorld();}};}}
export class ArrowHelper extends Group {
 constructor(direction,origin,length=1,color=0xffff00,headLength=length*.2,headWidth=headLength*.5){super();this.position.copy(origin);this.line=new Line(new BufferGeometry().setFromPoints([new Vector3(),new Vector3(0,1,0)]),new LineBasicMaterial({color}));const vertices=[];for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6;vertices.push(new Vector3(0,1,0),new Vector3(Math.cos(a)/2,0,Math.sin(a)/2),new Vector3(Math.cos(b)/2,0,Math.sin(b)/2));}this.cone=new Mesh(trianglesGeometry(vertices),new MeshBasicMaterial({color,side:DoubleSide}));this.add(this.line,this.cone);this.setDirection(direction);this.setLength(length,headLength,headWidth);}
 setDirection(direction){this.quaternion.setFromUnitVectors(new Vector3(0,1,0),direction.clone().normalize());return this;}
 setColor(color){this.line.material.color.set(color);this.cone.material.color.set(color);return this;}
 setLength(length,headLength=length*.2,headWidth=headLength*.5){this.line.scale.set(1,Math.max(1e-12,length-headLength),1);this.cone.position.y=length-headLength;this.cone.scale.set(Math.max(1e-12,headWidth),Math.max(1e-12,headLength),Math.max(1e-12,headWidth));return this;}
}
