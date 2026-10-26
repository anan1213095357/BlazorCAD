import {edgeEndPlanes} from './edge-end-planes.js';
import {section} from './edge-section.js';
import {joinEdgeBands} from './edge-junctions.js';
import {bandEnd,bandOrigin,bandSamples,sectionSample} from './edge-band-layout.js';
import {circleOf,arcOf} from './curved-boundary.js';
import {edgeEndCap} from './edge-end-cap.js';
import {railContact,stitchBandRails} from './edge-rail-stitch.js';
import {rimBevelProfiles} from './rim-bevel-profile.js';
import {stockClipData} from './solid-picking.js';
// Clip positions use centroid interpolation in BOTH shader stages. With MSAA,
// ordinary varyings can be evaluated outside a partially covered triangle; the
// extrapolated point then escapes the cut domain and leaves dotted old edges.
// Centroid evaluates inside covered geometry, including very thin BSP triangles,
// without eroding neighbouring faces with a screen-space clipping tolerance.
// Display-only fillet: original surface fragments are clipped analytically and
// the replacement arc strips are displaced by one radius uniform. No BSP per drag.
import * as CAD from './engine/core.js';
const v=()=>new CAD.Vector3();
export class LiveFillet {
    constructor(mesh,group,edges,value,host,feature={},polygons=[]){
        this.bevel=feature.edgeTreatment==='chamfer';this.ratio=Math.tan((feature.chamferAngle??45)*Math.PI/180);
        this.mesh=mesh;this.group=group;this.original=mesh.material;this.patches=[];this.materials=[];this.capTextures=new Set();this.originalDepth=mesh.customDepthMaterial;this.radius={value};this.records=[];
        this.max=Infinity;this.boundsRadius=Math.max(1,value)*2;this.recordBounds=[];
        this.stockMotion=mesh.userData.edgeMotionGpu;this.stockClip=stockClipData(mesh);
        if(this.stockClip)this.stockTexture=new CAD.DataTexture(this.stockClip.data,this.stockClip.count,1,CAD.RGBAFormat,CAD.FloatType);
        if(!Number.isFinite(value)||value<.1)throw new Error('请输入不小于 0.1 mm 的有限尺寸。');
        edges=rimBevelProfiles(edges,feature);
        const strips=[];
        for(const edge of edges){
            const settings=edge.visualFeature??feature,bevel=settings.edgeTreatment==='chamfer',ratio=edge.bevelProfile?.ratio??Math.tan((settings.chamferAngle??45)*Math.PI/180);
            this.current={concave:!!edge.concave,bevel,ratio,scale:edge.bevelProfile?.scale??1,coherentRim:edge.bevelProfile?.coherentRim??false,radius:edge.visualFeature?settings.depth:-1,treatment:settings.id,owner:edge.faceA?.featureId,curve:edge.kind==='curve'};
            const axis=edge.b.clone().sub(edge.a).normalize();
            const [startFace,endFace]=edgeEndPlanes(edge,polygons);
            this.current.start=startFace?.normal??null;this.current.end=endFace?.normal??null;this.current.a=edge.a;this.current.b=edge.b;
            this.current.startClosure=startFace?.closureNormal??null;this.current.endClosure=endFace?.closureNormal??null;
            const firstRecord=this.records.length,firstStrip=strips.length,circle=edge.kind==='curve'?(circleOf(edge)??arcOf(edge)):null;
            if(circle){const index=this.addRecord(edge.a,edge.b,edge.normalA,edge.frames[0].normalB,circle,edge.points);strips.push({index,frames:circle.frames,closed:edge.closed});}
            else if(edge.kind==='curve'){
                const frames=edge.frames,indices=[];
                for(let i=0;i<(edge.closed?frames.length:frames.length-1);i++){
                    const a=frames[i],b=frames[(i+1)%frames.length],normal=a.normalB.clone().add(b.normalB).normalize(),normalA=a.normalA.clone().add(b.normalA).normalize(),index=this.addRecord(a.point,b.point,normalA,normal);
                    // Adjacent rail domains meet on their shared tangent bisector.
                    const row=this.records[index],axis=b.point.clone().sub(a.point).normalize();
                    for(const [frame,col,sign] of [[a,10,-1],[b,11,1]]){const tangent=frame.normalA.clone().cross(frame.normalB).normalize();if(tangent.dot(axis)<0)tangent.negate();tangent.multiplyScalar(sign);row.set([...tangent.toArray(),tangent.dot(frame.point)],col*4);}
                    indices.push(index);
                }
                strips.push({index:indices[0],frames,closed:edge.closed});
            }else {const index=this.addRecord(edge.a,edge.b,edge.normalA,edge.normalB);strips.push({index,frames:[{point:edge.a,normalA:edge.normalA,normalB:edge.normalB},{point:edge.b,normalA:edge.normalA,normalB:edge.normalB}],closed:false});}
            for(let i=firstStrip;i<strips.length;i++){strips[i].skipStart=firstRecord;strips[i].skipEnd=this.records.length;strips[i].settings={...this.current};}
        }
        joinEdgeBands(strips,this.records,section);
        if(!this.records.length)throw new Error('请选择有效的圆角边界。');
        for(const strip of strips){
            strip.sections=strip.frames.map(frame=>section(frame.normalA,frame.normalB,strip.settings.bevel,strip.settings.ratio,strip.settings.scale,strip.settings.concave));
            const axis=strip.settings.b.clone().sub(strip.settings.a).normalize();
            strip.samples=bandSamples(strip.sections[0],axis,strip.settings);
            let extent=0;
            strip.frames.forEach((frame,i)=>strip.samples.forEach(sample=>{
                const offset=sectionSample(strip.sections[i],sample).offset;
                const side=i===0?'start':i===strip.frames.length-1?'end':null;
                extent=Math.max(extent,(side?bandEnd(offset,axis,strip.settings,side).offset:offset).length());
            }));
            if(!strip.settings.curve)for(const side of ['start','end'])for(const sample of [0,32])extent=Math.max(extent,railContact(strip,side,sample).offset.length());
            // Endpoint projection can extend far beyond a section's own width
            // on an acute mitre. The clipping AABB must cover those vertices too.
            for(let index=strip.skipStart;index<strip.skipEnd;index++){
                const bounds=this.recordBounds[index],row=this.records[index];bounds.scale=Math.max(bounds.scale,1+extent);
                const box=bounds.base.clone().expandByScalar((row[36]<0?this.boundsRadius:row[36])*bounds.scale);
                row.set(box.min.toArray(),28);row.set(box.max.toArray(),32);
            }
        }
        const textureData=new Float32Array(this.records.length*56);this.records.forEach((record,i)=>textureData.set(record,i*56));this.texture=new CAD.DataTexture(textureData,14,this.records.length,CAD.RGBAFormat,CAD.FloatType);this.texture.minFilter=CAD.NearestFilter;this.texture.magFilter=CAD.NearestFilter;this.texture.needsUpdate=true;
        const roundData=new Float32Array(68*this.records.length*2*4);
        // Spare W components carry the actual source-spine shifts, keeping
        // the same table size and one-uniform radius updates while dragging.
        this.records.forEach((record,index)=>{for(const [side,end] of [['roundStart',0],['roundEnd',1]]){const joint=record[side];if(!joint)continue;const offset=(index*2+end)*68*4;roundData.set([...joint.common.toArray(),joint.knots.length],offset);roundData.set([...joint.wall.toArray(),joint.spineShift],offset+4);joint.knots.forEach((k,i)=>roundData.set([k.height,k.shift,k.width,i===0?joint.spineWidth:0],offset+(i+2)*4));}});
        this.roundTexture=new CAD.DataTexture(roundData,68,this.records.length*2,CAD.RGBAFormat,CAD.FloatType);this.roundTexture.minFilter=this.roundTexture.magFilter=CAD.NearestFilter;this.roundTexture.needsUpdate=true;
        // Cached with the stock geometry, not rebuilt on radius or camera moves.
        // Use geometric triangle normals, never smoothed shading normals, for
        // contact classification so rounded faces cannot be mistaken for planes.
        if(!mesh.geometry.getAttribute('liveFaceNormalAttribute')){
            const position=mesh.geometry.getAttribute('position'),faceNormals=new Float32Array(position.count*3);
            const a=v(),b=v(),c=v(),normal=v();
            for(let i=0;i<position.count;i+=3){a.fromBufferAttribute(position,i);b.fromBufferAttribute(position,i+1);c.fromBufferAttribute(position,i+2);normal.crossVectors(b.sub(a),c.sub(a)).normalize();for(let j=0;j<3;j++)normal.toArray(faceNormals,(i+j)*3);}
            mesh.geometry.setAttribute('liveFaceNormalAttribute',new CAD.BufferAttribute(faceNormals,3));
        }
        const original=Array.isArray(this.original)?this.original:[this.original];mesh.material=original.map(material=>this.material(material,-1,false));
        for(const strip of strips){const positions=[],offsets=[],normals=[],uv=[],indices=[],tangents=[],seams=[],sections=strip.sections,count=strip.samples.length;
            strip.frames.forEach((frame,i)=>strip.samples.forEach(sample=>{
                const {offset,normal:profileNormal}=sectionSample(sections[i],sample),axis=strip.settings.b.clone().sub(strip.settings.a).normalize(),side=i===0?'start':i===strip.frames.length-1?'end':null;
                const end=side?bandEnd(offset,axis,strip.settings,side):null,moved=end?.offset??offset;
                const normal=end?.normal??profileNormal;
                const origin=side?bandOrigin(frame.point,strip.settings,side):frame.point;
                positions.push(...origin.toArray());
                seams.push(side==='start'&&end?.seam?0:1,side==='end'&&end?.seam?0:1);
                offsets.push(...moved.toArray());normals.push(...normal.toArray());
                const tangent=frame.normalA.clone().cross(frame.normalB).addScaledVector(normal,-frame.normalA.clone().cross(frame.normalB).dot(normal));if(tangent.lengthSq()<1e-8)tangent.set(0,1,0).addScaledVector(normal,-normal.y);tangent.normalize();tangents.push(tangent.x,tangent.y,tangent.z,1);uv.push(i,sample/32);}));
            for(let i=0;i<(strip.closed?strip.frames.length:strip.frames.length-1);i++)for(let j=0;j<count-1;j++){const a=i*count+j,b=((i+1)%strip.frames.length)*count+j;for(const tri of [[a,b,a+1],[a+1,b,b+1]]){const point=k=>new CAD.Vector3().fromArray(positions,k*3).add(new CAD.Vector3().fromArray(offsets,k*3)),p=tri.map(point),normal=new CAD.Vector3().fromArray(normals,tri[0]*3);if(p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).dot(normal)<0)tri.reverse();indices.push(...tri);}}
            stitchBandRails(strip,{positions,offsets,normals,uv,indices,tangents,seams});
            const geometry=new CAD.BufferGeometry();geometry.setAttribute('position',new CAD.Float32BufferAttribute(positions,3));geometry.setAttribute('liveOffset',new CAD.Float32BufferAttribute(offsets,3));geometry.setAttribute('liveSeamCoordinate',new CAD.Float32BufferAttribute(seams,2));geometry.setAttribute('tangent',new CAD.Float32BufferAttribute(tangents,4));geometry.setAttribute('normal',new CAD.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new CAD.Float32BufferAttribute(uv,2));geometry.setIndex(indices);
            // Match the owning body's existing material at the selected edge.
            let materialIndex=0;const groups=mesh.geometry.groups,point=strip.frames[0].point,position=mesh.geometry.attributes.position;let distance=Infinity;
            // Resolve the owning material by the edge's actual surface position.
            // One source feature can contain several disconnected bodies/materials.
            // Its feature id alone is therefore not a material-group identity.
            const a=new CAD.Vector3(),b=new CAD.Vector3(),c=new CAD.Vector3(),closest=new CAD.Vector3(),triangle=new CAD.Triangle(a,b,c);
            for(const item of groups){
                let nearest=Infinity;
                for(let vertex=item.start;vertex<item.start+item.count;vertex+=3){a.fromBufferAttribute(position,vertex);b.fromBufferAttribute(position,vertex+1);c.fromBufferAttribute(position,vertex+2);triangle.closestPointToPoint(point,closest);nearest=Math.min(nearest,closest.distanceToSquared(point));if(nearest<1e-12)break;}
                if(nearest<distance){distance=nearest;materialIndex=item.materialIndex;}
                if(distance<1e-12)break;
            }
            const joined=[...(strip.roundPeers??[])].map(peer=>peer.index);
            const patchMaterial=this.material(original[materialIndex]??original[0],strip.skipStart,true,strip.skipEnd,strip.settings.radius,false,joined);patchMaterial.cadStockIndex=materialIndex;patchMaterial.cadLive.concave=strip.settings.concave;
            const patch=new CAD.Mesh(geometry,patchMaterial);patch.receiveShadow=true;patch.castShadow=true;patch.layers.enable(1);
            const depthSource=new CAD.MeshDepthMaterial({depthPacking:CAD.RGBADepthPacking});patch.customDepthMaterial=this.material(depthSource,strip.skipStart,true,strip.skipEnd,strip.settings.radius,false,joined);depthSource.dispose();patch.frustumCulled=false;patch.raycast=()=>{};patch.userData.sharedMaterial=true;patch.renderOrder=1;group.add(patch);this.patches.push(patch);
            for(const side of ['start','end']){
                const capGeometry=edgeEndCap(strip,side,polygons);if(!capGeometry)continue;
                const capNormal=strip.settings[side+'Closure'],capPoint=strip.frames[side==='start'?0:strip.frames.length-1].point;
                let capIndex=materialIndex,capDistance=Infinity;
                for(const item of groups)for(let vertex=item.start;vertex<item.start+item.count;vertex+=3){
                    a.fromBufferAttribute(position,vertex);b.fromBufferAttribute(position,vertex+1);c.fromBufferAttribute(position,vertex+2);
                    const faceNormal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
                    if(faceNormal.dot(capNormal)<.99999||Math.abs(capPoint.clone().sub(a).dot(capNormal))>1e-4)continue;
                    triangle.closestPointToPoint(capPoint,closest);const squared=closest.distanceToSquared(capPoint);
                    if(squared<capDistance){capDistance=squared;capIndex=item.materialIndex;}
                }
                const capMaterial=this.material(original[capIndex]??original[0],strip.skipStart,true,strip.skipEnd,strip.settings.radius,true,joined);
                capMaterial.cadStockIndex=capIndex;capMaterial.cadLive.concave=strip.settings.concave;
                const capSection=capGeometry.userData.capSection,capTexture=new CAD.DataTexture(capSection.data,capSection.count,1,CAD.RGBAFormat,CAD.FloatType);
                this.capTextures.add(capTexture);capMaterial.cadCapSection={...capSection,texture:capTexture};
                const cap=new CAD.Mesh(capGeometry,capMaterial);cap.customDepthMaterial=patch.customDepthMaterial;
                cap.receiveShadow=true;cap.castShadow=true;cap.layers.enable(1);cap.frustumCulled=false;cap.raycast=()=>{};
                cap.userData.sharedMaterial=true;cap.renderOrder=1;group.add(cap);this.patches.push(cap);
            }
        }
        const depthSource=new CAD.MeshDepthMaterial({depthPacking:CAD.RGBADepthPacking});mesh.customDepthMaterial=this.material(depthSource,-1,false);depthSource.dispose();
        this.overlays=[];
        for(const overlay of group.children.filter(object=>object.userData.edgeClipOverlay)){this.overlays.push([overlay,overlay.material]);overlay.material=this.material(overlay.material,-1,false);}
        if(feature.visualPersistent){this.set(value);return;}
        const labelStrip=strips.find(strip=>strip.settings.radius<0)??strips[0];
        const anchor=labelStrip.frames[Math.floor(labelStrip.frames.length/2)],cross=section(anchor.normalA,anchor.normalB,labelStrip.settings.bevel,labelStrip.settings.ratio,labelStrip.settings.scale,labelStrip.settings.concave);this.anchor=anchor.point.clone();this.anchorOffset=cross.offsets[16];
        this.host=host;this.label=document.createElement('div');this.label.className='live-fillet-radius';this.label.style.cssText='position:absolute;pointer-events:none;z-index:12;padding:6px 10px;border:1px solid #d9bd82;border-radius:5px;background:#172330e8;color:#f0d89e;font:600 13px Segoe UI;font-variant-numeric:tabular-nums;white-space:nowrap;';host.appendChild(this.label);
        this.set(value);
    }
    addRecord(a,b,n1,n2,circle=null,points=[a,b]){
        const data=new Float32Array(56),axis=b.clone().sub(a),length=axis.length();axis.normalize();const s=section(n1,n2,this.current.bevel,this.current.ratio,this.current.scale,this.current.concave),boundScale=1+Math.max(1,...s.offsets.map(offset=>offset.length())),box=new CAD.Box3().setFromPoints(points).expandByScalar((this.current.radius<0?this.boundsRadius:this.current.radius)*boundScale);
        const write=(col,p,w=0)=>data.set([p.x,p.y,p.z,w],col*4);
        // Use the uncertainty of this actual rail, not a radius-only epsilon.
        // Circle fitting accepts slightly imperfect/BSP-split rails; their
        // original wall must still be classified as contact with the cut.
        const magnitude=Math.max(1,...box.min.toArray().map(Math.abs),...box.max.toArray().map(Math.abs));
        let contactError=0;
        if(circle){const step=2*Math.PI/circle.count;
            for(const point of points){const delta=point.clone().sub(circle.center),planar=delta.clone().addScaledVector(n1,-delta.dot(n1));
                const angle=Math.atan2(planar.dot(circle.basis),planar.dot(circle.u)),local=((angle%step)+step)%step-step*.5,chord=Math.cos(step*.5)/Math.cos(local);
                contactError=Math.max(contactError,Math.abs(planar.length()/chord-circle.radius),Math.abs(point.clone().sub(a).dot(n1)));
            }
        }
        const contactTolerance=contactError*1.5+magnitude*Math.pow(2,-21);
        write(0,a,circle?(circle.closed===false?2:1):0);write(1,axis,length);write(2,circle?.u??s.dualU,circle?.count??s.d);write(3,circle?.basis??s.dualV);write(4,s.center,contactTolerance);write(5,n1,circle?.radius??0);write(6,circle?.center??v(),circle?.sign??0);write(7,box.min);write(8,box.max);write(9,new CAD.Vector3(this.current.radius,this.current.bevel?1:0,this.current.ratio),circle?.sweep??0);
        if(this.current.start)write(10,this.current.start,this.current.start.dot(this.current.a));
        if(this.current.end)write(11,this.current.end,this.current.end.dot(this.current.b));this.recordBounds.push({base:new CAD.Box3().setFromPoints(points),scale:boundScale});this.records.push(data);return this.records.length-1;
    }
    material(source,skip,patch,skipEnd=skip+1,fixedRadius=-1,closure=false,joined=[]){
        const material=source.clone();
        material.cadLive={owner:this,skip,skipEnd,patch,fixedRadius,closure,joined};
        material.cadSurface=source.cadSurface;
        material.side=source.isMeshDepthMaterial?CAD.DoubleSide:source.side;
        this.materials.push(material);return material;
    }
    set(value){
        if(!Number.isFinite(value)||value<.1)throw new Error('请输入不小于 0.1 mm 的有限尺寸。');
        if(value>this.boundsRadius){this.boundsRadius=value*2;this.records.forEach((row,index)=>{if(row[36]>=0)return;const bounds=this.recordBounds[index],box=bounds.base.clone().expandByScalar(this.boundsRadius*bounds.scale);row.set(box.min.toArray(),28);row.set(box.max.toArray(),32);this.texture.image.data.set(row,index*56);});this.texture.needsUpdate=true;}
        this.radius.value=value;this.value=value;return true;
    }
    frame(camera){if(!this.label)return;const point=this.anchor.clone().addScaledVector(this.anchorOffset,this.value).project(camera);this.label.hidden=point.z< -1||point.z>1;this.label.style.left=Math.max(8,Math.min(this.host.clientWidth-130,(point.x+1)*this.host.clientWidth/2+14))+'px';this.label.style.top=Math.max(8,Math.min(this.host.clientHeight-40,(1-point.y)*this.host.clientHeight/2-18))+'px';this.label.textContent=(this.bevel?'D ':'R ')+Number(this.value.toFixed(2))+' mm';}
    dispose(){this.label?.remove();this.mesh.material=this.original;this.mesh.customDepthMaterial=this.originalDepth;for(const [overlay,material] of this.overlays??[])overlay.material=material;for(const patch of this.patches){patch.removeFromParent();patch.geometry.dispose();}for(const material of this.materials)material.dispose();for(const texture of this.capTextures)texture.dispose();this.capTextures.clear();this.stockTexture?.dispose();this.texture.dispose();this.roundTexture?.dispose();this.patches=[];}
}
