; Установщик Synapse (NSIS, без прав администратора, RU/EN)
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
!define APPNAME "Synapse"
!define VERSION "0.2.0"
!define EXE "Synapse.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Synapse"

Name "${APPNAME}"
OutFile "..\dist\Synapse-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Synapse"
InstallDirRegKey HKCU "Software\Synapse" "InstallDir"
BrandingText "Synapse ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "Synapse"
VIAddVersionKey /LANG=1033 "FileDescription" "Synapse Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "wsq4kar · GPL-3.0"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "Software\Synapse"
!define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "$(RunText)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_RESERVEFILE_LANGDLL

LangString RunText ${LANG_RUSSIAN} "Запустить Synapse"
LangString RunText ${LANG_ENGLISH} "Launch Synapse"
LangString UninstName ${LANG_RUSSIAN} "Удалить Synapse"
LangString UninstName ${LANG_ENGLISH} "Uninstall Synapse"
LangString AppLang ${LANG_RUSSIAN} "ru"
LangString AppLang ${LANG_ENGLISH} "en"

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd
Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

Section "Synapse" SecMain
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  ; язык интерфейса по выбору в установщике (настройка в приложении важнее)
  WriteINIStr "$INSTDIR\lang.ini" "app" "lang" "$(AppLang)"
  WriteUninstaller "$INSTDIR\Uninstall Synapse.exe"
  CreateDirectory "$SMPROGRAMS\Synapse"
  CreateShortcut "$SMPROGRAMS\Synapse\Synapse.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$SMPROGRAMS\Synapse\$(UninstName).lnk" "$INSTDIR\Uninstall Synapse.exe"
  CreateShortcut "$DESKTOP\Synapse.lnk" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "Software\Synapse" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "Synapse"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "wsq4ka"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall Synapse.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Delete "$DESKTOP\Synapse.lnk"
  RMDir /r "$SMPROGRAMS\Synapse"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\Synapse"
  ; чаты, настройки и ключ в %APPDATA%\Synapse не удаляются
SectionEnd
