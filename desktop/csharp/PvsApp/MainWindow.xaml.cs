using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace PvsApp;

public partial class MainWindow : Window
{
    private const int    Port            = 5173;
    // Версия берётся из сборки (тег <Version> в PvsApp.csproj, который читает
    // desktop/VERSION). Хардкода больше нет — единый источник версии.
    private static readonly string AppVersion = GetAppVersion();

    private static string GetAppVersion()
    {
        var info = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString()
            ?? "0.0.0";
        // Отбрасываем возможный суффикс сборки вида "2.0.17+abc123"
        var plus = info.IndexOf('+');
        return plus >= 0 ? info.Substring(0, plus) : info;
    }
    private const string VersionCheckUrl = "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16";
    private const string ServerUrl       = "http://127.0.0.1:5173";

    private Process?     _serverProcess;
    private string?      _pendingFile;
    private UpdateInfo?  _updateInfo;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    // Флаг: JS уже подтвердил закрытие — пропускаем повторный запрос
    private bool _closeConfirmed = false;

    public MainWindow(string? pendingFile)
    {
        InitializeComponent();
        _pendingFile = pendingFile;
        Closed  += OnClosed;
        Closing += OnWindowClosing;

        // Уведомляем JS при изменении состояния окна (развёрнуто / обычное)
        StateChanged += OnWindowStateChanged;

        // Безрамочное окно (WindowStyle=None) при максимизации перекрывает панель
        // задач и вылезает за экран. Перехватываем WM_GETMINMAXINFO и ограничиваем
        // размер рабочей областью текущего монитора.
        SourceInitialized += OnSourceInitialized;

        Loaded += async (_, _) =>
        {
            try { await StartupAsync(); }
            catch (Exception ex)
            {
                string log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PVS", "error.log");
                Directory.CreateDirectory(Path.GetDirectoryName(log)!);
                File.WriteAllText(log, $"{DateTime.Now}\n{ex}");
                MessageBox.Show($"Ошибка запуска:\n{ex.Message}\n\nЛог: {log}", "ПВ-Система", MessageBoxButton.OK, MessageBoxImage.Error);
                Application.Current.Shutdown();
            }
        };
    }

    // ── Запуск ────────────────────────────────────────────────────────────────

    private async Task StartupAsync()
    {
        SetStatus("Проверка обновлений расчётного ядра...");
        await UpdateServerExeIfNeededAsync();

        SetStatus("Запуск расчётного ядра...");
        StartServerProcess();

        var checkUpdate = CheckForUpdateAsync();

        SetStatus("Ожидание сервера...");
        bool ready = await WaitForServerAsync();
        if (!ready)
        {
            MessageBox.Show("Не удалось запустить расчётный модуль.\nПопробуйте перезапустить приложение.",
                            "ПВ-Система", MessageBoxButton.OK, MessageBoxImage.Error);
            Application.Current.Shutdown();
            return;
        }

        _updateInfo = await checkUpdate;

        SetStatus("Загрузка интерфейса...");
        await InitWebViewAsync();
    }

    private async Task UpdateServerExeIfNeededAsync()
    {
        try
        {
            string serverExe   = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server.exe");
            string versionFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server_version.txt");
            string localVer    = File.Exists(versionFile) ? File.ReadAllText(versionFile).Trim() : "";

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var resp = await Http.GetAsync(VersionCheckUrl, cts.Token);
            if (!resp.IsSuccessStatusCode) return;

            string json = await resp.Content.ReadAsStringAsync(cts.Token);
            if (string.IsNullOrWhiteSpace(json) || !json.TrimStart().StartsWith("{")) return;
            var info = JsonSerializer.Deserialize<VersionInfo>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            string remoteVer = info?.ServerVersion ?? "";
            if (string.IsNullOrEmpty(remoteVer) || remoteVer == localVer) return;

            SetStatus($"Обновление расчётного ядра до v{remoteVer}...");

            using var httpLarge = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
            var bytes = await httpLarge.GetByteArrayAsync($"{VersionCheckUrl}?file=server");

            string tmpPath = serverExe + ".new";
            await File.WriteAllBytesAsync(tmpPath, bytes);

            string batPath = Path.GetTempFileName() + ".bat";
            File.WriteAllText(batPath, $"""
                @echo off
                timeout /t 1 /nobreak >nul
                move /Y "{tmpPath}" "{serverExe}"
                echo {remoteVer}> "{versionFile}"
                del "%~f0"
                """, Encoding.GetEncoding(1251));
            Process.Start(new ProcessStartInfo("cmd", $"/c \"{batPath}\"")
                { CreateNoWindow = true, UseShellExecute = false })?.WaitForExit(5000);
        }
        catch { /* тихо игнорируем — работаем со старой версией */ }
    }

