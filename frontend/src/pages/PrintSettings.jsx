import React, { useState } from 'react';
import PageToolbar from '../components/PageToolbar.jsx';
import { getPrintSettings, setPrintSettings } from '../utils/printSettings.js';
import { connectQZ } from '../qzInit.js';
import { listPrinters } from '../qzHelper.js';
import { printWasherTest } from '../utils/printUtils.js';

export default function PrintSettings() {
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
        { key: 'onReady', title: 'Al marcar como listo', desc: 'Imprime la etiqueta de recogida (papel normal).' },
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


