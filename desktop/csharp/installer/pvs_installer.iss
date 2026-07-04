#define AppName "ПВ-Система"
#define AppVersion "2.0.18"
#define AppPublisher "ПВС"
#define AppExeName "PVS.exe"
#define SourceDir "..\dist"
#define AppIcon "..\PvsApp\pvs.ico"

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
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
DisableProgramGroupPage=yes
ShowLanguageDialog=no
LanguageDetectionMethod=none

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать значок на рабочем столе"; GroupDescription: "Дополнительные задачи:"

[Files]
; Главный exe
Source: "{#SourceDir}\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

; Чёткая иконка (16/32/48/256) — используется ярлыками
Source: "{#AppIcon}"; DestDir: "{app}"; DestName: "pvs.ico"; Flags: ignoreversion

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
Root: HKCR; Subkey: "PVS.Project"; ValueType: string; ValueName: ""; ValueData: "ПВС Проект"; Flags: uninsdeletekey
Root: HKCR; Subkey: "PVS.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExeName},0"
Root: HKCR; Subkey: "PVS.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Запустить ПВ-Система"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\PVS\WebView2Cache"