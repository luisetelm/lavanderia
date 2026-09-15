import React, { useEffect, useState } from 'react';
import { fetchClientSepa, createSepaMandateLink, cancelSepaMandate, chargeInvoiceSepa } from '../api.js';
import { avisar, confirmar } from '../utils/dialogo.js';
import { formatEUR } from '../utils/format.js';
import { ADEUDO_ESTADO, MANDATO_ESTADO, FACTURA_SEPA_FALLIDA } from '../utils/sepa.js';

// Pestaña "Domiciliación" de la ficha del cliente: estado de la orden SEPA,
// enlace para que la firme, cobro de sus facturas pendientes y adeudos
// anteriores. Ver docs/domiciliacion-sepa.md.

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-ES', { dateStyle: 'medium' }) : '-');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

const sectionTitle = { fontSize: '0.75rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', margin: '16px 0 6px' };

function Badge({ texto, color, fondo }) {
    return (
        <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, background: fondo, color, whiteSpace: 'nowrap' }}>
            {texto}
        </span>
    );
}

export default function ClientSepaTab({ token, client }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [link, setLink] = useState(null);
    const [busy, setBusy] = useState(null); // 'link' | 'cancel' | id de factura

    const load = () => {
        setLoading(true);
        setError('');
        fetchClientSepa(token, client.id)
            .then(setData)
            .catch(e => setError(e.error || 'No se pudo cargar la domiciliación'))
            .finally(() => setLoading(false));
    };

    useEffect(load, [token, client.id]);

    const mandate = data?.mandate;
    const isActive = mandate?.status === 'active';

    const handleLink = async () => {
        setBusy('link');
        try {
            setLink(await createSepaMandateLink(token, client.id));
        } catch (e) {
            avisar(e.error || 'No se pudo generar el enlace', 'danger');
        } finally {
            setBusy(null);
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(link.url);
            avisar('Enlace copiado', 'success');
        } catch {
            avisar('No se pudo copiar: selecciona el enlace y cópialo a mano', 'warning');
        }
    };

    // Se abre el WhatsApp del equipo con el mensaje ya escrito
    const phone = String(client.phone || '').replace(/\D/g, '').slice(-9);
    const whatsappUrl = link && phone.length === 9
        ? `https://wa.me/34${phone}?text=${encodeURIComponent(
            `Hola ${(client.firstName || '').trim()}, para domiciliar el pago de tus facturas de Tinte y Burbuja entra en este enlace, indica tu IBAN y acepta la orden: ${link.url}`
        )}`
        : null;

    const handleCancel = async () => {
        const ok = await confirmar('¿Cancelar la domiciliación? No se podrán cargar más facturas en esta cuenta hasta que el cliente firme una orden nueva. Los adeudos ya lanzados siguen su curso.');
        if (!ok) return;
        setBusy('cancel');
        try {
            await cancelSepaMandate(token, client.id);
            avisar('Domiciliación cancelada', 'success');
            load();
        } catch (e) {
            avisar(e.error || 'No se pudo cancelar la domiciliación', 'danger');
        } finally {
            setBusy(null);
        }
    };

    const handleCharge = async (inv) => {
        const ok = await confirmar(
            `Se cargarán ${formatEUR(Number(inv.totalGross))} en la cuenta ···· ${mandate.ibanLast4} por la factura ${inv.number}. ` +
            'Stripe avisa al cliente por email y el cobro tarda unos 6 días hábiles en confirmarse.'
        );
        if (!ok) return;
        setBusy(inv.id);
        try {
            await chargeInvoiceSepa(token, inv.id);
            avisar(`Adeudo de la factura ${inv.number} lanzado`, 'success');
            load();
        } catch (e) {
            avisar(e.error || 'No se pudo lanzar el adeudo', 'danger');
        } finally {
            setBusy(null);
        }
    };

    if (loading && !data) {
        return <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>Cargando domiciliación...</div>;
    }
    if (error) {
        return <div style={{ color: '#dc2626', padding: 12 }}>{error}</div>;
    }

    const pendingInvoices = data?.pendingInvoices || [];
    const debits = data?.debits || [];

    return (
        <div style={{ fontSize: '0.85rem' }}>
            {/* Estado de la orden */}
            <div style={{
                padding: '12px 14px', borderRadius: 6,
                background: isActive ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${isActive ? '#bbf7d0' : '#e2e8f0'}`,
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontWeight: 700, color: isActive ? '#16a34a' : '#475569' }}>
                            {isActive ? 'Domiciliación activa' : 'Sin domiciliación activa'}
                        </div>
                        {isActive ? (
                            <div style={{ color: '#475569', marginTop: 2 }}>
                                Cuenta ···· {mandate.ibanLast4} · firmada el {fmtDate(mandate.acceptedAt)}
                                {mandate.reference && <> · Ref. {mandate.reference}</>}
                            </div>
                        ) : mandate ? (
                            <div style={{ color: '#64748b', marginTop: 2 }}>
                                Última orden (cuenta ···· {mandate.ibanLast4}): {MANDATO_ESTADO[mandate.status] || mandate.status}
                            </div>
                        ) : (
                            <div style={{ color: '#64748b', marginTop: 2 }}>
                                El cliente todavía no ha firmado ninguna orden de domiciliación.
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="uk-button uk-button-default uk-button-small" onClick={load} disabled={loading}>
                            Actualizar
                        </button>
                        <button
                            type="button"
                            className={`uk-button uk-button-small ${isActive ? 'uk-button-default' : 'uk-button-primary'}`}
                            onClick={handleLink}
                            disabled={busy === 'link' || !data?.hasEmail}
                            title={isActive ? 'Para cambiar de cuenta: el cliente firma una orden nueva y sustituye a esta' : undefined}
                        >
                            {busy === 'link' ? 'Generando…' : isActive ? 'Cambiar de cuenta' : 'Generar enlace de firma'}
                        </button>
                        {isActive && (
                            <button type="button" className="uk-button uk-button-danger uk-button-small" onClick={handleCancel} disabled={busy === 'cancel'}>
                                {busy === 'cancel' ? 'Cancelando…' : 'Cancelar'}
                            </button>
                        )}
                    </div>
                </div>
                {!data?.hasEmail && (
                    <div style={{ color: '#b45309', marginTop: 8 }}>
                        Añade un email al cliente: Stripe le avisa por email de cada adeudo y sin él no se puede domiciliar.
                    </div>
                )}
            </div>

            {/* Enlace recién generado */}
            {link && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 6, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Enlace de firma</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input className="uk-input uk-form-small" readOnly value={link.url} style={{ flex: '1 1 240px' }} onFocus={e => e.target.select()} />
                        <button type="button" className="uk-button uk-button-default uk-button-small" onClick={handleCopy}>Copiar</button>
                        {whatsappUrl && (
                            <a className="uk-button uk-button-primary uk-button-small" href={whatsappUrl} target="_blank" rel="noreferrer">
                                Enviar por WhatsApp
                            </a>
                        )}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 6 }}>
                        Caduca el {fmtDateTime(link.expiresAt)}. Cuando el cliente la firme aparecerá aquí como activa (pulsa Actualizar).
                    </div>
                </div>
            )}

            {/* Facturas por cobrar */}
            {isActive && pendingInvoices.length > 0 && (
                <>
                    <div style={sectionTitle}>Facturas pendientes de cobro</div>
                    <div className="uk-overflow-auto">
                        <table className="uk-table uk-table-divider uk-table-small" style={{ margin: 0 }}>
                            <thead>
                                <tr>
                                    <th>Factura</th>
                                    <th>Fecha</th>
                                    <th style={{ textAlign: 'right' }}>Importe</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingInvoices.map(inv => (
                                    <tr key={inv.id}>
                                        <td style={{ fontWeight: 500 }}>
                                            {inv.number}
                                            {inv.paymentStatus === FACTURA_SEPA_FALLIDA && (
                                                <span style={{ marginLeft: 6 }}><Badge {...ADEUDO_ESTADO.failed} texto="Adeudo fallido" /></span>
                                            )}
                                        </td>
                                        <td style={{ color: '#64748b' }}>{fmtDate(inv.issuedAt)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatEUR(Number(inv.totalGross))}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button
                                                type="button"
                                                className="uk-button uk-button-primary uk-button-small"
                                                onClick={() => handleCharge(inv)}
                                                disabled={busy === inv.id}
                                            >
                                                {busy === inv.id ? 'Lanzando…' : 'Cobrar por SEPA'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* Adeudos anteriores */}
            <div style={sectionTitle}>Adeudos</div>
            {debits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 12, color: '#94a3b8' }}>Sin adeudos</div>
            ) : (
                <div className="uk-overflow-auto">
                    <table className="uk-table uk-table-divider uk-table-small" style={{ margin: 0 }}>
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Factura</th>
                                <th style={{ textAlign: 'right' }}>Importe</th>
                                <th>Estado</th>
                                <th>Detalle</th>
                            </tr>
                        </thead>
                        <tbody>
                            {debits.map(d => {
                                const estado = ADEUDO_ESTADO[d.status] || { texto: d.status, color: '#64748b', fondo: '#f1f5f9' };
                                return (
                                    <tr key={d.id}>
                                        <td style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(d.createdAt)}</td>
                                        <td>{d.invoice?.number || '-'}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatEUR(Number(d.amount))}</td>
                                        <td><Badge {...estado} /></td>
                                        <td style={{ color: '#64748b', fontSize: '0.75rem' }}>{d.note || '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
