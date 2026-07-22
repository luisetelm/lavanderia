import React, {useState, useEffect, useCallback, useRef} from 'react';
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
import TrackingWorkshop from './pages/TrackingWorkshop.jsx';
import ItineraryConfig from './pages/ItineraryConfig.jsx';
import ResourceConfig from './pages/ResourceConfig.jsx';
import WorkSchedule from './pages/WorkSchedule.jsx';
import Stats from './pages/Stats.jsx';
import WorkerPerformance from './pages/WorkerPerformance.jsx';
import LoginLogs from './pages/LoginLogs.jsx';
import Campaigns from './pages/Campaigns.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import DraftOrderBanner from './components/DraftOrderBanner.jsx';
import { DraftOrderProvider } from './context/DraftOrderContext.jsx';
import { useDraftOrder } from './hooks/useDraftOrder.js';
import ForgotPassword from './pages/ForgotPassword.jsx';
import OrderLookup from './pages/OrderLookup.jsx';
import PrintSettings from './pages/PrintSettings.jsx';
import ScanCapture from './components/ScanCapture.jsx';
import DialogHost from './components/DialogHost.jsx';
import PrintQueueWatcher from './components/PrintQueueWatcher.jsx';

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
import { fetchConversations, fetchMe } from './api.js';


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

    return (<>
        <DialogHost />
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
        </>
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

    // Si el user en localStorage está incompleto (sesión antigua sin firstName/lastName),
    // refrescamos los datos desde /auth/me.
    useEffect(() => {
        if (!token || token === 'expired') return;
        if (user && user.firstName && user.lastName) return;
        fetchMe(token)
            .then(fresh => {
                setUser(fresh);
                localStorage.setItem('user', JSON.stringify(fresh));
            })
            .catch(() => { /* ignorar; si el token es inválido ya se limpia en el otro effect */ });
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
    const adminPaths = ['/ventas', '/estadisticas', '/resenas', '/caja', '/horario', '/itinerarios', '/recursos', '/accesos', '/campanas', '/tracking/supervision'];
    useEffect(() => {
        if (adminPaths.some(p => location.pathname.startsWith(p))) {
            setAdminMenuOpen(true);
        }
    }, [location.pathname]);

    // Inicio de cada rol: también es a donde se devuelve a quien entra por URL
    // a una ruta de administración que no le corresponde.
    const homePath = user?.role === 'worker' ? '/tracking' : '/dashboard';
    const soloAdmin = (elemento) => user?.role === 'admin' ? elemento : <Navigate to={homePath} replace/>;

    // Cerrar menú móvil al navegar
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);

    // Polling de mensajes no leídos para el badge del sidebar
    // Además: detecta mensajes entrantes nuevos para emitir sonido + notificación persistente.
    const prevConvStateRef = useRef(null); // Map<convId, {unread, lastAt}>
    const initialLoadDoneRef = useRef(false);
    const audioCtxRef = useRef(null);

    // Pedir permiso de notificaciones del navegador una vez
    useEffect(() => {
        if (!token || !user || (user.role !== 'admin' && user.role !== 'cashier')) return;
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        if (Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    }, [token, user]);

    // Beep sintetizado con Web Audio API (sin necesidad de ficheros)
    const playBeep = useCallback(() => {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});

            const playTone = (freq, start, dur) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
                gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
                osc.connect(gain).connect(ctx.destination);
                osc.start(ctx.currentTime + start);
                osc.stop(ctx.currentTime + start + dur + 0.02);
            };
            // Doble tono tipo "ding-dong" tipo WhatsApp
            playTone(880, 0, 0.18);
            playTone(660, 0.20, 0.22);
        } catch (e) { /* silenciar */ }
    }, []);

    const showWhatsAppNotification = useCallback((conv) => {
        try {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            const name = (conv.firstName || conv.lastName)
                ? `${conv.firstName || ''} ${conv.lastName || ''}`.trim()
                : `+${conv.phone || 'Desconocido'}`;
            const body = conv.lastMessage || 'Nuevo mensaje';
            const isWa = conv.lastChannel === 'whatsapp';
            const n = new Notification(`${isWa ? '💬 WhatsApp' : '📩 SMS'} · ${name}`, {
                body: body.length > 140 ? body.slice(0, 137) + '…' : body,
                icon: '/logo.png',
                tag: `conv-${conv.id}`,
                requireInteraction: true, // No se cierra hasta que el usuario la cierra/click
                renotify: true,
            });
            n.onclick = () => {
                try {
                    window.focus();
                    window.location.hash = '';
                    // Navegar a /mensajes
                    if (!window.location.pathname.startsWith('/mensajes')) {
                        window.history.pushState({}, '', '/mensajes');
                        window.dispatchEvent(new PopStateEvent('popstate'));
                    }
                } catch { /* noop */ }
                n.close();
            };
        } catch (e) { /* silenciar */ }
    }, []);

    const loadUnreadCount = useCallback(async () => {
        if (!token || !user || (user.role !== 'admin' && user.role !== 'cashier')) return;
        try {
            const convs = await fetchConversations(token);
            const total = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
            setUnreadMsgCount(total);

            // Detectar incrementos de unread / nuevos mensajes inbound
            const prev = prevConvStateRef.current;
            const next = new Map();
            const newOnes = [];
            for (const c of convs) {
                const lastAt = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
                next.set(c.id, { unread: c.unreadCount || 0, lastAt });
                if (initialLoadDoneRef.current && prev) {
                    const p = prev.get(c.id);
                    const isNewer = !p || lastAt > p.lastAt;
                    const unreadIncreased = (c.unreadCount || 0) > (p?.unread || 0);
                    // Solo si hay un mensaje entrante nuevo (unread sube) y es más reciente
                    if (unreadIncreased && isNewer && c.lastDirection === 'inbound') {
                        newOnes.push(c);
                    }
                }
            }
            prevConvStateRef.current = next;
            initialLoadDoneRef.current = true;

            if (newOnes.length > 0) {
                playBeep();
                // Mostrar una notificación por conversación (máx 3 para evitar spam)
                newOnes.slice(0, 3).forEach(showWhatsAppNotification);
            }
        } catch (e) { /* silenciar */ }
    }, [token, user, playBeep, showWhatsAppNotification]);

    useEffect(() => {
        loadUnreadCount();
        const interval = setInterval(loadUnreadCount, 15000);
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
            <ScanCapture />
            <DialogHost />
            <PrintQueueWatcher token={token} />
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
                            {/* Badge visible solo en móvil cuando el menú está cerrado:
                                avisa de mensajes sin leer aunque el sidebar esté colapsado. */}
                            {unreadMsgCount > 0 && !mobileMenuOpen && (
                                <span className="hamburger-badge">{unreadMsgCount}</span>
                            )}
                        </button>
                    </div>
                    <ul className="sidebar-nav">
                        <li><NavLink to="/dashboard"><span uk-icon="icon: home; ratio: 0.9"></span> Dashboard</NavLink></li>
                        <li><NavLink to="/pos"><span uk-icon="icon: cart; ratio: 0.9"></span> POS</NavLink></li>
                        <li><NavLink to="/productos"><span uk-icon="icon: grid; ratio: 0.9"></span> Productos</NavLink></li>
                        <li><NavLink to="/tareas"><span uk-icon="icon: list; ratio: 0.9"></span> Tareas</NavLink></li>
                        {/* 'end' para que /tracking/supervision no marque también este enlace */}
                        <li><NavLink to="/tracking" end><span uk-icon="icon: bolt; ratio: 0.9"></span> Taller</NavLink></li>
                        <li><NavLink to="/usuarios"><span uk-icon="icon: users; ratio: 0.9"></span> Usuarios</NavLink></li>
                        {/* Impresión es configuración DEL DISPOSITIVO (qué imprime este
                            equipo, y si manda a la cola). La tablet del taller la usan
                            trabajadores, así que no puede ser sólo de administración. */}
                        <li><NavLink to="/impresion"><span uk-icon="icon: print; ratio: 0.9"></span> Impresión</NavLink></li>
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
                                        <li><NavLink to="/tracking/supervision"><span uk-icon="icon: bolt; ratio: 0.8"></span> Tracking (supervisión)</NavLink></li>
                                        <li><NavLink to="/estadisticas"><span uk-icon="icon: bolt; ratio: 0.8"></span> Estadísticas</NavLink></li>
                                        <li><NavLink to="/rendimiento"><span uk-icon="icon: users; ratio: 0.8"></span> Rendimiento</NavLink></li>
                                        <li><NavLink to="/resenas"><span uk-icon="icon: star; ratio: 0.8"></span> Reseñas</NavLink></li>
                                        <li><NavLink to="/campanas"><span uk-icon="icon: bell; ratio: 0.8"></span> Campañas</NavLink></li>
                                        <li><NavLink to="/caja"><span uk-icon="icon: database; ratio: 0.8"></span> Caja</NavLink></li>
                                        <li><NavLink to="/horario"><span uk-icon="icon: calendar; ratio: 0.8"></span> Horario</NavLink></li>
                                        <li><NavLink to="/itinerarios"><span uk-icon="icon: settings; ratio: 0.8"></span> Itinerarios</NavLink></li>
                                        <li><NavLink to="/recursos"><span uk-icon="icon: cog; ratio: 0.8"></span> Recursos</NavLink></li>
                                        <li><NavLink to="/accesos"><span uk-icon="icon: sign-in; ratio: 0.8"></span> Accesos</NavLink></li>
                                    </ul>
                                )}
                            </li>
                        )}
                    </ul>
                    <div className="sidebar-footer">
                        <div className="sidebar-user">
                            <div className="sidebar-user-avatar">{user?.firstName?.[0]}{user?.lastName?.[0]}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
                                <span className="sidebar-user-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {user?.firstName} {user?.lastName}
                                </span>
                                {user?.role && (
                                    <span style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'capitalize' }}>
                                        {user.role === 'admin' ? 'Administrador/a'
                                            : user.role === 'cashier' ? 'Cajero/a'
                                            : user.role === 'worker' ? 'Trabajador/a'
                                            : user.role}
                                    </span>
                                )}
                            </div>
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
                    {/* El trabajador entra directo al taller: un panel de métricas no
                        le sirve de nada con una prenda en la mano. Es también el
                        destino al que se devuelve a quien entra por URL a una
                        ruta que no le corresponde. */}
                    <Route path="/" element={<Navigate to={homePath} replace/>}/>
                    <Route path="/dashboard" element={<Dashboard token={token} user={user}/>}/>
                    <Route path="/pos" element={<POS token={token} user={user}/>}/>
                    <Route path="/productos" element={<Inventory token={token}/>}/>
                    <Route path="/tareas" element={<Tasks token={token} user={user}/>}/>
                    <Route path="/buscar-pedido" element={<OrderLookup token={token}/>}/>
                    <Route path="/tracking" element={<TrackingWorkshop token={token} user={user}/>}/>
                    <Route path="/tracking/supervision" element={soloAdmin(<TrackingBoard token={token} user={user}/>)}/>
                    <Route path="/usuarios" element={<Users token={token} user={user}/>}/>
                    <Route path="/usuarios/:id" element={<UserEdit token={token} user={user}/>}/>
                    <Route path="/mensajes" element={<Messages token={token} onUnreadCount={setUnreadMsgCount}/>}/>
                    <Route path="/ventas" element={<Ventas token={token}/>}/>
                    <Route path="/estadisticas" element={<Stats token={token}/>}/>
                    <Route path="/rendimiento" element={soloAdmin(<WorkerPerformance token={token}/>)}/>
                    <Route path="/resenas" element={<Reviews token={token}/>}/>
                    <Route path="/campanas" element={soloAdmin(<Campaigns token={token}/>)}/>
                    <Route path="/caja" element={soloAdmin(<CashAudit token={token}/>)}/>
                    <Route path="/horario" element={soloAdmin(<WorkSchedule token={token}/>)}/>
                    <Route path="/itinerarios" element={<ItineraryConfig token={token}/>}/>
                    <Route path="/recursos" element={<ResourceConfig token={token}/>}/>
                    <Route path="/impresion" element={<PrintSettings/>}/>
                    <Route path="/accesos" element={soloAdmin(<LoginLogs token={token}/>)}/>
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
