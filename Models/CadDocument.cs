namespace BlazorCAD.Models;

public sealed class DimensionPlacement
{
    public double X { get; set; }
    public double Y { get; set; }
}

public sealed class ModelEdgeDimension
{
    public int Index { get; set; } = -2;
    public int Edge { get; set; }
    public SketchPlane ReferenceFace { get; set; } = new();
    public string? ReferenceEntityId { get; set; }
    public int ReferenceEdge { get; set; }
    public double Distance { get; set; }
    public int Side { get; set; } = 1;
}

public sealed class CoincidentTarget
{
    public string Kind { get; set; } = "origin";
    public string? EntityId { get; set; }
    public string Point { get; set; } = "center";
    public List<SketchPlane> Faces { get; set; } = [];
    public double Parameter { get; set; }
}
public sealed class CoincidentConstraint
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Point { get; set; } = "center";
    public CoincidentTarget Target { get; set; } = new();
    [System.Text.Json.Serialization.JsonIgnore]
    public string Description => (Point switch {"start"=>"起点","end"=>"终点","center"=>"中心","topLeft"=>"左上角","topRight"=>"右上角","bottomLeft"=>"左下角","bottomRight"=>"右下角",_=>"约束点"})+" · "+(Target.Kind switch {"sketch"=>"与草图点重合","origin"=>"与草图原点重合","modelVertex"=>"与实体顶点重合","modelMidpoint"=>"与实体边中点重合","modelCenter"=>"与实体面中心重合","modelProfilePoint"=>"与实体圆弧中心重合","modelEdge"=>"点在实体边上","modelEdgePoint"=>"与实体边上参照点重合",_=>"重合关系"});
}
public sealed class SketchEditIntent
{
    public string EntityId { get; set; } = "";
    public string Field { get; set; } = "";
    public double Value { get; set; }
}

public sealed class ModelDimensionAdjustment
{
    public string SketchId { get; set; } = "";
    public string EntityId { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public double Radius { get; set; }
}

public sealed class SketchEntity
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Kind { get; set; } = "rectangle";
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; } = 1;
    public double Height { get; set; } = 1;
    public double Radius { get; set; } = 1;
    public double Angle { get; set; }
    public int Sides { get; set; } = 6;
    public double StartAngle { get; set; }
    public double SweepAngle { get; set; } = 90;
    public string FixedPoint { get; set; } = "none";
    public bool Construction { get; set; }
    public string? ReferenceLineId { get; set; }
    public double ReferenceOffset { get; set; }
    public bool IsStraightEdge(int edge) => Kind=="polygon" ? edge>=0&&edge<Sides : Kind=="rectangle" ? edge is >=0 and <=3 : Kind=="slot" ? edge is 0 or 2 : Kind=="line" && edge==0;
    public int EdgeCount => Kind=="polygon"?Sides:Kind is "circle" or "arc" or "line" ? 1 : Kind is "slot" or "ellipse" ? 2 : 4;
    public (double X,double Y) Anchor() {
        var point=(Kind is "circle" or "arc" or "polygon")||FixedPoint=="start"?(X,Y):FixedPoint switch {"center"=>(X+Width/2,Y+Height/2),"topLeft"=>(X,Y+Height),"topRight" or "end"=>(X+Width,Y+Height),"bottomRight"=>(X+Width,Y),_=>(X,Y)};
        if(Kind is not ("slot" or "ellipse")||Angle==0)return point;
        var a=Angle*Math.PI/180;var cx=X+Width/2;var cy=Y+Height/2;var dx=point.Item1-cx;var dy=point.Item2-cy;
        return (cx+Math.Cos(a)*dx-Math.Sin(a)*dy,cy+Math.Sin(a)*dx+Math.Cos(a)*dy);
    }
    public void KeepAnchor((double X,double Y) before) { if(FixedPoint == "none")return; var after=Anchor();X+=before.X-after.X;Y+=before.Y-after.Y; }
    // Edge indices: rectangle bottom/right/top/left; circle = 0.
    public List<int> DimensionedEdges { get; set; } = [];
    public List<ModelEdgeDimension> ModelDimensions { get; set; } = [];
    public List<CoincidentConstraint> Coincidences { get; set; } = [];
    public bool IsPoint(string point) {
        if(Kind=="polygon")return point=="center"||((point.StartsWith("vertex")&&int.TryParse(point[6..],out var vertex)&&vertex>=0&&vertex<Sides)||(point.StartsWith("mid")&&int.TryParse(point[3..],out var mid)&&mid>=0&&mid<Sides));
        if(Kind=="arc")return point is "center" or "start" or "end" or "midArc";
        if(Kind=="circle")return point is "center" or "east" or "north" or "west" or "south" or "perimeter";
        if(Kind=="ellipse")return point is "center" or "east" or "north" or "west" or "south";
        return Kind=="line"?point is "start" or "end" or "center":new[]{"bottomLeft","bottomRight","topLeft","topRight","bottomMid","rightMid","topMid","leftMid","center"}.Contains(point)||(Kind=="slot"&&(point is "leftCenter" or "rightCenter"));
    }
    public Dictionary<int, DimensionPlacement> DimensionPlacements { get; set; } = [];
    [System.Text.Json.Serialization.JsonIgnore]
    public IEnumerable<int> RotationEdges => Kind switch {"line"=>new[]{0},"rectangle"=>Enumerable.Range(0,4),"polygon"=>Enumerable.Range(0,Sides),"slot" when Width>Height=>new[]{0,2},_=>Array.Empty<int>()};
    public List<int> DisplayEdges => DimensionedEdges.Distinct().ToList();
}

