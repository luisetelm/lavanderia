import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// Capturador global de lector de códigos (1D/QR en modo "teclado").
// Los lectores envían los caracteres muy rápido y terminan con Enter. Detectamos
// esa ráfaga (independientemente del foco) y abrimos el pedido correspondiente.
//
// - Si el código es el QR del ticket de cliente (magic link del portal,
//   .../portal/verify/<jwt>), extrae el JWT: identifica al cliente, y
//   /buscar-pedido resuelve sus pedidos activos.
// - Si el código es una URL con ...buscar-pedido?num=XXXX, extrae XXXX.
// - Si es texto plano (p. ej. el CODE39 de la etiqueta de lavado: "TPV/2025/0095"),
//   lo usa tal cual como número de pedido.

// Un JWT siempre empieza por "eyJ" (base64url de '{"') y sus tres partes usan
// sólo [A-Za-z0-9_-]. Buscarlo así lo recupera intacto aunque el prefijo de la
// URL venga codificado o alterado por el lector.
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

export default function ScanCapture() {
    const navigate = useNavigate();
    const bufferRef = useRef('');
    const timesRef = useRef([]);

    useEffect(() => {
        const MAX_GAP_MS = 50;   // separación máxima entre teclas para considerarlo "lector"
        const MIN_LENGTH = 5;    // longitud mínima del código

        const reset = () => { bufferRef.current = ''; timesRef.current = []; };

        const handleScan = (raw) => {
            let num = (raw || '').trim();
            if (!num) return;

            // El magic link se comprueba antes que num=: si el lector ya venía
            // metiendo la URL entera dentro de num=, el JWT sigue ahí dentro y
            // es lo que de verdad identifica el ticket.
            const magic = num.match(JWT_RE);
            if (magic) {
                navigate(`/buscar-pedido?token=${encodeURIComponent(magic[0])}`);
                return;
            }

            const m = num.match(/[?&]num=([^&\s]+)/i);
            if (m) {
                try { num = decodeURIComponent(m[1]); } catch { num = m[1]; }
            }
            navigate(`/buscar-pedido?num=${encodeURIComponent(num)}`);
        };

        const onKeyDown = (e) => {
            const now = Date.now();

            if (e.key === 'Enter') {
                const buf = bufferRef.current;
                const times = timesRef.current;
                // ¿Fue una ráfaga rápida (lector) y suficientemente larga?
                const fastBurst = times.length >= MIN_LENGTH &&
                    times.every((t, i) => i === 0 || (t - times[i - 1]) <= MAX_GAP_MS);
                if (fastBurst && buf.length >= MIN_LENGTH) {
                    e.preventDefault();
                    handleScan(buf);
                }
                reset();
                return;
            }

            // Solo caracteres imprimibles
            if (e.key.length === 1) {
                const times = timesRef.current;
                if (times.length && (now - times[times.length - 1]) > MAX_GAP_MS) {
                    // Pausa larga → reinicia (tecleo humano)
                    reset();
                }
                bufferRef.current += e.key;
                timesRef.current.push(now);
            }
        };

        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [navigate]);

    return null;
}

