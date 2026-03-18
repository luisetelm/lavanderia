import React, { useState } from 'react';
import { login } from '../api.js';
import { useNavigate } from 'react-router-dom';

export default function Login({ onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const submit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const resp = await login(email, password);
            onLogin(resp);
            navigate('/pos');
        } catch (err) {
            setError(err.error || 'Error en login');
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
                        Acceso empleados
                    </h2>
                </div>

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

                <form onSubmit={submit}>
                    <div style={{ marginBottom: 16 }}>
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
                            style={{ width: '100%' }}
                        />
                    </div>

                    <div style={{ marginBottom: 24 }}>
                        <label style={{
                            display: 'block', marginBottom: 6, color: '#64748b',
                            fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                        }}>
                            Contraseña
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            className="uk-input"
                            style={{ width: '100%' }}
                        />
                    </div>

                    <button
                        type="submit"
                        className="uk-button uk-button-primary uk-width-1-1"
                        disabled={loading}
                        style={{ padding: '10px', fontSize: '0.95rem' }}
                    >
                        {loading ? 'Entrando...' : 'Entrar'}
                    </button>
                </form>
            </div>
        </div>
    );
}
