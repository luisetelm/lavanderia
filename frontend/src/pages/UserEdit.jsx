import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import UIkit from 'uikit';
import { fetchUser } from '../api.js';
import { formatEUR } from '../utils/format.js';
import UserForm from '../components/UserForm.jsx';
import PageToolbar from '../components/PageToolbar.jsx';

export default function UserEdit({ token }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => {
    load();
  }, [id, token]);

  const orders = user?.orders || [];

  const stats = orders.reduce(
    (acc, order) => {
      const orderTotal = order.total || 0;
      acc.totalIngresos += orderTotal;
      if (order.lines) {
        order.lines.forEach((line) => {
          const subtotalSinDescuento = (line.unitPrice || 0) * (line.quantity || 1);
          const totalConDescuento = line.totalPrice || 0;
          acc.totalDescuentos += subtotalSinDescuento - totalConDescuento;
        });
      }
      if (order.paid) {
        acc.totalPagado += orderTotal;
      } else {
        acc.pendientePago += orderTotal;
      }
      return acc;
    },
    { totalIngresos: 0, totalDescuentos: 0, totalPagado: 0, pendientePago: 0 }
  );

  return (
    <div>
      <PageToolbar
        title={user ? `${user.firstName} ${user.lastName}` : 'Editar usuario'}
        actions={
          <button className="uk-button uk-button-small uk-button-default" onClick={() => navigate('/usuarios')}>
            <span uk-icon="icon: arrow-left; ratio: 0.8" style={{marginRight: 4}}></span> Volver
          </button>
        }
      />

      {loading ? (
        <div className="uk-text-center uk-padding">
          <div uk-spinner="ratio: 1"></div>
          <p>Cargando usuario...</p>
        </div>
      ) : error ? (
        <div className="uk-alert-danger" uk-alert="true">
          <p>{error}</p>
        </div>
      ) : (
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16}}>
          {/* Formulario */}
          <div className="uk-card uk-card-default uk-card-body">
            <UserForm
              token={token}
              initial={user}
              onSave={() => {
                UIkit.notification({ message: 'Usuario guardado', status: 'success' });
                load();
              }}
              onCancel={() => navigate('/usuarios')}
            />
          </div>

          {/* Panel derecho: estadísticas + pedidos */}
          <div>
            {/* KPIs */}
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16}}>
              {[
                { label: 'Total ingresos', value: formatEUR(stats.totalIngresos) },
                { label: 'Total descuentos', value: formatEUR(stats.totalDescuentos), color: '#f59e0b' },
                { label: 'Total pagado', value: formatEUR(stats.totalPagado), color: '#10b981' },
                { label: 'Pendiente pago', value: formatEUR(stats.pendientePago), color: '#ef4444' },
              ].map((kpi, i) => (
                <div key={i} className="uk-card uk-card-default uk-card-body uk-text-center" style={{padding: '12px 8px'}}>
                  <div style={{fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase'}}>{kpi.label}</div>
                  <div style={{fontSize: '1.1rem', fontWeight: 700, marginTop: 2, color: kpi.color || '#1e293b'}}>{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* Pedidos */}
            <div className="uk-card uk-card-default uk-card-body">
              <h4 style={{margin: '0 0 12px'}}>Pedidos ({orders.length})</h4>

              {orders.length === 0 ? (
                <div style={{textAlign: 'center', padding: 20, color: '#94a3b8'}}>Sin pedidos</div>
              ) : (
                <>
                  {/* Tabla desktop */}
                  <div className="uk-overflow-auto uk-visible@s">
                    <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{minWidth: 500}}>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Estado</th>
                          <th style={{textAlign: 'right'}}>Total</th>
                          <th>Pagado</th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id}>
                            <td style={{fontWeight: 500}}>{o.orderNum}</td>
                            <td>{o.status || '-'}</td>
                            <td style={{textAlign: 'right'}}>{formatEUR(o.total)}</td>
                            <td>
                              <span className={`uk-label ${o.paid ? 'uk-label-success' : 'uk-label-danger'}`}>
                                {o.paid ? 'Pagado' : 'Pendiente'}
                              </span>
                            </td>
                            <td style={{fontSize: '0.8rem', color: '#64748b'}}>
                              {o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-ES') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Cards móvil */}
                  <div className="uk-hidden@s">
                    {orders.map(o => (
                      <div key={o.id} style={{
                        padding: '10px 0', borderBottom: '1px solid #e2e8f0',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}>
                        <div>
                          <div style={{fontWeight: 600, fontSize: '0.85rem'}}>{o.orderNum}</div>
                          <div style={{fontSize: '0.75rem', color: '#64748b'}}>
                            {o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-ES') : ''} · {o.status}
                          </div>
                        </div>
                        <div style={{textAlign: 'right'}}>
                          <div style={{fontWeight: 600}}>{formatEUR(o.total)}</div>
                          <span className={`uk-label ${o.paid ? 'uk-label-success' : 'uk-label-danger'}`}
                                style={{fontSize: '0.6rem'}}>
                            {o.paid ? 'Pagado' : 'Pendiente'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
