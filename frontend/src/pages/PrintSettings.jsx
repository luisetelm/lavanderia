import React, { useCallback, useEffect, useState } from 'react';
import PageToolbar from '../components/PageToolbar.jsx';
import { getPrintSettings, setPrintSettings } from '../utils/printSettings.js';
import { connectQZ } from '../qzInit.js';
import { listPrinters } from '../qzHelper.js';
import { printWasherTest } from '../utils/printUtils.js';
import { fetchColaImpresion, marcarImpresionHecha } from '../api.js';

const ESTADOS_COLA = {
    pending: { texto: 'En espera', color: '#b45309', fondo: '#fef3c7' },
    printing: { texto: 'Imprimiendo', color: '#1d4ed8', fondo: '#dbeafe' },
    failed: { texto: 'Fallido', color: '#b91c1c', fondo: '#fee2e2' },
    done: { texto: 'Impreso', color: '#15803d', fondo: '#dcfce7' },
};

const TIPOS_COLA = {
    finished_label: 'Etiqueta de recogida',
    garment_label: 'Etiqueta de prenda',
};

export default function PrintSettings({ token }) {
    const [settings, setSettings] = useState(getPrintSettings());
    const [printerTicket, setPrinterTicket] = useState(
        localStorage.getItem('printerTicket') || localStorage.getItem('posPrinterName') || ''
    );
    const [printerWasher, setPrinterWasher] = useState(localStorage.getItem('printerWasher') || '');
    const [saved, setSaved] = useState(false);
    const [printers, setPrinters] = useState([]);
    const [detecting, setDetecting] = useState(false);
    const [detectError, setDetectError] = useState('');
    const [testing, setTesting] = useState(false);
    const [testMsg, setTestMsg] = useState('');
    const [cola, setCola] = useState([]);
    const [colaError, setColaError] = useState('');
    const [colaCargando, setColaCargando] = useState(false);

    // La cola es del sistema, no de este dispositivo: se ve igual desde
    // cualquier puesto. Muestra los encargos vivos (en espera, imprimiendo y
    // fallidos), que es donde se ve si algo se ha atascado.
    const cargarCola = useCallback(async () => {
        if (!token) return;
        setColaCargando(true);
        try {
            const jobs = await fetchColaImpresion(token);
            setCola(Array.isArray(jobs) ? jobs : []);
            setColaError('');
        } catch (e) {
            console.error('No se pudo consultar la cola de impresión:', e);
            setColaError('No se pudo consultar la cola.');
        } finally {
            setColaCargando(false);
        }
    }, [token]);

    useEffect(() => {
        cargarCola();
        const t = setInterval(cargarCola, 10000);
        return () => clearInterval(t);
    }, [cargarCola]);

    // Saca de la cola un encargo atascado sin imprimirlo.
    const descartarEncargo = async (id) => {
        try {
            await marcarImpresionHecha(token, id);
            await cargarCola();
        } catch (e) {
            console.error('No se pudo descartar el encargo:', e);
            setColaError('No se pudo descartar el encargo.');
        }
    };

    const detectPrinters = async () => {
        setDetecting(true);
        setDetectError('');
        try {
            await connectQZ();
            const found = await listPrinters();
            // listPrinters puede devolver un array de nombres o un único string.
            setPrinters(Array.isArray(found) ? found : (found ? [found] : []));
        } catch (e) {
            console.error('No se pudieron detectar impresoras:', e);
            setDetectError('No se pudo conectar con QZ Tray. Asegúrate de que está abierto.');
        } finally {
            setDetecting(false);
        }
    };

    const testWasher = async () => {
        setTesting(true);
        setTestMsg('');
        try {
            await printWasherTest(printerWasher.trim() || undefined);
            setTestMsg('Prueba enviada. Revisa la impresora.');
        } catch (e) {
            console.error('Error en prueba de impresión:', e);
            setTestMsg('Error: no se pudo imprimir. ¿QZ Tray abierto y nombre correcto?');
        } finally {
            setTesting(false);
            setTimeout(() => setTestMsg(''), 4000);
        }
    };

    const toggle = (key) => {
        const next = setPrintSettings({ [key]: !settings[key] });
        setSettings(next);
        flashSaved();
    };

    const saveKey = (storageKey, val, setter) => {
        setter(val);
        if (val.trim()) localStorage.setItem(storageKey, val.trim());
        else localStorage.removeItem(storageKey);
        flashSaved();
    };

    const flashSaved = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    };

    const rows = [
        { key: 'onCreate', title: 'Al confirmar el pedido', desc: 'Imprime solo las etiquetas de ropa (impresora de etiquetas lavables).' },
        { key: 'onPay', title: 'Al cobrar', desc: 'Imprime el ticket de cliente (papel normal).' },
        { key: 'onReady', title: 'Al marcar como listo', desc: 'Imprime la etiqueta de recogida del pedido completo (papel normal).' },
        { key: 'onGarmentReady', title: 'Al finalizar cada prenda', desc: 'Imprime una etiqueta "Finalizado" por cada prenda en cuanto completa su tracking, sin esperar al resto del pedido (papel normal).' },
    ];

    return (
        <div>
            <PageToolbar title="Impresión" />

            <div className="section-content">
                {saved && (
                    <div className="uk-alert-success" uk-alert="true">
                        <p>Ajustes guardados</p>
                    </div>
                )}

                <div className="uk-card uk-card-default uk-card-body uk-margin">
                    <h4 className="uk-margin-small-top">Impresión automática</h4>
                    <p className="uk-text-muted" style={{ fontSize: '0.85rem' }}>
                        Activa o desactiva la impresión automática en cada momento del flujo del pedido.
                    </p>
                    <ul className="uk-list uk-list-divider">
                        {rows.map((r) => (
                            <li key={r.key} className="uk-flex uk-flex-between uk-flex-middle">
                                <div>
                                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                                    <div className="uk-text-muted" style={{ fontSize: '0.8rem' }}>{r.desc}</div>
                                </div>
                                <label className="uk-flex uk-flex-middle" style={{ gap: 8 }}>
                                    <input
                                        className="uk-checkbox"
                                        type="checkbox"
                                        checked={!!settings[r.key]}
                                        onChange={() => toggle(r.key)}
                                    />
                                    <span style={{ fontSize: '0.85rem', minWidth: 70 }}>
                                        {settings[r.key] ? 'Activado' : 'Desactivado'}
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Cola de impresión: un dispositivo sin impresora manda sus
                    encargos al puesto que sí la tiene (ver sql/010). */}
                <div className="uk-card uk-card-default uk-card-body uk-margin">
                    <h4 className="uk-margin-small-top">Este dispositivo</h4>

                    <label className="uk-flex uk-flex-middle" style={{ gap: 8 }}>
                        <input
                            className="uk-checkbox"
                            type="checkbox"
                            checked={settings.tieneImpresora !== false}
                            onChange={() => toggle('tieneImpresora')}
                        />
                        <span>
                            <strong>Tiene impresora conectada</strong>
                            <div className="uk-text-muted" style={{ fontSize: '0.85rem' }}>
                                Desactívalo en la tablet del taller: en vez de imprimir, sus
                                etiquetas se envían a la cola y las imprime el ordenador
                                principal. Si lo desactivas en todos los equipos, no se
                                imprimirá nada.
                            </div>
                        </span>
                    </label>

                    <div className="uk-margin-small">
                        <label className="uk-form-label" style={{ fontWeight: 600 }}>
                            Nombre de este puesto
                        </label>
                        <input
                            className="uk-input uk-form-small"
                            style={{ maxWidth: 280 }}
                            placeholder="Ej.: Mostrador, Tablet taller"
                            value={settings.nombrePuesto || ''}
                            onChange={(e) => {
                                const next = setPrintSettings({ nombrePuesto: e.target.value });
                                setSettings(next);
                            }}
                        />
                        <div className="uk-text-muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                            Sirve para saber qué puesto imprimió cada cosa si algo falla.
                        </div>
                    </div>
                </div>

                {/* Estado de la cola: es donde se ve si un encargo se ha
                    quedado atascado o ha agotado sus reintentos. */}
                <div className="uk-card uk-card-default uk-card-body uk-margin">
                    <div className="uk-flex uk-flex-between uk-flex-middle" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <h4 className="uk-margin-small-top uk-margin-remove-bottom">Cola de impresión</h4>
                        <div className="uk-flex uk-flex-middle" style={{ gap: 8 }}>
                            <span className="uk-text-muted" style={{ fontSize: '0.8rem' }}>
                                {cola.length === 0 ? 'Vacía' : `${cola.length} encargo${cola.length > 1 ? 's' : ''}`}
                            </span>
                            <button
                                type="button"
                                className="uk-button uk-button-default uk-button-small"
                                onClick={cargarCola}
                                disabled={colaCargando}
                            >
                                {colaCargando ? '…' : 'Actualizar'}
                            </button>
                        </div>
                    </div>
                    <p className="uk-text-muted" style={{ fontSize: '0.85rem' }}>
                        Encargos pendientes de imprimir en el puesto con impresora. Se actualiza solo cada 10 segundos.
                    </p>

                    {colaError && (
                        <div className="uk-text-danger" style={{ fontSize: '0.85rem' }}>{colaError}</div>
                    )}

                    {cola.length === 0 && !colaError ? (
                        <div className="uk-text-muted" style={{ fontSize: '0.85rem' }}>
                            No hay nada pendiente.
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="uk-table uk-table-small uk-table-divider uk-table-middle" style={{ margin: 0 }}>
                                <thead>
                                    <tr style={{ fontSize: '0.75rem' }}>
                                        <th>Hora</th>
                                        <th>Tipo</th>
                                        <th>Pedido</th>
                                        <th>Estado</th>
                                        <th>Intentos</th>
                                        <th>Puesto</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody style={{ fontSize: '0.82rem' }}>
                                    {cola.map((job) => {
                                        const estado = ESTADOS_COLA[job.status] || { texto: job.status, color: '#475569', fondo: '#f1f5f9' };
                                        return (
                                            <tr key={job.id}>
                                                <td style={{ whiteSpace: 'nowrap' }}>
                                                    {job.createdAt
                                                        ? new Date(job.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                                                        : '—'}
                                                </td>
                                                <td>{TIPOS_COLA[job.type] || job.type}</td>
                                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                                                    {job.order?.orderNum || '—'}
                                                </td>
                                                <td>
                                                    <span style={{
                                                        padding: '1px 8px', borderRadius: 10, fontSize: '0.72rem',
                                                        fontWeight: 600, background: estado.fondo, color: estado.color,
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {estado.texto}
                                                    </span>
                                                    {job.error && (
                                                        <div className="uk-text-muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>
                                                            {job.error}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{job.attempts ?? 0}</td>
                                                <td className="uk-text-muted">{job.claimedBy || '—'}</td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <button
                                                        type="button"
                                                        className="uk-button uk-button-default uk-button-small"
                                                        style={{ fontSize: '0.72rem' }}
                                                        onClick={() => descartarEncargo(job.id)}
                                                        title="Saca el encargo de la cola sin imprimirlo"
                                                    >
                                                        Descartar
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="uk-card uk-card-default uk-card-body uk-margin">
                    <h4 className="uk-margin-small-top">Impresoras de este equipo</h4>
                    <p className="uk-text-muted" style={{ fontSize: '0.85rem' }}>
                        Nombres de las impresoras en QZ Tray. Déjalos vacíos para usar la detección por defecto.
                    </p>

                    <div className="uk-margin-small">
                        <button
                            type="button"
                            className="uk-button uk-button-default uk-button-small"
                            onClick={detectPrinters}
                            disabled={detecting}
                        >
                            {detecting ? 'Detectando…' : 'Detectar impresoras'}
                        </button>
                        {printers.length > 0 && (
                            <span className="uk-text-muted uk-margin-small-left" style={{ fontSize: '0.8rem' }}>
                                {printers.length} detectada{printers.length > 1 ? 's' : ''}
                            </span>
                        )}
                        {detectError && (
                            <span className="uk-text-danger uk-margin-small-left" style={{ fontSize: '0.8rem' }}>
                                {detectError}
                            </span>
                        )}
                    </div>

                    {/* Lista compartida de sugerencias con las impresoras detectadas */}
                    <datalist id="qz-printers">
                        {printers.map((p) => (
                            <option key={p} value={p} />
                        ))}
                    </datalist>

                    <div className="uk-margin">
                        <label className="uk-form-label" style={{ fontWeight: 600 }}>
                            Impresora de tickets y etiquetas de recogida (papel normal)
                        </label>
                        <input
                            className="uk-input"
                            style={{ maxWidth: 360 }}
                            placeholder="Ej.: CLIENTE"
                            list="qz-printers"
                            value={printerTicket}
                            onChange={(e) => saveKey('printerTicket', e.target.value, setPrinterTicket)}
                        />
                    </div>

                    <div className="uk-margin">
                        <label className="uk-form-label" style={{ fontWeight: 600 }}>
                            Impresora de etiquetas lavables (van con la ropa)
                        </label>
                        <input
                            className="uk-input"
                            style={{ maxWidth: 360 }}
                            placeholder="Ej.: LAVADORA"
                            list="qz-printers"
                            value={printerWasher}
                            onChange={(e) => saveKey('printerWasher', e.target.value, setPrinterWasher)}
                        />
                        <div className="uk-margin-small-top">
                            <button
                                type="button"
                                className="uk-button uk-button-primary uk-button-small"
                                onClick={testWasher}
                                disabled={testing}
                            >
                                {testing ? 'Imprimiendo…' : 'Imprimir prueba'}
                            </button>
                            {testMsg && (
                                <span className="uk-margin-small-left" style={{ fontSize: '0.8rem' }}>
                                    {testMsg}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


