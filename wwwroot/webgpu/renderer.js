import {cadShader} from './cad-shader.js';

const fields=[['position',3],['normal',3],['uv',2],['liveOffset',3],['cadEdgeMotion',3],['liveSeamCoordinate',2],['liveFaceNormalAttribute',3],['facePoint',3],['segmentStart',3],['segmentEnd',3],['corner',2],['bary',3],['cadEdgeUvMotion',2]];
const stride=140,uniformBytes=400;
function multiply(a,b){
 const out=new Float32Array(16);
 for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)out[col*4+row]+=a[k*4+row]*b[col*4+k];
 return out;
}
function storageData(texture){return texture?.image?.data??new Float32Array(4);}
function normalTransform(matrix){
 const e=matrix.elements,a=[e[0],e[1],e[2]],b=[e[4],e[5],e[6]],c=[e[8],e[9],e[10]],cross=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]],x=cross(b,c),y=cross(c,a),z=cross(a,b),det=a.reduce((sum,value,i)=>sum+value*x[i],0),sign=det<0?-1:1;
 return [x[0]*sign,x[1]*sign,x[2]*sign,0,y[0]*sign,y[1]*sign,y[2]*sign,0,z[0]*sign,z[1]*sign,z[2]*sign,0,0,0,0,1];
}
function displayChannel(value){return value<=.0031308?value*12.92:1.055*Math.pow(value,1/2.4)-.055;}

