using System.Text.Json;
using BlazorCAD.Models;

namespace BlazorCAD.Services;

public sealed class CadProjectConflictException(string message) : Exception(message);

// A singleton serializes reads and writes across Blazor circuits. Files live
// outside wwwroot and are committed by a same-directory atomic replacement.
public sealed class CadProjectStore
{
    public const int MaxDocumentBytes=2*1024*1024;
    const int MaxFileBytes=MaxDocumentBytes+64*1024;
    readonly SemaphoreSlim gate=new(1,1);
    readonly string root;
    readonly ILogger<CadProjectStore> logger;
    static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){MaxDepth=128};

    public CadProjectStore(IConfiguration configuration,IWebHostEnvironment environment,ILogger<CadProjectStore> logger)
    {
        this.logger=logger;
        var configured=configuration["CadStorage:RootPath"];
        var local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        root=Path.GetFullPath(string.IsNullOrWhiteSpace(configured)
            ? string.IsNullOrWhiteSpace(local)?Path.Combine(environment.ContentRootPath,"App_Data","CadProjects"):Path.Combine(local,"BlazorCAD","Projects")
            :Path.IsPathRooted(configured)?configured:Path.Combine(environment.ContentRootPath,configured));
    }

    public async Task<string> SaveTextureAsync(byte[] data){
        if(data.Length<12||data.Length>8*1024*1024)throw new ArgumentException("贴图应小于 8 MB。");
        var png=data[0]==137&&data[1]==80&&data[2]==78&&data[3]==71;
        var jpeg=data[0]==255&&data[1]==216&&data[2]==255;
        var webp=System.Text.Encoding.ASCII.GetString(data,0,4)=="RIFF"&&System.Text.Encoding.ASCII.GetString(data,8,4)=="WEBP";
        if(!png&&!jpeg&&!webp)throw new ArgumentException("请选择 PNG、JPEG 或 WebP 图片。");
        var id=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(data)).ToLowerInvariant();
        var folder=Path.Combine(root,"textures");Directory.CreateDirectory(folder);var path=Path.Combine(folder,id);
        await gate.WaitAsync();try{if(!File.Exists(path))await File.WriteAllBytesAsync(path,data);}finally{gate.Release();}return id;
    }
    public (string Path,string ContentType)? TextureFile(string id){
        if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-f0-9]{64}$"))return null;
        var path=Path.Combine(root,"textures",id);if(!File.Exists(path))return null;
        using var stream=File.OpenRead(path);var header=new byte[12];stream.ReadExactly(header);
        return (path,header[0]==137?"image/png":header[0]==255?"image/jpeg":"image/webp");
    }
    string FilePath(Guid id,string suffix=".cad.json")=>Path.Combine(root,id.ToString("N")+suffix);

    public async Task<CadProject?> LoadAsync(Guid id)
    {
        if(id==Guid.Empty)throw new ArgumentException("项目编号无效。");
        await gate.WaitAsync();
        try{return await ReadAsync(id);}finally{gate.Release();}
    }

    public async Task<List<CadProjectSummary>> ListAsync()
    {
        await gate.WaitAsync();
        try{
            if(!Directory.Exists(root))return [];
            var result=new List<CadProjectSummary>();
            var ids=Directory.EnumerateFiles(root,"*.cad.json").Concat(Directory.EnumerateFiles(root,"*.bak.json"))
                .Select(path=>Path.GetFileName(path).Split('.')[0]).Where(name=>Guid.TryParseExact(name,"N",out _)).Distinct().ToList();
            foreach(var name in ids){
                var id=Guid.ParseExact(name,"N");
                try{var project=await ReadAsync(id);if(project is not null)result.Add(new(project.Id,project.Document.Name,project.Revision,project.SavedAt,project.Document.Sketches.Count,project.Document.Features.Count));}
                catch(Exception ex) when(ex is IOException or JsonException or ArgumentException or UnauthorizedAccessException){logger.LogWarning(ex,"CAD project {Id} could not be listed",id);}
            }
            return result.OrderByDescending(p=>p.SavedAt).ToList();
        }finally{gate.Release();}
    }

    public async Task<bool> IsDeletedAsync(Guid id)
    {
        await gate.WaitAsync();try{return File.Exists(FilePath(id,".deleted.json"));}finally{gate.Release();}
    }

    public async Task DeleteAsync(Guid id,long expectedRevision)
    {
        if(id==Guid.Empty||expectedRevision<1)throw new ArgumentException("请选择已保存的项目。");
        await gate.WaitAsync();string? temporary=null;
        try{
            if(File.Exists(FilePath(id,".deleted.json")))return;
            var current=await ReadAsync(id)??throw new ArgumentException("项目已不存在。");
            if(current.Revision!=expectedRevision)throw new CadProjectConflictException("项目已被其他页面修改，请刷新项目列表后重新确认删除。");
            // The tombstone is authoritative: another circuit cannot autosave this ID back to life.
            temporary=FilePath(id,"."+Guid.NewGuid().ToString("N")+".tmp");
            var marker=JsonSerializer.SerializeToUtf8Bytes(new{Id=id,Revision=current.Revision,DeletedAt=DateTimeOffset.UtcNow},Json);
            await using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.Asynchronous|FileOptions.WriteThrough)){
                await stream.WriteAsync(marker);await stream.FlushAsync();stream.Flush(flushToDisk:true);
            }
            File.Move(temporary,FilePath(id,".deleted.json"));temporary=null;
            foreach(var path in Directory.EnumerateFiles(root,id.ToString("N")+".*.json").Where(path=>!path.EndsWith(".deleted.json",StringComparison.OrdinalIgnoreCase)).ToList()){
                try{File.Delete(path);}catch(Exception ex) when(ex is IOException or UnauthorizedAccessException){logger.LogWarning(ex,"Deleted CAD project {Id} has a residual file pending cleanup",id);}
            }
        }finally{
            if(temporary is not null)try{File.Delete(temporary);}catch(Exception ex) when(ex is IOException or UnauthorizedAccessException){logger.LogWarning(ex,"CAD delete marker cleanup failed");}
            gate.Release();
        }
    }

    public async Task<CadProject> SaveAsync(Guid id,long expectedRevision,CadDocument document)
    {
        if(id==Guid.Empty||expectedRevision<0)throw new ArgumentException("项目版本无效。");
        document.Validate();
        var documentBytes=JsonSerializer.SerializeToUtf8Bytes(document,Json);
        if(documentBytes.Length>MaxDocumentBytes)throw new ArgumentException("项目超过 2 MB 保存上限，请减少草图细分或拆分项目。");
        // Capture the document before awaiting the global write lock.
        var copy=JsonSerializer.Deserialize<CadDocument>(documentBytes,Json)!;
        await gate.WaitAsync();
        string? temporary=null;
        try{
            Directory.CreateDirectory(root);
            if(File.Exists(FilePath(id,".deleted.json")))throw new CadProjectConflictException("此项目已被删除，已阻止自动保存重新创建它。需要保留当前内容时请另存为新项目。");
            var current=await ReadAsync(id);
            if((current?.Revision??0)!=expectedRevision)throw new CadProjectConflictException("此项目已被其他页面更新，未覆盖后端版本。可将当前内容另存为项目。");
            var saved=new CadProject{Id=id,Revision=checked(expectedRevision+1),SavedAt=DateTimeOffset.UtcNow,Document=copy};
            var bytes=JsonSerializer.SerializeToUtf8Bytes(saved,Json);
            temporary=FilePath(id,"."+Guid.NewGuid().ToString("N")+".tmp");
            await using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,64*1024,FileOptions.Asynchronous|FileOptions.WriteThrough)){
                await stream.WriteAsync(bytes);await stream.FlushAsync();stream.Flush(flushToDisk:true);
            }
            var destination=FilePath(id);
            if(File.Exists(destination)&&current?.RecoveredBackup!=true)File.Replace(temporary,destination,FilePath(id,".bak.json"),ignoreMetadataErrors:true);
            else{
                // Never replace the last good backup with a corrupt main file.
                if(File.Exists(destination))File.Move(destination,FilePath(id,".corrupt-"+Guid.NewGuid().ToString("N")+".json"));
                File.Move(temporary,destination);
            }
            temporary=null;return saved;
        }finally{
            if(temporary is not null)try{File.Delete(temporary);}catch(Exception ex) when(ex is IOException or UnauthorizedAccessException){logger.LogWarning(ex,"CAD temporary save cleanup failed");}
            gate.Release();
        }
    }

    async Task<CadProject?> ReadAsync(Guid id)
    {
        if(File.Exists(FilePath(id,".deleted.json")))return null;
        var primary=FilePath(id);var backup=FilePath(id,".bak.json");
        if(!File.Exists(primary)&&!File.Exists(backup))return null;
        try{return await ReadFileAsync(primary,id);}
        catch(Exception ex) when(ex is IOException or JsonException or ArgumentException){
            if(!File.Exists(backup))throw;
            logger.LogWarning(ex,"CAD project {Id} is being recovered from its backup",id);
            var restored=await ReadFileAsync(backup,id);restored.RecoveredBackup=true;return restored;
        }
    }

    static async Task<CadProject> ReadFileAsync(string path,Guid id)
    {
        await using var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read,64*1024,FileOptions.Asynchronous);
        if(stream.Length>MaxFileBytes)throw new InvalidDataException("后端项目文件大小异常。");
        var saved=await JsonSerializer.DeserializeAsync<CadProject>(stream,Json)??throw new InvalidDataException("后端项目文件为空。");
        if(saved.Id!=id||saved.Revision<1||saved.Document is null||saved.SavedAt==default)throw new InvalidDataException("后端项目元数据无效。");
        saved.Document.Validate();return saved;
    }
}
