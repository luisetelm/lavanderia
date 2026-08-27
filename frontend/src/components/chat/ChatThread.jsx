import React, { useCallback, useEffect, useRef, useState } from 'react';
import { avisar } from '../../utils/dialogo.js';
import {
    fetchMessages, sendMessage, sendMediaMessage,
    fetchWhatsAppTemplates, sendWhatsAppMessage, setupDefaultTemplates,
} from '../../api.js';
import MediaBubble, { MediaUnavailable } from './MediaBubble.jsx';
import {
    ACCEPTED_TYPES, ACCEPT_STRING, formatFileSize,
    detectMediaFromContent, convDisplayName, convInitials,
    formatDaySeparator, formatMsgMeta, formatTime,
} from './chatUtils.js';

const THREAD_POLL_MS = 10000;

/**
 * Hilo de una conversación: cabecera, mensajes, plantillas, adjuntos y compositor.
 *
 * Props:
 *  - conv: conversación seleccionada (de la lista compartida)
 *  - onBack: volver a la lista (null en modo ancho, donde la lista siempre se ve)
 *  - onToggleInfo / infoOpen: panel de contexto del cliente
 *  - composerText / setComposerText: el texto del compositor vive fuera para que
 *    el panel de contexto pueda insertar frases ("su pedido nº X está listo").
 */
