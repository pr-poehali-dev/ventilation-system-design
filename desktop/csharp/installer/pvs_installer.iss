#define AppName "ПВ-Система"
#define AppVersion "2.0.18"
#define AppPublisher "ПВС"
#define AppExeName "PVS.exe"
#define SourceDir "..\dist"
#define AppIcon "..\PvsApp\pvs.ico"
; Отдельная качественная иконка для файлов-схем .vproj (документ)
#define DocIcon "..\PvsApp\vproj.ico"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://poehali.dev
DefaultDirName={autopf}\PVS
DefaultGroupName={#AppName}
OutputDir=output
OutputBaseFilename=PVS-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\PvsApp\pvs.ico
UninstallDisplayIcon={app}\{#AppExeName}
; Сообщаем Windows, что установщик меняет файловые ассоциации —
; Explorer обновит иконки .vproj сразу после установки (без перезагрузки).
ChangesAssociations=yes
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
DisableProgramGroupPage=yes
ShowLanguageDialog=no
LanguageDetectionMethod=none
; Restart Manager сам закрывает приложения, держащие наши файлы, и не требует
; перезагрузки. Ниже (в CurStepChanged) дополнительно снимаем расчётное ядро
; server.exe — оно работает БЕЗ ОКНА, поэтому Restart Manager его не находит.
CloseApplications=yes
RestartApplications=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать значок на рабочем столе"; GroupDescription: "Дополнительные задачи:"

[Files]
; Главный exe
Source: "{#SourceDir}\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

; Чёткая иконка (16/32/48/256) — используется ярлыками
Source: "{#AppIcon}"; DestDir: "{app}"; DestName: "pvs.ico"; Flags: ignoreversion

; Отдельная чёткая иконка (16/32/48/64/128/256) для файлов-схем .vproj
Source: "{#DocIcon}"; DestDir: "{app}"; DestName: "vproj.ico"; Flags: ignoreversion

; Flask-сервер
Source: "{#SourceDir}\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs

; WebView2 Runtime (если нужен на Windows 10)
; Source: "redist\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\pvs.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\pvs.ico"; Tasks: desktopicon

[Registry]
; Ассоциация файлов .vproj
Root: HKCR; Subkey: ".vproj"; ValueType: string; ValueName: ""; ValueData: "PVS.Project"; Flags: uninsdeletevalue
Root: HKCR; Subkey: ".vproj"; ValueType: string; ValueName: "PerceivedType"; ValueData: "document"; Flags: uninsdeletevalue
Root: HKCR; Subkey: "PVS.Project"; ValueType: string; ValueName: ""; ValueData: "Схема ПВ-Система"; Flags: uninsdeletekey
Root: HKCR; Subkey: "PVS.Project"; ValueType: string; ValueName: "FriendlyTypeName"; ValueData: "Схема вентиляции ПВ-Система"
; Отдельная чёткая иконка документа (НЕ иконка exe) — качество на всех размерах
Root: HKCR; Subkey: "PVS.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\vproj.ico"
Root: HKCR; Subkey: "PVS.Project\shell"; ValueType: string; ValueName: ""; ValueData: "open"
Root: HKCR; Subkey: "PVS.Project\shell\open"; ValueType: string; ValueName: ""; ValueData: "Открыть в ПВ-Система"
; Двойной клик по файлу → запуск exe С ПУТЁМ к файлу ("%1")
Root: HKCR; Subkey: "PVS.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

[Run]
; Обычная установка (интерактивная): галочка «Запустить ПВ-Система» в конце.
Filename: "{app}\{#AppExeName}"; Description: "Запустить ПВ-Система"; Flags: nowait postinstall skipifsilent
; Тихое авто-обновление (/SILENT из самой программы): запускаем приложение
; ВСЕГДА, чтобы после обновления оно перезапустилось само (без ручного запуска).
; runasoriginaluser — стартуем от имени пользователя, а не от админа установщика.
Filename: "{app}\{#AppExeName}"; Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\PVS\WebView2Cache"
[Code]
// ─────────────────────────────────────────────────────────────────────────────
// Принудительная остановка расчётного ядра перед заменой файлов.
//
// ПРОБЛЕМА, которую это решает. На части компьютеров установка обновления
// прерывалась ошибкой:
//     C:\Program Files\PVS\server\server.exe
//     Произошла ошибка при попытке замены существующего файла:
//     DeleteFile: сбой; код 5. Отказано в доступе.
// Причина: расчётное ядро server.exe оставалось запущенным и держало свой файл.
// Оно работает в фоне без окна, поэтому встроенный механизм Windows
// (Restart Manager) его не обнаруживал и не закрывал.
//
// Само приложение теперь останавливает ядро перед обновлением, но установщик
// могут запустить и вручную — тогда сработает эта подстраховка.
// ─────────────────────────────────────────────────────────────────────────────
procedure StopCalcCore();
var
  ResultCode: Integer;
  i: Integer;
  CorePath: String;
begin
  CorePath := ExpandConstant('{app}\server\server.exe');

  // Ядра нет (первая установка) или файл уже свободен — вмешиваться не нужно.
  if not FileExists(CorePath) then Exit;
  if DeleteFile(CorePath) then Exit;

  // Файл занят — значит ядро работает. Снимаем процесс.
  // /F — принудительно, /T — вместе с дочерними процессами.
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM server.exe',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Ждём до 2 секунд: Windows снимает блокировку файла не мгновенно.
  for i := 1 to 10 do
  begin
    if DeleteFile(CorePath) then Break;
    if not FileExists(CorePath) then Break;
    Sleep(200);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  // ssInstall — момент прямо перед распаковкой файлов.
  if CurStep = ssInstall then
    StopCalcCore();
end;
