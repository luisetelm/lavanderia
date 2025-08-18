import React, {useEffect, useState} from 'react';
import {useNavigate} from "react-router-dom";
import {
    fetchProducts,
    createOrder,
    payWithCard,
    payWithCash,
    fetchOrder,
} from '../api.js';
import {printWashLabels, printSaleTicket} from '../utils/printUtils.js';
import CustomerSelector from '../components/CustomerSelector.jsx';
import ProductList from '../components/ProductList.jsx';
import DateCarousel from '../components/DateCarousel.jsx';
import PaymentSection from '../components/PaymentSection.jsx';
import CashModal from '../components/CashModal.jsx';
import CartSummary from "../components/CartSummary.jsx";

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

export default function POS({token}) {
    const navigate = useNavigate();
    const [products, setProducts] = useState([]);
    const [cart, setCart] = useState([]);
    const [order, setOrder] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);
    const [searchUser, setSearchUser] = useState('');
    const [searchProduct, setSearchProduct] = useState('');
    const [error, setError] = useState('');
    const [quickFirstName, setQuickFirstName] = useState('');
    const [quickLastName, setQuickLastName] = useState('');
    const [quickClientPhone, setQuickClientPhone] = useState('');
    const [quickClientEmail, setQuickClientEmail] = useState('');

    // nuevas
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [observaciones, setObservaciones] = useState('');
    const [fechaLimite, setFechaLimite] = useState(null);
    const [showCashModal, setShowCashModal] = useState(false);
    const [receivedAmount, setReceivedAmount] = useState('');
    const [isValidated, setIsValidated] = useState(false);
    const [loadByDay, setLoadByDay] = useState({});
    const [showTicketSection, setShowTicketSection] = useState(true);
    const [isPaying, setIsPaying] = useState(false);

    console.log(fechaLimite)

    // Estado para forzar la recarga del DateCarousel
    const [dateCarouselKey, setDateCarouselKey] = useState(0);

    useEffect(() => {
        fetchProducts(token).then(setProducts).catch(() => setError('No se pudieron cargar productos'));
    }, [token]);

    // carga por día
    useEffect(() => {
        const fetchLoads = async () => {
            try {
                const getNextBusinessDays = (count = 12) => {
                    const days = [];
                    let cursor = new Date();
                    while (days.length < count) {
                        cursor = new Date(cursor);
                        cursor.setDate(cursor.getDate() + 1);
                        const wd = cursor.getDay();
                        if (wd !== 0 && wd !== 6) days.push(new Date(cursor));
                    }
                    return days;
                };
                const formatKey = (d) => d.toISOString().split('T')[0];

                const days = getNextBusinessDays(12);
                if (days.length === 0) return;

                const from = formatKey(days[0]);
                const to = formatKey(days[days.length - 1]);

                const res = await fetch(
                    `/api/orders?fechaLimite_gte=${from}&fechaLimite_lte=${to}`,
                    {
                        headers: {Authorization: `Bearer ${token}`},
                    }
                );

                if (!res.ok) {
                    console.error('Error cargando órdenes de carga:', await res.text());
                    return;
                }

                const orders = await res.json();
                if (!Array.isArray(orders)) {
                    console.warn('Respuesta inesperada de /api/orders:', orders);
                    return;
                }

                const grouped = {};
                days.forEach((d) => {
                    grouped[formatKey(d)] = [];
                });

                orders.forEach((o) => {
                    if (o.fechaLimite) {
                        const key = o.fechaLimite.split('T')[0];
                        if (grouped[key]) grouped[key].push(o);
                    }
                });

                setLoadByDay(grouped);
            } catch (e) {
                console.error('fetchLoads falló:', e);
            }
        };

        fetchLoads();
    }, [token, isValidated, order]);

    // Cuando se valida un pedido, oculta la sección de ticket
    useEffect(() => {
        if (isValidated) {
            setShowTicketSection(false);
        }
    }, [isValidated]);

    const add = (p) => {
        setCart((prev) => {
            const exists = prev.find((c) => c.productId === p.id);
            if (exists) {
                return prev.map((c) =>
                    c.productId === p.id ? {...c, quantity: c.quantity + 1} : c
                );
            }
            return [...prev, {productId: p.id, quantity: 1}];
        });
    };

    const handleValidate = async ({submit, observaciones: obs} = {}) => {
        if (obs !== undefined) {
            setObservaciones(obs);
            return;
        }
        if (!cart.length) {
            setError('El carrito está vacío');
            return;
        }
        if (!selectedUser && (!quickFirstName || !quickLastName)) {
            setError('Nombre y apellidos obligatorios');
            return;
        }
        const phone = selectedUser ? selectedUser.phone : quickClientPhone;
        if (!phone || !isValidSpanishPhone(phone)) {
            setError('Teléfono válido obligatorio');
            return;
        }
        setError('');
        const linesPayload = cart.map((c) => ({
            productId: c.productId,
            quantity: c.quantity,
        }));
        const payload = {
            lines: linesPayload,
            observaciones,
            fechaLimite: fechaLimite || undefined,
        };
        if (selectedUser) {
            payload.clientId = selectedUser.id;
        } else {
            payload.clientFirstName = quickFirstName;
            payload.clientLastName = quickLastName;
            payload.clientPhone = quickClientPhone;
            if (quickClientEmail) payload.clientEmail = quickClientEmail;
        }

        try {
            const o = await createOrder(token, payload);
            setOrder(o);
            setIsValidated(true);
            navigate('/tareas', {
                state: {
                    filterOrderId: o.id,
                    orderNumber: o.orderNum || o.id
                }
            });
        } catch (err) {
            setError(err.error || 'Error al crear pedido');
        }
    };

    const handleCardPay = async () => {
        if (!order) return;
        setIsPaying(true);
        try {
            const {order: updated} = await payWithCard(token, order.id);
            setOrder(updated);
        } catch (e) {
            setError(e.error || 'Error en pago con tarjeta');
        } finally {
            setIsPaying(false);
        }
    };

    const handleCashStart = () => {
        setReceivedAmount('');
        setShowCashModal(true);
    };

    const handleCashConfirm = async () => {
        if (!order) return;
        const received = parseFloat(receivedAmount);
        if (isNaN(received) || received < order.total) {
            setError('Cantidad recibida insuficiente');
            return;
        }
        setIsPaying(true);
        try {
            const data = await payWithCash(token, order.id, receivedAmount);
            setOrder(data.order || data);
            const vuelta = data.change; // si el backend la incluye
            console.log('Vuelta:', vuelta);
            setShowCashModal(false);
        } catch (e) {
            setError('Error en pago efectivo');
        } finally {
            setIsPaying(false);
        }
    };

    const total = cart.reduce((sum, c) => {
        const p = products.find((prod) => prod.id === c.productId);
        return sum + (p?.basePrice || 0) * c.quantity;
    }, 0);

    const updateQuantity = (productId, newQuantity) => {
        setCart(prev => {
            if (newQuantity <= 0) {
                return prev.filter(item => item.productId !== productId);
            }
            return prev.map(item =>
                item.productId === productId
                    ? {...item, quantity: newQuantity}
                    : item
            );
        });
    };

    const removeFromCart = (productId) => {
        setCart(prev => prev.filter(item => item.productId !== productId));
    };

    const handleNewOrder = () => {
        // Reiniciar el estado para un nuevo pedido
        setCart([]);
        setOrder(null);
        setSelectedUser(null);
        setSearchUser('');
        setQuickFirstName('');
        setQuickLastName('');
        setQuickClientPhone('');
        setQuickClientEmail('');
        setObservaciones('');
        setFechaLimite(null); // Esto permitirá que DateCarousel establezca la fecha sugerida
        setError('');
        setIsValidated(false);
        setShowTicketSection(true);
        // Forzar recarga del DateCarousel
        setDateCarouselKey(prev => prev + 1);
    };

    return (
        <div>
            <div className="section-header">
                <h2>Punto de Venta</h2>
                {isValidated && (
                    <button
                        className="uk-button uk-button-primary"
                        onClick={handleNewOrder}
                    >
                        <span uk-icon="plus"></span> Nuevo pedido
                    </button>
                )}
            </div>

            <div className="section-content">
                <div className="uk-grid-large" uk-grid="true">
                    <div className="uk-width-1-2@m">
                        <div className="uk-card uk-card-default uk-card-body">
                            <CustomerSelector
                                searchUser={searchUser}
                                setSearchUser={setSearchUser}
                                selectedUser={selectedUser}
                                setSelectedUser={setSelectedUser}
                                quickFirstName={quickFirstName}
                                setQuickFirstName={setQuickFirstName}
                                quickLastName={quickLastName}
                                setQuickLastName={setQuickLastName}
                                quickClientPhone={quickClientPhone}
                                setQuickClientPhone={setQuickClientPhone}
                                quickClientEmail={quickClientEmail}
                                setQuickClientEmail={setQuickClientEmail}
                                token={token}
                            />

                            <div className="uk-margin" uk-grid="true">
                                <div className="uk-width-1-1">
                                    <DateCarousel
                                        key={dateCarouselKey}
                                        fechaLimite={fechaLimite}
                                        setFechaLimite={setFechaLimite}
                                        token={token}
                                    />
                                </div>
                            </div>

                            <div className="uk-margin">
                                <h4 className="uk-margin-small-bottom">Observaciones</h4>
                                <div className="uk-form-controls">
                                    <textarea
                                        className="uk-textarea"
                                        rows="3"
                                        placeholder="Prenda en mal estado, petición especial..."
                                        value={observaciones}
                                        onChange={(e) => setObservaciones(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Mostrar Ticket solo si showTicketSection es true o si no hay pedido validado */}
                            {(showTicketSection || !isValidated) && (
                                <div className="uk-margin">
                                    <h3 className="uk-heading-divider">Productos añadidos</h3>

                                    {!order && (
                                        <div className="uk-margin">
                                            <CartSummary
                                                cart={cart}
                                                products={products}
                                                onUpdateQuantity={updateQuantity}
                                                onRemove={removeFromCart}
                                            />
                                            <div className="uk-margin">
                                                <button
                                                    className="uk-button uk-button-primary uk-width-1-1"
                                                    onClick={() => handleValidate({submit: true})}
                                                    disabled={!cart.length}
                                                >
                                                    {order ? 'Revalidar pedido' : 'Validar pedido'}
                                                </button>
                                            </div>
                                            {error && (
                                                <div className="uk-alert-danger uk-margin-small" uk-alert="true">
                                                    <p>{error}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {order && (
                                <div className="uk-margin">
                                    <div
                                        className="uk-card uk-card-default uk-card-body uk-padding-small uk-margin-bottom">
                                        <h3 className="uk-card-title">Pedido #{order.orderNum || order.id}</h3>
                                        <div className="uk-label uk-label-success uk-margin-small-right">Validado</div>
                                        <span className="uk-text-muted">Total: {order.total.toFixed(2)} €</span>
                                    </div>

                                    <PaymentSection
                                        token={token}
                                        orderId={order.id}
                                        onPaid={async () => {
                                            try {
                                                const updated = await fetchOrder(token, order.id);
                                                setOrder(updated);
                                            } catch (e) {
                                                console.error('Error refrescando pedido tras pago:', e);
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="uk-width-1-2@m">
                        <div className="uk-card uk-card-default uk-card-body">
                            <ProductList
                                products={products}
                                searchProduct={searchProduct}
                                setSearchProduct={setSearchProduct}
                                onAdd={add}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {showCashModal && order && (
                <CashModal
                    order={order}
                    receivedAmount={receivedAmount}
                    setReceivedAmount={setReceivedAmount}
                    change={parseFloat(receivedAmount || 0) - (order?.total || 0)}
                    onConfirm={handleCashConfirm}
                    onClose={() => setShowCashModal(false)}
                />
            )}
        </div>
    );
}
