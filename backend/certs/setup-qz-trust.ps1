# Configura QZ Tray para confiar en el certificado de Tinte y Burbuja.
# Debe ejecutarse como Administrador.
$ErrorActionPreference = 'Stop'

$certSource = 'C:\Users\luise\OneDrive\Documentos\LAVANDERIA\backend\certs\digital-certificate.txt'
$certDest   = 'C:\ProgramData\qz\digital-certificate.txt'
$props      = 'C:\Program Files\QZ Tray\qz-tray.properties'
$overrideLine = 'authcert.override=C:/ProgramData/qz/digital-certificate.txt'

# 1. Copiar el certificado a una ubicación estable
Copy-Item $certSource $certDest -Force
Write-Host "Certificado copiado a $certDest"

# 2. Anadir authcert.override al archivo de propiedades (si no existe ya)
$content = Get-Content $props -Raw
if ($content -notmatch 'authcert\.override') {
    Add-Content -Path $props -Value "`r`n$overrideLine"
    Write-Host "Propiedad authcert.override anadida."
} else {
    Write-Host "authcert.override ya existe, no se modifica."
}

# 3. Reiniciar QZ Tray para aplicar los cambios
Get-Process -Name 'qz-tray' -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host ""
Write-Host "LISTO. Abre QZ Tray de nuevo desde el menu Inicio y prueba a imprimir."
Write-Host "Pulsa una tecla para cerrar..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')