    private void StartServerProcess()
    {
        string serverExe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server", "server.exe");
        if (!File.Exists(serverExe))
        {
            MessageBox.Show($"Файл не найден:\n{serverExe}", "ПВ-Система", MessageBoxButton.OK, MessageBoxImage.Error);
            Application.Current.Shutdown();
            return;
        }

        _serverProcess = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName        = serverExe,
                CreateNoWindow  = true,
                UseShellExecute = false,
            }
        };
        _serverProcess.Start();
    }

    private async Task<bool> WaitForServerAsync(int timeoutMs = 20_000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var resp = await Http.GetAsync($"{ServerUrl}/api/status");
                if (resp.IsSuccessStatusCode) return true;
            }
            catch { }
            await Task.Delay(200);
        }
        return false;
    }

    // ── WebView2 ──────────────────────────────────────────────────────────────

    private async Task InitWebViewAsync()
    {
        string cacheDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PVS", "WebView2Cache");
        Directory.CreateDirectory(cacheDir);

        var env = await CoreWebView2Environment.CreateAsync(null, cacheDir);
        await WebView.EnsureCoreWebView2Async(env);

        WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled   = false;
        WebView.CoreWebView2.Settings.AreDevToolsEnabled              = false;
        WebView.CoreWebView2.Settings.IsStatusBarEnabled              = false;
        WebView.CoreWebView2.Settings.AreHostObjectsAllowed           = true;

        WebView.CoreWebView2.WebMessageReceived    += OnWebMessage;
        WebView.CoreWebView2.NavigationCompleted   += OnNavigationCompleted;

        // ── КРИТИЧНО: клавиши доставляем странице НАПРЯМУЮ ────────────────────
        // Раньше C# перехватывал S/Delete/Ctrl (WebView.KeyDown + e.Handled) и
        // пересоздавал синтетические KeyboardEvent через JS. Это ломало:
        //   • S+S (двойное нажатие) — сбивались тайминги между нажатиями;
        //   • Ctrl+клик (мультивыбор) — реальный keydown 'Control' не доходил
        //     до страницы, ctrlPressedRef оставался false, e.ctrlKey на мыши тоже;
        //   • Delete — синтетическое событие не совпадало с реальным.
        // Включаем нативную доставку клавиш — страница получает их как в браузере.
        WebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;

        // ── КРИТИЧНО: флаг десктопа + мост окна внедряем ДО загрузки страницы ──
        // AddScriptToExecuteOnDocumentCreatedAsync выполняется РАНЬШE скриптов React,
        // поэтому window.__IS_DESKTOP__ и __pvsWin* доступны уже при первом рендере.
        // Иначе React монтируется раньше бутстрапа, читает __IS_DESKTOP__ === undefined
        // и уходит в браузерную ветку — кнопки окна и close-диалог не работают.
        await WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildEarlyBootstrap());

        WebView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);

        // Сбрасываем кэш браузера перед загрузкой, чтобы после обновления программы
        // всегда открывался свежий интерфейс, а не старые файлы из кэша WebView2.
        try
        {
            await WebView.CoreWebView2.Profile.ClearBrowsingDataAsync(
                CoreWebView2BrowsingDataKinds.DiskCache |
                CoreWebView2BrowsingDataKinds.CacheStorage);
        }
        catch { /* старая версия рантайма WebView2 — не критично, есть no-cache на сервере */ }

        WebView.CoreWebView2.Navigate(ServerUrl);
    }

    // Ранний бутстрап: только флаг десктопа и мост управления окном.
    // Выполняется до скриптов страницы (document-created), поэтому React сразу
    // видит десктопный режим.
    private string BuildEarlyBootstrap()
    {
        string isMaxStr = WindowState == WindowState.Maximized ? "true" : "false";
        return $$"""
(function() {
    window.__IS_DESKTOP__       = true;
    window.__DESKTOP_SERVER__   = '{{ServerUrl}}';
    window.__pvsWindowMaximized = {{isMaxStr}};

    function sendCs(cmd, params) {
        try { window.chrome.webview.postMessage(JSON.stringify(Object.assign({ cmd: cmd }, params || {}))); }
        catch (e) {}
    }
    window.__pvsSendCs      = sendCs;
    window.__pvsWinMinimize = function() { sendCs('win-minimize'); };
    window.__pvsWinMaximize = function() { sendCs('win-maximize'); };
    window.__pvsWinDrag     = function() { sendCs('win-drag'); };
    window.__pvsWinClose    = function() { sendCs('win-close'); };
    window.__pvsShowCloseDialog = function() { sendCs('win-close-confirmed'); };
})();
""";
    }

    // ── Закрытие окна (системная кнопка X / Alt+F4) ──────────────────────────

    private async void OnWindowClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Если WebView ещё не загружен или JS уже подтвердил — закрываем сразу
        if (WebView?.CoreWebView2 == null || _closeConfirmed)
            return;

        // Отменяем закрытие — спросим JS
        e.Cancel = true;

        try
        {
            // Проверяем через JS есть ли несохранённые данные
            string result = await WebView.CoreWebView2.ExecuteScriptAsync(
                "typeof window.__pvsCanClose === 'function' ? (window.__pvsCanClose() ? 'yes' : 'no') : 'yes'");

            if (result == "\"yes\"" || result == "true")
            {
                // Несохранённых данных нет — закрываем
                _closeConfirmed = true;
                Dispatcher.Invoke(() => Close());
            }
            else
            {
                // Просим JS показать диалог сохранения
                // JS в диалоге вызовет sendCs('win-close-confirmed') при "Не сохранять"
                // или sendCs('win-close-confirmed') после успешного сохранения
                await WebView.CoreWebView2.ExecuteScriptAsync(
                    "typeof window.__pvsShowCloseDialog === 'function' && window.__pvsShowCloseDialog()");
            }
        }
        catch
        {
            // При ошибке — закрываем без вопросов
            _closeConfirmed = true;
            Dispatcher.Invoke(() => Close());
        }
    }

    // ── Состояние окна → JS ───────────────────────────────────────────────────

    private void OnWindowStateChanged(object? sender, EventArgs e)
    {
        // Рамка ресайза (Margin вокруг WebView) нужна только в обычном режиме.
        // В развёрнутом окне убираем отступ — иначе по краям видна серая полоса.
        bool maximized = WindowState == WindowState.Maximized;
        var margin = maximized ? new Thickness(0) : new Thickness(ResizeBorder);
        if (WebView != null)  WebView.Margin  = margin;
        if (SplashGrid != null) SplashGrid.Margin = margin;

        if (WebView?.CoreWebView2 == null) return;
        string maxVal = maximized ? "true" : "false";
        _ = WebView.CoreWebView2.ExecuteScriptAsync(
            "window.__pvsWindowMaximized = " + maxVal + ";" +
            "window.dispatchEvent(new CustomEvent('pvs-window-state', { detail: { maximized: " + maxVal + " } }));");
    }

    // ── Корректная максимизация безрамочного окна (не перекрывать панель задач) ─

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(handle)?.AddHook(WindowProc);
    }

    private const int WM_GETMINMAXINFO = 0x0024;
    private const int WM_NCHITTEST     = 0x0084;
    private const int WM_NCLBUTTONDOWN = 0x00A1;

    // Коды зон окна для перетаскивания/ресайза (возврат из WM_NCHITTEST)
    private const int HTCAPTION     = 2;
    private const int HTLEFT        = 10;
    private const int HTRIGHT       = 11;
    private const int HTTOP         = 12;
    private const int HTTOPLEFT     = 13;
    private const int HTTOPRIGHT    = 14;
    private const int HTBOTTOM      = 15;
    private const int HTBOTTOMLEFT  = 16;
    private const int HTBOTTOMRIGHT = 17;

    // Толщина зоны захвата по краям окна для изменения размера (px)
    private const int ResizeBorder = 6;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

    private IntPtr WindowProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        // ── Изменение размера безрамочного окна поверх WebView2 ────────────────
        // WebView2 (дочерний HWND браузера) закрывает окно целиком и «съедает»
        // стандартную рамку ресайза WPF. Поэтому сами обрабатываем WM_NCHITTEST:
        // если курсор у самого края окна — возвращаем код зоны ресайза, и Windows
        // рисует стрелку + позволяет тянуть край.
        if (msg == WM_NCHITTEST && WindowState != WindowState.Maximized)
        {
            int screenX = unchecked((short)((long)lParam & 0xFFFF));
            int screenY = unchecked((short)(((long)lParam >> 16) & 0xFFFF));

            var pt = PointFromScreen(new System.Windows.Point(screenX, screenY));
            double w = ActualWidth, h = ActualHeight;
            int b = ResizeBorder;

            bool left   = pt.X <= b;
            bool right  = pt.X >= w - b;
            bool top    = pt.Y <= b;
            bool bottom = pt.Y >= h - b;

            int code = 0;
            if (top && left)          code = HTTOPLEFT;
            else if (top && right)    code = HTTOPRIGHT;
            else if (bottom && left)  code = HTBOTTOMLEFT;
            else if (bottom && right) code = HTBOTTOMRIGHT;
            else if (left)            code = HTLEFT;
            else if (right)           code = HTRIGHT;
            else if (top)             code = HTTOP;
            else if (bottom)          code = HTBOTTOM;

            if (code != 0)
            {
                handled = true;
                return (IntPtr)code;
            }
        }

        if (msg == WM_GETMINMAXINFO)
        {
            const int MONITOR_DEFAULTTONEAREST = 0x00000002;
            IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (monitor != IntPtr.Zero)
            {
                var mi = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
                if (GetMonitorInfo(monitor, ref mi))
                {
                    RECT work = mi.rcWork;      // рабочая область (без панели задач)
                    RECT area = mi.rcMonitor;   // весь монитор
                    // PtrToStructure<T> возвращает T? (при Nullable enable) — берём
                    // значение через GetValueOrDefault, чтобы не было CS8629.
                    MINMAXINFO mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam)!;
                    mmi.ptMaxPosition.X  = Math.Abs(work.Left - area.Left);
                    mmi.ptMaxPosition.Y  = Math.Abs(work.Top  - area.Top);
                    mmi.ptMaxSize.X      = Math.Abs(work.Right  - work.Left);
                    mmi.ptMaxSize.Y      = Math.Abs(work.Bottom - work.Top);
                    Marshal.StructureToPtr(mmi, lParam, true);
                    handled = true;
                }
            }
        }
        return IntPtr.Zero;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int dwFlags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int    cbSize;
        public RECT   rcMonitor;
        public RECT   rcWork;
        public uint   dwFlags;
    }

    // ── JS ↔ C# сообщения ────────────────────────────────────────────────────

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        Dispatcher.Invoke(() =>
        {
            SplashGrid.Visibility = Visibility.Collapsed;
            WebView.Visibility    = Visibility.Visible;
        });

        _ = WebView.CoreWebView2.ExecuteScriptAsync(BuildJsBootstrap());
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string raw = e.TryGetWebMessageAsString();
        JsonDocument doc;
        try { doc = JsonDocument.Parse(raw); }
        catch { return; }

        string cmd = doc.RootElement.TryGetProperty("cmd", out var c) ? c.GetString() ?? "" : "";

        switch (cmd)
        {
            case "save-file":
                HandleSaveFile(doc.RootElement);
                break;
            case "read-file":
                HandleReadFile(doc.RootElement);
                break;
            case "write-file":
                HandleWriteFile(doc.RootElement);
                break;
            case "get-pending-file":
                HandleGetPendingFile(doc.RootElement);
                break;
            case "install-update":
                _ = HandleInstallUpdate();
                break;
            case "win-minimize":
                Dispatcher.Invoke(() => WindowState = WindowState.Minimized);
                break;
            case "win-maximize":
                Dispatcher.Invoke(() => WindowState = WindowState == WindowState.Maximized
                    ? WindowState.Normal : WindowState.Maximized);
                break;
            case "win-close":
                // JS кнопка "✕" — JS уже показал свой диалог и подтвердил
                _closeConfirmed = true;
                Dispatcher.Invoke(() => Close());
                break;
            case "win-close-confirmed":
                // JS явно подтвердил закрытие (после диалога "Не сохранять")
                _closeConfirmed = true;
                Dispatcher.Invoke(() => Close());
                break;
            case "win-drag":
                Dispatcher.Invoke(() =>
                {
                    // ВАЖНО: DragMove() ненадёжен, когда событие пришло из WebView2
                    // (мышь захвачена дочерним HWND браузера). Используем нативный
                    // способ перетаскивания окна: отпускаем захват и шлём окну
                    // WM_NCLBUTTONDOWN с кодом HTCAPTION — Windows сам начинает drag.
                    try
                    {
                        var h = new WindowInteropHelper(this).Handle;
                        if (h != IntPtr.Zero)
                        {
                            ReleaseCapture();
                            SendMessage(h, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                        }
                    }
                    catch { }
                });
                break;
        }
    }

    // ── Диалог сохранения файла ───────────────────────────────────────────────

    private void HandleSaveFile(JsonElement root)
    {
        string filename = root.TryGetProperty("filename", out var fn) ? fn.GetString() ?? "file" : "file";
        string data     = root.TryGetProperty("data",     out var d)  ? d.GetString()  ?? ""     : "";
        string reqId    = root.TryGetProperty("reqId",    out var r)  ? r.GetString()  ?? ""     : "";

        Dispatcher.Invoke(() =>
        {
            string ext = Path.GetExtension(filename).ToLowerInvariant();
            var (filter, defExt) = ext switch
            {
                ".png"  => ("PNG файлы|*.png|Все файлы|*.*",          "png"),
                ".jpg"  => ("JPEG файлы|*.jpg|Все файлы|*.*",         "jpg"),
                ".jpeg" => ("JPEG файлы|*.jpg|Все файлы|*.*",         "jpg"),
                ".bmp"  => ("BMP файлы|*.bmp|Все файлы|*.*",          "bmp"),
                ".tiff" => ("TIFF файлы|*.tiff|Все файлы|*.*",        "tiff"),
                ".svg"  => ("SVG файлы|*.svg|Все файлы|*.*",          "svg"),
                ".pdf"  => ("PDF файлы|*.pdf|Все файлы|*.*",          "pdf"),
                ".xlsx" => ("Excel файлы|*.xlsx|Все файлы|*.*",       "xlsx"),
                ".dxf"  => ("DXF файлы|*.dxf|Все файлы|*.*",         "dxf"),
                ".csv"  => ("CSV файлы|*.csv|Все файлы|*.*",          "csv"),
                _       => ("Все файлы|*.*",                           ext.TrimStart('.')),
            };

            var dlg = new SaveFileDialog
            {
                FileName         = filename,
                DefaultExt       = defExt,
                Filter           = filter,
                AddExtension     = true,
                OverwritePrompt  = true,
            };

            bool? result = dlg.ShowDialog(this);
            if (result != true)
            {
                ReplyToJs(reqId, new { ok = false, cancelled = true });
                return;
            }

            try
            {
                byte[] bytes = DecodeBase64Data(data);
                File.WriteAllBytes(dlg.FileName, bytes);
                ReplyToJs(reqId, new { ok = true, path = dlg.FileName });
            }
            catch (Exception ex)
            {
                ReplyToJs(reqId, new { ok = false, error = ex.Message });
            }
        });
    }

    private void HandleReadFile(JsonElement root)
    {
        string path  = root.TryGetProperty("path",  out var p) ? p.GetString() ?? "" : "";
        string reqId = root.TryGetProperty("reqId", out var r) ? r.GetString() ?? "" : "";
        try
        {
            string content = File.ReadAllText(path, Encoding.UTF8);
            ReplyToJs(reqId, new { path, content });
        }
        catch (Exception ex) { ReplyToJs(reqId, new { error = ex.Message }); }
    }

    private void HandleWriteFile(JsonElement root)
    {
        string path    = root.TryGetProperty("path",    out var p) ? p.GetString() ?? "" : "";
        string content = root.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
        string reqId   = root.TryGetProperty("reqId",   out var r) ? r.GetString() ?? "" : "";
        try
        {
            File.WriteAllText(path, content, Encoding.UTF8);
            ReplyToJs(reqId, new { ok = true });
        }
        catch (Exception ex) { ReplyToJs(reqId, new { error = ex.Message }); }
    }

    private void HandleGetPendingFile(JsonElement root)
    {
        string reqId = root.TryGetProperty("reqId", out var r) ? r.GetString() ?? "" : "";
        if (_pendingFile == null || !File.Exists(_pendingFile))
        {
            ReplyToJs(reqId, (object?)null);
            return;
        }
        try
        {
            string content = File.ReadAllText(_pendingFile, Encoding.UTF8);
            var result = new { path = _pendingFile, content };
            _pendingFile = null;
            ReplyToJs(reqId, result);
        }
        catch (Exception ex) { ReplyToJs(reqId, new { error = ex.Message }); }
    }

    // ── Обновление ────────────────────────────────────────────────────────────

    private async Task<UpdateInfo?> CheckForUpdateAsync()
    {
        try
        {
            var req = new HttpRequestMessage(HttpMethod.Get, VersionCheckUrl);
            req.Headers.Add("User-Agent", $"PVS/{AppVersion}");
            var resp = await Http.SendAsync(req);
            string json = await resp.Content.ReadAsStringAsync();
            if (string.IsNullOrWhiteSpace(json) || !json.TrimStart().StartsWith("{")) return null;
            var data = JsonSerializer.Deserialize<UpdateInfo>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            // Баннер показываем ТОЛЬКО если серверная версия СТРОГО НОВЕЕ текущей.
            // Раньше сравнивали строки на "!=" — из-за чего баннер вылезал даже
            // когда установлена та же или более свежая версия.
            if (data?.Version != null && IsNewerVersion(data.Version, AppVersion))
                return data;
        }
        catch { }
        return null;
    }

    // Возвращает true, если candidate строго новее current (семантическое
    // сравнение по номерам: 2.3.29 vs 2.3.30). При неразборчивом формате —
    // безопасный фолбэк: считаем НЕ новее, чтобы не показывать лишний баннер.
    private static bool IsNewerVersion(string candidate, string current)
    {
        static int[] Parse(string v)
        {
            var core = v.Split('+', '-')[0].Trim().TrimStart('v', 'V');
            var parts = core.Split('.');
            var nums = new int[Math.Max(parts.Length, 3)];
            for (int i = 0; i < parts.Length; i++)
                int.TryParse(parts[i], out nums[i]);
            return nums;
        }
        try
        {
            var a = Parse(candidate);
            var b = Parse(current);
            int len = Math.Max(a.Length, b.Length);
            for (int i = 0; i < len; i++)
            {
                int ai = i < a.Length ? a[i] : 0;
                int bi = i < b.Length ? b[i] : 0;
                if (ai != bi) return ai > bi;
            }
            return false; // версии равны
        }
        catch { return false; }
    }

    private async Task HandleInstallUpdate()
    {
        // Сервер отдаёт УСТАНОВЩИК (Inno Setup, PVS-Setup-*.exe), а не голый
        // PVS.exe. Программа установлена в C:\Program Files\PVS (нужны права
        // администратора). Поэтому НЕЛЬЗЯ подменять exe на месте — вместо этого
        // скачиваем установщик во временную папку (туда доступ есть всегда) и
        // запускаем его: Windows покажет UAC, установщик корректно обновит всё.

        // Ссылка на установщик. Если пусто — серверный редирект ?file=exe.
        string downloadUrl = string.IsNullOrWhiteSpace(_updateInfo?.DownloadUrl)
            ? $"{VersionCheckUrl}?file=exe"
            : _updateInfo!.DownloadUrl!;
        try
        {
            string ver     = _updateInfo?.Version ?? "latest";
            string setup   = Path.Combine(Path.GetTempPath(), $"PVS-Setup-{ver}.exe");

            // Установщик ~82 МБ — качаем ПОТОКОВО и сообщаем прогресс в JS
            // (window.__pvsUpdateProgress), чтобы в баннере была полоса загрузки.
            using (var httpLarge = new HttpClient { Timeout = TimeSpan.FromMinutes(10) })
            {
                using var resp = await httpLarge.GetAsync(
                    downloadUrl, HttpCompletionOption.ResponseHeadersRead);
                resp.EnsureSuccessStatusCode();
                long total = resp.Content.Headers.ContentLength ?? -1L;

                using var stream = await resp.Content.ReadAsStreamAsync();
                using var file   = File.Create(setup);
                var buffer = new byte[81920];
                long read  = 0;
                int  last  = -1;
                int  n;
                while ((n = await stream.ReadAsync(buffer)) > 0)
                {
                    await file.WriteAsync(buffer.AsMemory(0, n));
                    read += n;
                    if (total > 0)
                    {
                        int pct = (int)(read * 100 / total);
                        if (pct != last) { last = pct; ReportUpdateProgress(pct); }
                    }
                }
                ReportUpdateProgress(100);
            }

            // Запускаем установщик с элевацией (UseShellExecute + runas → UAC).
            // /SILENT — минимум окон; /CLOSEAPPLICATIONS — закрыть текущее
            // приложение перед заменой файлов; RESTARTAPPLICATIONS — перезапуск.
            var psi = new ProcessStartInfo(setup)
            {
                UseShellExecute = true,
                Verb            = "runas",
                Arguments       = "/SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS",
            };
            Process.Start(psi);
            Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            // Код 1223 = пользователь отклонил UAC-запрос прав администратора.
            if (ex is System.ComponentModel.Win32Exception w32 && w32.NativeErrorCode == 1223)
                return;
            MessageBox.Show($"Ошибка обновления: {ex.Message}", "ПВ-Система",
                            MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    // ── Утилиты ───────────────────────────────────────────────────────────────

    private void ReplyToJs(string reqId, object? payload)
    {
        string json = JsonSerializer.Serialize(payload ?? new { });
        string js   = $"window.__pvsCsReply && window.__pvsCsReply({JsonSerializer.Serialize(reqId)}, {json});";
        _ = WebView.CoreWebView2.ExecuteScriptAsync(js);
    }

    // Сообщает JS-баннеру прогресс скачивания обновления (0..100).
    private void ReportUpdateProgress(int percent)
    {
        try
        {
            Dispatcher.Invoke(() =>
            {
                if (WebView?.CoreWebView2 == null) return;
                _ = WebView.CoreWebView2.ExecuteScriptAsync(
                    $"window.__pvsUpdateProgress && window.__pvsUpdateProgress({percent});");
            });
        }
        catch { /* окно закрывается — прогресс уже не нужен */ }
    }

    private static byte[] DecodeBase64Data(string data)
    {
        if (data.StartsWith("data:"))
            data = data[(data.IndexOf(',') + 1)..];
        return Convert.FromBase64String(data);
    }

    private void SetStatus(string text) =>
        Dispatcher.Invoke(() => SplashStatus.Text = text);

    private void OnClosed(object? sender, EventArgs e)
    {
        try { _serverProcess?.Kill(entireProcessTree: true); } catch { }
    }

    // ── JS-bootstrap (вставляется после загрузки страницы) ───────────────────

    private string BuildJsBootstrap()
    {
        // camelCase — чтобы JS видел upd.version / upd.downloadUrl (не Version/DownloadUrl)
        var jsOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        string updateJson  = _updateInfo != null ? JsonSerializer.Serialize(_updateInfo, jsOpts) : "null";
        string pendingFile = _pendingFile != null ? JsonSerializer.Serialize(_pendingFile) : "null";
        string isMaxStr    = WindowState == WindowState.Maximized ? "true" : "false";

        return $$"""
(function() {
    // ── Флаг десктопного режима (дублируем на случай перезагрузки страницы) ──
    window.__IS_DESKTOP__       = true;
    window.__DESKTOP_SERVER__   = '{{ServerUrl}}';
    window.__pvsWindowMaximized = {{isMaxStr}};

    // ── Реестр pending-промисов для C# ответов ──
    var _pending = {};
    window.__pvsCsReply = function(reqId, payload) {
        if (_pending[reqId]) { _pending[reqId](payload); delete _pending[reqId]; }
    };
    function callCs(cmd, params) {
        return new Promise(function(resolve) {
            var id = Math.random().toString(36).slice(2);
            _pending[id] = resolve;
            window.chrome.webview.postMessage(JSON.stringify(Object.assign({ cmd: cmd, reqId: id }, params || {})));
        });
    }
    // Без reqId (fire-and-forget)
    function sendCs(cmd, params) {
        window.chrome.webview.postMessage(JSON.stringify(Object.assign({ cmd: cmd }, params || {})));
    }

    // ── electronAPI совместимость ────────────────
    window.electronAPI = {
        onOpenFile:    function(handler) {
            window._pvs_open_handler = handler;
            callCs('get-pending-file', {}).then(function(r) {
                if (r && r.content) handler({ path: r.path, content: r.content });
            });
        },
        offOpenFile:   function() { window._pvs_open_handler = null; },
        readFile:      function(path)    { return callCs('read-file',   { path: path }); },
        writeFile:     function(path, c) { return callCs('write-file',  { path: path, content: c }); },
        getVersion:    function()        { return Promise.resolve({ current: '{{AppVersion}}', update: {{updateJson}} }); },
        installUpdate: function()        { return callCs('install-update', {}); }
    };

    // ── Кнопки управления окном ──────────────────
    // Переопределяем обработчики — работают через C# сообщения
    window.__pvsWinMinimize = function() { sendCs('win-minimize'); };
    window.__pvsWinMaximize = function() { sendCs('win-maximize'); };
    window.__pvsWinDrag     = function() { sendCs('win-drag'); };
    // Кнопка закрыть — JS сам показывает диалог если есть несохранённые данные,
    // затем при подтверждении шлёт 'win-close' (JS уже отработал)
    window.__pvsWinClose = function() { sendCs('win-close'); };
    // C# вызывает __pvsShowCloseDialog() когда системная кнопка X нажата
    // React-компонент переопределит эту функцию после загрузки
    window.__pvsShowCloseDialog = function() {
        // Fallback если React ещё не загрузился
        sendCs('win-close-confirmed');
    };

    // ── Перехват <a download> ────────────────────
    function saveViaCs(filename, dataUrl) {
        return callCs('save-file', { filename: filename, data: dataUrl });
    }
    function interceptAnchor(a) {
        if (!a.download) return false;
        var href = a.href || a.getAttribute('href') || '';
        var filename = a.download || 'file';
        if (href.startsWith('data:')) { saveViaCs(filename, href); return true; }
        if (href.startsWith('blob:')) {
            fetch(href).then(function(r) { return r.blob(); }).then(function(blob) {
                var reader = new FileReader();
                reader.onload = function() { saveViaCs(filename, reader.result); };
                reader.readAsDataURL(blob);
            });
            return true;
        }
        return false;
    }
    var _origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        if (interceptAnchor(this)) return;
        _origClick.call(this);
    };
    document.addEventListener('click', function(e) {
        var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
        if (a && interceptAnchor(a)) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // ── Перехват jsPDF.save() ────────────────────
    var _jsPdfInterval = setInterval(function() {
        var ns = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (ns && ns.prototype && ns.prototype.save) {
            var _orig = ns.prototype.save;
            ns.prototype.save = function(filename) {
                try { saveViaCs(filename || 'document.pdf', this.output('datauristring')); }
                catch(e) { _orig.call(this, filename); }
            };
            clearInterval(_jsPdfInterval);
        }
    }, 300);

    // ── Перехват XLSX.writeFile ──────────────────
    var _xlsxInterval = setInterval(function() {
        if (typeof XLSX !== 'undefined' && XLSX.writeFile) {
            XLSX.writeFile = function(wb, filename) {
                var ext = (filename.split('.').pop() || 'xlsx');
                var data = XLSX.write(wb, { bookType: ext, type: 'base64' });
                saveViaCs(filename, 'data:application/octet-stream;base64,' + data);
            };
            clearInterval(_xlsxInterval);
        }
    }, 300);

    // ── Баннер обновления ────────────────────────
    // ВАЖНО: собственный баннер здесь БОЛЬШЕ НЕ рисуем — иначе получалось ДВА
    // баннера (этот + React-компонент AppUpdateBanner). Оставляем только React:
    // он показывает версию, прогресс загрузки и кнопки «Обновить»/«Позже».
    // Прогресс скачивания из C# приходит в window.__pvsUpdateProgress(percent).
})();
""";
    }
}

// ── DTO ───────────────────────────────────────────────────────────────────────

public class UpdateInfo
{
    public string? Version { get; set; }

    // Сервер отдаёт поле в snake_case ("download_url") — маппим явно,
    // т.к. PropertyNameCaseInsensitive не превращает snake_case в PascalCase.
    [System.Text.Json.Serialization.JsonPropertyName("download_url")]
    public string? DownloadUrl { get; set; }
}

public class VersionInfo
{
    public string? Version { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("download_url")]
    public string? DownloadUrl { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("server_version")]
    public string? ServerVersion { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("server_url")]
    public string? ServerUrl { get; set; }

    public string? Notes { get; set; }
}