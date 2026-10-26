import * as CAD from './engine/core.js';
// Preserve the requested size. Geometric validity is checked on the result;
// neither neighbour width nor edge length silently changes the user's value.
export function topologyBevelWidth(feature,edges){
    if(edges.some(edge=>edge.kind==='curve'))throw new Error('当前实体倒角路径需要直边。');
    return {distance:feature.depth,maximum:Infinity};
}

// BSP faces may have T-junctions. Weld first, insert matching points on every
// polygon edge, and require a closed, consistently oriented two-manifold mesh.
// A point tree limits edge queries; no such work runs on pointer movement.
export function sewTopologyBevel(polygons,Polygon,retessellate=true,preserveFaces=false){
    if(!preserveFaces)polygons=mergeConvexFaces(polygons,Polygon);
    const epsilon=1e-6,cells=new Map(),points=[];
    const weld=point=>{
        const cell=point.toArray().map(value=>Math.floor(value/epsilon));
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const other of cells.get([cell[0]+x,cell[1]+y,cell[2]+z].join('/'))??[])
            if(other.point.distanceToSquared(point)<=epsilon*epsilon)return other;
        const entry={point:point.clone(),id:points.length};points.push(entry);
        const key=cell.join('/');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);return entry;
    };
    const faces=polygons.map(p=>({source:p,vertices:p.vertices.map(weld)}));
    const tree=entries=>{
        const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
        for(const entry of entries)entry.point.toArray().forEach((value,i)=>{low[i]=Math.min(low[i],value);high[i]=Math.max(high[i],value);});
        if(entries.length<=16)return {low,high,entries};
        let axis=0;for(let i=1;i<3;i++)if(high[i]-low[i]>high[axis]-low[axis])axis=i;
        entries.sort((a,b)=>a.point.getComponent(axis)-b.point.getComponent(axis));const middle=entries.length>>1;
        return {low,high,left:tree(entries.slice(0,middle)),right:tree(entries.slice(middle))};
    };
    if(!points.length)throw new Error('倒角没有生成有效实体。');
    const root=tree([...points]);
    const query=(node,low,high,out)=>{
        if(low.some((value,i)=>value>node.high[i]||high[i]<node.low[i]))return;
        if(node.entries){out.push(...node.entries);return;}
        query(node.left,low,high,out);query(node.right,low,high,out);
    };
    const result=[],incidence=new Map();
    for(const {source,vertices} of faces){
        const ring=[];
        for(let i=0;i<vertices.length;i++){
            const a=vertices[i],b=vertices[(i+1)%vertices.length];if(a.id===b.id)continue;
            const delta=b.point.clone().sub(a.point),length=delta.lengthSq(),near=[];
            const low=a.point.toArray().map((value,k)=>Math.min(value,b.point.getComponent(k))-epsilon);
            const high=a.point.toArray().map((value,k)=>Math.max(value,b.point.getComponent(k))+epsilon);
            query(root,low,high,near);const split=[{entry:a,t:0}];
            for(const entry of near){
                if(entry.id===a.id||entry.id===b.id)continue;
                const t=entry.point.clone().sub(a.point).dot(delta)/length;if(t<=0||t>=1)continue;
                if(a.point.clone().addScaledVector(delta,t).distanceToSquared(entry.point)<=epsilon*epsilon)split.push({entry,t});
            }
            split.sort((a,b)=>a.t-b.t);for(const item of split)if(ring.at(-1)?.id!==item.entry.id)ring.push(item.entry);
        }
        if(ring.length<3)continue;
        const polygon=new Polygon(ring.map(entry=>entry.point),source.tag,1e-8);if(polygon.normal.lengthSq()<.5)continue;
        result.push(polygon);
        const retained=polygon.vertices.map(point=>ring.find(entry=>entry.point===point).id);
        for(let i=0;i<retained.length;i++){
            const a=retained[i],b=retained[(i+1)%retained.length],key=a<b?a+'/'+b:b+'/'+a;
            const item=incidence.get(key)??{count:0,balance:0};item.count++;item.balance+=a<b?1:-1;incidence.set(key,item);
        }
    }
    let open=0,overlap=0,winding=0;
    for(const edge of incidence.values()){if(edge.count===1)open++;else if(edge.count!==2)overlap++;else if(edge.balance!==0)winding++;}
    if(!result.length||open||overlap||winding){
        const error=new Error(`实体闭合检查失败：开口边 ${open}，重叠边 ${overlap}，方向不一致 ${winding}。`);
        if(preserveFaces){
            const failed=new Map(),ids=new Map(points.map(entry=>[entry.point,entry.id]));
            for(const [key,edge] of incidence)if(edge.count!==2||edge.balance!==0){const [a,b]=key.split('/').map(Number);failed.set(key,{a:points[a].point.toArray(),b:points[b].point.toArray(),...edge,owners:[]});}
            for(const polygon of result)for(let i=0;i<polygon.vertices.length;i++){const a=ids.get(polygon.vertices[i]),b=ids.get(polygon.vertices[(i+1)%polygon.vertices.length]),key=a<b?a+'/'+b:b+'/'+a;if(failed.has(key))failed.get(key).owners.push({featureId:polygon.tag.featureId,face:polygon.tag.face});}
            error.boundaryEdges=[...failed.values()];
        }
        throw error;
    }
    return retessellate?sewTopologyBevel(retessellateFaces(result,Polygon),Polygon,false):result;
}

