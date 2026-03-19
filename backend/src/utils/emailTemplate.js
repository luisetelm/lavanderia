/**
 * Plantilla de email corporativa para Tinte y Burbuja.
 * Uso: emailTemplate({ subject, title, body, footer })
 *   - title: título principal del email (opcional)
 *   - body: contenido HTML del cuerpo
 *   - footer: texto adicional en el pie (opcional)
 */

const BRAND_COLOR = '#048ABF';
const BRAND_DARK  = '#1e293b';
const BRAND_LIGHT = '#f8fafc';
const LOGO_URL    = (process.env.APP_URL || 'https://app.tinteyburbuja.com') + '/logo.png';

export function emailTemplate({ title, body, footer }) {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND_LIGHT}; font-family: 'Segoe UI', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${BRAND_LIGHT};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0"
               style="max-width: 560px; width: 100%; background: #ffffff; border-radius: 12px;
                      box-shadow: 0 2px 12px rgba(0,0,0,0.06); overflow: hidden;">

          <!-- Header con logo -->
          <tr>
            <td style="background: ${BRAND_DARK}; padding: 24px 32px; text-align: center;">
              <img src="${LOGO_URL}" alt="Tinte y Burbuja" height="44"
                   style="height: 44px; display: inline-block;" />
            </td>
          </tr>

          ${title ? `
          <!-- Título -->
          <tr>
            <td style="padding: 28px 32px 0; text-align: center;">
              <h1 style="margin: 0; font-size: 20px; color: ${BRAND_DARK}; font-weight: 600;">
                ${title}
              </h1>
            </td>
          </tr>
          ` : ''}

          <!-- Cuerpo -->
          <tr>
            <td style="padding: 24px 32px 32px; color: #334155; font-size: 15px; line-height: 1.6;">
              ${body}
            </td>
          </tr>

          <!-- Separador -->
          <tr>
            <td style="padding: 0 32px;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px 24px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              ${footer || ''}
              <p style="margin: 8px 0 0;">
                <strong>Tinte y Burbuja</strong><br>
                Lavandería &amp; Tintorería
              </p>
              <p style="margin: 4px 0 0;">
                <a href="https://tinteyburbuja.com" style="color: ${BRAND_COLOR}; text-decoration: none;">tinteyburbuja.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Helper para generar un botón centrado (CTA) en el email.
 * Uso: emailButton({ text, url })
 */
export function emailButton({ text, url }) {
    return `
      <div style="text-align: center; margin: 24px 0;">
        <a href="${url}"
           style="background: ${BRAND_COLOR}; color: #ffffff; padding: 12px 32px; border-radius: 8px;
                  text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          ${text}
        </a>
      </div>`;
}
