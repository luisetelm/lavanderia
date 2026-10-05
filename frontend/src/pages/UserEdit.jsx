import React, { useEffect, useState } from 'react';
import { lineasActivas } from '../utils/lineas.js';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useDraftOrder } from '../hooks/useDraftOrder.js';
import { useMessages } from '../hooks/useMessages.js';
import UIkit from 'uikit';
import { fetchUser } from '../api.js';
import { formatEUR } from '../utils/format.js';
import { rutaEntregas, rutaPedido } from '../utils/rutas.js';
import UserForm from '../components/UserForm.jsx';
import PageToolbar from '../components/PageToolbar.jsx';
import ClientPricesTab from '../components/ClientPricesTab.jsx';
import ClientSepaTab from '../components/ClientSepaTab.jsx';
import { FACTURA_SEPA_EN_CURSO, FACTURA_SEPA_FALLIDA } from '../utils/sepa.js';

const STATUS_LABELS = {
  pending: { text: 'Pendiente', cls: 'uk-label-warning' },
  ready: { text: 'Listo', cls: 'uk-label-success' },
  collected: { text: 'Recogido', cls: '' },
  cancelled: { text: 'Cancelado', cls: 'uk-label-danger' },
};

const tabStyle = (active) => ({
  padding: '8px 16px',
  fontSize: '0.82rem',
  fontWeight: active ? 700 : 500,
  color: active ? '#048ABF' : '#64748b',
  borderBottom: active ? '2px solid #048ABF' : '2px solid transparent',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.15s',
  whiteSpace: 'nowrap',
});

// Resume el user-agent a un nombre de navegador/SO legible
function parseUserAgent(ua) {
  if (!ua) return '-';
  let browser = 'Navegador';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return os ? `${browser} · ${os}` : browser;
}

const LOGIN_FAIL_REASONS = {
  no_user: 'Email no existe',
  invalid_credentials: 'Contraseña incorrecta',
  inactive: 'Cuenta desactivada',
};

