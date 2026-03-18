import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { portalVerifyToken } from '../../api.js';

export default function PortalVerify({ onAuth }) {
    const { token } = useParams();
    const navigate = useNavigate();
    const [error, setError] = useState('');

    useEffect(() => {
        if (!token) return;
        portalVerifyToken(token)
            .then(({ token: sessionToken, user }) => {
                onAuth({ token: sessionToken, user });
                navigate('/portal', { replace: true });
            })
            .catch((err) => {
                setError(err.error || 'Enlace inválido o expirado');
            });
    }, [token]);

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