public sealed class SketchPlane
{
    public string? SourceSketchId { get; set; }
    public List<string> CenterRegionKeys { get; set; } = [];
    public string Reference { get; set; } = "XY";
    public double Offset { get; set; }
    public string? FeatureId { get; set; }
    public string Face { get; set; } = "top";
}

public sealed class CadSketch
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "草图";
    public SketchPlane Plane { get; set; } = new();
    public bool Finished { get; set; }
    public bool Hidden { get; set; }
    public List<SketchEntity> Entities { get; set; } = [];
}

public sealed class CadLoftSection
{
    public SketchPlane? Face { get; set; }
    public double FaceX { get; set; }
    public double FaceY { get; set; }
    public string SketchId { get; set; } = "";
    public List<string> RegionKeys { get; set; } = [];
}
public class CadModelEdgeReference
{
    public SketchPlane FaceA { get; set; } = new();
    public SketchPlane FaceB { get; set; } = new();
    public int Segment { get; set; }
}
public sealed class CadChamferEdge : CadModelEdgeReference { public string Kind { get; set; } = "line"; }
public sealed class CadLoftChoice
{
    public string Value { get; set; } = "";
    public string Label { get; set; } = "";
    public string SketchId { get; set; } = "";
    public List<string> RegionKeys { get; set; } = [];
}
public sealed class CadFeature
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Kind { get; set; } = "extrude";
    public string SketchId { get; set; } = "";
    public string Mode { get; set; } = "extrude";
    public double Angle { get; set; } = 360;
    public string Axis { get; set; } = "Y";
    public double AxisOffset { get; set; }
    public string? AxisEntityId { get; set; }
    public string? AxisSketchId { get; set; }
    public int AxisEdgeIndex { get; set; }
    public CadModelEdgeReference? AxisModelEdge { get; set; }
    public bool ThinWall { get; set; }
    public string? OpenProfileEntityId { get; set; }
    public double WallThickness { get; set; } = 2;
    public string WallSide { get; set; } = "center";
    public string? PathSketchId { get; set; }
    public string? PathEntityId { get; set; }
    public string PathInterpolation { get; set; } = "native";
    public string SweepOrientation { get; set; } = "follow";
    public List<CadLoftSection> Sections { get; set; } = [];
    public CadChamferEdge? ChamferEdge { get; set; }
    public List<CadChamferEdge> ChamferEdges { get; set; } = [];
    public string EdgeTreatment { get; set; } = "chamfer";
    public bool VisualOnly { get; set; }
    public bool TopologyBevel { get; set; }
    public string? AppearanceSourceId { get; set; }
    public double ChamferAngle { get; set; } = 45;
    [System.Text.Json.Serialization.JsonIgnore]
    public string Label => Mode=="chamfer"?(EdgeTreatment=="fillet"?"圆角":"倒角"):(Mode switch { "revolve"=>"旋转", "sweep"=>ThinWall?"薄壁扫描":"扫描", "loft"=>"放样", _=>"拉伸" })+(Kind=="cut"?"切除":"凸台");
    public string ProfileId { get; set; } = "";
    public List<string> RegionKeys { get; set; } = [];
    public List<string> SourceEntityIds { get; set; } = [];
    public int Edge { get; set; }
    public double Depth { get; set; } = 20;
    public string EndCondition { get; set; } = "blind";
    public bool Reversed { get; set; }
    public SketchPlane? TargetFace { get; set; }
}

