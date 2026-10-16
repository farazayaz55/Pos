!macro customInit
  ; Previous Mac-built uninstallers fail CRC and block upgrade.
  Delete "$INSTDIR\Uninstall*.exe"
!macroend
