import React, {useEffect, useState} from 'react';
import {fetchUsers, createUser, updateUser} from '../api.js';

function UserForm({initial = {}, onSave, token, onCancel}) {
    const [form, setForm] = useState({
        firstName: initial.firstName || '',
        lastName: initial.lastName || '',
        email: initial.email || '',
        role: initial.role || 'cashier',
        phone: initial.phone || '',
        password: '',
        isActive: initial.isActive !== undefined ? initial.isActive : true,
    });
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        try {
            if (initial.id) {
                await updateUser(token, initial.id, form);
            } else {
                await createUser(token, form);
            }
            onSave();
        } catch (err) {
            setError(err.error || 'Fallo al guardar usuario');
        }
    };

    return (
        <div style={{border: '1px solid #888', padding: 12, borderRadius: 6, marginBottom: 12}}>
            <h4>{initial.id ? 'Editar usuario' : 'Nuevo usuario'}</h4>
            {error && <div style={{color: 'red'}}>{error}</div>}
            <form onSubmit={submit} style={{display: 'grid', gap: 8}}>
                <div>
                    <label>Nombre</label><br/>
                    <input value={form.firstName} onChange={e => setForm(f => ({...f, firstName: e.target.value}))}
                           required/>
                </div>
                <div>
                    <label>Apellidos</label><br/>
                    <input value={form.lastName} onChange={e => setForm(f => ({...f, lastName: e.target.value}))}
                           required/>
                </div>
                <div>
                    <label>Email</label><br/>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                           required/>
                </div>
                <div>
                    <label>Rol</label><br/>
                    <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}>
                        <option value="admin">Admin</option>
                        <option value="cashier">Cajero</option>
                        <option value="worker">Trabajador</option>
                    </select>
                </div>
                <div>
                    <label>Teléfono</label><br/>
                    <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))}/>
                </div>
                <div>
                    <label>Contraseña {initial.id ? '(dejar vacío para no cambiar)' : ''}</label><br/>
                    <input type="password" value={form.password}
                           onChange={e => setForm(f => ({...f, password: e.target.value}))}/>
                </div>
                <div>
                    <label>
                        <input
                            type="checkbox"
                            checked={form.isActive}
                            onChange={e => setForm(f => ({...f, isActive: e.target.checked}))}
                        />{' '}
                        Activo
                    </label>
                </div>
                <div style={{display: 'flex', gap: 8}}>
                    <button type="submit">{initial.id ? 'Guardar' : 'Crear'}</button>
                    {onCancel &&
                        <button type="button" onClick={onCancel} style={{background: '#999'}}>Cancelar</button>}
                </div>
            </form>
        </div>
    );
}

export default function Users({token}) {
    const [users, setUsers] = useState([]);
    const [editing, setEditing] = useState(null);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState('');

    const load = async () => {
        try {
            const u = await fetchUsers(token);
            setUsers(u);
        } catch (e) {
            setError('No se pudieron cargar usuarios');
        }
    };

    useEffect(() => {
        load();
    }, [token]);

    return (
        <div>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <h2>Usuarios</h2>
                <button onClick={() => {
                    setShowNew(true);
                    setEditing(null);
                }}>Nuevo usuario
                </button>
            </div>
            {error && <div style={{color: 'red'}}>{error}</div>}
            {showNew && (
                <UserForm
                    token={token}
                    onSave={() => {
                        load();
                        setShowNew(false);
                    }}
                    onCancel={() => setShowNew(false)}
                />
            )}
            {editing && (
                <UserForm
                    token={token}
                    initial={editing}
                    onSave={() => {
                        load();
                        setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                />
            )}
            <div style={{marginTop: 12}}>
                {users.map(u => (
                    <div key={u.id} style={{border: '1px solid #ccc', padding: 10, marginBottom: 6, borderRadius: 4}}>
                        <div>
                            <strong>{u.name}</strong> ({u.role}) – {u.email}
                        </div>
                        <div>Tel: {u.phone || '-'}</div>
                        <div>Activo: {u.isActive ? 'Sí' : 'No'}</div>
                        <button onClick={() => {
                            setEditing(u);
                            setShowNew(false);
                        }} style={{marginTop: 6}}>
                            Editar
                        </button>
                    </div>
                ))}
                {users.length === 0 && <div>No hay usuarios.</div>}
            </div>
        </div>
    );
}
