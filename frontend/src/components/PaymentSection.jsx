import React, {useState, useEffect, useCallback} from 'react';
import {fetchOrder, payWithCard, payWithCash, updateOrder} from '../api.js';
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
        const confirmed = window.prompt(
            `Confirmar pago con tarjeta por ${order.total.toFixed(2)} €. Escribe "OK" para continuar.`
        );
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
            const {order: updatedOrder, change} = await payWithCash(
                token,
                order.id,
                received
            );
            setOrder(updatedOrder);
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
        console.log(order)
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

    console.log(order);

    const clienteDisplay = () => {
        if (order.client) return `${order.client.firstName} ${order.client.lastName}`;
        return 'Cliente rápido';
    };

    const telefonoDisplay = () => {
        return order.client?.phone || null;
    };


    return (
        <div className={'uk-card uk-card-body  ' +
            'uk-card-default'} >
            <div className={'uk-card-badge'}>{order.status}</div>
            <h3 className={'uk-card-title'}>{clienteDisplay()} {order.orderNum}</h3>
            <div className={'uk-badge uk-text-bolder'}>
                {order.fechaLimite
                    ? new Date(order.createdAt).toLocaleDateString('es-ES')
                    : '—'} <icon className="uk-icon" uk-icon="arrow-right"></icon>
                {order.fechaLimite
                    ? new Date(order.fechaLimite).toLocaleDateString('es-ES')
                    : '—'}
            </div>


            <div className={'uk-grid uk-child-width-1-3@l uk-margin-top'}>
                <div>

                    {telefonoDisplay() && (
                        <div>
                            <strong>Teléfono:</strong> {telefonoDisplay()}
                        </div>
                    )}
                    <div>
                        <strong>Estado pago:</strong> {order.paid ? 'Pagado' : 'Pendiente de pago'}
                    </div>
                    <div>
                        <strong>Método de pago:</strong>{' '}
                        {order.paymentMethod
                            ? order.paymentMethod === 'cash'
                                ? 'Efectivo'
                                : 'Tarjeta'
                            : 'No seleccionado'}
                    </div>
                    <div>
                        <strong>Observaciones:</strong> {order.observaciones || '—'}
                    </div>

                </div>

                <div>
                    <div style={{fontWeight: 'bold'}}>Líneas:</div>
                    {order.lines.map((l) => {
                        const name = l.productName || l.product?.name || `#${l.productId}`;
                        return (
                            <div
                                key={l.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: 12,
                                    marginTop: 2,
                                }}
                            >
                                <div>
                                    {l.quantity}x {name}
                                </div>
                                <div>{(l.unitPrice * l.quantity).toFixed(2)}€</div>
                            </div>
                        );
                    })}
                    <div
                        style={{
                            marginTop: 10,
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontWeight: 'bold',
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
                        <button onClick={handlePrintTicket} style={{width: '100%'}} disabled={!order || isPrinting}>
                            {isPrinting ? 'Imprimiendo...' : 'Imprimir ticket'}
                        </button>
                        <button onClick={handlePrintLabels} style={{width: '100%'}} disabled={!order || isPrinting}>
                            {isPrinting ? 'Imprimiendo...' : 'Imprimir etiquetas'}
                        </button>


                        {order.status === 'pending' && (
                            <button type="button"
                                    className="uk-button uk-button-default"
                                    onClick={markReady}
                                    aria-label="Marcar como listo"
                                    uk-icon="check">Marcar como listo
                            </button>
                        )}

                        {/* Acciones de estado */}
                        {order.status === 'ready' && (
                            <div className="uk-margin-small-top">
                                <button type="button"
                                        className="uk-button uk-button-default"
                                        onClick={markCollected}
                                        aria-label="Marcar como recogido"
                                >
                                    Marcar como recogido
                                </button>
                            </div>
                        )}


                        {(localError || error) && (
                            <div style={{color: 'red', marginTop: 8}}>{localError || error}</div>
                        )} {(localError || error) && (
                        <div style={{color: 'red', marginTop: 8}}>{localError || error}</div>
                    )}
                    </div>


                </div>

            </div>




            {!order.paid && (
                <div
                    style={{
                        marginTop: 16,
                        borderTop: '1px solid #ddd',
                        paddingTop: 12,
                        display: 'flex',
                        gap: 36,
                        flexWrap: 'wrap',
                    }}
                >
                    <div style={{flex: 2, minWidth: 250}}>
                        <h3>Pago con tarjeta</h3>
                        <button
                            onClick={handleCardPay}
                            disabled={isProcessing}
                            style={{
                                padding: '8px 16px',
                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                width: '100%',
                            }}
                        >
                            {isProcessing ? 'Procesando...' : 'Pagar con tarjeta'}
                        </button>
                    </div>
                    <div style={{
                        flex: 2,
                        minWidth: 250,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        height: '100%'
                    }}>
                        <h3>Pago en efectivo</h3>
                        <div style={{marginBottom: 6}}>
                            <label>
                                <input
                                    type="number"
                                    value={receivedAmount}
                                    onChange={(e) => setReceivedAmount(e.target.value)}
                                    disabled={isProcessing}
                                    style={{width: '100%', paddingLeft: 0, paddingRight: 0}}
                                    placeholder="€"
                                />
                            </label>
                        </div>
                        <div>
                            <small style={{textAlign: 'center', width: '100%'}}>
                                Vuelta:{' '}
                                {receivedAmount
                                    ? Math.max(0, parseFloat(receivedAmount) - order.total).toFixed(2)
                                    : '0.00'}
                                €
                            </small>
                        </div>
                        <div style={{marginBottom: 6}}>
                            <button
                                onClick={handleCashPay}
                                disabled={isProcessing}
                                style={{
                                    padding: '8px 16px',
                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                    width: '100%',
                                }}
                            >
                                {isProcessing ? 'Procesando...' : 'Pagar en efectivo'}
                            </button>
                        </div>

                    </div>
                    <div style={{flex: 10}}></div>
                </div>
            )}


        </div>
    );
}
