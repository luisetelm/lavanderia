import React, {useEffect, useMemo, useState} from 'react';
import { confirmar, avisar } from '../utils/dialogo.js';
import {
    fetchProducts,
    fetchUsers,
    fetchItineraries,
    // Caja API:
    fetchUnclosedCashMovements,
    fetchUnclosedCashSummary,
    fetchLastClosure,
    createCashMovement,
    updateCashMovement,
    deleteCashMovement,
    closeCashRegister,
    reconcilePayment,
} from '../api.js';
import {
    printCashMovementTicket, printCashClosureTicket
} from '../utils/printUtils.js';
import CustomerSelector from '../components/CustomerSelector.jsx';
import ProductList from '../components/ProductList.jsx';
import DateCarousel from '../components/DateCarousel.jsx';
import PageToolbar from '../components/PageToolbar.jsx';
import CashMovementModal from '../components/pos/CashMovementModal.jsx';
import CashCloseModal from '../components/pos/CashCloseModal.jsx';
import CashMovementsPanel from '../components/pos/CashMovementsPanel.jsx';
import UserSelectorModal from '../components/pos/UserSelectorModal.jsx';
import PendingInvoicesPanel from '../components/pos/PendingInvoicesPanel.jsx';
import { useDraftOrder } from '../hooks/useDraftOrder.js';

const signed = (t, a) => (['withdrawal', 'refund_cash_out'].includes(t) ? -Math.abs(a) : Math.abs(a));


