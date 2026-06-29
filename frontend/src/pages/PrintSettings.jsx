import React, { useState } from 'react';
import PageToolbar from '../components/PageToolbar.jsx';
import { getPrintSettings, setPrintSettings } from '../utils/printSettings.js';

export default function PrintSettings() {
    const [settings, setSettings] = useState(getPrintSettings());
    const [printerTicket, setPrinterTicket] = useState(
        localStorage.getItem('printerTicket') || localStorage.getItem('posPrinterName') || ''
    );
    const [printerWasher, setPrinterWasher] = useState(localStorage.getItem('printerWasher') || '');
    const [saved, setSaved] = useState(false);

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

                    <div className="uk-margin">
                        <label className="uk-form-label" style={{ fontWeight: 600 }}>
                            Impresora de tickets y etiquetas de recogida (papel normal)
                        </label>
                        <input
                            className="uk-input"
                            style={{ maxWidth: 360 }}
                            placeholder="Ej.: CLIENTE"
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
                            value={printerWasher}
                            onChange={(e) => saveKey('printerWasher', e.target.value, setPrinterWasher)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}


