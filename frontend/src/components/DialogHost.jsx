import React, {useState, useEffect, useRef, useCallback} from 'react';
import {registrarDialogo} from '../utils/dialogo.js';

// Pinta el diálogo de confirmación de la aplicación. Se monta una sola vez en
// App y se abre desde cualquier sitio con confirmar() (ver utils/dialogo.js).
//
// A diferencia del confirm() nativo, "Cancelar" queda a la izquierda y con
// aspecto de opción segura, y la acción destructiva se pinta en rojo: en el
// mostrador hay prisa, y la salida tiene que verse antes que el botón que
// borra algo.
export default function DialogHost() {
    const [estado, setEstado] = useState(null);   // {mensaje, titulo, ...}
    const resolver = useRef(null);
    const botonRef = useRef(null);

    const abrir = useCallback((opciones) => new Promise((resolve) => {
        resolver.current = resolve;
        setEstado(opciones);
    }), []);

    useEffect(() => { registrarDialogo(abrir); }, [abrir]);

    const cerrar = useCallback((resultado) => {
        setEstado(null);
        const r = resolver.current;
        resolver.current = null;
        if (r) r(resultado);
    }, []);

    // El foco va a Cancelar: si alguien pulsa Intro por inercia, no se ejecuta
    // la acción. Escape también cancela.
    useEffect(() => {
        if (!estado) return;
        botonRef.current?.focus();
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [estado, cerrar]);

    if (!estado) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => { if (e.target === e.currentTarget) cerrar(false); }}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1010,
            }}
        >
            <div style={{
                background: '#fff', borderRadius: 8, width: 420, maxWidth: '92vw',
                padding: '20px 22px', boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            }}>
                {estado.titulo && (
                    <h4 style={{margin: '0 0 8px'}}>{estado.titulo}</h4>
                )}
                <div style={{fontSize: 14, color: '#334155', whiteSpace: 'pre-line'}}>
                    {estado.mensaje}
                </div>

                <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20}}>
                    <button
                        ref={botonRef}
                        className="uk-button uk-button-default"
                        onClick={() => cerrar(false)}
                    >
                        {estado.textoCancelar}
                    </button>
                    <button
                        className={`uk-button ${estado.peligroso ? 'uk-button-danger' : 'uk-button-primary'}`}
                        onClick={() => cerrar(true)}
                    >
                        {estado.textoConfirmar}
                    </button>
                </div>
            </div>
        </div>
    );
}
