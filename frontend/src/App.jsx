import React, {useState, useEffect} from 'react';
import {Routes, Route, NavLink, Navigate, useLocation} from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Tasks from './pages/Tasks';
import Inventory from './pages/Inventory';
import Users from './pages/Users';
import Ventas from './pages/Ventas';
import AuthRedirect from './components/AuthRedirect';
import UserEdit from './pages/UserEdit.jsx';
import Messages from './pages/Messages.jsx';
import Reviews from './pages/Reviews.jsx';
import CashAudit from './pages/CashAudit.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import PortalLogin from './pages/portal/PortalLogin.jsx';
import PortalVerify from './pages/portal/PortalVerify.jsx';
import PortalDashboard from './pages/portal/PortalDashboard.jsx';
import PortalOrders from './pages/portal/PortalOrders.jsx';
import PortalOrderDetail from './pages/portal/PortalOrderDetail.jsx';
import PortalInvoices from './pages/portal/PortalInvoices.jsx';


function PortalApp() {
    const [portalToken, setPortalToken] = useState(localStorage.getItem('portalToken') || '');
    const [portalUser, setPortalUser] = useState(JSON.parse(localStorage.getItem('portalUser') || 'null'));

    const handlePortalAuth = ({token, user}) => {
        setPortalToken(token);
        setPortalUser(user);
        localStorage.setItem('portalToken', token);
        localStorage.setItem('portalUser', JSON.stringify(user));
    };

    const handlePortalLogout = () => {
        setPortalToken('');
        setPortalUser(null);
        localStorage.removeItem('portalToken');
        localStorage.removeItem('portalUser');
    };

    return (
        <Routes>
            <Route path="login" element={<PortalLogin />} />
            <Route path="verify/:token" element={<PortalVerify onAuth={handlePortalAuth} />} />
            {portalToken && portalUser ? (
                <>
                    <Route index element={<PortalDashboard token={portalToken} user={portalUser} onLogout={handlePortalLogout} />} />
                    <Route path="orders" element={<PortalOrders token={portalToken} />} />
                    <Route path="orders/:id" element={<PortalOrderDetail token={portalToken} />} />
                    <Route path="invoices" element={<PortalInvoices token={portalToken} />} />
                </>
            ) : (
                <Route path="*" element={<Navigate to="/portal/login" replace />} />
            )}
        </Routes>
    );
}


export default function App() {
    const [token, setToken] = useState(localStorage.getItem('token') || '');
    const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
    const location = useLocation();

    useEffect(() => {
        const isTokenValid = token && token !== 'expired';
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

    // Rutas del portal: layout separado, sin sidebar ni UIkit nav
    if (location.pathname.startsWith('/portal')) {
        return (
            <Routes>
                <Route path="/portal/*" element={<PortalApp />} />
            </Routes>
        );
    }

    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Cerrar menú móvil al navegar
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);

    // Login: layout limpio, sin sidebar ni menú
    if (!token) {
        return (
            <Routes>
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="*" element={<Login onLogin={handleLogin}/>}/>
            </Routes>
        );
    }

    return (<AuthRedirect>
        <div className="app-layout">
            <nav className={`app-sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
                <div className="sidebar-inner">
                    <div className="sidebar-logo">
                        <img src="/logo.png" alt="Tinte y Burbuja"/>
                        <button
                            className="sidebar-hamburger"
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            type="button"
                        >
                            <span uk-icon={mobileMenuOpen ? 'icon: close; ratio: 1.2' : 'icon: menu; ratio: 1.2'}></span>
                        </button>
                    </div>
                    <ul className="sidebar-nav">
                        <li><NavLink to="/dashboard"><span uk-icon="icon: home; ratio: 0.9"></span> Dashboard</NavLink></li>
                        <li><NavLink to="/pos"><span uk-icon="icon: cart; ratio: 0.9"></span> POS</NavLink></li>
                        <li><NavLink to="/productos"><span uk-icon="icon: grid; ratio: 0.9"></span> Productos</NavLink></li>
                        <li><NavLink to="/tareas"><span uk-icon="icon: list; ratio: 0.9"></span> Tareas</NavLink></li>
                        <li><NavLink to="/usuarios"><span uk-icon="icon: users; ratio: 0.9"></span> Usuarios</NavLink></li>
                        {(user.role === 'admin' || user.role === 'cashier') && (
                            <li><NavLink to="/mensajes"><span uk-icon="icon: comment; ratio: 0.9"></span> Mensajes</NavLink></li>
                        )}
                        {token && user.role === 'admin' && (<>
                            <li><NavLink to="/ventas"><span uk-icon="icon: credit-card; ratio: 0.9"></span> Ventas</NavLink></li>
                            <li><NavLink to="/resenas"><span uk-icon="icon: star; ratio: 0.9"></span> Reseñas</NavLink></li>
                                <li><NavLink to="/caja"><span uk-icon="icon: database; ratio: 0.9"></span> Caja</NavLink></li>
                        </>)}
                    </ul>
                    <div className="sidebar-footer">
                        <div className="sidebar-user">
                            <div className="sidebar-user-avatar">{user?.firstName?.[0]}{user?.lastName?.[0]}</div>
                            <span className="sidebar-user-name">{user?.firstName}</span>
                        </div>
                        <button onClick={handleLogout} className="sidebar-logout-btn">
                            <span uk-icon="icon: sign-out; ratio: 0.85"></span>
                        </button>
                    </div>
                </div>
            </nav>
            <main className="app-main">
                <ErrorBoundary>
                <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
                    <Route path="/dashboard" element={<Dashboard token={token} user={user}/>}/>
                    <Route path="/pos" element={<POS token={token} user={user}/>}/>
                    <Route path="/productos" element={<Inventory token={token}/>}/>
                    <Route path="/tareas" element={<Tasks token={token} user={user}/>}/>
                    <Route path="/usuarios" element={<Users token={token} user={user}/>}/>
                    <Route path="/usuarios/:id" element={<UserEdit token={token} user={user}/>}/>
                    <Route path="/mensajes" element={<Messages token={token}/>}/>
                    <Route path="/ventas" element={<Ventas token={token}/>}/>
                    <Route path="/resenas" element={<Reviews token={token}/>}/>
                    <Route path="/caja" element={<CashAudit token={token}/>}/>
                    <Route path="*" element={<div style={{padding: 40, textAlign: 'center'}}>Ruta no encontrada</div>}/>
                    <Route path="/login" element={<Login onLogin={handleLogin}/>}/>
                </Routes>
                </ErrorBoundary>
            </main>
        </div>
    </AuthRedirect>);
}
