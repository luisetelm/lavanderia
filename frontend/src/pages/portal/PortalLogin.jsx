import React, { useState } from 'react';
import { portalRequestAccess } from '../../api.js';

export default function PortalLogin() {
    const [phone, setPhone] = useState('');
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!phone.trim()) return;
        setLoading(true);
        setError('');
        try {
            await portalRequestAccess(phone.trim());
            setSent(true);
        } catch (err) {
            setError(err.error || 'Error al solicitar acceso');
        } finally {
            setLoading(false);
        }
    };

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
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)'
            }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <img src="/logo.png" alt="Tinte y Burbuja" style={{ height: 48, marginBottom: 12 }} />
                    <h2 style={{ margin: 0, fontSize: 20 }}>Portal de cliente</h2>
                </div>

                {sent ? (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{
                            background: '#e8f5e9',
                            borderRadius: 8,
                            padding: 16,
                            marginBottom: 16
                        }}>
                            <strong>SMS enviado</strong>
                            <p style={{ margin: '8px 0 0', fontSize: 14, color: '#555' }}>
                                Si existe una cuenta con ese teléfono, recibirás un enlace de acceso por SMS.
                            </p>
                        </div>
                        <button
                            onClick={() => { setSent(false); setPhone(''); }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#048ABF',
                                cursor: 'pointer',
                                fontSize: 14
                            }}
                        >
                            Intentar con otro número
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
                            Teléfono
                        </label>
                        <input
                            type="tel"
                            className="uk-input"
                            placeholder="Ej: 612345678"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            style={{ marginBottom: 16 }}
                            autoFocus
                        />
                        {error && (
                            <div style={{ color: '#d32f2f', fontSize: 13, marginBottom: 12 }}>{error}</div>
                        )}
                        <button
                            type="submit"
                            className="uk-button uk-button-primary uk-width-1-1"
                            disabled={loading || !phone.trim()}
                        >
                            {loading ? 'Enviando...' : 'Enviar enlace de acceso'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
