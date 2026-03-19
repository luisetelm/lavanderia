import React, { useState } from 'react';
import { resetPassword } from '../api.js';
import { Link, useSearchParams } from 'react-router-dom';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }
        if (password !== confirmPassword) {
            setError('Las contraseñas no coinciden');
            return;
        }

        setLoading(true);
        try {
            await resetPassword(token, password);
            setSuccess(true);
        } catch (err) {
            setError(err.error || 'Error al restablecer la contraseña');
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
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
                    textAlign: 'center',
                }}>
                    <div style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: 8,
                        padding: 16,
                        marginBottom: 20,
                    }}>
                        <strong style={{ color: '#dc2626' }}>Enlace inválido</strong>
                        <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#555' }}>
                            El enlace de restablecimiento no es válido. Solicita uno nuevo.
                        </p>
                    </div>
                    <Link to="/forgot-password" style={{ color: '#048ABF', fontSize: '0.9rem', textDecoration: 'none' }}>
                        Solicitar nuevo enlace
                    </Link>
                </div>
            </div>
        );
    }

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
                        Nueva contraseña
                    </h2>
                </div>

                {success ? (
                    <div>
                        <div style={{
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: 8,
                            padding: 16,
                            marginBottom: 20,
                            textAlign: 'center',
                        }}>
                            <span uk-icon="icon: check; ratio: 1.5" style={{ color: '#16a34a', marginBottom: 8, display: 'block' }}></span>
                            <strong style={{ color: '#15803d' }}>¡Contraseña actualizada!</strong>
                            <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#555' }}>
                                Tu contraseña se ha restablecido correctamente. Ya puedes iniciar sesión.
                            </p>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <Link
                                to="/login"
                                className="uk-button uk-button-primary"
                                style={{ textDecoration: 'none' }}
                            >
                                Ir al login
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

                        <div style={{ marginBottom: 16 }}>
                            <label style={{
                                display: 'block', marginBottom: 6, color: '#64748b',
                                fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                            }}>
                                Nueva contraseña
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={6}
                                autoComplete="new-password"
                                className="uk-input"
                                style={{ width: '100%' }}
                                autoFocus
                            />
                        </div>

                        <div style={{ marginBottom: 24 }}>
                            <label style={{
                                display: 'block', marginBottom: 6, color: '#64748b',
                                fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                            }}>
                                Confirmar contraseña
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                                minLength={6}
                                autoComplete="new-password"
                                className="uk-input"
                                style={{ width: '100%' }}
                            />
                        </div>

                        <button
                            type="submit"
                            className="uk-button uk-button-primary uk-width-1-1"
                            disabled={loading || !password || !confirmPassword}
                            style={{ padding: '10px', fontSize: '0.95rem', marginBottom: 16 }}
                        >
                            {loading ? 'Guardando...' : 'Restablecer contraseña'}
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

