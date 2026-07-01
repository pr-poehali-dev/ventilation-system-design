using System;
using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace PvsApp;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += OnDispatcherException;
        AppDomain.CurrentDomain.UnhandledException += OnDomainException;

        base.OnStartup(e);

        try
        {
            var win = new MainWindow(e.Args.Length > 0 ? e.Args[0] : null);
            win.Show();
        }
        catch (Exception ex)
        {
            WriteLog(ex);
            MessageBox.Show($"Критическая ошибка:\n{ex.Message}", "ПВ-Система",
                            MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    private void OnDispatcherException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        WriteLog(e.Exception);
        MessageBox.Show($"Ошибка:\n{e.Exception.Message}", "ПВ-Система",
                        MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
        Shutdown();
    }

    private void OnDomainException(object sender, UnhandledExceptionEventArgs e)
    {
        if (e.ExceptionObject is Exception ex)
            WriteLog(ex);
    }

    private static void WriteLog(Exception ex)
    {
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PVS");
            Directory.CreateDirectory(dir);
            string log = Path.Combine(dir, "error.log");
            File.WriteAllText(log, $"{DateTime.Now}\n{ex}");
            MessageBox.Show($"Лог ошибки сохранён:\n{log}", "ПВ-Система",
                            MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch { }
    }
}
