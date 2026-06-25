// frontend/src/qzInit.js

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

function waitForQZ(timeout = 3000) {
    return new Promise((resolve, reject) => {
        const interval = 50;
        let elapsed = 0;
        const check = () => {
            if (window.qz) return resolve();
            elapsed += interval;
            if (elapsed >= timeout) return reject(new Error('QZ Tray no se cargó en el tiempo esperado'));
            setTimeout(check, interval);
        };
        check();
    });
}

let securityConfigured = false;

// Configura la firma con certificado para que QZ Tray no muestre el diálogo
// de seguridad. La clave privada vive solo en el backend.
function configureSecurity() {
    if (securityConfigured) return;
    securityConfigured = true;

    // Certificado público: lo sirve el backend
    qz.security.setCertificatePromise((resolve, reject) => {
        fetch(`${API_BASE}/qz/cert`, { cache: 'no-store' })
            .then((res) => (res.ok ? res.text() : Promise.reject(new Error('No se pudo obtener el certificado QZ'))))
            .then(resolve)
            .catch(reject);
    });

    // Algoritmo de firma (debe coincidir con el del backend: SHA512)
    if (qz.security.setSignatureAlgorithm) {
        qz.security.setSignatureAlgorithm('SHA512');
    }

    // Firma de cada petición: la calcula el backend con la clave privada
    qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
        fetch(`${API_BASE}/qz/sign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request: toSign }),
        })
            .then((res) => (res.ok ? res.text() : Promise.reject(new Error('No se pudo firmar la petición QZ'))))
            .then(resolve)
            .catch(reject);
    });
}

export async function connectQZ(retries = 3, delay = 500) {
    if (typeof window === 'undefined') throw new Error('No hay window');
    await waitForQZ(); // espera a que el script haya enlazado window.qz

    qz.api.setPromiseType((promise) => promise);
    configureSecurity();

    for (let i = 0; i <= retries; i++) {
        try {
            if (!qz.websocket.isActive()) {
                await qz.websocket.connect();
            }
            return; // conectado
        } catch (err) {
            if (i === retries) throw err;
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}
