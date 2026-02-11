import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import UIkit from 'uikit';
import { fetchUser } from '../api.js';
import UserForm from '../components/UserForm.jsx';

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

  // Calcular estadísticas financieras
  const stats = orders.reduce(
    (acc, order) => {
      const orderTotal = order.total || 0;
      acc.totalIngresos += orderTotal;

      // Calcular descuentos: diferencia entre subtotal (sin descuento) y totalPrice (con descuento)
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
      <div className="section-header uk-margin">
        <div className="uk-flex uk-flex-between uk-flex-middle">
          <h2>Editar usuario</h2>
          <button className="uk-button uk-button-default" onClick={() => navigate('/usuarios')}>
            Volver
          </button>
        </div>
      </div>

      <div className="section-content" uk-grid="true">
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
          <div className="uk-grid-large" uk-grid="true">
            <div className="uk-width-1-2@l">
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
            </div>

            <div className="uk-width-1-2@l">
              <div className="uk-card uk-card-default uk-card-body uk-margin-bottom">
                <h4 className="uk-margin-remove-top">Resumen financiero</h4>
                <div className="uk-grid-small uk-child-width-1-2@s uk-text-center" uk-grid="true">
                  <div>
                    <div className="uk-card uk-card-body uk-card-small uk-background-muted">
                      <div className="uk-text-small uk-text-muted">Total ingresos</div>
                      <div className="uk-text-lead uk-text-bold">{stats.totalIngresos.toFixed(2)} €</div>
                    </div>
                  </div>
                  <div>
                    <div className="uk-card uk-card-body uk-card-small uk-background-muted">
                      <div className="uk-text-small uk-text-muted">Total descuentos</div>
                      <div className="uk-text-lead uk-text-bold uk-text-warning">{stats.totalDescuentos.toFixed(2)} €</div>
                    </div>
                  </div>
                  <div>
                    <div className="uk-card uk-card-body uk-card-small uk-background-muted">
                      <div className="uk-text-small uk-text-muted">Total pagado</div>
                      <div className="uk-text-lead uk-text-bold uk-text-success">{stats.totalPagado.toFixed(2)} €</div>
                    </div>
                  </div>
                  <div>
                    <div className="uk-card uk-card-body uk-card-small uk-background-muted">
                      <div className="uk-text-small uk-text-muted">Pendiente de pago</div>
                      <div className="uk-text-lead uk-text-bold uk-text-danger">{stats.pendientePago.toFixed(2)} €</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="uk-card uk-card-default uk-card-body">
                <div className="uk-flex uk-flex-between uk-flex-middle uk-margin-small-bottom">
                  <h4 className="uk-margin-remove">Pedidos del usuario</h4>
                </div>

                <div className="uk-overflow-auto">
                  <table className="uk-table uk-table-divider uk-table-small uk-table-hover">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Estado</th>
                        <th>Total</th>
                        <th>Pagado</th>
                        <th>Creado</th>
                        <th>Entrega</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id}>
                          <td>{o.orderNum}</td>
                          <td>{o.status || '-'}</td>
                          <td>{o.total?.toFixed(2)} €</td>
                          <td>
                            <span className={`uk-label ${o.paid ? 'uk-label-success' : 'uk-label-danger'}`}>
                              {o.paid ? 'Sí' : 'No'}
                            </span>
                          </td>
                          <td>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '-'}</td>
                          <td>{o.fechaLimite ? new Date(o.fechaLimite).toLocaleDateString() : '-'}</td>
                          <td>
                            {o.lines?.map(l => l.product?.name).filter(Boolean).join(', ') || '-'}
                          </td>
                        </tr>
                      ))}
                      {orders.length === 0 && (
                        <tr>
                          <td colSpan="7" className="uk-text-center uk-text-muted">Sin pedidos</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