public sealed class CadDocument
{
    public int Version { get; set; } = 2;
    public string Name { get; set; } = "未命名零件";
    public List<CadSketch> Sketches { get; set; } = [];
    public List<CadFeature> Features { get; set; } = [];
    public Dictionary<string,CadAppearance> Materials { get; set; } = [];
    public string Environment { get; set; } = "studio";

    public void ApplyReferenceConstraints()
    {
        foreach(var sketch in Sketches)
        foreach(var e in sketch.Entities.Where(e=>e.ReferenceLineId is not null && e.ModelDimensions.Count==0))
        {
            var line=sketch.Entities.FirstOrDefault(l=>l.Id==e.ReferenceLineId && l.Kind=="line");
            if(line is null || e.Kind=="line" || !double.IsFinite(e.ReferenceOffset) || Math.Abs(e.ReferenceOffset)>1000)
                throw new ArgumentException("参考线距离约束无效，请先解除相关引用。");
            var length=Math.Sqrt(line.Width*line.Width+line.Height*line.Height);
            if(length<1)throw new ArgumentException("直线长度至少为 1 mm。");
            var nx=-line.Height/length;var ny=line.Width/length;
            var cx=e.Kind is "circle" or "arc" or "polygon"?e.X:e.X+e.Width/2;var cy=e.Kind is "circle" or "arc" or "polygon"?e.Y:e.Y+e.Height/2;
            var delta=e.ReferenceOffset-((cx-line.X)*nx+(cy-line.Y)*ny);
            if(e.FixedPoint!="none" && Math.Abs(delta)>.00001)throw new ArgumentException("参考线距离与固定点冲突，请解除其中一个约束。");
            e.X+=nx*delta;e.Y+=ny*delta;
        }
    }