export default function ChatThread({ token, conv, onBack, onToggleInfo, infoOpen, composerText, setComposerText }) {
    const convId = conv?.id;

    const [messages, setMessages] = useState([]);
    const [msgLoading, setMsgLoading] = useState(false);
    const [channel, setChannel] = useState('whatsapp');
    const [sending, setSending] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [showTemplates, setShowTemplates] = useState(false);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [attachedFile, setAttachedFile] = useState(null);
    const [attachPreview, setAttachPreview] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [lightboxSrc, setLightboxSrc] = useState(null);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const prevMessagesCountRef = useRef(0);

    /* ── Carga y refresco del hilo ── */
    const loadMessages = useCallback(async (id, { silent = false } = {}) => {
        if (!id) return;
        if (!silent) setMsgLoading(true);
        try {
            const data = await fetchMessages(token, { conversationId: id });
            setMessages(prev => {
                if (prev.length === data.length) {
                    const lastA = prev[prev.length - 1];
                    const lastB = data[data.length - 1];
                    if (lastA && lastB && lastA.id === lastB.id && lastA.status === lastB.status) return prev;
                }
                return data;
            });
        } catch (err) {
            console.error('Error cargando mensajes:', err);
        } finally {
            if (!silent) setMsgLoading(false);
        }
    }, [token]);

    useEffect(() => {
        setMessages([]);
        prevMessagesCountRef.current = 0;
        setShowTemplates(false);
        clearAttachment();
        if (!convId) return;
        loadMessages(convId);
        const interval = setInterval(() => loadMessages(convId, { silent: true }), THREAD_POLL_MS);
        return () => clearInterval(interval);
    }, [convId, loadMessages]);

    // Scroll al fondo sólo cuando aparecen mensajes nuevos
    useEffect(() => {
        if (messages.length !== prevMessagesCountRef.current) {
            const behavior = prevMessagesCountRef.current === 0 ? 'auto' : 'smooth';
            messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
            prevMessagesCountRef.current = messages.length;
        }
    }, [messages]);

    // Al insertar texto desde fuera, llevar el foco al compositor
    useEffect(() => {
        if (composerText && inputRef.current && document.activeElement !== inputRef.current) {
            inputRef.current.focus();
        }
    }, [composerText]);

    /* ── Adjuntos ── */
    function clearAttachment() {
        setAttachedFile(null);
        setAttachPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    const handleFileSelect = (file) => {
        if (!file) return;
        if (!ACCEPTED_TYPES.includes(file.type)) {
            avisar(`Tipo de archivo no soportado: ${file.type}`, 'danger');
            return;
        }
        setAttachedFile(file);
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => setAttachPreview({ type: 'image', url: e.target.result });
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            setAttachPreview({ type: 'video', url: URL.createObjectURL(file) });
        } else {
            setAttachPreview({ type: 'file', name: file.name, size: file.size });
        }
    };

    const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = () => setDragOver(false);
    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFileSelect(file);
    };

    /* ── Envío ── */
    const handleSend = async () => {
        if (!convId) return;
        const text = (composerText || '').trim();

        if (attachedFile) {
            setSending(true);
            try {
                await sendMediaMessage(token, { file: attachedFile, conversationId: convId, caption: text || undefined, channel });
                setComposerText('');
                clearAttachment();
                await loadMessages(convId, { silent: true });
            } catch (err) {
                avisar(err.error || 'Error enviando archivo', 'danger');
            } finally {
                setSending(false);
            }
            return;
        }

        if (!text) return;
        setSending(true);
        try {
            await sendMessage(token, { conversationId: convId, channel, content: text });
            setComposerText('');
            await loadMessages(convId, { silent: true });
        } catch (err) {
            avisar(err.error || 'Error enviando mensaje', 'danger');
        } finally {
            setSending(false);
        }
    };

    const loadTemplates = async () => {
        if (templates.length > 0) { setShowTemplates(v => !v); return; }
        setTemplatesLoading(true);
        try {
            const data = await fetchWhatsAppTemplates(token);
            setTemplates(data);
            setShowTemplates(true);
        } catch (err) {
            console.error('Error cargando plantillas:', err);
            avisar('Error al cargar las plantillas de WhatsApp', 'danger');
        } finally {
            setTemplatesLoading(false);
        }
    };

    const handleSendTemplate = async (template) => {
        if (!convId) return;
        if (!conv?.phone) { avisar('El cliente no tiene teléfono', 'danger'); return; }
        setSending(true);
        try {
            await sendWhatsAppMessage(token, {
                phone: conv.phone.startsWith('34') ? conv.phone : `34${conv.phone}`,
                templateName: template.name,
                templateComponents: [],
                clientId: conv.clientId,
            });
            setShowTemplates(false);
            await loadMessages(convId, { silent: true });
        } catch (err) {
            avisar(err.error || 'Error enviando plantilla', 'danger');
        } finally {
            setSending(false);
        }
    };

    const handleCreateDefaultTemplates = async () => {
        setSending(true);
        try {
            const res = await setupDefaultTemplates(token);
            const ok = res.results?.filter(r => r.status === 'created').length || 0;
            const fail = res.results?.filter(r => r.status === 'error') || [];
            let msg = `✅ ${ok} plantilla(s) creada(s). Quedarán en estado PENDIENTE hasta que Meta las apruebe.`;
            if (fail.length > 0) msg += '\n\n⚠️ Errores:\n' + fail.map(f => `${f.name}: ${f.error}`).join('\n');
            avisar(msg, 'primary');
            setTemplates([]);
            setShowTemplates(false);
            setTimeout(() => loadTemplates(), 300);
        } catch (err) {
            avisar(err.error || 'Error creando plantillas', 'danger');
        } finally {
            setSending(false);
        }
    };

    if (!conv) {
        return (
            <div className="msg-thread msg-placeholder">
                <div className="msg-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span uk-icon="icon: comment; ratio: 2" style={{ color: '#cbd5e1' }}></span>
                    <span style={{ color: '#94a3b8', fontSize: 14 }}>Selecciona una conversación</span>
                </div>
            </div>
        );
    }

    const waWindowClosed = channel === 'whatsapp' && !conv.waWindowOpen;
    const waExpires = conv.waWindowOpen && conv.waWindowExpiresAt ? formatTime(conv.waWindowExpiresAt) : null;

    return (
        <div className="msg-thread">
            {/* Cabecera */}
            <div className="msg-thread-header">
                {onBack && (
                    <button className="msg-back-btn" onClick={onBack} title="Volver a la lista">
                        <span uk-icon="icon: chevron-left; ratio: 0.9"></span>
                    </button>
                )}
                <div className={`msg-conv-avatar small ${conv.clientId ? '' : 'unknown'}`}>{convInitials(conv)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {convDisplayName(conv)}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {conv.phone}
                        {conv.waWindowOpen
                            ? <span className="msg-wa-window open" title="El cliente escribió hace menos de 24 h: se puede responder con texto libre">· WA abierta{waExpires ? ` hasta ${waExpires}` : ''}</span>
                            : <span className="msg-wa-window closed" title="Han pasado más de 24 h desde el último mensaje del cliente: por WhatsApp sólo se pueden enviar plantillas">· WA sólo plantillas</span>}
                    </div>
                </div>
                {onToggleInfo && (
                    <button
                        className={`msg-info-btn ${infoOpen ? 'active' : ''} ${conv.clientId ? '' : 'attention'}`}
                        onClick={onToggleInfo}
                        title={conv.clientId ? 'Ficha del cliente y pedidos' : 'Número sin cliente vinculado'}
                    >
                        <span uk-icon="icon: user; ratio: 0.9"></span>
                    </button>
                )}
            </div>

            {/* Mensajes */}
            <div
                className={`msg-thread-body ${dragOver ? 'msg-drop-active' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {dragOver && (
                    <div className="msg-drop-overlay">
                        <span uk-icon="icon: cloud-upload; ratio: 2" style={{ color: '#048ABF' }}></span>
                        <span style={{ fontSize: 14, color: '#048ABF', fontWeight: 600 }}>Suelta el archivo aquí</span>
                    </div>
                )}

                {msgLoading ? (
                    <div className="msg-empty" style={{ paddingTop: 40 }}>Cargando mensajes...</div>
                ) : messages.length === 0 ? (
                    <div className="msg-empty" style={{ paddingTop: 40 }}>Sin mensajes</div>
                ) : (
                    <MessageList messages={messages} onImageClick={setLightboxSrc} />
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Panel de plantillas */}
            {showTemplates && (
                <div className="msg-templates-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 12, color: '#555' }}>Plantillas de WhatsApp</span>
                        <button onClick={() => setShowTemplates(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#888' }}>
                            <span uk-icon="icon: close; ratio: 0.7"></span>
                        </button>
                    </div>
                    {(() => {
                        const names = templates.map(t => t.name);
                        const missingDefaults = !names.includes('pedido_listo') || !names.includes('pedido_recogido');
                        return missingDefaults && (
                            <div style={{ textAlign: 'center', padding: '8px 0', borderBottom: templates.length > 0 ? '1px solid #eee' : 'none', marginBottom: templates.length > 0 ? 8 : 0 }}>
                                {templates.length === 0 && (
                                    <div style={{ fontSize: 12, color: '#999', marginBottom: 10 }}>No hay plantillas aprobadas</div>
                                )}
                                <button
                                    className="uk-button uk-button-primary uk-button-small"
                                    style={{ fontSize: 12, borderRadius: 6 }}
                                    disabled={sending}
                                    onClick={handleCreateDefaultTemplates}
                                >
                                    {sending ? 'Creando...' : '📝 Crear plantillas por defecto'}
                                </button>
                                <div style={{ fontSize: 10, color: '#b0b0b0', marginTop: 6 }}>
                                    Crea <b>pedido_listo</b> y <b>pedido_recogido</b>
                                </div>
                            </div>
                        );
                    })()}
                    {templates.map(t => {
                        const isApproved = t.status === 'APPROVED';
                        const statusLabel = t.status === 'APPROVED' ? '✅' : t.status === 'PENDING' ? '⏳' : t.status === 'REJECTED' ? '❌' : '❓';
                        const bodyText = t.components?.find(c => c.type === 'BODY')?.text;
                        return (
                            <div
                                key={`${t.name}-${t.language}`}
                                className="msg-template-item"
                                onClick={() => isApproved ? handleSendTemplate(t) : null}
                                style={{ opacity: isApproved ? 1 : 0.55, cursor: isApproved ? 'pointer' : 'default' }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontWeight: 500 }}>{t.name}</span>
                                    <span title={t.status} style={{ fontSize: 11 }}>{statusLabel}</span>
                                </div>
                                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                                    {t.category} &middot; {t.language}
                                    {!isApproved && <span style={{ marginLeft: 6, color: t.status === 'REJECTED' ? '#ef4444' : '#f59e0b', fontWeight: 500 }}>({t.status})</span>}
                                    {bodyText && (
                                        <span style={{ display: 'block', marginTop: 2, fontStyle: 'italic', color: '#aaa' }}>
                                            {bodyText.substring(0, 80)}...
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Vista previa del adjunto */}
            {attachedFile && attachPreview && (
                <div className="msg-attach-preview">
                    <div className="msg-attach-preview-content">
                        {attachPreview.type === 'image' && <img src={attachPreview.url} alt="Preview" className="msg-attach-thumb" />}
                        {attachPreview.type === 'video' && <video src={attachPreview.url} className="msg-attach-thumb" muted />}
                        {attachPreview.type === 'file' && (
                            <div className="msg-attach-file-info">
                                <span style={{ fontSize: 22 }}>📄</span>
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 600, wordBreak: 'break-all' }}>{attachPreview.name}</div>
                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatFileSize(attachPreview.size)}</div>
                                </div>
                            </div>
                        )}
                    </div>
                    <button className="msg-attach-remove" onClick={clearAttachment}>
                        <span uk-icon="icon: close; ratio: 0.7"></span>
                    </button>
                </div>
            )}

            {/* Compositor */}
            <div className="msg-composer">
                <select className="uk-select uk-form-small msg-composer-channel" value={channel} onChange={e => setChannel(e.target.value)}>
                    <option value="whatsapp">WA</option>
                    <option value="sms">SMS</option>
                </select>

                {channel === 'whatsapp' && (
                    <button className="msg-composer-tpl-btn" onClick={loadTemplates} disabled={templatesLoading} title="Plantillas de WhatsApp">
                        {templatesLoading ? '...' : '📄'}
                    </button>
                )}

                {waWindowClosed ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', fontSize: 12, color: '#94a3b8' }}>
                        <span style={{ fontSize: 14 }}>🔒</span>
                        <span>Ventana 24h cerrada — usa una <button
                            onClick={loadTemplates}
                            style={{ background: 'none', border: 'none', color: '#048ABF', cursor: 'pointer', fontWeight: 600, padding: 0, fontSize: 12, textDecoration: 'underline' }}
                        >plantilla</button> o cambia a SMS</span>
                    </div>
                ) : (
                    <>
                        <button
                            className="msg-attach-btn"
                            onClick={() => fileInputRef.current?.click()}
                            title="Adjuntar archivo"
                            disabled={sending}
                        >
                            <span uk-icon="icon: plus-circle; ratio: 0.85"></span>
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={ACCEPT_STRING}
                            style={{ display: 'none' }}
                            onChange={(e) => { handleFileSelect(e.target.files?.[0]); e.target.value = ''; }}
                        />
                        <input
                            ref={inputRef}
                            type="text"
                            className="uk-input uk-form-small msg-composer-input"
                            placeholder={attachedFile ? 'Añade un mensaje al archivo...' : 'Escribe un mensaje...'}
                            value={composerText}
                            onChange={e => setComposerText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                            disabled={sending}
                        />
                        <button
                            className="uk-button uk-button-primary uk-button-small msg-composer-send"
                            onClick={handleSend}
                            disabled={sending || (!(composerText || '').trim() && !attachedFile)}
                        >
                            {sending
                                ? <span key="sp" uk-spinner="ratio: 0.4"></span>
                                : <span key="ar" uk-icon="icon: arrow-right; ratio: 0.85"></span>}
                        </button>
                    </>
                )}
            </div>

            {/* Lightbox */}
            {lightboxSrc && (
                <div className="msg-lightbox" onClick={() => setLightboxSrc(null)}>
                    <button className="msg-lightbox-close" onClick={() => setLightboxSrc(null)}>
                        <span uk-icon="icon: close; ratio: 1.2"></span>
                    </button>
                    <img src={lightboxSrc} alt="Imagen ampliada" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

/* ── Lista de burbujas con separadores de día ── */
function MessageList({ messages, onImageClick }) {
    let lastDay = null;
    return messages.map(m => {
        const effectiveMediaType = m.mediaType || detectMediaFromContent(m.content);
        const hasMedia = !!effectiveMediaType;
        const hasMediaUrl = !!m.mediaUrl;
        const isSticker = effectiveMediaType === 'sticker';
        const isNotification = m.source === 'notification';

        const dayKey = new Date(m.createdAt).toDateString();
        const showDaySep = dayKey !== lastDay;
        lastDay = dayKey;

        if (isNotification) {
            return (
                <React.Fragment key={m.id}>
                    {showDaySep && <div className="msg-day-separator"><span>{formatDaySeparator(m.createdAt)}</span></div>}
                    <div className="msg-notification">
                        <div className="msg-notification-bubble">
                            <span className="msg-notification-icon">🔔</span>
                            <div className="msg-notification-body">
                                <div className="msg-notification-label">
                                    Notificación automática
                                    {m.channel && <span className="msg-notification-channel">· {m.channel === 'whatsapp' ? 'WA' : (m.channel || 'sms').toUpperCase()}</span>}
                                </div>
                                <div className="msg-notification-text">{m.content}</div>
                                <div className="msg-notification-time">{formatMsgMeta(m.createdAt)}</div>
                            </div>
                        </div>
                    </div>
                </React.Fragment>
            );
        }

        const dir = m.direction === 'outbound' ? 'outbound' : 'inbound';
        return (
            <React.Fragment key={m.id}>
                {showDaySep && <div className="msg-day-separator"><span>{formatDaySeparator(m.createdAt)}</span></div>}
                <div className={`msg-bubble-row ${dir}`}>
                    <div className={`msg-bubble ${dir} ${isSticker ? 'msg-bubble-sticker' : ''}`}>
                        {hasMedia && hasMediaUrl ? (
                            <MediaBubble mediaType={effectiveMediaType} mediaUrl={m.mediaUrl} content={m.content} onImageClick={onImageClick} />
                        ) : hasMedia && !hasMediaUrl ? (
                            <MediaUnavailable mediaType={effectiveMediaType} />
                        ) : (
                            <div className="msg-bubble-text">{m.content}</div>
                        )}
                        <div className="msg-bubble-meta">
                            <span className="msg-bubble-channel">{m.channel === 'whatsapp' ? 'WA' : 'SMS'}</span>
                            <span>{formatMsgMeta(m.createdAt)}</span>
                            {m.direction === 'outbound' && (
                                <span className="msg-bubble-status">
                                    {m.status === 'read' ? <span style={{ color: '#53bdeb' }}>✓✓</span>
                                        : m.status === 'delivered' ? '✓✓'
                                        : m.status === 'sent' ? '✓'
                                        : m.status === 'failed' ? <span style={{ color: '#ef4444' }}>✗</span>
                                        : '○'}
                                </span>
                            )}
                        </div>
                        {m.direction === 'outbound' && m.status === 'failed' && (m.errorMessage || m.errorCode || m.fallbackNotificationId) && (
                            <div className="msg-bubble-error" style={{ color: '#ef4444', fontSize: '0.75em', marginTop: 2 }}>
                                {m.errorCode ? `Error ${m.errorCode}: ` : 'No entregado: '}{m.errorMessage || 'sin detalle'}
                                {m.fallbackNotificationId ? ' · reenviado por SMS' : ''}
                            </div>
                        )}
                    </div>
                </div>
            </React.Fragment>
        );
    });
}
