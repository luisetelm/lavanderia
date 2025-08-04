import React, {useEffect, useState} from 'react';
import {
    fetchProducts,
    fetchUsers,
    createOrder,
    payWithCard,
    payWithCash,
    fetchOrder
} from '../api.js';
import {printWashLabels, printSaleTicket} from '../utils/printUtils.js';
import CustomerSelector from '../components/CustomerSelector.jsx';
import ProductList from '../components/ProductList.jsx';
import CartSummary from '../components/CartSummary.jsx';
import DateCarousel from '../components/DateCarousel.jsx';
import PaymentSection from '../components/PaymentSection.jsx';
import CashModal from '../components/CashModal.jsx';

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

export default function POS({token}) {
    const [products, setProducts] = useState([]);
    const [users, setUsers] = useState([]);
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

    useEffect(() => {
        fetchProducts(token).then(setProducts).catch(() => setError('No se pudieron cargar productos'));
        fetchUsers(token).then(setUsers).catch(() => setError('No se pudieron cargar clientes'));
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
                        headers: { Authorization: `Bearer ${token}` },
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

    const handleValidate = async ({submit, observaciones: obs}) => {
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
        } catch (err) {
            setError(err.error || 'Error al crear pedido');
        }
    };

    const [isPaying, setIsPaying] = useState(false);

    const handleCardPay = async () => {
        if (!order) return;
        setIsPaying(true);
        try {
            const { order: updated } = await payWithCard(token, order.id);
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
        if (isNaN(received) || received < order.total) return;
        try {
            const data = await payWithCash(token, order.id, receivedAmount);
            setOrder(data.order || data);
            const vuelta = data.change; // si el backend la incluye
            console.log('Vuelta:', vuelta);
        } catch (e) {
            setError('Error en pago efectivo');
        }

    };

    const total = cart.reduce((sum, c) => {
        const p = products.find((prod) => prod.id === c.productId);
        return sum + (p?.basePrice || 0) * c.quantity;
    }, 0);

    const handlePrintTicket = () => {
        if (!order) return;
        printSaleTicket(order, products);
    };

    const handlePrintLabels = () => {
        if (!order) return;
        const totalItems = order.lines.reduce((sum, l) => sum + (l.quantity || 1), 0);
        printWashLabels({
            orderNum: order.orderNum,
            clientFirstName: order.client?.firstName || '',
            clientLastName: order.client?.lastName || '',
            totalItems,
        });
    };

    return (
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30}}>
            <div>
                <h2>Clientes</h2>
                <CustomerSelector
                    users={users}
                    searchUser={searchUser}
                    setSearchUser={setSearchUser}
                    selectedUser={selectedUser}
                    setSelectedUser={setSelectedUser}
                    quickFirstName={quickFirstName}
                    quickLastName={quickLastName}
                    quickClientPhone={quickClientPhone}
                    quickClientEmail={quickClientEmail}
                    setQuickFirstName={setQuickFirstName}
                    setQuickLastName={setQuickLastName}
                    setQuickClientPhone={setQuickClientPhone}
                    setQuickClientEmail={setQuickClientEmail}
                />

                <div style={{marginTop: 12, display: 'flex', gap: 16, alignItems: 'flex-start'}}>
                    {/* Carrusel existente */}
                    <div style={{flex: 2}}>
                        <DateCarousel
                            loadByDay={loadByDay}
                            fechaLimite={fechaLimite}
                            setFechaLimite={setFechaLimite}
                        />
                    </div>
                </div>

                <div>
                    {/* Fecha libre */}
                    <div style={{flex: 1, minWidth: 180}}>
                        <label>O elegir otra fecha</label>
                        <input
                            type="date"
                            value={fechaLimite || ''}
                            onChange={(e) => {
                                const picked = e.target.value; // formato YYYY-MM-DD
                                setFechaLimite(picked);
                            }}
                            style={{width: '100%', padding: 6}}
                            min={new Date().toISOString().split('T')[0]} // opcional: no permitir pasado
                        />
                        <div style={{fontSize: 12, marginTop: 4}}>
                            {fechaLimite
                                ? `Entrega: ${new Date(fechaLimite).toLocaleDateString('es-ES', {
                                    weekday: 'long',
                                    day: 'numeric',
                                    month: 'long',
                                })}`
                                : 'Se propondrá una fecha por defecto'}
                        </div>
                    </div>


                    <div style={{marginTop: 12}}>
                        <label>Observaciones:</label>
                        <textarea
                            placeholder="Prenda en mal estado, petición especial..."
                            value={observaciones}
                            onChange={(e) => setObservaciones(e.target.value)}
                            style={{width: '100%', minHeight: 60}}
                        />
                    </div>

                    <div style={{marginTop: 10}}>
                        <h2>Ticket</h2>
                        {selectedUser ? (
                            <div>
                                Cliente: {selectedUser.firstName} {selectedUser.lastName} - {selectedUser.phone}
                            </div>
                        ) : quickFirstName ? (
                            <div>
                                Cliente rápido: {quickFirstName} {quickLastName} - {quickClientPhone}
                            </div>
                        ) : (
                            <div style={{color: '#888'}}>Seleccione o cree un cliente</div>
                        )}


                        <PaymentSection
                            cart={cart}
                            products={products}
                            order={order}
                            error={error}
                            paymentMethod={paymentMethod}
                            setPaymentMethod={setPaymentMethod}
                            handleValidate={handleValidate}
                            handlePrintTicket={handlePrintTicket}
                            handlePrintLabels={handlePrintLabels}
                            isValidated={isValidated}
                            selectedUser={selectedUser}
                            quickFirstName={quickFirstName}
                            quickLastName={quickLastName}
                            quickClientPhone={quickClientPhone}
                            isValidSpanishPhone={isValidSpanishPhone}
                            onCashStart={() => {
                                setReceivedAmount(''); // reset
                                setShowCashModal(true);
                                setPaymentMethod('cash');
                            }}
                            onCardPay={handleCardPay}
                        />

                    </div>
                </div>
            </div>

            <div>
                <ProductList
                    products={products}
                    searchProduct={searchProduct}
                    setSearchProduct={setSearchProduct}
                    onAdd={add}
                />
            </div>

            {showCashModal && order && (
                <CashModal
                    order={order}
                    receivedAmount={receivedAmount}
                    setReceivedAmount={setReceivedAmount}
                    change={parseFloat(receivedAmount || 0) - order.total}
                    onConfirm={handleCashConfirm}
                    onClose={() => setShowCashModal(false)}
                />
            )}


        </div>
    )
        ;
}