    public void Validate()
    {
        if(string.IsNullOrWhiteSpace(Name)||Name.Length>120)throw new ArgumentException("项目名称必须为 1–120 个字符。");
        if (Version != 2 || Sketches is null || Features is null || Sketches.Count > 100 || Features.Count > 100)
            throw new ArgumentException("项目格式不支持，或特征数量超出限制。");
        if (Sketches.Any(s => s is null) || Features.Any(f => f is null)) throw new ArgumentException("项目包含空记录。");
        if (Sketches.Select(s => s.Id).Distinct().Count() != Sketches.Count || Features.Select(f => f.Id).Distinct().Count() != Features.Count)
            throw new ArgumentException("项目标识重复。");
        if (Sketches.Count(s => !s.Finished) > 1) throw new ArgumentException("请先结束当前草图。");
        if(Features.Any(f=>f.Sections is null||f.Sections.Any(section=>section is null)||f.ChamferEdges is null||f.ChamferEdges.Any(edge=>edge is null)))throw new ArgumentException("特征截面记录无效。");
        if(Materials is null||Materials.Count>100||Environment is not ("studio" or "workshop" or "soft" or "none"))throw new ArgumentException("环境或材质数据无效。");
        foreach(var material in Materials.Values){if(material is null)throw new ArgumentException("材质数据无效。");material.Validate();}
        var entityIds = new HashSet<string>();
        foreach (var s in Sketches)
        {
            if (string.IsNullOrWhiteSpace(s.Id) || s.Plane is null || string.IsNullOrWhiteSpace(s.Plane.Face) || s.Entities is null || s.Entities.Count > 100)
                throw new ArgumentException("草图数据无效。");
            if (s.Plane.FeatureId is null && s.Plane.Reference is not ("XY" or "XZ" or "YZ"))
                throw new ArgumentException("请选择有效基准面。");
            if(!double.IsFinite(s.Plane.Offset)||Math.Abs(s.Plane.Offset)>1000||s.Plane.FeatureId is not null&&s.Plane.Offset!=0)throw new ArgumentException("基准面偏移必须在 -1000–1000 mm 之间。");
            if(s.Plane.SourceSketchId is {} centerSource){
                var source=Sketches.FirstOrDefault(x=>x.Id==centerSource);
                if(source is null||Sketches.IndexOf(source)>=Sketches.IndexOf(s)||s.Plane.FeatureId is not null||s.Plane.Offset!=0||s.Plane.CenterRegionKeys is null||s.Plane.CenterRegionKeys.Count==0||s.Plane.CenterRegionKeys.Count>500||s.Plane.CenterRegionKeys.Any(string.IsNullOrWhiteSpace))throw new ArgumentException("中心路径平面必须引用更早草图中的闭合截面。");
            }
            foreach (var e in s.Entities)
            {
                if (e is null || string.IsNullOrWhiteSpace(e.Id) || !entityIds.Add(e.Id) || e.Kind is not ("rectangle" or "circle" or "slot" or "line" or "ellipse" or "arc" or "polygon") || e.DimensionedEdges is null)
                    throw new ArgumentException("轮廓数据无效。");
                if (new[] { e.X, e.Y, e.Width, e.Height, e.Radius }.Any(v => !double.IsFinite(v) || Math.Abs(v) > 1000) || (e.Kind != "line" && (e.Width < 1 || e.Height < 1)) || e.Radius < 1)
                    throw new ArgumentException("尺寸必须在 1–1000 mm 范围内，坐标绝对值不得超过 1000 mm。");
                if(e.Kind=="polygon"&&(e.Sides<3||e.Sides>12))throw new ArgumentException("多边形边数必须为 3–12。");
                if(e.Kind=="arc"&&(!double.IsFinite(e.StartAngle)||!double.IsFinite(e.SweepAngle)||Math.Abs(e.StartAngle)>360||Math.Abs(e.SweepAngle)<1||Math.Abs(e.SweepAngle)>359))throw new ArgumentException("圆弧角度无效，扫角应为 1–359 度。");
                if(!double.IsFinite(e.Angle)||Math.Abs(e.Angle)>360)throw new ArgumentException("方向角度必须在 -360–360 度之间。");
                if(e.Kind == "slot" && e.Width < e.Height) throw new ArgumentException("长圆槽总长不能小于槽宽。");
                if(e.Kind == "line" && Math.Sqrt(e.Width*e.Width+e.Height*e.Height)<1) throw new ArgumentException("直线长度至少为 1 mm。");
                if(e.ReferenceLineId is not null && (e.Kind=="line" || !s.Entities.Any(l=>l.Id==e.ReferenceLineId&&l.Kind=="line") || !double.IsFinite(e.ReferenceOffset) || Math.Abs(e.ReferenceOffset)>1000))throw new ArgumentException("参考线距离约束无效。");
                var anchors=e.Kind is "circle" or "arc" or "polygon" or "ellipse"?new[]{"none","center"}:e.Kind=="line"?new[]{"none","start","end"}:new[]{"none","center","bottomLeft","topLeft","topRight","bottomRight"};
                if(!anchors.Contains(e.FixedPoint))throw new ArgumentException("固定点约束无效。");
                if (e.DimensionedEdges.Any(i => i < 0 || i >= e.EdgeCount)) throw new ArgumentException("标注边无效。");
                if(e.Coincidences is null || e.Coincidences.Count>8 || e.Coincidences.Any(c=>c is null || string.IsNullOrWhiteSpace(c.Id) || !e.IsPoint(c.Point) || c.Target is null || c.Target.Faces is null || c.Target.Faces.Any(face=>face is null)) || e.Coincidences.Select(c=>c.Id).Distinct().Count()!=e.Coincidences.Count)throw new ArgumentException("重合约束数据无效。");
                foreach(var c in e.Coincidences) {
                    var target=c.Target;
                    if(target.Kind=="modelEdgePoint"&&(!double.IsFinite(target.Parameter)||target.Parameter<0||target.Parameter>1))throw new ArgumentException("边上参照点无效。");
                    if(target.Kind=="modelEdge"&&c.Point=="perimeter")throw new ArgumentException("圆周吸附需要有效的边上参照点。");
                    if(target.Kind=="sketch") {
                        var source=s.Entities.FirstOrDefault(candidate=>candidate.Id==target.EntityId);
                        if(source is null || source.Id==e.Id || !source.IsPoint(target.Point) || target.Point=="perimeter")throw new ArgumentException("重合约束引用的草图点已不存在。");
                    } else if(target.Kind=="origin") { }
                    else if(target.Kind is "modelVertex" or "modelMidpoint" or "modelCenter" or "modelProfilePoint" or "modelEdge" or "modelEdgePoint") {
                        if(s.Plane.FeatureId is null || target.Faces.Count!=(target.Kind=="modelVertex"?2:target.Kind is "modelMidpoint" or "modelProfilePoint" or "modelEdge" or "modelEdgePoint"?1:0))throw new ArgumentException("重合约束引用的实体点无效。");
                        if(target.Kind=="modelProfilePoint"){
                            var feature=Features.FirstOrDefault(f=>f.Id==target.Faces[0].FeatureId);
                            var source=Sketches.FirstOrDefault(candidate=>candidate.Id==feature?.SketchId)?.Entities.FirstOrDefault(candidate=>candidate.Id==target.EntityId);
                            if(source is null||source.Kind is not ("circle" or "slot" or "arc" or "ellipse")||!source.IsPoint(target.Point))throw new ArgumentException("圆弧中心引用无效。");
                        }
                        foreach(var face in target.Faces) {
                            var reference=Features.FindIndex(f=>f.Id==face?.FeatureId);var consumer=Features.FindIndex(f=>f.Mode!="chamfer"&&(f.SketchId==s.Id||f.PathSketchId==s.Id||f.AxisSketchId==s.Id||f.Sections.Any(section=>section.SketchId==s.Id)));
                            if(face is null || string.IsNullOrWhiteSpace(face.Face) || reference<0 || (consumer>=0&&reference>=consumer) || Features[reference].SketchId==s.Id)throw new ArgumentException("重合约束必须引用更早实体上的点。");
                        }
                    } else throw new ArgumentException("重合约束引用类型无效。");
                }
                if(e.ModelDimensions is null || e.ModelDimensions.Count>16 || e.ModelDimensions.Any(d=>d is null || !e.IsStraightEdge(d.Edge) || d.Index > -2 || (d.ReferenceEntityId is null && (d.ReferenceFace?.FeatureId is null || string.IsNullOrWhiteSpace(d.ReferenceFace.Face))) || !double.IsFinite(d.Distance) || d.Distance<0 || d.Distance>1000 || d.Side is not (1 or -1)) || e.ModelDimensions.Select(d=>d.Index).Distinct().Count()!=e.ModelDimensions.Count)
                    throw new ArgumentException("两条边的距离标注无效。");
                foreach(var d in e.ModelDimensions)
                {
                    if(d.ReferenceEntityId is not null) {
                        var source=s.Entities.FirstOrDefault(candidate=>candidate.Id==d.ReferenceEntityId);
                        if(source is null || !source.IsStraightEdge(d.ReferenceEdge) || (source.Id==e.Id&&d.ReferenceEdge==d.Edge))throw new ArgumentException("两边距离必须引用两条不同的草图直边。");
                        continue;
                    }
                    var reference=Features.FindIndex(f=>f.Id==d.ReferenceFace.FeatureId);
                    var consumer=Features.FindIndex(f=>f.Mode!="chamfer"&&(f.SketchId==s.Id||f.PathSketchId==s.Id||f.AxisSketchId==s.Id||f.Sections.Any(section=>section.SketchId==s.Id)));
                    if(s.Plane.FeatureId is null || reference<0 || (consumer>=0&&reference>=consumer) || Features[reference].SketchId==s.Id)
                        throw new ArgumentException("实体边标注必须引用更早实体上的边。");
                }
                if(e.DimensionPlacements is null || e.DimensionPlacements.Any(p=>(p.Key < -1 && !e.ModelDimensions.Any(d=>d.Index==p.Key)) || p.Key>=e.EdgeCount || p.Value is null || !double.IsFinite(p.Value.X) || !double.IsFinite(p.Value.Y) || Math.Abs(p.Value.X)>10000 || Math.Abs(p.Value.Y)>10000))
                    throw new ArgumentException("标注位置无效。");
            }
        }
        var built = new HashSet<string>();
        foreach (var f in Features)
        {
            var s = Sketches.FirstOrDefault(s => s.Id == f.SketchId);
            var e = s?.Entities.FirstOrDefault(e => e.Id == f.ProfileId);
            if (string.IsNullOrWhiteSpace(f.Id) || built.Contains(f.Id) || f.Kind is not ("extrude" or "cut") || s is null || f.RegionKeys is null || f.SourceEntityIds is null)
                throw new ArgumentException("特征引用无效。");
            foreach(var used in Sketches.Where(sketch=>sketch.Id==f.SketchId||sketch.Id==f.PathSketchId||sketch.Id==f.AxisSketchId||f.Sections.Any(section=>section.SketchId==sketch.Id))){
                var plane=used.Plane;
                while(true){if(plane.FeatureId is {} dependency&&!built.Contains(dependency))throw new ArgumentException("截面或路径依附面必须来自更早的特征。");if(plane.SourceSketchId is not {} sourceId)break;plane=Sketches.First(sketch=>sketch.Id==sourceId).Plane;}
            }
            if(f.Mode is not ("extrude" or "revolve" or "sweep" or "loft" or "chamfer"))throw new ArgumentException("特征生成方式无效。");
            if(f.Mode=="revolve"&&(!double.IsFinite(f.Angle)||f.Angle<1||f.Angle>360||f.Axis is not ("X" or "Y")||!double.IsFinite(f.AxisOffset)||Math.Abs(f.AxisOffset)>1000||f.AxisModelEdge is null&&f.AxisEntityId is not null&&!Sketches.Any(sketch=>sketch.Id==(f.AxisSketchId??s.Id)&&sketch.Entities.Any(e=>e.Id==f.AxisEntityId&&e.RotationEdges.Contains(f.AxisEdgeIndex)))))throw new ArgumentException("请选择有效旋转轴，角度范围为 1–360 度。");
            if(f.AxisModelEdge is {} modelAxis){
                var faceA=modelAxis.FaceA;var faceB=modelAxis.FaceB;
                if(f.Mode!="revolve"||f.AxisEntityId is not null||f.AxisSketchId is not null||modelAxis.Segment<0||faceA is null||faceB is null||faceA.FeatureId is null||faceB.FeatureId is null||!built.Contains(faceA.FeatureId)||!built.Contains(faceB.FeatureId)||string.IsNullOrWhiteSpace(faceA.Face)||string.IsNullOrWhiteSpace(faceB.Face)||faceA.Face=="curved"||faceB.Face=="curved")throw new ArgumentException("旋转轴需要引用更早实体上的有效直线棱边。");
            }
            if(f.Sections is null||f.Sections.Count>8)throw new ArgumentException("放样最多支持 8 个后续截面。");
            if(f.ThinWall&&f.Mode!="sweep")throw new ArgumentException("开放截面薄壁模式目前用于扫描特征。");
            if(f.Mode=="sweep"){
                if(f.SweepOrientation is not ("follow" or "profile"))throw new ArgumentException("扫描截面方向无效。");
                if(f.ThinWall&&(!double.IsFinite(f.WallThickness)||f.WallThickness<.1||f.WallThickness>1000||f.WallSide is not ("center" or "left" or "right")||f.OpenProfileEntityId is not null&&!s.Entities.Any(e=>e.Id==f.OpenProfileEntityId&&!e.Construction&&e.Kind is ("line" or "arc"))||f.OpenProfileEntityId is null&&!s.Entities.Any(e=>e.Kind=="line"&&!e.Construction)))throw new ArgumentException("薄壁扫描需要开放直线、圆弧或连续直线链，厚度应为 0.1–1000 mm。");
                if(f.PathInterpolation is not ("native" or "spline"))throw new ArgumentException("扫描路径插值方式无效。");
                var path=Sketches.FirstOrDefault(x=>x.Id==f.PathSketchId);
                if(path is null||path.Id==s.Id||!path.Entities.Any(e=>e.Id==f.PathEntityId&&e.Kind is ("line" or "arc" or "circle" or "ellipse"))&&!(f.PathEntityId is null&&path.Entities.Any(e=>e.Kind=="line")))throw new ArgumentException("扫描需要另一草图中的连续路径。");
                if(path.Plane.FeatureId is {} pathParent&&!built.Contains(pathParent))throw new ArgumentException("扫描路径不能依赖本步骤之后的特征。");
            }
            if(f.Mode=="loft"){
                if(f.Sections.Count==0||f.Sections.Any(x=>x is null)||f.Sections.Select(x=>x.Face is {} face?$"face:{face.FeatureId}/{face.Face}/{x.FaceX}/{x.FaceY}":x.SketchId).Append(s.Id).Distinct().Count()!=f.Sections.Count+1)throw new ArgumentException("放样需要至少两个不同的截面。");
                foreach(var section in f.Sections){if(section.Face is {} face){if(face.FeatureId is null||!built.Contains(face.FeatureId)||string.IsNullOrWhiteSpace(face.Face)||face.Face=="curved"||!double.IsFinite(section.FaceX)||!double.IsFinite(section.FaceY)||section.RegionKeys is null||section.RegionKeys.Count!=0||section.SketchId!="")throw new ArgumentException("放样实体截面无效，请重新选择平面。");continue;}var sectionSketch=Sketches.FirstOrDefault(x=>x.Id==section.SketchId);if(sectionSketch is null||section.RegionKeys is null||section.RegionKeys.Count==0||section.RegionKeys.Count>500||section.RegionKeys.Any(string.IsNullOrWhiteSpace)||sectionSketch.Plane.FeatureId is {} sectionParent&&!built.Contains(sectionParent))throw new ArgumentException("放样截面或依附面无效。");}
            }
            if(f.Mode=="chamfer"){
                if(f.TopologyBevel&&(f.VisualOnly||f.EdgeTreatment!="chamfer"))throw new ArgumentException("实体边倒角的特征参数不一致。");
                if(f.ChamferEdges is null||f.ChamferEdges.Count>32||f.EdgeTreatment is not ("chamfer" or "fillet")||!double.IsFinite(f.ChamferAngle)||f.ChamferAngle<1||f.ChamferAngle>89)throw new ArgumentException("倒角／圆角参数无效。");
                foreach(var chamfer in f.ChamferEdges.Count>0?f.ChamferEdges:new List<CadChamferEdge>{f.ChamferEdge!}){
                    if(f.Kind!="cut"||chamfer is null||chamfer.Segment<0||chamfer.FaceA is null||chamfer.FaceB is null||chamfer.FaceA.FeatureId is null||chamfer.FaceB.FeatureId is null||!built.Contains(chamfer.FaceA.FeatureId)||!built.Contains(chamfer.FaceB.FeatureId)||string.IsNullOrWhiteSpace(chamfer.FaceA.Face)||string.IsNullOrWhiteSpace(chamfer.FaceB.Face)||chamfer.Kind is not ("line" or "curve"))
                        throw new ArgumentException("请选择已有实体的有效直边或连续曲线边。");
                    // Persistence validates reference integrity only. Surface names
                    // and the number/type of prior treatments do enot determine
                    // whether the selected geometric edge can be treated again.
                }
            }
            if(f.Mode!="extrude"&&f.EndCondition!="blind")throw new ArgumentException("该特征请使用自身的生成参数。");
            if (f.Mode!="chamfer" && !(f.Mode=="sweep"&&f.ThinWall) && f.RegionKeys.Count == 0 && (e is null || e.Construction || e.Kind is "line" or "arc")) throw new ArgumentException("实体特征需要封闭截面；开放截面请使用薄壁扫描。");
            if (f.RegionKeys.Count > 500 || f.RegionKeys.Any(k => string.IsNullOrWhiteSpace(k) || k.Length > 65536) || f.RegionKeys.Distinct().Count() != f.RegionKeys.Count)
                throw new ArgumentException("选择的草图区域无效。");
            if (f.SourceEntityIds.Any(id => !s.Entities.Any(e => e.Id == id))) throw new ArgumentException("特征依赖的草图元素已失效。");
            if (!double.IsFinite(f.Depth) || f.Depth < (f.Mode=="chamfer"?.1:1) || f.Mode!="chamfer"&&f.Depth > 1000) throw new ArgumentException("倒角尺寸需大于等于 0.1 mm；其它特征深度需在 1–1000 mm 范围内。");
            if (f.EndCondition is not ("blind" or "throughAll" or "upToFace")) throw new ArgumentException("终止条件无效。");
            if (f.EndCondition == "throughAll" && built.Count == 0) throw new ArgumentException("贯穿全部需要已有实体，请为首个实体指定距离。");
            if (f.EndCondition == "upToFace" && (f.TargetFace?.FeatureId is not { } target || !built.Contains(target))) throw new ArgumentException("请选择更早特征上的终止面。");
            if (s.Plane.FeatureId is { } parent && !built.Contains(parent)) throw new ArgumentException("草图依附面必须来自更早的特征。");
            if (f.Kind == "cut" && built.Count == 0) throw new ArgumentException("切除需要已有实体。");
            built.Add(f.Id);
        }
        foreach (var s in Sketches.Where(s => s.Plane.FeatureId is not null))
        {
            var parent = Features.FirstOrDefault(f => f.Id == s.Plane.FeatureId);
            if (parent is null || parent.SketchId == s.Id) throw new ArgumentException("草图依附面已失效。");
            if (s.Plane.Face is "top" or "bottom") continue;
            if(parent.Mode!="extrude"&&s.Plane.Face.StartsWith("surface|",StringComparison.Ordinal))continue;
            var parentSketch = Sketches.First(x => x.Id == parent.SketchId);
            if (s.Plane.Face.StartsWith("edge|", StringComparison.Ordinal))
            {
                var parts = s.Plane.Face.Split('|');
                if(parts.Length==4&&int.TryParse(parts[2],out var edge)&&parentSketch.Entities.Any(e=>e.Id==parts[1]&&!e.Construction&&e.IsStraightEdge(edge))&&parts[3] is ("1" or "-1"))continue;
            }
            var p = parentSketch.Entities.FirstOrDefault(x => x.Id == parent.ProfileId);
            if (!(p?.Kind == "rectangle" && s.Plane.Face is ("side0" or "side1" or "side2" or "side3")))
                throw new ArgumentException("只能在有效平面上创建草图，不能选择曲面。");
        }
    }
}

