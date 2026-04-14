import React, {useState, useEffect, useCallback} from 'react';
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
import TrackingBoard from './pages/TrackingBoard.jsx';
import ItineraryConfig from './pages/ItineraryConfig.jsx';
import WorkSchedule from './pages/WorkSchedule.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import DraftOrderBanner from './components/DraftOrderBanner.jsx';
import { DraftOrderProvider } from './context/DraftOrderContext.jsx';
import { useDraftOrder } from './hooks/useDraftOrder.js';
import ForgotPassword from './pages/ForgotPassword.jsx';

// Wrapper for main content that adds padding when draft banner is visible
function AppMain({ children }) {
    const { bannerHeight } = useDraftOrder();
    return (
        <main className="app-main" style={bannerHeight > 0 ? { paddingBottom: bannerHeight + 8 } : undefined}>
            {children}
        </main>
    );
}
import ResetPassword from './pages/ResetPassword.jsx';
import PortalLogin from './pages/portal/PortalLogin.jsx';
import PortalVerify from './pages/portal/PortalVerify.jsx';
import PortalDashboard from './pages/portal/PortalDashboard.jsx';
import PortalOrders from './pages/portal/PortalOrders.jsx';
import PortalOrderDetail from './pages/portal/PortalOrderDetail.jsx';
import PortalInvoices from './pages/portal/PortalInvoices.jsx';
import { fetchConversations } from './api.js';


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
    const [unreadMsgCount, setUnreadMsgCount] = useState(0);
    const [adminMenuOpen, setAdminMenuOpen] = useState(false);

    // Mantener menú admin abierto si la ruta actual es de administración
    const adminPaths = ['/ventas', '/resenas', '/caja', '/horario', '/itinerarios'];
    useEffect(() => {
        if (adminPaths.some(p => location.pathname.startsWith(p))) {
            setAdminMenuOpen(true);
        }
    }, [location.pathname]);

    // Cerrar menú móvil al navegar
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);

    // Polling de mensajes no leídos para el badge del sidebar
    const loadUnreadCount = useCallback(async () => {
        if (!token || !user || (user.role !== 'admin' && user.role !== 'cashier')) return;
        try {
            const convs = await fetchConversations(token);
            const total = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
            setUnreadMsgCount(total);
        } catch (e) { /* silenciar */ }
    }, [token, user]);

    useEffect(() => {
        loadUnreadCount();
        const interval = setInterval(loadUnreadCount, 60000);
        return () => clearInterval(interval);
    }, [loadUnreadCount]);

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
        <DraftOrderProvider>
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
                        <li><NavLink to="/tracking"><span uk-icon="icon: bolt; ratio: 0.9"></span> Tracking</NavLink></li>
                        <li><NavLink to="/usuarios"><span uk-icon="icon: users; ratio: 0.9"></span> Usuarios</NavLink></li>
                        <li><NavLink to="/mensajes">
                            <span uk-icon="icon: comment; ratio: 0.9"></span> Mensajes
                            {unreadMsgCount > 0 && <span className="sidebar-badge">{unreadMsgCount}</span>}
                        </NavLink></li>
                        {token && user.role === 'admin' && (
                            <li className="sidebar-admin-group">
                                <button
                                    type="button"
                                    className={`sidebar-admin-toggle ${adminMenuOpen ? 'open' : ''}`}
                                    onClick={() => setAdminMenuOpen(o => !o)}
                                >
                                    <span uk-icon="icon: cog; ratio: 0.9"></span>
                                    Administración
                                    <span
                                        uk-icon={adminMenuOpen ? 'icon: chevron-down; ratio: 0.7' : 'icon: chevron-right; ratio: 0.7'}
                                        style={{ marginLeft: 'auto' }}
                                    ></span>
                                </button>
                                {adminMenuOpen && (
                                    <ul className="sidebar-admin-submenu">
                                        <li><NavLink to="/ventas"><span uk-icon="icon: credit-card; ratio: 0.8"></span> Ventas</NavLink></li>
                                        <li><NavLink to="/resenas"><span uk-icon="icon: star; ratio: 0.8"></span> Reseñas</NavLink></li>
                                        <li><NavLink to="/caja"><span uk-icon="icon: database; ratio: 0.8"></span> Caja</NavLink></li>
                                        <li><NavLink to="/horario"><span uk-icon="icon: calendar; ratio: 0.8"></span> Horario</NavLink></li>
                                        <li><NavLink to="/itinerarios"><span uk-icon="icon: settings; ratio: 0.8"></span> Itinerarios</NavLink></li>
                                    </ul>
                                )}
                            </li>
                        )}
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
            <AppMain>
                <ErrorBoundary>
                <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
                    <Route path="/dashboard" element={<Dashboard token={token} user={user}/>}/>
                    <Route path="/pos" element={<POS token={token} user={user}/>}/>
                    <Route path="/productos" element={<Inventory token={token}/>}/>
                    <Route path="/tareas" element={<Tasks token={token} user={user}/>}/>
                    <Route path="/tracking" element={<TrackingBoard token={token} user={user}/>}/>
                    <Route path="/usuarios" element={<Users token={token} user={user}/>}/>
                    <Route path="/usuarios/:id" element={<UserEdit token={token} user={user}/>}/>
                    <Route path="/mensajes" element={<Messages token={token} onUnreadCount={setUnreadMsgCount}/>}/>
                    <Route path="/ventas" element={<Ventas token={token}/>}/>
                    <Route path="/resenas" element={<Reviews token={token}/>}/>
                    <Route path="/caja" element={<CashAudit token={token}/>}/>
                    <Route path="/horario" element={<WorkSchedule token={token}/>}/>
                    <Route path="/itinerarios" element={<ItineraryConfig token={token}/>}/>
                    <Route path="*" element={<div style={{padding: 40, textAlign: 'center'}}>Ruta no encontrada</div>}/>
                    <Route path="/login" element={<Login onLogin={handleLogin}/>}/>
                </Routes>
                </ErrorBoundary>
            </AppMain>
            <DraftOrderBanner token={token} worker={user} />
        </div>
        </DraftOrderProvider>
    </AuthRedirect>);
}
