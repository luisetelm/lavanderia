import React, { useCallback, useEffect, useState } from 'react';
import { useMessages } from '../../hooks/useMessages.js';
import { useDraftOrder } from '../../hooks/useDraftOrder.js';
import ConversationList from './ConversationList.jsx';
import ChatThread from './ChatThread.jsx';
import ClientContextPanel from './ClientContextPanel.jsx';
import { convDisplayName, convInitials, previewText } from './chatUtils.js';

const MOBILE_BP = 640;   // por debajo, el panel ocupa toda la pantalla
const WIDE_MIN_VW = 1100; // el modo ancho (3 columnas) sólo tiene sentido con sitio

/**
 * Chat flotante sobre toda la aplicación.
 *
 * Sustituye a la antigua página de mensajes: el personal está en el POS o en
 * tareas cuando llega un WhatsApp, y un badge pequeño en el menú no bastaba
 * para que lo vieran. El botón siempre está a la vista, con el contador y
 * pulso; los mensajes nuevos asoman como toast junto al botón; y el panel
 * permite leer, contestar y ver los pedidos del cliente sin cambiar de pantalla.
 *
 * Dos tamaños de panel: compacto (lista → hilo, contexto como capa encima) y
 * ancho (lista | hilo | contexto). En móvil siempre compacto y a pantalla completa.
 */
