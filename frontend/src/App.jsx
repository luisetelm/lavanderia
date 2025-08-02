import React, {useState} from 'react';
import {Routes, Route, NavLink, Navigate} from 'react-router-dom';
import Login from './pages/Login';
import POS from './pages/POS';
import Tasks from './pages/Tasks';
import Inventory from './pages/Inventory';
import Users from './pages/Users';


export default function App() {
    const [token, setToken] = useState(localStorage.getItem('token') || '');
    const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));

    const handleLogin = ({token, user}) => {
        setToken(token);
        setUser(user);
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
    };

    const handleLogout = () => {
        setToken('');
        setUser(null);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    };

    if (!token) {
        return <Login onLogin={handleLogin}/>;
    }

    return (
        <div style={{display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif'}}>
            <nav style={{
                width: 220,
                borderRight: '1px solid #ddd',
                padding: 16,
                background: '#f9f9f9',
                boxSizing: 'border-box'
            }}>
                <h2 style={{marginTop: 0}}>Lavandería</h2>
                <div style={{marginBottom: 16}}>
                    <div><strong>{user?.name}</strong></div>
                    <div style={{fontSize: 12, color: '#555'}}>{user?.role}</div>
                </div>
                <ul style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    gap: 8,
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <li>
                        <NavLink to="/pos" style={({isActive}) => ({
                            display: 'block',
                            padding: '8px 12px',
                            borderRadius: 4,
                            textDecoration: 'none',
                            background: isActive ? '#e0e7ff' : 'transparent',
                            color: '#1f2956'
                        })}>POS</NavLink>
                    </li>
                    <li>
                        <NavLink to="/productos" style={({isActive}) => ({
                            display: 'block',
                            padding: '8px 12px',
                            borderRadius: 4,
                            textDecoration: 'none',
                            background: isActive ? '#e0e7ff' : 'transparent',
                            color: '#1f2956'
                        })}>Productos</NavLink>
                    </li>
                    <li>
                        <NavLink to="/tareas" style={({isActive}) => ({
                            display: 'block',
                            padding: '8px 12px',
                            borderRadius: 4,
                            textDecoration: 'none',
                            background: isActive ? '#e0e7ff' : 'transparent',
                            color: '#1f2956'
                        })}>Tareas</NavLink>
                    </li>
                    <li>
                        <NavLink to="/usuarios" style={({isActive}) => ({ /* mismo estilo */
                            display: 'block',
                            padding: '8px 12px',
                            borderRadius: 4,
                            textDecoration: 'none',
                            background: isActive ? '#e0e7ff' : 'transparent',
                            color: '#1f2956'
                        })}>
                            Usuarios
                        </NavLink>
                    </li>
                </ul>
                <div style={{marginTop: 'auto'}}>
                    <button onClick={handleLogout} style={{marginTop: 16}}>Salir</button>
                </div>
            </nav>
            <main style={{flex: 1, padding: 20}}>
                <Routes>
                    <Route path="/" element={<Navigate to="/pos" replace/>}/>
                    <Route path="/pos" element={<POS token={token}/>}/>
                    <Route path="/productos" element={<Inventory token={token}/>}/>
                    <Route path="/tareas" element={<Tasks token={token}/>}/>
                    <Route path="/usuarios" element={<Users token={token}/>}/>
                    <Route path="*" element={<div>Ruta no encontrada</div>}/>
                </Routes>
            </main>
        </div>
    );
}
