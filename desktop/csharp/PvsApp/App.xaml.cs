using System.Windows;

namespace PvsApp;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var win = new MainWindow(e.Args.Length > 0 ? e.Args[0] : null);
        win.Show();
    }
}
