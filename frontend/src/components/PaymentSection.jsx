import React, {useState, useEffect, useCallback} from 'react';
import {
    createCashMovement,
    createInvoice,
    fetchOrder,
    fetchUsers,
    payWithCard,
    payWithCash,
    updateOrder,
    updateOrder as apiUpdateOrder,
    retryNotification, downloadInvoicePDF
} from '../api.js';
import UIkit from 'uikit'; // añadir al inicio del fichero si no existe
import {printSaleTicket, printWashLabels} from '../utils/printUtils.js';

// En tu componente, donde tengas el token y el ID de la factura


export default function PaymentSection({token, orderId, onPaid, user}) {
    const [order, setOrder] = useState(null);
    const [workers, setWorkers] = useState([]);
    const [loading, setLoading] = useState(!!orderId);
    const [error, setError] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [receivedAmount, setReceivedAmount] = useState('');
    const [localError, setLocalError] = useState('');
    const [isPrinting, setIsPrinting] = useState(false);
    const [invoiceLoading, setInvoiceLoading] = useState(false);

    // Modal de confirmación (listo/recogido)
    const [showModal, setShowModal] = useState(false);
    const [modalAction, setModalAction] = useState(null);

    // Notas internas controladas
    const [internalNotes, setInternalNotes] = useState('');

    const formatEUR = (num) => (typeof num === 'number' ? num : Number(num || 0)).toLocaleString('es-ES', {
        style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
    });

    const showConfirmModal = (action) => {
        setModalAction(action);
        setShowModal(true);
    };

    const executeAction = async (sendSMS = false) => {
        setShowModal(false);
        if (modalAction === 'ready') {
            await markReady(sendSMS);
        } else if (modalAction === 'collected') {
            await markCollected(sendSMS);
        }
        setModalAction(null);
    };

    const loadOrder = useCallback(async () => {
        if (!orderId) return;
        setLoading(true);
        setError('');
        try {
            const o = await fetchOrder(token, orderId);
            setOrder(o);
            setInternalNotes(o.observacionesInternas || '');
        } catch (e) {
            console.error('Error cargando pedido:', e);
            setError(e.error || 'Error cargando pedido');
        } finally {
            setLoading(false);
        }
    }, [token, orderId]);

    useEffect(() => {
        loadOrder();
    }, [loadOrder]);

    const loadUsers = useCallback(async () => {
        if (workers.length > 0) return; // Solo cargar si no hay trabajadores ya cargados
        try {
            const workersResp = await fetchUsers(token, {role: 'worker'});
            setWorkers(workersResp.data || []);
        } catch (e) {
            console.error('Error cargando trabajadores:', e);
        }
    }, [token, workers.length]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const handleCardPay = async () => {
        if (!order) return;
        // Evita prompt; confirm más simple y rápido
        const confirmed = window.confirm(`Confirmar pago con tarjeta por ${formatEUR(order.total)}.`);
        if (!confirmed) return;

        setIsProcessing(true);
        setLocalError('');
        try {
            const {order: updatedOrder} = await payWithCard(token, order.id);
            setOrder(updatedOrder);
            onPaid?.();
        } catch (e) {
            console.error('Error pago con tarjeta:', e);
            setLocalError(e.error || 'Error en pago con tarjeta');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCashPay = async () => {
        if (!order) return;
        const received = parseFloat(receivedAmount);
        if (isNaN(received) || received < Number(order.total || 0)) {
            setLocalError('Cantidad recibida insuficiente');
            return;
        }

        setIsProcessing(true);
        setLocalError('');
        try {
            // 1) Procesar el pago
            const {order: paidOrder, change} = await payWithCash(token, order.id, received);
            setOrder(paidOrder);

            // 2) Registrar movimiento de caja solo si el pedido ha quedado pagado
            if (paidOrder?.paid) {
                try {
                    const payload = {
                        type: 'sale_cash_in',
                        amount: paidOrder.total, // <-- usar el importe actualizado
                        note: `Pago pedido #${paidOrder.orderNum || paidOrder.id}`,
                        orderId: paidOrder.id,
                        person: user?.id ?? null,
                    };
                    await createCashMovement(token, payload);
                } catch (movError) {
                    console.error('Error al registrar movimiento de caja:', movError);
                    // No bloquea el flujo
                }
            }

            onPaid?.();
            // (Opcional) feedback al usuario
            alert(`Pago registrado. Vuelta: ${formatEUR(change)}`);
        } catch (e) {
            console.error('Error pago en efectivo:', e);
            setLocalError(e.error || 'Error en pago en efectivo');
        } finally {
            setIsProcessing(false);
        }
    };

    const markReady = async (sendSMS = false) => {
        try {
            await apiUpdateOrder(token, order.id, {status: 'ready', sendSMS});
            await loadOrder();
        } catch (e) {
            console.error(e);
        }
    };

    const markCollected = async (sendSMS = false) => {
        try {
            await apiUpdateOrder(token, order.id, {status: 'collected', sendSMS});
            await loadOrder();
        } catch (e) {
            console.error(e);
        }
    };

    const handleSaveInternalNotes = async () => {
        if (!order) return;
        try {
            await updateOrder(token, order.id, {observacionesInternas: internalNotes});
            // opcional: recarga para reflejar cambios de backend (si hay normalizaciones)
            // await loadOrder();
        } catch (e) {
            console.error('Error guardando notas internas:', e);
        }
    };

    const handleRetryNotification = async (notificationId, phone) => {
        if (!notificationId) return;
        setIsProcessing(true);
        try {
            await retryNotification(token, notificationId, phone);
            await loadOrder();
        } catch (e) {
            console.error('Error reintentando notificación:', e);
            setLocalError(e.error || 'Error al reintentar notificación');
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePrintTicket = async () => {
        if (!order) return;
        setIsPrinting(true);
        try {
            await printSaleTicket(order, [], 'LAVADORA');
        } catch (e) {
            console.error('Error imprimiendo ticket:', e);
        } finally {
            setIsPrinting(false);
        }
    };

    const handlePrintLabels = async () => {
        if (!order) return;
        setIsPrinting(true);
        try {
            const totalItems = (order.lines || []).reduce((sum, l) => sum + (l.quantity || 1), 0);
            await printWashLabels({
                orderNum: order.orderNum,
                clientFirstName: order.client?.firstName || '',
                clientLastName: order.client?.lastName || '',
                totalItems,
                fechaLimite: order.fechaLimite,
            });
        } catch (e) {
            console.error('Error imprimiendo etiquetas:', e);
        } finally {
            setIsPrinting(false);
        }
    };

    const handleCancelOrder = async () => {
        if (!order) return;
        if (!window.confirm('¿Seguro que quieres cancelar este pedido?')) return;
        setIsProcessing(true);
        try {
            await apiUpdateOrder(token, order.id, {status: 'cancelled'});
            await loadOrder();
        } catch (e) {
            console.error('Error cancelando pedido:', e);
            setLocalError(e.error || 'Error al cancelar el pedido');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleGenerateInvoice = async () => {
        if (!order) return;
        setInvoiceLoading(true);
        setLocalError('');
        try {
            const res = await createInvoice(token, {orderIds: [order.id], type: 'n'});
            console.log(res);
            const invoice = res?.data ?? res;
            // opcional: guardar resultado para uso futuro
            setInvoiceResult(invoice);
            // Si la factura es tipo 'n' mostrar notificación de envío por email
            if (invoice && invoice.type === 'n') {
                UIkit.notification({
                    message: 'Factura generada y enviada por correo electrónico al cliente',
                    status: 'success',
                    pos: 'top-right',
                    timeout: 4000
                });
            }
            // Actualiza el estado del pedido para reflejar el cambio
            await loadOrder();
        } catch (e) {
            setLocalError(e.error || 'Error generando factura');
        } finally {
            setInvoiceLoading(false);
        }
    };


    if (loading) return <div>Cargando pedido...</div>;
    if (error) return <div style={{color: 'red'}}>{error}</div>;
    if (!order) return <div>Pedido no encontrado</div>;

    const clienteDisplay = () => (order.client ? `${order.client.firstName} ${order.client.lastName}` : 'Cliente rápido');
    const telefonoDisplay = () => order.client?.phone || null;

    const createdDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-ES') : '—';
    const dueDate = order.fechaLimite ? new Date(order.fechaLimite).toLocaleDateString('es-ES') : '—';

    const changePreview = receivedAmount && !isNaN(parseFloat(receivedAmount)) ? Math.max(0, parseFloat(receivedAmount) - Number(order.total || 0)).toFixed(2) : '0.00';

    return (<div className={'uk-card uk-card-body uk-card-default'}>
        <div className={'uk-card-badge'}>{order.status}</div>
        <h3 className={'uk-card-title'}>
            {clienteDisplay()} {order.orderNum}
        </h3>

        <div className={'uk-badge uk-text-bolder'}>
            {createdDate}
            <span className="uk-icon" uk-icon="icon: arrow-right"></span>
            {dueDate}
        </div>

        {order.status !== 'cancelled' && (<div className={'uk-grid uk-child-width-1-3@l uk-margin-top'}>
            <div>
                {telefonoDisplay() && (<div>
                    <strong>Teléfono:</strong>{' '}
                    <a href={`tel:${telefonoDisplay()}`} className="uk-link-text">
                        {telefonoDisplay()}
                    </a>
                </div>)}
                <div>
                    <strong>Estado pago:</strong> {order.paid ? 'Pagado' : 'Pendiente de pago'}
                </div>
                <div>
                    <strong>Método de pago:</strong>{' '}
                    {order.paymentMethod ? (order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta') : 'No seleccionado'}
                </div>
                <div>
                    <strong>Observaciones:</strong> {order.observaciones || '—'}
                </div>

                <div className="uk-margin-small">
                    <label className={'uk-form-label'}>Persona encargada:</label>
                    <div className={'uk-form-controls'}>
                        <select
                            className={'uk-select'}
                            value={order.workerId ?? ''}
                            onChange={async (e) => {
                                const raw = e.target.value;
                                const workerId = raw === '' ? null : Number.isNaN(Number(raw)) ? raw : Number(raw);
                                // update optimista
                                setOrder((prev) => (prev ? {...prev, workerId} : prev));
                                try {
                                    await apiUpdateOrder(token, order.id, {workerId});
                                } catch (e2) {
                                    console.error('Error actualizando trabajador:', e2);
                                    // fallback: recarga
                                    await loadOrder();
                                }
                            }}
                        >
                            <option value="">Sin asignar</option>
                            {workers.map((w) => (<option key={w.id} value={w.id}>
                                {w.firstName} {w.lastName}
                            </option>))}
                        </select>
                    </div>
                </div>

                <div className="uk-margin-small">
                    <label className="uk-form-label" htmlFor="">
                        Observaciones internas
                    </label>
                    <textarea
                        className="uk-textarea"
                        value={internalNotes}
                        onChange={(e) => setInternalNotes(e.target.value)}
                        onBlur={handleSaveInternalNotes}
                        placeholder="Notas internas del pedido..."
                    />
                </div>
            </div>

            <div>
                <div style={{fontWeight: 'bold'}}>Líneas:</div>
                {(order.lines || []).map((l) => {
                    const name = l.productName || l.product?.name || `#${l.productId}`;
                    const lineTotal = Number(l.unitPrice || 0) * Number(l.quantity || 0);
                    return (<div
                        key={l.id}
                        style={{display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2}}
                    >
                        <div>
                            {l.quantity}x {name}
                        </div>
                        <div>{formatEUR(lineTotal)}</div>
                    </div>);
                })}
                <div style={{marginTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 'bold'}}>
                    <div>Total:</div>
                    <div>{formatEUR(order.total)}</div>
                </div>
            </div>

            <div>
                {/* impresión siempre disponible */}
                <div
                    className="print-buttons"
                    style={{
                        marginTop: 16,
                        display: 'flex',
                        gap: 12,
                        flexWrap: 'wrap',
                        alignItems: 'flex-end',
                        flexDirection: 'column',
                        width: '100%',
                    }}
                >
                    <button
                        className={'uk-button uk-button-default uk-width-1-1@l'}
                        uk-icon={'print'}
                        onClick={handlePrintTicket}
                        disabled={!order || isPrinting}
                    >
                        {isPrinting ? 'Imprimiendo...' : 'Imprimir ticket'}
                    </button>

                    <button
                        className={'uk-button uk-button-default uk-width-1-1@l'}
                        uk-icon={'print'}
                        onClick={handlePrintLabels}
                        disabled={!order || isPrinting}
                    >
                        {isPrinting ? 'Imprimiendo...' : 'Imprimir etiquetas'}
                    </button>

                    {order.status === 'pending' && (<button
                        type="button"
                        className="uk-button uk-button-default uk-width-1-1@l"
                        onClick={() => showConfirmModal('ready')}
                        aria-label="Marcar como listo"
                        uk-icon="check"
                    >
                        Marcar como listo
                    </button>)}

                    {order.status === 'ready' && (<button
                        type="button"
                        className="uk-button uk-button-default uk-width-1-1@l"
                        onClick={() => showConfirmModal('collected')}
                        aria-label="Marcar como recogido"
                    >
                        Marcar como recogido
                    </button>)}

                    {console.log(order)}

                    {!order.paid && (<button
                        className="uk-button uk-button-danger uk-width-1-1@l"
                        onClick={handleCancelOrder}
                        disabled={isProcessing}
                        uk-icon={'trash'}
                    >Cancelar</button>)}

                    {/* Botón para generar factura si está cobrado y no facturado, o para descargar si ya existe */}
                    {order.paid && (!order.invoiceTickets || order.invoiceTickets.length === 0) && (
                        <button
                            className="uk-button uk-button-primary uk-width-1-1@l"
                            onClick={handleGenerateInvoice}
                            disabled={invoiceLoading}
                        >
                            {invoiceLoading ? 'Generando factura...' : 'Generar factura'}
                        </button>
                    )}
                    {order.paid && order.invoiceTickets && order.invoiceTickets.length > 0 && order.invoiceTickets[0].invoices && order.invoiceTickets[0].invoices.pdfPath && (
                        <button
                            className="uk-button uk-button-primary uk-width-1-1@l"
                            onClick={() => downloadInvoicePDF(token, order.invoiceTickets[0].invoices.id)}
                        >
                            Descargar factura
                        </button>
                    )}


                    {showModal && (<div id="confirm-modal" className="uk-modal uk-open" style={{display: 'block'}}>
                        <div className="uk-modal-dialog uk-modal-body">
                            <h2 className="uk-modal-title">
                                {modalAction === 'ready' ? '¿Marcar como listo?' : '¿Marcar como recogido?'}
                            </h2>
                            <p>
                                Indica también si quieres enviar un SMS al cliente. Al marcar como recogido, el
                                SMS es
                                una petición para dejar una reseña.
                            </p>
                            <div className="uk-margin uk-flex uk-flex-between" uk-flex="true">
                                <button className="uk-button uk-button-default uk-margin-small-right"
                                        onClick={() => setShowModal(false)}>
                                    Cancelar
                                </button>
                                <div className={'uk-button-group'}>
                                    <button className="uk-button uk-button-danger"
                                            onClick={() => executeAction(false)}>
                                        Sí, no enviar SMS
                                    </button>
                                    <button className="uk-button uk-button-primary"
                                            onClick={() => executeAction(true)}>
                                        Sí, y enviar SMS
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>)}

                    {(localError || error) && <div style={{color: 'red', marginTop: 8}}>{localError || error}</div>}
                </div>
            </div>
        </div>)}

        {Array.isArray(order.notification) && order.notification.length > 0 && (<div style={{marginTop: 16}}>
            <h6>Notificaciones:</h6>
            <ul className="uk-list uk-list-divider">
                {order.notification.map((n) => (<li key={n.id} style={{fontSize: 12, marginBottom: 6}}>
                    <strong>{n.type}</strong> — {n.status} {n.status === 'failed' && (
                    <div className={"uk-text-danger"} uk-icon="refresh"
                         onClick={() => handleRetryNotification(n.id, order.client.phone)}></div>)} <br/>
                    {n.content} <br/>
                    {n.createdAt && <span
                        style={{color: '#555'}}>{new Date(n.createdAt).toLocaleString('es-ES')}</span>}
                </li>))}
            </ul>
        </div>)}

        {!order.paid && order.status !== 'cancelled' && (<div className={'uk-grid uk-grid-divider'}>
            <h4 className={'uk-width-1-1 uk-margin'}>Pendiente de pago</h4>

            <div className={'uk-width-1-2@l uk-grid'}>
                <p className={'uk-text-bold uk-width-1-1'}>Pago con tarjeta</p>
                <div>
                    <button onClick={handleCardPay} disabled={isProcessing}
                            className={'uk-button uk-button-primary uk-margin-top'}>
                        {isProcessing ? 'Procesando...' : 'Pagar con tarjeta'}
                    </button>
                </div>
            </div>

            <div className={'uk-width-1-2@l uk-grid'}>
                <p className={'uk-text-bold uk-width-1-1'}>Pago en efectivo</p>
                <div className={'uk-grid uk-child-width-1-2 uk-margin-top'}>
                    <label>
                        <input
                            type="number"
                            className={'uk-input uk-width-1-1'}
                            value={receivedAmount}
                            onChange={(e) => setReceivedAmount(e.target.value)}
                            disabled={isProcessing}
                            placeholder="€"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                        />
                        <small style={{textAlign: 'center', width: '100%', display: 'block'}}>
                            Vuelta: {formatEUR(changePreview)}
                        </small>
                    </label>
                    <div>
                        <button onClick={handleCashPay} disabled={isProcessing}
                                className={'uk-button uk-button-primary uk-margin'}>
                            {isProcessing ? 'Procesando...' : 'Pagar en efectivo'}
                        </button>
                    </div>
                </div>
            </div>
        </div>)}
    </div>);
}
