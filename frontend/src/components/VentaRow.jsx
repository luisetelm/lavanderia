// javascript
// Archivo: `frontend/src/components/VentaRow.jsx`
import React, { useState, useEffect } from 'react';
import { avisar } from '../utils/dialogo.js';
import { createInvoice, downloadInvoicePDF, fetchOrder, collectInvoice, getPaymentLink } from '../api.js';
import { formatEUR } from '../utils/format.js';

export default function VentaRow({
                                     venta,
                                     token,
                                     isSelected,
                                     canSelect,
                                     onSelect,
                                     onRefresh,
                                     onVerPedido,
                                     globalLoading
                                 }) {
    const [rowLoading, setRowLoading] = useState(false);
    const [orderDetail, setOrderDetail] = useState(null);
    const [orderLoading, setOrderLoading] = useState(false);
    const [showCollectModal, setShowCollectModal] = useState(false);
    const [collectMethod, setCollectMethod] = useState('transfer');

    useEffect(() => {
        let mounted = true;
        const loadOrder = async () => {
            if (!token || !venta?.id) return;
            setOrderLoading(true);
            try {
                const data = await fetchOrder(token, venta.id);
                if (!mounted) return;
                setOrderDetail(data);
            } catch (err) {
                console.error('Error al obtener order individual', err);
            } finally {
                if (mounted) setOrderLoading(false);
            }
        };
        loadOrder();
        return () => { mounted = false; };
    }, [token, venta?.id]);

    const refetchOrderDetail = async () => {
        if (!token || !venta?.id) return;
        setOrderLoading(true);
        try {
            const data = await fetchOrder(token, venta.id);
            setOrderDetail(data);
        } catch (err) {
            console.error('Error al re-fetch order', err);
        } finally {
            setOrderLoading(false);
        }
    };

    const fecha = venta.createdAt
        ? new Date(venta.createdAt).toLocaleDateString('es-ES', { dateStyle: 'medium' })
        : '-';

    const cliente = venta.client?.denominacionSocial
        || (venta.client?.firstName ? `${venta.client.firstName} ${venta.client.lastName || ''}` : '')
        || venta.cliente
        || '-';

    const total = typeof venta.total === 'number'
        ? formatEUR(venta.total)
        : venta.total ? formatEUR(Number(venta.total)) : '-';

    // Nuevo: total numérico usado para validar si se puede facturar
    const numericTotal = typeof venta.total === 'number'
        ? venta.total
        : venta.total ? Number(venta.total) : (orderDetail?.total ? Number(orderDetail.total) : 0);
    const isZeroAmount = !numericTotal || numericTotal === 0;

    const rawTickets = orderDetail?.invoiceTickets ?? venta?.invoiceTickets ?? [];
    const invoiceTickets = Array.isArray(rawTickets) ? rawTickets : (rawTickets ? [rawTickets] : []);
    const yaFacturado = invoiceTickets.length > 0;

    // Extraer número de factura de forma robusta
    const _firstTicket = invoiceTickets[0];
    const _inv = _firstTicket?.invoices || _firstTicket;
    const invoiceNumber = _firstTicket?.invoiceNumber
        ?? _firstTicket?.invoiceNum
        ?? _firstTicket?.invoiceId
        ?? _inv?.number
        ?? _inv?.invoiceNumber
        ?? _inv?.invoiceId
        ?? _inv?.id
        ?? '';

    // Detectar si la factura está cobrada
    const invoiceObj = _inv;
    const isInvoicePaid = invoiceObj?.paid === true || invoiceObj?.paymentStatus === 'paid';

    const handleGetPaymentLink = async () => {
        if (!invoiceObj?.id) return;
        setRowLoading(true);
        try {
            const { url } = await getPaymentLink(token, 'invoice', invoiceObj.id);
            await navigator.clipboard.writeText(url);
            avisar('Enlace de pago copiado al portapapeles:\n' + url, 'success');
        } catch (err) {
            console.error('Error generando enlace de pago:', err);
            avisar('Error al generar enlace: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    const handleCollectInvoice = async () => {
        if (!invoiceObj?.id) return;
        setRowLoading(true);
        try {
            await collectInvoice(token, invoiceObj.id, { method: collectMethod });
            setShowCollectModal(false);
            await onRefresh(venta.id);
            await refetchOrderDetail();
        } catch (err) {
            console.error('Error cobrando factura:', err);
            avisar('Error al cobrar la factura: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    const paymentMethodLabel = venta?.paymentMethod
        ? (venta.paymentMethod === 'card' ? 'Tarjeta'
            : venta.paymentMethod === 'cash' ? 'Efectivo'
            : venta.paymentMethod === 'transfer' ? 'Transferencia'
            : venta.paymentMethod)
        : '-';

    const handleCreateSimplifiedInvoice = async (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (rowLoading || isZeroAmount) {
            if (isZeroAmount) {
                avisar('No se puede facturar: importe 0 €', 'danger');
            }
            return;
        }

        setRowLoading(true);

        try {
            const invoiceData = venta.paymentMethod === 'card' ? {
                operationDate: venta.createdAt,
                issuedAt: venta.createdAt
            } : undefined;

            const resp = await createInvoice(token, {
                orderIds: [venta.id],
                type: 's',
                invoiceData
            });

            if (resp?.emailError) {
                console.warn('Factura creada pero fallo envío de email:', resp.emailError);
                avisar('Factura creada, pero no se pudo enviar el email: ' + resp.emailError, 'warning');
            } else {
                avisar('Factura simplificada creada exitosamente', 'success');
            }

            // Actualizar solo esta fila sin recargar toda la página
            await onRefresh(venta.id);
            await refetchOrderDetail();
        } catch (err) {
            console.error('Error al generar factura simplificada', err);
            avisar('No se pudo generar la factura simplificada: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    const handleCreateNormalInvoice = async (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (rowLoading || isZeroAmount) {
            if (isZeroAmount) {
                avisar('No se puede facturar: importe 0 €', 'danger');
            }
            return;
        }

        setRowLoading(true);

        try {
            const resp = await createInvoice(token, {
                orderIds: [venta.id],
                type: 'n'
            });

            if (resp?.emailError) {
                console.warn('Factura creada pero fallo envío de email:', resp.emailError);
                avisar('Factura creada, pero no se pudo enviar el email: ' + resp.emailError, 'warning');
            } else {
                avisar('Factura normal creada exitosamente', 'success');
            }

            await onRefresh(venta.id);
            await refetchOrderDetail();
        } catch (err) {
            console.error('Error al generar factura normal', err);
            avisar('No se pudo generar la factura normal: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    const handleConvertToNormal = async (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (rowLoading) return;

        setRowLoading(true);

        try {
            const resp = await createInvoice(token, {
                orderIds: [venta.id],
                type: 'n'
            });

            if (resp?.emailError) {
                console.warn('Factura convertida pero fallo envío de email:', resp.emailError);
                avisar('Factura convertida, pero no se pudo enviar el email: ' + resp.emailError, 'warning');
            } else {
                avisar('Factura convertida a normal exitosamente', 'success');
            }

            await onRefresh(venta.id);
            await refetchOrderDetail();
        } catch (err) {
            console.error('Error al convertir a factura normal', err);
            avisar('No se pudo convertir la factura a normal: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    const renderInvoiceButtons = () => {
        if (invoiceTickets.length === 0) {
            return (
                <div className="uk-button-group">
                    <button
                        className="uk-button uk-button-default uk-button-small"
                        onClick={handleCreateSimplifiedInvoice}
                        disabled={rowLoading || globalLoading || isZeroAmount}
                        title="Emitir factura simplificada"
                        type="button"
                    >
                        {rowLoading ? 'Procesando...' : 'Simplificada'}
                    </button>
                    <button
                        className="uk-button uk-button-primary uk-button-small"
                        onClick={handleCreateNormalInvoice}
                        disabled={rowLoading || globalLoading || isZeroAmount}
                        title="Emitir factura normal"
                        type="button"
                    >
                        {rowLoading ? 'Procesando...' : 'Normal'}
                    </button>
                </div>
            );
        }

        const firstTicket = invoiceTickets[0];
        const inv = firstTicket?.invoices || firstTicket;
        const type = inv?.type || inv?.invoices?.type || null;

        if (type === 's') {
            return (
                <div className="uk-button-group">
                    <button
                        className="uk-button uk-button-warning uk-button-small"
                        onClick={handleConvertToNormal}
                        disabled={rowLoading || globalLoading}
                        title="Convertir a factura normal"
                        type="button"
                    >
                        {rowLoading ? 'Procesando...' : 'Convertir a normal'}
                    </button>
                </div>
            );
        }

        const invoiceIdToDownload = firstTicket?.invoiceId || inv?.id || inv?.invoiceId;

        return (
            <div className="uk-button-group">
                <button
                    className="uk-button uk-button-default uk-button-small"
                    onClick={(e) => {
                        e?.preventDefault();
                        if (invoiceIdToDownload) downloadInvoicePDF(token, invoiceIdToDownload);
                    }}
                    title="Ver factura"
                    type="button"
                >
                    Descargar
                </button>
                {!isInvoicePaid && (
                    <>
                        <button
                            className="uk-button uk-button-primary uk-button-small"
                            onClick={(e) => {
                                e?.preventDefault();
                                setShowCollectModal(true);
                            }}
                            disabled={rowLoading || globalLoading}
                            title="Cobrar factura"
                            type="button"
                        >
                            {rowLoading ? 'Procesando...' : 'Cobrar'}
                        </button>
                        <button
                            className="uk-button uk-button-default uk-button-small"
                            onClick={(e) => {
                                e?.preventDefault();
                                handleGetPaymentLink();
                            }}
                            disabled={rowLoading || globalLoading}
                            title="Generar enlace de pago Stripe"
                            type="button"
                        >
                            Enlace pago
                        </button>
                    </>
                )}
            </div>
        );
    };

    return (
        <>
            <tr className={yaFacturado ? 'estado-facturado' : 'estado-pendiente'}>
                <td>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!canSelect}
                        onChange={() => onSelect(venta)}
                    />
                </td>
                <td>{venta.orderNum}</td>
                <td>{fecha}</td>
                <td>{cliente}</td>
                <td>{total}</td>
                <td>
                    <div>
                        <span className={`uk-badge ${yaFacturado ? 'uk-badge-success' : 'uk-badge-warning'}`}>
                            {yaFacturado ? 'Facturado' : 'Pendiente'}
                        </span>
                        {yaFacturado && (
                            <div style={{ marginTop: 4 }}>
                                <span
                                    className={`uk-badge ${isInvoicePaid ? 'uk-badge-success' : 'uk-badge-warning'}`}
                                    style={{ fontSize: '0.7em' }}
                                >
                                    {isInvoicePaid ? 'Cobrada' : 'Pendiente cobro'}
                                </span>
                            </div>
                        )}
                        <div style={{ fontSize: '0.8em', marginTop: 4 }}>
                            {yaFacturado && invoiceNumber ? (
                                <div>Factura: <strong>{invoiceNumber}</strong></div>
                            ) : (
                                <div>&nbsp;</div>
                            )}
                            <div>Método: <strong>{paymentMethodLabel}</strong></div>
                        </div>
                    </div>
                </td>
                <td>
                    {orderLoading ? 'Cargando...' : renderInvoiceButtons()}
                </td>
                <td>
                    <button
                        className="uk-button uk-button-primary uk-button-small"
                        onClick={() => onVerPedido(orderDetail || venta)}
                        title="Ver tareas de este pedido"
                        type="button"
                    >
                        Ver pedido
                    </button>
                </td>
            </tr>

            {/* Modal de cobro de factura */}
            {showCollectModal && (
                <tr>
                    <td colSpan="8" style={{ padding: 0 }}>
                        <div style={{
                            background: '#f8f8f8',
                            border: '1px solid #e5e5e5',
                            borderRadius: 4,
                            padding: '12px 16px',
                            margin: '0 8px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12
                        }}>
                            <strong style={{ whiteSpace: 'nowrap' }}>Cobrar factura {invoiceNumber}:</strong>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="radio" name={`collect-${venta.id}`} value="transfer"
                                    checked={collectMethod === 'transfer'}
                                    onChange={() => setCollectMethod('transfer')} />
                                Transferencia
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="radio" name={`collect-${venta.id}`} value="cash"
                                    checked={collectMethod === 'cash'}
                                    onChange={() => setCollectMethod('cash')} />
                                Efectivo
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="radio" name={`collect-${venta.id}`} value="card_pos"
                                    checked={collectMethod === 'card_pos'}
                                    onChange={() => setCollectMethod('card_pos')} />
                                Tarjeta
                            </label>
                            <button
                                className="uk-button uk-button-primary uk-button-small"
                                onClick={handleCollectInvoice}
                                disabled={rowLoading}
                                type="button"
                            >
                                {rowLoading ? 'Procesando...' : 'Confirmar cobro'}
                            </button>
                            <button
                                className="uk-button uk-button-default uk-button-small"
                                onClick={() => setShowCollectModal(false)}
                                type="button"
                            >
                                Cancelar
                            </button>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
