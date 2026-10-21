import React, {useState, useEffect, useRef, useCallback} from 'react';
import {fetchUser, updateDatosFactura} from '../api.js';
import {registrarDatosFactura} from '../utils/datosFactura.js';

// Formulario "Faltan datos para la factura". Se monta una vez en App y lo abre
// conDatosFactura() (utils/datosFactura.js) cuando el backend rechaza una
// factura normal por datos del cliente: se completan ahí mismo, se guardan y
// la factura se emite sin salir de la pantalla.

const CAMPOS = ['denominacionsocial', 'nif', 'firstName', 'lastName', 'email',
    'direccion', 'codigopostal', 'localidad', 'provincia'];

const vacio = (v) => !v || String(v).trim() === '';

// Misma regla que backend/src/utils/datosFactura.js (faltanDatosFactura).
function faltan(f) {
    const r = [];
    if (vacio(f.denominacionsocial) && vacio(f.firstName) && vacio(f.lastName)) r.push('nombre');
    if (vacio(f.email)) r.push('email');
    if (vacio(f.direccion)) r.push('direccion');
    if (vacio(f.codigopostal)) r.push('codigopostal');
    if (vacio(f.localidad)) r.push('localidad');
    return r;
}

export default function DatosFacturaHost() {
    const [estado, setEstado] = useState(null);   // {token, clientId, missing}
    const [form, setForm] = useState(null);
    const [error, setError] = useState('');
    const [guardando, setGuardando] = useState(false);
    const resolver = useRef(null);
    const primerCampo = useRef(null);

    const abrir = useCallback((opciones) => new Promise((resolve) => {
        resolver.current = resolve;
        setError('');
        setForm(null);
        setEstado(opciones);
    }), []);

    useEffect(() => { registrarDatosFactura(abrir); }, [abrir]);

    const cerrar = useCallback((resultado) => {
        setEstado(null);
        setForm(null);
        const r = resolver.current;
        resolver.current = null;
        if (r) r(resultado);
    }, []);

    // Carga la ficha para no pisar lo que ya tiene y enseñar lo que falta.
    useEffect(() => {
        if (!estado) return;
        let vigente = true;
        fetchUser(estado.token, estado.clientId)
            .then((u) => {
                if (!vigente) return;
                const datos = u?.data ?? u ?? {};
                setForm(Object.fromEntries(CAMPOS.map((c) => [c, datos[c] ?? ''])));
            })
            .catch(() => {
                if (vigente) setForm(Object.fromEntries(CAMPOS.map((c) => [c, ''])));
            });
        return () => { vigente = false; };
    }, [estado]);

    useEffect(() => {
        if (!estado) return;
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [estado, cerrar]);

    useEffect(() => {
        if (form) primerCampo.current?.focus();
    }, [form === null]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!estado) return null;

    const pendientes = form ? faltan(form) : estado.missing;
    const marca = (clave) => pendientes.includes(clave);
    const set = (k) => (e) => setForm((f) => ({...f, [k]: e.target.value}));

    const guardar = async (e) => {
        e.preventDefault();
        if (!form) return;
        if (pendientes.length) {
            setError('Rellena los campos marcados para poder emitir la factura.');
            return;
        }
        setGuardando(true);
        setError('');
        try {
            const res = await updateDatosFactura(estado.token, estado.clientId, form);
            if (res?.missing?.length) {
                setError('Todavía faltan datos para la factura.');
                return;
            }
            cerrar(true);
        } catch (err) {
            setError(err.error || 'No se pudieron guardar los datos del cliente.');
        } finally {
            setGuardando(false);
        }
    };

    // El primer campo que falta recibe el foco.
    const orden = ['nombre', 'email', 'direccion', 'codigopostal', 'localidad'];
    const primero = orden.find(marca);
    const refSi = (clave) => (clave === primero ? primerCampo : undefined);

    const campo = (clave, etiqueta, k, props = {}) => (
        <div style={{flex: props.flex || '1 1 100%', minWidth: 0}}>
            <label className="uk-form-label" style={{fontSize: 12}}>
                {etiqueta}{clave && marca(clave) && <span style={{color: 'var(--tyb-danger)'}}> · falta</span>}
            </label>
            <input
                ref={refSi(clave)}
                className={`uk-input uk-form-small ${clave && marca(clave) ? 'uk-form-danger' : ''}`}
                value={form[k]}
                onChange={set(k)}
                type={props.type || 'text'}
                inputMode={props.inputMode}
                autoComplete="off"
            />
        </div>
    );

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="datos-factura-titulo"
            onClick={(e) => { if (e.target === e.currentTarget) cerrar(false); }}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1010,
            }}
        >
            <form onSubmit={guardar} style={{
                background: 'var(--tyb-bg, #fff)', borderRadius: 8, width: 520, maxWidth: '94vw',
                maxHeight: '92vh', overflowY: 'auto',
                padding: '20px 22px', boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            }}>
                <h4 id="datos-factura-titulo" style={{margin: '0 0 4px'}}>Faltan datos para la factura</h4>
                <p style={{margin: '0 0 14px', fontSize: 13, color: 'var(--tyb-neutral-600)'}}>
                    Complétalos aquí: se guardan en la ficha del cliente y la factura se emite al momento.
                </p>

                {!form ? (
                    <div style={{padding: '24px 0', textAlign: 'center'}}><span uk-spinner="ratio: 0.8"></span></div>
                ) : (
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '10px 12px'}}>
                        {campo('nombre', 'Nombre', 'firstName', {flex: '1 1 45%'})}
                        {campo('nombre', 'Apellidos', 'lastName', {flex: '1 1 45%'})}
                        {campo('nombre', 'Razón social (empresa)', 'denominacionsocial', {flex: '1 1 60%'})}
                        {campo(null, 'NIF / CIF', 'nif', {flex: '1 1 30%'})}
                        {campo('email', 'Email (se le envía la factura)', 'email', {type: 'email'})}
                        {campo('direccion', 'Dirección', 'direccion')}
                        {campo('codigopostal', 'C.P.', 'codigopostal', {flex: '1 1 20%', inputMode: 'numeric'})}
                        {campo('localidad', 'Localidad', 'localidad', {flex: '1 1 40%'})}
                        {campo(null, 'Provincia', 'provincia', {flex: '1 1 30%'})}
                    </div>
                )}

                {error && (
                    <div className="uk-alert-danger uk-margin-small-top" uk-alert="" style={{padding: '8px 12px', fontSize: 13}}>
                        {error}
                    </div>
                )}

                <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18}}>
                    <button type="button" className="uk-button uk-button-default" onClick={() => cerrar(false)}>
                        Cancelar
                    </button>
                    <button type="submit" className="uk-button uk-button-primary" disabled={!form || guardando}>
                        {guardando ? 'Guardando…' : 'Guardar y emitir factura'}
                    </button>
                </div>
            </form>
        </div>
    );
}
