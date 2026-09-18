import React, { useState, useEffect } from 'react';
import { createUser, updateUser, fetchClientLoadProfile } from '../api.js';

// Días fijos de recogida y entrega de los grandes clientes (0=Dom..6=Sáb)
const DIAS = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const nombreDia = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado' };

const sectionStyle = {
  marginBottom: 20,
  paddingBottom: 16,
  borderBottom: '1px solid #e2e8f0',
};

const sectionTitle = {
  fontSize: '0.85rem',
  fontWeight: 700,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginBottom: 10,
  marginTop: 0,
};

export default function UserForm({ initial = {}, onSave, token, onCancel, loggedUser }) {
  const isEdit = Boolean(initial.id);
  const isAdmin = loggedUser?.role === 'admin';

  const [form, setForm] = useState({
    firstName: initial.firstName || '',
    lastName: initial.lastName || '',
    email: initial.email || '',
    role: initial.role || 'customer',
    phone: initial.phone || '',
    isActive: initial.isActive !== undefined ? Boolean(initial.isActive) : true,
    isbigclient: initial.isbigclient !== undefined ? Boolean(initial.isbigclient) : false,
    autoMonthlyInvoice: initial.autoMonthlyInvoice !== undefined ? Boolean(initial.autoMonthlyInvoice) : false,
    denominacionsocial: initial.denominacionsocial || '',
    nif: initial.nif || '',
    tipopersona: initial.tipopersona || '',
    direccion: initial.direccion || '',
    localidad: initial.localidad || '',
    provincia: initial.provincia || '',
    codigopostal: initial.codigopostal || '',
    pais: initial.pais || '',
    discount: typeof initial.discount === 'number' ? initial.discount : 0,
    notifyChannel: initial.notifyChannel || 'whatsapp',
    pickupDays: Array.isArray(initial.pickupDays) ? initial.pickupDays : [],
    deliveryDays: Array.isArray(initial.deliveryDays) ? initial.deliveryDays : [],
    expectedLoad: typeof initial.expectedLoad === 'number' ? initial.expectedLoad : 0,
  });

  // Cómo ha entregado este cliente en los últimos meses, para rellenar sus días fijos
  const [perfil, setPerfil] = useState(null);
  useEffect(() => {
    if (!isEdit || !form.isbigclient || !token) { setPerfil(null); return; }
    let vigente = true;
    fetchClientLoadProfile(token, initial.id)
      .then((p) => { if (vigente) setPerfil(p); })
      .catch(() => { if (vigente) setPerfil(null); });
    return () => { vigente = false; };
  }, [isEdit, form.isbigclient, token, initial.id]);

  const toggleDia = (campo, dia) => setForm(f => {
    const actual = new Set(f[campo]);
    if (actual.has(dia)) actual.delete(dia); else actual.add(dia);
    return { ...f, [campo]: [...actual].sort() };
  });
  const diasTexto = (conteo) => Object.entries(conteo || {})
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `${nombreDia[d]} (${n})`)
    .join(', ');

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isCustomer = form.role === 'customer';

  // Campos requeridos para emitir factura (validación de crearFactura)
  const invoiceReady =
    form.email.trim() !== '' &&
    (form.denominacionsocial.trim() !== '' || form.firstName.trim() !== '' || form.lastName.trim() !== '') &&
    form.direccion.trim() !== '' &&
    form.codigopostal.trim() !== '' &&
    form.localidad.trim() !== '';

  const set = (key, val) => {
    setForm(f => {
      const next = { ...f, [key]: val };
      // Si algún campo fiscal deja de cumplir, desactivar auto-facturación
      const nextReady =
        next.email.trim() !== '' &&
        (next.denominacionsocial.trim() !== '' || next.firstName.trim() !== '' || next.lastName.trim() !== '') &&
        next.direccion.trim() !== '' &&
        next.codigopostal.trim() !== '' &&
        next.localidad.trim() !== '';
      if (!nextReady && next.autoMonthlyInvoice) {
        next.autoMonthlyInvoice = false;
      }
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const d = Number(form.discount);
      if (isNaN(d) || d < 0 || d > 100) {
        setError('El descuento debe ser un número entre 0 y 100');
        setSaving(false);
        return;
      }

      // Contraseña: en alta es opcional; en edición solo se cambia si se rellena
      const wantsPassword = password.trim() !== '' || passwordConfirm.trim() !== '';
      if (wantsPassword) {
        if (password.length < 6) {
          setError('La contraseña debe tener al menos 6 caracteres');
          setSaving(false);
          return;
        }
        if (password !== passwordConfirm) {
          setError('Las contraseñas no coinciden');
          setSaving(false);
          return;
        }
      }

      const payload = { ...form, discount: d };
      if (!isAdmin) delete payload.role;
      if (wantsPassword) payload.password = password;
      else delete payload.password;
      if (isEdit) {
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

  const roleLabels = { admin: 'Admin', cashier: 'Cajero', worker: 'Trabajador', customer: 'Cliente' };

  return (
    <form onSubmit={submit} className="uk-form-stacked">
      {error && (
        <div className="uk-alert-danger" uk-alert="true" style={{ marginBottom: 12 }}>
          <p>{error}</p>
        </div>
      )}

      {/* ── Datos personales ── */}
      <div style={sectionStyle}>
        <h5 style={sectionTitle}>Datos personales</h5>
        <div className="uk-grid-small" uk-grid="true">
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Nombre *</label>
            <input className="uk-input" value={form.firstName}
              onChange={e => set('firstName', e.target.value)} required />
          </div>
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Apellidos *</label>
            <input className="uk-input" value={form.lastName}
              onChange={e => set('lastName', e.target.value)} required />
          </div>
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Email</label>
            <input type="email" autoComplete="off" className="uk-input" value={form.email}
              onChange={e => set('email', e.target.value)} />
          </div>
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">
              Teléfono{isCustomer ? ' *' : ''}
            </label>
            <input className="uk-input" value={form.phone}
              placeholder="612345678"
              onChange={e => set('phone', e.target.value)}
              onBlur={e => {
                // Normalizar al salir del campo: quitar prefijo +34 / 34 / 0034
                const raw = e.target.value.replace(/[\s\-().+]/g, '').replace(/\D/g, '');
                let normalized = raw;
                if (raw.startsWith('0034') && raw.length === 13) normalized = raw.slice(4);
                else if (raw.startsWith('34') && raw.length === 11) normalized = raw.slice(2);
                if (normalized !== form.phone) set('phone', normalized);
              }}
              required={isCustomer} />
          </div>
        </div>
      </div>

      {/* ── Configuración ── */}
      <div style={sectionStyle}>
        <h5 style={sectionTitle}>Configuración</h5>
        <div className="uk-grid-small" uk-grid="true">
          {isAdmin ? (
            <div className="uk-width-1-2@m">
              <label className="uk-form-label">Rol</label>
              <select className="uk-select" value={form.role}
                onChange={e => set('role', e.target.value)}>
                <option value="admin">Admin</option>
                <option value="cashier">Cajero</option>
                <option value="worker">Trabajador</option>
                <option value="customer">Cliente</option>
              </select>
            </div>
          ) : (
            <div className="uk-width-1-2@m">
              <label className="uk-form-label">Rol</label>
              <input className="uk-input" readOnly value={roleLabels[form.role] || form.role} style={{ background: '#f1f5f9' }} />
            </div>
          )}

          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Descuento (%)</label>
            <input type="number" min={0} max={100} step={1} className="uk-input"
              value={form.discount}
              onChange={e => set('discount', e.target.value)} />
          </div>

          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Canal de notificación</label>
            <select
              className="uk-select"
              value={form.notifyChannel}
              onChange={e => set('notifyChannel', e.target.value)}
            >
              <option value="whatsapp">WhatsApp (recomendado)</option>
              <option value="sms">SMS</option>
              <option value="none">No notificar</option>
            </select>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
              Canal preferido para avisos de pedido listo/recogido. Si WhatsApp falla, se reintenta por SMS automáticamente.
            </div>
          </div>

          <div className="uk-width-1-1">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className="uk-checkbox" type="checkbox" checked={form.isActive}
                  onChange={e => set('isActive', e.target.checked)} />
                Activo
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className="uk-checkbox" type="checkbox" checked={form.isbigclient}
                  onChange={e => set('isbigclient', e.target.checked)} />
                Tarifa Gran Cliente
              </label>
              {(form.role === 'customer' || form.isbigclient) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: invoiceReady ? 1 : 0.5 }}>
                    <input className="uk-checkbox" type="checkbox" checked={form.autoMonthlyInvoice}
                      disabled={!invoiceReady}
                      onChange={e => set('autoMonthlyInvoice', e.target.checked)} />
                    Facturación automática mensual
                  </label>
                  {!invoiceReady && (
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: 22 }}>
                      Requiere email, dirección, C.P. y localidad
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Recogida y entrega (grandes clientes con días fijos) ── */}
      {form.isbigclient && (
        <div style={sectionStyle}>
          <h5 style={sectionTitle}>Recogida y entrega</h5>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 10, maxWidth: 680 }}>
            El calendario del TPV reparte la carga semanal de este cliente entre sus días de entrega y la reserva aunque su pedido
            aún no se haya creado; la descuenta cuando entra. Así el día no se llena de particulares antes de recoger su ropa.
            Lo que se recoge un día se entrega en su siguiente día de entrega que quede a dos días laborables o más: cuando pasa
            la última recogida que llega a tiempo (a las 11:00), lo que no haya entrado ya no se reserva. Sin días de recogida
            marcados, la reserva no se libera.
            {perfil && perfil.entregas > 0 && (
              <> Según los últimos {perfil.meses} meses ({perfil.entregas} entregas en {perfil.semanas} semanas): entrega los {diasTexto(perfil.porDiaEntrega)};
                recoge los {diasTexto(perfil.porDiaRecogida)}; carga semanal habitual <strong>{perfil.cargaSemanalMediana}</strong>.</>
            )}
          </div>
          <div className="uk-grid-small" uk-grid="true">
            {[['pickupDays', 'Días de recogida'], ['deliveryDays', 'Días de entrega']].map(([campo, label]) => (
              <div className="uk-width-1-2@m" key={campo}>
                <label className="uk-form-label">{label}</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {DIAS.map(([dia, letra]) => {
                    const on = form[campo].includes(dia);
                    return (
                      <button type="button" key={dia} onClick={() => toggleDia(campo, dia)}
                        className={`uk-button uk-button-small ${on ? 'uk-button-primary' : 'uk-button-default'}`}
                        style={{ padding: '0 10px', minWidth: 34 }} aria-pressed={on} title={nombreDia[dia]}>
                        {letra}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="uk-width-1-2@m">
              <label className="uk-form-label">Carga semanal habitual</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input className="uk-input" type="number" min="0" step="0.5" style={{ width: 110 }}
                  value={form.expectedLoad}
                  onChange={e => set('expectedLoad', e.target.value)} />
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  camisas equivalentes a la semana (0 = sin reserva)
                  {Number(form.expectedLoad) > 0 && form.deliveryDays.length > 0 && (
                    <> · {(Number(form.expectedLoad) / form.deliveryDays.length).toLocaleString('es-ES', { maximumFractionDigits: 1 })} por día de entrega</>
                  )}
                </span>
                {perfil?.cargaSemanalMediana > 0 && Number(form.expectedLoad) !== perfil.cargaSemanalMediana && (
                  <button type="button" className="uk-button uk-button-text" style={{ fontSize: '0.75rem' }}
                    onClick={() => set('expectedLoad', perfil.cargaSemanalMediana)}>
                    Usar {perfil.cargaSemanalMediana}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Datos fiscales ── */}
      <div style={sectionStyle}>
        <h5 style={sectionTitle}>Datos fiscales</h5>
        <div className="uk-grid-small" uk-grid="true">
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Denominación social</label>
            <input className="uk-input" value={form.denominacionsocial}
              onChange={e => set('denominacionsocial', e.target.value)} />
          </div>
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">NIF</label>
            <input className="uk-input" value={form.nif}
              onChange={e => set('nif', e.target.value)} />
          </div>
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Tipo de persona</label>
            <select className="uk-select" value={form.tipopersona}
              onChange={e => set('tipopersona', e.target.value)}>
              <option value="">Selecciona tipo</option>
              <option value="Física">Física</option>
              <option value="Jurídica">Jurídica</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Dirección ── */}
      <div style={{ marginBottom: 16 }}>
        <h5 style={sectionTitle}>Dirección</h5>
        <div className="uk-grid-small" uk-grid="true">
          <div className="uk-width-1-1">
            <label className="uk-form-label">Dirección</label>
            <input className="uk-input" value={form.direccion}
              onChange={e => set('direccion', e.target.value)} />
          </div>
          <div className="uk-width-1-3@m">
            <label className="uk-form-label">Localidad</label>
            <input className="uk-input" value={form.localidad}
              onChange={e => set('localidad', e.target.value)} />
          </div>
          <div className="uk-width-1-3@m">
            <label className="uk-form-label">Provincia</label>
            <input className="uk-input" value={form.provincia}
              onChange={e => set('provincia', e.target.value)} />
          </div>
          <div className="uk-width-1-6@m">
            <label className="uk-form-label">C.P.</label>
            <input className="uk-input" value={form.codigopostal}
              onChange={e => set('codigopostal', e.target.value)} />
          </div>
          <div className="uk-width-1-6@m">
            <label className="uk-form-label">País</label>
            <input className="uk-input" value={form.pais}
              onChange={e => set('pais', e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Seguridad ── */}
      <div style={sectionStyle}>
        <h5 style={sectionTitle}>Seguridad</h5>
        <div className="uk-grid-small" uk-grid="true">
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">
              {isEdit ? 'Nueva contraseña' : 'Contraseña'}
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              className="uk-input"
              autoComplete="new-password"
              value={password}
              placeholder={isEdit ? 'Dejar en blanco para no cambiarla' : 'Mínimo 6 caracteres'}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="uk-width-1-2@m">
            <label className="uk-form-label">Repetir contraseña</label>
            <input
              type={showPassword ? 'text' : 'password'}
              className="uk-input"
              autoComplete="new-password"
              value={passwordConfirm}
              placeholder="Repite la contraseña"
              onChange={e => setPasswordConfirm(e.target.value)}
            />
          </div>
          <div className="uk-width-1-1">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#64748b' }}>
              <input className="uk-checkbox" type="checkbox" checked={showPassword}
                onChange={e => setShowPassword(e.target.checked)} />
              Mostrar contraseña
            </label>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
              {isEdit
                ? 'Rellena ambos campos solo si quieres restablecer la contraseña de este usuario.'
                : 'Opcional. Si lo dejas en blanco, el usuario se creará sin contraseña.'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Acciones ── */}
      <div className="uk-flex uk-flex-left" style={{ gap: 8 }}>
        <button type="submit" className="uk-button uk-button-primary" disabled={saving}>
          {saving ? 'Guardando...' : isEdit ? 'Guardar' : 'Crear'}
        </button>
        {onCancel && (
          <button type="button" className="uk-button uk-button-default" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
