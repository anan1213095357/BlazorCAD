using System.Text.Json;

namespace BlazorCAD.Models;

public sealed class CadDeletionPlan
{
    public string Snapshot { get; private init; } = "";
    public string Label { get; private init; } = "";
    public string? EntityId { get; private init; }
    public HashSet<string> SketchIds { get; } = [];
    public HashSet<string> FeatureIds { get; } = [];
    public List<string> AffectedItems { get; } = [];
    public bool HasDependents { get; private set; }

    public static CadDeletionPlan Create(CadDocument doc,string kind,string id,string? sketchId=null)
    {
        var label=kind switch {
            "sketch"=>doc.Sketches.First(s=>s.Id==id).Name,
            "feature"=>doc.Features.First(f=>f.Id==id).Label+" "+(doc.Features.FindIndex(f=>f.Id==id)+1),
            _=>doc.Sketches.First(s=>s.Id==sketchId).Name+" · 图元 "+(doc.Sketches.First(s=>s.Id==sketchId).Entities.FindIndex(e=>e.Id==id)+1)
        };
        var plan=new CadDeletionPlan{Snapshot=JsonSerializer.Serialize(doc),Label=label,EntityId=kind=="entity"?id:null};
        if(kind=="sketch")plan.SketchIds.Add(id);
        if(kind=="feature")plan.FeatureIds.Add(id);
        bool UsesEntity(CadFeature feature){
            if(plan.EntityId is not {} entityId)return false;
            bool KeysUse(IEnumerable<string> keys)=>keys.Any(key=>key.Contains(entityId,StringComparison.Ordinal));
            if(feature.Mode!="chamfer"&&feature.SketchId==sketchId&&(feature.ProfileId==entityId||feature.SourceEntityIds.Contains(entityId)||feature.AxisEntityId==entityId||KeysUse(feature.RegionKeys)||feature.Mode=="sweep"&&feature.ThinWall&&(feature.OpenProfileEntityId==entityId||feature.OpenProfileEntityId is null&&doc.Sketches.First(s=>s.Id==sketchId).Entities.Any(e=>e.Id==entityId&&e.Kind=="line"&&!e.Construction))))return true;
            if((feature.AxisSketchId??feature.SketchId)==sketchId&&feature.AxisEntityId==entityId)return true;
            if(feature.PathSketchId==sketchId&&(feature.PathEntityId==entityId||feature.PathEntityId is null&&doc.Sketches.First(s=>s.Id==sketchId).Entities.Any(e=>e.Id==entityId&&e.Kind=="line")))return true;
            return feature.Sections.Any(section=>section.SketchId==sketchId&&KeysUse(section.RegionKeys));
        }
        bool changed;
        do{
            changed=false;
            foreach(var sketch in doc.Sketches)if(sketch.Plane.FeatureId is {} parent&&plan.FeatureIds.Contains(parent))changed|=plan.SketchIds.Add(sketch.Id);
            foreach(var sketch in doc.Sketches)if(sketch.Plane.SourceSketchId is {} source&&(plan.SketchIds.Contains(source)||plan.EntityId is {} removed&&source==sketchId&&sketch.Plane.CenterRegionKeys.Any(key=>key.Contains(removed,StringComparison.Ordinal))))changed|=plan.SketchIds.Add(sketch.Id);
            foreach(var feature in doc.Features){
                bool MissingFace(SketchPlane? face)=>face?.FeatureId is {} parent&&plan.FeatureIds.Contains(parent);
                if(UsesEntity(feature)||plan.SketchIds.Contains(feature.SketchId)||feature.AxisSketchId is {} axisSketch&&plan.SketchIds.Contains(axisSketch)||feature.PathSketchId is {} path&&plan.SketchIds.Contains(path)||feature.Sections.Any(section=>plan.SketchIds.Contains(section.SketchId))||feature.Sections.Any(section=>MissingFace(section.Face))||MissingFace(feature.TargetFace)||MissingFace(feature.AxisModelEdge?.FaceA)||MissingFace(feature.AxisModelEdge?.FaceB)||feature.ChamferEdges.Any(edge=>MissingFace(edge.FaceA)||MissingFace(edge.FaceB))||MissingFace(feature.ChamferEdge?.FaceA)||MissingFace(feature.ChamferEdge?.FaceB))changed|=plan.FeatureIds.Add(feature.Id);
            }
        }while(changed);
        foreach(var feature in doc.Features.Where(f=>plan.FeatureIds.Contains(f.Id)))plan.AffectedItems.Add(feature.Label+" "+(doc.Features.IndexOf(feature)+1));
        foreach(var sketch in doc.Sketches.Where(s=>plan.SketchIds.Contains(s.Id)))plan.AffectedItems.Add(sketch.Name);
        plan.HasDependents=plan.FeatureIds.Count>(kind=="feature"?1:0)||plan.SketchIds.Count>(kind=="sketch"?1:0);
        return plan;
    }

