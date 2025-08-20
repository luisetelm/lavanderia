import React, {useState, useEffect, useCallback} from 'react';
import {createCashMovement, fetchOrder, payWithCard, payWithCash, updateOrder} from '../api.js';
import {printSaleTicket, printWashLabels} from '../utils/printUtils.js';

/**
 * PaymentSection para un pedido concreto.
 * Props:
 *  - token: string (auth)
 *  - orderId: número o string
 *  - onPaid?: callback que se llama cuando se completa el pago exitosamente
 */
export default function PaymentSection({token, orderId, onPaid}) {
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(!!orderId);
    const [error, setError] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [receivedAmount, setReceivedAmount] = useState('');
    const [localError, setLocalError] = useState('');
    const [isPrinting, setIsPrinting] = useState(false);

    const loadOrder = useCallback(async () => {
        if (!orderId) return;
        setLoading(true);
        setError('');
        try {
            const o = await fetchOrder(token, orderId);
            setOrder(o);
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

    const handleCardPay = async () => {
        if (!order) return;
        const confirmed = window.prompt(`Confirmar pago con tarjeta por ${order.total.toFixed(2)} €. Escribe "OK" para continuar.`);
        if (!(confirmed && confirmed.toUpperCase() === 'OK')) return;

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
        if (isNaN(received) || received < order.total) {
            setLocalError('Cantidad recibida insuficiente');
            return;
        }

        setIsProcessing(true);
        setLocalError('');
        try {
            // 1. Procesar el pago

            const {order: updatedOrder, change} = await payWithCash(token, order.id, received);
            setOrder(updatedOrder);

            console.log(order)

            // 2. Registrar el movimiento de caja
            if (order.paid) {
                try {
                    // Crear movimiento de caja por el pago en efectivo
                    const cashMovement = await createCashMovement(token, {
                        type: 'sale_cash_in',
                        amount: order.total,
                        note: `Pago pedido #${order.orderNum || order.id}`,
                        orderId: order.id
                    });

                    // Recargar los movimientos de caja
                    await loadCash();
                    console.log('Movimiento de caja registrado:', cashMovement);

                } catch (movError) {
                    console.error('Error al registrar movimiento de caja:', movError);
                    // No bloqueamos el proceso si falla el registro del movimiento
                }
            }


            onPaid?.();
            console.log('Vuelta:', change.toFixed(2));
        } catch (e) {
            console.error('Error pago en efectivo:', e);
            setLocalError(e.error || 'Error en pago en efectivo');
        } finally {
            setIsProcessing(false);
        }
    };

    const markReady = async () => {
        try {
            await updateOrder(token, order.id, {status: 'ready'});
            await loadOrder();
        } catch (e) {
            console.error(e);
        }
    };

    const markCollected = async () => {
        try {
            await updateOrder(token, order.id, {status: 'collected'});
            await loadOrder();
        } catch (e) {
            console.error(e);
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
            const totalItems = order.lines.reduce((sum, l) => sum + (l.quantity || 1), 0);
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

    if (loading) return <div>Cargando pedido...</div>;
    if (error) return <div style={{color: 'red'}}>{error}</div>;
    if (!order) return <div>Pedido no encontrado</div>;

    const clienteDisplay = () => {
        if (order.client) return `${order.client.firstName} ${order.client.lastName}`;
        return 'Cliente rápido';
    };

    const telefonoDisplay = () => {
        return order.client?.phone || null;
    };


    return (<div className={'uk-card uk-card-body  ' + 'uk-card-default'}>
        <div className={'uk-card-badge'}>{order.status}</div>
        <h3 className={'uk-card-title'}>{clienteDisplay()} {order.orderNum}</h3>
        <div className={'uk-badge uk-text-bolder'}>
            {order.fechaLimite ? new Date(order.createdAt).toLocaleDateString('es-ES') : '—'}
            <icon className="uk-icon" uk-icon="arrow-right"></icon>
            {order.fechaLimite ? new Date(order.fechaLimite).toLocaleDateString('es-ES') : '—'}
        </div>


        <div className={'uk-grid uk-child-width-1-3@l uk-margin-top'}>
            <div>

                {telefonoDisplay() && (<div>
                    <strong>Teléfono:</strong> {telefonoDisplay()}
                </div>)}
                <div>
                    <strong>Estado pago:</strong> {order.paid ? 'Pagado' : 'Pendiente de pago'}
                </div>
                <div>
                    <strong>Método de pago:</strong>{' '}
                    {order.paymentMethod ? order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta' : 'No seleccionado'}
                </div>
                <div>
                    <strong>Observaciones:</strong> {order.observaciones || '—'}
                </div>

            </div>

            <div>
                <div style={{fontWeight: 'bold'}}>Líneas:</div>
                {order.lines.map((l) => {
                    const name = l.productName || l.product?.name || `#${l.productId}`;
                    return (<div
                        key={l.id}
                        style={{
                            display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2,
                        }}
                    >
                        <div>
                            {l.quantity}x {name}
                        </div>
                        <div>{(l.unitPrice * l.quantity).toFixed(2)}€</div>
                    </div>);
                })}
                <div
                    style={{
                        marginTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 'bold',
                    }}
                >
                    <div>Total:</div>
                    <div>{order.total.toFixed(2)}€</div>
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
                    <button className={'uk-button uk-button-default uk-width-1-1@l'} uk-icon={'print'}
                            onClick={handlePrintTicket}
                            disabled={!order || isPrinting}>
                        {isPrinting ? 'Imprimiendo...' : 'Imprimir ticket'}
                    </button>

                    <button className={'uk-button uk-button-default uk-width-1-1@l'} uk-icon={'print'}
                            onClick={handlePrintLabels}
                            disabled={!order || isPrinting}>
                        {isPrinting ? 'Imprimiendo...' : 'Imprimir etiquetas'}
                    </button>


                    {order.status === 'pending' && (<button type="button"
                                                            className="uk-button uk-button-default  uk-width-1-1@l"
                                                            onClick={() => {
                                                                const confirmed = window.confirm('¿Seguro que quieres marcar el pedido como listo? Haz clic en "Aceptar" para continuar.');
                                                                if (confirmed) markReady();
                                                            }} aria-label="Marcar como listo"
                                                            uk-icon="check">Marcar como listo
                    </button>)}

                    {/* Acciones de estado */}
                    {order.status === 'ready' && (<button type="button"
                                                          className="uk-button uk-button-default uk-width-1-1@l"
                                                          onClick={() => {
                                                              const confirmed = window.confirm('¿Seguro que quieres marcar el pedido como recogido? Haz clic en "Aceptar" para continuar.');
                                                              if (confirmed) markCollected();
                                                          }} aria-label="Marcar como recogido"
                    >
                        Marcar como recogido
                    </button>)}


                    {(localError || error) && (<div style={{color: 'red', marginTop: 8}}>{localError || error}</div>)}
                </div>


            </div>

        </div>

        {Array.isArray(order.notification) && order.notification.length > 0 && (<div style={{marginTop: 16}}>
            <h6>Notificaciones:</h6>
            <ul className="uk-list uk-list-divider">
                {order.notification.map((n) => (<li key={n.id} style={{fontSize: 12, marginBottom: 6}}>
                    <strong>{n.type}</strong> — {n.status} <br/>
                    {n.content} <br/>
                    {n.createdAt && (<span style={{color: '#555'}}>
                            {new Date(n.createdAt).toLocaleString('es-ES')}
                        </span>)}
                </li>))}
            </ul>
        </div>)}


        {!order.paid && (<div className={'uk-grid uk-grid-divider'}>
            <h4 className={'uk-width-1-1 uk-margin'}>Pendiente de pago</h4>
            <div className={'uk-width-1-2@l uk-grid'}>
                <p className={'uk-text-bold uk-width-1-1'}>Pago con tarjeta</p>
                <div>
                    <button
                        onClick={handleCardPay}
                        disabled={isProcessing}
                        className={'uk-button uk-button-primary uk-margin-top'}

                    >
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
                        />
                        <small style={{textAlign: 'center', width: '100%'}}>
                            Vuelta:{' '}
                            {receivedAmount ? Math.max(0, parseFloat(receivedAmount) - order.total).toFixed(2) : '0.00'}
                            €
                        </small>
                    </label>
                    <div>
                        <button
                            onClick={handleCashPay}
                            disabled={isProcessing}
                            className={'uk-button uk-button-primary uk-margin'}>
                            {isProcessing ? 'Procesando...' : 'Pagar en efectivo'}
                        </button>
                    </div>
                </div>

            </div>
        </div>)}


    </div>)
        ;
}
