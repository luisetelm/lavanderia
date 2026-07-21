import React, {useState, useEffect, useCallback} from 'react';
import {
    createInvoice,
    fetchOrder,
    fetchUsers,
    payWithCard,
    payWithCash,
    updateOrder,
    updateOrder as apiUpdateOrder,
    retryNotification,
    downloadInvoicePDF,
    updateOrderLine,
    addLineAnnotation,
    createStripeCheckout,
    updateStepStatus,
    recalculateTracking
} from '../api.js';
import AdjustOrderModal from './AdjustOrderModal.jsx';
import UIkit from 'uikit';
import {printSaleTicket, printWashLabels, printInternalLabel, printFinishedLabelForOrder, printGarmentFinishedLabel} from '../utils/printUtils.js';
import {getPrintSettings} from '../utils/printSettings.js';
import {formatEUR} from '../utils/format.js';
import StatusChangeModal from './StatusChangeModal.jsx';
import StepProgress from './StepProgress.jsx';
import PaymentModal from './PaymentModal.jsx';

const COLOR_HEX = {
    negro: '#1e1e1e', blanco: '#f5f5f5', gris: '#9ca3af', azul: '#3b82f6',
    marino: '#1e3a5f', rojo: '#ef4444', verde: '#22c55e', marron: '#92400e',
    beige: '#d4b896', rosa: '#f472b6', amarillo: '#facc15', morado: '#a855f7',
    burdeos: '#7f1d1d', naranja: '#f97316',
};

// Etiquetas y colores semánticos por estado del pedido
const STATUS_META = {
    pending:   { label: 'Pendiente', bg: '#fef3c7', color: '#92400e' },
    ready:     { label: 'Listo',     bg: '#dcfce7', color: '#166534' },
    collected: { label: 'Recogido',  bg: '#e5e7eb', color: '#374151' },
    cancelled: { label: 'Cancelado', bg: '#fee2e2', color: '#991b1b' },
};

// Feedback unificado (sustituye a alert/confirm nativos y errores inline dispersos)
const notify = (message, status = 'primary', timeout = 3000) =>
    UIkit.notification({ message, status, pos: 'top-right', timeout });

const confirmModal = async (message) => {
    try {
        await UIkit.modal.confirm(message, { labels: { ok: 'Confirmar', cancel: 'Cancelar' } });
        return true;
    } catch {
        return false;
    }
};

