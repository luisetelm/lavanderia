# ============================================================================
#  Configura QZ Tray para confiar en el certificado de Tinte y Burbuja.
#  Ejecutar UNA vez en CADA ordenador (caja/TPV) que tenga impresora.
#
#  Uso:
#    1. Clic derecho sobre este archivo -> "Ejecutar con PowerShell"
#       (o ejecutar como Administrador).
#    2. Aceptar el aviso de Control de Cuentas de Usuario (UAC).
#
#  Requisitos previos: tener QZ Tray instalado (https://qz.io/download/).
# ============================================================================
$ErrorActionPreference = 'Stop'

# URL desde la que se descarga el certificado publico (servidor de produccion)
$certUrl  = 'https://app.tinteyburbuja.com/api/qz/cert'
$certDest = 'C:\ProgramData\qz\digital-certificate.txt'
$props    = 'C:\Program Files\QZ Tray\qz-tray.properties'
$overrideCrt  = 'C:\Program Files\QZ Tray\override.crt'
$overrideLine = 'authcert.override=C:/ProgramData/qz/digital-certificate.txt'

# --- Relanzarse como Administrador si no lo es ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Solicitando permisos de administrador..."
    Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`""
    return
}

# --- 1. Descargar el certificado desde el servidor ---
Write-Host "Descargando certificado desde $certUrl ..."
New-Item -ItemType Directory -Force -Path (Split-Path $certDest) | Out-Null
try {
    Invoke-WebRequest -Uri $certUrl -OutFile $certDest -UseBasicParsing
    Write-Host "Certificado guardado en $certDest"
} catch {
    Write-Host "ERROR: no se pudo descargar el certificado. Detalle: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Si no hay internet, copia manualmente 'digital-certificate.txt' a $certDest"
    Read-Host "Pulsa Enter para salir"; return
}

# --- 2. Comprobar que QZ Tray esta instalado ---
if (-not (Test-Path $props)) {
    Write-Host "ERROR: no se encontro QZ Tray en 'C:\Program Files\QZ Tray'." -ForegroundColor Red
    Write-Host "Instalalo primero desde https://qz.io/download/ y vuelve a ejecutar este script."
    Read-Host "Pulsa Enter para salir"; return
}

# --- 3. Anadir authcert.override (si no existe ya) ---
$content = Get-Content $props -Raw
if ($content -notmatch 'authcert\.override') {
    Add-Content -Path $props -Value "`r`n$overrideLine"
    Write-Host "Propiedad authcert.override anadida a qz-tray.properties."
} else {
    Write-Host "authcert.override ya existia; no se modifica."
}

# --- 3b. Sobrescribir override.crt en la carpeta de QZ Tray ---
# QZ Tray carga automaticamente 'override.crt' de su carpeta. Si quedo uno
# antiguo/distinto, generaria conflicto, asi que lo dejamos igual al certificado.
Copy-Item -LiteralPath $certDest -Destination $overrideCrt -Force
Write-Host "override.crt actualizado con el certificado de produccion."

# --- 4. Reiniciar QZ Tray ---
Get-Process -Name 'qz-tray' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
$qzExe = 'C:\Program Files\QZ Tray\qz-tray.exe'
if (Test-Path $qzExe) {
    Start-Process $qzExe
    Write-Host "QZ Tray reiniciado."
} else {
    Write-Host "Abre QZ Tray manualmente desde el menu Inicio."
}

Write-Host ""
Write-Host "LISTO. Este ordenador ya confia en el certificado." -ForegroundColor Green
Write-Host "Prueba a imprimir desde la web; no deberia aparecer ningun dialogo de seguridad."
Read-Host "Pulsa Enter para cerrar"

