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

