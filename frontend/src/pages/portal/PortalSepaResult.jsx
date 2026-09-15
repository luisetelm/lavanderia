import React from 'react';
import { useSearchParams } from 'react-router-dom';

// Página a la que vuelve Stripe cuando el cliente firma (o abandona) la orden de
// domiciliación desde un enlace enviado desde su ficha. Es pública: el cliente
// no tiene por qué haber entrado al portal.

export default function PortalSepaResult() {
    const [searchParams] = useSearchParams();
    const ok = searchParams.get('estado') === 'ok';

    return (
        <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{
                background: '#fff', borderRadius: 8, padding: 24, maxWidth: 420, width: '100%',
                textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
            }}>
                <img src="/logo.png" alt="Tinte y Burbuja" style={{ height: 40, marginBottom: 16 }} />
                <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>
                    {ok ? 'Domiciliación registrada' : 'Domiciliación no completada'}
                </h2>
                <p style={{ fontSize: 14, color: '#555', margin: 0 }}>
                    {ok
                        ? 'Gracias. A partir de ahora tus facturas se cobrarán en tu cuenta bancaria y recibirás un email antes de cada cargo.'
                        : 'No se ha guardado ninguna domiciliación. Si quieres hacerlo más tarde, pídenos un enlace nuevo.'}
                </p>
            </div>
        </div>
    );
}