export default function PaymentSection({token, orderId, onPaid, initialOrder = null, workers: workersProp = null}) {
    const [order, setOrder] = useState(initialOrder);
    const [workers, setWorkers] = useState(workersProp || []);
    const [loading, setLoading] = useState(!!orderId && !initialOrder);
    const [error, setError] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [showPaymentModal, setShowPaymentModal] = useState(false); // modal de cobro
    const [lastChange, setLastChange] = useState(null); // vuelta del último pago en efectivo
    const [localError, setLocalError] = useState('');
    const [isPrinting, setIsPrinting] = useState(false);
    const [invoiceLoading, setInvoiceLoading] = useState(false);
    const [editingLineId, setEditingLineId] = useState(null);
    const [lineDiscounts, setLineDiscounts] = useState({});

    // Anotaciones post-creación inline
    const [annotatingLineId, setAnnotatingLineId] = useState(null);
    const [annotationText, setAnnotationText] = useState('');
    const [annotationUploading, setAnnotationUploading] = useState(false);

    // Modal de confirmación (listo/recogido)
    const [showModal, setShowModal] = useState(false);
    const [modalAction, setModalAction] = useState(null);

    // Ajuste de un pedido ya cobrado (añadir/anular líneas). Mueve dinero y
    // emite documentos fiscales, así que se limita a admin y caja.
    const [showAdjustModal, setShowAdjustModal] = useState(false);
    const rolActual = (() => {
        try { return JSON.parse(localStorage.getItem('user') || 'null')?.role || ''; }
        catch { return ''; }
    })();
    const puedeAjustar = ['admin', 'cashier'].includes(rolActual);

    // Notas internas controladas
    const [internalNotes, setInternalNotes] = useState('');
    const [notesSaveState, setNotesSaveState] = useState(''); // '' | 'saving' | 'saved'

    // Edición fecha de entrega
    const [editingDate, setEditingDate] = useState(false);
    const [newDate, setNewDate] = useState('');

    // Recalcular tracking
    const [recalculating, setRecalculating] = useState(false);

    /* ── Comprimir foto a JPEG pequeño (reutilizable) ── */
    const compressPhoto = (file) => new Promise((resolve) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.onload = () => {
                const MAX = 800;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    const ratio = Math.min(MAX / w, MAX / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
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

    // Solo hacemos el fetch inicial si NO nos pasaron initialOrder (evita N+1 en listas)
    const initialOrderProvided = !!initialOrder;
    useEffect(() => {
        if (initialOrderProvided) {
            setOrder(initialOrder);
            setInternalNotes(initialOrder?.observacionesInternas || '');
            return;
        }
        loadOrder();
    }, [loadOrder, initialOrderProvided]);

    const loadUsers = useCallback(async () => {
        // Si nos pasaron workers desde el padre, no hace falta cargarlos
        if (workersProp && workersProp.length >= 0) return;
        if (workers.length > 0) return;
        try {
            const workersResp = await fetchUsers(token, {role: 'worker'});
            setWorkers(workersResp.data || []);
        } catch (e) {
            console.error('Error cargando trabajadores:', e);
        }
    }, [token, workers.length, workersProp]);

    useEffect(() => {
        if (workersProp) {
            setWorkers(workersProp);
            return;
        }
        loadUsers();
    }, [loadUsers, workersProp]);

    // Handlers de cobro consumidos por PaymentModal: actualizan estado y relanzan en error
    const handleCardPay = async () => {
        if (!order) return;
        const {order: updatedOrder} = await payWithCard(token, order.id);
        setOrder(updatedOrder);
        onPaid?.();
        if (getPrintSettings().onPay) {
            try { await printSaleTicket(updatedOrder, [], {token, variant: 'customer'}); }
            catch (e) { console.warn('Impresión automática al cobrar falló:', e); }
        }
    };

    const handleCashPay = async (received) => {
        if (!order) return 0;
        const {order: paidOrder, change} = await payWithCash(token, order.id, received);
        setOrder(paidOrder);
        setLastChange(change);
        onPaid?.();
        if (getPrintSettings().onPay) {
            try { await printSaleTicket(paidOrder, [], {token, variant: 'customer'}); }
            catch (e) { console.warn('Impresión automática al cobrar falló:', e); }
        }
        return change;
    };

    const markReady = async (sendSMS = false) => {
        setIsProcessing(true);
        try {
            await apiUpdateOrder(token, order.id, {status: 'ready', sendSMS});
            await loadOrder();
            notify('Pedido marcado como listo', 'success');
            if (getPrintSettings().onReady) {
                try { await printInternalLabel(order, {token}); }
                catch (e) { console.warn('Impresión automática de etiqueta interna falló:', e); }
            }
        } catch (e) {
            console.error(e);
            notify(e.error || 'Error al marcar como listo', 'danger');
        } finally {
            setIsProcessing(false);
        }
    };

    const markCollected = async (sendSMS = false) => {
        setIsProcessing(true);
        try {
            await apiUpdateOrder(token, order.id, {status: 'collected', sendSMS});
            await loadOrder();
            notify('Pedido marcado como recogido', 'success');
        } catch (e) {
            console.error(e);
            notify(e.error || 'Error al marcar como recogido', 'danger');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSaveInternalNotes = async () => {
        if (!order) return;
        if ((order.observacionesInternas || '') === internalNotes) return; // sin cambios
        setNotesSaveState('saving');
        try {
            await updateOrder(token, order.id, {observacionesInternas: internalNotes});
            setOrder((prev) => (prev ? {...prev, observacionesInternas: internalNotes} : prev));
            setNotesSaveState('saved');
            setTimeout(() => setNotesSaveState(''), 2000);
        } catch (e) {
            console.error('Error guardando notas internas:', e);
            setNotesSaveState('');
            notify('No se pudieron guardar las notas internas', 'danger');
        }
    };

    const handleCompleteStep = async (stepId) => {
        try {
            // Capturar los datos de la prenda ANTES de recargar (para su etiqueta de embolsado).
            const line = (order?.lines || []).find(l => (l.steps || []).some(s => s.id === stepId));
            const res = await updateStepStatus(token, stepId, {});
            await loadOrder();
            // Cada vez que una PRENDA queda totalmente finalizada: imprimir su etiqueta
            // grande de embolsado (respeta el ajuste onGarmentReady).
            if (res?.lineBecameReady && line) {
                const clientName = order.client
                    ? `${order.client.firstName || ''} ${order.client.lastName || ''}`.trim()
                    : '';
                const printed = await printGarmentFinishedLabel({
                    orderNum: order.orderNum,
                    clientName,
                    productName: line.product?.name || line.productName || 'Prenda',
                    quantity: line.quantity,
                    fechaLimite: order.fechaLimite,
                });
                if (printed) notify('Prenda finalizada · etiqueta de embolsado impresa', 'success');
            }
            if (res?.orderBecameReady) {
                const printed = await printFinishedLabelForOrder(token, res.orderId);
                if (printed) notify('Pedido listo · etiqueta de finalizado impresa', 'success');
            }
        } catch (e) {
            console.error('Error completando paso:', e);
            UIkit.notification({
                message: 'Error al completar el paso',
                status: 'danger', pos: 'top-right', timeout: 2000
            });
        }
    };

    const handleDateChange = async () => {
        if (!order || !newDate) return;
        try {
            await apiUpdateOrder(token, order.id, { fechaLimite: newDate });
            setEditingDate(false);
            await loadOrder();
        } catch (e) {
            console.error('Error actualizando fecha:', e);
            UIkit.notification({
                message: e.error || 'Error al actualizar la fecha de entrega',
                status: 'danger', pos: 'top-right', timeout: 3000
            });
        }
    };

    const handleRecalculateTracking = async () => {
        if (!order) return;
        setRecalculating(true);
        try {
            const result = await recalculateTracking(token, order.id);
            UIkit.notification({
                message: result.message || 'Tracking recalculado',
                status: 'success', pos: 'top-right', timeout: 3000
            });
            await loadOrder();
        } catch (e) {
            console.error('Error recalculando tracking:', e);
            UIkit.notification({
                message: e.error || 'Error al recalcular el tracking',
                status: 'danger', pos: 'top-right', timeout: 3000
            });
        } finally {
            setRecalculating(false);
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
            await printSaleTicket(order, [], { token, variant: 'customer' });
        } catch (e) {
            console.error('Error imprimiendo ticket:', e);
        } finally {
            setIsPrinting(false);
        }
    };

    const handlePrintInternalTicket = async () => {
        if (!order) return;
        setIsPrinting(true);
        try {
            await printInternalLabel(order, { token });
        } catch (e) {
            console.error('Error imprimiendo etiqueta interna:', e);
        } finally {
            setIsPrinting(false);
        }
    };

    const handlePrintLabels = async () => {
        if (!order) return;
        setIsPrinting(true);
        try {
            const totalItems = (order.lines || []).reduce((sum, l) => {
                if (l.product?.printWashLabel === false) return sum; // no genera etiquetas de lavado
                const labels = l.product?.labelCount || l.labelCount || 1;
                return sum + (l.quantity || 1) * labels;
            }, 0);
            if (totalItems === 0) {
                notify('Este pedido no tiene prendas con etiqueta de lavado', 'warning');
                return;
            }
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

    const handleStripePaymentLink = async () => {
        if (!order) return '';
        const { url } = await createStripeCheckout(token, { type: 'order', id: order.id });
        if (navigator.clipboard?.writeText) {
            try { await navigator.clipboard.writeText(url); } catch { /* sin portapapeles */ }
        }
        return url;
    };

    const handleCancelOrder = async () => {
        if (!order) return;
        const confirmed = await confirmModal('¿Seguro que quieres <b>cancelar</b> este pedido?');
        if (!confirmed) return;
        setIsProcessing(true);
        try {
            await apiUpdateOrder(token, order.id, {status: 'cancelled'});
            await loadOrder();
            notify('Pedido cancelado', 'warning');
        } catch (e) {
            console.error('Error cancelando pedido:', e);
            setLocalError(e.error || 'Error al cancelar el pedido');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleLineDiscountChange = (lineId, value) => {
        setLineDiscounts(prev => ({
            ...prev,
            [lineId]: value
        }));
    };

    const handleApplyLineDiscount = async (line) => {
        if (!order || !line) return;

        const discount = parseFloat(lineDiscounts[line.id] !== undefined ? lineDiscounts[line.id] : line.discount || 0);

        if (isNaN(discount) || discount < 0 || discount > 100) {
            UIkit.notification({
                message: 'El descuento debe ser un número entre 0 y 100',
                status: 'danger',
                pos: 'top-right',
                timeout: 3000
            });
            return;
        }

        try {
            const updatedOrder = await updateOrderLine(token, line.id, { discount });
            setOrder(updatedOrder);
            setEditingLineId(null);
            setLineDiscounts(prev => {
                const newState = { ...prev };
                delete newState[line.id];
                return newState;
            });
            UIkit.notification({
                message: `Descuento del ${discount}% aplicado correctamente`,
                status: 'success',
                pos: 'top-right',
                timeout: 2000
            });
        } catch (e) {
            console.error('Error aplicando descuento:', e);
            UIkit.notification({
                message: e.error || 'Error al aplicar el descuento',
                status: 'danger',
                pos: 'top-right',
                timeout: 3000
            });
        }
    };

    const handleGenerateInvoice = async () => {
        if (!order) return;
        setInvoiceLoading(true);
        setLocalError('');
        try {
            const res = await createInvoice(token, {orderIds: [order.id], type: 'n'});
            const invoice = res?.data ?? res;
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

    const statusMeta = STATUS_META[order.status] || { label: order.status, bg: '#e5e7eb', color: '#374151' };
    const isOverdue = order.fechaLimite
        && !['collected', 'cancelled'].includes(order.status)
        && new Date(order.fechaLimite) < new Date(new Date().toDateString());

    return (<div className={'uk-card uk-card-body uk-card-default'}>
        <div
            className={'uk-card-badge'}
            style={{
                background: statusMeta.bg, color: statusMeta.color,
                fontWeight: 600, padding: '2px 10px', borderRadius: 12, fontSize: 12,
            }}
        >
            {statusMeta.label}
        </div>
        <h3 className={'uk-card-title'} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span>{clienteDisplay()}</span>
            <span style={{
                fontFamily: 'monospace', fontSize: '0.65em', color: '#64748b',
                background: '#f1f5f9', padding: '2px 8px', borderRadius: 6,
            }}>
                {order.orderNum}
            </span>
            {isOverdue && (
                <span style={{
                    fontSize: '0.55em', fontWeight: 700, color: '#991b1b',
                    background: '#fee2e2', padding: '2px 8px', borderRadius: 6,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                    ⚠ Atrasado
                </span>
            )}
        </h3>

        <div className={'uk-badge uk-text-bolder'} style={isOverdue ? { background: '#dc2626', color: '#fff' } : undefined}>
            {createdDate}
            <span className="uk-icon" uk-icon="icon: arrow-right"></span>
            {editingDate ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input
                        type="date"
                        value={newDate}
                        onChange={(e) => setNewDate(e.target.value)}
                        style={{ fontSize: 'inherit', padding: '0 4px', border: '1px solid #ccc', borderRadius: 3, height: 22 }}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleDateChange();
                            if (e.key === 'Escape') setEditingDate(false);
                        }}
                    />
                    <span className="uk-icon" uk-icon="icon: check; ratio: 0.7" style={{ cursor: 'pointer', color: '#32d296' }} onClick={handleDateChange}></span>
                    <span className="uk-icon" uk-icon="icon: close; ratio: 0.7" style={{ cursor: 'pointer', color: '#f0506e' }} onClick={() => setEditingDate(false)}></span>
                </span>
            ) : (
                <span
                    style={{ cursor: order.status !== 'collected' && order.status !== 'cancelled' ? 'pointer' : 'default' }}
                    onClick={() => {
                        if (order.status === 'collected' || order.status === 'cancelled') return;
                        setNewDate(order.fechaLimite ? new Date(order.fechaLimite).toISOString().split('T')[0] : '');
                        setEditingDate(true);
                    }}
                    title={order.status !== 'collected' && order.status !== 'cancelled' ? 'Clic para cambiar fecha de entrega' : ''}
                >
                    {dueDate}
                    {order.status !== 'collected' && order.status !== 'cancelled' && (
                        <span className="uk-icon" uk-icon="icon: pencil; ratio: 0.6" style={{ marginLeft: 4 }}></span>
                    )}
                </span>
            )}
        </div>


        {showPaymentModal && (
            <PaymentModal
                total={order.total}
                onClose={() => setShowPaymentModal(false)}
                onPayCard={handleCardPay}
                onPayCash={handleCashPay}
                onStripeLink={handleStripePaymentLink}
            />
        )}

        {/* Vuelta del último pago en efectivo (persiste tras el cobro) */}
        {order.paid && lastChange !== null && (
            <div style={{
                marginTop: 12, padding: '6px 12px', borderRadius: 6,
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13,
            }}>
                <span style={{ color: '#166534', fontWeight: 600 }}>✓ Pago registrado</span>
                <span style={{ fontWeight: 700, color: '#166534' }}>
                    Vuelta: {formatEUR(lastChange)}
                </span>
            </div>
        )}

        {order.status !== 'cancelled' && (<div className={'uk-grid uk-child-width-1-3@l uk-margin-top'}>
            <div>
                {telefonoDisplay() && (<div>
                    <strong>Teléfono:</strong>{' '}
                    <a href={`tel:${telefonoDisplay()}`} className="uk-link-text">
                        {telefonoDisplay()}
                    </a>
                </div>)}
                <div>
                    <strong>Estado pago:</strong> {order.paid ? 'Pagado' : (Number(order.total) <= 0 ? 'No requiere pago' : 'Pendiente de pago')}
                </div>
                {(() => {
                    const pay = (order.payments || []).find(p => p.status === 'completed') || (order.payments || [])[0] || null;
                    const METHOD = { cash: 'Efectivo', card_pos: 'Tarjeta (TPV)', card: 'Tarjeta', stripe: 'Stripe', transfer: 'Transferencia', none: 'Sin cobro' };
                    const methodLabel = pay?.method
                        ? (METHOD[pay.method] || pay.method)
                        : (order.paymentMethod ? (order.paymentMethod === 'cash' ? 'Efectivo' : order.paymentMethod === 'none' ? 'Sin cobro' : 'Tarjeta') : 'No seleccionado');
                    return (<>
                        <div>
                            <strong>Método de pago:</strong> {methodLabel}
                        </div>
                        {order.paid && pay?.createdAt && (
                            <div>
                                <strong>Fecha de pago:</strong>{' '}
                                {new Date(pay.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
                            </div>
                        )}
                    </>);
                })()}
                {(() => {
                    // "Listo": último paso de tracking completado (dato ya disponible)
                    const completedDates = (order.lines || [])
                        .flatMap(l => l.steps || [])
                        .filter(s => s.status === 'done' && s.completedAt)
                        .map(s => new Date(s.completedAt).getTime());
                    const readyAt = completedDates.length ? new Date(Math.max(...completedDates)) : null;
                    // "Recogido": aproximado por updatedAt cuando el pedido está recogido
                    const collectedAt = order.status === 'collected' && order.updatedAt ? new Date(order.updatedAt) : null;
                    const fmt = (d) => d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
                    return (<>
                        {readyAt && (order.status === 'ready' || order.status === 'collected') && (
                            <div>
                                <strong>Listo:</strong> {fmt(readyAt)}
                            </div>
                        )}
                        {collectedAt && (
                            <div>
                                <strong>Recogido:</strong> {fmt(collectedAt)}
                            </div>
                        )}
                    </>);
                })()}
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
                    <label className="uk-form-label" htmlFor={`internal-notes-${order.id}`}>
                        Observaciones internas
                        {notesSaveState === 'saving' && <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8' }}><span uk-spinner="ratio: 0.4"></span> Guardando…</span>}
                        {notesSaveState === 'saved' && <span style={{ marginLeft: 6, fontSize: 11, color: '#16a34a' }}>✓ Guardado</span>}
                    </label>
                    <textarea
                        id={`internal-notes-${order.id}`}
                        className="uk-textarea"
                        value={internalNotes}
                        onChange={(e) => setInternalNotes(e.target.value)}
                        onBlur={handleSaveInternalNotes}
                        placeholder="Notas internas del pedido..."
                    />
                </div>
            </div>

            <div>
                <div style={{fontWeight: 'bold', marginBottom: 8}}>Líneas:</div>
                {(order.lines || []).map((l) => {
                    const name = l.productName || l.product?.name || `#${l.productId}`;
                    const subtotal = Number(l.unitPrice || 0) * Number(l.quantity || 0);
                    const discountAmount = (subtotal * (l.discount || 0)) / 100;
                    const lineTotal = subtotal - discountAmount;
                    const isEditing = editingLineId === l.id;
                    const canEdit = !order.paid && order.status !== 'cancelled';

                    return (<div
                        key={l.id}
                        style={{
                            marginBottom: 8,
                            padding: '6px 0',
                            borderBottom: '1px solid #e5e5e5'
                        }}
                    >
                        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4}}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                {l.color && COLOR_HEX[l.color] && (
                                    <span style={{
                                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                        background: COLOR_HEX[l.color],
                                        border: l.color === 'blanco' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.1)',
                                    }}></span>
                                )}
                                {l.quantity}x {name}
                            </div>
                            <div>{formatEUR(lineTotal)}</div>
                        </div>

                        {/* Descuento por línea */}
                        {canEdit ? (
                            <div style={{display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666'}}>
                                <span>Descuento:</span>
                                <input
                                    type="number"
                                    id={`line-discount-${l.id}`}
                                    aria-label={`Descuento de la línea ${name}`}
                                    className="uk-input uk-form-small"
                                    style={{width: '50px', padding: '1px 4px', fontSize: 11, height: '22px'}}
                                    value={lineDiscounts[l.id] !== undefined ? lineDiscounts[l.id] : (l.discount || 0)}
                                    onChange={(e) => handleLineDiscountChange(l.id, e.target.value)}
                                    onFocus={() => setEditingLineId(l.id)}
                                    onBlur={() => {
                                        if (lineDiscounts[l.id] !== undefined && lineDiscounts[l.id] !== l.discount) {
                                            handleApplyLineDiscount(l);
                                        } else {
                                            setEditingLineId(null);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleApplyLineDiscount(l);
                                        } else if (e.key === 'Escape') {
                                            setLineDiscounts(prev => {
                                                const newState = { ...prev };
                                                delete newState[l.id];
                                                return newState;
                                            });
                                            setEditingLineId(null);
                                        }
                                    }}
                                    placeholder="%"
                                    min="0"
                                    max="100"
                                />
                                <span>%</span>
                                {!isEditing && (
                                    <span
                                        className="uk-icon-link"
                                        uk-icon="icon: pencil; ratio: 0.7"
                                        role="button"
                                        aria-label="Editar descuento"
                                        style={{cursor: 'pointer', color: '#1e87f0', padding: 4}}
                                        onClick={() => {
                                            setEditingLineId(l.id);
                                            const input = document.getElementById(`line-discount-${l.id}`);
                                            if (input) setTimeout(() => { input.focus(); input.select(); }, 0);
                                        }}
                                    ></span>
                                )}
                                {l.discount > 0 && (
                                    <span style={{color: '#f0506e', marginLeft: 4}}>
                                        (-{formatEUR(discountAmount)})
                                    </span>
                                )}
                            </div>
                        ) : (
                            l.discount > 0 && (
                                <div style={{fontSize: 11, color: '#666'}}>
                                    Descuento ({l.discount}%): -{formatEUR(discountAmount)}
                                </div>
                            )
                        )}

                        {/* Tracking de pasos */}
                        {l.steps && l.steps.length > 0 && (
                            <StepProgress
                                steps={l.steps}
                                onComplete={order.status !== 'cancelled' ? handleCompleteStep : undefined}
                            />
                        )}

                        {/* Anotaciones de la línea (notas + fotos unificadas) */}
                        {(() => {
                            const annotations = Array.isArray(l.annotations) ? l.annotations : [];
                            const receiptNotes = annotations.filter(a => a.origin === 'receipt' && a.type === 'note');
                            const receiptPhotos = annotations.filter(a => a.origin === 'receipt' && a.type === 'photo');
                            const internalAnnotations = annotations.filter(a => a.origin === 'internal');

                            return (<>
                                {/* Notas de recepción (inmutables) */}
                                {receiptNotes.map((a, i) => (
                                    <div key={`rn${i}`} style={{ fontSize: 11, color: '#b45309', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span uk-icon="icon: file-edit; ratio: 0.55"></span>
                                        {a.text}
                                    </div>
                                ))}

                                {/* Fotos de recepción (inmutables) */}
                                {receiptPhotos.length > 0 && (
                                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                        {receiptPhotos.map((a, i) => (
                                            <a key={`rp${i}`} href={`/uploads/line-photos/${a.file}`} target="_blank" rel="noopener noreferrer">
                                                <img src={`/uploads/line-photos/${a.file}`} alt={`Foto ${i + 1}`}
                                                     style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' }} />
                                            </a>
                                        ))}
                                    </div>
                                )}

                                {/* Anotaciones internas posteriores */}
                                {internalAnnotations.length > 0 && (
                                    <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid #e0e7ff' }}>
                                        {internalAnnotations.map((a, i) => (
                                            <div key={`ia${i}`} style={{ fontSize: 10, color: '#6366f1', marginBottom: 2 }}>
                                                {a.type === 'note' && <><span uk-icon="icon: comment; ratio: 0.45"></span> {a.text}</>}
                                                {a.type === 'photo' && (
                                                    <a href={`/uploads/line-photos/${a.file}`} target="_blank" rel="noopener noreferrer">
                                                        <img src={`/uploads/line-photos/${a.file}`} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 3 }} />
                                                    </a>
                                                )}
                                                <span style={{ color: '#94a3b8', marginLeft: 4, fontSize: 9 }}>
                                                    {a.by} · {new Date(a.at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Botón para añadir anotación */}
                                <div style={{ marginTop: 4 }}>
                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                        <button
                                            type="button"
                                            style={{
                                                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                                                border: `1px solid ${annotatingLineId === l.id ? '#4f46e5' : '#c7d2fe'}`,
                                                background: annotatingLineId === l.id ? '#4f46e5' : '#eef2ff',
                                                color: annotatingLineId === l.id ? '#fff' : '#4f46e5',
                                                cursor: 'pointer',
                                            }}
                                            onClick={() => {
                                                setAnnotatingLineId(annotatingLineId === l.id ? null : l.id);
                                                setAnnotationText('');
                                            }}
                                        >
                                            <span uk-icon="icon: comment; ratio: 0.45"></span> Nota
                                        </button>
                                        <label style={{
                                            fontSize: 10, padding: '1px 6px', borderRadius: 4,
                                            border: '1px solid #c7d2fe', background: '#eef2ff',
                                            color: annotationUploading ? '#94a3b8' : '#4f46e5',
                                            cursor: annotationUploading ? 'wait' : 'pointer',
                                            opacity: annotationUploading ? 0.6 : 1,
                                        }}>
                                            {annotationUploading
                                                ? <><span uk-spinner="ratio: 0.3"></span> Subiendo...</>
                                                : <><span uk-icon="icon: camera; ratio: 0.45"></span> Foto</>
                                            }
                                            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                                                disabled={annotationUploading}
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    if (!file) return;
                                                    setAnnotationUploading(true);
                                                    try {
                                                        const compressed = await compressPhoto(file);
                                                        await addLineAnnotation(token, l.id, { type: 'photo', photo: compressed });
                                                        await loadOrder();
                                                    } catch (err) { console.error('Error añadiendo foto:', err); }
                                                    finally { setAnnotationUploading(false); }
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>
                                    </div>

                                    {/* Panel inline de nota con chips rápidos */}
                                    {annotatingLineId === l.id && (
                                        <div style={{ marginTop: 6, padding: '6px 8px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e0e7ff' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
                                                {['Mancha difícil', 'Prenda delicada', 'Sin garantía', 'Botones sueltos', 'Color desteñido', 'Revisado OK'].map(chip => (
                                                    <button
                                                        key={chip}
                                                        type="button"
                                                        style={{
                                                            fontSize: '0.6rem', padding: '1px 7px', borderRadius: 10,
                                                            border: '1px solid #c7d2fe', background: '#eef2ff',
                                                            color: '#4f46e5', cursor: 'pointer',
                                                        }}
                                                        onClick={() => {
                                                            const cur = annotationText.trim();
                                                            const sep = cur ? '. ' : '';
                                                            setAnnotationText(cur + sep + chip);
                                                        }}
                                                    >
                                                        {chip}
                                                    </button>
                                                ))}
                                            </div>
                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                <input
                                                    type="text"
                                                    value={annotationText}
                                                    onChange={(e) => setAnnotationText(e.target.value)}
                                                    placeholder="Escribe una nota..."
                                                    autoFocus
                                                    onKeyDown={async (e) => {
                                                        if (e.key === 'Enter' && annotationText.trim()) {
                                                            e.preventDefault();
                                                            try {
                                                                await addLineAnnotation(token, l.id, { type: 'note', text: annotationText.trim() });
                                                                setAnnotationText('');
                                                                setAnnotatingLineId(null);
                                                                await loadOrder();
                                                            } catch (err) { console.error('Error añadiendo nota:', err); }
                                                        } else if (e.key === 'Escape') {
                                                            setAnnotatingLineId(null);
                                                            setAnnotationText('');
                                                        }
                                                    }}
                                                    style={{
                                                        flex: 1, fontSize: '0.75rem', padding: '4px 8px',
                                                        border: '1px solid #c7d2fe', borderRadius: 4,
                                                        outline: 'none',
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    disabled={!annotationText.trim()}
                                                    style={{
                                                        fontSize: 10, padding: '3px 8px', borderRadius: 4,
                                                        border: 'none', background: annotationText.trim() ? '#4f46e5' : '#cbd5e1',
                                                        color: '#fff', cursor: annotationText.trim() ? 'pointer' : 'default',
                                                    }}
                                                    onClick={async () => {
                                                        if (!annotationText.trim()) return;
                                                        try {
                                                            await addLineAnnotation(token, l.id, { type: 'note', text: annotationText.trim() });
                                                            setAnnotationText('');
                                                            setAnnotatingLineId(null);
                                                            await loadOrder();
                                                        } catch (err) { console.error('Error añadiendo nota:', err); }
                                                    }}
                                                >
                                                    Guardar
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>);
                        })()}
                    </div>);
                })}

                {/* Total */}
                <div style={{marginTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', paddingTop: 8, borderTop: '2px solid #333'}}>
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
                    {/* Cobro: solo si el pedido tiene importe y está pendiente de pago.
                        Los pedidos de 0 € (p. ej. 100% descuento) no requieren cobro. */}
                    {!order.paid && Number(order.total) > 0 && (
                        <button
                            type="button"
                            className={'uk-button uk-button-primary uk-width-1-1@l'}
                            onClick={() => setShowPaymentModal(true)}
                            disabled={isProcessing}
                        >
                            💰 Cobrar {formatEUR(order.total)}
                        </button>
                    )}

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
                        disabled={!order || isPrinting || order.status !== 'pending'}
                        title="Etiquetas de lavado (van con la ropa). Disponible mientras el pedido está pendiente."
                    >
                        {isPrinting ? 'Imprimiendo...' : 'Etiqueta lavado'}
                    </button>

                    <button
                        className={'uk-button uk-button-default uk-width-1-1@l'}
                        uk-icon={'print'}
                        onClick={handlePrintInternalTicket}
                        disabled={!order || isPrinting || !(
                            order.status === 'ready' ||
                            (order.lines || []).some(l => (l.steps?.length > 0) && l.steps.every(s => s.status === 'done'))
                        )}
                        title="Etiqueta de recogida/embolsado con QR al pedido. Disponible cuando el pedido está listo o alguna prenda ya finalizada."
                    >
                        {isPrinting ? 'Imprimiendo...' : 'Etiqueta finalizado'}
                    </button>

                    {/* Recalcular tracking: visible si alguna línea no tiene pasos y el pedido está activo */}
                    {order.status !== 'collected' && order.status !== 'cancelled' && (() => {
                        const linesWithoutSteps = (order.lines || []).filter(l => !l.steps || l.steps.length === 0);
                        return linesWithoutSteps.length > 0 ? (
                            <button
                                type="button"
                                className="uk-button uk-button-default uk-width-1-1@l"
                                onClick={handleRecalculateTracking}
                                disabled={recalculating}
                                style={{ borderColor: '#f0ad4e', color: '#f0ad4e' }}
                            >
                                {recalculating
                                    ? 'Recalculando...'
                                    : `Recalcular tracking (${linesWithoutSteps.length} sin itinerario)`
                                }
                            </button>
                        ) : null;
                    })()}

                    {order.status === 'pending' && (() => {
                        const allSteps = (order.lines || []).flatMap(l => l.steps || []);
                        const hasTracking = allSteps.length > 0;
                        const allDone = hasTracking ? allSteps.every(s => s.status === 'done') : true;
                        const canMarkReady = !hasTracking || allDone;
                        return (
                            <button
                                type="button"
                                className="uk-button uk-button-default uk-width-1-1@l"
                                onClick={() => showConfirmModal('ready')}
                                aria-label="Marcar como listo"
                                uk-icon="check"
                                disabled={!canMarkReady}
                                style={!canMarkReady ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                title={!canMarkReady ? 'Completa todos los pasos del tracking primero' : ''}
                            >
                                {canMarkReady ? 'Marcar como listo' : '🔒 Tracking en curso'}
                            </button>
                        );
                    })()}

                    {order.status === 'ready' && (order.paid || Number(order.total) <= 0) && (<button
                        type="button"
                        className="uk-button uk-button-default uk-width-1-1@l"
                        onClick={() => showConfirmModal('collected')}
                        aria-label="Marcar como recogido"
                    >
                        Marcar como recogido
                    </button>)}

                    {order.status === 'ready' && !order.paid && Number(order.total) > 0 && (
                        <p style={{ fontSize: '0.8rem', color: '#f59e0b', margin: '4px 0' }}>
                            ⚠️ Cobra el pedido antes de marcar como recogido.
                        </p>
                    )}

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


                    {/* Ajustar un pedido ya cobrado: añadir lo que falte o anular lo
                        cobrado por error. Emite rectificativa y/o factura nueva. */}
                    {order.paid && order.status !== 'cancelled' && puedeAjustar && (
                        <button
                            className="uk-button uk-button-default uk-width-1-1@l"
                            onClick={() => setShowAdjustModal(true)}
                            disabled={isProcessing}
                        >
                            Ajustar pedido
                        </button>
                    )}

                    {showAdjustModal && (
                        <AdjustOrderModal
                            token={token}
                            order={order}
                            onClose={() => setShowAdjustModal(false)}
                            onDone={(res) => {
                                setShowAdjustModal(false);
                                const docs = [
                                    res?.documentos?.rectificativa?.number,
                                    res?.documentos?.factura?.number,
                                ].filter(Boolean);
                                const dinero = res?.neto > 0
                                    ? `Cobrar ${formatEUR(res.neto)}`
                                    : (res?.neto < 0 ? `Devolver ${formatEUR(Math.abs(res.neto))}` : 'Sin cambio de importe');
                                UIkit.notification({
                                    message: `Ajuste aplicado. ${dinero}.` + (docs.length ? ` Documentos: ${docs.join(', ')}` : ''),
                                    status: 'success',
                                    timeout: 6000,
                                });
                                loadOrder();
                            }}
                        />
                    )}

                    {showModal && (
                        <StatusChangeModal
                            action={modalAction}
                            clientChannel={order?.client?.notifyChannel || null}
                            onConfirm={(sendSMS) => executeAction(sendSMS)}
                            onCancel={() => setShowModal(false)}
                        />
                    )}

                    {(localError || error) && <div style={{color: 'red', marginTop: 8}}>{localError || error}</div>}
                </div>
            </div>
        </div>)}

        {Array.isArray(order.notification) && order.notification.length > 0 && (<div style={{marginTop: 16}}>
            <h6>Notificaciones:</h6>
            <ul className="uk-list uk-list-divider">
                {order.notification.map((n) => (<li key={n.id} style={{fontSize: 12, marginBottom: 6}}>
                    <strong>{n.type}</strong> — {n.status} {n.status === 'failed' && (
                    <button type="button" className="uk-text-danger" uk-icon="refresh"
                            aria-label="Reintentar notificación"
                            disabled={isProcessing}
                            style={{background: 'none', border: 'none', cursor: 'pointer', padding: 4}}
                            onClick={() => handleRetryNotification(n.id, order.client.phone)}></button>)} <br/>
                    {n.content} <br/>
                    {n.createdAt && <span
                        style={{color: '#555'}}>{new Date(n.createdAt).toLocaleString('es-ES')}</span>}
                </li>))}
            </ul>
        </div>)}
    </div>);
}
