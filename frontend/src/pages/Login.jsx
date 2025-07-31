import React, { useState } from 'react';
import { login } from '../api.js';

export default function Login({ onLogin }) {
    const [email, setEmail] = useState('admin@example.com');
    const [password, setPassword] = useState('password');
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        try {
            const resp = await login(email, password);
            onLogin(resp);
        } catch (err) {
            setError(err.error || 'Error en login');
        }
    };

    return (
        <div style={{ maxWidth: 400 }}>
            <h2>Acceso</h2>
            {error && <div style={{ color: 'red' }}>{error}</div>}
            <form onSubmit={submit}>
                <div>
                    <label>Email</label>
                    <input value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                <div>
                    <label>Contraseña</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                </div>
                <button type="submit" style={{ marginTop: 10 }}>Entrar</button>
            </form>
        </div>
    );
}
