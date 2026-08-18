import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchConversations, markConversationAsRead } from '../api.js';
import { convDisplayName, previewText, puedeVerMensajes } from '../components/chat/chatUtils.js';

// Estado de mensajería compartido por toda la aplicación.
//
// Antes cada pieza consultaba las conversaciones por su cuenta (el badge del
// menú cada 15 s, la página de mensajes cada 30 s...). Ahora hay un único
// polling aquí que alimenta al botón flotante, al panel del chat y a los avisos.
// También es quien decide cuándo sonar y cuándo lanzar una notificación del
// sistema, porque es el único que ve llegar los mensajes aunque el chat esté
// cerrado.

export const MessagesContext = createContext(null);

const POLL_MS = 15000;
const TOAST_MS = 10000;
const MAX_TOASTS = 3;
const BASE_TITLE = document.title || 'Tinte y Burbuja';
const LS_OPEN = 'chatWidgetOpen';
const LS_WIDE = 'chatWidgetWide';

export function MessagesProvider({ token, user, children }) {
    const enabled = Boolean(token) && puedeVerMensajes(user);

    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(() => localStorage.getItem(LS_OPEN) === '1');
    const [wide, setWideState] = useState(() => localStorage.getItem(LS_WIDE) === '1');
    const [selectedConvId, setSelectedConvId] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [notifPermission, setNotifPermission] = useState(
        typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
    );

    // Refs para leer el estado actual desde el polling sin recrear el intervalo
    const isOpenRef = useRef(isOpen);
    const selectedRef = useRef(selectedConvId);
    useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
    useEffect(() => { selectedRef.current = selectedConvId; }, [selectedConvId]);

    const prevConvStateRef = useRef(null); // Map<convId, {unread, lastAt}>
    const initialLoadDoneRef = useRef(false);
    const audioCtxRef = useRef(null);

    const unreadTotal = useMemo(
        () => conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
        [conversations]
    );

    /* ── Sonido: doble tono sintetizado, sin ficheros ── */
    const playBeep = useCallback(() => {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const tone = (freq, start, dur) => {
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
            tone(880, 0, 0.18);
            tone(660, 0.20, 0.22);
        } catch { /* silenciar */ }
    }, []);

    /* ── Abrir / cerrar / seleccionar ── */
    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen(v => !v), []);
    const setWide = useCallback((v) => setWideState(Boolean(v)), []);
    useEffect(() => { localStorage.setItem(LS_OPEN, isOpen ? '1' : '0'); }, [isOpen]);
    useEffect(() => { localStorage.setItem(LS_WIDE, wide ? '1' : '0'); }, [wide]);

    const dismissToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    /* ── Marcar como leída (optimista + servidor) ── */
    const markRead = useCallback(async (convId) => {
        if (!convId) return;
        setConversations(prev => prev.map(c => c.id === convId ? { ...c, unreadCount: 0 } : c));
        // El polling compara con este estado: si no lo actualizamos, la
        // siguiente respuesta (ya con 0) no se interpretaría como "nuevo".
        const p = prevConvStateRef.current?.get(convId);
        if (p) prevConvStateRef.current.set(convId, { ...p, unread: 0 });
        try {
            await markConversationAsRead(token, convId);
        } catch (err) {
            console.error('Error marcando como leído:', err);
        }
    }, [token]);

    // Abrir una conversación concreta: desde la lista, un toast o una notificación
    const openConversation = useCallback((convId) => {
        setIsOpen(true);
        setSelectedConvId(convId);
        setToasts(prev => prev.filter(t => t.conv.id !== convId));
    }, []);

    /* ── Notificaciones del sistema ── */
    // Chrome sólo atiende la petición de permiso si viene de un gesto del
    // usuario; por eso se pide desde el clic en el botón del chat y no al cargar.
    const requestNotifications = useCallback(async () => {
        if (typeof Notification === 'undefined') return 'unsupported';
        if (Notification.permission !== 'default') {
            setNotifPermission(Notification.permission);
            return Notification.permission;
        }
        try {
            const res = await Notification.requestPermission();
            setNotifPermission(res);
            return res;
        } catch {
            return Notification.permission;
        }
    }, []);

    const showSystemNotification = useCallback((conv) => {
        try {
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            const body = previewText(conv) || 'Nuevo mensaje';
            const isWa = conv.lastChannel === 'whatsapp';
            const n = new Notification(`${isWa ? '💬 WhatsApp' : '📩 SMS'} · ${convDisplayName(conv)}`, {
                body: body.length > 140 ? body.slice(0, 137) + '…' : body,
                icon: '/logo.png',
                tag: `conv-${conv.id}`,
                requireInteraction: true,
                renotify: true,
            });
            n.onclick = () => {
                try { window.focus(); } catch { /* noop */ }
                openConversation(conv.id);
                n.close();
            };
        } catch { /* silenciar */ }
    }, [openConversation]);

    /* ── Polling ── */
    const refreshConversations = useCallback(async () => {
        if (!enabled) return;
        try {
            const convs = await fetchConversations(token);
            setConversations(prev => {
                if (prev.length === convs.length && prev.every((p, i) => {
                    const n = convs[i];
                    return n && p.id === n.id
                        && p.unreadCount === n.unreadCount
                        && p.clientId === n.clientId
                        && p.waWindowOpen === n.waWindowOpen
                        && new Date(p.lastMessageAt).getTime() === new Date(n.lastMessageAt).getTime()
                        && p.lastMessage === n.lastMessage;
                })) return prev;
                return convs;
            });

            const prev = prevConvStateRef.current;
            const next = new Map();
            const fresh = [];
            for (const c of convs) {
                const lastAt = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0;
                next.set(c.id, { unread: c.unreadCount || 0, lastAt });
                if (initialLoadDoneRef.current && prev) {
                    const p = prev.get(c.id);
                    const isNewer = !p || lastAt > p.lastAt;
                    const unreadIncreased = (c.unreadCount || 0) > (p?.unread || 0);
                    if (unreadIncreased && isNewer && c.lastDirection === 'inbound') fresh.push(c);
                }
            }
            prevConvStateRef.current = next;
            initialLoadDoneRef.current = true;

            if (fresh.length > 0) {
                playBeep();
                fresh.slice(0, MAX_TOASTS).forEach(showSystemNotification);
                // Toast en pantalla salvo que ese hilo ya esté abierto delante
                const visibleConv = isOpenRef.current ? selectedRef.current : null;
                const toShow = fresh.filter(c => c.id !== visibleConv).slice(0, MAX_TOASTS);
                if (toShow.length) {
                    setToasts(prev => {
                        const rest = prev.filter(t => !toShow.some(c => c.id === t.conv.id));
                        const stamp = Date.now();
                        const added = toShow.map(c => ({ id: `${c.id}-${stamp}`, conv: c }));
                        return [...rest, ...added].slice(-MAX_TOASTS);
                    });
                }
            }
        } catch { /* silenciar: el siguiente tick lo reintenta */ }
        finally { setLoading(false); }
    }, [enabled, token, playBeep, showSystemNotification]);

    useEffect(() => {
        if (!enabled) return;
        refreshConversations();
        const interval = setInterval(refreshConversations, POLL_MS);
        // Al volver a la pestaña, refrescar sin esperar al siguiente tick
        const onVisible = () => { if (document.visibilityState === 'visible') refreshConversations(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
    }, [enabled, refreshConversations]);

    // Los toasts caducan solos
    useEffect(() => {
        if (!toasts.length) return;
        const timer = setTimeout(() => setToasts(prev => prev.slice(1)), TOAST_MS);
        return () => clearTimeout(timer);
    }, [toasts]);

    // Contador en el título de la pestaña: se ve aunque la app esté detrás
    useEffect(() => {
        document.title = enabled && unreadTotal > 0 ? `(${unreadTotal}) ${BASE_TITLE}` : BASE_TITLE;
        return () => { document.title = BASE_TITLE; };
    }, [enabled, unreadTotal]);

    // Si el hilo abierto recibe mensajes mientras se está mirando, se dan por leídos
    useEffect(() => {
        if (!isOpen || !selectedConvId) return;
        if (document.visibilityState !== 'visible') return;
        const conv = conversations.find(c => c.id === selectedConvId);
        if (conv && conv.unreadCount > 0) markRead(selectedConvId);
    }, [conversations, isOpen, selectedConvId, markRead]);

    // Cambios locales sobre una conversación (p. ej. tras vincular un cliente)
    const patchConversation = useCallback((convId, patch) => {
        setConversations(prev => prev.map(c => c.id === convId ? { ...c, ...patch } : c));
    }, []);

    const value = useMemo(() => ({
        enabled, token,
        conversations, loading, unreadTotal,
        refreshConversations, markRead, patchConversation,
        isOpen, open, close, toggle,
        wide, setWide,
        selectedConvId, setSelectedConvId, openConversation,
        toasts, dismissToast,
        notifPermission, requestNotifications,
    }), [enabled, token, conversations, loading, unreadTotal, refreshConversations, markRead, patchConversation,
        isOpen, open, close, toggle, wide, setWide, selectedConvId, openConversation, toasts, dismissToast,
        notifPermission, requestNotifications]);

    return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}