export default function POS({token, user}) {
    const draft = useDraftOrder();

    const [products, setProducts] = useState([]);
    const [itineraries, setItineraries] = useState([]);
    const [searchUser, setSearchUser] = useState('');
    const [searchProduct, setSearchProduct] = useState('');
    const [error, setError] = useState('');

    // Clave para forzar recarga del DateCarousel
    const [dateCarouselKey] = useState(0);

    // Caja: estado UI
    const [showMovementModal, setShowMovementModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showMovesCanvas, setShowMovesCanvas] = useState(false);
    const [showPendingInvoices, setShowPendingInvoices] = useState(false);

    // Caja: datos
    const [cashErr, setCashErr] = useState('');
    const [unclosedMoves, setUnclosedMoves] = useState([]);
    const [lastClosure, setLastClosure] = useState(null);

    // Form movimiento manual
    const [movementForm, setMovementForm] = useState({
        type: 'deposit', concept: '', note: '', person: '', amount: '', personUserId: null,
    });

    // Editar movimiento en offcanvas
    const [editingId, setEditingId] = useState(null);
    const [editingForm, setEditingForm] = useState({type: 'deposit', amount: '', note: '', person: ''});

    // Cierre
    const [closeNotes, setCloseNotes] = useState('');
    const [countedAmount, setCountedAmount] = useState('');
    // Conciliación TPV en el cierre
    const [tpvPayments, setTpvPayments] = useState([]);   // cobros con tarjeta TPV del periodo

    // Carga de catálogo
    useEffect(() => {
        Promise.all([
            fetchProducts(token),
            fetchItineraries(token),
        ]).then(([prods, itins]) => {
            setProducts(prods);
            setItineraries(itins);
        }).catch(() => setError('No se pudieron cargar productos'));
    }, [token]);

    // Cargar trabajos / carga por día
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
                days.forEach((d) => { grouped[formatKey(d)] = []; });
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
    }, [token]);

    // Cargar contexto de caja
    const loadCash = async () => {
        setCashErr('');
        try {
            const [moves, lc, summary] = await Promise.all([
                fetchUnclosedCashMovements(token),
                fetchLastClosure(token),
                fetchUnclosedCashSummary(token),
            ]);
            setUnclosedMoves(moves || []);
            setLastClosure(lc || null);
            // Solo tarjeta presencial (datáfono): card_pos / card
            const tpv = (summary?.cardPayments || []).filter(p => ['card_pos', 'card'].includes(p.method));
            setTpvPayments(tpv);
        } catch (e) {
            setCashErr(e.message || 'Error cargando caja');
        }
    };

    // Cálculos de caja
    const openingAmount = useMemo(() => {
        if (!lastClosure) return 0;
        return Number(lastClosure.countedamount || lastClosure.countedAmount || 0);
    }, [lastClosure]);
    const sumMoves = useMemo(() => (unclosedMoves || []).reduce((acc, m) => acc + signed(m.type, Number(m.amount)), 0), [unclosedMoves]);
    const expectedAmount = useMemo(() => Number((openingAmount + sumMoves).toFixed(2)), [openingAmount, sumMoves]);
    const diffAmount = useMemo(() => {
        const counted = Number(countedAmount || 0);
        return Number((counted - expectedAmount).toFixed(2));
    }, [countedAmount, expectedAmount]);
    // Conciliación de tarjeta: total registrado y total ya marcado por el cajero
    const tpvTotal = useMemo(
        () => Number((tpvPayments.reduce((a, p) => a + Number(p.amount || 0), 0)).toFixed(2)),
        [tpvPayments]
    );
    const tpvMarkedTotal = useMemo(
        () => Number((tpvPayments.filter(p => p.reconciled).reduce((a, p) => a + Number(p.amount || 0), 0)).toFixed(2)),
        [tpvPayments]
    );

    // Añadir producto al carrito del borrador
    const add = (p) => {
        draft.addToCart(p);
    };

    // Guardar movimiento manual
    const saveMovement = async () => {
        setCashErr('');
        const amount = Number(movementForm.amount);
        if (!movementForm.type || !amount) {
            setCashErr('Tipo e importe requeridos');
            return;
        }
        const noteJoined = movementForm.concept
            ? (movementForm.note ? `${movementForm.concept} - ${movementForm.note}` : movementForm.concept)
            : (movementForm.note || undefined);

        const payload = {
            type: movementForm.type,
            amount: Math.abs(movementForm.amount),
            note: noteJoined,
            person: user.id,
            personUserId: movementForm.personUserId || undefined,
        };

        try {
            const created = await createCashMovement(token, payload);
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

        // Aviso si quedan cobros con tarjeta sin conciliar antes de cerrar
        const tpvPending = tpvPayments.filter(p => !p.reconciled);
        if (tpvPending.length > 0) {
            const ok = await confirmar(
                `Quedan ${tpvPending.length} cobro(s) con tarjeta sin conciliar.\n\n` +
                `¿Cerrar caja igualmente? Podrás conciliarlos después en Auditoría.`,
                {titulo: 'Cerrar caja', textoConfirmar: 'Cerrar igualmente'}
            );
            if (!ok) return;
        }

        const payload = { countedAmount: counted, notes: closeNotes || undefined, user: user.id };

        try {
            const {closure} = await closeCashRegister(token, payload);
            await printCashClosureTicket({
                closure, openingAmount, movements: unclosedMoves, summary: null,
                tpv: {
                    payments: tpvPayments,
                    total: tpvTotal,
                    marked: tpvMarkedTotal,
                },
            });
            setCountedAmount('');
            setCloseNotes('');
            setShowCloseModal(false);
            await loadCash();
            avisar(`Caja cerrada. Descuadre efectivo: ${closure.diff} €`, 'success');
        } catch (e) {
            setCashErr(e.message || 'Error al cerrar caja');
        }
    };

    // Marca/desmarca un cobro con tarjeta como conciliado contra el ticket del TPV (en vivo)
    const handleToggleTpv = async (payment) => {
        const next = !payment.reconciled;
        // Optimista: refleja el cambio al instante
        setTpvPayments(prev => prev.map(p => p.id === payment.id ? { ...p, reconciled: next } : p));
        try {
            const res = await reconcilePayment(token, payment.id, next);
            setTpvPayments(prev => prev.map(p =>
                p.id === payment.id ? { ...p, reconciled: res.reconciled, reconciledAt: res.reconciledAt } : p
            ));
        } catch (e) {
            // Revertir si falla
            setTpvPayments(prev => prev.map(p => p.id === payment.id ? { ...p, reconciled: !next } : p));
            setCashErr(e.message || 'Error conciliando cobro');
        }
    };

    // Marca o desmarca todos los cobros con tarjeta de golpe (atajo cuando el total cuadra)
    const handleToggleAllTpv = async (value) => {
        const targets = tpvPayments.filter(p => !!p.reconciled !== value);
        if (!targets.length) return;
        setTpvPayments(prev => prev.map(p => ({ ...p, reconciled: value })));
        try {
            await Promise.all(targets.map(p => reconcilePayment(token, p.id, value)));
        } catch (e) {
            await loadCash();
            setCashErr(e.message || 'Error conciliando cobros');
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
        if (!await confirmar('¿Borrar movimiento?', {peligroso: true, textoConfirmar: 'Borrar'})) return;
        try {
            await deleteCashMovement(token, id);
            await loadCash();
        } catch (e) {
            setCashErr(e.message || 'No se pudo borrar el movimiento');
        }
    };

    // Estado para el selector de usuarios (movimientos de caja)
    const [showUserSelector, setShowUserSelector] = useState(false);
    const [userSearchTerm, setUserSearchTerm] = useState('');
    const [userResults, setUserResults] = useState([]);

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
                    <button type="button" className="uk-button uk-button-small uk-button-default" onClick={() => setShowPendingInvoices(true)}>
                        <span uk-icon="icon: credit-card; ratio: 0.8" style={{marginRight: 4}}></span>
                        Facturas
                    </button>
                </div>
            }
        />

        <div className="section-content">
            <div uk-grid="true" className="uk-grid-small">
                {/* ── Panel izquierdo: cliente + fecha + observaciones ── */}
                <div className="uk-width-1-2@m">
                    <div className="uk-card uk-card-default uk-card-body">
                        <CustomerSelector
                            searchUser={searchUser} setSearchUser={setSearchUser}
                            selectedUser={draft.selectedUser}
                            setSelectedUser={(u) => draft.setSelectedUser(u)}
                            quickFirstName={draft.quickClient.firstName}
                            quickLastName={draft.quickClient.lastName}
                            quickClientPhone={draft.quickClient.phone}
                            quickClientEmail={draft.quickClient.email}
                            setQuickFirstName={(v) => draft.setQuickClient({firstName: v})}
                            setQuickLastName={(v) => draft.setQuickClient({lastName: v})}
                            setQuickClientPhone={(v) => draft.setQuickClient({phone: v})}
                            setQuickClientEmail={(v) => draft.setQuickClient({email: v})}
                            token={token}
                        />

                        <div className="uk-margin" uk-grid="true">
                            <div className="uk-width-1-1">
                                <DateCarousel
                                    key={dateCarouselKey}
                                    fechaLimite={draft.fechaLimite}
                                    setFechaLimite={(d) => draft.setFechaLimite(d)}
                                    token={token}
                                />
                            </div>
                        </div>

                        <div className="uk-margin">
                            <h4 className="uk-margin-small-bottom">Observaciones del pedido</h4>
                            <div className="uk-form-controls">
                                <textarea
                                    className="uk-textarea"
                                    rows="2"
                                    placeholder="Instrucciones generales del pedido (ej: cliente recoge el sábado)..."
                                    value={draft.observaciones}
                                    onChange={(e) => draft.setObservaciones(e.target.value)}
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="uk-alert-danger uk-margin-small" uk-alert="true">
                                <p>{error}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Panel derecho: catálogo de productos ── */}
                <div className="uk-width-1-2@m">
                    <div className="uk-card uk-card-default uk-card-body">
                        <ProductList products={products} searchProduct={searchProduct}
                                     setSearchProduct={setSearchProduct} onAdd={add}
                                     itineraries={itineraries}/>
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
                    personUserId: u.id,
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
            tpvPayments={tpvPayments}
            tpvTotal={tpvTotal}
            tpvMarkedTotal={tpvMarkedTotal}
            onToggleTpv={handleToggleTpv}
            onToggleAllTpv={handleToggleAllTpv}
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

        <PendingInvoicesPanel
            show={showPendingInvoices}
            onClose={() => setShowPendingInvoices(false)}
            token={token}
            onCollected={() => loadCash()}
        />
    </div>);
}

