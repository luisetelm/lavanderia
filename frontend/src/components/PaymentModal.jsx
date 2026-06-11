import React, { useState } from 'react';
import { formatEUR } from '../utils/format.js';

/**
 * Modal de cobro en pasos: elegir método → confirmar.
 *
 * Props:
 *  - total: number                       importe a cobrar
 *  - onClose()                           cierra el modal
 *  - onPayCard(): Promise                ejecuta el pago con tarjeta (lanza en error)
 *  - onPayCash(received): Promise<number> ejecuta el pago en efectivo, devuelve la vuelta
 *  - onStripeLink(): Promise<string>     genera/copia el enlace Stripe, devuelve la url
 */
export default function PaymentModal({ total, onClose, onPayCard, onPayCash, onStripeLink }) {
    const totalNum = Number(total || 0);

    const [method, setMethod] = useState(null);   // null | 'card' | 'cash' | 'stripe'
    const [received, setReceived] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);        // { type, change?, url? }

    const receivedNum = parseFloat(received);
    const insufficient = received !== '' && (isNaN(receivedNum) || receivedNum < totalNum);
    const change = !isNaN(receivedNum) ? Math.max(0, receivedNum - totalNum) : 0;

    const run = async (fn) => {
        setBusy(true); setError('');
        try {
            return await fn();
        } catch (e) {
            setError(e?.error || 'Se produjo un error en la operación');
            throw e;
        } finally {
            setBusy(false);
        }
    };

    const confirmCard = async () => {
        try { await run(onPayCard); setDone({ type: 'card' }); } catch { /* error mostrado */ }
    };

    const confirmCash = async () => {
        if (insufficient || received === '') return;
        try { const ch = await run(() => onPayCash(receivedNum)); setDone({ type: 'cash', change: ch }); } catch { /* */ }
    };

    const confirmStripe = async () => {
        try { const url = await run(onStripeLink); setDone({ type: 'stripe', url }); } catch { /* */ }
    };

    const QUICK = [5, 10, 20, 50].filter(b => b >= totalNum).slice(0, 3);

    return (
        <div className="uk-modal uk-open" style={{ display: 'block' }}>
            <div className="uk-modal-dialog uk-modal-body" style={{ maxWidth: 440 }}>
                <button type="button" className="uk-modal-close-default" uk-icon="close" onClick={onClose} aria-label="Cerrar"></button>

                {/* Cabecera con importe */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
                    <h2 className="uk-modal-title" style={{ fontSize: '1.05rem', margin: 0 }}>Cobrar pedido</h2>
                    <span style={{ fontSize: '1.4rem', fontWeight: 700 }}>{formatEUR(totalNum)}</span>
                </div>

                {/* ── Resultado final ── */}
                {done ? (
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                        <div style={{ fontSize: '2.2rem', lineHeight: 1 }}>✓</div>
                        {done.type === 'cash' && (
                            <>
                                <p style={{ margin: '10px 0 4px', fontWeight: 600 }}>Pago en efectivo registrado</p>
                                <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#166534', margin: 0 }}>
                                    Vuelta: {formatEUR(done.change)}
                                </p>
                            </>
                        )}
                        {done.type === 'card' && (
                            <p style={{ margin: '10px 0 0', fontWeight: 600 }}>Pago con tarjeta registrado</p>
                        )}
                        {done.type === 'stripe' && (
                            <>
                                <p style={{ margin: '10px 0 6px', fontWeight: 600 }}>Enlace de pago generado</p>
                                <input className="uk-input uk-form-small" readOnly value={done.url}
                                       onFocus={(e) => e.target.select()} style={{ fontSize: 12 }} />
                                <p style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>Copiado al portapapeles.</p>
                            </>
                        )}
                        <button className="uk-button uk-button-primary uk-width-1-1" style={{ marginTop: 16 }} onClick={onClose}>
                            Cerrar
                        </button>
                    </div>
                ) : !method ? (
                    /* ── Paso 1: elegir método ── */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 4px' }}>Selecciona el método de pago:</p>
                        <button className="uk-button uk-button-default uk-width-1-1" style={{ textAlign: 'left', minHeight: 48 }}
                                onClick={() => setMethod('card')}>
                            💳 Tarjeta (TPV)
                        </button>
                        <button className="uk-button uk-button-default uk-width-1-1" style={{ textAlign: 'left', minHeight: 48 }}
                                onClick={() => setMethod('cash')}>
                            💵 Efectivo
                        </button>
                        <button className="uk-button uk-button-default uk-width-1-1" style={{ textAlign: 'left', minHeight: 48 }}
                                onClick={() => setMethod('stripe')}>
                            🔗 Enlace de pago (Stripe)
                        </button>
                    </div>
                ) : (
                    /* ── Paso 2: confirmar según método ── */
                    <div>
                        <button type="button" className="uk-button uk-button-link" onClick={() => { setMethod(null); setError(''); }}
                                style={{ fontSize: '0.8rem', color: '#64748b', padding: 0, marginBottom: 12 }}>
                            ← Cambiar método
                        </button>

                        {method === 'card' && (
                            <div>
                                <p style={{ fontSize: '0.9rem', margin: '0 0 16px' }}>
                                    Vas a cobrar <b>{formatEUR(totalNum)}</b> con tarjeta. Realiza la operación en el TPV y confirma.
                                </p>
                                <button className="uk-button uk-button-primary uk-width-1-1" disabled={busy} onClick={confirmCard}>
                                    {busy ? 'Procesando…' : 'Confirmar pago con tarjeta'}
                                </button>
                            </div>
                        )}

                        {method === 'cash' && (
                            <div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                    <button type="button" className="uk-button uk-button-default uk-button-small"
                                            disabled={busy} onClick={() => setReceived(String(totalNum))}>
                                        Exacto
                                    </button>
                                    {QUICK.map(b => (
                                        <button key={b} type="button" className="uk-button uk-button-default uk-button-small"
                                                disabled={busy} onClick={() => setReceived(String(b))}>
                                            {b} €
                                        </button>
                                    ))}
                                </div>
                                <label style={{ fontSize: 12, color: '#64748b' }}>Cantidad recibida</label>
                                <input
                                    type="number" autoFocus inputMode="decimal" min="0" step="0.01"
                                    className="uk-input" value={received}
                                    onChange={(e) => { setReceived(e.target.value); setError(''); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') confirmCash(); }}
                                    placeholder="€"
                                    disabled={busy}
                                    style={insufficient ? { borderColor: '#f0506e' } : undefined}
                                />
                                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0 16px', fontSize: 13 }}>
                                    {insufficient
                                        ? <span style={{ color: '#f0506e', fontWeight: 600 }}>Importe insuficiente</span>
                                        : <span style={{ color: '#64748b' }}>Vuelta</span>}
                                    {!insufficient && <span style={{ fontWeight: 700, color: '#166534' }}>{formatEUR(change)}</span>}
                                </div>
                                <button className="uk-button uk-button-primary uk-width-1-1"
                                        disabled={busy || received === '' || insufficient} onClick={confirmCash}>
                                    {busy ? 'Procesando…' : 'Confirmar cobro en efectivo'}
                                </button>
                            </div>
                        )}

                        {method === 'stripe' && (
                            <div>
                                <p style={{ fontSize: '0.9rem', margin: '0 0 16px' }}>
                                    Se generará un enlace de pago seguro por <b>{formatEUR(totalNum)}</b> y se copiará al portapapeles para enviarlo al cliente.
                                </p>
                                <button className="uk-button uk-button-primary uk-width-1-1" disabled={busy} onClick={confirmStripe}>
                                    {busy ? 'Generando…' : 'Generar y copiar enlace'}
                                </button>
                            </div>
                        )}

                        {error && <div style={{ color: '#f0506e', marginTop: 12, fontSize: 13, fontWeight: 600 }}>{error}</div>}
                    </div>
                )}
            </div>
        </div>
    );
}

