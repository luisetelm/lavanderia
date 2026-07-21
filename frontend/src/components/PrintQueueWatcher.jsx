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
                const puesto = ajustes.nombrePuesto || navigator.platform || 'puesto';
                const encargos = await reclamarImpresiones(token, {puesto, max: 5});
                if (!Array.isArray(encargos) || encargos.length === 0) return;

                for (const job of encargos) {
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
                        await marcarImpresionHecha(token, job.id);
                    } catch (e) {
                        console.warn('Fallo imprimiendo encargo', job.id, e);
                        await marcarImpresionFallida(token, job.id, e?.message || e).catch(() => {});
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
