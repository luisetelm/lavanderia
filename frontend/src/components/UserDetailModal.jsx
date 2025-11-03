import React, { useEffect, useMemo, useState } from 'react';
import UIkit from 'uikit';
import { createUser, updateUser, fetchUser } from '../api.js';

export default function UserDetailModal({ open, onClose, token, userId, isNew = false, onSaved }) {
  const modalId = 'modal-user-detail';
  const [loadedUser, setLoadedUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(false);

  // Mostrar/ocultar modal en función de `open`
  useEffect(() => {
    const modal = UIkit.modal(`#${modalId}`);
    if (open) modal.show(); else modal.hide();
  }, [open]);

  // Cerrar hacia el padre cuando se oculta
  useEffect(() => {
    const el = document.getElementById(modalId);
    if (!el) return;
    const handler = () => { if (onClose) onClose(); };
    el.addEventListener('hidden', handler);
    return () => el.removeEventListener('hidden', handler);
  }, [onClose]);

  // Cargar usuario cuando se abra y exista userId
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!open) return;
      if (!userId) { setLoadedUser({}); return; }
      setLoadingUser(true);
      try {
        const u = await fetchUser(token, userId);
        if (!cancelled) setLoadedUser(u);
      } catch (e) {
        UIkit.notification({ message: 'No se pudo cargar el usuario', status: 'danger', pos: 'top-right' });
      } finally {
        if (!cancelled) setLoadingUser(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, userId, token]);

  return (
    <div id={modalId} className="uk-modal-full" uk-modal="bg-close: false; esc-close: false">
      <div className="uk-modal-dialog">
        <button className="uk-modal-close-full uk-close-large" type="button" uk-close="true" onClick={() => { console.log('[UserDetailModal] close button clicked'); onClose && onClose(); }} />
        <div className="uk-modal-body" uk-overflow-auto="true">
          {loadingUser ? (
            <div className="uk-text-center uk-padding-large">
              <div uk-spinner="ratio: 1.5"></div>
              <p>Cargando usuario...</p>
            </div>
          ) : (
            <UserDetailContent
              token={token}
              user={loadedUser || {}}
              isNew={!userId || isNew}
              onSaved={onSaved}
              onCancel={() => { console.log('[UserDetailModal] cancel clicked'); onClose && onClose(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function UserDetailContent({ token, user = {}, isNew, onSaved, onCancel }) {
  const [form, setForm] = useState(() => initForm(user));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Sincronizar formulario cuando cambie el usuario cargado
  useEffect(() => {
    setForm(initForm(user));
    setError('');
  }, [user]);

  const hasOrders = useMemo(() => Array.isArray(user.orders) && user.orders.length > 0, [user]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
      console.log('[UserDetailModal] submit clicked');
    if (saving) return;
    setSaving(true);
    try {
      if (!isNew && user?.id) {
        await updateUser(token, user.id, form);
        UIkit.notification({ message: 'Usuario actualizado', status: 'success', pos: 'top-right' });
      } else {
        await createUser(token, form);
        UIkit.notification({ message: 'Usuario creado', status: 'success', pos: 'top-right' });
      }
      setSaving(false);
      onSaved && onSaved();
    } catch (err) {
      const msg = err?.error || err?.message || 'Fallo al guardar usuario';
      setError(msg);
      UIkit.notification({ message: msg, status: 'danger', pos: 'top-right' });
      setSaving(false);
    }
  };

  return (
    <div className="uk-grid-collapse uk-child-width-expand@s" uk-grid="true">
      {/* Columna izquierda (1/3): formulario */}
      <div className="uk-width-1-3@m">
        <div className="uk-padding">
          <h4>{!isNew ? 'Editar usuario' : 'Nuevo usuario'}</h4>
          {error && (
            <div className="uk-alert-danger" uk-alert="true">
              <p>{error}</p>
            </div>
          )}

          <form className="uk-form-stacked" onSubmit={handleSubmit}>
            <FormField label="Nombre">
              <input className="uk-input" value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))} required />
            </FormField>
            <FormField label="Apellidos">
              <input className="uk-input" value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))} required />
            </FormField>
            <FormField label="Email">
              <input className="uk-input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
            </FormField>
            <FormField label="Rol">
              <select className="uk-select" value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="admin">Admin</option>
                <option value="cashier">Cajero</option>
                <option value="worker">Trabajador</option>
                <option value="customer">Cliente</option>
              </select>
            </FormField>
            <FormField label="Teléfono">
              <input className="uk-input" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} />
            </FormField>
            <FormField label={`Contraseña ${!isNew && user.id ? '(dejar vacío para no cambiar)' : ''}`}>
              <input className="uk-input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} />
            </FormField>

            <div className="uk-margin">
              <label>
                <input className="uk-checkbox" type="checkbox" checked={form.isActive} onChange={(e) => setForm(f => ({ ...f, isActive: e.target.checked }))} />{' '}Activo
              </label>
            </div>
            <div className="uk-margin">
              <label>
                <input className="uk-checkbox" type="checkbox" checked={form.isbigclient} onChange={(e) => setForm(f => ({ ...f, isbigclient: e.target.checked }))} />{' '}Tarifa Gran Cliente
              </label>
            </div>

            <FormField label="Denominación social">
              <input className="uk-input" value={form.denominacionsocial} onChange={(e) => setForm(f => ({ ...f, denominacionsocial: e.target.value }))} />
            </FormField>
            <FormField label="NIF">
              <input className="uk-input" value={form.nif} onChange={(e) => setForm(f => ({ ...f, nif: e.target.value }))} />
            </FormField>
            <FormField label="Tipo de persona">
              <select className="uk-select" value={form.tipopersona} onChange={(e) => setForm(f => ({ ...f, tipopersona: e.target.value }))}>
                <option value="">Selecciona tipo</option>
                <option value="Física">Física</option>
                <option value="Jurídica">Jurídica</option>
              </select>
            </FormField>
            <FormField label="Dirección">
              <input className="uk-input" value={form.direccion} onChange={(e) => setForm(f => ({ ...f, direccion: e.target.value }))} />
            </FormField>
            <FormField label="Localidad">
              <input className="uk-input" value={form.localidad} onChange={(e) => setForm(f => ({ ...f, localidad: e.target.value }))} />
            </FormField>
            <FormField label="Provincia">
              <input className="uk-input" value={form.provincia} onChange={(e) => setForm(f => ({ ...f, provincia: e.target.value }))} />
            </FormField>
            <FormField label="Código Postal">
              <input className="uk-input" value={form.codigopostal} onChange={(e) => setForm(f => ({ ...f, codigopostal: e.target.value }))} />
            </FormField>
            <FormField label="País">
              <input className="uk-input" value={form.pais} onChange={(e) => setForm(f => ({ ...f, pais: e.target.value }))} />
            </FormField>

            <div className="uk-margin">
              <div className="uk-flex uk-flex-left">
                <button type="submit" className="uk-button uk-button-primary" disabled={saving}>
                  {saving ? 'Guardando...' : (!isNew && user.id ? 'Guardar' : 'Crear')}
                </button>
                <button type="button" className="uk-button uk-button-default uk-margin-small-left" onClick={onCancel} disabled={saving}>
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Columna derecha (2/3): pedidos */}
      <div className="uk-width-2-3@m uk-background-muted">
        <div className="uk-padding">
          {hasOrders ? (
            <>
              <h5 className="uk-heading-line"><span>Historial de Pedidos ({user.orders.length})</span></h5>
              <div className="uk-overflow-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                <table className="uk-table uk-table-small uk-table-divider uk-table-hover">
                  <thead>
                    <tr>
                      <th>Núm.</th>
                      <th>Estado</th>
                      <th>Total</th>
                      <th>Pagado</th>
                      <th>Fecha</th>
                      <th>Items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.orders.map(order => (
                      <tr key={order.id}>
                        <td>#{order.orderNum}</td>
                        <td>
                          <span className={`uk-label ${order.status === 'completed' ? 'uk-label-success' : order.status === 'pending' ? 'uk-label-warning' : 'uk-label-default'}`}>
                            {order.status}
                          </span>
                        </td>
                        <td>{order.total?.toFixed(2)}€</td>
                        <td>
                          <span className={`uk-label ${order.paid ? 'uk-label-success' : 'uk-label-danger'}`}>{order.paid ? 'Sí' : 'No'}</span>
                        </td>
                        <td>{new Date(order.createdAt).toLocaleDateString('es-ES')}</td>
                        <td>
                          <details>
                            <summary className="uk-text-small" style={{ cursor: 'pointer' }}>{order.lines?.length || 0} productos</summary>
                            <ul className="uk-list uk-list-bullet uk-text-small uk-margin-small-top">
                              {order.lines?.map(line => (
                                <li key={line.id}>
                                  {line.product?.name}
                                  {line.variant?.name && ` - ${line.variant.name}`} x{line.quantity} ({line.totalPrice?.toFixed(2)}€)
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="uk-text-center uk-padding-large">
              <span uk-icon="icon: info; ratio: 3" className="uk-text-muted"></span>
              <p className="uk-text-large uk-text-muted">{isNew ? 'Crear usuario para comenzar a registrar pedidos' : 'No hay pedidos registrados para este usuario'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div className="uk-margin">
      <label className="uk-form-label">{label}</label>
      <div className="uk-form-controls">{children}</div>
    </div>
  );
}

function initForm(u = {}) {
  return {
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    email: u.email || '',
    role: u.role || 'cashier',
    phone: u.phone || '',
    password: '',
    isActive: u.isActive !== undefined ? Boolean(u.isActive) : true,
    isbigclient: u.isbigclient !== undefined ? Boolean(u.isbigclient) : false,
    denominacionsocial: u.denominacionsocial || '',
    nif: u.nif || '',
    tipopersona: u.tipopersona || '',
    direccion: u.direccion || '',
    localidad: u.localidad || '',
    provincia: u.provincia || '',
    codigopostal: u.codigopostal || '',
    pais: u.pais || '',
  };
}
