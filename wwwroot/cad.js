import {trimDisplayEdges} from './display-edge-trim.js';
import {visualCapEdges} from './visual-cap-edges.js';
import {visualEdgeDescendants,clearVisualEdgeHistory,importVisualEdgeHistory} from './visual-edge-history.js';
import {measure,recordTiming,performanceStats,clearPerformanceStats} from './cad-performance.js';
export {performanceStats} from './cad-performance.js';
﻿import {LiveFillet} from './live-fillet.js';
import {resolveChamferEdge} from './advanced-features.js';
import {GeometryPrepare} from './geometry-prepare.js';
import {EdgePreview} from './edge-preview.js';
import {exportSolidState,packExportEdges} from './geometry.js';
import {EdgeProfile} from './edge-profile.js';
import {DebugWireframe} from './debug-wireframe.js';
import {installEdgeMotionGpu} from './edge-motion-gpu.js';
import {bodyInfo} from './solid-bodies.js';
import {SurfaceStudio} from './surface-studio.js';
export {readProjectDraft,writeProjectDraft,activeProject,rememberProject,preserveRecoveryDraft,forgetProject} from './cad-recovery.js';
import {ExtendedSketch} from './extended-sketch.js';
import {FeatureDepth} from './feature-depth.js';
import {attachSolidPicking} from './solid-picking.js';
import { readDraft, writeDraft, recordDiagnostic } from './cad-recovery.js';
export { readDraft, writeDraft, recordDiagnostic };
import * as THREE from 'three';
import { CadControls } from './cad-controls.js';
import { Reflector } from './vendor/Reflector.js';
import { buildSolid, retainDocumentSolid, releaseDocumentSolid, importSolidState, featurePolygons, featureEndInfo, solidGeometry, profileShape, resolvePlane, world, documentGeometry, sketchGeometry, coplanarFaces, validateSupportPlanes, solidEdgeOptions, edgeTreatmentOptions, resolveSolidEdge, featureSweepGuide, loftFaceSection, featureDependsOnSketch } from './geometry.js';
import { buildRegions, regionShape,insideLoop } from './regions.js';
import { closestScreenSnap } from './snapping.js';
import { outline, edgeCount, dragEntity, dragMode, handles, anchor, effectiveAnchor, slotToLocal, radial, rotationEdges } from './sketch-tools.js';
import { sketchStroke } from './sketch-stroke.js';
import { displayEdges, dimensionLayout } from './dimensions.js';
import {entitySnapPoints,hasRelations} from './sketch-points.js';
import {modelEdges,edgePoint,sketchLine,constrainSketch,modelSnapPoints,applyModelDimensions} from './model-dimensions.js';
export {applyModelDimensions};
let modelEdgeCache=new Map(),dimensionSelection=null,dimensionPressed=null,dimensionSelectionMesh=null,dimensionHoverMesh=null,dimensionHoverKey='';
let dimensionDrag=null,dimensionEditor=null,dimensionDraft=null;
let dragging=null,pendingDragEvent=null,drawingSnap=null;
let renderer, scene, camera, controls, host, bridge, group, floor, shadowFloor, keyLight, observer, doc, ui;
let extendedSketch=null;
let chamferEdges=[],chamferHover=null,axisEdges=[],axisHover=null;
let lifecycleObserver=null,viewDisposed=true;
let sweepGuide=null,sweepMoving=null,sweepPlaying=null,sweepProgress=0;
window.addEventListener("pagehide",()=>dispose());
let sketchCreationFocus=null;
let cameraTransition=null,depthGizmo=null,featurePreviewMesh=null,surfaceStudio=null,edgeProfile=null,pendingEdgeRadius=null,lastEdgePreview=0,edgePreview=null,geometryPrepare=new GeometryPrepare(),lastFullEdgeState=null,edgeMotion=null,liveFillet=null,liveFilletKey=null,visualTreatment=null;
let debugWireframe=null,debugMode=false;
function syncDebugWireframe(){debugWireframe?.sync([solidMesh,featurePreviewMesh,...(liveFillet?.patches??[]),...(visualTreatment?.patches??[])]);}
export function setDebugMode(value){debugMode=!!value;if(!debugWireframe)debugWireframe=new DebugWireframe();debugWireframe.setEnabled(debugMode);syncDebugWireframe();requestRender();}
let animation, drawing, pressed, preview, currentFrame, solid = [], cacheKey = '', solidMesh;
let hoveredRegion = null;
const regionCache = new Map();
let renderedKey = '';
let previewInfo = {valid:false,message:''};
let targetHoverMesh=null,targetHoverKey='';
let viewDocument=null,snapCandidates=[],snapElement=null,lastSnap=null;
const modelSnapCache=new WeakMap();
let navigating=false,needsRender=true,pendingPointerMove=null,lastFrameTime=null,lastFrameRendered=false;
function requestRender(){needsRender=true;}
const ray = new THREE.Raycaster(), ink = 0xa2b9f4, accent = 0xc0ec88;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export function init(id, callback) {if(!viewDisposed)dispose();viewDisposed=false;requestRender();
    host = document.getElementById(id); bridge = callback;
    debugWireframe=new DebugWireframe();debugWireframe.setEnabled(debugMode);
    host.tabIndex = 0;
    lifecycleObserver=new MutationObserver(()=>{if(host&&!host.isConnected)dispose();});
    lifecycleObserver.observe(document.body,{childList:true,subtree:true});
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=.9;renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();recordDiagnostic('webgl-context-lost',event.statusMessage||'Graphics context lost');});
    renderer.domElement.addEventListener('webglcontextrestored',()=>{requestRender();recordDiagnostic('webgl-context-restored','Graphics context restored');});
    snapElement=document.createElement('div');snapElement.className='snap-feedback';snapElement.setAttribute('aria-hidden','true');
    const marker=document.createElement('i'),text=document.createElement('span');snapElement.append(marker,text);snapElement.hidden=true;host.appendChild(snapElement);
    scene = new THREE.Scene();edgePreview=new EdgePreview(showEdgeRadiusPreview,(message,data)=>{edgeProfile?.error(message);if(data?.feature&&!data.feature.previewSegments)publishEdgePreview(data.feature,false,message);});edgeProfile=new EdgeProfile(value=>{if(liveFillet){try{liveFillet.set(value);previewInfo={valid:true,min:value,max:value,message:(liveFillet?.bevel?'D ':'R ')+value+' mm'};edgeProfile.error('');}catch(error){edgeProfile.error(error.message);}}else if(!applyFilletMotion(value))pendingEdgeRadius={value,key:edgeProfile.config?.key};requestRender();},commitEdgeRadius);surfaceStudio=new SurfaceStudio(renderer,scene,requestRender); scene.background = new THREE.Color(0x1b2430);
    camera = new THREE.PerspectiveCamera(38, 1, .1, 20000); camera.up.set(0, 0, 1); camera.position.set(180, -230, 210);
    createControls(V());
    const ambient=new THREE.HemisphereLight(0xe7edfa, 0x222935, .22);ambient.layers.enable(1);scene.add(ambient);
    keyLight = new THREE.DirectionalLight(0xfffaf3, 1.2); keyLight.position.set(-80, -100, 200); keyLight.castShadow=true;
    keyLight.layers.enable(1);keyLight.shadow.mapSize.set(2048,2048);keyLight.shadow.radius=3;keyLight.shadow.bias=-.0002; keyLight.shadow.normalBias=.03; scene.add(keyLight);scene.add(keyLight.target);
    renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    createFloor();
    extendedSketch=new ExtendedSketch((entity,tool)=>bridge.invokeMethodAsync('AddSketchEntity',tool,entity),hint=>bridge.invokeMethodAsync('CanvasHint',hint));
    depthGizmo=new FeatureDepth(host,scene,camera,requestRender,previewFeatureDepth,commitFeatureDepth,
        ()=>{interruptCameraTransition();cancelDraw();controls.enabled=false;},()=>{if(controls)controls.enabled=!dimensionEditor;});
    observer = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h;if(camera.isOrthographicCamera){const half=(camera.top-camera.bottom)/2;camera.left=-half*camera.aspect;camera.right=half*camera.aspect;} camera.updateProjectionMatrix();requestRender(); }); observer.observe(host);
    host.addEventListener('pointerdown', down,true); host.addEventListener('pointerup', up); host.addEventListener('pointermove', move); host.addEventListener('pointercancel', cancelDraw); host.addEventListener('contextmenu', context);
    host.addEventListener('wheel',interruptCameraTransition,{capture:true,passive:true});
    document.addEventListener('input',sweepProgressInput);
    host.addEventListener('dblclick',editDimensionAt);host.addEventListener('pointerleave', leave); host.addEventListener('keydown', keydown);window.addEventListener('keydown',focusModelKey);
    function loop() { const now=performance.now();if(lastFrameRendered&&needsRender&&lastFrameTime!==null)recordTiming('active-frame-interval',now-lastFrameTime);lastFrameTime=now;lastFrameRendered=false;animation = requestAnimationFrame(loop);edgeProfile?.frame();if(pendingPointerMove){const event=pendingPointerMove;pendingPointerMove=null;measure('pointer-move',()=>handleMove(event));}if(pendingEdgeRadius!==null&&performance.now()-lastEdgePreview>33){const queued=pendingEdgeRadius;pendingEdgeRadius=null;lastEdgePreview=performance.now();if(queued.key===edgeProfile?.config?.key)previewEdgeRadius(queued.value);}if(sweepPlaying){const play=sweepPlaying,t=Math.min(1,(performance.now()-play.start)/play.duration);setSweepProgress(play.from+(1-play.from)*t);if(t>=1)sweepPlaying=null;}if(pendingDragEvent&&dragging){const event=pendingDragEvent;pendingDragEvent=null;updateEntityDrag(event);} if(cameraTransition)advanceCameraTransition(performance.now());else controls.update();if(needsRender){lastFrameRendered=true;needsRender=false;depthGizmo?.frame();liveFillet?.frame(camera);const adjusting=!!edgeProfile?.drag;if(liveFillet){solidMesh.receiveShadow=!adjusting;for(const patch of liveFillet.patches)patch.receiveShadow=!adjusting;}floor.visible=!ui?.pickingSketchPlane&&!adjusting;measure('render-submit',()=>renderer.render(scene,camera),{triangles:solidMesh?.geometry.attributes.position.count/3||0});} } loop();
}
function context(e) { e.preventDefault(); }
function navigationStart() {retargetOrbitToView();navigating=true;if(host)host.dataset.dragHint='';showSnap(null);}
function navigationEnd() {navigating=false;retargetOrbitToView();}
function centerViewOnPlane(normal,origin){
    if(!camera||!controls)return null;
    const direction=V(0,0,-1).applyQuaternion(camera.quaternion),denominator=direction.dot(normal);
    if(Math.abs(denominator)<.08)return null;
    const distance=origin.clone().sub(camera.position).dot(normal)/denominator;
    const currentDistance=Math.max(1,camera.position.distanceTo(controls.target));
    if(distance<=camera.near||distance>Math.max(100,currentDistance*8))return null;
    return camera.position.clone().addScaledVector(direction,distance);
}
function retargetOrbitToView(){
    if(!controls||cameraTransition||dimensionEditor||depthGizmo?.drag)return;
    // Sample once per gesture. Moving the pivot during rotation would make the
    // whole model drift; changing only its depth on the view ray causes no jump.
    const working=ui?.editingId&&currentFrame?centerViewOnPlane(currentFrame.n,currentFrame.o):null;
    const ground=centerViewOnPlane(V(0,0,1),V(0,0,floor?.position.z??0));
    const target=working??ground??(currentFrame?centerViewOnPlane(currentFrame.n,currentFrame.o):null);
    if(!target)return;
    controls.target.copy(target);controls.update();requestRender();
}
function configureControls() {
    // CAD navigation should stop immediately when the pointer stops.
    controls.enableDamping=false;controls.autoRotate=false;
    controls.rotateSpeed=1;controls.zoomSpeed=1;controls.panSpeed=1;
    controls.enableRotate=true;controls.enablePan=true;controls.enableZoom=true;
    controls.screenSpacePanning=true;
    controls.mouseButtons.LEFT=ui?.editingId?null:THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE=THREE.MOUSE.ROTATE;controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
}
function createControls(target) {
    if(controls) {
        controls.removeEventListener('start',navigationStart);controls.removeEventListener('end',navigationEnd);controls.dispose();
    }
    navigating=false;
    // Reset pointer state after a view transition. CAD rotation follows screen
    // axes and preserves the current view instead of orbiting a sketch pole.
    controls=new CadControls(camera,renderer.domElement);
    controls.target.copy(target);configureControls();
    controls.addEventListener('start',navigationStart);controls.addEventListener('end',navigationEnd);controls.addEventListener('change',requestRender);
    controls.update();
}
function focusModelKey(e){if(e.key?.toLowerCase()==='f'&&!e.repeat&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.target?.closest?.('input,textarea,select,[contenteditable=true]')){e.preventDefault();fit(true);return;}}
function keydown(e) {if(e.key==='Delete'&&!e.repeat&&!e.target?.closest?.('input,textarea,select,[contenteditable=true]')&&ui?.selectedBodyId&&!ui.operation&&!ui.editingId){e.preventDefault();bridge.invokeMethodAsync('DeleteSelectedBody');return;}if(e.key==='Escape'){interruptCameraTransition();e.preventDefault();cancelDraw();if(extendedSketch?.cancel()){bridge.invokeMethodAsync('CanvasHint','当前绘制步骤已取消，Esc 返回选择');return;}if(dimensionSelection){clearDimensionSelection();return;}bridge.invokeMethodAsync('CanvasEscape');}}
function dimensionSourceKey(e) {
    return JSON.stringify([e.kind,e.x,e.y,e.width,e.height,e.radius,e.angle,e.sides,e.startAngle,e.sweepAngle,e.referenceLineId,e.referenceOffset,e.modelDimensions]);
}
function closeDimensionEditor() {
    const editor=dimensionEditor;if(!editor)return;
    dimensionEditor=null;editor.root.remove();
    if(controls)controls.enabled=true;
}
async function finishDimensionEdit(save) {
    const editor=dimensionEditor;if(!editor||editor.saving)return;
    if(!save){closeDimensionEditor();host?.focus({preventScroll:true});return;}
    const text=editor.input.value.trim().replace(',','.');const value=Number(text);
    if(!text||!Number.isFinite(value)){editor.error.textContent='请输入有效尺寸';editor.input.focus();editor.input.select();return;}
    editor.saving=true;editor.input.disabled=true;editor.error.textContent='';
    try {
        const error=editor.createArgs?await bridge.invokeMethodAsync('CreatePlacedDimension',...editor.createArgs,value):await bridge.invokeMethodAsync('EditDimensionValue',editor.pick.sketchId,editor.pick.profileId,editor.pick.edge,value);
        if(dimensionEditor!==editor)return;
        if(error){editor.saving=false;editor.input.disabled=false;editor.error.textContent=error;editor.input.focus();editor.input.select();}
        else {closeDimensionEditor();host?.focus({preventScroll:true});}
    } catch(error) {
        if(dimensionEditor!==editor)return;
        editor.saving=false;editor.input.disabled=false;editor.error.textContent='尺寸未保存，请重试';editor.input.focus();
    }
}
function editDimensionAt(event) {
    if(!ui||ui.operation||ui.pickingSketchPlane||ui.pickingTarget||dimensionEditor)return;
    const hit=pickAt(event).visible.find(h=>h.object.userData.dimensionLabel);if(!hit)return;
    event.preventDefault();event.stopPropagation();cancelDraw();showSnap(null);
    const pick=hit.object.userData.pick,sketch=doc.sketches.find(s=>s.id===pick.sketchId),entity=sketch?.entities.find(e=>e.id===pick.profileId);
    const layout=entity?layoutForDimension(sketch,entity,pick.edge):null;if(!layout)return;
    const value=dimensionValue(entity,pick.edge);
    openDimensionInput(pick,layout,value);
}
function openDimensionInput(pick,layout,value,createArgs=null) {
    const sketch=doc.sketches.find(s=>s.id===pick.sketchId),entity=sketch.entities.find(e=>e.id===pick.profileId);
    const frame=resolvePlane(viewDocument,sketch.plane),p=world(frame,...layout.position,.4).project(camera),rect=host.getBoundingClientRect();
    const root=document.createElement('div');root.className='dimension-editor';root.setAttribute('role','dialog');root.setAttribute('aria-label','编辑标注尺寸');
    root.style.left=Math.max(90,Math.min(rect.width-90,(p.x+1)*rect.width/2))+'px';
    root.style.top=Math.max(28,Math.min(rect.height-90,(1-p.y)*rect.height/2))+'px';
    const field=document.createElement('div');field.className='dimension-editor-field';
    const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.value=Number(value.toFixed(6)).toString();input.setAttribute('aria-label','尺寸值');input.autocomplete='off';
    const unit=document.createElement('span');unit.textContent='mm';field.append(input,unit);
    const hint=document.createElement('small');hint.textContent=createArgs?'Enter 确认 · Esc / 点击空白重新选边':'Enter 确认 · Esc 取消';
    const error=document.createElement('div');error.className='dimension-editor-error';error.setAttribute('role','alert');
    root.append(field,hint,error);host.appendChild(root);dimensionEditor={root,input,error,pick,sourceKey:dimensionSourceKey(entity),createArgs,saving:false};controls.enabled=false;host.dataset.dragHint='';
    root.addEventListener('pointerdown',e=>e.stopPropagation());root.addEventListener('dblclick',e=>e.stopPropagation());root.addEventListener('wheel',e=>e.stopPropagation());
    input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();void finishDimensionEdit(true);}else if(e.key==='Escape'){e.preventDefault();void finishDimensionEdit(false);}});
    input.addEventListener('blur',()=>{if(dimensionEditor?.input===input)void finishDimensionEdit(!dimensionEditor.createArgs);});
    input.focus({preventScroll:true});input.select();
}
function leave() {pendingPointerMove=null;requestRender();showDimensionHover(null);if(host)host.dataset.dragHint='';hoveredRegion = null; showSnap(null);destroy(axisHover);axisHover=null;clearTargetHover(); if(ui?.pickingSketchPlane)hoverReferencePlane(null);paintRegions(); }
function showSnap(snap) {
    lastSnap=snap;if(!snapElement)return;snapElement.hidden=!snap;
    if(snap){snapElement.style.left=snap.screenX+'px';snapElement.style.top=snap.screenY+'px';snapElement.className='snap-feedback '+snap.kind;snapElement.lastChild.textContent=snap.label;}
}
function rebuildSnapCandidates(active) {
    snapCandidates=[];if(!active)return;
    if(active.plane.featureId){
        const edges=edgesForSketch(active);
        let candidates=modelSnapCache.get(edges);
        if(!candidates){
            candidates=modelSnapPoints(edges).map(snap=>({...snap,point:new THREE.Vector2(...snap.point)}));
            const faces=new Map();for(const edge of edges){const key=JSON.stringify(edge.referenceFace);if(!faces.has(key))faces.set(key,[]);faces.get(key).push(edge);}
            for(const edge of edges){
                const [nx,ny]=edge.normal,related=faces.get(JSON.stringify(edge.referenceFace));let low=Infinity,high=-Infinity;
                for(const item of related)for(const p of [item.a,item.b]){const value=-ny*p[0]+nx*p[1];low=Math.min(low,value);high=Math.max(high,value);}
                if(high-low<1e-6)continue;
                candidates.push({kind:'edge',label:'实体边 · 点在线上',segment:[new THREE.Vector2(...edge.a),new THREE.Vector2(...edge.b)],normal:edge.normal,range:[low,high],reference:{kind:'modelEdge',faces:[edge.referenceFace]}});
            }
            modelSnapCache.set(edges,candidates);
        }
        snapCandidates.push(...candidates);
    }
    snapCandidates.push({point:new THREE.Vector2(),kind:'origin',label:active.plane.sourceSketchId?'截面中心 · 重合':'草图原点 · 重合',reference:{kind:'origin',faces:[]}});
    for(const entity of active.entities)for(const snap of entitySnapPoints(entity)) {
        snapCandidates.push({point:new THREE.Vector2(...snap.point),kind:snap.kind,label:snap.label+' · 重合',entityId:entity.id,reference:{kind:'sketch',entityId:entity.id,point:snap.name,faces:[]}});
    }
    const centers=snapCandidates.filter(candidate=>candidate.point&&(candidate.kind==='center'||candidate.reference?.kind?.startsWith('model')));
    if(centers.length){
        const geometry=new THREE.BufferGeometry().setFromPoints(centers.map(candidate=>world(currentFrame,candidate.point.x,candidate.point.y,.3)));
        const markers=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xffd68c,size:7,sizeAttenuation:false,depthTest:false,depthWrite:false}));
        markers.renderOrder=12;markers.raycast=()=>{};group.add(markers);
    }
}
function clearTargetHover() {destroy(targetHoverMesh);targetHoverMesh=null;targetHoverKey='';}
function targetHover(tag) {
    const key=tag?tag.featureId+'/'+tag.face:'';if(key===targetHoverKey)return;
    clearTargetHover();if(!tag||tag.face==='curved')return;
    targetHoverKey=key;const polygons=coplanarFaces(solid,resolvePlane(viewDocument,tag));
    targetHoverMesh=new THREE.Mesh(solidGeometry(polygons).geometry,new THREE.MeshBasicMaterial({color:0x7bbffc,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-5,polygonOffsetUnits:-5}));group.add(targetHoverMesh);
}
function sketchRegions(sketch) {
    const key = sketchGeometry(sketch), cached = regionCache.get(sketch.id);
    if(cached?.key === key) return cached.regions;
    const regions = buildRegions(sketch); regionCache.set(sketch.id, {key, regions}); return regions;
}
function paintRegions() {
    if(!group || !ui)return;
    for(const object of group.children) {
        const pick=object.userData.regionOutline??object.userData.pick;if(pick?.kind!=='region')continue;
        const selected=pick.sketchId===ui.sketchId&&ui.regionKeys.includes(pick.regionKey)||ui.operation&&ui.featureMode==='loft'&&ui.featureDraft.sections.some(section=>section.sketchId===pick.sketchId&&section.regionKeys.includes(pick.regionKey));
        const hovered=hoveredRegion?.sketchId===pick.sketchId&&hoveredRegion?.regionKey===pick.regionKey;
        if(object.userData.regionOutline){
            object.visible=selected||hovered;
            for(const stroke of object.children){stroke.material.uniforms.strokeColor.value.setHex(selected?0xffd276:0xb3efff);stroke.material.uniforms.strokeWidth.value=selected?6:5;}
        }else{
            object.material.color.setHex(selected?0x49cf9a:hovered?0x52baff:0x254b66);
            object.material.opacity=selected ? .43 : hovered ? .27 : .075;
        }
    }
}
export function loftSectionChoices(){
    return doc.sketches.filter(s=>s.finished).flatMap(s=>sketchRegions(s).map((r,i)=>({value:s.id+':'+i,label:s.name+' · 区域 '+(i+1)+' · '+r.area.toFixed(1)+' mm²',sketchId:s.id,regionKeys:[r.key]})));
}
function drawRotationAxis(sketch){
    const feature=ui.featureDraft,base=resolvePlane(viewDocument,sketch.plane);let a,b;
    if(feature.axisModelEdge){try{const edge=resolveSolidEdge(solid,feature.axisModelEdge);a=edge.a;b=edge.b;group.add(chamferStroke(edge,0x9ee9ff));}catch{return;}}
    else if(feature.axisEntityId){const source=doc.sketches.find(s=>s.id===(feature.axisSketchId??sketch.id)),line=source?.entities.find(e=>e.id===feature.axisEntityId),edge=line?rotationEdges(line).find(edge=>edge.index===(feature.axisEdgeIndex??0)):null;if(!edge)return;const basis=resolvePlane(viewDocument,source.plane);a=world(basis,...edge.a);b=world(basis,...edge.b);}
    else {a=feature.axis==='X'?world(base,0,feature.axisOffset??0):world(base,feature.axisOffset??0,0);b=a.clone().add(feature.axis==='X'?base.u:base.v);}
    const direction=b.clone().sub(a).normalize(),radius=Math.max(60,camera.position.distanceTo(controls.target)*.6),identity={o:V(),u:V(1,0,0),v:V(0,1,0),n:V(0,0,1)};
    const guide=sketchStroke([a.clone().addScaledVector(direction,-radius).toArray(),b.clone().addScaledVector(direction,radius).toArray()],identity,0xffc77b,5,true);guide.material.depthTest=false;group.add(guide);
}
function rotationAxisDistance(event,a,b){
    const rect=host.getBoundingClientRect(),mouse=new THREE.Vector2(event.clientX-rect.left,event.clientY-rect.top),p=a.clone().project(camera),q=b.clone().project(camera);
    if(p.z< -1||p.z>1||q.z< -1||q.z>1)return Infinity;
    const x=new THREE.Vector2((p.x+1)*rect.width/2,(1-p.y)*rect.height/2),y=new THREE.Vector2((q.x+1)*rect.width/2,(1-q.y)*rect.height/2),delta=y.clone().sub(x),t=THREE.MathUtils.clamp(mouse.clone().sub(x).dot(delta)/(delta.lengthSq()||1),0,1);
    return mouse.distanceTo(x.addScaledVector(delta,t));
}
function rotationAxisAt(event){
    let best=null,score=12;
    const displayed=new Set(group.children.map(object=>object.userData.entityKey).filter(Boolean));
    for(const sketch of doc.sketches.filter(s=>s.finished)){
        if(sketch.plane.featureId&&!viewDocument.features.some(f=>f.id===sketch.plane.featureId))continue;
        const frame=resolvePlane(viewDocument,sketch.plane);
        for(const entity of sketch.entities){if(!displayed.has(`${sketch.id}/${entity.id}`))continue;
            for(const edge of rotationEdges(entity)){const a=world(frame,...edge.a),b=world(frame,...edge.b),distance=rotationAxisDistance(event,a,b);if(distance<score){score=distance;best={id:entity.id,sketchId:sketch.id,edgeIndex:edge.index,a,b,distance};}}
        }
    }
    return best;
}
function rotationReferenceAt(event){
    const sketch=rotationAxisAt(event),model=chamferEdgeAt(event,axisEdges);
    if(sketch&&(!model||sketch.distance<=rotationAxisDistance(event,model.a,model.b)+.5))return {...sketch,kind:'sketch'};
    return model?{...model,kind:'model'}:null;
}
function rotationReferenceStroke(reference){
    if(!reference)return null;
    const identity={o:V(),u:V(1,0,0),v:V(0,1,0),n:V(0,0,1)},stroke=sketchStroke([reference.a.toArray(),reference.b.toArray()],identity,0x9ee9ff,7);
    stroke.material.depthTest=false;stroke.renderOrder=12;return stroke;
}
function configureSweepGuide(feature){
    sweepGuide=featureSweepGuide(viewDocument,feature);sweepMoving=new THREE.Group();
    const identity={o:V(),u:V(1,0,0),v:V(0,1,0),n:V(0,0,1)};
    for(const contour of sweepGuide.contours){const closed=[...contour,contour[0]];sweepMoving.add(sketchStroke(closed,identity,0xffd276,6));}
    group.add(sweepMoving);
    for(let i=0;i<=12;i++){const frame=sweepGuide.at(i/12);for(const contour of sweepGuide.contours){const points=[...contour,contour[0]].map(p=>world(frame,...p));const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x9dd7de,transparent:true,opacity:.23,depthTest:false,depthWrite:false}));line.renderOrder=4;group.add(line);}}
    setSweepProgress(0);
}
function setSweepProgress(progress){
    if(!sweepGuide||!sweepMoving)return;sweepProgress=THREE.MathUtils.clamp(progress,0,1);const frame=sweepGuide.at(sweepProgress);
    sweepMoving.matrixAutoUpdate=false;sweepMoving.matrix.copy(frameMatrix(frame));sweepMoving.matrixWorldNeedsUpdate=true;
    const input=document.getElementById('sweep-progress');if(input)input.value=String(Math.round(sweepProgress*100));const label=document.getElementById('sweep-progress-value');if(label)label.textContent=Math.round(sweepProgress*100)+'%';requestRender();
}
function sweepProgressInput(event){if(event.target?.id!=='sweep-progress')return;sweepPlaying=null;setSweepProgress(Number(event.target.value)/100);}
export function playSweepGuide(){if(!sweepGuide)return;if(sweepPlaying){sweepPlaying=null;return;}if(sweepProgress>=1)setSweepProgress(0);sweepPlaying={start:performance.now(),from:sweepProgress,duration:2400*(1-sweepProgress)};requestRender();}
function sweepPathAt(event){
    const rect=host.getBoundingClientRect(),mouse=new THREE.Vector2(event.clientX-rect.left,event.clientY-rect.top),visible=new Set(group.children.map(o=>o.userData.pick?.sketchId).filter(Boolean));let best=null,score=12;
    for(const sketch of doc.sketches.filter(s=>s.finished&&s.id!==ui.sketchId&&visible.has(s.id))){
        let frame;try{frame=resolvePlane(viewDocument,sketch.plane);}catch{continue;}
        for(const entity of sketch.entities.filter(e=>['line','arc','circle','ellipse'].includes(e.kind))){const points=outline(entity).map(p=>world(frame,...p).project(camera));
            for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue;const p=new THREE.Vector2((a.x+1)*rect.width/2,(1-a.y)*rect.height/2),q=new THREE.Vector2((b.x+1)*rect.width/2,(1-b.y)*rect.height/2),d=q.clone().sub(p),t=THREE.MathUtils.clamp(mouse.clone().sub(p).dot(d)/(d.lengthSq()||1),0,1),distance=mouse.distanceTo(p.addScaledVector(d,t));if(distance<score){score=distance;best={sketch,entity,frame};}}
        }
    }return best;
}
function chamferStroke(edge,color=0xffd276){
    const points=[...(edge.points??[edge.a,edge.b])];if(edge.closed)points.push(points[0]);
    const stroke=sketchStroke(points,null,color,7);stroke.material.depthTest=true;return stroke;
}

