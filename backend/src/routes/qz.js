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

function loadCert() {
    if (cachedCert === null) {
        cachedCert = fs.existsSync(CERT_PATH) ? fs.readFileSync(CERT_PATH, 'utf8') : '';
    }
    return cachedCert;
}

function loadKey() {
    if (cachedKey === null) {
        cachedKey = fs.existsSync(KEY_PATH) ? fs.readFileSync(KEY_PATH, 'utf8') : '';
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