function retessellateFaces(polygons,Polygon){
    const groups=new Map(),result=[],key=p=>p.toArray().map(v=>Math.round(v/1e-6)).join('/');
    for(const p of polygons){if(p.tag.smooth){result.push(p);continue;}const id=JSON.stringify([p.tag.featureId,p.tag.face]);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
    for(const faces of groups.values()){
        const source=faces[0];if(faces.some(p=>p.normal.dot(source.normal)<1-1e-10||Math.abs(p.w-source.w)>1e-6)){for(const face of faces)result.push(face);continue;}
        const boundary=new Map();
        for(const p of faces)for(let i=0;i<p.vertices.length;i++){const a=p.vertices[i],b=p.vertices[(i+1)%p.vertices.length],id=key(a)+'>'+key(b),opposite=key(b)+'>'+key(a);if(boundary.has(opposite))boundary.delete(opposite);else boundary.set(id,{a,b});}
        const outgoing=new Map();let valid=true;
        for(const edge of boundary.values()){const id=key(edge.a);if(outgoing.has(id)){valid=false;break;}outgoing.set(id,edge);}
        if(!valid){for(const face of faces)result.push(face);continue;}
        const loops=[];
        while(outgoing.size){const start=outgoing.keys().next().value,ring=[];let current=start;
            do{const edge=outgoing.get(current);if(!edge){valid=false;break;}ring.push(edge.a);outgoing.delete(current);current=key(edge.b);}while(current!==start);
            if(!valid)break;
            let changed=true;while(changed&&ring.length>3){changed=false;for(let i=0;i<ring.length;i++){const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length],d=c.clone().sub(a),t=b.clone().sub(a).dot(d)/d.lengthSq();if(t>=0&&t<=1&&a.clone().addScaledVector(d,t).distanceToSquared(b)<1e-12){ring.splice(i,1);changed=true;break;}}}
            loops.push(ring);
        }
        if(!valid){for(const face of faces)result.push(face);continue;}
        const n=source.normal,u=(Math.abs(n.z)<.8?new CAD.Vector3(0,0,1):new CAD.Vector3(0,1,0)).cross(n).normalize(),v=n.clone().cross(u),project=ring=>ring.map(p=>new CAD.Vector2(p.dot(u),p.dot(v))),data=loops.map(ring=>({ring,points:project(ring)}));
        const inside=(p,ring)=>{let value=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)value=!value;}return value;};
        const outers=data.filter(loop=>CAD.ShapeUtils.area(loop.points)>0),holes=data.filter(loop=>CAD.ShapeUtils.area(loop.points)<0);
        if(!outers.length){for(const face of faces)result.push(face);continue;}
        for(const outer of outers){const contained=holes.filter(hole=>inside(hole.points[0],outer.points)),points=[outer.ring,...contained.map(hole=>hole.ring)].flat();
            for(const triangle of CAD.ShapeUtils.triangulateShape(outer.points,contained.map(hole=>hole.points))){const p=new Polygon(triangle.map(i=>points[i]),source.tag,1e-8);if(p.normal.dot(n)<0)p.flip();if(p.normal.lengthSq()>.5)result.push(p);}
        }
    }
    return result;
}

