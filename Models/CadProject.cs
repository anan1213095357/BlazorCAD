namespace BlazorCAD.Models;

public sealed class CadProject
{
    public Guid Id { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset SavedAt { get; set; }
    public CadDocument Document { get; set; } = new();
    [System.Text.Json.Serialization.JsonIgnore]
    public bool RecoveredBackup { get; set; }
}

public sealed record CadProjectSummary(Guid Id,string Name,long Revision,DateTimeOffset SavedAt,int Sketches,int Features);

public sealed class CadProjectDraft
{
    public string? ProjectId { get; set; }
    public long ServerRevision { get; set; }
    public bool Dirty { get; set; }
    public string Json { get; set; } = "";
}
