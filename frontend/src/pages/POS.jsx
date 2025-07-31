import React, { useEffect, useState } from 'react';
import {
    fetchProducts,
    fetchUsers,
    createOrder,
} from '../api.js';
import { printWashLabels, printSaleTicket } from '../utils/printUtils.js';

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

export default function POS({ token }) {
    const [products, setProducts] = useState([]);
    const [users, setUsers] = useState([]);
    const [cart, setCart] = useState([]);
    const [order, setOrder] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);
    const [searchUser, setSearchUser] = useState('');
    const [searchProduct, setSearchProduct] = useState('');
    const [error, setError] = useState('');

    // Cliente rápido
    const [quickFirstName, setQuickFirstName] = useState('');
    const [quickLastName, setQuickLastName] = useState('');
    const [quickClientPhone, setQuickClientPhone] = useState('');
    const [quickClientEmail, setQuickClientEmail] = useState('');

    // Pago
    const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' | 'card'

    useEffect(() => {
        fetchProducts(token)
            .then(setProducts)
            .catch(() => setError('No se pudieron cargar productos'));
        fetchUsers(token)
            .then(setUsers)
            .catch(() => setError('No se pudieron cargar clientes'));
    }, [token]);

    const add = (p) => {
        setCart((prev) => {
            const exists = prev.find((c) => c.productId === p.id);
            if (exists) {
                return prev.map((c) =>
                    c.productId === p.id ? { ...c, quantity: c.quantity + 1 } : c
                );
            }
            return [...prev, { productId: p.id, quantity: 1 }];
        });
    };

    const checkout = async () => {
        if (!cart.length) {
            setError('El carrito está vacío');
            return;
        }

        if (!selectedUser && (!quickFirstName || !quickLastName)) {
            setError('Nombre y apellidos del cliente rápido son obligatorios');
            return;
        }

        const phone = selectedUser ? selectedUser.phone : quickClientPhone;
        if (!phone || !isValidSpanishPhone(phone)) {
            setError('Teléfono válido obligatorio (ej: 600123456)');
            return;
        }

        setError('');

        const linesPayload = cart.map((c) => ({
            productId: c.productId,
            quantity: c.quantity,
        }));

        const payload = {
            paid: true,
            paymentMethod,
            lines: linesPayload,
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
            setCart([]);
            fetchUsers(token).then(setUsers).catch(() => {});
            setSelectedUser(null);
            setQuickFirstName('');
            setQuickLastName('');
            setQuickClientPhone('');
            setQuickClientEmail('');
        } catch (err) {
            setError(err.error || 'Error al crear pedido');
        }
    };

    const handlePrintTicket = () => {
        if (!order) return;
        printSaleTicket(order, products); // le pasas products para fallback
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

    const filteredUsers = users.filter((u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchUser.toLowerCase())
    );
    const filteredProducts = products.filter((p) =>
        p.name.toLowerCase().includes(searchProduct.toLowerCase())
    );
    const total = cart.reduce((sum, c) => {
        const p = products.find((prod) => prod.id === c.productId);
        return sum + (p?.basePrice || 0) * c.quantity;
    }, 0);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
            {/* Izquierda: cliente + ticket + acciones */}
            <div>
                <h2>Clientes</h2>
                <div style={{ display: 'flex', gap: 12 }}>
                    {/* Cliente existente */}
                    <div style={{ flex: 1 }}>
                        <label>Buscar cliente existente</label>
                        <input
                            placeholder="Buscar cliente..."
                            value={searchUser}
                            onChange={(e) => setSearchUser(e.target.value)}
                            style={{ width: '100%' }}
                        />
                        <div
                            style={{
                                maxHeight: 180,
                                overflowY: 'auto',
                                marginTop: 6,
                                border: '1px solid #ccc',
                                borderRadius: 4,
                            }}
                        >
                            {filteredUsers.map((u) => (
                                <div
                                    key={u.id}
                                    onClick={() => {
                                        setSelectedUser(u);
                                        setQuickFirstName('');
                                        setQuickLastName('');
                                        setQuickClientPhone('');
                                        setQuickClientEmail('');
                                    }}
                                    style={{
                                        padding: 6,
                                        cursor: 'pointer',
                                        background: selectedUser?.id === u.id ? '#e0e0e0' : '#fff',
                                    }}
                                >
                                    {u.firstName} {u.lastName} ({u.role})
                                    <div style={{ fontSize: 12, color: '#555' }}>
                                        {u.phone}
                                    </div>
                                </div>
                            ))}
                            {filteredUsers.length === 0 && (
                                <div style={{ padding: 6, color: '#888' }}>Ningún cliente encontrado</div>
                            )}
                        </div>
                    </div>

                    {/* Cliente rápido */}
                    <div style={{ flex: 1 }}>
                        <label>O crear cliente rápido</label>
                        <div style={{ display: 'grid', gap: 6 }}>
                            <input
                                placeholder="Nombre"
                                value={quickFirstName}
                                onChange={(e) => {
                                    setQuickFirstName(e.target.value);
                                    setSelectedUser(null);
                                }}
                            />
                            <input
                                placeholder="Apellidos"
                                value={quickLastName}
                                onChange={(e) => {
                                    setQuickLastName(e.target.value);
                                    setSelectedUser(null);
                                }}
                            />
                            <input
                                placeholder="Teléfono (obligatorio)"
                                value={quickClientPhone}
                                onChange={(e) => setQuickClientPhone(e.target.value)}
                            />
                            <input
                                placeholder="Email (opcional)"
                                value={quickClientEmail}
                                onChange={(e) => setQuickClientEmail(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Ticket / pago */}
                <div style={{ marginTop: 30, borderTop: '1px solid #ccc', paddingTop: 20 }}>
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
                        <div style={{ color: '#888' }}>Seleccione o cree un cliente</div>
                    )}

                    <div style={{ marginTop: 10 }}>
                        <label>Método de pago:</label>
                        <div>
                            <label style={{ marginRight: 10 }}>
                                <input
                                    type="radio"
                                    name="payment"
                                    value="cash"
                                    checked={paymentMethod === 'cash'}
                                    onChange={() => setPaymentMethod('cash')}
                                />{' '}
                                Efectivo
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    name="payment"
                                    value="card"
                                    checked={paymentMethod === 'card'}
                                    onChange={() => setPaymentMethod('card')}
                                />{' '}
                                Tarjeta
                            </label>
                        </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                        <div>
                            {cart.map((c, i) => {
                                const p = products.find((prod) => prod.id === c.productId);
                                return (
                                    <div key={i}>
                                        {p?.name} x{c.quantity} — {((p?.basePrice || 0) * c.quantity).toFixed(2)} €
                                    </div>
                                );
                            })}
                        </div>
                        <h3 style={{ marginTop: 10 }}>Total: {total.toFixed(2)} €</h3>
                        <button
                            onClick={checkout}
                            disabled={
                                !cart.length ||
                                (!selectedUser && (!quickFirstName || !quickLastName)) ||
                                !isValidSpanishPhone(selectedUser ? selectedUser.phone : quickClientPhone)
                            }
                            style={{ marginTop: 10 }}
                        >
                            Cobrar
                        </button>
                        {error && <div style={{ color: 'red', marginTop: 10 }}>{error}</div>}

                        {order && (
                            <div style={{ marginTop: 16, border: '1px solid #ccc', padding: 12, borderRadius: 6, background: '#f9f9f9' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Último pedido: {order.orderNum}</div>
                                        <div>
                                            <strong>Cliente:</strong>{' '}
                                            {order.client
                                                ? `${order.client.firstName} ${order.client.lastName}`
                                                : 'Cliente rápido'}
                                        </div>
                                        {order.client?.phone && (
                                            <div>
                                                <strong>Teléfono:</strong> {order.client.phone}
                                            </div>
                                        )}
                                        <div>
                                            <strong>Pago:</strong>{' '}
                                            {order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}
                                        </div>
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontWeight: 'bold' }}>Líneas:</div>
                                            {order.lines.map((l) => {
                                                // fallback buscando nombre en lista de productos si no viene en la línea
                                                let name = l.productName;
                                                if (!name) {
                                                    const prod = products.find((p) => p.id === l.productId);
                                                    name = prod ? prod.name : `#${l.productId}`;
                                                }
                                                return (
                                                    <div
                                                        key={l.id || `${l.productId}-${Math.random()}`}
                                                        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
                                                    >
                                                        <div>
                                                            {l.quantity}x {name}
                                                        </div>
                                                        <div>{(l.unitPrice * l.quantity).toFixed(2)}€</div>
                                                    </div>
                                                );
                                            })}

                                        </div>
                                        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                                            <div style={{ fontWeight: 'bold' }}>Total:</div>
                                            <div style={{ fontWeight: 'bold' }}>{order.total.toFixed(2)}€</div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <button onClick={handlePrintTicket}>Imprimir ticket</button>
                                        <button onClick={handlePrintLabels}>Imprimir etiquetas lavado</button>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {/* Derecha: productos */}
            <div>
                <h2>Productos</h2>
                <input
                    placeholder="Buscar producto..."
                    value={searchProduct}
                    onChange={(e) => setSearchProduct(e.target.value)}
                />
                <div style={{ marginTop: 10 }}>
                    {filteredProducts.map((p) => (
                        <div
                            key={p.id}
                            style={{
                                border: '1px solid #ddd',
                                padding: 8,
                                marginBottom: 6,
                                borderRadius: 4,
                            }}
                        >
                            <div>{p.name}</div>
                            <div>{p.basePrice.toFixed(2)} €</div>
                            <button onClick={() => add(p)}>Añadir</button>
                        </div>
                    ))}
                    {filteredProducts.length === 0 && (
                        <div style={{ color: '#888' }}>No hay productos.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