public sealed class SketchRegionInfo
{
    public string Key { get; set; } = "";
    public double Area { get; set; }
    public List<string> SourceIds { get; set; } = [];
}

public sealed class FeaturePreviewInfo
{
    public bool Valid { get; set; }
    public string Message { get; set; } = "";
    public double Min { get; set; }
    public double Max { get; set; }
}

public sealed class SceneUpdateInfo
{
    public List<SketchRegionInfo> Regions { get; set; } = [];
    public FeaturePreviewInfo Preview { get; set; } = new();
    public List<CadBodyInfo> Bodies { get; set; } = [];
}

public sealed class CadBodyInfo {
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> FeatureIds { get; set; } = [];
}
public sealed class CadAppearance {
    public string Preset { get; set; } = "steel";
    public string Color { get; set; } = "#b8bdc3";
    public double Metalness { get; set; } = .98;
    public double Roughness { get; set; } = .24;
    public double Clearcoat { get; set; } = .02;
    public double Specular { get; set; } = 1;
    public double Anisotropy { get; set; } = .55;
    public double Grain { get; set; } = .18;
    public double BrushAngle { get; set; }
    public double EnvironmentStrength { get; set; } = 1;
    public double TextureSize { get; set; } = 25;
    public double TextureAngle { get; set; }
    public string? TextureId { get; set; }
    public string Mapping { get; set; } = "uniform";
    public void Validate(){
        if(Mapping is not ("uniform" or "triplanar")||Color is null||!System.Text.RegularExpressions.Regex.IsMatch(Color,"^#[0-9a-fA-F]{6}$")||new[]{Metalness,Roughness,Clearcoat,Specular,Anisotropy,Grain}.Any(v=>!double.IsFinite(v)||v<0||v>1)||!double.IsFinite(BrushAngle)||Math.Abs(BrushAngle)>360||!double.IsFinite(EnvironmentStrength)||EnvironmentStrength<0||EnvironmentStrength>3||!double.IsFinite(TextureSize)||TextureSize<.1||TextureSize>1000||!double.IsFinite(TextureAngle)||Math.Abs(TextureAngle)>360||TextureId is not null&&!System.Text.RegularExpressions.Regex.IsMatch(TextureId,"^[a-f0-9]{64}$"))throw new ArgumentException("材质参数无效。");
    }
}
