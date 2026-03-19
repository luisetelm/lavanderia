import React, {useEffect, useMemo, useState} from 'react';
import {useNavigate} from "react-router-dom";
import {
    fetchProducts,
    createOrder,
    payWithCard,
    payWithCash,
    fetchOrder,
    fetchUsers,
    updateUser,
    // Caja API:
    fetchUnclosedCashMovements,
    fetchLastClosure,
    createCashMovement,
    updateCashMovement,
    deleteCashMovement,
    closeCashRegister,
} from '../api.js';
import {
    printCashMovementTicket, printCashClosureTicket
} from '../utils/printUtils.js';
import CustomerSelector from '../components/CustomerSelector.jsx';
import ProductList from '../components/ProductList.jsx';
import DateCarousel from '../components/DateCarousel.jsx';
import PaymentSection from '../components/PaymentSection.jsx';
import CartSummary from "../components/CartSummary.jsx";
import PageToolbar from '../components/PageToolbar.jsx';
import CashMovementModal from '../components/pos/CashMovementModal.jsx';
import CashCloseModal from '../components/pos/CashCloseModal.jsx';
import CashMovementsPanel from '../components/pos/CashMovementsPanel.jsx';
import UserSelectorModal from '../components/pos/UserSelectorModal.jsx';

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

// Helpers de caja
const typeLabel = {
    sale_cash_in: 'Venta (efectivo)',
    withdrawal: 'Retirada',
    deposit: 'Ingreso',
    refund_cash_out: 'Devolución (efectivo)',
    opening: 'Apertura',
    correction: 'Corrección',
};
const signed = (t, a) => (['withdrawal', 'refund_cash_out'].includes(t) ? -Math.abs(a) : Math.abs(a));


