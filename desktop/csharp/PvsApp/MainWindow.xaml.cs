using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace PvsApp;

public partial class MainWindow : Window
{
    private const int    Port            = 5173;
    private const string AppVersion      = "1.0.0";
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

        // ── Передаём горячие клавиши в страницу вместо перехвата WPF ──────────
        // Без этого Ctrl+клик, Delete, S+S (S дважды) не работают в WebView2
        WebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
        WebView.KeyDown += OnWebViewKeyDown;

        WebView.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        WebView.CoreWebView2.Navigate(ServerUrl);
    }

    // ── Передача клавиш из WPF в WebView2 ────────────────────────────────────

    private void OnWebViewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        // Ctrl+S, Ctrl+Z, Ctrl+Y, Delete — передаём в страницу напрямую через JS
        // WebView2 с AreBrowserAcceleratorKeysEnabled=false перехватывает их на уровне WPF
        bool ctrl  = Keyboard.IsKeyDown(Key.LeftCtrl) || Keyboard.IsKeyDown(Key.RightCtrl);
        bool shift = Keyboard.IsKeyDown(Key.LeftShift) || Keyboard.IsKeyDown(Key.RightShift);
        bool alt   = Keyboard.IsKeyDown(Key.LeftAlt) || Keyboard.IsKeyDown(Key.RightAlt);

        string? jsKey = e.Key switch
        {
            Key.Delete   => "Delete",
            Key.S        => "s",
            Key.Z        => "z",
            Key.Y        => "y",
            Key.A        => "a",
            Key.C        => "c",
            Key.V        => "v",
            Key.X        => "x",
            Key.F9       => "F9",
            Key.F6       => "F6",
            Key.Escape   => "Escape",
            Key.Enter    => "Enter",
            _            => null
        };

        if (jsKey == null) return;

        // Выносим значения в переменные чтобы избежать вложенных кавычек в интерполяции
        string ctrlStr  = ctrl  ? "true" : "false";
        string shiftStr = shift ? "true" : "false";
        string altStr   = alt   ? "true" : "false";
        string codeStr  = e.Key.ToString();

        string js = "(function() {" +
            "var target = document.activeElement || document.body;" +
            "var ev = new KeyboardEvent('keydown', {" +
                "key: '" + jsKey + "'," +
                "code: '" + codeStr + "'," +
                "ctrlKey: "  + ctrlStr  + "," +
                "shiftKey: " + shiftStr + "," +
                "altKey: "   + altStr   + "," +
                "bubbles: true," +
                "cancelable: true" +
            "});" +
            "target.dispatchEvent(ev);" +
            "document.dispatchEvent(ev);" +
        "})();";

        _ = WebView.CoreWebView2.ExecuteScriptAsync(js);
        e.Handled = true;
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
        if (WebView?.CoreWebView2 == null) return;
        string maxVal = WindowState == WindowState.Maximized ? "true" : "false";
        _ = WebView.CoreWebView2.ExecuteScriptAsync(
            "window.__pvsWindowMaximized = " + maxVal + ";" +
            "window.dispatchEvent(new CustomEvent('pvs-window-state', { detail: { maximized: " + maxVal + " } }));");
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
                    // DragMove работает только когда кнопка мыши зажата
                    try { if (Mouse.LeftButton == MouseButtonState.Pressed) DragMove(); }
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
            if (data?.Version != null && data.Version != AppVersion)
                return data;
        }
        catch { }
        return null;
    }

    private async Task HandleInstallUpdate()
    {
        if (_updateInfo?.DownloadUrl == null) return;
        try
        {
            string exePath  = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule!.FileName;
            string tmpPath  = exePath + ".new.exe";
            string batPath  = Path.GetTempFileName() + ".bat";

            using var stream = await Http.GetStreamAsync(_updateInfo.DownloadUrl);
            using var file   = File.Create(tmpPath);
            await stream.CopyToAsync(file);

            string bat = $"""
                @echo off
                timeout /t 2 /nobreak >nul
                move /Y "{tmpPath}" "{exePath}"
                start "" "{exePath}"
                del "%~f0"
                """;
            File.WriteAllText(batPath, bat, Encoding.GetEncoding(1251));
            Process.Start(new ProcessStartInfo("cmd", $"/c \"{batPath}\"")
                { CreateNoWindow = true, UseShellExecute = false });
            Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
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
        string updateJson  = _updateInfo != null ? JsonSerializer.Serialize(_updateInfo) : "null";
        string pendingFile = _pendingFile != null ? JsonSerializer.Serialize(_pendingFile) : "null";
        string isMaxStr    = WindowState == WindowState.Maximized ? "true" : "false";

        return $$"""
(function() {
    // ── Флаг десктопного режима ──────────────────
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
    var upd = {{updateJson}};
    if (upd && upd.version) {
        setTimeout(function() {
            var b = document.createElement('div');
            b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1d4ed8;color:#fff;padding:8px 16px;display:flex;align-items:center;gap:12px;font-family:sans-serif;font-size:13px;';
            b.innerHTML = '<span>Доступно обновление <b>v' + upd.version + '</b></span>'
                + '<button onclick="window.electronAPI.installUpdate()" style="margin-left:auto;background:#fff;color:#1d4ed8;border:none;padding:4px 14px;border-radius:4px;cursor:pointer;font-weight:600;">Обновить</button>'
                + '<button onclick="this.parentNode.remove()" style="background:transparent;color:#fff;border:none;cursor:pointer;font-size:16px;">✕</button>';
            document.body && document.body.prepend(b);
        }, 3000);
    }
})();
""";
    }
}

// ── DTO ───────────────────────────────────────────────────────────────────────

public class UpdateInfo
{
    public string? Version     { get; set; }
    public string? DownloadUrl { get; set; }
}

public class VersionInfo
{
    public string? Version       { get; set; }
    public string? DownloadUrl   { get; set; }
    public string? ServerVersion { get; set; }
    public string? ServerUrl     { get; set; }
    public string? Notes         { get; set; }
}