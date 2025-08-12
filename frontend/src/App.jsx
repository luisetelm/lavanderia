import React, {useState} from 'react';
import {Routes, Route, NavLink, Navigate} from 'react-router-dom';
import Login from './pages/Login';
import POS from './pages/POS';
import Tasks from './pages/Tasks';
import Inventory from './pages/Inventory';
import Users from './pages/Users';
import AuthRedirect from './components/AuthRedirect';


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

    console.log(user);

    if (!token) {
        return <Login onLogin={handleLogin}/>;
    }

    return (<AuthRedirect>
        <div style={{display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif'}}>
            <nav>
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
                    </ul>
                </div>
                <div className={'logout'}>
                    <button onClick={handleLogout}
                            className={'uk-button uk-button-default uk-width-1-1'}>Salir {user?.firstName}</button>
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
                    <Route path="/login" element={<Login onLogin={handleLogin}/>}/>
                </Routes>
            </main>
        </div>
    </AuthRedirect>);
}
