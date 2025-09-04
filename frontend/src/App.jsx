import React, {useState, useEffect} from 'react';
import {Routes, Route, NavLink, Navigate} from 'react-router-dom';
import Login from './pages/Login';
import POS from './pages/POS';
import Tasks from './pages/Tasks';
import Inventory from './pages/Inventory';
import Users from './pages/Users';
import Ventas from './pages/Ventas';
import AuthRedirect from './components/AuthRedirect';


export default function App() {
    const [token, setToken] = useState(localStorage.getItem('token') || '');
    const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));

    useEffect(() => {
        // Simula la validación del token (puedes hacer una petición real aquí)
        const isTokenValid = token && token !== 'expired'; // Cambia esto por tu lógica real
        if (!isTokenValid) {
            setToken('');
            setUser(null);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    }, [token]);

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

    return (<AuthRedirect>
        <div className={'uk-container uk-container-expand'} uk-grid="true">
            <nav className={'uk-width-1-5@l'}>
                <div uk-sticky="top: 0; media: @l">
                    <div className={'logo'}>
                        <img src="/logo.png" alt="Logo lavandería"/>
                    </div>
                    <div className={'menu'}>
                        <ul className={'uk-nav uk-nav-primary uk-nav-divider'}>
                            <li>
                                <NavLink to="/pos">POS</NavLink>
                            </li>
                            <li>
                                <NavLink to="/productos">Productos</NavLink>
                            </li>
                            <li>
                                <NavLink to="/tareas">Tareas</NavLink>
                            </li>
                            <li>
                                <NavLink to="/usuarios">
                                    Usuarios
                                </NavLink>
                            </li>
                            {token && user.role === 'admin' && (
                                <li><NavLink to="/ventas">
                                    Ventas <icon uk-icon='lock'></icon>
                                </NavLink></li>)}
                        </ul>
                    </div>
                    <div className={'logout'}>
                        <button onClick={handleLogout}
                                className={'uk-button uk-button-default uk-width-1-1'}>Salir {user?.firstName}</button>
                    </div>
                </div>
            </nav>
            <main className={'uk-container uk-width-4-5@l uk-container-expand'}>
                <Routes>
                    <Route path="/" element={<Navigate to="/pos" replace/>}/>
                    <Route path="/pos" element={<POS token={token} user={user}/>}/>
                    <Route path="/productos" element={<Inventory token={token}/>}/>
                    <Route path="/tareas" element={<Tasks token={token} user={user}/>}/>
                    <Route path="/usuarios" element={<Users token={token}/>}/>
                    <Route path="/ventas" element={<Ventas token={token}/>}/>
                    <Route path="*" element={<div>Ruta no encontrada</div>}/>
                    <Route path="/login" element={<Login onLogin={handleLogin}/>}/>
                </Routes>
            </main>
        </div>
    </AuthRedirect>);
}
