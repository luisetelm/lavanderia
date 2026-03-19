import React, { useState } from 'react';
import { forgotPassword } from '../api.js';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        setLoading(true);
        setError('');
        try {
            await forgotPassword(email.trim());
            setSent(true);
        } catch (err) {
            setError(err.error || 'Error al enviar la solicitud');
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
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            padding: 16,
        }}>
            <div style={{
                background: '#fff',
                padding: '40px 32px',
                borderRadius: 16,
                boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
                width: '100%',
                maxWidth: 400,
            }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <img src="/logo.png" alt="Tinte y Burbuja" style={{ height: 56, marginBottom: 16 }} />
                    <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b', fontWeight: 600 }}>
                        Recuperar contraseña
                    </h2>
                    <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                        Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
                    </p>
                </div>

                {sent ? (
                    <div>
                        <div style={{
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: 8,
                            padding: 16,
                            marginBottom: 20,
                            textAlign: 'center',
                        }}>
                            <span uk-icon="icon: mail; ratio: 1.5" style={{ color: '#16a34a', marginBottom: 8, display: 'block' }}></span>
                            <strong style={{ color: '#15803d' }}>Correo enviado</strong>
                            <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#555' }}>
                                Si existe una cuenta con ese email, recibirás un correo con instrucciones para restablecer tu contraseña.
                            </p>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <Link to="/login" style={{ color: '#048ABF', fontSize: '0.9rem', textDecoration: 'none' }}>
                                ← Volver al login
                            </Link>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        {error && (
                            <div style={{
                                background: '#fef2f2',
                                color: '#dc2626',
                                padding: '10px 14px',
                                borderRadius: 8,
                                marginBottom: 16,
                                fontSize: '0.85rem',
                                border: '1px solid #fecaca',
                            }}>
                                {error}
                            </div>
                        )}

                        <div style={{ marginBottom: 20 }}>
                            <label style={{
                                display: 'block', marginBottom: 6, color: '#64748b',
                                fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                            }}>
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                                className="uk-input"
                                placeholder="tu@email.com"
                                style={{ width: '100%' }}
                                autoFocus
                            />
                        </div>

                        <button
                            type="submit"
                            className="uk-button uk-button-primary uk-width-1-1"
                            disabled={loading || !email.trim()}
                            style={{ padding: '10px', fontSize: '0.95rem', marginBottom: 16 }}
                        >
                            {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
                        </button>

                        <div style={{ textAlign: 'center' }}>
                            <Link to="/login" style={{ color: '#048ABF', fontSize: '0.9rem', textDecoration: 'none' }}>
                                ← Volver al login
                            </Link>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

