import React, {useEffect, useState} from 'react';
import {bulkProductPrices} from '../api.js';
import {formatEUR} from '../utils/format.js';

// Cambio de precios en bloque de los productos seleccionados en el catálogo.
// La vista previa la calcula el backend (POST /api/products/bulk-prices sin
// aplicar), así que lo que se ve es exactamente lo que se guarda. Los precios
// pactados con clientes no cambian.

const IVA = 21;
const REDONDEOS = [
    {valor: 0.001, texto: 'Sin redondear'},
    {valor: 0.01, texto: 'Al céntimo'},
    {valor: 0.05, texto: 'A 5 céntimos'},
    {valor: 0.1, texto: 'A 10 céntimos'},
    {valor: 0.5, texto: 'A 50 céntimos'},
    {valor: 1, texto: 'Al euro'},
];
const CAMPOS = {basePrice: 'Precio', bigClientPrice: 'Tarifa gran cliente'};

// Hasta 3 decimales: hay precios como 1,573 € que no deben verse redondeados.
const eur = new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 3});
const lbl = {fontSize: '0.72rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: 2};
const nota = {fontSize: '0.78rem', color: '#64748b', margin: 0};
const derecha = {textAlign: 'right', whiteSpace: 'nowrap'};

export default function BulkPriceModal({token, ids, onClose, onDone}) {
    const [campo, setCampo] = useState('basePrice');
    const [modo, setModo] = useState('pct');
    const [valor, setValor] = useState('');
    const [redondeo, setRedondeo] = useState(0.01);
    const [vista, setVista] = useState(null);       // {clave, cambios, productos}
    const [error, setError] = useState('');
    const [calculando, setCalculando] = useState(false);
    const [aplicando, setAplicando] = useState(false);

    const numero = Number(String(valor).replace(',', '.'));
    const valido = valor.trim() !== '' && Number.isFinite(numero) && numero !== 0;
    const clave = JSON.stringify([campo, modo, numero, redondeo]);

    useEffect(() => {
        if (!valido) {
            setVista(null);
            return undefined;
        }
        let vigente = true;
        const espera = setTimeout(() => {
            setCalculando(true);
            bulkProductPrices(token, {ids, campo, modo, valor: numero, redondeo, aplicar: false})
                .then((r) => { if (vigente) { setVista({...r, clave}); setError(''); } })
                .catch((e) => { if (vigente) { setVista(null); setError(e.error || 'No se pudo calcular el cambio'); } })
                .finally(() => { if (vigente) setCalculando(false); });
        }, 300);
        return () => { vigente = false; clearTimeout(espera); };
    }, [token, ids, campo, modo, numero, redondeo, valido, clave]);

    // Sólo se aplica si la vista previa corresponde a los datos que hay en pantalla.
    const alDia = vista?.clave === clave && !calculando;

    const aplicar = async () => {
        setAplicando(true);
        try {
            const r = await bulkProductPrices(token, {ids, campo, modo, valor: numero, redondeo, aplicar: true});
            onDone(r);
        } catch (e) {
            setError(e.error || 'No se pudieron cambiar los precios');
            setAplicando(false);
        }
    };

    return (
        <div className="uk-modal uk-open" style={{display: 'block', background: 'rgba(0,0,0,0.6)'}}>
            <div className="uk-modal-dialog uk-modal-body uk-margin-auto-vertical" style={{width: 'min(760px, calc(100% - 24px))'}}>
                <button className="uk-modal-close-default" type="button" uk-close="true" onClick={onClose}></button>
                <h4 className="uk-modal-title">Cambiar precios</h4>
                <p style={{...nota, marginBottom: 12}}>
                    {ids.length} {ids.length === 1 ? 'producto seleccionado' : 'productos seleccionados'}. Los precios llevan el IVA incluido.
                    No cambian los precios pactados con clientes, y los productos sin tarifa de gran cliente siguen sin ella.
                </p>

                {error && <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>}

                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10}}>
                    <div>
                        <label style={lbl} htmlFor="bp-campo">Qué precio</label>
                        <select id="bp-campo" className="uk-select" value={campo} onChange={(e) => setCampo(e.target.value)}>
                            <option value="basePrice">Precio</option>
                            <option value="bigClientPrice">Tarifa gran cliente</option>
                            <option value="ambos">Los dos</option>
                        </select>
                    </div>
                    <div>
                        <label style={lbl} htmlFor="bp-modo">Cómo</label>
                        <select id="bp-modo" className="uk-select" value={modo} onChange={(e) => setModo(e.target.value)}>
                            <option value="pct">Porcentaje</option>
                            <option value="importe">Importe fijo</option>
                        </select>
                    </div>
                    <div>
                        <label style={lbl} htmlFor="bp-valor">{modo === 'pct' ? 'Cambio en %' : 'Cambio en €'}</label>
                        <input id="bp-valor" className="uk-input" inputMode="decimal" autoFocus
                               placeholder={modo === 'pct' ? 'Ej.: 5 o -3' : 'Ej.: 0,50 o -0,20'}
                               value={valor} onChange={(e) => setValor(e.target.value)}/>
                    </div>
                    <div>
                        <label style={lbl} htmlFor="bp-redondeo">Redondeo</label>
                        <select id="bp-redondeo" className="uk-select" value={redondeo} onChange={(e) => setRedondeo(Number(e.target.value))}>
                            {REDONDEOS.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
                        </select>
                    </div>
                </div>

                <div style={{marginTop: 14, minHeight: 90, opacity: calculando ? 0.5 : 1, transition: 'opacity 0.15s'}}>
                    {!valido ? (
                        <p style={{...nota, textAlign: 'center', padding: 24}}>Indica el cambio para ver cómo quedan los precios.</p>
                    ) : !vista ? null : vista.cambios.length === 0 ? (
                        <p style={{...nota, textAlign: 'center', padding: 24}}>Con estos datos no cambia ningún precio.</p>
                    ) : (
                        <div className="uk-overflow-auto" style={{maxHeight: 320}}>
                            <table className="uk-table uk-table-divider uk-table-small" style={{margin: 0, fontVariantNumeric: 'tabular-nums'}}>
                                <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th>Precio</th>
                                    <th style={derecha}>Ahora</th>
                                    <th style={derecha}>Nuevo</th>
                                    <th style={derecha}>Nuevo sin IVA</th>
                                </tr>
                                </thead>
                                <tbody>
                                {vista.cambios.map((c) => (
                                    <tr key={`${c.id}-${c.campo}`}>
                                        <td>{c.name}</td>
                                        <td style={{fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap'}}>{CAMPOS[c.campo]}</td>
                                        <td style={{...derecha, color: '#64748b'}}>{eur.format(c.antes)}</td>
                                        <td style={{...derecha, fontWeight: 700}}>{eur.format(c.despues)}</td>
                                        <td style={{...derecha, color: '#64748b'}}>{formatEUR(c.despues / (1 + IVA / 100))}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap'}}>
                    <p style={nota}>{vista?.cambios.length ? `Cambian ${vista.cambios.length} precios` : ''}</p>
                    <div style={{display: 'flex', gap: 8}}>
                        <button type="button" className="uk-button uk-button-default" onClick={onClose}>Cancelar</button>
                        <button type="button" className="uk-button uk-button-primary" onClick={aplicar}
                                disabled={!alDia || !vista?.cambios.length || aplicando}>
                            {aplicando ? 'Aplicando…' : 'Aplicar cambios'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