export default function UserEdit({ token, user: loggedUser }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('orders');
  const draft = useDraftOrder();
  const chat = useMessages();
  const esCliente = user && !['admin', 'cashier', 'worker'].includes(user.role);
  const conversacion = esCliente ? (chat.conversations || []).find(c => Number(c.clientId) === Number(user.id)) : null;

  const nuevoPedido = () => {
    draft.setSelectedUser({
      id: user.id, firstName: user.firstName, lastName: user.lastName,
      phone: user.phone, email: user.email, isbigclient: user.isbigclient,
      discount: user.discount, notifyChannel: user.notifyChannel,
    });
    navigate('/pos');
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchUser(token, id);
      setUser(data);
    } catch (err) {
      setError(err.error || 'No se pudo cargar el usuario');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id, token]);

  const orders = user?.orders || [];
  const invoices = user?.invoices || [];
  const notifications = user?.notifications || [];
  const loginLogs = user?.loginLogs || [];

  const stats = orders.reduce(
    (acc, order) => {
      const orderTotal = Number(order.total) || 0;
      acc.totalIngresos += orderTotal;
      if (order.lines) {
        lineasActivas(order.lines).forEach((line) => {
          const subtotalSinDescuento = (Number(line.unitPrice) || 0) * (Number(line.quantity) || 1);
          const totalConDescuento = Number(line.totalPrice) || 0;
          acc.totalDescuentos += subtotalSinDescuento - totalConDescuento;
        });
      }
      if (order.paid) acc.totalPagado += orderTotal;
      else acc.pendientePago += orderTotal;
      return acc;
    },
    { totalIngresos: 0, totalDescuentos: 0, totalPagado: 0, pendientePago: 0 }
  );

  return (
    <div>
      <PageToolbar
        title={user ? `${user.firstName} ${user.lastName}` : 'Editar usuario'}
        actions={
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
            <button className="uk-button uk-button-small uk-button-default" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(esCliente ? '/clientes' : '/personal'))}>
              <span uk-icon="icon: arrow-left; ratio: 0.8" style={{marginRight: 4}}></span> Volver
            </button>
            {esCliente && user.phone && (
              <a className="uk-button uk-button-small uk-button-default" href={`tel:${user.phone}`} title="Llamar">
                <span uk-icon="icon: receiver; ratio: 0.8" style={{marginRight: 4}}></span> {user.phone}
              </a>
            )}
            {esCliente && conversacion && chat.enabled && (
              <button className="uk-button uk-button-small uk-button-default" onClick={() => chat.openConversation(conversacion.id)} title="Abrir la conversación con el cliente">
                <span uk-icon="icon: comments; ratio: 0.8" style={{marginRight: 4}}></span> Chat
              </button>
            )}
            {esCliente && (
              <button className="uk-button uk-button-small uk-button-primary" onClick={nuevoPedido} title="Abre el TPV con este cliente ya seleccionado">
                <span uk-icon="icon: cart; ratio: 0.8" style={{marginRight: 4}}></span> Nuevo pedido
              </button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="uk-text-center uk-padding">
          <div uk-spinner="ratio: 1"></div>
          <p>Cargando usuario...</p>
        </div>
      ) : error ? (
        <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>
      ) : (
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16}}>
          {/* Formulario */}
          <div className="uk-card uk-card-default uk-card-body">
            <UserForm
              token={token}
              initial={user}
              loggedUser={loggedUser}
              onSave={() => {
                UIkit.notification({ message: 'Usuario guardado', status: 'success' });
                load();
              }}
              onCancel={() => navigate(esCliente ? '/clientes' : '/personal')}
            />
          </div>

          {/* Panel derecho */}
          <div>
            {/* KPIs */}
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16}}>
              {[
                { label: 'Total ingresos', value: formatEUR(stats.totalIngresos) },
                { label: 'Descuentos', value: formatEUR(stats.totalDescuentos), color: '#f59e0b' },
                { label: 'Pagado', value: formatEUR(stats.totalPagado), color: '#10b981' },
                { label: 'Pendiente', value: formatEUR(stats.pendientePago), color: stats.pendientePago > 0 ? '#ef4444' : '#10b981' },
              ].map((kpi, i) => (
                <div key={i} className="uk-card uk-card-default uk-card-body uk-text-center" style={{padding: '12px 8px'}}>
                  <div style={{fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase'}}>{kpi.label}</div>
                  <div style={{fontSize: '1.1rem', fontWeight: 700, marginTop: 2, color: kpi.color || '#1e293b'}}>{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="uk-card uk-card-default" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', padding: '0 12px', overflowX: 'auto' }}>
                <button type="button" style={tabStyle(activeTab === 'orders')} onClick={() => setActiveTab('orders')}>
                  Pedidos ({orders.length})
                </button>
                <button type="button" style={tabStyle(activeTab === 'invoices')} onClick={() => setActiveTab('invoices')}>
                  Facturas ({invoices.length})
                </button>
                {!['admin', 'cashier', 'worker'].includes(user?.role) && (
                  <button type="button" style={tabStyle(activeTab === 'prices')} onClick={() => setActiveTab('prices')}>
                    Precios pactados
                  </button>
                )}
                {!['admin', 'cashier', 'worker'].includes(user?.role) && loggedUser?.role === 'admin' && (
                  <button type="button" style={tabStyle(activeTab === 'sepa')} onClick={() => setActiveTab('sepa')}>
                    Domiciliación
                  </button>
                )}
                <button type="button" style={tabStyle(activeTab === 'notifications')} onClick={() => setActiveTab('notifications')}>
                  Notificaciones ({notifications.length})
                </button>
                <button type="button" style={tabStyle(activeTab === 'logins')} onClick={() => setActiveTab('logins')}>
                  Accesos ({loginLogs.length})
                </button>
              </div>

              <div style={{ padding: '12px 16px' }}>
                {/* ── Pedidos ── */}
                {activeTab === 'orders' && (
                  orders.length === 0 ? (
                    <div style={{textAlign: 'center', padding: 20, color: '#94a3b8'}}>Sin pedidos</div>
                  ) : (
                    <div className="uk-overflow-auto">
                      <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{margin: 0}}>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Estado</th>
                            <th style={{textAlign: 'right'}}>Total</th>
                            <th>Cobro</th>
                            <th>Creado</th>
                            <th>Entrega</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map(o => {
                            const s = STATUS_LABELS[o.status] || { text: o.status, cls: '' };
                            const atrasado = !['collected', 'cancelled'].includes(o.status) && o.fechaLimite
                              && new Date(o.fechaLimite) < new Date(new Date().toDateString());
                            return (
                              <tr key={o.id} style={{ cursor: 'pointer' }}
                                onClick={() => navigate(rutaPedido(o))}>
                                <td style={{fontWeight: 500}}><Link to={rutaPedido(o)} onClick={e => e.stopPropagation()}>{o.orderNum}</Link></td>
                                <td><span className={`uk-label ${s.cls}`} style={{fontSize: '0.65rem'}}>{s.text}</span></td>
                                <td style={{textAlign: 'right'}}>{formatEUR(o.total)}</td>
                                <td>
                                  <span className={`uk-label ${o.paid ? 'uk-label-success' : 'uk-label-danger'}`} style={{fontSize: '0.65rem'}}>
                                    {o.paid ? 'Pagado' : 'Pendiente'}
                                  </span>
                                </td>
                                <td style={{fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap'}}>
                                  {o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '-'}
                                </td>
                                <td style={{fontSize: '0.8rem', color: atrasado ? '#dc2626' : '#64748b', fontWeight: atrasado ? 700 : 400, whiteSpace: 'nowrap'}}>
                                  {o.fechaLimite ? (
                                    <Link to={rutaEntregas(new Date(o.fechaLimite).toISOString().slice(0, 10))} onClick={e => e.stopPropagation()}
                                          style={{color: 'inherit'}} title="Ver las entregas de ese día">
                                      {new Date(o.fechaLimite).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}{atrasado ? ' · atrasado' : ''}
                                    </Link>
                                  ) : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {/* ── Facturas ── */}
                {activeTab === 'invoices' && (
                  invoices.length === 0 ? (
                    <div style={{textAlign: 'center', padding: 20, color: '#94a3b8'}}>Sin facturas</div>
                  ) : (
                    <div className="uk-overflow-auto">
                      <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{margin: 0}}>
                        <thead>
                          <tr>
                            <th>Nº Factura</th>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th style={{textAlign: 'right'}}>Importe</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.map(inv => {
                            const isPaid = inv.paid === true || inv.paymentStatus === 'paid';
                            const sepaEnCurso = !isPaid && inv.paymentStatus === FACTURA_SEPA_EN_CURSO;
                            const sepaFallido = !isPaid && inv.paymentStatus === FACTURA_SEPA_FALLIDA;
                            const typeLabel = inv.type === 'n' ? 'Normal' : inv.type === 's' ? 'Simplificada' : inv.type || '-';
                            return (
                              <tr key={inv.id}>
                                <td style={{fontWeight: 500}}>{inv.number || '-'}</td>
                                <td style={{fontSize: '0.8rem', color: '#64748b'}}>
                                  {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString('es-ES', { dateStyle: 'medium' }) : '-'}
                                </td>
                                <td>
                                  <span className="uk-label" style={{fontSize: '0.6rem', background: inv.type === 'n' ? '#048ABF' : '#94a3b8'}}>
                                    {typeLabel}
                                  </span>
                                </td>
                                <td style={{textAlign: 'right', fontWeight: 600}}>{formatEUR(Number(inv.totalGross))}</td>
                                <td>
                                  <span className={`uk-label ${isPaid ? 'uk-label-success' : sepaEnCurso ? 'uk-label-warning' : 'uk-label-danger'}`} style={{fontSize: '0.65rem'}}>
                                    {isPaid ? 'Cobrada' : sepaEnCurso ? 'Adeudo en curso' : sepaFallido ? 'Adeudo devuelto' : 'Pendiente'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {/* ── Domiciliación SEPA ── */}
                {activeTab === 'sepa' && (
                  <ClientSepaTab token={token} client={user} />
                )}

                {/* ── Precios pactados ── */}
                {activeTab === 'prices' && (
                  <ClientPricesTab token={token} clientId={user.id} canEdit={loggedUser?.role === 'admin'} />
                )}

                {/* ── Notificaciones ── */}
                {activeTab === 'notifications' && (
                  notifications.length === 0 ? (
                    <div style={{textAlign: 'center', padding: 20, color: '#94a3b8'}}>Sin notificaciones</div>
                  ) : (
                    <div className="uk-overflow-auto">
                      <table className="uk-table uk-table-divider uk-table-small" style={{margin: 0}}>
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th>Estado</th>
                            <th>Contenido</th>
                          </tr>
                        </thead>
                        <tbody>
                          {notifications.map(n => {
                            const isOk = n.status === 'sent';
                            return (
                              <tr key={n.id}>
                                <td style={{fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap'}}>
                                  {n.sentAt ? new Date(n.sentAt).toLocaleDateString('es-ES', { dateStyle: 'medium' }) : '-'}
                                  <div style={{fontSize: '0.7rem'}}>
                                    {n.sentAt ? new Date(n.sentAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}
                                  </div>
                                </td>
                                <td style={{fontSize: '0.8rem'}}>{n.type || '-'}</td>
                                <td>
                                  <span className={`uk-label ${isOk ? 'uk-label-success' : 'uk-label-danger'}`} style={{fontSize: '0.6rem'}}>
                                    {isOk ? 'Enviado' : n.status || 'Error'}
                                  </span>
                                </td>
                                <td style={{fontSize: '0.78rem', color: '#475569', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                                  {n.content || '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {/* ── Accesos (inicios de sesión) ── */}
                {activeTab === 'logins' && (
                  loginLogs.length === 0 ? (
                    <div style={{textAlign: 'center', padding: 20, color: '#94a3b8'}}>Sin registros de acceso</div>
                  ) : (
                    <div className="uk-overflow-auto">
                      <table className="uk-table uk-table-divider uk-table-small" style={{margin: 0}}>
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Resultado</th>
                            <th>IP</th>
                            <th>Dispositivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loginLogs.map(l => (
                            <tr key={l.id}>
                              <td style={{fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap'}}>
                                {l.createdAt ? new Date(l.createdAt).toLocaleDateString('es-ES', { dateStyle: 'medium' }) : '-'}
                                <div style={{fontSize: '0.7rem'}}>
                                  {l.createdAt ? new Date(l.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}
                                </div>
                              </td>
                              <td>
                                <span className={`uk-label ${l.success ? 'uk-label-success' : 'uk-label-danger'}`} style={{fontSize: '0.6rem'}}>
                                  {l.success ? 'Correcto' : (LOGIN_FAIL_REASONS[l.reason] || 'Fallido')}
                                </span>
                              </td>
                              <td style={{fontSize: '0.8rem', fontFamily: 'monospace', color: '#475569'}}>{l.ip || '-'}</td>
                              <td style={{fontSize: '0.78rem', color: '#475569'}} title={l.userAgent || ''}>
                                {parseUserAgent(l.userAgent)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