// Remove BSP's internal coplanar diagonals, but never bridge a hole or a
// concave boundary: merge only when the convex hull has exactly the same area.
function mergeConvexFaces(polygons,Polygon){
    const groups=new Map(),result=[];
    for(const p of polygons){
        if(p.tag.smooth){result.push(p);continue;}
        const key=JSON.stringify([p.tag.featureId,p.tag.face]);
        if(!groups.has(key))groups.set(key,[]);
        const clusters=groups.get(key);let group=clusters.find(faces=>faces[0].normal.dot(p.normal)>1-1e-10&&Math.abs(faces[0].w-p.w)<1e-6);
        if(!group){group=[];clusters.push(group);}group.push(p);
    }
    for(const faces of [...groups.values()].flat()){
        if(faces.length===1){result.push(faces[0]);continue;}
        const source=faces[0],n=source.normal,drop=n.toArray().map(Math.abs).indexOf(Math.max(...n.toArray().map(Math.abs))),axes=[0,1,2].filter(i=>i!==drop);
        const entries=faces.flatMap(p=>p.vertices).map(point=>({point,x:Math.round(point.getComponent(axes[0])/1e-7)*1e-7,y:Math.round(point.getComponent(axes[1])/1e-7)*1e-7})).sort((a,b)=>a.x-b.x||a.y-b.y),unique=entries.filter((p,i)=>!i||Math.abs(p.x-entries[i-1].x)>1e-8||Math.abs(p.y-entries[i-1].y)>1e-8);
        const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),half=points=>{const hull=[];for(const p of points){while(hull.length>1&&cross(hull.at(-2),hull.at(-1),p)<=1e-10)hull.pop();hull.push(p);}return hull;};
        const lower=half(unique),upper=half([...unique].reverse()),ring=[...lower.slice(0,-1),...upper.slice(0,-1)].map(p=>p.point);
        let changed=true;while(changed&&ring.length>3){changed=false;for(let i=0;i<ring.length;i++){const a=ring[(i+ring.length-1)%ring.length],b=ring[i],c=ring[(i+1)%ring.length],direction=c.clone().sub(a),t=b.clone().sub(a).dot(direction)/direction.lengthSq();if(t>=0&&t<=1&&a.clone().addScaledVector(direction,t).distanceToSquared(b)<1e-12){ring.splice(i,1);changed=true;break;}}}
        if(ring.length<3){for(const face of faces)result.push(face);continue;}
        const merged=new Polygon(ring,source.tag);if(merged.normal.dot(n)<0)merged.flip();
        const area=p=>{let value=0;for(let i=1;i<p.vertices.length-1;i++)value+=p.vertices[i].clone().sub(p.vertices[0]).cross(p.vertices[i+1].clone().sub(p.vertices[0])).dot(n)*.5;return Math.abs(value);};
        const original=faces.reduce((sum,p)=>sum+area(p),0);
        if(Math.abs(area(merged)-original)<=Math.max(1e-10,original*1e-12))result.push(merged);else for(const face of faces)result.push(face);
    }
    return result;
}