function tangentEdgeChain(seed,edges=chamferEdges){
    const result=[],seen=new Set(),pending=[seed],epsilon=1e-3;
    const ends=edge=>{if(edge.closed)return [];const points=edge.points??[edge.a,edge.b];return [0,points.length-1].map(index=>{const next=index===0?1:index-1,away=points[next].clone().sub(points[index]).normalize();let direction=away;
        if(edge.frames){const frame=edge.frames[index],tangent=frame.normalA.clone().cross(frame.normalB).normalize();if(tangent.dot(away)<0)tangent.negate();direction=tangent;}
        return {point:points[index],direction};});};
    while(pending.length){const edge=pending.pop();if(seen.has(edge))continue;seen.add(edge);result.push(edge);const endpoints=ends(edge);
        for(const candidate of edges){if(seen.has(candidate)||candidate.closed)continue;
            if(endpoints.some(a=>ends(candidate).some(b=>a.point.distanceToSquared(b.point)<=epsilon*epsilon&&a.direction.dot(b.direction)<-Math.cos(Math.PI/60))))pending.push(candidate);
        }
    }
    return result;
}
function chamferChainStroke(edge,color){const object=new THREE.Group();for(const part of tangentEdgeChain(edge))object.add(chamferStroke(part,color));return object;}
function chamferEdgeAt(event,edges=chamferEdges){
    rayAt(event);const rect=host.getBoundingClientRect(),mouse=new THREE.Vector2(event.clientX-rect.left,event.clientY-rect.top),body=solidMesh?ray.intersectObject(solidMesh,false)[0]:null;let best=null,score=Infinity;
    for(const edge of edges){const points=edge.points??[edge.a,edge.b],count=edge.closed?points.length:points.length-1;
        for(let i=0;i<count;i++){const first=points[i],last=points[(i+1)%points.length],a=first.clone().project(camera),b=last.clone().project(camera);if(a.z>1||b.z>1||a.z< -1||b.z< -1)continue;
            const p=new THREE.Vector2((a.x+1)*rect.width/2,(1-a.y)*rect.height/2),q=new THREE.Vector2((b.x+1)*rect.width/2,(1-b.y)*rect.height/2),delta=q.clone().sub(p),t=THREE.MathUtils.clamp(mouse.clone().sub(p).dot(delta)/(delta.lengthSq()||1),0,1),distance=mouse.distanceTo(p.addScaledVector(delta,t));if(distance>12)continue;
            const onEdge=new THREE.Vector3();ray.ray.distanceSqToSegment(first,last,new THREE.Vector3(),onEdge);if(body&&!edge.visualBoundary&&ray.ray.origin.distanceTo(onEdge)>body.distance+Math.max(.3,camera.position.distanceTo(controls.target)*.002))continue;
            if(edge.visualBoundary){const direction=camera.isOrthographicCamera?V(0,0,1).applyQuaternion(camera.quaternion):camera.position.clone().sub(onEdge).normalize(),frames=edge.frames;if(frames[i].normalA.dot(direction)<-.01&&frames[i].normalB.dot(direction)<-.01)continue;}
            const rank=distance+(edge.visualBoundary?-.5:0)+camera.position.distanceTo(onEdge)*1e-5;if(rank<score){score=rank;best=edge;}
        }
    }return best;
}
export function regionsForEntity(sid,pid) {
    const sketch=doc.sketches.find(s=>s.id===sid),e=sketch?.entities.find(e=>e.id===pid);if(!e)return [];
    return sketchRegions(sketch).filter(r=>e.kind==='arc'||e.kind==='line'?r.sourceIds.includes(e.id):insideLoop(r.outer.witness,outline(e))).map(r=>r.key);
}
function destroy(object) {
    if (!object) return;
    object.traverse(o => { o.userData.edgeMotionGpu?.dispose();if(!o.userData.sharedGeometry)o.geometry?.dispose(); if (o.material&&!o.userData.sharedMaterial) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose(); m.dispose(); }); });
    object.removeFromParent();
}
function frameMatrix(f) { return new THREE.Matrix4().makeBasis(f.u, f.v, f.n).setPosition(f.o); }
function drawReferencePlanes() {
    const colors={XY:0x66b5ff,XZ:0x73d6a2,YZ:0xef8c87};
    for(const reference of ['XY','XZ','YZ']) {
        const f=resolvePlane(doc,{reference}),color=colors[reference],pick={kind:'referencePlane',reference};
        const geometry=new THREE.PlaneGeometry(100,100);geometry.applyMatrix4(frameMatrix(f));
        const face=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.1,side:THREE.DoubleSide,depthWrite:false}));
        face.userData.pick=pick;face.userData.planeColor=color;group.add(face);
        const points=[];
        for(let i=-50;i<=50;i+=10)points.push(world(f,i,-50),world(f,i,50),world(f,-50,i),world(f,50,i));
        const lines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity:.4,depthWrite:false}));
        lines.userData.pick=pick;group.add(lines);
        label(reference+' 平面',reference==='XZ'?58:0,reference==='XZ'?0:58,f,pick);
    }
}
function hoverReferencePlane(reference) {
    for(const object of group.children)if(object.userData.planeColor) object.material.opacity=object.userData.pick.reference===reference ? .25 : .1;
}
function createFloor() {
    const shader={
        uniforms:{...THREE.UniformsUtils.clone(Reflector.ReflectorShader.uniforms),radius:{value:1000}},
        vertexShader:`uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vFloor;
            void main(){vFloor=position.xy;vUv=textureMatrix*vec4(position,1.0);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader:`uniform vec3 color;uniform sampler2D tDiffuse;uniform float radius;varying vec4 vUv;varying vec2 vFloor;
            void main(){vec2 uv=vUv.xy/vUv.w;vec2 d=vec2(0.0012);vec3 r=texture2D(tDiffuse,uv).rgb*0.4;
                r+=(texture2D(tDiffuse,uv+vec2(d.x,0.0)).rgb+texture2D(tDiffuse,uv-vec2(d.x,0.0)).rgb+texture2D(tDiffuse,uv+vec2(0.0,d.y)).rgb+texture2D(tDiffuse,uv-vec2(0.0,d.y)).rgb)*0.15;
                float fade=1.0-smoothstep(radius*0.4,radius,length(vFloor));gl_FragColor=vec4(mix(color,r,0.23*fade),fade*0.94);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`
    };
    floor=new Reflector(new THREE.PlaneGeometry(20000,20000),{color:0x263242,textureWidth:1024,textureHeight:1024,clipBias:.003,shader,multisample:0});
    floor.camera.layers.set(1);
    floor.material.transparent=true;floor.material.depthWrite=false;floor.position.z=-8;scene.add(floor);
    shadowFloor=new THREE.Mesh(new THREE.PlaneGeometry(20000,20000),new THREE.ShadowMaterial({color:0x03070d,opacity:.42,depthWrite:false}));
    shadowFloor.position.z=-7.98;shadowFloor.receiveShadow=true;scene.add(shadowFloor);
}
function updateFloor() {
    const box=new THREE.Box3();for(const p of solid)for(const v of p.vertices)box.expandByPoint(v);
    const center=box.isEmpty()?V():box.getCenter(V()),size=box.isEmpty()?V(100,100,100):box.getSize(V());
    const span=Math.max(size.length(),100),z=box.isEmpty()?-8:box.min.z-Math.max(.02,span*.0001);
    // Always world XY. Only geometry regeneration changes the stage elevation;
    // selecting a face or changing a sketch support cannot move or rotate it.
    floor.position.set(center.x,center.y,z);shadowFloor.position.set(center.x,center.y,box.isEmpty()?z+.02:box.min.z-.015);
    floor.material.uniforms.radius.value=Math.max(1000,span*5);
    keyLight.position.copy(center).add(V(-span, -span, span*2));keyLight.target.position.copy(center);
    const shadowCamera=keyLight.shadow.camera;
    Object.assign(shadowCamera,{near:.1,far:span*6});keyLight.updateMatrixWorld(true);keyLight.target.updateMatrixWorld(true);keyLight.shadow.updateMatrices(keyLight);
    const lightBounds=new THREE.Box3();
    if(!box.isEmpty())for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])lightBounds.expandByPoint(V(x,y,z).applyMatrix4(shadowCamera.matrixWorldInverse));
    const margin=Math.max(2,span*.035);
    Object.assign(shadowCamera,lightBounds.isEmpty()?{left:-span,right:span,top:span,bottom:-span}:{left:lightBounds.min.x-margin,right:lightBounds.max.x+margin,bottom:lightBounds.min.y-margin,top:lightBounds.max.y+margin});
    shadowCamera.updateProjectionMatrix();keyLight.shadow.normalBias=Math.max(.002,Math.max(shadowCamera.right-shadowCamera.left,shadowCamera.top-shadowCamera.bottom)/2048*.3);
}
function sceneInfo(chosen) {
    return {regions:chosen?sketchRegions(chosen).map(r=>({key:r.key,area:r.area,sourceIds:r.sourceIds})):[],preview:previewInfo,bodies:bodyInfo(doc,solid).map(({id,name,featureIds})=>({id,name,featureIds}))};
}
function addLine(points, color, pick, f, z = .1, dashed=false) {
    const positions = points.map(p => world(f, p[0], p[1], z));
    const o = new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions), dashed?new THREE.LineDashedMaterial({color,dashSize:3,gapSize:2,depthTest:!ui.editingId}):new THREE.LineBasicMaterial({ color, depthTest: !ui.editingId }));
    if(dashed)o.computeLineDistances();if (pick) o.userData.pick = pick; o.renderOrder = 5; group.add(o); return o;
}
function label(text, x, y, f, pick, dimensionStyle=null) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
    const c=canvas.getContext('2d');c.font='500 43px Segoe UI';
    if(dimensionStyle)canvas.width=Math.max(112,Math.min(512,Math.ceil(c.measureText(text).width+48)));
    const width=canvas.width;c.fillStyle=dimensionStyle?'#142231ed':'#172130';
    if(dimensionStyle){c.beginPath();c.roundRect(4,4,width-8,88,14);c.fill();c.strokeStyle=dimensionStyle;c.lineWidth=2;c.stroke();}else c.fillRect(0,0,width,96);
    c.font='500 43px Segoe UI';c.textAlign='center';c.textBaseline='middle';c.fillStyle=dimensionStyle??'#d6e9b8';c.fillText(text,width/2,48);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    sprite.position.copy(world(f, x, y, .4)); sprite.scale.set(dimensionStyle?width/512*25:25, 4.7, 1); sprite.userData.pick = pick; sprite.renderOrder = 10; group.add(sprite);return sprite;
}
function edgePoints(e,i) {
    if(e.kind==='ellipse')return outline(e);
    if(e.kind==='slot')return i===0?outline(e):outline(e).slice(0,33);
    const p=outline(e);return e.kind==='circle'||e.kind==='arc'||e.kind==='line'?p:[p[i],p[i+1]];
}
function edgesForSketch(sketch) {
    if(modelEdgeCache.has(sketch.id))return modelEdgeCache.get(sketch.id);
    const index=viewDocument.features.findIndex(f=>f.mode!=="chamfer"&&(f.sketchId===sketch.id||f.pathSketchId===sketch.id||f.sections?.some(s=>s.sketchId===sketch.id)));
    const prefix=index<0?viewDocument:{...viewDocument,features:viewDocument.features.slice(0,index)};
    const edges=modelEdges(prefix,sketch,prefix===viewDocument?solid:null);modelEdgeCache.set(sketch.id,edges);return edges;
}
function dimensionValue(entity,index){return index < -1?entity.modelDimensions.find(d=>d.index===index).distance:index===-1?entity.referenceOffset:entity.kind==='circle'?entity.radius*2:entity.kind==='arc'?entity.radius:entity.kind==='polygon'?2*entity.radius*Math.sin(Math.PI/entity.sides):entity.kind==='line'?Math.hypot(entity.width,entity.height):index%2===0?entity.width:entity.height;}
function layoutForDimension(sketch,entity,index,position=null) {
    return dimensionLayout(sketch,entity,index,position,index < -1?edgesForSketch(sketch):[]);
}
function dimensionLine(points,color,pick,frame,width) {
    const line=addLine(points,color,pick,frame,.3);line.material.colorWrite=false;
    const stroke=sketchStroke(points,frame,color,width);stroke.renderOrder=8;group.add(stroke);
}
function drawDimension(s,e,i,f,position=null) {
    const layout=layoutForDimension(s,e,i,position);if(!layout)return null;
    const pick={kind:'dimension',sketchId:s.id,profileId:e.id,edge:i};
    const start=group.children.length,color=layout.manual?0xffd993:0xb5dfff;
    for(const line of layout.extensions)dimensionLine(line,0x99c5e5,null,f,4.5);
    for(const line of [...layout.lines,...layout.arrows])dimensionLine(line,color,pick,f,6);
    const text=label(layout.text,...layout.position,f,pick,layout.manual?'#e8ce96':'#a5c6e0');
    text.userData.dimensionLabel=true;
    // All segments and the text belong to the same movable annotation.
    for(const object of group.children.slice(start)){object.userData.dimensionKey=`${s.id}/${e.id}/${i}`;object.userData.entityKey=`${s.id}/${e.id}`;object.material.depthTest=false;object.renderOrder=object===text?10:8;}
    return layout;
}
function clearDimension(sid,pid,edge) {
    const key=`${sid}/${pid}/${edge}`;
    for(const o of group.children.slice())if(o.userData.dimensionKey===key)destroy(o);
}
function pointOnFrame(event,frame) {
    rayAt(event);const hit=V(),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(frame.n,frame.o);
    if(Math.abs(ray.ray.direction.dot(frame.n))<.02||!ray.ray.intersectPlane(plane,hit))return null;
    const delta=hit.sub(frame.o);return new THREE.Vector2(delta.dot(frame.u),delta.dot(frame.v));
}
function drawSketchEntity(s,e,f) {
    const first=group.children.length,active=ui.editingId===s.id,selected=ui.profileId===e.id||dragging?.entity.id===e.id;
    if(active&&!e.construction&&!['line','arc'].includes(e.kind)) {
        const geometry=new THREE.ShapeGeometry(profileShape(e),48);geometry.applyMatrix4(frameMatrix(f));
        const fill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:selected?0x66d4ff:0x82bfe7,transparent:true,opacity:selected ? .13 : .065,side:THREE.DoubleSide,depthWrite:false,depthTest:false}));
        fill.userData.pick={kind:'profile',sketchId:s.id,profileId:e.id};fill.renderOrder=3;group.add(fill);
    }
    const borderColor=selected?0xffd276:active?0x8bdcff:0x63dcff;
    for(let i=0;i<edgeCount(e);i++){const line=addLine(edgePoints(e,i),borderColor,{kind:'edge',sketchId:s.id,profileId:e.id,edge:i},f,.18,e.construction);line.material.colorWrite=false;line.material.depthWrite=false;}
    const border=sketchStroke(outline(e),f,borderColor,active?(selected?7:6):(selected?5.5:4.5),e.construction);border.material.depthTest=!active;group.add(border);
    for(const i of displayEdges(e))drawDimension(s,e,i,f);
    if(e.referenceLineId)drawDimension(s,e,-1,f);
    for(const d of e.modelDimensions??[])drawDimension(s,e,d.index,f);
    if(active&&ui.tool==='select') {
        const points=handles(e),fixedAnchor=effectiveAnchor(e)!=='none'?anchor(e):null;
        if(fixedAnchor&&!points.some(h=>Math.hypot(h.point[0]-fixedAnchor[0],h.point[1]-fixedAnchor[1])<1e-5))points.push({point:fixedAnchor,handle:'fixed'});
        for(const locked of [false,true]) {
            const matching=points.filter(h=>!!(fixedAnchor&&Math.hypot(h.point[0]-fixedAnchor[0],h.point[1]-fixedAnchor[1])<1e-5)===locked);
            if(!matching.length)continue;
            for(const [size,color] of [[selected?13:11,0x0a1622],[selected?9:7,locked?0xffbd66:0xe7f6ff]]) {
                const geometry=new THREE.BufferGeometry().setFromPoints(matching.map(h=>world(f,...h.point,.3)));
                const markers=new THREE.Points(geometry,new THREE.PointsMaterial({color,size,sizeAttenuation:false,depthTest:false,depthWrite:false}));markers.renderOrder=9;markers.raycast=()=>{};group.add(markers);
            }
        }
    }
    for(const object of group.children.slice(first))object.userData.entityKey=`${s.id}/${e.id}`;
}
function clearSketchEntity(sid,pid) {
    const key=`${sid}/${pid}`;for(const object of group.children.slice())if(object.userData.entityKey===key)destroy(object);
}
function drawSketch(s) {
    const firstObject=group.children.length;
    const f=resolvePlane(viewDocument,s.plane);
    if(!ui.editingId)for(const region of sketchRegions(s)) {
        const geometry=new THREE.ShapeGeometry(regionShape(region));geometry.applyMatrix4(frameMatrix(f));
        const fill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x254b66,transparent:true,opacity:.075,side:THREE.DoubleSide,depthWrite:false,depthTest:!(ui.operation&&ui.featureMode==='loft'),polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
        fill.userData.pick={kind:'region',sketchId:s.id,regionKey:region.key};fill.renderOrder=3;group.add(fill);
        const highlight=new THREE.Group();highlight.userData.regionOutline=fill.userData.pick;highlight.visible=false;
        for(const loop of [region.outer,...region.holes]){
            const points=loop.points.map(p=>[p.x,p.y]);if(!points.length)continue;
            points.push(points[0]);const stroke=sketchStroke(points,f,0xb3efff,5);stroke.material.depthTest=!(ui.operation&&ui.featureMode==='loft');stroke.renderOrder=7;highlight.add(stroke);
        }
        group.add(highlight);
    }
    for(const e of s.entities)drawSketchEntity(s,e,f);
    if(ui.operation&&ui.featureMode==='loft')for(const object of group.children.slice(firstObject))object.traverse(child=>{if(child.material){for(const material of Array.isArray(child.material)?child.material:[child.material])material.depthTest=false;child.renderOrder=Math.max(child.renderOrder,3);}});
}
function sketchBorderAt(event,includeHandles=true) {
    const sketch=doc.sketches.find(s=>s.id===ui.editingId);if(!sketch)return null;
    camera.updateMatrixWorld(true);const rect=host.getBoundingClientRect(),mouse=new THREE.Vector2(event.clientX-rect.left,event.clientY-rect.top);
    const project=p=>{const v=world(currentFrame,...p).project(camera);return v.z < -1||v.z>1?null:new THREE.Vector2((v.x+1)*rect.width/2,(1-v.y)*rect.height/2);};
    let best=null,distance=10;
    if(includeHandles)for(const entity of sketch.entities)for(const h of handles(entity)) {
        const p=project(h.point),d=p?p.distanceTo(mouse):Infinity;
        if(d<distance){distance=d;best={entity,handle:h.handle,edge:['slot','ellipse'].includes(entity.kind)?(h.handle==='top'||h.handle==='bottom'?1:0):0};}
    }
    if(best)return best;
    distance=9;
    for(const entity of sketch.entities) {
        const points=outline(entity);
        for(let i=0;i<points.length-1;i++) {
            const a=project(points[i]),b=project(points[i+1]);if(!a||!b)continue;
            const v=b.clone().sub(a),length=v.lengthSq(),t=length?Math.max(0,Math.min(1,mouse.clone().sub(a).dot(v)/length)):0;
            const d=a.clone().addScaledVector(v,t).distanceTo(mouse);if(d>=distance)continue;
            let handle=radial(entity)?'radius':entity.kind==='line'?'body':['bottom','right','top','left'][i];
            if(['slot','ellipse'].includes(entity.kind)) {
                const p=slotToLocal(entity,points[i]),q=slotToLocal(entity,points[i+1]);
                handle=entity.kind==='ellipse'?(Math.abs((p[0]+q[0])/2-entity.x-entity.width/2)/entity.width>Math.abs((p[1]+q[1])/2-entity.y-entity.height/2)/entity.height?((p[0]+q[0])/2<entity.x+entity.width/2?'left':'right'):((p[1]+q[1])/2<entity.y+entity.height/2?'bottom':'top')):Math.abs(p[1]-q[1])<1e-7?(p[1]<entity.y+entity.height/2?'bottom':'top'):((p[0]+q[0])/2<entity.x+entity.width/2?'left':'right');
            }
            distance=d;best={entity,handle,edge:['rectangle','polygon'].includes(entity.kind)?i:entity.kind==='ellipse'?(handle==='top'||handle==='bottom'?1:0):entity.kind==='slot'?(handle==='top'||handle==='bottom'?1:0):0,distance:d};
        }
    }
    return best;
}
function dimensionPickAt(event) {
    const sketch=doc.sketches.find(s=>s.id===ui.editingId);if(!sketch)return null;
    const own=sketchBorderAt(event,false),rect=host.getBoundingClientRect();let model=null,best=10;
    const project=p=>{const v=world(currentFrame,...p).project(camera);return v.z < -1||v.z>1?null:new THREE.Vector2((v.x+1)*rect.width/2,(1-v.y)*rect.height/2);};
    const mouse=new THREE.Vector2(event.clientX-rect.left,event.clientY-rect.top);
    for(const edge of edgesForSketch(sketch)) {
        const a=project(edge.a),b=project(edge.b);if(!a||!b)continue;
        const d=b.clone().sub(a),length=d.lengthSq(),t=length?Math.max(0,Math.min(1,mouse.clone().sub(a).dot(d)/length)):0;
        const distance=a.clone().addScaledVector(d,t).distanceTo(mouse);
        if(distance<best){best=distance;model={kind:'model',edge};}
    }
    let source=null;
    if(own&&['circle','arc','ellipse'].includes(own.entity.kind))source={kind:'sketch',entityId:own.entity.id,edge:own.entity.kind==='ellipse'&&(own.handle==='top'||own.handle==='bottom')?1:0};
    else if(own){const edge=own.entity.kind==='slot'?(own.handle==='top'?2:own.handle==='bottom'?0:-1):own.edge;if(own.entity.kind==='slot'&&edge===-1)source={kind:'sketch',entityId:own.entity.id,edge:1,arc:true};else try{sketchLine(own.entity,edge);source={kind:'sketch',entityId:own.entity.id,edge};}catch{}}
    // Pick what is actually closest to the pointer, without forcing the second
    // click to become a model edge. Alt resolves coincident edges in its favor.
    if(event.altKey&&model)return model;
    return source&&(!model||own.distance<=best+.5)?source:model;

}
function dimensionSelectionPoints(selection) {
    if(selection.kind==='model')return [selection.edge.a,selection.edge.b];
    const sketch=doc.sketches.find(s=>s.id===ui.editingId),entity=sketch?.entities.find(e=>e.id===selection.entityId);
    if(!entity)return null;if(['circle','arc','ellipse'].includes(entity.kind)||selection.arc)return outline(entity);const line=sketchLine(entity,selection.edge);return [line.a,line.b];
}
function showDimensionHover(selection) {
    const key=selection?JSON.stringify(selection):'';if(key===dimensionHoverKey)return;
    destroy(dimensionHoverMesh);dimensionHoverMesh=null;dimensionHoverKey=key;
    const points=selection?dimensionSelectionPoints(selection):null;
    if(points){dimensionHoverMesh=sketchStroke(points,currentFrame,selection.kind==='model'?0x8effd0:0xffd475,8);dimensionHoverMesh.renderOrder=11;group.add(dimensionHoverMesh);}
}
function clearDimensionSelection() {requestRender();
    clearDimensionDraft();dimensionSelection=null;destroy(dimensionSelectionMesh);dimensionSelectionMesh=null;
    destroy(dimensionHoverMesh);dimensionHoverMesh=null;dimensionHoverKey='';if(host)host.dataset.dragHint='';
}
function clearDimensionDraft() {
    if(group)for(const object of group.children.slice())if(object.userData.dimensionPreview)destroy(object);
    dimensionDraft=null;
}
function previewDimension(event) {
    if(!dimensionSelection)return;
    const sketch=doc.sketches.find(s=>s.id===ui.editingId),position=pointOnFrame(event,currentFrame);if(!sketch||!position)return;
    const previous=dimensionDraft;clearDimensionDraft();
    let entity,index,pair=previous?.pair??null;
    if(pair){entity=structuredClone(sketch.entities.find(e=>e.id===pair.entityId));index=-999999;entity.modelDimensions=[...(entity.modelDimensions??[]),{...pair,index}];}
    else if(dimensionSelection.kind==='sketch'){entity=structuredClone(sketch.entities.find(e=>e.id===dimensionSelection.entityId));index=dimensionSelection.edge;if(entity.kind==='slot')index=dimensionSelection.arc?1:0;}
    else return;
    const start=group.children.length,layout=drawDimension(sketch,entity,index,currentFrame,[position.x,position.y]);
    for(const object of group.children.slice(start)){object.userData.dimensionPreview=true;object.userData.pick=null;object.userData.dimensionLabel=false;object.raycast=()=>{};}
    dimensionDraft={entity,index,pair,layout};
}
function chooseDimensionReference(selection,event) {
    const sketch=doc.sketches.find(s=>s.id===ui.editingId);if(!sketch)return;
    if(dimensionSelection&&dimensionDraft?.pair){clearDimensionSelection();}
    if(dimensionSelection) {
        const first=dimensionSelection;
        if(first.kind==='model'&&selection.kind==='model'){clearDimensionSelection();host.dataset.dragHint='实体之间不创建驱动标注，请重新选择草图边';return;}
        if(first.kind==='sketch'&&selection.kind==='sketch'&&first.entityId===selection.entityId&&first.edge===selection.edge){clearDimensionSelection();return;}
        const source=selection.kind==='sketch'?selection:first,entity=sketch.entities.find(e=>e.id===source.entityId);
        try {
            if(source.arc||first.arc||['circle','arc','ellipse'].includes(entity.kind))throw new Error('圆弧请选择单边直径标注；两边间距目前需要平行直线');
            const own=sketchLine(entity,source.edge);let reference,referenceEntity=null,referenceEdge=0;
            if(first.kind==='sketch'&&selection.kind==='sketch') {
                referenceEntity=sketch.entities.find(e=>e.id===first.entityId);referenceEdge=first.edge;
                const line=sketchLine(referenceEntity,referenceEdge),[nx,ny]=line.normal;reference={...line,constant:nx*line.a[0]+ny*line.a[1]};
            } else reference=(first.kind==='model'?first:selection).edge;
            const [nx,ny]=reference.normal;if(Math.abs(nx*own.tangent[0]+ny*own.tangent[1])>1e-5)throw new Error('当前仅支持平行直边间距，请点空白处取消后重新选边');
            const p=edgePoint(entity,source.edge),signed=p[0]*nx+p[1]*ny-reference.constant;
            clearDimensionDraft();dimensionDraft={pair:{entityId:entity.id,edge:source.edge,referenceEntityId:referenceEntity?.id??null,referenceEdge,referenceFace:reference.referenceFace??{},distance:Math.abs(signed),side:signed<0?-1:1}};
            previewDimension(event);host.dataset.dragHint='两边间距预览：点击放置并输入；右键或 Esc 重新选择';
        } catch(error){clearDimensionSelection();host.dataset.dragHint=error.message;}
        return;
    }
    clearDimensionSelection();dimensionSelection=selection;
    const points=dimensionSelectionPoints(selection);if(points){dimensionSelectionMesh=sketchStroke(points,currentFrame,0xffe2a1,9);dimensionSelectionMesh.renderOrder=11;group.add(dimensionSelectionMesh);}
    previewDimension(event);host.dataset.dragHint='选择第二条边，或在空白处单击放置单边尺寸；右键 / Esc 取消';
}
function placeDimension() {
    const draft=dimensionDraft,sketch=doc.sketches.find(s=>s.id===ui.editingId);
    if(!draft?.layout||!sketch){clearDimensionSelection();return;}
    const {entity,index,pair,layout}=draft;
    const value=pair?pair.distance:dimensionValue(entity,index);
    const args=[sketch.id,entity.id,index,pair,layout.position[0]-layout.base[0],layout.position[1]-layout.base[1]];
    clearDimensionSelection();openDimensionInput({sketchId:sketch.id,profileId:entity.id,edge:index},layout,value,args);
}
const dragCursors={locked:'not-allowed',move:'move',radius:'nwse-resize','resize-x':'ew-resize','resize-y':'ns-resize','resize-both':'nwse-resize',endpoint:'crosshair',rotate:'crosshair'};
function setDragFeedback(entity,handle,shift=false) {
    const mode=dragMode(entity,handle,shift);host.style.cursor=dragCursors[mode];
    const hints={locked:'锚点或尺寸约束限制：此处不可拖动',move:entity.referenceLineId?'拖动沿参考线移动':(entity.dimensionedEdges.length?'大小已约束：拖动移动位置':'拖动移动位置'),radius:'拖动调整半径，保持圆心',endpoint:'拖动调整端点',rotate:'长度固定：围绕锚点旋转','resize-x':'拖动调整宽度','resize-y':'拖动调整高度','resize-both':'拖动角点调整宽度和高度'};
    host.dataset.dragHint=hints[mode]+(entity.fixedPoint!=='none'&&mode.startsWith('resize')?' · 保持锚点':'');
}
function updateEntityDrag(event) {
    const drag=dragging,p=localPoint(event,true);if(!p)return;
    drag.proposed=dragEntity(drag.entity,drag.start,p,drag.handle,event.shiftKey);
    const sketch=structuredClone(drag.sketch);sketch.entities[sketch.entities.findIndex(e=>e.id===drag.entity.id)]=structuredClone(drag.proposed);
    let solved;
    try{solved=sketch.entities.some(hasRelations)?constrainSketch(sketch,edgesForSketch(sketch),drag.entity.id):new Map();}
    catch{solved=new Map();drag.proposed=structuredClone(drag.entity);host.dataset.dragHint='重合或尺寸关系限制了当前拖动';}
    drag.current=solved.get(drag.entity.id)??drag.proposed;
    const previews=new Map(solved);previews.set(drag.entity.id,drag.current);
    for(const entity of previews.values()){const target=sketch.entities.find(e=>e.id===entity.id);if(target)Object.assign(target,entity);}
    for(const id of drag.previewIds??[])if(!previews.has(id)){const original=drag.sketch.entities.find(e=>e.id===id);if(original){clearSketchEntity(drag.sketch.id,id);drawSketchEntity(drag.sketch,original,currentFrame);}}
    for(const entity of previews.values()){clearSketchEntity(drag.sketch.id,entity.id);drawSketchEntity(sketch,entity,currentFrame);}
    drag.previewIds=new Set(previews.keys());setDragFeedback(drag.entity,drag.handle,event.shiftKey);
}
// Display flags and appearance never affect constraints or solid topology.
function preparationKey(document){return JSON.stringify([document.features,document.sketches.map(({name,finished,hidden,...sketch})=>({...sketch,entities:sketch.entities.map(({dimensionPlacements,...entity})=>entity)}))]);}
let acceptedPreparationKey=null,acceptedPhysicalPreparationKey=null;
const solidDrawCache=new Map();
function bodyAppearance(document,body){
    const direct=document.materials?.[body.id];if(direct)return direct;
    for(const id of [...body.featureIds].reverse()){const source=document.features.find(f=>f.id===id)?.appearanceSourceId;if(source&&document.materials?.[source])return document.materials[source];}
    return body.featureIds.map(id=>document.materials?.[id]).find(Boolean);
}
function solidDrawData(document,polygons){
    let data=solidDrawCache.get(polygons);
    if(data){data.bodies=bodyInfo(document,polygons);solidDrawCache.delete(polygons);solidDrawCache.set(polygons,data);return data;}
    const bodies=bodyInfo(document,polygons),indices=new Map();bodies.forEach((body,index)=>body.polygons.forEach(p=>indices.set(p,index)));
    data={...solidGeometry(polygons,indices),bodies};solidDrawCache.set(polygons,data);return data;
}
function trimSolidDrawCache(){
    let count=0;for(const data of solidDrawCache.values())count+=data.geometry.attributes.position.count;
    for(const [polygons,data] of solidDrawCache){if(solidDrawCache.size<=3&&count<=1500000)break;if(polygons===solid)continue;count-=data.geometry.attributes.position.count;data.geometry.dispose();solidDrawCache.delete(polygons);}
}
export async function prepareLoadedDocument(candidate){
    const result=await geometryPrepare.request(candidate,null,null,null,cacheKey,true);
    importPreparedDocument(candidate,result);
    return true;
}
function importPreparedDocument(candidate,result){
    if(result.visualHistory)importVisualEdgeHistory(result.visualHistory);
    if(!result.state)return;
    const polygons=importSolidState(candidate,result.state),draw=result.draw;if(!draw)return;
    const geometry=new THREE.BufferGeometry();
    for(const [name,size] of [['position',3],['normal',3],['uv',2],['tangent',4]])geometry.setAttribute(name,new THREE.BufferAttribute(draw[name],size));
    for(const item of draw.groups)geometry.addGroup(item.start,item.count,item.materialIndex);
    geometry.computeBoundingSphere();
    const ordered=Array.from(draw.order,index=>polygons[index]),tags=Array.from(draw.tagSources,index=>polygons[index].tag);
    solidDrawCache.set(polygons,{geometry,tags,polygons:ordered,bodies:bodyInfo(candidate,polygons)});
}
export async function prepareDocument(candidate,preferredId=null,intent=null){
    if(!intent&&preparationKey(candidate)===acceptedPreparationKey)return [];
    if(!intent&&preparationKey({...candidate,features:candidate.features.filter(f=>!(f.mode==='chamfer'&&f.visualOnly))})===acceptedPhysicalPreparationKey){
        buildSolid(candidate);validateSupportPlanes(candidate);retainDocumentSolid(candidate);return [];
    }
    if(candidate.features.length){
        let seed=null;
        if(lastFullEdgeState&&candidate.features.at(-1)?.mode==='chamfer'){
            const actual=candidate.features.at(-1),preview={...actual,id:'feature-preview'},comparison={...candidate,features:[...candidate.features.slice(0,-1),preview]};
            if(documentGeometry(comparison)===lastFullEdgeState.key){
                const rename=value=>{if(typeof value==='string')return value==='feature-preview'||value.startsWith('feature-preview~')?actual.id+value.slice('feature-preview'.length):value;if(Array.isArray(value))return value.map(rename);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rename(v)]));return value;};
                seed=rename(lastFullEdgeState);seed.key=documentGeometry(candidate);
            }
        }
        const result=await geometryPrepare.request(candidate,preferredId,intent,seed,cacheKey);
        for(const change of result.adjustments){const entity=candidate.sketches.find(s=>s.id===change.sketchId)?.entities.find(e=>e.id===change.entityId);if(entity)Object.assign(entity,{x:change.x,y:change.y,width:change.width,height:change.height,radius:change.radius});}
        importPreparedDocument(candidate,result);return result.adjustments;
    }
    const adjustments=applyModelDimensions(candidate,false,preferredId,intent);
    validateGeometry(candidate,true);return adjustments;
}
export function validateGeometry(candidate,constraintsValidated=false) {
    // This check also prevents deleting material under an existing support plane unnoticed.
    if(!constraintsValidated)applyModelDimensions(candidate,true);
    const built = buildSolid(candidate);
    validateSupportPlanes(candidate);
    for (const s of candidate.sketches) sketchRegions(s);
    retainDocumentSolid(candidate);return built.length;
}
export function update(document,selection) {requestRender();
    const previous={doc,ui,group,solid,solidMesh,featurePreviewMesh,cacheKey,renderedKey,currentFrame,viewDocument,previewInfo,modelEdgeCache,floorVisible:floor.visible,shadowVisible:shadowFloor.visible};
    try {
        const result=measure('scene-update',()=>updateScene(document,selection),{polygons:solid.length,editing:!!selection.editingId});
        if(group!==previous.group)destroy(previous.group);
        surfaceStudio.trim([liveFillet,visualTreatment].filter(Boolean).flatMap(effect=>Array.isArray(effect.original)?effect.original:[effect.original]));
        trimSolidDrawCache();acceptedPreparationKey=preparationKey(document);acceptedPhysicalPreparationKey=preparationKey({...document,features:document.features.filter(f=>!(f.mode==='chamfer'&&f.visualOnly))});
        return result;
    } catch(error) {
        if(group!==previous.group)destroy(group);
        ({doc,ui,group,solid,solidMesh,featurePreviewMesh,cacheKey,renderedKey,currentFrame,viewDocument,previewInfo,modelEdgeCache}=previous);
        floor.visible=previous.floorVisible;shadowFloor.visible=previous.shadowVisible;
        try{updateFloor();}catch{}
        if(controls)controls.enabled=!dimensionEditor;
        recordDiagnostic('scene-update',error);throw error;
    }
}
const visualEdgeDataCache=new WeakMap();
function visualEdgeData(document,polygons){
    const features=document.features.filter(f=>f.mode==='chamfer'&&f.visualOnly),key=JSON.stringify(features),cached=visualEdgeDataCache.get(polygons);
    if(cached?.key===key)return cached;
    const entries=[],catalog=[],consumed=new Set(),boundaryKey=edge=>JSON.stringify([edge.faceA.featureId,edge.faceA.face,edge.segment]);
    for(const feature of features){
        const edges=[],references=feature.chamferEdges?.length?feature.chamferEdges:[feature.chamferEdge];
        references.forEach((reference,index)=>{
            try{
                const generated=reference?.faceA?.face?.startsWith('visual-cap|');
                const resolved=generated?catalog.filter(edge=>edge.faceA.featureId===reference.faceA.featureId&&edge.faceA.face===reference.faceA.face&&edge.segment===reference.segment):visualEdgeDescendants(document,feature,reference,polygons);
                for(const edge of resolved){if(generated)consumed.add(boundaryKey(edge));edges.push({...edge,visualFeature:feature,visualReferenceIndex:index});}
            }catch(error){recordDiagnostic('visual-edge-history',error);}
        });
        entries.push(...edges);catalog.push(...visualCapEdges(feature,edges,polygons));
    }
    const data={key,entries,catalog:catalog.filter(edge=>!consumed.has(boundaryKey(edge)))};visualEdgeDataCache.set(polygons,data);return data;
}
function visualEdgeEntries(document,polygons){return visualEdgeData(document,polygons).entries;}
function resolveDisplayedEdge(document,polygons,reference){
    if(reference?.faceA?.face?.startsWith('visual-cap|')){
        const edge=visualEdgeData(document,polygons).catalog.find(edge=>edge.faceA.featureId===reference.faceA.featureId&&edge.faceA.face===reference.faceA.face&&edge.segment===reference.segment);
        if(!edge)throw new Error('所选圆角边界已改变，请重新选择。');return edge;
    }
    const edge=resolveChamferEdge(polygons,reference),trimmed=trimDisplayEdges([edge],visualEdgeData(document,polygons).records);
    return trimmed.length===1?trimmed[0]:edge;
}
function uniqueVisualEdges(edges){const result=new Map();for(const edge of edges){const faces=[edge.faceA,edge.faceB].map(f=>f.featureId+'/'+f.face).sort();result.set(JSON.stringify([edge.kind??'line',faces,edge.segment]),edge);}return [...result.values()];}
function liveConfigurationKey(document,selection){return JSON.stringify({geometry:documentGeometry(document),selection:{...selection,distance:0,featureDraft:{...selection.featureDraft,depth:0}}});}
function updateScene(document, selection) {
    if(ui?.pickingSketchPlane&&!selection.pickingSketchPlane&&!selection.editingId)sketchCreationFocus=null;
    if(ui?.editingId!==selection.editingId)interruptCameraTransition();
    if(ui?.editingId&&!selection.editingId)setCameraProjection(false);

    if(dimensionEditor&&!dimensionEditor.saving) {
        const editor=dimensionEditor,sketch=document.sketches.find(s=>s.id===editor.pick.sketchId),entity=sketch?.entities.find(e=>e.id===editor.pick.profileId);
        if(!entity||sketch.hidden||dimensionSourceKey(entity)!==editor.sourceKey||selection.operation||selection.pickingSketchPlane||(selection.editingId&&selection.editingId!==editor.pick.sketchId))closeDimensionEditor();
    }
    const viewKey=JSON.stringify({document, ...selection, regionKeys: selection.operation ? selection.regionKeys : undefined});
    if(viewKey===renderedKey) {
        doc=document;ui=selection;ui.regionKeys??=[];paintRegions();
        const chosen=doc.sketches.find(s=>s.id===ui.sketchId);
        return sceneInfo(chosen);
    }
    if(doc&&ui&&solidMesh&&!liveFillet&&!visualTreatment&&!ui.operation&&JSON.stringify(ui)===JSON.stringify({...selection,regionKeys:selection.regionKeys??[]})&&
        JSON.stringify({...doc,materials:null,environment:null,name:null})===JSON.stringify({...document,materials:null,environment:null,name:null})){
        doc=document;ui=selection;viewDocument=ui.editingId?viewDocument:doc;
        surfaceStudio.environment(doc.environment??'studio');
        solidMesh.material=bodyInfo(doc,solid).map(body=>surfaceStudio.material(bodyAppearance(doc,body),!!ui.editingId));
        renderedKey=viewKey;return sceneInfo(doc.sketches.find(s=>s.id===ui.sketchId));
    }
    if(liveFillet&&liveConfigurationKey(document,selection)===liveFilletKey){
        doc=document;ui=selection;liveFillet.set(ui.distance);previewInfo={valid:true,min:ui.distance,max:ui.distance,message:(liveFillet?.bevel?'D ':'R ')+ui.distance+' mm'};renderedKey=viewKey;configureEdgeProfile();requestRender();return sceneInfo(doc.sketches.find(s=>s.id===ui.sketchId));
    }
    // A server acknowledgement of the same operation must not tear down its
    // mesh, GPU motion or worker. Only the dimension changed.
    if(edgeMotion&&doc&&ui&&liveConfigurationKey(document,selection)===liveConfigurationKey(doc,ui)&&applyFilletMotion(selection.distance)){
        doc=document;ui=selection;ui.regionKeys??=[];pendingEdgeRadius=null;
        previewInfo={valid:true,min:ui.distance,max:ui.distance,message:'D '+ui.distance+' mm'};
        renderedKey=viewKey;configureEdgeProfile();requestRender();return sceneInfo(doc.sketches.find(s=>s.id===ui.sketchId));
    }
    liveFillet?.dispose();liveFillet=null;liveFilletKey=null;visualTreatment?.dispose();visualTreatment=null;
    debugWireframe?.clear();
    edgePreview?.dispose();pendingEdgeRadius=null;
    doc = document; ui = selection; ui.regionKeys ??= [];chamferHover=null;chamferEdges=[];axisEdges=[];axisHover=null;sweepGuide=null;sweepMoving=null;sweepPlaying=null; cancelDraw();clearDimensionSelection();modelEdgeCache=new Map(); clearTargetHover();group = new THREE.Group(); scene.add(group); solidMesh = null;featurePreviewMesh=null;
    floor.visible=!ui.pickingSketchPlane;shadowFloor.visible=!ui.pickingSketchPlane;
    for(const id of regionCache.keys())if(!doc.sketches.some(s=>s.id===id))regionCache.delete(id);
    const rollback=ui.editingFeatureId?doc.features.findIndex(f=>f.id===ui.editingFeatureId):ui.editingId?doc.features.findIndex(f=>f.mode!=="chamfer"&&featureDependsOnSketch(doc,f,ui.editingId)):-1;
    viewDocument=rollback>=0?{...doc,features:doc.features.slice(0,rollback)}:doc;
    surfaceStudio.environment(doc.environment??'studio');
    const geometryKey = documentGeometry(viewDocument);
    if (geometryKey !== cacheKey) { solid = buildSolid(viewDocument); cacheKey = geometryKey; updateFloor(); }
    if (solid.length) {
        const {geometry,tags,polygons,bodies}=solidDrawData(doc,solid),materials=bodies.map(body=>surfaceStudio.material(bodyAppearance(doc,body),!!ui.editingId));
        solidMesh=new THREE.Mesh(geometry,materials);solidMesh.userData.sharedMaterial=true;solidMesh.userData.sharedGeometry=true;solidMesh.userData.tags=tags;attachSolidPicking(solidMesh,polygons);solidMesh.castShadow=true;solidMesh.receiveShadow=true;solidMesh.layers.enable(1);group.add(solidMesh);
        const selectedBody=bodies.find(body=>body.id===ui.selectedBodyId);if(selectedBody&&!ui.operation&&!ui.editingId&&!viewDocument.features.some(f=>f.mode==='chamfer'&&f.visualOnly)){const edges=solidEdgeOptions(selectedBody.polygons,false),geometry=new THREE.BufferGeometry().setFromPoints(edges.flatMap(edge=>[edge.a,edge.b]));const highlight=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xd9bd82,transparent:true,opacity:.72,depthWrite:false}));highlight.raycast=()=>{};highlight.renderOrder=5;group.add(highlight);}
        if (ui.support?.featureId && !(ui.operation&&ui.featureMode==="chamfer")) {
            const frame=resolvePlane(viewDocument,ui.support),faceBody=selectedBody?.polygons.some(p=>p.tag.featureId===ui.support.featureId&&p.tag.face===ui.support.face)?selectedBody:bodies.find(body=>body.polygons.some(p=>p.tag.featureId===ui.support.featureId&&p.tag.face===ui.support.face)),scope=faceBody?.polygons??solid;
            let shape=null;
            if(ui.selectedFacePoint?.length===3){try{const p=V(...ui.selectedFacePoint).sub(frame.o);shape=loftFaceSection(viewDocument,ui.support,p.dot(frame.u),p.dot(frame.v),scope).shape;}catch(error){recordDiagnostic('face-highlight',error);}}
            const selectedFaces=scope.filter(p=>p.tag.featureId===ui.support.featureId&&p.tag.face===ui.support.face);
            const geometry=shape?new THREE.ShapeGeometry(shape):solidGeometry(selectedFaces).geometry;if(shape)geometry.applyMatrix4(frameMatrix(frame));
            const overlay=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x73bde8,side:THREE.DoubleSide,transparent:true,opacity:ui.editingId ? .07 : .18,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));overlay.userData.edgeClipOverlay=true;overlay.raycast=()=>{};overlay.renderOrder=3;group.add(overlay);
            if(shape&&!viewDocument.features.some(f=>f.mode==='chamfer'&&f.visualOnly))for(const path of [shape,...shape.holes]){const points=path.getPoints(64).map(p=>[p.x,p.y]);if(points.length){points.push(points[0]);const border=sketchStroke(points,frame,0x9cdeff,5);border.raycast=()=>{};border.renderOrder=6;group.add(border);}}

        }
        if(ui.operation && ui.endCondition==='upToFace' && ui.targetFace?.featureId) {
            const polygons=solid.filter(p=>p.tag.featureId===ui.targetFace.featureId&&p.tag.face===ui.targetFace.face);
            const overlay=new THREE.Mesh(solidGeometry(polygons).geometry,new THREE.MeshBasicMaterial({color:0x7bbffc,transparent:true,opacity:.36,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));group.add(overlay);
        }
    }
    const active = doc.sketches.find(s => s.id === ui.editingId);
    const chosen = doc.sketches.find(s => s.id === ui.sketchId);
    const support = active?.plane ?? chosen?.plane ?? ui.support;
    currentFrame = resolvePlane(viewDocument, support);
    extendedSketch?.configure(active?.id,ui.tool,active?.entities??[]);
    rebuildSnapCandidates(active);
    if(ui.pickingSketchPlane) drawReferencePlanes();
    if (ui.support && !ui.support.featureId && !active && !chosen && !ui.pickingSketchPlane) {
        const geometry = new THREE.PlaneGeometry(100, 100); geometry.applyMatrix4(frameMatrix(currentFrame));
        const planeMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .05, side: THREE.DoubleSide, depthWrite: false })); group.add(planeMesh);
    }
    if(active?.plane.sourceSketchId){
        const source=doc.sketches.find(s=>s.id===active.plane.sourceSketchId);
        if(source){const basis=resolvePlane(viewDocument,source.plane);for(const entity of source.entities.filter(e=>!e.construction)){const reference=sketchStroke(outline(entity),basis,0x77a7b9,4);reference.material.depthTest=false;reference.renderOrder=2;group.add(reference);}}
    }
    if (active) {drawSketch(active);if(ui.tool==='dimension')for(const edge of edgesForSketch(active))group.add(sketchStroke([edge.a,edge.b],currentFrame,0x759ab5,4));}
    else if(!ui.pickingSketchPlane&&!(ui.operation&&ui.featureMode==="chamfer")) for (const s of doc.sketches) {
        const unused = !doc.features.some(f=>f.mode!=="chamfer"&&(f.sketchId===s.id||f.pathSketchId===s.id||f.sections?.some(section=>section.sketchId===s.id)));
        if(s.finished&&(!s.hidden||ui.operation&&ui.featureMode==='loft'&&(s.id===ui.sketchId||ui.featureDraft.sections.some(section=>section.sketchId===s.id))||ui.operation&&ui.featureMode==='sweep'&&(s.id===ui.sketchId||s.id===ui.featureDraft.pathSketchId))&&(unused||s.id===ui.sketchId||ui.operation&&ui.featureMode==='loft'||ui.operation&&ui.featureMode==='revolve'||ui.operation&&ui.featureMode==='sweep'&&(s.id===ui.featureDraft.pathSketchId||ui.pickingSweepProfile||ui.pickingSweepPath))&&(!s.plane.featureId||viewDocument.features.some(f=>f.id===s.plane.featureId)))drawSketch(s);
    }
    if(ui.operation&&ui.featureMode==='loft')for(const section of ui.featureDraft.sections??[]){
        if(!section.face)continue;
        try{const selected=loftFaceSection(viewDocument,section.face,section.faceX,section.faceY,solid),basis=resolvePlane(viewDocument,section.face),geometry=new THREE.ShapeGeometry(selected.shape);geometry.applyMatrix4(frameMatrix(basis));const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x49cf9a,transparent:true,opacity:.38,side:THREE.DoubleSide,depthWrite:false,depthTest:false}));mesh.renderOrder=4;group.add(mesh);}catch(error){recordDiagnostic('loft-face',error);}
    }
    previewInfo={valid:false,message:ui.operation?'请选择封闭区域':''};
    if(ui.operation&&ui.featureMode==='loft'&&!ui.featureDraft.sections.length)previewInfo={valid:false,message:'请在三维视口选择下一个闭合草图区域或实体平面截面。'};
    if(ui.operation&&ui.featureMode==='sweep'&&!chosen)previewInfo={valid:false,message:'请选择闭合轮廓作为截面；直线或曲线作为路径，两者分别选择。'};
    if(ui.operation&&ui.featureMode==='revolve'&&!ui.rotationAxisSelected)previewInfo={valid:false,message:'请选择旋转轴：可直接点击草图直边、参考线、实体直边，或选择 X / Y 轴。'};
    if(ui.operation&&(chosen||ui.featureMode==="chamfer")&&(ui.regionKeys.length||ui.featureMode==="chamfer"||ui.featureMode==="sweep"&&ui.featureDraft?.thinWall)&&(ui.featureMode!=='revolve'||ui.rotationAxisSelected)&&(ui.featureMode!=='loft'||ui.featureDraft.sections.length>0)) {
        const ghost={...ui.featureDraft,id:'feature-preview',kind:ui.operation,sketchId:chosen?.id??ui.featureDraft.sketchId,regionKeys:ui.regionKeys,depth:ui.distance,endCondition:ui.endCondition,reversed:ui.reversed,targetFace:ui.targetFace};
        try {
            if(ui.featureMode==='chamfer'){
                const references=ghost.chamferEdges?.length?ghost.chamferEdges:ghost.chamferEdge?[ghost.chamferEdge]:[];
                if(references.length){
                    if(ghost.topologyBevel){
                        edgeMotion=null;lastFullEdgeState=null;
                        previewInfo={valid:false,message:'正在建立实体倒角拓扑'};
                        edgePreview.request(viewDocument,ghost,exportSolidState(viewDocument,true));
                    }else{
                    const edges=references.map(reference=>resolveDisplayedEdge(viewDocument,solid,reference));
                    edgeMotion=null;lastFullEdgeState=null;liveFillet=new LiveFillet(solidMesh,group,uniqueVisualEdges([...visualEdgeEntries(viewDocument,solid),...edges]),ui.distance,host,ghost,solid);liveFilletKey=liveConfigurationKey(doc,ui);
                    previewInfo={valid:true,min:ui.distance,max:ui.distance,message:(liveFillet?.bevel?'D ':'R ')+ui.distance+' mm'};
                    }
                }else previewInfo={valid:false,message:'请选择圆角边界'};
            }else{
            previewInfo=featureEndInfo(viewDocument,ghost);
            const polygons=featurePolygons(viewDocument,ghost);
            const finalSolid=ui.operation!=="cut"||ui.featureMode!=="extrude"?buildSolid({...viewDocument,features:[...viewDocument.features,ghost]}):null;
            const mesh=new THREE.Mesh(solidGeometry(polygons).geometry,new THREE.MeshBasicMaterial({color:ui.operation==='cut'?0xf08c82:accent,transparent:true,opacity:.33,side:THREE.DoubleSide,depthWrite:false}));
            mesh.layers.enable(1);group.add(mesh);featurePreviewMesh=mesh;mesh.userData.depth=ui.distance*(ui.reversed?-1:1);if(ui.featureMode==='sweep')try{configureSweepGuide(ghost);}catch(error){recordDiagnostic('sweep-guide',error);}
            }
        } catch(error) {previewInfo={valid:false,message:error.message};}
    }
    if(ui.operation&&ui.featureMode==='revolve'){axisEdges=solidEdgeOptions(solid,false);if(ui.rotationAxisSelected&&chosen)drawRotationAxis(chosen);}
    if(solidMesh&&!liveFillet){const entries=uniqueVisualEdges(visualEdgeEntries(viewDocument,solid));if(entries.length)visualTreatment=new LiveFillet(solidMesh,group,entries,.1,host,{visualPersistent:true},solid);}
    const displayed=visualEdgeData(viewDocument,solid);displayed.records=(liveFillet??visualTreatment)?.records.filter(row=>row[36]>=0)??[];
    if(ui.operation&&ui.featureMode==='chamfer'){
        const visual=displayed;
        chamferEdges=[...trimDisplayEdges(edgeTreatmentOptions(solid),visual.records),...visual.catalog];const references=ui.featureDraft?.chamferEdges?.length?ui.featureDraft.chamferEdges:[ui.featureDraft?.chamferEdge];
        const matches=(a,b)=>a?.featureId===b?.featureId&&a?.face===b?.face;
        for(const reference of references){const edge=chamferEdges.find(edge=>(edge.kind??'line')===(reference?.kind??'line')&&edge.segment===reference?.segment&&(matches(edge.faceA,reference.faceA)&&matches(edge.faceB,reference.faceB)||matches(edge.faceA,reference.faceB)&&matches(edge.faceB,reference.faceA)));if(edge&&!liveFillet)group.add(chamferStroke(edge));}
    }
    configureFeatureDepth(chosen);configureEdgeProfile();
    controls.enabled=!dimensionEditor&&!depthGizmo?.drag;configureControls();
    host.style.cursor = ui.pickingTarget?'crosshair':active && ['rectangle','centerRectangle','ellipse','circle','slot','line','referenceLine','circle3','arc','polygon','polyline'].includes(ui.tool) ? 'crosshair' : 'default';
    renderer.shadowMap.needsUpdate=true;
    renderedKey = viewKey;
    paintRegions();
    syncDebugWireframe();
    return sceneInfo(chosen);
}
function configureEdgeProfile(){
    if(!edgeProfile)return;
    if(!ui.operation||ui.featureMode!=='chamfer'||!ui.featureDraft.chamferEdges?.length){edgeProfile.configure(null);return;}
    const reference=ui.featureDraft.chamferEdges[0],matches=(a,b)=>a?.featureId===b?.featureId&&a?.face===b?.face;
    const edge=chamferEdges.find(edge=>(edge.kind??'line')===(reference.kind??'line')&&edge.segment===reference.segment&&(matches(edge.faceA,reference.faceA)&&matches(edge.faceB,reference.faceB)||matches(edge.faceA,reference.faceB)&&matches(edge.faceB,reference.faceA)));
    if(!edge){edgeProfile.configure(null);return;}const theta=Math.PI-Math.acos(THREE.MathUtils.clamp(edge.normalA.dot(edge.normalB),-1,1));
    edgeProfile.configure({key:JSON.stringify([ui.editingFeatureId??null,ui.featureDraft.chamferEdges]),value:ui.distance,valid:previewInfo.valid,theta,bevel:ui.featureDraft.edgeTreatment==='chamfer',ratio:Math.tan((ui.featureDraft.chamferAngle??45)*Math.PI/180)});
}
function previewEdgeRadius(value){
    if(!ui?.operation||ui.featureMode!=='chamfer'||(ui.featureDraft.edgeTreatment!=='fillet'&&!ui.featureDraft.topologyBevel))return;
    const feature={...ui.featureDraft,id:'feature-preview',kind:'cut',depth:value};
    if(!feature.topologyBevel)feature.previewSegments=8;
    edgePreview?.request(viewDocument,feature);
}
function showEdgeRadiusPreview(data){
    if(!ui?.operation||ui.featureMode!=='chamfer'||!solidMesh||!group)return;
    const original=bodyInfo(doc,solid),materials=data.bodies.map(body=>{let index=original.findIndex(source=>source.id===body.id);if(index<0)index=original.findIndex(source=>source.featureIds.some(id=>body.featureIds.includes(id)));return solidMesh.material[Math.max(0,index)];});
    const cpuMotion=data.motion&&!data.feature.topologyBevel;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(cpuMotion?data.position.slice():data.position,3));geometry.setAttribute('normal',new THREE.BufferAttribute(cpuMotion?data.normal.slice():data.normal,3));geometry.setAttribute('uv',new THREE.BufferAttribute(cpuMotion?data.uv.slice():data.uv,2));
    if(data.tangent)geometry.setAttribute('tangent',new THREE.BufferAttribute(data.tangent,4));
    for(const item of data.groups)geometry.addGroup(item.start,item.count,item.materialIndex);geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,materials);mesh.userData.sharedMaterial=true;mesh.layers.enable(1);mesh.castShadow=true;mesh.receiveShadow=true;mesh.raycast=()=>{};
    const gpu=data.feature.topologyBevel&&data.motion?installEdgeMotionGpu(mesh,data.motion):null;
    debugWireframe?.clear();destroy(featurePreviewMesh);featurePreviewMesh=mesh;edgeMotion=data.motion?{data,mesh,gpu,currentRadius:data.feature.depth}:null;group.add(mesh);solidMesh.visible=false;edgeProfile?.error('');if(!data.feature.previewSegments){lastFullEdgeState=data.state;publishEdgePreview(data.feature,true,data.feature.topologyBevel?'实体倒角 · 实际 D '+Number(data.actualDistance.toFixed(4))+' mm':'预览已完成');}syncDebugWireframe();
    const current=edgeProfile?.value;if(Number.isFinite(current)&&current!==data.feature.depth){if(!applyFilletMotion(current)&&edgeProfile?.drag)pendingEdgeRadius={value:current,key:edgeProfile.config?.key};}
    requestRender();
}
function applyFilletMotion(value){
    const session=edgeMotion,motion=session?.data.motion;if(!session||session.mesh!==featurePreviewMesh||!motion||value<motion.min||value>motion.max)return false;
    if(session.gpu){pendingEdgeRadius=null;session.gpu.set(value);session.currentRadius=value;requestRender();return true;}
    const {geometry}=session.mesh,position=geometry.attributes.position.array,normal=geometry.attributes.normal.array,uv=geometry.attributes.uv.array,delta=value-motion.radius;
    for(let i=0;i<position.length;i++)position[i]=session.data.position[i]+motion.movement[i]*delta;
    for(let i=0;i<uv.length;i++)uv[i]=session.data.uv[i]+motion.uvMovement[i]*delta;
    for(let vertex=0;vertex<position.length/3;vertex++){
        const i=vertex*3,k=vertex*9,m=motion.normalMotion;if(!Number.isFinite(m[k]))continue;
        let x=position[i]-m[k]-m[k+6]*delta,y=position[i+1]-m[k+1]-m[k+7]*delta,z=position[i+2]-m[k+2]-m[k+8]*delta;const along=x*m[k+3]+y*m[k+4]+z*m[k+5];x-=along*m[k+3];y-=along*m[k+4];z-=along*m[k+5];const length=Math.hypot(x,y,z)||1,sign=x*session.data.normal[i]+y*session.data.normal[i+1]+z*session.data.normal[i+2]<0?-1:1;normal[i]=x/length*sign;normal[i+1]=y/length*sign;normal[i+2]=z/length*sign;
    }
    geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;geometry.attributes.uv.needsUpdate=true;geometry.boundingSphere=null;session.mesh.frustumCulled=false;session.currentRadius=value;requestRender();return true;
}
function cacheFilletMotionState(value){
    if(!applyFilletMotion(value))return false;
    const {data}=edgeMotion,motion=data.motion,delta=value-motion.radius,state=structuredClone(data.state);
    state.solid.forEach((polygon,index)=>{polygon.vertices.forEach((point,j)=>{for(let axis=0;axis<3;axis++)point.v[axis]+=motion.vertices[index][j][axis]*delta;});const speed=motion.centers[index];if(speed&&polygon.tag.smooth?.center)for(let axis=0;axis<3;axis++)polygon.tag.smooth.center.v[axis]+=speed[axis]*delta;});
    const feature={...ui.featureDraft,id:'feature-preview',kind:'cut',depth:value};state.key=documentGeometry({...viewDocument,features:[...viewDocument.features,feature]});lastFullEdgeState=state;return true;
}
function publishEdgePreview(feature,valid,message){
    if(!ui?.operation||ui.featureMode!=='chamfer'||ui.distance!==feature.depth||ui.featureDraft.edgeTreatment!==feature.edgeTreatment)return;
    previewInfo={valid,min:feature.depth,max:feature.depth,message};
    if(edgeProfile?.config){edgeProfile.config.valid=valid;edgeProfile.unblock();}
    bridge.invokeMethodAsync('UpdateEdgePreview',ui.editingFeatureId??null,feature.chamferEdges??[],feature.depth,feature.edgeTreatment,feature.chamferAngle??45,valid,message).catch(error=>recordDiagnostic('edge-preview-state',error));
}
async function commitEdgeRadius(value,key){
    if(liveFillet){
        if(!ui?.operation||JSON.stringify([ui.editingFeatureId??null,ui.featureDraft.chamferEdges])!==key)return '特征已改变，请重新选择圆角';
        try{liveFillet.set(value);}catch(error){return error.message;}
        ui.distance=value;ui.featureDraft.depth=value;previewInfo={valid:true,min:value,max:value,message:(liveFillet?.bevel?'D ':'R ')+value+' mm'};
        if(edgeProfile.config){edgeProfile.config.value=value;edgeProfile.config.valid=true;}
        renderer.shadowMap.needsUpdate=true;requestRender();return await bridge.invokeMethodAsync('SetEdgeRadius',ui.editingFeatureId??null,ui.featureDraft.chamferEdges,value,true);
    }
    pendingEdgeRadius=null;edgePreview?.invalidate();if(!ui?.operation||ui.featureMode!=='chamfer'||JSON.stringify([ui.editingFeatureId??null,ui.featureDraft.chamferEdges])!==key)return '特征已改变，请重新选择圆角';
    const immediate=cacheFilletMotionState(value);
    const message=await bridge.invokeMethodAsync('SetEdgeRadius',ui.editingFeatureId??null,ui.featureDraft.chamferEdges,value,false);
    if(!message&&ui?.operation&&ui.featureMode==='chamfer'&&JSON.stringify([ui.editingFeatureId??null,ui.featureDraft.chamferEdges])===key){
        const feature={...ui.featureDraft,id:'feature-preview',kind:'cut',depth:value};if(immediate&&cacheFilletMotionState(value))publishEdgePreview(feature,true,'');else{publishEdgePreview(feature,false,'当前半径需要重新构建圆角连接');edgePreview.request(viewDocument,feature);}
    }
    return message;
}
function featureDepthKey(){return JSON.stringify([ui.sketchId,ui.operation,ui.editingFeatureId??null,ui.regionKeys,ui.endCondition,!!ui.reversed]);}
function configureFeatureDepth(sketch){
    if(!depthGizmo)return;
    if(!ui.operation||ui.featureMode!=='extrude'||ui.endCondition!=='blind'||ui.pickingTarget||!sketch||!featurePreviewMesh){depthGizmo.hide(ui.featureMode==='extrude'&&ui.operation?previewInfo.valid&&ui.regionKeys.length>0&&!ui.pickingTarget:null);return;}
    const selected=sketchRegions(sketch).filter(r=>ui.regionKeys.includes(r.key)),box=new THREE.Box2();
    for(const region of selected)for(const point of region.outer.points)box.expandByPoint(point);
    const center=box.isEmpty()?new THREE.Vector2():box.getCenter(new THREE.Vector2()),frame=resolvePlane(viewDocument,sketch.plane);
    depthGizmo.configure({key:featureDepthKey(),kind:ui.operation,value:ui.distance*(ui.reversed?-1:1),valid:previewInfo.valid,
        origin:world(frame,center.x,center.y),direction:frame.n.clone().multiplyScalar(ui.operation==='cut'?-1:1)});
}
function previewFeatureDepth(value){
    if(!featurePreviewMesh||!ui?.operation||ui.endCondition!=='blind')return;
    const n=currentFrame.n,k=value/featurePreviewMesh.userData.depth-1,d=n.dot(currentFrame.o);
    featurePreviewMesh.matrixAutoUpdate=false;
    featurePreviewMesh.matrix.set(1+k*n.x*n.x,k*n.x*n.y,k*n.x*n.z,-k*n.x*d,
        k*n.y*n.x,1+k*n.y*n.y,k*n.y*n.z,-k*n.y*d,
        k*n.z*n.x,k*n.z*n.y,1+k*n.z*n.z,-k*n.z*d,0,0,0,1);
    featurePreviewMesh.matrixWorldNeedsUpdate=true;ui.distance=Math.abs(value);
    previewInfo={valid:Math.abs(value)>=1,min:Math.abs(value),max:Math.abs(value),message:value===0?'零点 · 继续拖动可切换方向':value<0?'反向深度预览 · 松开同步，确认后生成特征':'正向深度预览 · 松开同步，确认后生成特征'};requestRender();
}
async function commitFeatureDepth(value,key){
    if(!ui?.operation||featureDepthKey()!==key)return '操作已改变，请重新拖动';
    const [sid,kind,featureId,keys,,reversed]=JSON.parse(key);
    return await bridge.invokeMethodAsync('SetFeatureDepth',sid,kind,featureId,keys,reversed,value);
}
function rayAt(e) {
    camera.updateMatrixWorld(true);
    const r = host.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    ray.params.Line.threshold = Math.max(.5, camera.position.distanceTo(controls.target) / host.clientHeight * 3);
}
function localPoint(e,smooth=false) {
    rayAt(e); const hit = V(); const p = new THREE.Plane().setFromNormalAndCoplanarPoint(currentFrame.n, currentFrame.o);
    if (Math.abs(ray.ray.direction.dot(currentFrame.n))<.02 || !ray.ray.intersectPlane(p, hit)) {showSnap(null);return null;}
    const rect=host.getBoundingClientRect();
    const candidates=dragging?snapCandidates.filter(c=>!c.entityId||c.entityId!==dragging.entity.id):snapCandidates;
    const snap=e.altKey?null:closestScreenSnap(candidates,currentFrame,camera,rect.width,rect.height,e.clientX-rect.left,e.clientY-rect.top);
    showSnap(snap);if(snap)return snap.point.clone();
    const delta = hit.sub(currentFrame.o);return new THREE.Vector2(smooth?delta.dot(currentFrame.u):Math.round(delta.dot(currentFrame.u)),smooth?delta.dot(currentFrame.v):Math.round(delta.dot(currentFrame.v)));
}
function down(e) {if(e.target.closest?.('[data-feature-depth]'))return;interruptCameraTransition();requestRender();
    if(!ui)return;
    if(dimensionEditor){
        if(dimensionEditor.root.contains(e.target))return;
        e.preventDefault();e.stopPropagation();void finishDimensionEdit(!dimensionEditor.createArgs);return;
    }
    if(e.button!==0){cancelDraw();extendedSketch?.cancel();clearDimensionSelection();return;}
    host.focus({preventScroll:true});
    pressed = { x: e.clientX, y: e.clientY };
    const border=ui.editingId&&ui.tool==='select'?sketchBorderAt(e):null;
    const dimensionCandidate=ui.editingId&&ui.tool==='dimension'?dimensionPickAt(e):null;
    if(!ui.operation && !ui.pickingSketchPlane && !ui.pickingTarget && (!ui.editingId||['select','dimension'].includes(ui.tool))) {
        const hits=pickAt(e).visible;
        const hit=dimensionSelection?null:hits.find(h=>h.object.userData.dimensionLabel)??(!border&&!dimensionCandidate?hits.find(h=>h.object.userData.pick.kind==='dimension'):null);
        if(hit){
            const pick=hit.object.userData.pick,sketch=doc.sketches.find(s=>s.id===pick.sketchId),entity=sketch?.entities.find(v=>v.id===pick.profileId);
            const frame=sketch?resolvePlane(viewDocument,sketch.plane):null,start=frame?pointOnFrame(e,frame):null;
            const layout=entity?layoutForDimension(sketch,entity,pick.edge):null;
            if(start&&layout){dimensionDrag={sketch,entity,edge:pick.edge,frame,start,layout,current:null,pointerId:e.pointerId};controls.enabled=false;host.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault();return;}
        }
    }

    if(dimensionCandidate){dimensionPressed={selection:dimensionCandidate,pointerId:e.pointerId};controls.enabled=false;host.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault();return;}
    if(border) {
        const p=pointOnFrame(e,currentFrame),sketch=doc.sketches.find(s=>s.id===ui.editingId);
        if(p){dragging={sketch,entity:structuredClone(border.entity),start:p,handle:border.handle,edge:border.edge,current:null,pointerId:e.pointerId};controls.enabled=false;host.setPointerCapture(e.pointerId);e.stopPropagation();e.preventDefault();return;}
    }
    if(ui.editingId&&extendedSketch?.owns(ui.tool))return;
    if (ui.editingId && ['rectangle','centerRectangle','ellipse', 'circle','slot','line','referenceLine'].includes(ui.tool)) {
        drawing = localPoint(e);drawingSnap=drawing&&lastSnap?.reference?structuredClone(lastSnap.reference):null;
        if (drawing) host.setPointerCapture(e.pointerId);
        else bridge.invokeMethodAsync('CanvasHint','当前接近草图侧视方向，请旋转视角或点击“正对草图平面”后继续绘制。');
    }
}
function move(e){pendingPointerMove=e;}
function handleMove(e) {
    if(drawing||dragging||dimensionDrag||ui?.editingId||ui?.operation||ui?.pickingTarget||ui?.pickingSketchPlane||group?.children.some(object=>object.userData.pick))requestRender();
    if(dimensionEditor)return;
    if(dimensionDrag) {
        const drag=dimensionDrag,p=pointOnFrame(e,drag.frame);if(!p)return;
        drag.current=[drag.layout.position[0]+p.x-drag.start.x,drag.layout.position[1]+p.y-drag.start.y];
        clearDimension(drag.sketch.id,drag.entity.id,drag.edge);drawDimension(drag.sketch,drag.entity,drag.edge,drag.frame,drag.current);
        host.style.cursor='grabbing';return;
    }

    if(dragging){pendingDragEvent=e;return;}
    if (!drawing) {
        if(!ui || e.buttons || navigating) return;
        if(ui.operation&&ui.featureMode==='sweep'&&ui.pickingSweepPath){const candidate=sweepPathAt(e);destroy(axisHover);axisHover=candidate?sketchStroke(outline(candidate.entity),candidate.frame,0xffc77b,6):null;if(axisHover)group.add(axisHover);host.style.cursor=candidate?'pointer':'crosshair';return;}
        if(ui.operation&&ui.featureMode==='revolve'&&(!ui.rotationAxisSelected||ui.pickingRotationAxis)){
            const reference=rotationReferenceAt(e);destroy(axisHover);axisHover=rotationReferenceStroke(reference);if(axisHover)group.add(axisHover);host.style.cursor=reference?'pointer':'crosshair';return;
        }
        if(ui.operation&&ui.featureMode==='chamfer'){const edge=chamferEdgeAt(e);if(chamferHover?.userData.edge!==edge){destroy(chamferHover);chamferHover=edge?chamferChainStroke(edge,0x9ee9ff):null;if(chamferHover){chamferHover.userData.edge=edge;group.add(chamferHover);}}host.style.cursor=edge?'pointer':'crosshair';return;}
        if(!ui.editingId&&!ui.operation&&!ui.pickingSketchPlane&&!ui.pickingTarget&&!group.children.some(object=>object.userData.pick)){
            host.style.cursor='default';host.dataset.dragHint='';return;
        }
        const picked=pickAt(e),annotations=picked.visible;
        if(ui.editingId&&ui.tool==='dimension') {
            const label=annotations.some(h=>h.object.userData.dimensionLabel),candidate=label?null:dimensionPickAt(e);showDimensionHover(candidate);if(dimensionSelection)previewDimension(e);
            if(!label){host.style.cursor=candidate?'pointer':'crosshair';if(!dimensionSelection)host.dataset.dragHint=candidate?.kind==='model'?'选择实体参照边，再选择草图边':'选择一条草图边预览尺寸，或依次选两条边标注间距';return;}
        }
        if(ui.editingId&&ui.tool==='select') {
            const border=sketchBorderAt(e),label=annotations.some(h=>h.object.userData.dimensionLabel);
            if(border&&!label){setDragFeedback(border.entity,border.handle,e.shiftKey);showSnap(null);return;}
        }
        if(!ui.operation&&!ui.pickingTarget&&!ui.pickingSketchPlane&&(!ui.editingId||['select','dimension'].includes(ui.tool))&&annotations.some(h=>h.object.userData.pick.kind==='dimension')){host.style.cursor='grab';return;}
        host.style.cursor='default';host.dataset.dragHint='';
        if(ui.editingId&&extendedSketch?.owns(ui.tool)){
            const p=localPoint(e);destroy(preview);preview=null;
            if(p){const paths=extendedSketch.preview(p,ui.polygonSides??6);if(paths.length){preview=new THREE.Group();for(const path of paths)preview.add(sketchStroke(path,currentFrame,accent,6));scene.add(preview);}}
            return;
        }
        if(ui.editingId){if(['rectangle','centerRectangle','ellipse','circle','slot','line','referenceLine'].includes(ui.tool))localPoint(e);else showSnap(null);return;}
        const {visible,bodyHit}=picked;
        if(ui.pickingSketchPlane) {
            const plane=visible.find(h=>h.object.userData.pick.kind==='referencePlane');
            hoverReferencePlane(plane?.object.userData.pick.reference??null);
            const tag=bodyHit?solidMesh.userData.tags[bodyHit.faceIndex]:null;
            targetHover(plane?null:tag);host.style.cursor=plane||tag?(tag?.face==='curved'&&!plane?'not-allowed':'pointer'):'default';return;
        }
        if(ui.operation&&ui.featureMode==='loft'){
            const candidate=loftPickAt(e);hoveredRegion=candidate?.region??null;paintRegions();targetHover(candidate?.face??null);host.style.cursor=candidate?'pointer':'default';return;
        }
        if(ui.pickingTarget) {
            const tag=bodyHit?solidMesh.userData.tags[bodyHit.faceIndex]:null;targetHover(tag);
            host.style.cursor=tag?(tag.face==='curved'?'not-allowed':'pointer'):'crosshair';return;
        }
        const hit=visible.find(h=>h.object.userData.pick.kind==='region' && (!ui.operation || h.object.userData.pick.sketchId===ui.sketchId||ui.featureMode==='sweep'&&ui.pickingSweepProfile&&h.object.userData.pick.sketchId!==ui.featureDraft.pathSketchId));
        hoveredRegion=hit?.object.userData.pick??null;paintRegions();host.style.cursor=hit?'pointer':'default';return;
    }
    const p = localPoint(e); if (!p) return;
    destroy(preview);
    let points;
    if(ui.tool==='ellipse')points=outline({kind:'ellipse',x:drawing.x-Math.abs(p.x-drawing.x),y:drawing.y-Math.abs(p.y-drawing.y),width:Math.max(1,2*Math.abs(p.x-drawing.x)),height:Math.max(1,2*Math.abs(p.y-drawing.y))});
    else if(ui.tool==='centerRectangle')points=outline({kind:'rectangle',x:drawing.x-Math.abs(p.x-drawing.x),y:drawing.y-Math.abs(p.y-drawing.y),width:2*Math.abs(p.x-drawing.x),height:2*Math.abs(p.y-drawing.y)});
    else if (ui.tool === 'rectangle') points = [[drawing.x, drawing.y], [p.x, drawing.y], [p.x, p.y], [drawing.x, p.y], [drawing.x, drawing.y]];
    else if(['line','referenceLine'].includes(ui.tool))points=[[drawing.x,drawing.y],[p.x,p.y]];
    else if(ui.tool==='slot')points=outline(slotDraft(drawing,p));
    else { points = []; const r = p.distanceTo(drawing); for (let i = 0; i <= 96; i++) points.push([drawing.x + Math.cos(i / 96 * Math.PI * 2) * r, drawing.y + Math.sin(i / 96 * Math.PI * 2) * r]); }
    preview=sketchStroke(points,currentFrame,accent,6,ui.tool==='referenceLine');scene.add(preview);
}
function slotDraft(center,end){
    const width=Math.max(3,2*center.distanceTo(end)),height=Math.min(20,width/3);
    return {kind:'slot',x:center.x-width/2,y:center.y-height/2,width,height,angle:Math.atan2(end.y-center.y,end.x-center.x)*180/Math.PI};
}
function cancelDraw() {requestRender();
    if(dimensionPressed){if(host?.hasPointerCapture(dimensionPressed.pointerId))host.releasePointerCapture(dimensionPressed.pointerId);dimensionPressed=null;if(controls)controls.enabled=true;}
    pendingDragEvent=null;
    if(host)host.dataset.dragHint='';
    if(dimensionDrag){const drag=dimensionDrag;dimensionDrag=null;if(host?.hasPointerCapture(drag.pointerId))host.releasePointerCapture(drag.pointerId);if(group){clearDimension(drag.sketch.id,drag.entity.id,drag.edge);drawDimension(drag.sketch,drag.entity,drag.edge,drag.frame);}if(controls)controls.enabled=true;if(host)host.style.cursor='default';}
    if(dragging){const drag=dragging;dragging=null;if(host?.hasPointerCapture(drag.pointerId))host.releasePointerCapture(drag.pointerId);if(group)for(const id of drag.previewIds??[drag.entity.id]){const original=drag.sketch.entities.find(e=>e.id===id);if(original){clearSketchEntity(drag.sketch.id,id);drawSketchEntity(drag.sketch,original,currentFrame);}}if(controls)controls.enabled=true;if(host)host.style.cursor='default';}
    drawing = null;drawingSnap=null; pressed = null;showSnap(null); destroy(preview); preview = null; }
function up(e) {if(pendingPointerMove){const event=pendingPointerMove;pendingPointerMove=null;handleMove(event);}requestRender();
    if(dimensionEditor)return;
    if (e.button !== 0 || !ui) return;
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    if(dimensionPressed){const pending=dimensionPressed,click=pressed;cancelDraw();if(click&&Math.hypot(click.x-e.clientX,click.y-e.clientY)<4)chooseDimensionReference(pending.selection,e);return;}
    if(dimensionDrag){
        const drag=dimensionDrag,moved=pressed&&Math.hypot(pressed.x-e.clientX,pressed.y-e.clientY)>3;
        const p=pointOnFrame(e,drag.frame);
        const position=p?[drag.layout.position[0]+p.x-drag.start.x,drag.layout.position[1]+p.y-drag.start.y]:drag.current;
        cancelDraw();
        if(moved&&position)bridge.invokeMethodAsync('MoveDimension',drag.sketch.id,drag.entity.id,drag.edge,position[0]-drag.layout.base[0],position[1]-drag.layout.base[1]);
        else if(drag.edge>=0)bridge.invokeMethodAsync('PickEdge',drag.sketch.id,drag.entity.id,drag.edge);
        else bridge.invokeMethodAsync('PickProfile',drag.sketch.id,drag.entity.id);
        return;
    }
    if(dragging) {
        const drag=dragging,moved=pressed&&Math.hypot(pressed.x-e.clientX,pressed.y-e.clientY)>3;
        if(moved)updateEntityDrag(e);
        cancelDraw();
        if(moved&&drag.current){const v=drag.current;if(['x','y','width','height','radius'].every(k=>Math.abs(v[k]-drag.entity[k])<1e-7)){bridge.invokeMethodAsync('CanvasHint','锚点或尺寸约束限制了此方向，图元保持不动。');return;}const request=drag.proposed??v;bridge.invokeMethodAsync('DragEntity',request.id,request.x,request.y,request.width,request.height,request.radius);return;}
        bridge.invokeMethodAsync('PickEdge',drag.sketch.id,drag.entity.id,drag.edge);return;
    }
    if(drawing) {
        const a=drawing,p=localPoint(e),kind=ui.tool==='referenceLine'?'line':ui.tool==='centerRectangle'?'rectangle':ui.tool,fromCenter=ui.tool==='centerRectangle',construction=ui.tool==='referenceLine',startTarget=drawingSnap,endTarget=lastSnap?.reference?structuredClone(lastSnap.reference):null,endpointSnapped=!!endTarget;
        cancelDraw();if(!p||a.distanceTo(p)<1)return;
        const coincidences=[],attach=(point,target)=>{if(target)coincidences.push({point,target:point==='perimeter'&&target.kind==='modelEdge'?{...target,kind:'modelEdgePoint'}:target});};
        let x,y,w,h,angle=0;
        if(kind==='circle'){x=a.x;y=a.y;w=endpointSnapped?a.distanceTo(p):Math.round(a.distanceTo(p));h=1;attach('center',startTarget);attach('perimeter',endTarget);}
        else if(kind==='ellipse'||fromCenter){x=a.x-Math.abs(p.x-a.x);y=a.y-Math.abs(p.y-a.y);w=2*Math.abs(p.x-a.x);h=2*Math.abs(p.y-a.y);if(w<1||h<1)return;attach('center',startTarget);if(fromCenter)attach((p.y< a.y?'bottom':'top')+(p.x<a.x?'Left':'Right'),endTarget);}
        else if(kind==='line'){x=a.x;y=a.y;w=p.x-a.x;h=p.y-a.y;attach('start',startTarget);attach('end',endTarget);}
        else if(kind==='slot'){const slot=slotDraft(a,p);x=slot.x;y=slot.y;w=slot.width;h=slot.height;angle=slot.angle;attach('center',startTarget);if(a.distanceTo(p)>=1.5)attach('rightMid',endTarget);}
        else {
            x=Math.min(a.x,p.x);y=Math.min(a.y,p.y);w=Math.abs(p.x-a.x);h=Math.abs(p.y-a.y);
            if(w<1||h<1||(kind==='slot'&&w<h)){bridge.invokeMethodAsync('CanvasHint','宽高至少为 1 mm，长圆槽总长不能小于槽宽；未创建图形。');return;}
            const corner=point=>(point.y===y?'bottom':'top')+(point.x===x?'Left':'Right');
            attach(corner(a),startTarget);attach(corner(p),endTarget);
        }
        bridge.invokeMethodAsync('AddEntity',kind,x,y,w,h,coincidences,angle,construction);return;
    }
    const click = pressed; pressed = null;
    if (!click || Math.hypot(click.x - e.clientX, click.y - e.clientY) > 4) return;
    if(ui.editingId&&extendedSketch?.owns(ui.tool)){const p=localPoint(e);if(p)void extendedSketch.click(p,lastSnap?.reference,ui.polygonSides??6);return;}
    if(ui.editingId&&ui.tool==='dimension'){if(dimensionSelection){previewDimension(e);placeDimension();}else clearDimensionSelection();return;}
    if(ui.operation&&ui.featureMode==='sweep'&&ui.pickingSweepPath){const candidate=sweepPathAt(e);if(candidate)bridge.invokeMethodAsync('SelectSweepPath',candidate.sketch.id,candidate.entity.id);return;}
    if(ui.operation&&ui.featureMode==='revolve'&&(!ui.rotationAxisSelected||ui.pickingRotationAxis)){
        const reference=rotationReferenceAt(e);
        if(reference?.kind==='model')bridge.invokeMethodAsync('SelectModelRotationAxis',{faceA:reference.faceA,faceB:reference.faceB,segment:reference.segment});
        else if(reference)bridge.invokeMethodAsync('SelectRotationAxis',reference.sketchId,reference.id,reference.edgeIndex);
        return;
    }
    if(ui.operation&&ui.featureMode==='chamfer'){const edge=chamferEdgeAt(e);if(edge)bridge.invokeMethodAsync('SelectChamferEdges',tangentEdgeChain(edge).map(part=>({faceA:part.faceA,faceB:part.faceB,segment:part.segment,kind:part.kind??'line'})));return;}
    if(ui.operation&&ui.featureMode==='loft'){
        const candidate=loftPickAt(e);if(!candidate)return;
        if(candidate.region){const p=candidate.region;bridge.invokeMethodAsync('PickLoftSection',{sketchId:p.sketchId,regionKeys:[p.regionKey]});}
        else bridge.invokeMethodAsync('PickLoftSection',{sketchId:'',regionKeys:[],face:candidate.face,faceX:candidate.faceX,faceY:candidate.faceY});
        return;
    }
    const {bodyHit,visible}=pickAt(e);
    if(ui.pickingSketchPlane) {
        const plane=visible.find(h=>h.object.userData.pick.kind==='referencePlane');
        if(plane)bridge.invokeMethodAsync('PickSketchPlane',plane.object.userData.pick.reference);
        else if(bodyHit) {const tag=solidMesh.userData.tags[bodyHit.faceIndex];if(tag)bridge.invokeMethodAsync('SelectBodyFace',tag.bodyId??'',tag.featureId,tag.face,bodyHit.point.toArray());}
        return;
    }
    if(ui.pickingTarget) {
        const tag=bodyHit?solidMesh.userData.tags[bodyHit.faceIndex]:null;
        if(tag)bridge.invokeMethodAsync('CaptureTargetFace',tag.featureId,tag.face);
        return;
    }
    if(!ui.editingId) {
        const regionHit=visible.find(h=>h.object.userData.pick.kind==='region' && (!ui.operation || h.object.userData.pick.sketchId===ui.sketchId||ui.featureMode==='sweep'&&ui.pickingSweepProfile&&h.object.userData.pick.sketchId!==ui.featureDraft.pathSketchId));
        if(regionHit) {
            const p=regionHit.object.userData.pick;
            const toggle=e.ctrlKey||e.shiftKey||e.metaKey||!!ui.operation;
            let keys=toggle&&ui.sketchId===p.sketchId?[...ui.regionKeys]:[];
            if(keys.includes(p.regionKey))keys=keys.filter(key=>key!==p.regionKey);else keys.push(p.regionKey);
            ui.sketchId=p.sketchId;ui.regionKeys=keys;paintRegions();
            bridge.invokeMethodAsync('PickRegions',p.sketchId,keys);return;
        }
    }
    const hit = visible.find(h => h.object.userData.pick.kind === 'edge') ?? visible[0];
    if (hit) {
        const p = hit.object.userData.pick;
        if(ui.operation)return;
        if (p.kind === 'edge') bridge.invokeMethodAsync('PickEdge', p.sketchId, p.profileId, p.edge);
        else if(p.kind === 'profile') bridge.invokeMethodAsync('PickProfile', p.sketchId, p.profileId);
        return;
    }
    if (bodyHit && !ui.editingId && !ui.operation) {
        const tag = solidMesh.userData.tags[bodyHit.faceIndex];if(tag){const body=bodyInfo(doc,solid).find(body=>body.id===tag.bodyId);bridge.invokeMethodAsync('SelectBodyFace',body?.id??'',tag.featureId,tag.face,bodyHit.point.toArray());}
    } else if(!ui.editingId && !ui.operation && ui.sketchId) {
        ui.regionKeys=[];paintRegions();bridge.invokeMethodAsync('PickRegions',ui.sketchId,[]);
    }
}
function loftPickAt(e){
    rayAt(e);scene.updateMatrixWorld(true);
    const hits=ray.intersectObjects(group.children,false),selected=new Set([ui.sketchId,...(ui.featureDraft.sections??[]).map(section=>section.sketchId)]);
    // The thick sketch border is expanded by its vertex shader. A mesh raycast
    // only sees its unexpanded centreline, so clicks on the visible border used
    // to fall through to the supporting solid. Pick that same border in pixels.
    const rect=host.getBoundingClientRect(),mouse=new THREE.Vector2(e.clientX-rect.left,e.clientY-rect.top);
    let border=null,best=9;
    for(const object of group.children){
        const pick=object.userData.pick;if(!object.visible||pick?.kind!=='region')continue;
        const sketch=doc.sketches.find(s=>s.id===pick.sketchId),region=sketch&&sketchRegions(sketch).find(r=>r.key===pick.regionKey);if(!region)continue;
        const basis=resolvePlane(viewDocument,sketch.plane);
        for(const loop of [region.outer,...region.holes])for(let index=0;index<loop.points.length;index++){
            const first=loop.points[index],last=loop.points[(index+1)%loop.points.length];
            const a=world(basis,first.x,first.y,.16).project(camera),b=world(basis,last.x,last.y,.16).project(camera);
            if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue;
            const start=new THREE.Vector2((a.x+1)*rect.width/2,(1-a.y)*rect.height/2),end=new THREE.Vector2((b.x+1)*rect.width/2,(1-b.y)*rect.height/2),delta=end.sub(start);
            const t=THREE.MathUtils.clamp(mouse.clone().sub(start).dot(delta)/(delta.lengthSq()||1),0,1),distance=mouse.distanceTo(start.addScaledVector(delta,t));
            if(distance<best){best=distance;border=pick;}
        }
    }
    if(border)return selected.has(border.sketchId)?null:{region:border};
    const region=hits.find(hit=>hit.object.userData.pick?.kind==='region'&&!selected.has(hit.object.userData.pick.sketchId));
    if(region)return {region:region.object.userData.pick};
    const body=hits.find(hit=>hit.object===solidMesh),tag=body?solidMesh.userData.tags[body.faceIndex]:null;
    if(body&&hits.some(hit=>hit.object.userData.pick?.kind==='region'&&hit.distance<=body.distance+.5))return null;
    if(!tag||tag.face==='curved')return null;
    const face={featureId:tag.featureId,face:tag.face},basis=resolvePlane(viewDocument,face),delta=body.point.clone().sub(basis.o);
    return {face,faceX:delta.dot(basis.u),faceY:delta.dot(basis.v)};
}
function pickAt(e) {
    rayAt(e);scene.updateMatrixWorld(true);
    const hits=ray.intersectObjects(group.children,false),bodyHit=hits.find(h=>h.object===solidMesh);
    const visible=hits.filter(h=>h.object.userData.pick&&(!ui.editingId||h.object.userData.pick.sketchId===ui.editingId)&&(h.object.userData.pick.kind==='dimension'||ui.editingId||!bodyHit||h.distance<=bodyHit.distance+.5));
    return {bodyHit,visible};
}
function bounds() {
    const box = new THREE.Box3();
    if(ui?.pickingSketchPlane)return box.set(V(-60,-60,-60),V(60,60,60));
    if (ui?.editingId || (!solid.length && ui?.sketchId)) {
        const sketch = doc.sketches.find(s => s.id === (ui.editingId ?? ui.sketchId));
        for (const e of sketch.entities) for (const p of outline(e)) box.expandByPoint(world(currentFrame, ...p));
        for (const e of sketch.entities.filter(e => e.kind === 'rectangle')) box.expandByPoint(world(currentFrame, e.x + e.width, e.y + e.height));
    } else for (const p of solid) for (const v of p.vertices) box.expandByPoint(v);
    if (box.isEmpty()) { box.expandByPoint(world(currentFrame ?? resolvePlane(doc, null), -50, -40)); box.expandByPoint(world(currentFrame ?? resolvePlane(doc, null), 50, 40)); }
    return box;
}
export function fit(modelOnly=false) {if(!camera||!controls)return;interruptCameraTransition();requestRender();
    const box = modelOnly&&solid.length?new THREE.Box3().setFromPoints(solid.flatMap(p=>p.vertices)):bounds(), center = box.getCenter(V()), size = box.getSize(V());
    const dir = camera.position.clone().sub(controls.target).normalize();if(dir.lengthSq()<.5)dir.set(1,-1,1).normalize();
    const d = Math.max(size.length(), 60) * 1.85 / Math.min(camera.aspect, 1);
    controls.target.copy(center); camera.position.copy(center).addScaledVector(dir, d);if(camera.isOrthographicCamera)setOrthographicSpan(2*d*Math.tan(THREE.MathUtils.degToRad(19))); controls.update();
}
function interruptCameraTransition(){
    if(!cameraTransition||!camera||!controls)return;
    cameraTransition=null;
    const target=controls.target.clone(),enabled=controls.enabled;
    camera.up.copy(V(0,1,0).applyQuaternion(camera.quaternion));
    createControls(target);controls.enabled=enabled;requestRender();
}
function advanceCameraTransition(now){
    const transition=cameraTransition;if(!transition)return;
    const t=Math.max(0,Math.min(1,(now-transition.started)/transition.duration));
    const eased=t*t*t*(10+t*(-15+6*t));
    const target=transition.fromTarget.clone().lerp(transition.toTarget,eased);
    const rotation=transition.fromRotation.clone().slerp(transition.toRotation,eased);
    const distance=THREE.MathUtils.lerp(transition.fromDistance,transition.toDistance,eased);
    controls.target.copy(target);camera.quaternion.copy(rotation);
    camera.position.copy(target).addScaledVector(V(0,0,1).applyQuaternion(rotation),distance);
    if(camera.isOrthographicCamera)setOrthographicSpan(THREE.MathUtils.lerp(transition.fromSpan,transition.toSpan,eased));
    camera.updateMatrixWorld(true);requestRender();
    if(t===1){
        cameraTransition=null;camera.up.copy(transition.up);
        createControls(transition.toTarget);controls.enabled=!dimensionEditor;
    }
}
function setCameraProjection(orthographic){
    if(!camera||!!camera.isOrthographicCamera===orthographic)return;
    const target=controls.target.clone(),enabled=controls.enabled,aspect=host.clientWidth/Math.max(1,host.clientHeight),distance=Math.max(.1,camera.position.distanceTo(target)),direction=camera.position.clone().sub(target).normalize();
    const span=camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom:2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/camera.zoom;
    const next=orthographic?new THREE.OrthographicCamera(-span*aspect/2,span*aspect/2,span/2,-span/2,.1,20000):new THREE.PerspectiveCamera(38,aspect,.1,20000);
    next.aspect=aspect;next.up.copy(camera.up);next.quaternion.copy(camera.quaternion);next.position.copy(camera.position);
    if(!orthographic)next.position.copy(target).addScaledVector(direction,span/(2*Math.tan(THREE.MathUtils.degToRad(19))));
    camera=next;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);createControls(target);controls.enabled=enabled;if(depthGizmo)depthGizmo.camera=camera;requestRender();
}
function setOrthographicSpan(span){if(!camera?.isOrthographicCamera)return;const half=Math.max(.001,span)/2;camera.zoom=1;camera.top=half;camera.bottom=-half;camera.left=-half*camera.aspect;camera.right=half*camera.aspect;camera.updateProjectionMatrix();}
export function cameraView(view) {requestRender();
    interruptCameraTransition();cancelDraw();setCameraProjection(view==='sketch');
    if(view==='planes')sketchCreationFocus={
        point:centerViewOnPlane(V(0,0,1),V())??controls.target.clone(),
        distance:camera.position.distanceTo(controls.target)
    };
    const f=currentFrame??resolvePlane(doc,null),box=bounds(),center=box.getCenter(V()),size=box.getSize(V());
    let distance=Math.max(size.length(),60)*1.85/Math.min(camera.aspect,1);
    const active=doc?.sketches.find(sketch=>sketch.id===ui?.editingId);
    if(view==='sketch'&&active&&!active.entities.length){
        const saved=active.plane.featureId?null:sketchCreationFocus;
        const focus=active.plane.featureId?f.o.clone():saved?new THREE.Plane().setFromNormalAndCoplanarPoint(f.n,f.o).projectPoint(saved.point,V()):centerViewOnPlane(f.n,f.o)??new THREE.Plane().setFromNormalAndCoplanarPoint(f.n,f.o).projectPoint(controls.target,V());
        center.copy(focus);distance=Math.max(10,saved?.distance??camera.position.distanceTo(controls.target));
        sketchCreationFocus=null;
    }
    const up=view==='sketch'?f.v.clone():V(0,0,1),direction=view==='sketch'?f.n.clone():V(180,-230,210).normalize();
    const destination=camera.clone();destination.up.copy(up);destination.position.copy(center).addScaledVector(direction,distance);destination.lookAt(center);
    cameraTransition={
        started:performance.now(),duration:520,
        fromTarget:controls.target.clone(),toTarget:center,
        fromRotation:camera.quaternion.clone(),toRotation:destination.quaternion.clone(),
        fromDistance:camera.position.distanceTo(controls.target),toDistance:distance,up,fromSpan:camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom:0,toSpan:2*distance*Math.tan(THREE.MathUtils.degToRad(19))
    };
}
export function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let stlExportBusy=false;
let stlExportWorker=null;
export function exportStl(name,exportId=0) {
    if (!solid.length) throw new Error('没有可导出的实体。');
    if(stlExportBusy)throw new Error('模型正在生成导出网格，请稍候。');
    if(ui?.operation||ui?.editingId)throw new Error('请先完成当前操作再导出。');
    stlExportBusy=true;let worker;
    try{
        worker=new Worker(new URL('./export-solid-worker.js',import.meta.url),{type:'module'});
        stlExportWorker=worker;
        const notify=(message,finished)=>{if(!viewDisposed)bridge?.invokeMethodAsync('StlExportProgress',message,finished,exportId).catch(error=>recordDiagnostic('stl-export-status',error));};
        const finish=message=>{worker.terminate();if(stlExportWorker===worker){stlExportWorker=null;stlExportBusy=false;notify(message,true);}};
        worker.onmessage=({data})=>{
            if(stlExportWorker!==worker)return;
            if(data.progress){notify(data.progress,false);return;}
            if(data.error){recordDiagnostic('stl-export-worker',data.stack??data.error);finish(data.error);return;}
            try{if(!(data.buffer instanceof ArrayBuffer))throw new Error('未收到有效的 STL 文件。');download(name+'.stl',data.buffer,'model/stl');finish('STL 已导出，单位毫米'+(Number.isFinite(data.elapsed)?' · '+(data.elapsed/1000).toFixed(1)+' 秒':''));}
            catch(error){finish('STL 导出失败：'+error.message);}
        };
        worker.onerror=event=>{event.preventDefault();finish('导出网格生成失败，未下载不完整模型。');};
        const seed=exportSolidState(doc,true),edges=packExportEdges(visualEdgeEntries(doc,solid));
        worker.postMessage({document:doc,seed,edges},[seed.positions.buffer,seed.offsets.buffer,seed.tagIds.buffer]);
    }catch(error){worker?.terminate();stlExportWorker=null;stlExportBusy=false;throw error;}
}
export function cancelStlExport(){
    stlExportWorker?.terminate();stlExportWorker=null;stlExportBusy=false;
}
export function downloadPerformanceReport(){
    const report={version:1,time:new Date().toISOString(),features:doc?.features.length??0,sketches:doc?.sketches.length??0,polygons:solid.length,triangles:solidMesh?solidMesh.geometry.attributes.position.count/3:0,viewport:{width:host?.clientWidth,height:host?.clientHeight,pixelRatio:renderer?.getPixelRatio()},renderer:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory}}:null,...performanceStats()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='cad-performance.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function dispose() {
    cancelStlExport();
    if(viewDisposed)return;viewDisposed=true;document.removeEventListener('input',sweepProgressInput);sweepGuide=null;sweepMoving=null;sweepPlaying=null;lifecycleObserver?.disconnect();lifecycleObserver=null;
    debugWireframe?.dispose();debugWireframe=null;
    pendingPointerMove=null;lastFrameTime=null;lastFrameRendered=false;cameraTransition=null;sketchCreationFocus=null;depthGizmo?.dispose();depthGizmo=null;featurePreviewMesh=null;extendedSketch?.cancel();extendedSketch=null;
    closeDimensionEditor();
    cancelAnimationFrame(animation); observer?.disconnect();
    controls?.removeEventListener('start',navigationStart);controls?.removeEventListener('end',navigationEnd);controls?.dispose();controls=null;navigating=false;
    host?.removeEventListener('pointerdown', down,true); host?.removeEventListener('pointerup', up); host?.removeEventListener('pointermove', move); host?.removeEventListener('pointercancel', cancelDraw); host?.removeEventListener('contextmenu', context);
    host?.removeEventListener('wheel',interruptCameraTransition,true);
    host?.removeEventListener('dblclick',editDimensionAt);host?.removeEventListener('pointerleave', leave);host?.removeEventListener('keydown',keydown);window.removeEventListener('keydown',focusModelKey);
    cancelDraw();clearDimensionSelection();clearTargetHover();liveFillet?.dispose();liveFillet=null;liveFilletKey=null;visualTreatment?.dispose();visualTreatment=null;edgeProfile?.dispose();edgeProfile=null;edgePreview?.dispose();edgePreview=null;geometryPrepare.dispose();lastFullEdgeState=null;edgeMotion=null;pendingEdgeRadius=null;surfaceStudio?.dispose();surfaceStudio=null;floor?.dispose();floor?.geometry.dispose();floor?.removeFromParent();floor=null;keyLight?.shadow.dispose();scene?.children.slice().forEach(destroy); renderer?.dispose(); renderer?.domElement.remove();
    for(const data of solidDrawCache.values())data.geometry.dispose();solidDrawCache.clear();acceptedPreparationKey=null;acceptedPhysicalPreparationKey=null;releaseDocumentSolid();clearVisualEdgeHistory();clearPerformanceStats();
    solid = []; cacheKey = ''; ui = null; currentFrame = null;
    regionCache.clear();renderedKey='';hoveredRegion=null;
    snapElement?.remove();snapElement=null;snapCandidates=[];viewDocument=null;renderer=null;host=null;bridge=null;
}