    public static CadDeletionPlan ForBody(CadDocument doc,CadBodyInfo body){
        var plan=new CadDeletionPlan{Snapshot=JsonSerializer.Serialize(doc),Label=body.Name};
        void Merge(CadDeletionPlan item){plan.FeatureIds.UnionWith(item.FeatureIds);plan.SketchIds.UnionWith(item.SketchIds);}
        foreach(var id in body.FeatureIds)Merge(Create(doc,"feature",id));
        var related=doc.Features.Where(f=>plan.FeatureIds.Contains(f.Id)).SelectMany(f=>new[]{f.SketchId,f.PathSketchId,f.AxisSketchId}.Concat(f.Sections.Select(s=>s.SketchId))).Where(id=>id is not null).ToHashSet();
        foreach(var sketch in doc.Sketches.Where(s=>related.Contains(s.Id))){
            if(!doc.Features.Any(f=>!plan.FeatureIds.Contains(f.Id)&&(f.SketchId==sketch.Id||f.PathSketchId==sketch.Id||f.AxisSketchId==sketch.Id||f.Sections.Any(section=>section.SketchId==sketch.Id))))Merge(Create(doc,"sketch",sketch.Id));
        }
        foreach(var feature in doc.Features.Where(f=>plan.FeatureIds.Contains(f.Id)))plan.AffectedItems.Add(feature.Label+" "+(doc.Features.IndexOf(feature)+1));
        foreach(var sketch in doc.Sketches.Where(s=>plan.SketchIds.Contains(s.Id)))plan.AffectedItems.Add(sketch.Name);
        plan.HasDependents=true;return plan;
    }
    public void Apply(CadDocument doc)
    {
        if(JsonSerializer.Serialize(doc)!=Snapshot)throw new ArgumentException("项目已经变化，请重新选择删除对象。");
        var removedEntities=doc.Sketches.Where(s=>SketchIds.Contains(s.Id)).SelectMany(s=>s.Entities).Select(e=>e.Id).ToHashSet();
        if(EntityId is not null)removedEntities.Add(EntityId);
        doc.Features.RemoveAll(f=>FeatureIds.Contains(f.Id));
        foreach(var key in doc.Materials.Keys.Where(key=>FeatureIds.Contains(key.Split('~')[0])).ToList())doc.Materials.Remove(key);
        doc.Sketches.RemoveAll(s=>SketchIds.Contains(s.Id));
        foreach(var sketch in doc.Sketches){
            sketch.Entities.RemoveAll(e=>removedEntities.Contains(e.Id));
            foreach(var entity in sketch.Entities){
                entity.Coincidences.RemoveAll(c=>c.Target.EntityId is {} target&&removedEntities.Contains(target)||c.Target.Faces.Any(face=>face.FeatureId is {} feature&&FeatureIds.Contains(feature)));
                var removedDimensions=entity.ModelDimensions.Where(d=>d.ReferenceEntityId is {} target&&removedEntities.Contains(target)||d.ReferenceEntityId is null&&d.ReferenceFace.FeatureId is {} feature&&FeatureIds.Contains(feature)).Select(d=>d.Index).ToHashSet();
                entity.ModelDimensions.RemoveAll(d=>removedDimensions.Contains(d.Index));foreach(var index in removedDimensions)entity.DimensionPlacements.Remove(index);
                if(entity.ReferenceLineId is {} line&&removedEntities.Contains(line)){entity.ReferenceLineId=null;entity.ReferenceOffset=0;entity.DimensionPlacements.Remove(-1);}
            }
        }
    }
}
