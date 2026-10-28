import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { portalVerifyToken, portalVerifyCode } from '../../api.js';

// Entrada al portal desde un enlace: /portal/verify/<jwt> (SMS de acceso y
// tickets antiguos) o /portal/codigo/<código> (QR del ticket de cliente, que
// lleva directamente al pedido del ticket).
export default function PortalVerify({ onAuth }) {
    const { token, code } = useParams();
    const navigate = useNavigate();
    const [error, setError] = useState('');

    useEffect(() => {
        if (!token && !code) return;
        (code ? portalVerifyCode(code) : portalVerifyToken(token))
            .then(({ token: sessionToken, user, orderId }) => {
                onAuth({ token: sessionToken, user });
                navigate(orderId ? `/portal/orders/${orderId}` : '/portal', { replace: true });
            })
            .catch((err) => {
                setError(err.error || 'Enlace inválido o expirado');
            });
    }, [token, code]);

    if (error) {
        return (
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f8f8f8',
                padding: 16
            }}>
                <div style={{
                    background: '#fff',
                    borderRadius: 12,
                    padding: '32px 24px',
                    maxWidth: 400,
                    width: '100%',
                    textAlign: 'center',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.08)'
                }}>
                    <div style={{ color: '#d32f2f', marginBottom: 16, fontSize: 18, fontWeight: 600 }}>
                        Enlace no válido
                    </div>
                    <p style={{ color: '#666', fontSize: 14 }}>{error}</p>
                    <button
                        className="uk-button uk-button-primary"
                        onClick={() => navigate('/portal/login')}
                    >
                        Solicitar nuevo enlace
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <div>Verificando acceso...</div>
        </div>
    );
}
