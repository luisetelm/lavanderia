import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import nodemailer from 'nodemailer';

// Explicación: script de prueba para enviar un email. Intenta SES (SendRawEmail) si hay AWS_REGION,
// y si falla hace fallback a SMTP usando las variables SMTP_* del .env.

dotenv.config({ path: path.join(process.cwd(), '.env') });

const {AWS_REGION, FROM_EMAIL, TO_EMAIL, PDF_PATH, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS} = process.env;

async function sendViaSES({from, to, subject, text, attachments}) {
  const mail = new MailComposer({from, to, subject, text, attachments});
  const raw = await mail.compile().build();
  const client = new SESClient({region: AWS_REGION});
  const cmd = new SendRawEmailCommand({RawMessage: {Data: raw}});
  return client.send(cmd);
}

async function sendViaSMTP({from, to, subject, text, attachments}) {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP not configured');
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: Number(SMTP_PORT) === 465,
    auth: {user: SMTP_USER, pass: SMTP_PASS},
    tls: { rejectUnauthorized: false },
  });
  await transporter.verify();
  return transporter.sendMail({from, to, subject, text, attachments});
}

(async function main() {
  const from = FROM_EMAIL || 'no-reply@example.com';
  const to = process.env.TO_EMAIL || process.env.SMTP_USER || 'hola@tinteyburbuja.es';
  const subject = 'Prueba de envío de factura (SES -> SMTP fallback)';
  const text = 'Este correo es una prueba automatizada. Ignóralo.';
  const attachments = [];
  if (PDF_PATH) {
    const p = path.resolve(PDF_PATH);
    if (fs.existsSync(p)) attachments.push({filename: path.basename(p), content: fs.readFileSync(p)});
    else console.warn('[test_send_ses] PDF_PATH definido pero archivo no encontrado:', p);
  }

  // Intentar SES por defecto (si AWS_REGION está configurada)
  if (AWS_REGION) {
    try {
      console.log('[test_send_ses] Intentando enviar por SES (API) ...');
      const res = await sendViaSES({from, to, subject, text, attachments});
      console.log('[test_send_ses] Enviado por SES OK:', res);
      return;
    } catch (err) {
      console.error('[test_send_ses] SES fallo:', err && err.message ? err.message : err);
      console.log('[test_send_ses] Procediendo a intentar fallback SMTP (si está configurado)...');
    }
  } else {
    console.log('[test_send_ses] AWS_REGION no configurada, saltando SES. Intentando SMTP si está disponible.');
  }

  // Fallback SMTP
  try {
    const res2 = await sendViaSMTP({from, to, subject, text, attachments});
    console.log('[test_send_ses] Enviado por SMTP OK:', res2 && res2.messageId ? {messageId: res2.messageId} : res2);
  } catch (err) {
    console.error('[test_send_ses] Error enviando por SMTP:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
