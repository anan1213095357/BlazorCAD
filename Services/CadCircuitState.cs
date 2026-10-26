using Microsoft.AspNetCore.Components.Server.Circuits;

namespace BlazorCAD.Services;

// Scoped to a circuit; component teardown must not initiate browser calls.
public sealed class CadCircuitState : CircuitHandler
{
    int connected;
    public bool IsConnected=>Volatile.Read(ref connected)!=0;
    public void MarkDisconnected()=>Volatile.Write(ref connected,0);
    public override Task OnConnectionUpAsync(Circuit circuit,CancellationToken cancellationToken)
    {
        Volatile.Write(ref connected,1);return Task.CompletedTask;
    }
    public override Task OnConnectionDownAsync(Circuit circuit,CancellationToken cancellationToken)
    {
        MarkDisconnected();return Task.CompletedTask;
    }
    public override Task OnCircuitClosedAsync(Circuit circuit,CancellationToken cancellationToken)
    {
        MarkDisconnected();return Task.CompletedTask;
    }
}