export default function POS({token, user}) {
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
    const [observaciones, setObservaciones] = useState('');
    const [fechaLimite, setFechaLimite] = useState(null);
    const [isValidated, setIsValidated] = useState(false);
    const [showTicketSection, setShowTicketSection] = useState(true);

    // Preferencia de notificación: se muestra si el cliente no tiene canal elegido
    const [showNotifyPrompt, setShowNotifyPrompt] = useState(false);
    const [pendingPayload, setPendingPayload] = useState(null);

    // Estado para forzar la recarga del DateCarousel
    const [dateCarouselKey, setDateCarouselKey] = useState(0);

    // Caja: estado UI
    const [showMovementModal, setShowMovementModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showMovesCanvas, setShowMovesCanvas] = useState(false);

    // Caja: datos
    const [cashErr, setCashErr] = useState('');
    const [unclosedMoves, setUnclosedMoves] = useState([]);
    const [lastClosure, setLastClosure] = useState(null);

    // Form movimiento manual
    const [movementForm, setMovementForm] = useState({
        type: 'deposit', // 'deposit' (entrada) | 'withdrawal' (salida)
        concept: '', note: '', person: '', amount: '', personUserId: null,
    });

    // Editar movimiento en offcanvas
    const [editingId, setEditingId] = useState(null);
    const [editingForm, setEditingForm] = useState({type: 'deposit', amount: '', note: '', person: ''});

    // Cierre
    const [closeNotes, setCloseNotes] = useState('');
    const [countedAmount, setCountedAmount] = useState('');

    // Carga de catálogo
    useEffect(() => {
        fetchProducts(token).then(setProducts).catch(() => setError('No se pudieron cargar productos'));
    }, [token]);

    // Cargar trabajos / carga por día (sin cambios)
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

                const res = await fetch(`/api/orders?fechaLimite_gte=${from}&fechaLimite_lte=${to}`, {
                    headers: {Authorization: `Bearer ${token}`},
                });

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

    // Cargar contexto de caja
    const loadCash = async () => {
        setCashErr('');
        try {
            const [moves, lc] = await Promise.all([fetchUnclosedCashMovements(token), fetchLastClosure(token),]);
            setUnclosedMoves(moves || []);
            setLastClosure(lc || null);
        } catch (e) {
            setCashErr(e.message || 'Error cargando caja');
        }
    };

    // Cálculos de caja
    //const openingAmount = useMemo(() => Number(lastClosure?.counted_amount || 0), [lastClosure]);
    const openingAmount = useMemo(() => {
        if (!lastClosure) return 0;
        // Accedemos al valor contado en el último cierre, que será la apertura para el actual
        return Number(lastClosure.countedamount || lastClosure.countedAmount || 0);
    }, [lastClosure]);
    const sumMoves = useMemo(() => (unclosedMoves || []).reduce((acc, m) => acc + signed(m.type, Number(m.amount)), 0), [unclosedMoves]);
    const expectedAmount = useMemo(() => Number((openingAmount + sumMoves).toFixed(2)), [openingAmount, sumMoves]);
    const diffAmount = useMemo(() => {
        const counted = Number(countedAmount || 0);
        return Number((counted - expectedAmount).toFixed(2));
    }, [countedAmount, expectedAmount]);

    // POS existente...
    const add = (p) => {
        setCart((prev) => {
            const exists = prev.find((c) => c.productId === p.id);
            if (exists) {
                return prev.map((c) => c.productId === p.id ? {...c, quantity: c.quantity + 1} : c);
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

        const linesPayload = cart.map((c) => {
            const product = products.find(p => p.id === c.productId);
            const isBigClient = selectedUser?.isbigclient;
            const discount = typeof selectedUser?.discount === 'number' ? selectedUser.discount : Number(selectedUser?.discount || 0);
            const appliedPrice = getPriceForClient(product, isBigClient, discount);

            return {
                productId: c.productId,
                quantity: c.quantity,
                unitPrice: appliedPrice
            };
        });


        const payload = {
            lines: linesPayload, observaciones, fechaLimite: fechaLimite || undefined,
        };


        if (selectedUser) {
            payload.clientId = selectedUser.id;

        } else {
            payload.clientFirstName = quickFirstName;
            payload.clientLastName = quickLastName;
            payload.clientPhone = quickClientPhone;
            if (quickClientEmail) payload.clientEmail = quickClientEmail;
        }

        payload.workerId = user.id;

        // Si el cliente seleccionado no tiene preferencia de notificación, preguntar
        if (selectedUser && !selectedUser.notifyChannel) {
            setPendingPayload(payload);
            setShowNotifyPrompt(true);
            return;
        }

        await submitOrder(payload);
    };

    const submitOrder = async (payload) => {
        try {
            const o = await createOrder(token, payload);
            setOrder(o);
            setIsValidated(true);
            navigate('/tareas', {
                state: {
                    filterOrderId: o.id, orderNumber: o.orderNum || o.id
                }
            });
        } catch (err) {
            setError(err.error || 'Error al crear pedido');
        }
    };

    const handleNotifyChoice = async (channel) => {
        setShowNotifyPrompt(false);
        // Guardar preferencia del cliente
        if (selectedUser) {
            try {
                await updateUser(token, selectedUser.id, { notifyChannel: channel });
                setSelectedUser(prev => ({ ...prev, notifyChannel: channel }));
            } catch (err) {
                console.error('Error guardando preferencia:', err);
            }
        }
        // Continuar con la creación del pedido
        if (pendingPayload) {
            await submitOrder(pendingPayload);
            setPendingPayload(null);
        }
    };



    const getPriceForClient = (product, isClient = false, discountPct = 0) => {
        // Precio base según gran cliente
        let price = (isClient && product.bigClientPrice && product.bigClientPrice > 0)
            ? Number(product.bigClientPrice)
            : Number(product.basePrice);
        // Aplicar descuento de usuario (0-100)
        const d = Number(discountPct || 0);
        if (!isNaN(d) && d > 0) {
            const factor = Math.max(0, Math.min(100, d));
            price = price * (1 - factor / 100);
        }
        return price;
    };

    const total = cart.reduce((sum, c) => {
        const p = products.find((prod) => prod.id === c.productId);
        const isbigclient = selectedUser && selectedUser.isbigclient;
        const discount = typeof selectedUser?.discount === 'number' ? selectedUser.discount : Number(selectedUser?.discount || 0);
        const linePrice = p ? getPriceForClient(p, isbigclient, discount) : 0;
        return sum + linePrice * c.quantity;
    }, 0);

    const updateQuantity = (productId, newQuantity) => {
        setCart(prev => {
            if (newQuantity <= 0) {
                return prev.filter(item => item.productId !== productId);
            }
            return prev.map(item => item.productId === productId ? {...item, quantity: newQuantity} : item);
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

    // Guardar movimiento manual
    const saveMovement = async () => {
        setCashErr('');
        const amount = Number(movementForm.amount);
        if (!movementForm.type || !amount) {
            setCashErr('Tipo e importe requeridos');
            return;
        }

        // Guardamos concept y note unidos en "note" para backend (si no existe campo concept)
        const noteJoined = movementForm.concept ? (movementForm.note ? `${movementForm.concept} - ${movementForm.note}` : movementForm.concept) : (movementForm.note || undefined);

        const payload = {
            type: movementForm.type,
            amount: Math.abs(movementForm.amount),
            note: noteJoined,
            person: user.id,
            personUserId: movementForm.personUserId || undefined
        }

        try {
            const created = await createCashMovement(token, payload);
            // Imprimir ticket de movimiento
            await printCashMovementTicket(created);
            setMovementForm({type: movementForm.type, concept: '', note: '', person: '', amount: ''});
            setShowMovementModal(false);
            await loadCash();
        } catch (e) {
            setCashErr(e.message || 'Error guardando movimiento');
        }
    };

    // Cerrar caja
    const doCloseCash = async () => {
        setCashErr('');
        const counted = Number(countedAmount);
        if (Number.isNaN(counted)) {
            setCashErr('Importe contado inválido');
            return;
        }

        const payload = {
            countedAmount: counted, notes: closeNotes || undefined, user: user.id
        }

        try {
            const {closure} = await closeCashRegister(token, payload);
            console.log(closure);
            // Imprimir ticket de cierre con contexto actual (movimientos pendientes incluidos en el cierre)
            await printCashClosureTicket({
                closure, openingAmount, movements: unclosedMoves, summary: null
            });
            setCountedAmount('');
            setCloseNotes('');
            setShowCloseModal(false);
            await loadCash();
            alert(`Caja cerrada. Descuadre: ${closure.diff} €`);
        } catch (e) {
            setCashErr(e.message || 'Error al cerrar caja');
        }
    };

    // Editar movimiento desde offcanvas
    const startEditMove = (m) => {
        setEditingId(m.id);
        setEditingForm({type: m.type, amount: Number(m.amount).toFixed(2), note: m.note || '', person: m.person || ''});
    };
    const saveEditMove = async () => {
        try {
            const payload = {
                type: editingForm.type,
                amount: Number(editingForm.amount),
                note: editingForm.note || undefined,
                person: editingForm.person || undefined,
            };
            await updateCashMovement(token, editingId, payload);
            setEditingId(null);
            await loadCash();
        } catch (e) {
            setCashErr(e.message || 'No se pudo actualizar el movimiento');
        }
    };
    const removeMove = async (id) => {
        if (!confirm('¿Borrar movimiento?')) return;
        try {
            await deleteCashMovement(token, id);
            await loadCash();
        } catch (e) {
            setCashErr(e.message || 'No se pudo borrar el movimiento');
        }
    };

    // Estado para el selector de usuarios
    const [showUserSelector, setShowUserSelector] = useState(false);
    const [userSearchTerm, setUserSearchTerm] = useState('');
    const [userResults, setUserResults] = useState([]);

    // Cargar usuarios cuando se abre el selector o cambia el término de búsqueda
    useEffect(() => {
        if (showUserSelector) {
            const loadUsers = async () => {
                try {
                    const response = await fetchUsers(token, {q: userSearchTerm, size: 20});
                    setUserResults(response?.data || []);
                } catch (error) {
                    console.error('Error al cargar usuarios:', error);
                    setUserResults([]);
                }
            };

            loadUsers();
        }
    }, [showUserSelector, userSearchTerm, token]);

    // Render
    return (<div>
        <PageToolbar
            title="Punto de Venta"
            actions={
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 4}}>
                    <button type="button" className="uk-button uk-button-small uk-button-default" onClick={async () => {
                        await loadCash();
                        setShowMovementModal(true);
                    }}>
                        <span uk-icon="icon: plus-circle; ratio: 0.8" style={{marginRight: 4}}></span>
                        Movimiento
                    </button>
                    <button type="button" className="uk-button uk-button-small uk-button-default" onClick={async () => {
                        await loadCash();
                        setShowCloseModal(true);
                    }}>
                        <span uk-icon="icon: lock; ratio: 0.8" style={{marginRight: 4}}></span>
                        Cierre
                    </button>
                    <button type="button" className="uk-button uk-button-small uk-button-default" onClick={async () => {
                        await loadCash();
                        setShowMovesCanvas(true);
                    }}>
                        <span uk-icon="icon: list; ratio: 0.8" style={{marginRight: 4}}></span>
                        Movimientos
                    </button>
                </div>
            }
        />

        <div className="section-content">
                <div uk-grid="true" className="uk-grid-small">
                    <div className="uk-width-1-2@m">
                        <div className="uk-card uk-card-default uk-card-body">
                            <CustomerSelector
                                searchUser={searchUser} setSearchUser={setSearchUser}
                                selectedUser={selectedUser} setSelectedUser={setSelectedUser}
                                quickFirstName={quickFirstName} setQuickFirstName={setQuickFirstName}
                                quickLastName={quickLastName} setQuickLastName={setQuickLastName}
                                quickClientPhone={quickClientPhone} setQuickClientPhone={setQuickClientPhone}
                                quickClientEmail={quickClientEmail} setQuickClientEmail={setQuickClientEmail}
                                token={token}
                            />

                            <div className="uk-margin" uk-grid="true">
                                <div className="uk-width-1-1">
                                    <DateCarousel key={dateCarouselKey} fechaLimite={fechaLimite}
                                                  setFechaLimite={setFechaLimite} token={token}/>
                                </div>
                            </div>

                            <div className="uk-margin">
                                <h4 className="uk-margin-small-bottom">Observaciones</h4>
                                <div className="uk-form-controls">
                  <textarea className="uk-textarea" rows="3" placeholder="Prenda en mal estado, petición especial..."
                            value={observaciones} onChange={(e) => setObservaciones(e.target.value)}/>
                                </div>
                            </div>

                            {(showTicketSection || !isValidated) && (<div className="uk-margin">
                                <h3 className="uk-heading-divider">Productos añadidos</h3>
                                {!order && (<div className="uk-margin">
                                    <CartSummary cart={cart} products={products} isbigclient={selectedUser?.isbigclient}

                                                 onUpdateQuantity={updateQuantity} onRemove={removeFromCart}/>
                                    <div className="uk-margin">
                                        <button className="uk-button uk-button-primary uk-width-1-1"
                                                onClick={() => handleValidate({submit: true})}
                                                disabled={!cart.length}>
                                            {order ? 'Revalidar pedido' : 'Validar pedido'}
                                        </button>
                                    </div>
                                    {error && <div className="uk-alert-danger uk-margin-small" uk-alert="true">
                                        <p>{error}</p></div>}
                                </div>)}
                            </div>)}

                            {order && (<div className="uk-margin">
                                <div
                                    className="uk-card uk-card-default uk-card-body uk-padding-small uk-margin-bottom">
                                    <h3 className="uk-card-title">Pedido #{order.orderNum || order.id}</h3>
                                    <div className="uk-label uk-label-success uk-margin-small-right">Validado</div>
                                    <span className="uk-text-muted">Total: {order.total.toFixed(2)} €</span>
                                </div>
                                <PaymentSection
                                    token={token} user={user.id}
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
                            </div>)}
                        </div>
                    </div>
                    <div className="uk-width-1-2@m">
                        <div className="uk-card uk-card-default uk-card-body">
                            <ProductList products={products} searchProduct={searchProduct}
                                         setSearchProduct={setSearchProduct} onAdd={add}/>
                        </div>
                    </div>
                </div>
            </div>

        <CashMovementModal
            show={showMovementModal}
            onClose={() => setShowMovementModal(false)}
            cashErr={cashErr}
            movementForm={movementForm}
            setMovementForm={setMovementForm}
            onSave={saveMovement}
            onOpenUserSelector={() => setShowUserSelector(true)}
        />

        <UserSelectorModal
            show={showUserSelector}
            onClose={() => setShowUserSelector(false)}
            userSearchTerm={userSearchTerm}
            setUserSearchTerm={setUserSearchTerm}
            userResults={userResults}
            onSelectUser={(u) => {
                setMovementForm({
                    ...movementForm,
                    person: `${u.firstName} ${u.lastName}`,
                    personUserId: u.id
                });
                setShowUserSelector(false);
            }}
        />

        <CashCloseModal
            show={showCloseModal}
            onClose={() => setShowCloseModal(false)}
            cashErr={cashErr}
            openingAmount={openingAmount}
            sumMoves={sumMoves}
            expectedAmount={expectedAmount}
            countedAmount={countedAmount}
            setCountedAmount={setCountedAmount}
            diffAmount={diffAmount}
            closeNotes={closeNotes}
            setCloseNotes={setCloseNotes}
            unclosedMoves={unclosedMoves}
            onCloseCash={doCloseCash}
        />

        <CashMovementsPanel
            show={showMovesCanvas}
            onClose={() => setShowMovesCanvas(false)}
            cashErr={cashErr}
            unclosedMoves={unclosedMoves}
            editingId={editingId}
            editingForm={editingForm}
            setEditingForm={setEditingForm}
            onStartEdit={startEditMove}
            onSaveEdit={saveEditMove}
            onCancelEdit={() => setEditingId(null)}
            onRemove={removeMove}
        />

        {/* Prompt de preferencia de notificación */}
        {showNotifyPrompt && (
            <div className="uk-modal uk-open" style={{ display: 'block' }}>
                <div className="uk-modal-dialog uk-modal-body" style={{ maxWidth: 400 }}>
                    <h2 className="uk-modal-title" style={{ fontSize: '1.05rem', marginBottom: 4 }}>
                        Preferencia de notificación
                    </h2>
                    <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 16px' }}>
                        ¿Cómo prefiere {selectedUser?.firstName} recibir avisos sobre sus pedidos?
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className="uk-button uk-width-1-2" style={{ background: '#25D366', color: '#fff' }}
                                onClick={() => handleNotifyChoice('whatsapp')}>WhatsApp</button>
                            <button className="uk-button uk-button-primary uk-width-1-2"
                                onClick={() => handleNotifyChoice('sms')}>SMS</button>
                        </div>
                        <button className="uk-button uk-button-default uk-width-1-1"
                            onClick={() => handleNotifyChoice('none')}>No desea recibir avisos</button>
                    </div>
                    <div style={{ marginTop: 12, textAlign: 'right' }}>
                        <button className="uk-button uk-button-link" onClick={() => { setShowNotifyPrompt(false); setPendingPayload(null); }}
                            style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Cancelar</button>
                    </div>
                </div>
            </div>
        )}
    </div>)
        ;
}