// Native WebGPU renderer consuming the in-repository CAD scene and geometry.
export class CadWebGPURenderer {
 static async create(options={}){
  if(!navigator.gpu)throw new Error('当前浏览器不支持 WebGPU，请使用支持 WebGPU 的 Edge 或 Chrome，并启用硬件加速。');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw new Error('无法获取 WebGPU 显卡适配器。');
  const device=await adapter.requestDevice();
  let result;
  try{result=new CadWebGPURenderer(device,options);await result.initialize();return result;}
  catch(error){
   // Mark the owner closed BEFORE destroying the device, including when
   // shader/pipeline initialization failed. Preserve the original exception.
   try{if(result)result.dispose();else device.destroy();}finally{throw error;}
  }
 }
 constructor(device,{onError=()=>{},onReady=()=>{}}={}){
  this.device=device;this.onError=onError;this.onReady=onReady;this.isNativeWebGPU=true;
  this.domElement=document.createElement('canvas');this.domElement.dataset.renderer='native-webgpu';
  this.context=this.domElement.getContext('webgpu');if(!this.context)throw new Error('无法创建 WebGPU 画布。');
  this.format=navigator.gpu.getPreferredCanvasFormat();this.pixelRatio=1;this.width=1;this.height=1;this.disposed=false;
  this.shadowMap={enabled:false,needsUpdate:false};this.capabilities={getMaxAnisotropy:()=>1};
  this.info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};
  this.pendingFrames=0;
  this.geometryCache=new Map();this.objectCache=new Map();this.storageCache=new Map();this.textureCache=new Map();this.pipelines=new Map();
  this.context.configure({device,format:this.format,alphaMode:'premultiplied'});
  this.handleDeviceError=event=>this.fail(event.error);
  device.addEventListener('uncapturederror',this.handleDeviceError);
  device.lost.then(info=>{
   if(this.disposed||this.destroyRequested)return;
   this.fail(new Error('WebGPU 设备已丢失：'+info.message));
  });
 }
 async initialize(){
  const d=this.device;
  this.shader=d.createShaderModule({label:'CAD native WGSL',code:cadShader});
  const compilation=await this.shader.getCompilationInfo();
  const errors=compilation.messages.filter(message=>message.type==='error');
  if(errors.length)throw new Error('WebGPU 着色器错误：'+errors.map(message=>`${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
  this.bindLayout=d.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:uniformBytes}},
   {binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
   {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
   {binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
   {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
   {binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
   {binding:6,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
  ]});
  this.pipelineLayout=d.createPipelineLayout({bindGroupLayouts:[this.bindLayout]});
  this.sampler=d.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'});
  this.white=d.createTexture({size:[1,1],format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  d.queue.writeTexture({texture:this.white},new Uint8Array([255,255,255,255]),{bytesPerRow:4},[1,1]);
  this.empty=d.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  this.setSize(1,1);this.onReady();
 }
 fail(error){if(this.disposed||this.destroyRequested||this.failed)return;this.failed=true;this.failure=error;this.onError(error);}
 setPixelRatio(value){this.pixelRatio=Math.max(1,value||1);this.setSize(this.width,this.height);}
 getPixelRatio(){return this.pixelRatio;}
 setSize(width,height){
  this.width=Math.max(1,Math.floor(width));this.height=Math.max(1,Math.floor(height));
  const w=Math.max(1,Math.floor(this.width*this.pixelRatio)),h=Math.max(1,Math.floor(this.height*this.pixelRatio));
  this.domElement.style.width=this.width+'px';this.domElement.style.height=this.height+'px';
  if(this.domElement.width===w&&this.domElement.height===h&&this.depth)return;
  this.domElement.width=w;this.domElement.height=h;this.depth?.destroy();this.multisample?.destroy();
  this.depth=this.device.createTexture({size:[w,h],format:'depth24plus',sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});
  this.multisample=this.device.createTexture({size:[w,h],format:this.format,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});
 }
 pipeline(material,topology){
  const depth=material.depthTest===false?'always':material.depthFunc===6?'greater':'less-equal';
  const transparent=!!material.transparent,write=material.depthWrite!==false;
  const cull=material.side===2?'none':material.side===1?'front':'back';
  const key=[topology,depth,write,cull,transparent,!!material.polygonOffset].join('/');
  if(this.pipelines.has(key))return this.pipelines.get(key);
  let offset=0;const attributes=fields.map(([,size],shaderLocation)=>{const field={shaderLocation,offset,format:'float32'+(size===1?'':'x'+size)};offset+=size*4;return field;});
  const value=this.device.createRenderPipeline({label:'CAD '+key,layout:this.pipelineLayout,
   vertex:{module:this.shader,entryPoint:'vertexMain',buffers:[{arrayStride:stride,attributes}]},
   fragment:{module:this.shader,entryPoint:'fragmentMain',targets:[{format:this.format,...(transparent?{blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}:{})}]},
   primitive:{topology,cullMode:topology==='triangle-list'?cull:'none'},multisample:{count:4},
   depthStencil:{format:'depth24plus',depthWriteEnabled:write,depthCompare:depth,depthBias:topology==='triangle-list'&&material.polygonOffset?Math.round(material.polygonOffsetUnits??-1):0,depthBiasSlopeScale:topology==='triangle-list'&&material.polygonOffset?material.polygonOffsetFactor??-1:0},
  });this.pipelines.set(key,value);return value;
 }
 geometry(source,points=false){
  const signature=Object.entries(source.attributes).map(([name,attribute])=>name+':'+attribute.version+':'+attribute.count).join('/')+'/'+(source.index?.version??0)+'/'+points;
  const references=[source.index,...Object.values(source.attributes)];
  let cached=this.geometryCache.get(source);if(cached?.signature===signature&&cached.references.length===references.length&&references.every((value,index)=>value===cached.references[index]))return cached;
  const position=source.attributes.position;if(!position)return null;
  const count=(source.index?.count??position.count)*(points?6:1),data=new Float32Array(count*stride/4),index=source.index;
  const component=(attribute,vertex,axis)=>attribute?.array[vertex*attribute.itemSize+axis]??0;
  for(let i=0;i<count;i++){
   const input=points?Math.floor(i/6):i,vertex=index?index.getX(input):input;let offset=i*stride/4;
   for(const [name,size] of fields){
    const attribute=source.attributes[name];
    for(let axis=0;axis<size;axis++){
     let value=component(attribute,vertex,axis);
     if(name==='normal'&&!attribute)value=axis===2?1:0;
     if(name==='liveSeamCoordinate'&&!attribute)value=1;
     if(name==='facePoint')value=component(position,points?vertex:index?index.getX(i-i%3):i-i%3,axis);
     if(name==='bary')value=i%3===axis?1:0;
     if(name==='corner'&&points)value=[[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]][i%6][axis];
     data[offset++]=value;
    }
   }
  }
  const buffer=this.device.createBuffer({label:'CAD vertices',size:Math.max(4,data.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  if(data.byteLength)this.device.queue.writeBuffer(buffer,0,data);
  cached?.buffer.destroy();cached={buffer,count,signature,references};this.geometryCache.set(source,cached);
  if(!source.__cadGpuDispose){const dispose=()=>{this.geometryCache.get(source)?.buffer.destroy();this.geometryCache.delete(source);source.removeEventListener('dispose',dispose);delete source.__cadGpuDispose;};source.__cadGpuDispose=dispose;source.addEventListener('dispose',dispose);}
  this.info.memory.geometries=this.geometryCache.size;return cached;
 }
 storage(texture){
  if(!texture)return this.empty;
  const data=storageData(texture);let cached=this.storageCache.get(texture);
  if(!cached||cached.bytes!==data.byteLength){if(cached?.dispose)texture.removeEventListener('dispose',cached.dispose);cached?.buffer.destroy();cached={buffer:this.device.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),version:-1,bytes:data.byteLength};this.storageCache.set(texture,cached);}
  if(!cached.dispose){cached.dispose=()=>{const current=this.storageCache.get(texture);current?.buffer.destroy();this.storageCache.delete(texture);texture.removeEventListener('dispose',cached.dispose);};texture.addEventListener('dispose',cached.dispose);}
  if(cached.version!==texture.version){this.device.queue.writeBuffer(cached.buffer,0,data);cached.version=texture.version;}
  return cached.buffer;
 }
 image(texture){
  const source=texture?.image;if(!source?.width||!source?.height||source.complete===false)return this.white;
  let cached=this.textureCache.get(texture);if(cached)return cached;
  cached=this.device.createTexture({size:[source.width,source.height],format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
  this.device.queue.copyExternalImageToTexture({source,flipY:!!texture.flipY},{texture:cached},[source.width,source.height]);
  this.textureCache.set(texture,cached);return cached;
 }
 drawState(object,material,camera,viewProjection){
  let states=this.objectCache.get(object);if(!states){states=new Map();this.objectCache.set(object,states);}
  let state=states.get(material);if(!state){state={buffer:this.device.createBuffer({size:uniformBytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),data:new Float32Array(uniformBytes/4)};states.set(material,state);}
  const values=state.data;values.fill(0);values.set(object.matrixWorld.elements,0);values.set(viewProjection,16);
  // Cofactors also remain defined while a depth preview passes through zero.
  values.set(normalTransform(object.matrixWorld),32);values.set(camera.position.toArray(),48);
  const stroke=material.uniforms?.strokeColor?.value,color=stroke??material.color;
  values.set([color?.r??1,color?.g??1,color?.b??1,material.opacity??1],52);
  state.used=this.frameId;
  const live=material.cadLive,motion=object.userData.edgeMotionGpu??object.parent?.userData.edgeMotionGpu;
  const patch=live?.patch??false,wire=!!material.wireframe;
  values.set([material.metalness??0,material.roughness??.5,material.isMeshPhysicalMaterial||material.isMeshStandardMaterial?1:0,wire?1:0],56);
  values.set([live?.owner.radius.value??0,patch?(live.fixedRadius<0?live.owner.radius.value:live.fixedRadius):0,motion?.delta??0,patch?1:0],60);
  values.set([live?.owner.records.length??0,live?.skip??-1,live?.skipEnd??-1,live?.joined[0]??-1],64);
  values.set([live?.joined[1]??-1,live?.concave?1:0,live?.owner.stockMotion?.delta??0,object.isPoints?2:stroke?1:0],68);
  values.set([this.domElement.width,this.domElement.height,(object.isPoints?(material.size??1):material.uniforms?.strokeWidth?.value??material.linewidth??1)*this.pixelRatio,material.uniforms?.dashed?.value?1:0],72);
  values.set([material.map?1:0,material.toneMapped===false?1:0,live?.closure?1:0,0],76);
  const settings=material.cadSurface??{},angle=(settings.textureAngle??0)*Math.PI/180,sourceImage=material.map?.image;
  values.set([Math.cos(angle),Math.sin(angle),settings.textureSize??(material.isMeshPhysicalMaterial?25:1),sourceImage?.width&&sourceImage?.height?sourceImage.width/sourceImage.height:1],80);
  values.set([settings.mapping==='triplanar'?1:0,settings.environmentStrength??1,0,0],84);
  const capSection=material.cadCapSection;
  if(capSection){
   values[79]=capSection.count;
   values.set([...capSection.u.toArray(),-capSection.u.dot(capSection.origin)],88);
   values.set([...capSection.v.toArray(),-capSection.v.dot(capSection.origin)],92);
  }
  const stockClip=patch?live.owner.stockClip:null;
  if(stockClip)values.set([stockClip.count,material.cadStockIndex??0,stockClip.epsilon,stockClip.moving?(stockClip.bounded?2:3):1],96);
  if(wire){const hidden=material.depthFunc===6;values.set(hidden?[1,.12,.65,1]:[.05,1,.72,1],52);values[77]=1;values[58]=0;}
  this.device.queue.writeBuffer(state.buffer,0,values);
  const cuts=this.storage(live?.owner.texture),rounds=this.storage(live?.owner.roundTexture),image=this.image(material.map),capBuffer=this.storage(capSection?.texture),stockBuffer=this.storage(stockClip?live.owner.stockTexture:null);
  if(state.cuts!==cuts||state.rounds!==rounds||state.image!==image||state.capBuffer!==capBuffer||state.stockBuffer!==stockBuffer){
   state.group=this.device.createBindGroup({layout:this.bindLayout,entries:[{binding:0,resource:{buffer:state.buffer}},{binding:1,resource:{buffer:cuts}},{binding:2,resource:{buffer:rounds}},{binding:3,resource:this.sampler},{binding:4,resource:image.createView()},{binding:5,resource:{buffer:capBuffer}},{binding:6,resource:{buffer:stockBuffer}}]});
   Object.assign(state,{cuts,rounds,image,capBuffer,stockBuffer});
  }
  return state;
 }
 render(scene,camera){
  if(this.disposed||this.failed)return true;
  // Bound latency: do not enqueue stale camera/drag states faster than the
  // device can present them. The caller retains its dirty flag on false.
  if(this.pendingFrames>=2)return false;
  this.frameId=(this.frameId??0)+1;
  scene.updateMatrixWorld();camera.updateMatrixWorld();camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const viewProjection=multiply(camera.projectionMatrix.elements,camera.matrixWorldInverse.elements),items=[],seen=new Set();
  const walk=object=>{
   if(!object.visible)return;
   if(object.isSprite){object.quaternion.copy(camera.quaternion);object.updateMatrixWorld();}
   if(object.geometry&&object.material&&object.layers.test(camera.layers)){
    const materials=Array.isArray(object.material)?object.material:[object.material],geometry=this.geometry(object.geometry,object.isPoints);
    if(geometry){const groups=object.geometry.groups.length?object.geometry.groups:[{start:0,count:geometry.count,materialIndex:0}];
     for(const group of groups){const material=materials[group.materialIndex]??materials[0];if(!material?.visible||material.colorWrite===false)continue;
      items.push({object,material,geometry,start:group.start,count:Math.min(group.count,geometry.count-group.start),order:object.renderOrder??0,distance:object.matrixWorld.elements.slice(12,15).reduce((sum,value,i)=>sum+(value-camera.position.toArray()[i])**2,0)});}
    }
   }
   for(const child of object.children??[])walk(child);
  };walk(scene);
  items.sort((a,b)=>a.order-b.order||Number(a.material.transparent)-Number(b.material.transparent)||(a.material.transparent?b.distance-a.distance:0));
  const encoder=this.device.createCommandEncoder(),background=scene.background;
  const pass=encoder.beginRenderPass({colorAttachments:[{view:this.multisample.createView(),resolveTarget:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'discard',clearValue:{r:displayChannel(background?.r??.01),g:displayChannel(background?.g??.02),b:displayChannel(background?.b??.03),a:1}}],depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
  this.info.render.calls=0;this.info.render.triangles=0;
  for(const item of items){
   if(item.count<=0)continue;const {object,material,geometry}=item;seen.add(object);
   object.onBeforeRender?.(this,scene,camera,object.geometry,material,null);
   const topology=object.isLineSegments?'line-list':object.isLine?'line-strip':'triangle-list';
   const state=this.drawState(object,material,camera,viewProjection);
   pass.setPipeline(this.pipeline(material,topology));pass.setBindGroup(0,state.group);pass.setVertexBuffer(0,geometry.buffer);pass.draw(item.count,1,item.start);
   this.info.render.calls++;if(topology==='triangle-list')this.info.render.triangles+=item.count/3;
  }
  pass.end();this.device.queue.submit([encoder.finish()]);
  this.pendingFrames++;
  this.device.queue.onSubmittedWorkDone().then(()=>{this.pendingFrames--;},error=>{this.pendingFrames--;this.fail(error);});
  for(const [object,states] of this.objectCache){for(const [material,state] of states)if(!seen.has(object)||state.used!==this.frameId){state.buffer.destroy();states.delete(material);}if(!states.size)this.objectCache.delete(object);}
  this.info.memory.textures=this.textureCache.size;
  return true;
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.destroyRequested=true;
  this.device.removeEventListener('uncapturederror',this.handleDeviceError);
  try{
  for(const states of this.objectCache.values())for(const state of states.values())state.buffer.destroy();
  for(const [geometry,cached] of this.geometryCache){cached.buffer.destroy();if(geometry.__cadGpuDispose){geometry.removeEventListener('dispose',geometry.__cadGpuDispose);delete geometry.__cadGpuDispose;}}
  for(const [texture,cached] of this.storageCache){cached.buffer.destroy();texture.removeEventListener('dispose',cached.dispose);}for(const texture of this.textureCache.values())texture.destroy();
  this.geometryCache.clear();this.objectCache.clear();this.storageCache.clear();this.textureCache.clear();
  this.depth?.destroy();this.multisample?.destroy();this.white?.destroy();this.empty?.destroy();this.context.unconfigure();
  }finally{this.device.destroy();}
 }
}
