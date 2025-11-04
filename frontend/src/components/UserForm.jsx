import React, { useState } from 'react';
import { createUser, updateUser } from '../api.js';

export default function UserForm({ initial = {}, onSave, token, onCancel }) {
  const [form, setForm] = useState({
    firstName: initial.firstName || '',
    lastName: initial.lastName || '',
    email: initial.email || '',
    role: initial.role || 'cashier',
    phone: initial.phone || '',
    password: '',
    isActive: initial.isActive !== undefined ? Boolean(initial.isActive) : true,
    isbigclient: initial.isbigclient !== undefined ? Boolean(initial.isbigclient) : false,
    denominacionsocial: initial.denominacionsocial || '',
    nif: initial.nif || '',
    tipopersona: initial.tipopersona || '',
    direccion: initial.direccion || '',
    localidad: initial.localidad || '',
    provincia: initial.provincia || '',
    codigopostal: initial.codigopostal || '',
    pais: initial.pais || '',
    discount: typeof initial.discount === 'number' ? initial.discount : 0,
  });

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      // Validación 0-100 del descuento
      const d = Number(form.discount);
      if (isNaN(d) || d < 0 || d > 100) {
        setError('El descuento debe ser un número entre 0 y 100');
        setSaving(false);
        return;
      }
      const payload = { ...form, discount: d };
      if (initial.id) {
        await updateUser(token, initial.id, payload);
      } else {
        await createUser(token, payload);
      }
      if (onSave) onSave();
    } catch (err) {
      setError(err.error || 'Fallo al guardar usuario');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h4>{initial.id ? 'Editar usuario' : 'Nuevo usuario'}</h4>

      {error && (
        <div className="uk-alert-danger" uk-alert="true">
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={submit} className="uk-form-stacked">
        <div className="uk-grid-small" uk-grid="true">
          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Nombre</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Apellidos</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Email</label>
              <div className="uk-form-controls">
                <input
                  type="email"
                  autoComplete="off"
                  className="uk-input"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Rol</label>
              <div className="uk-form-controls">
                <select
                  className="uk-select"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="admin">Admin</option>
                  <option value="cashier">Cajero</option>
                  <option value="worker">Trabajador</option>
                  <option value="customer">Cliente</option>
                </select>
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Teléfono</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">
                Contraseña {initial.id ? '(dejar vacío para no cambiar)' : ''}
              </label>
              <div className="uk-form-controls">
                <input
                  autoComplete="new-password"
                  type="password"
                  className="uk-input"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-1">
            <div className="uk-margin">
              <label>
                <input
                  className="uk-checkbox"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />{' '}
                Activo
              </label>
            </div>
          </div>

          <div className="uk-width-1-1">
            <div className="uk-margin">
              <label>
                <input
                  className="uk-checkbox"
                  type="checkbox"
                  checked={form.isbigclient}
                  onChange={(e) => setForm((f) => ({ ...f, isbigclient: e.target.checked }))}
                />{' '}
                Tarifa Gran Cliente
              </label>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Denominación social</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.denominacionsocial}
                  onChange={(e) => setForm((f) => ({ ...f, denominacionsocial: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">NIF</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.nif}
                  onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Tipo de persona</label>
              <div className="uk-form-controls">
                <select
                  className="uk-select"
                  value={form.tipopersona}
                  onChange={(e) => setForm((f) => ({ ...f, tipopersona: e.target.value }))}
                >
                  <option value="">Selecciona tipo</option>
                  <option value="Física">Física</option>
                  <option value="Jurídica">Jurídica</option>
                </select>
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Dirección</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Localidad</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.localidad}
                  onChange={(e) => setForm((f) => ({ ...f, localidad: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Provincia</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.provincia}
                  onChange={(e) => setForm((f) => ({ ...f, provincia: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Código Postal</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.codigopostal}
                  onChange={(e) => setForm((f) => ({ ...f, codigopostal: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">País</label>
              <div className="uk-form-controls">
                <input
                  className="uk-input"
                  value={form.pais}
                  onChange={(e) => setForm((f) => ({ ...f, pais: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* Descuento 0-100 */}
          <div className="uk-width-1-2@s">
            <div className="uk-margin">
              <label className="uk-form-label">Descuento (%)</label>
              <div className="uk-form-controls">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="uk-input"
                  value={form.discount}
                  onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="uk-margin">
          <div className="uk-flex uk-flex-left">
            <button type="submit" className="uk-button uk-button-primary" disabled={saving}>
              {initial.id ? 'Guardar' : 'Crear'}
            </button>
            {onCancel && (
              <button
                type="button"
                className="uk-button uk-button-default uk-margin-small-left"
                onClick={onCancel}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
