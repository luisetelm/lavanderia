import React, { useState } from 'react';
import { login } from '../api.js';
import { useNavigate } from 'react-router-dom';

export default function Login({ onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const submit = async (e) => {
        e.preventDefault();
        try {
            const resp = await login(email, password);
            onLogin(resp);
            navigate('/pos'); // Redirige a la página de inicio (POS)
        } catch (err) {
            setError(err.error || 'Error en login');
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f9f9f9',
            fontFamily: 'system-ui, sans-serif'
        }}>
            <div style={{
                backgroundColor: 'white',
                padding: '2rem',
                borderRadius: '8px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                width: '100%',
                maxWidth: '400px',
            }}>
                <h2 style={{
                    marginTop: 0,
                    marginBottom: '1.5rem',
                    color: '#4f46e5',
                    textAlign: 'center',
                    fontSize: '1.75rem'
                }}>
                    Tinte y Burbuja - Acceso
                </h2>
                
                {error && (
                    <div style={{
                        backgroundColor: '#fee2e2',
                        color: '#dc2626',
                        padding: '0.75rem',
                        borderRadius: '4px',
                        marginBottom: '1rem',
                        fontSize: '0.875rem'
                    }}>
                        {error}
                    </div>
                )}
                
                <form onSubmit={submit}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '0.5rem',
                            color: '#4f46e5',
                            fontSize: '0.875rem',
                            fontWeight: '500'
                        }}>
                            Email
                        </label>
                        <input 
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: '4px',
                                border: '1px solid #d1d5db',
                                fontSize: '1rem',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>
                    
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '0.5rem',
                            color: '#4b5563',
                            fontSize: '0.875rem',
                            fontWeight: '500'
                        }}>
                            Contraseña
                        </label>
                        <input 
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: '4px',
                                border: '1px solid #d1d5db',
                                fontSize: '1rem',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>
                    
                    <button 
                        type="submit"
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            backgroundColor: '#4f46e5',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '1rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                        }}
                        onMouseOver={e => e.target.style.backgroundColor = '#283366'}
                        onMouseOut={e => e.target.style.backgroundColor = '#1f2956'}
                    >
                        Entrar
                    </button>
                </form>
            </div>
        </div>
    );
}
