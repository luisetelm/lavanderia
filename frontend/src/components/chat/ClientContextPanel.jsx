import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { avisar } from '../../utils/dialogo.js';
import { formatEUR } from '../../utils/format.js';
import { lineasActivas } from '../../utils/lineas.js';
import { fetchUser, fetchUsers, createUser, linkConversationClient } from '../../api.js';
import { useDraftOrder } from '../../hooks/useDraftOrder.js';
import { useMessages } from '../../hooks/useMessages.js';
import { ORDER_STATUS, isOrderActive, localPhone, convInitials } from './chatUtils.js';

/**
 * Panel lateral con el contexto del cliente de la conversación abierta: quién
 * es, qué pedidos tiene en marcha, qué debe, y accesos directos a su ficha y a
 * empezarle un pedido. Es lo que hace que se pueda contestar sin salir del chat.
 *
 * Si el número no está vinculado a ningún cliente, en su lugar ofrece
 * vincularlo (buscando por teléfono o por nombre) o dar de alta uno nuevo.
 */
export default function ClientContextPanel({ conv, onInsertText, onClose }) {
    if (!conv) return null;
    return (
        <div className="chat-context">
            <div className="chat-context-header">
                <span style={{ fontWeight: 700, fontSize: 13 }}>{conv.clientId ? 'Cliente' : 'Número sin cliente'}</span>
                {onClose && (
                    <button className="chat-icon-btn" onClick={onClose} title="Cerrar">
                        <span uk-icon="icon: close; ratio: 0.8"></span>
                    </button>
                )}
            </div>
            <div className="chat-context-body">
                {conv.clientId
                    ? <LinkedClient key={conv.clientId} conv={conv} onInsertText={onInsertText} />
                    : <UnlinkedClient key={conv.id} conv={conv} />}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
 *  Cliente vinculado
 * ═══════════════════════════════════════════════════════════ */
function LinkedClient({ conv, onInsertText }) {
    const { token, close } = useMessages();
    const navigate = useNavigate();
    const draft = useDraftOrder();
    const [client, setClient] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAllOrders, setShowAllOrders] = useState(false);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError('');
        fetchUser(token, conv.clientId)
            .then(data => { if (alive) setClient(data); })
            .catch(err => { if (alive) setError(err.error || 'No se pudo cargar el cliente'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [token, conv.clientId]);

    const orders = useMemo(() => client?.orders || [], [client]);
    const activeOrders = useMemo(() => orders.filter(isOrderActive), [orders]);
    const pastOrders = useMemo(() => orders.filter(o => !isOrderActive(o)), [orders]);

    const stats = useMemo(() => orders.reduce((acc, o) => {
        if (o.status === 'cancelled') return acc;
        const total = Number(o.total) || 0;
        acc.count += 1;
        acc.spent += total;
        if (!o.paid) acc.pending += total;
        return acc;
    }, { count: 0, spent: 0, pending: 0 }), [orders]);

    const unpaidInvoices = useMemo(
        () => (client?.invoices || []).filter(i => !(i.paid === true || i.paymentStatus === 'paid')).length,
        [client]
    );

    // Navegar cierra el widget en pantallas pequeñas, donde lo tapa todo
    const go = (path, state) => {
        if (window.innerWidth <= 640) close();
        navigate(path, state ? { state } : undefined);
    };

    const nuevoPedido = () => {
        draft.setSelectedUser({
            id: client.id, firstName: client.firstName, lastName: client.lastName,
            phone: client.phone, email: client.email, isbigclient: client.isbigclient,
            discount: client.discount, notifyChannel: client.notifyChannel,
        });
        go('/pos');
    };

    if (loading) return <div className="msg-empty">Cargando cliente...</div>;
    if (error) return <div className="msg-empty" style={{ color: '#ef4444' }}>{error}</div>;
    if (!client) return null;

    const fullName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
    const address = [client.direccion, client.codigopostal, client.localidad].filter(Boolean).join(', ');

    return (
        <>
            {/* Identidad */}
            <div className="chat-client-head">
                <div className="msg-conv-avatar">{convInitials(client)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{fullName || client.denominacionsocial || 'Cliente'}</div>
                    {client.denominacionsocial && fullName && (
                        <div style={{ fontSize: 11, color: '#64748b' }}>{client.denominacionsocial}</div>
                    )}
                    <div className="chat-tags">
                        {client.isbigclient && <span className="chat-tag gold">Gran cliente</span>}
                        {Number(client.discount) > 0 && <span className="chat-tag">-{Number(client.discount)}% dto.</span>}
                        {client.autoMonthlyInvoice && <span className="chat-tag">Factura mensual</span>}
                        {client.isActive === false && <span className="chat-tag red">Inactivo</span>}
                    </div>
                </div>
            </div>

            <div className="chat-client-contact">
                {client.phone && <a href={`tel:${client.phone}`}><span uk-icon="icon: receiver; ratio: 0.7"></span>{client.phone}</a>}
                {client.email && <a href={`mailto:${client.email}`}><span uk-icon="icon: mail; ratio: 0.7"></span>{client.email}</a>}
                {address && <span><span uk-icon="icon: location; ratio: 0.7"></span>{address}</span>}
                <span title="Canal preferido para los avisos automáticos">
                    <span uk-icon="icon: bell; ratio: 0.7"></span>
                    Avisos por {client.notifyChannel === 'sms' ? 'SMS' : client.notifyChannel === 'email' ? 'email' : 'WhatsApp'}
                </span>
            </div>

            {/* Acciones */}
            <div className="chat-actions">
                <button className="uk-button uk-button-default uk-button-small" onClick={() => go(`/usuarios/${client.id}`)}>
                    <span uk-icon="icon: user; ratio: 0.7"></span> Ficha
                </button>
                <button className="uk-button uk-button-primary uk-button-small" onClick={nuevoPedido}>
                    <span uk-icon="icon: cart; ratio: 0.7"></span> Nuevo pedido
                </button>
            </div>

            {/* Resumen */}
            <div className="chat-kpis">
                <div><div className="chat-kpi-label">Pedidos</div><div className="chat-kpi-value">{stats.count}</div></div>
                <div><div className="chat-kpi-label">Gastado</div><div className="chat-kpi-value">{formatEUR(stats.spent)}</div></div>
                <div>
                    <div className="chat-kpi-label">Pendiente</div>
                    <div className="chat-kpi-value" style={{ color: stats.pending > 0 ? '#ef4444' : '#10b981' }}>{formatEUR(stats.pending)}</div>
                </div>
            </div>
            {unpaidInvoices > 0 && (
                <div className="chat-notice warn">
                    {unpaidInvoices} factura{unpaidInvoices > 1 ? 's' : ''} sin cobrar
                </div>
            )}

            {/* Pedidos en curso */}
            <div className="chat-section-title">
                En curso {activeOrders.length > 0 && <span className="msg-badge">{activeOrders.length}</span>}
            </div>
            {activeOrders.length === 0 ? (
                <div className="chat-muted">Ningún pedido en curso</div>
            ) : (
                activeOrders.map(o => (
                    <OrderCard
                        key={o.id}
                        order={o}
                        onOpen={() => go('/tareas', { filterOrderId: o.id, orderNumber: o.orderNum })}
                        onCompose={onInsertText ? () => onInsertText(redactarAviso(o)) : null}
                    />
                ))
            )}

            {/* Historial */}
            {pastOrders.length > 0 && (
                <>
                    <div className="chat-section-title" style={{ marginTop: 12 }}>Anteriores</div>
                    {(showAllOrders ? pastOrders : pastOrders.slice(0, 5)).map(o => (
                        <OrderCard
                            key={o.id}
                            order={o}
                            compact
                            onOpen={() => go('/tareas', { filterOrderId: o.id, orderNumber: o.orderNum })}
                        />
                    ))}
                    {pastOrders.length > 5 && (
                        <button className="chat-link-btn" onClick={() => setShowAllOrders(v => !v)}>
                            {showAllOrders ? 'Ver menos' : `Ver los ${pastOrders.length} pedidos`}
                        </button>
                    )}
                </>
            )}
        </>
    );
}

/* Frase lista para pegar en el compositor según el estado del pedido */
function redactarAviso(o) {
    const n = o.orderNum || o.id;
    if (o.status === 'ready') {
        return `Hola, su pedido nº ${n} ya está listo para recoger. ¡Le esperamos!`;
    }
    if (o.fechaLimite) {
        const f = new Date(o.fechaLimite).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
        return `Hola, su pedido nº ${n} está en proceso; está previsto para el ${f}. Le avisaremos en cuanto esté listo.`;
    }
    return `Hola, su pedido nº ${n} está en proceso. Le avisaremos en cuanto esté listo.`;
}

function OrderCard({ order: o, compact = false, onOpen, onCompose }) {
    const st = ORDER_STATUS[o.status] || { text: o.status, cls: '' };
    const lines = lineasActivas(o.lines);
    const items = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
    const summary = lines.slice(0, 3).map(l => `${l.quantity}× ${l.product?.name || 'Artículo'}`).join(', ')
        + (lines.length > 3 ? ` +${lines.length - 3}` : '');
    const fecha = (d) => d ? new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : null;
    const isLate = o.status === 'pending' && o.fechaLimite && new Date(o.fechaLimite) < new Date();

    return (
        <div className={`chat-order ${compact ? 'compact' : ''}`}>
            <div className="chat-order-top" onClick={onOpen} role="button" title="Ver en Tareas">
                <span className="chat-order-num">#{o.orderNum || o.id}</span>
                <span className={`uk-label ${st.cls}`} style={{ fontSize: '0.6rem' }}>{st.text}</span>
                {!o.paid && o.status !== 'cancelled' && <span className="uk-label uk-label-danger" style={{ fontSize: '0.6rem' }}>Sin pagar</span>}
                <span className="chat-order-total">{formatEUR(o.total)}</span>
            </div>
            {!compact && (
                <>
                    <div className="chat-order-meta">
                        {items > 0 && <span>{items} prenda{items !== 1 ? 's' : ''}</span>}
                        {o.fechaLimite && (
                            <span style={{ color: isLate ? '#ef4444' : undefined, fontWeight: isLate ? 600 : undefined }}>
                                · para el {fecha(o.fechaLimite)}{isLate ? ' (vencido)' : ''}
                            </span>
                        )}
                    </div>
                    {summary && <div className="chat-order-items">{summary}</div>}
                    {onCompose && (
                        <button className="chat-link-btn" onClick={onCompose} title="Escribe el aviso de este pedido en el chat">
                            <span uk-icon="icon: pencil; ratio: 0.6"></span> Redactar aviso
                        </button>
                    )}
                </>
            )}
            {compact && (
                <div className="chat-order-meta">{fecha(o.createdAt)}{items > 0 ? ` · ${items} prenda${items !== 1 ? 's' : ''}` : ''}</div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
 *  Número sin cliente: vincular o dar de alta
 * ═══════════════════════════════════════════════════════════ */
function UnlinkedClient({ conv }) {
    const { token, patchConversation, refreshConversations } = useMessages();
    const phone9 = localPhone(conv.phone);

    const [phoneMatches, setPhoneMatches] = useState([]);
    const [search, setSearch] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [linking, setLinking] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({ firstName: '', lastName: '', phone: phone9, email: '' });
    const [saving, setSaving] = useState(false);

    // Coincidencias por teléfono al abrir
    useEffect(() => {
        if (!phone9) return;
        let alive = true;
        fetchUsers(token, { q: phone9, size: 5 })
            .then(res => { if (alive) setPhoneMatches((res.data || []).filter(u => u.role === 'customer' || !u.role)); })
            .catch(() => {});
        return () => { alive = false; };
    }, [token, phone9]);

    // Búsqueda manual por nombre (con pequeño retardo)
    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) { setResults([]); return; }
        let alive = true;
        setSearching(true);
        const t = setTimeout(() => {
            fetchUsers(token, { q, size: 8 })
                .then(res => { if (alive) setResults(res.data || []); })
                .catch(() => { if (alive) setResults([]); })
                .finally(() => { if (alive) setSearching(false); });
        }, 300);
        return () => { alive = false; clearTimeout(t); };
    }, [token, search]);

    const link = useCallback(async (user) => {
        setLinking(true);
        try {
            await linkConversationClient(token, conv.id, user.id);
            patchConversation(conv.id, {
                clientId: user.id, firstName: user.firstName, lastName: user.lastName,
                phone: user.phone || conv.phone,
            });
            avisar(`Conversación vinculada a ${user.firstName} ${user.lastName}`, 'success');
            refreshConversations();
        } catch (err) {
            avisar(err.error || 'No se pudo vincular', 'danger');
        } finally {
            setLinking(false);
        }
    }, [token, conv.id, conv.phone, patchConversation, refreshConversations]);

    const crear = async (e) => {
        e.preventDefault();
        if (!form.firstName.trim() || !form.lastName.trim()) { avisar('Nombre y apellidos son obligatorios', 'warning'); return; }
        setSaving(true);
        try {
            const user = await createUser(token, {
                firstName: form.firstName.trim(), lastName: form.lastName.trim(),
                phone: form.phone.trim(), email: form.email.trim() || undefined,
                role: 'customer',
            });
            await link(user);
        } catch (err) {
            avisar(err.error || 'No se pudo crear el cliente', 'danger');
        } finally {
            setSaving(false);
        }
    };

    const renderUser = (u) => (
        <div className="chat-user-row" key={u.id}>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.firstName} {u.lastName}
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{u.phone || 'sin teléfono'}{u.email ? ` · ${u.email}` : ''}</div>
            </div>
            <button className="uk-button uk-button-primary uk-button-small" disabled={linking} onClick={() => link(u)}>
                Vincular
            </button>
        </div>
    );

    return (
        <>
            <div className="chat-notice">
                Este número (<b>{conv.phone}</b>) no está asociado a ningún cliente. Vincúlalo para ver sus pedidos aquí
                y que sus mensajes queden en su ficha.
            </div>

            {phoneMatches.length > 0 && (
                <>
                    <div className="chat-section-title">Coinciden por teléfono</div>
                    {phoneMatches.map(renderUser)}
                </>
            )}

            <div className="chat-section-title" style={{ marginTop: 10 }}>Buscar cliente</div>
            <input
                type="text"
                className="uk-input uk-form-small"
                placeholder="Nombre, apellidos o email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ borderRadius: 8, fontSize: 13 }}
            />
            {searching && <div className="chat-muted">Buscando...</div>}
            {!searching && search.trim().length >= 2 && results.length === 0 && <div className="chat-muted">Sin resultados</div>}
            {results.map(renderUser)}

            <div className="chat-section-title" style={{ marginTop: 14 }}>¿Cliente nuevo?</div>
            {!creating ? (
                <button className="uk-button uk-button-default uk-button-small" style={{ width: '100%' }} onClick={() => setCreating(true)}>
                    <span uk-icon="icon: plus; ratio: 0.7"></span> Dar de alta con este número
                </button>
            ) : (
                <form onSubmit={crear} className="chat-quick-form">
                    <input className="uk-input uk-form-small" placeholder="Nombre *" value={form.firstName}
                        onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} autoFocus />
                    <input className="uk-input uk-form-small" placeholder="Apellidos *" value={form.lastName}
                        onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
                    <input className="uk-input uk-form-small" placeholder="Teléfono *" value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                    <input className="uk-input uk-form-small" placeholder="Email (opcional)" type="email" value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="uk-button uk-button-default uk-button-small" onClick={() => setCreating(false)} disabled={saving}>Cancelar</button>
                        <button type="submit" className="uk-button uk-button-primary uk-button-small" disabled={saving}>
                            {saving ? 'Guardando...' : 'Crear y vincular'}
                        </button>
                    </div>
                </form>
            )}
        </>
    );
}
