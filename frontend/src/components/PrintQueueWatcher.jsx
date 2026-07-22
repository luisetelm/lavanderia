import {useEffect, useRef} from 'react';
import {reclamarImpresiones, marcarImpresionHecha, marcarImpresionFallida} from '../api.js';
import {getPrintSettings} from '../utils/printSettings.js';
import {printFinishedLabelForOrder, printGarmentLabel, puedeImprimirAqui} from '../utils/printUtils.js';

// Vacía la cola de impresión.
//
// Sólo hace algo en el puesto que tiene la impresora (ajuste "tieneImpresora").
// La tablet del taller deja encargos; este componente los recoge y los imprime
// con el QZ Tray local, reutilizando exactamente las mismas funciones que se
// usan al imprimir desde este puesto.
//
// No se solapan dos vueltas: si una impresión tarda, la siguiente comprobación
// se salta en vez de acumular trabajos a medias.

const INTERVALO_MS = 6000;

// Encargos que YA han salido por la impresora pero cuya confirmación no ha
// llegado al servidor (un corte de red al confirmar, por ejemplo).
//
// Sin esto, el fallo al confirmar se trataba como fallo de impresión: el
// encargo volvía a 'pending', se reclamaba en la vuelta siguiente y el papel
// salía otra vez, hasta 3 veces (el tope de reintentos del backend). Se guarda
// en el propio puesto porque es el único que sabe si el papel salió.
const CONFIRMACIONES_KEY = 'colaImpresionPorConfirmar';
const MAX_RECORDADOS = 200;

function leerPorConfirmar() {
    try {
        const v = JSON.parse(localStorage.getItem(CONFIRMACIONES_KEY) || '[]');
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}

function guardarPorConfirmar(ids) {
    try {
        localStorage.setItem(CONFIRMACIONES_KEY, JSON.stringify(ids.slice(-MAX_RECORDADOS)));
    } catch { /* almacenamiento lleno: se reintentará la confirmación igualmente */ }
}

function anotarImpreso(id) {
    const ids = leerPorConfirmar();
    if (!ids.includes(id)) guardarPorConfirmar([...ids, id]);
}

function olvidarImpreso(id) {
    guardarPorConfirmar(leerPorConfirmar().filter(x => x !== id));
}

export default function PrintQueueWatcher({token}) {
    const ocupado = useRef(false);

    useEffect(() => {
        if (!token) return;

        const vaciarCola = async () => {
            const ajustes = getPrintSettings();
            if (ocupado.current) return;              // la vuelta anterior sigue en marcha
            if (document.hidden) return;              // pestaña en segundo plano

            // No basta con el ajuste: hay que tener QZ Tray de verdad. Si no,
            // este puesto reclamaría encargos que luego no podría imprimir.
            if (!await puedeImprimirAqui()) return;

            ocupado.current = true;
            try {
                // Confirmaciones que quedaron a medias en vueltas anteriores.
                for (const id of leerPorConfirmar()) {
                    try {
                        await marcarImpresionHecha(token, id);
                        olvidarImpreso(id);
                    } catch { /* se reintenta en la siguiente vuelta */ }
                }

                const puesto = ajustes.nombrePuesto || navigator.platform || 'puesto';
                const encargos = await reclamarImpresiones(token, {puesto, max: 5});
                if (!Array.isArray(encargos) || encargos.length === 0) return;

                for (const job of encargos) {
                    // Ya salió por la impresora: sólo falta que el servidor se
                    // entere. Reimprimirlo sería sacar el mismo papel dos veces.
                    if (leerPorConfirmar().includes(job.id)) {
                        try {
                            await marcarImpresionHecha(token, job.id);
                            olvidarImpreso(job.id);
                        } catch { /* siguiente vuelta */ }
                        continue;
                    }

                    try {
                        if (job.type === 'finished_label') {
                            const order = await printFinishedLabelForOrder(token, job.orderId);
                            // printFinishedLabelForOrder devuelve null si la impresión
                            // automática está desactivada en este puesto: en ese caso el
                            // encargo no se ha atendido y debe volver a la cola.
                            if (!order) throw new Error('La impresión de etiquetas de recogida está desactivada en este puesto');
                        } else if (job.type === 'garment_label') {
                            await printGarmentLabel(job.payload || {});
                        } else {
                            throw new Error(`Tipo de impresión desconocido: ${job.type}`);
                        }
                    } catch (e) {
                        // Fallo ANTES de que saliera el papel: sí procede reintentar.
                        console.warn('Fallo imprimiendo encargo', job.id, e);
                        await marcarImpresionFallida(token, job.id, e?.message || e).catch(() => {});
                        continue;
                    }

                    // Desde aquí el papel ya ha salido: pase lo que pase con la
                    // confirmación, este encargo no se vuelve a imprimir.
                    anotarImpreso(job.id);
                    try {
                        await marcarImpresionHecha(token, job.id);
                        olvidarImpreso(job.id);
                    } catch (e) {
                        console.warn('Encargo impreso pero sin confirmar; se confirmará después', job.id, e);
                    }
                }
            } catch (e) {
                // Sin conexión o servidor caído: se reintenta en la siguiente vuelta.
                console.debug('Cola de impresión no disponible:', e?.error || e?.message || e);
            } finally {
                ocupado.current = false;
            }
        };

        vaciarCola();
        const t = setInterval(vaciarCola, INTERVALO_MS);
        return () => clearInterval(t);
    }, [token]);

    return null;
}
