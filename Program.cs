using BlazorCAD.Components;
using BlazorCAD.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents()
    .AddHubOptions(options => options.MaximumReceiveMessageSize = 4 * 1024 * 1024);

builder.Services.AddSingleton<CadProjectStore>();
builder.Services.AddScoped<CadCircuitState>();
builder.Services.AddScoped<Microsoft.AspNetCore.Components.Server.Circuits.CircuitHandler>(services=>services.GetRequiredService<CadCircuitState>());

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseAntiforgery();

app.MapStaticAssets();
app.MapGet("/cad-textures/{id}",(string id,CadProjectStore projects,HttpContext context)=>{
    if(projects.TextureFile(id) is not {} texture)return Results.NotFound();
    context.Response.Headers.CacheControl="public,max-age=31536000,immutable";
    return Results.File(texture.Path,texture.ContentType,enableRangeProcessing:true);
});
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
