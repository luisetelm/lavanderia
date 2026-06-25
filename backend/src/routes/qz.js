// backend/src/routes/qz.js
// Endpoints para la firma de peticiones de QZ Tray.
// La clave privada NUNCA se expone al frontend: el navegador pide a estos
// endpoints (a) el certificado público y (b) la firma de cada petición.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CERTS_DIR = path.join(process.cwd(), 'certs');
const CERT_PATH = path.join(CERTS_DIR, 'digital-certificate.txt');
const KEY_PATH = path.join(CERTS_DIR, 'private-key.pem');

let cachedCert = null;
let cachedKey = null;

// Permite definir el secreto en una variable de entorno usando "\n" como
// separador de línea (cómodo para .env de una sola línea) o saltos reales.
function normalizePem(value) {
    return String(value || '').replace(/\\n/g, '\n').trim();
}

// Prioridad: variable de entorno (QZ_CERT / QZ_PRIVATE_KEY) -> archivo en certs/.
function loadCert() {
    if (cachedCert === null) {
        if (process.env.QZ_CERT) {
            cachedCert = normalizePem(process.env.QZ_CERT);
        } else if (fs.existsSync(CERT_PATH)) {
            cachedCert = fs.readFileSync(CERT_PATH, 'utf8');
        } else {
            cachedCert = '';
        }
    }
    return cachedCert;
}

function loadKey() {
    if (cachedKey === null) {
        if (process.env.QZ_PRIVATE_KEY) {
            cachedKey = normalizePem(process.env.QZ_PRIVATE_KEY);
        } else if (fs.existsSync(KEY_PATH)) {
            cachedKey = fs.readFileSync(KEY_PATH, 'utf8');
        } else {
            cachedKey = '';
        }
    }
    return cachedKey;
}

export default async function qzRoutes(fastify) {
    // Devuelve el certificado digital público (texto plano PEM)
    fastify.get('/cert', async (req, reply) => {
        const cert = loadCert();
        if (!cert) {
            return reply.status(500).send({ error: 'Certificado QZ no configurado en el servidor' });
        }
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        return reply.send(cert);
    });

    // Firma la petición que envía QZ Tray con la clave privada (SHA-512 / RSA)
    fastify.post('/sign', async (req, reply) => {
        const key = loadKey();
        if (!key) {
            return reply.status(500).send({ error: 'Clave privada QZ no configurada en el servidor' });
        }
        const toSign = (req.body && req.body.request) ? String(req.body.request) : '';
        try {
            const signer = crypto.createSign('SHA512');
            signer.update(toSign);
            signer.end();
            const signature = signer.sign(key, 'base64');
            reply.header('Content-Type', 'text/plain; charset=utf-8');
            return reply.send(signature);
        } catch (err) {
            req.log.error({ err }, 'Error firmando petición QZ');
            return reply.status(500).send({ error: 'No se pudo firmar la petición' });
        }
    });
}