export default function ChatWidget() {
    const {
        enabled, token, conversations, loading, unreadTotal,
        isOpen, toggle, close, wide, setWide,
        selectedConvId, setSelectedConvId, openConversation, markRead,
        toasts, dismissToast, notifPermission, requestNotifications,
    } = useMessages();
    const { bannerHeight } = useDraftOrder();

    const [infoOpen, setInfoOpen] = useState(false);
    const [composerText, setComposerText] = useState('');
    const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

    useEffect(() => {
        const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const isMobile = viewport.w <= MOBILE_BP;
    const canWide = viewport.w >= WIDE_MIN_VW;
    const isWide = wide && canWide && !isMobile;

    // Escape cierra lo más interno primero: contexto → hilo → panel
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('.msg-lightbox')) return; // el lightbox se cierra solo
            if (infoOpen && !isWide) setInfoOpen(false);
            else if (selectedConvId && !isWide) setSelectedConvId(null);
            else close();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, infoOpen, isWide, selectedConvId, setSelectedConvId, close]);

    // En móvil el panel es a pantalla completa: bloquear el scroll de detrás
    useEffect(() => {
        if (!isOpen || !isMobile) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [isOpen, isMobile]);

    // Al cambiar de conversación se limpia el compositor y, en compacto, el contexto
    useEffect(() => {
        setComposerText('');
        if (!isWide) setInfoOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedConvId]);

    const handleFabClick = useCallback(() => {
        // Primer clic: aprovechar el gesto para pedir permiso de notificaciones
        if (notifPermission === 'default') requestNotifications();
        toggle();
    }, [notifPermission, requestNotifications, toggle]);

    const handleSelect = useCallback((convId) => {
        openConversation(convId);
        const conv = conversations.find(c => c.id === convId);
        if (conv?.unreadCount > 0) markRead(convId);
    }, [conversations, openConversation, markRead]);

    const insertText = useCallback((text) => {
        setComposerText(prev => (prev && prev.trim() ? `${prev.trimEnd()} ${text}` : text));
        if (!isWide) setInfoOpen(false);
    }, [isWide]);

    if (!enabled) return null;

    const selectedConv = conversations.find(c => c.id === selectedConvId) || null;
    // Con el banner del pedido en curso desplegado, el botón sube por encima
    const offsetBottom = !isMobile && bannerHeight > 0 ? bannerHeight + 16 : undefined;
    const rootStyle = offsetBottom ? { bottom: offsetBottom } : undefined;

    return (
        <div className={`chat-widget ${isOpen ? 'is-open' : ''}`} style={rootStyle}>
            {/* Toasts de mensajes entrantes */}
            {!isOpen && toasts.length > 0 && (
                <div className="chat-toasts">
                    {toasts.map(t => (
                        <div key={t.id} className="chat-toast" onClick={() => handleSelect(t.conv.id)} role="button">
                            <div className="msg-conv-avatar small">{convInitials(t.conv)}</div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="chat-toast-name">{convDisplayName(t.conv)}</div>
                                <div className="chat-toast-text">{previewText(t.conv) || 'Nuevo mensaje'}</div>
                            </div>
                            <button className="chat-icon-btn" onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }} title="Descartar">
                                <span uk-icon="icon: close; ratio: 0.7"></span>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Panel */}
            {isOpen && (
                <div className={`chat-panel ${isWide ? 'chat-panel--wide' : ''} ${isMobile ? 'chat-panel--mobile' : ''}`}>
                    <div className="chat-panel-header">
                        <span className="chat-panel-title">
                            Mensajes
                            {unreadTotal > 0 && <span className="msg-badge" style={{ marginLeft: 8, background: '#ef4444' }}>{unreadTotal}</span>}
                        </span>
                        <div style={{ display: 'flex', gap: 2 }}>
                            {canWide && !isMobile && (
                                <button className="chat-icon-btn" onClick={() => setWide(!wide)} title={isWide ? 'Vista compacta' : 'Vista ampliada'}>
                                    <span uk-icon={`icon: ${isWide ? 'shrink' : 'expand'}; ratio: 0.85`}></span>
                                </button>
                            )}
                            <button className="chat-icon-btn" onClick={close} title="Cerrar (Esc)">
                                <span uk-icon="icon: close; ratio: 0.9"></span>
                            </button>
                        </div>
                    </div>

                    {notifPermission === 'default' && (
                        <div className="chat-notif-hint">
                            <span>Activa los avisos de escritorio para enterarte aunque estés en otra pestaña.</span>
                            <button className="uk-button uk-button-primary uk-button-small" onClick={requestNotifications}>Activar</button>
                        </div>
                    )}
                    {notifPermission === 'denied' && (
                        <div className="chat-notif-hint muted">
                            Los avisos de escritorio están bloqueados en este navegador (candado de la barra de direcciones → Notificaciones).
                        </div>
                    )}

                    <div className={`chat-panel-body ${selectedConv ? 'thread-open' : ''}`}>
                        {/* Lista: siempre en ancho; en compacto sólo si no hay hilo */}
                        {(isWide || !selectedConv) && (
                            <ConversationList
                                conversations={conversations}
                                loading={loading}
                                selectedConvId={selectedConvId}
                                onSelect={handleSelect}
                            />
                        )}

                        {(isWide || selectedConv) && (
                            <ChatThread
                                token={token}
                                conv={selectedConv}
                                onBack={isWide ? null : () => setSelectedConvId(null)}
                                onToggleInfo={selectedConv ? () => setInfoOpen(v => !v) : null}
                                infoOpen={infoOpen}
                                composerText={composerText}
                                setComposerText={setComposerText}
                            />
                        )}

                        {selectedConv && infoOpen && (
                            <div className={isWide ? 'chat-context-col' : 'chat-context-overlay'}>
                                <ClientContextPanel
                                    conv={selectedConv}
                                    onInsertText={insertText}
                                    onClose={() => setInfoOpen(false)}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Botón flotante */}
            <button
                type="button"
                className={`chat-fab ${unreadTotal > 0 && !isOpen ? 'has-unread' : ''}`}
                onClick={handleFabClick}
                title={isOpen ? 'Cerrar mensajes' : 'Mensajes'}
                aria-label="Mensajes"
            >
                {isOpen ? (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M6 9l6 6 6-6" />
                    </svg>
                ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3C6.48 3 2 6.92 2 11.75c0 2.3 1.02 4.39 2.7 5.95L4 21l4.1-1.63c1.2.37 2.51.58 3.9.58 5.52 0 10-3.92 10-8.75S17.52 3 12 3z" />
                    </svg>
                )}
                {unreadTotal > 0 && !isOpen && <span className="chat-fab-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>}
            </button>
        </div>
    );
}
