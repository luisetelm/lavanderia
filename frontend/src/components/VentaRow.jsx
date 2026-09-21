// javascript
// Archivo: `frontend/src/components/VentaRow.jsx`
import React, { useState, useEffect } from 'react';
import { avisar, confirmar } from '../utils/dialogo.js';
import {
    createInvoice, downloadInvoicePDF, fetchOrder, collectInvoice, getPaymentLink, chargeInvoiceSepa,
    downloadProformaPDF, deleteProforma, updateProforma, invoiceProforma, reviseProforma,
} from '../api.js';
import ProformaModal from './ProformaModal.jsx';
import { formatEUR } from '../utils/format.js';
import { FACTURA_SEPA_EN_CURSO, FACTURA_SEPA_FALLIDA } from '../utils/sepa.js';

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
    const [showProformaModal, setShowProformaModal] = useState(false);

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

    // Proformas del pedido (sql/030). Una proforma no es una factura: mientras esté
    // en vigor el pedido sigue pendiente de facturar, y si no la aceptan se borra y
    // no queda rastro. Ver docs/factura-proforma.md.
    const proformas = (orderDetail?.proformaOrders ?? [])
        .map((po) => po.proforma)
        .filter(Boolean);
    const proformaVigente = proformas.find((p) => p.status === 'issued' || p.status === 'accepted') || null;

    // Detectar si la factura está cobrada
    const invoiceObj = _inv;
    const isInvoicePaid = invoiceObj?.paid === true || invoiceObj?.paymentStatus === 'paid';
    // Adeudo SEPA lanzado esperando a Stripe: no se puede cobrar por otra vía
    const sepaEnCurso = !isInvoicePaid && invoiceObj?.paymentStatus === FACTURA_SEPA_EN_CURSO;
    const sepaFallido = !isInvoicePaid && invoiceObj?.paymentStatus === FACTURA_SEPA_FALLIDA;

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
            if (collectMethod === 'sepa') {
                await chargeInvoiceSepa(token, invoiceObj.id);
                avisar('Adeudo SEPA lanzado: Stripe lo confirmará en unos 6 días hábiles', 'success');
            } else {
                await collectInvoice(token, invoiceObj.id, { method: collectMethod });
            }
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
            : venta.paymentMethod === 'sepa' ? 'Adeudo SEPA'
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

    // ─── Proforma ────────────────────────────────────────────────────────────
    // El presupuesto que el cliente presenta ante un tercero. No mueve dinero ni
    // marca el pedido como facturado: si lo aceptan se factura con "Facturar", y si
    // no, se borra y no queda rastro.
    const handleProformaCreada = async (p) => {
        setShowProformaModal(false);
        avisar(`Proforma ${p.number} emitida`, 'success');
        try {
            await downloadProformaPDF(token, p.id, p.number);
        } catch { /* el aviso lo da downloadProformaPDF */ }
        await refetchOrderDetail();
    };

    const handleDescargarProforma = async () => {
        if (!proformaVigente) return;
        await downloadProformaPDF(token, proformaVigente.id, proformaVigente.number);
    };

    const handleAceptarProforma = async () => {
        if (!proformaVigente) return;
        setRowLoading(true);
        try {
            await updateProforma(token, proformaVigente.id, { status: 'accepted' });
            avisar('Proforma aceptada: ya se puede trabajar el pedido', 'success');
            await refetchOrderDetail();
        } catch (err) {
            avisar('No se pudo marcar como aceptada: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    // Rechazada = se borra. Es el camino de "no queda rastro de facturas". El pedido
    // hay que cancelarlo aparte, y en este orden: cancelarlo primero pondría su
    // total a 0.
    const handleRechazarProforma = async () => {
        if (!proformaVigente) return;
        const ok = await confirmar(
            `Se borrará la proforma ${proformaVigente.number} y no quedará rastro de ella. ` +
            'Después tendrás que cancelar el pedido si ya no se va a hacer. ¿Continuar?',
            { titulo: 'Rechazada por el destinatario', textoConfirmar: 'Borrar proforma', peligroso: true },
        );
        if (!ok) return;

        setRowLoading(true);
        try {
            await deleteProforma(token, proformaVigente.id);
            avisar('Proforma borrada. El pedido no tiene ninguna factura: cancélalo si no se va a hacer.', 'warning', 6000);
            await onRefresh(venta.id);
            await refetchOrderDetail();
        } catch (err) {
            avisar('No se pudo borrar la proforma: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    // Revisión: apareció un vicio oculto o cambió la previsión de trabajo. Se
    // vuelve a presupuestar el pedido tal como está ahora (añade primero lo que
    // falte con "Ajustar pedido") y la anterior queda sustituida.
    const handleRevisarProforma = async () => {
        if (!proformaVigente) return;
        const ok = await confirmar(
            `Se emitirá una revisión de ${proformaVigente.number} con el contenido actual del pedido. ` +
            'La anterior queda sustituida, pero se conserva: es la que el cliente tiene en la mano. ' +
            '¿Has añadido ya el trabajo extra al pedido?',
            { titulo: 'Revisar la proforma', textoConfirmar: 'Emitir revisión' },
        );
        if (!ok) return;

        setRowLoading(true);
        try {
            const p = await reviseProforma(token, proformaVigente.id);
            avisar(`Revisión ${p.number} emitida`, 'success');
            try {
                await downloadProformaPDF(token, p.id, p.number);
            } catch { /* el aviso lo da downloadProformaPDF */ }
            await refetchOrderDetail();
        } catch (err) {
            avisar('No se pudo revisar la proforma: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    // Aceptada y trabajo hecho: la factura de verdad, ligada a la proforma.
    const handleFacturarProforma = async () => {
        if (!proformaVigente) return;
        setRowLoading(true);
        try {
            const resp = await invoiceProforma(token, proformaVigente.id);
            const factura = resp?.invoice;
            if (factura?.emailError) {
                avisar('Factura creada, pero no se pudo enviar el email: ' + factura.emailError, 'warning');
            } else {
                avisar(`Factura ${factura?.number || ''} emitida desde la proforma`, 'success');
            }
            await onRefresh(venta.id);
            await refetchOrderDetail();
        } catch (err) {
            avisar('No se pudo facturar la proforma: ' + (err.error || err.message || err), 'danger');
        } finally {
            setRowLoading(false);
        }
    };

    const renderInvoiceButtons = () => {
        // Con una proforma en vigor no se ofrece facturar por la vía normal: la
        // factura se emite desde la proforma, para que quede ligada a ella.
        if (invoiceTickets.length === 0 && proformaVigente) {
            const aceptada = proformaVigente.status === 'accepted';
            return (
                <div>
                    <div style={{fontSize: '0.75rem', marginBottom: 4}}>
                        <span className="uk-badge" style={{background: aceptada ? '#16a34a' : '#f59e0b'}}>
                            {aceptada ? 'Proforma aceptada' : 'Proforma emitida'}
                        </span>
                        <div style={{marginTop: 2}}>
                            <strong>{proformaVigente.number}</strong>
                            {proformaVigente.validUntil && !aceptada && (
                                <> · vale hasta {new Date(proformaVigente.validUntil).toLocaleDateString('es-ES')}</>
                            )}
                        </div>
                    </div>
                    <div className="uk-button-group" style={{flexWrap: 'wrap'}}>
                        <button
                            className="uk-button uk-button-default uk-button-small"
                            onClick={handleDescargarProforma}
                            disabled={rowLoading || globalLoading}
                            title="Descargar el PDF de la proforma"
                            type="button"
                        >
                            Descargar
                        </button>
                        {!aceptada && (
                            <button
                                className="uk-button uk-button-primary uk-button-small"
                                onClick={handleAceptarProforma}
                                disabled={rowLoading || globalLoading}
                                title="El destinatario la ha aceptado: ya se puede trabajar"
                                type="button"
                            >
                                Aceptada
                            </button>
                        )}
                        {aceptada && (
                            <button
                                className="uk-button uk-button-primary uk-button-small"
                                onClick={handleFacturarProforma}
                                disabled={rowLoading || globalLoading || isZeroAmount}
                                title="Trabajo hecho: emitir la factura normal"
                                type="button"
                            >
                                {rowLoading ? 'Procesando...' : 'Facturar'}
                            </button>
                        )}
                        <button
                            className="uk-button uk-button-default uk-button-small"
                            onClick={handleRevisarProforma}
                            disabled={rowLoading || globalLoading}
                            title="Vicio oculto o más trabajo del previsto: emitir una revisión"
                            type="button"
                        >
                            Revisar
                        </button>
                        <button
                            className="uk-button uk-button-danger uk-button-small"
                            onClick={handleRechazarProforma}
                            disabled={rowLoading || globalLoading}
                            title="No la aceptan: borrar la proforma sin dejar rastro"
                            type="button"
                        >
                            Rechazada
                        </button>
                    </div>
                </div>
            );
        }

        if (invoiceTickets.length === 0) {
            return (
                <div className="uk-button-group" style={{flexWrap: 'wrap'}}>
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
                    <button
                        className="uk-button uk-button-default uk-button-small"
                        onClick={() => setShowProformaModal(true)}
                        disabled={rowLoading || globalLoading || isZeroAmount || !orderDetail}
                        title="Presupuesto para presentar ante un tercero (una aseguradora). No es una factura."
                        type="button"
                    >
                        Proforma
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
                {!isInvoicePaid && !sepaEnCurso && (
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
                        {!yaFacturado && proformaVigente && (
                            <div style={{marginTop: 4}}>
                                <span className="uk-badge" style={{fontSize: '0.7em', background: '#6366f1'}}
                                      title="Tiene un presupuesto emitido. No es una factura.">
                                    Presupuestado
                                </span>
                            </div>
                        )}
                        {yaFacturado && (
                            <div style={{ marginTop: 4 }}>
                                <span
                                    className={`uk-badge ${isInvoicePaid ? 'uk-badge-success' : 'uk-badge-warning'}`}
                                    style={{ fontSize: '0.7em', ...(sepaFallido ? { background: '#ef4444' } : {}) }}
                                >
                                    {isInvoicePaid ? 'Cobrada'
                                        : sepaEnCurso ? 'Adeudo SEPA en curso'
                                        : sepaFallido ? 'Adeudo SEPA devuelto'
                                        : 'Pendiente cobro'}
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

            {/* Dentro de <tr>/<td> como el modal de cobro: la fila vive en un <tbody>
                y un <div> suelto ahi seria marcado invalido. El modal se posiciona
                fijo, asi que la celda no afecta a como se ve. */}
            {showProformaModal && orderDetail && (
                <tr>
                    <td colSpan="8" style={{padding: 0, border: 0}}>
                        <ProformaModal
                            token={token}
                            order={orderDetail}
                            onDone={handleProformaCreada}
                            onClose={() => setShowProformaModal(false)}
                        />
                    </td>
                </tr>
            )}

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
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                   title="Carga la factura en la cuenta domiciliada del cliente (necesita la orden SEPA firmada)">
                                <input type="radio" name={`collect-${venta.id}`} value="sepa"
                                    checked={collectMethod === 'sepa'}
                                    onChange={() => setCollectMethod('sepa')} />
                                Adeudo SEPA
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
