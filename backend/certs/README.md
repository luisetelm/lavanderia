# Firma de certificado para QZ Tray

Esta carpeta contiene el certificado y la clave usados para firmar las
peticiones de impresión, de modo que **QZ Tray no muestre el diálogo de
seguridad** cada vez.

## Archivos

- `digital-certificate.txt` → Certificado **público**. Se sube a git y lo sirve
  el backend en `GET /api/qz/cert`.
- `private-key.pem` → Clave **privada**. **NUNCA se sube a git** (está en
  `.gitignore`). Solo vive en el servidor y se usa en `POST /api/qz/sign`.

## Cómo funciona

1. El frontend (`qzInit.js`) configura:
   - `qz.security.setCertificatePromise` → descarga el certificado de `/api/qz/cert`.
   - `qz.security.setSignaturePromise` → pide al backend (`/api/qz/sign`) que firme
     cada petición con la clave privada (algoritmo **SHA512**).
2. QZ Tray verifica la firma contra el certificado. Si el certificado está en su
   lista de confianza, imprime sin preguntar.

## Paso final (UNA sola vez por ordenador): confiar en el certificado

Para que QZ Tray no muestre el diálogo, hay que añadir este certificado a su
lista de confianza:

### Opción A — Archivo de propiedades (recomendado)

1. Asegúrate de tener **QZ Tray instalado y abierto** (icono en la bandeja del sistema).
2. Copia `digital-certificate.txt` a una ruta estable, por ejemplo:
   `C:\QZ\digital-certificate.txt`
3. Edita (o crea) el archivo de propiedades de QZ Tray:
   `C:\Program Files\QZ Tray\qz-tray.properties`
   y añade la línea (usa barras normales `/`):
   ```
   authcert.override=C:/QZ/digital-certificate.txt
   ```
4. Sal de QZ Tray del todo (clic derecho en el icono → Exit) y vuelve a abrirlo.

### Opción B — Permitir desde el diálogo

Si prefieres no tocar archivos: la primera vez que imprimas, QZ Tray mostrará un
diálogo con el certificado "Tinte y Burbuja". Marca **"Remember this decision"**
y pulsa **Allow**. No volverá a preguntar en ese equipo.

## Regenerar el certificado (si caduca, válido 10 años)

```powershell
cd backend
openssl req -x509 -newkey rsa:2048 -keyout certs\private-key.pem -out certs\digital-certificate.txt -days 3650 -nodes -sha256 -subj "/C=ES/O=Tinte y Burbuja/CN=Tinte y Burbuja"
```

> Nota: si regeneras el certificado, hay que repetir el "Paso final" en cada
> ordenador, porque cambia la clave.

