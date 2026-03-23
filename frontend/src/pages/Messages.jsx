import React, { useEffect, useState, useRef, useCallback } from 'react';
import { fetchConversations, fetchMessages, sendMessage, sendMediaMessage, fetchWhatsAppTemplates, sendWhatsAppMessage } from '../api.js';
import PageToolbar from '../components/PageToolbar.jsx';

/* ── Constantes ── */
const ACCEPTED_TYPES = [
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/3gpp',
    'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
];
const ACCEPT_STRING = ACCEPTED_TYPES.join(',');

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Helpers para media ── */
const MEDIA_LABELS = {
    image: { icon: '📷', label: 'Imagen' },
    video: { icon: '🎥', label: 'Vídeo' },
    audio: { icon: '🎵', label: 'Audio' },
    document: { icon: '📄', label: 'Documento' },
    sticker: { icon: '🏷️', label: 'Sticker' },
    location: { icon: '📍', label: 'Ubicación' },
    contact: { icon: '👤', label: 'Contacto' },
};

/** Detecta tipo de media a partir del texto del content (mensajes antiguos sin mediaType) */
function detectMediaFromContent(content) {
    if (!content) return null;
    const lower = content.toLowerCase().trim();
    if (lower === '[image]' || lower === '[imagen]') return 'image';
    if (lower === '[video]' || lower === '[vídeo]') return 'video';
    if (lower === '[audio]') return 'audio';
    if (lower === '[document]' || lower === '[documento]') return 'document';
    if (lower === '[sticker]') return 'sticker';
    return null;
}

/** Devuelve una preview legible para el sidebar de conversaciones */
function mediaPreviewText(mediaType, content) {
    const info = MEDIA_LABELS[mediaType];
    if (!info) return content;
    // Si el content es solo un placeholder como [image], usar la etiqueta bonita
    if (!content || content.startsWith('[')) return `${info.icon} ${info.label}`;
    // Si hay caption, mostrarlo con el icono
    return `${info.icon} ${content}`;
}

/* ── Placeholder cuando la media no está disponible ── */
function MediaUnavailable({ mediaType }) {
    const info = MEDIA_LABELS[mediaType] || { icon: '📎', label: 'Archivo' };
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', background: 'rgba(0,0,0,0.04)', borderRadius: 8,
            color: '#94a3b8', fontSize: 13, fontStyle: 'italic',
        }}>
            <span style={{ fontSize: 24 }}>{info.icon}</span>
            <span>{info.label} no disponible</span>
        </div>
    );
}

/* ── Componente de burbuja multimedia ── */
function MediaBubble({ mediaType, mediaUrl, content, onImageClick }) {
    const src = mediaUrl ? `/uploads/${mediaUrl}` : null;

    if (!mediaType || !src) return null;

    switch (mediaType) {
        case 'image':
            return (
                <div className="msg-bubble-media">
                    <img
                        src={src} alt="Imagen"
                        className="msg-media-img"
                        onClick={() => onImageClick(src)}
                    />
                    {content && content !== '[Imagen]' && content !== '[image]' && (
                        <div className="msg-media-caption">{content}</div>
                    )}
                </div>
            );
        case 'video':
            return (
                <div className="msg-bubble-media">
                    <video controls preload="metadata" className="msg-media-video">
                        <source src={src} />
                    </video>
                    {content && content !== '[Vídeo]' && content !== '[video]' && (
                        <div className="msg-media-caption">{content}</div>
                    )}
                </div>
            );
        case 'audio':
            return (
                <div className="msg-bubble-media">
                    <audio controls style={{ width: '100%', minWidth: 200 }}>
                        <source src={src} />
                    </audio>
                </div>
            );
        case 'document': {
            const fileName = src.split('/').pop() || 'Documento';
            return (
                <div className="msg-bubble-media">
                    <a href={src} target="_blank" rel="noopener noreferrer" className="msg-doc-link">
                        <span className="msg-doc-icon">📄</span>
                        <div className="msg-doc-info">
                            <span className="msg-doc-name">{fileName}</span>
                        </div>
                        <span uk-icon="icon: download; ratio: 0.8" style={{ color: '#64748b' }}></span>
                    </a>
                    {content && !content.startsWith('[') && (
                        <div className="msg-media-caption">{content}</div>
                    )}
                </div>
            );
        }
        case 'sticker':
            return (
                <div className="msg-bubble-media msg-sticker">
                    <img src={src} alt="Sticker" style={{ width: 150, height: 150, objectFit: 'contain' }} />
                </div>
            );
        case 'location': {
            let loc;
            try { loc = JSON.parse(content); } catch { loc = null; }
            if (!loc) return <div className="msg-bubble-text">{content}</div>;
            const mapUrl = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`;
            return (
                <div className="msg-bubble-media">
                    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="msg-location-link">
                        <span style={{ fontSize: 28 }}>📍</span>
                        <div>
                            {loc.name && <div style={{ fontWeight: 600, fontSize: 13 }}>{loc.name}</div>}
                            {loc.address && <div style={{ fontSize: 12, color: '#64748b' }}>{loc.address}</div>}
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{loc.latitude}, {loc.longitude}</div>
                        </div>
                    </a>
                </div>
            );
        }
        case 'contact': {
            let contacts;
            try { contacts = JSON.parse(content); } catch { contacts = null; }
            if (!contacts || !Array.isArray(contacts)) return <div className="msg-bubble-text">{content}</div>;
            return (
                <div className="msg-bubble-media">
                    {contacts.map((c, i) => (
                        <div key={i} className="msg-contact-card">
                            <span style={{ fontSize: 22 }}>👤</span>
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name?.formatted_name || 'Contacto'}</div>
                                {c.phones?.map((p, j) => (
                                    <div key={j} style={{ fontSize: 12, color: '#64748b' }}>{p.phone}</div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }
        default:
            return null;
    }
}

/* ── Componente principal ── */
export default function Messages({ token, onUnreadCount }) {
    const [conversations, setConversations] = useState([]);
    const [selectedClientId, setSelectedClientId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [msgLoading, setMsgLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [newMessage, setNewMessage] = useState('');
    const [channel, setChannel] = useState('whatsapp');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef(null);
    const [templates, setTemplates] = useState([]);
    const [showTemplates, setShowTemplates] = useState(false);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const inputRef = useRef(null);
    const threadRef = useRef(null);
    const fileInputRef = useRef(null);

    // Attachment state
    const [attachedFile, setAttachedFile] = useState(null);
    const [attachPreview, setAttachPreview] = useState(null);
    const [dragOver, setDragOver] = useState(false);

    // Lightbox
    const [lightboxSrc, setLightboxSrc] = useState(null);

    const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    useEffect(() => {
        if (onUnreadCount) onUnreadCount(totalUnread);
    }, [totalUnread, onUnreadCount]);

    useEffect(() => {
        if (selectedClientId && window.innerWidth <= 1024) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [selectedClientId]);

    useEffect(() => {
        if (!selectedClientId || !window.visualViewport) return;
        const vv = window.visualViewport;
        const onResize = () => {
            if (threadRef.current) {
                threadRef.current.style.height = `${vv.height}px`;
            }
        };
        vv.addEventListener('resize', onResize);
        onResize();
        return () => vv.removeEventListener('resize', onResize);
    }, [selectedClientId]);

    const loadConversations = useCallback(async () => {
        try {
            const data = await fetchConversations(token);
            setConversations(data);
        } catch (err) {
            console.error('Error cargando conversaciones:', err);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadConversations();
        const interval = setInterval(loadConversations, 30000);
        return () => clearInterval(interval);
    }, [loadConversations]);

    const loadMessages = useCallback(async (clientId) => {
        if (!clientId) return;
        setMsgLoading(true);
        try {
            const data = await fetchMessages(token, { clientId });
            setMessages(data);
        } catch (err) {
            console.error('Error cargando mensajes:', err);
        } finally {
            setMsgLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (selectedClientId) {
            loadMessages(selectedClientId);
            const interval = setInterval(() => loadMessages(selectedClientId), 15000);
            return () => clearInterval(interval);
        }
    }, [selectedClientId, loadMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSelectConversation = (clientId) => {
        setSelectedClientId(clientId);
        setShowTemplates(false);
        clearAttachment();
    };

    const handleBack = () => {
        setSelectedClientId(null);
        setMessages([]);
        setShowTemplates(false);
        clearAttachment();
    };

    /* ── Attachment helpers ── */
    const clearAttachment = () => {
        setAttachedFile(null);
        setAttachPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFileSelect = (file) => {
        if (!file) return;
        if (!ACCEPTED_TYPES.includes(file.type)) {
            alert(`Tipo de archivo no soportado: ${file.type}`);
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

    /* ── Send ── */
    const handleSend = async () => {
        if (!selectedClientId) return;

        if (attachedFile) {
            setSending(true);
            try {
                await sendMediaMessage(token, {
                    file: attachedFile,
                    clientId: selectedClientId,
                    caption: newMessage.trim() || undefined,
                    channel,
                });
                setNewMessage('');
                clearAttachment();
                await loadMessages(selectedClientId);
            } catch (err) {
                alert(err.error || 'Error enviando archivo');
            } finally {
                setSending(false);
            }
            return;
        }

        if (!newMessage.trim()) return;
        setSending(true);
        try {
            await sendMessage(token, {
                clientId: selectedClientId,
                channel,
                content: newMessage.trim(),
            });
            setNewMessage('');
            await loadMessages(selectedClientId);
        } catch (err) {
            alert(err.error || 'Error enviando mensaje');
        } finally {
            setSending(false);
        }
    };

    const loadTemplates = async () => {
        if (templates.length > 0) {
            setShowTemplates(!showTemplates);
            return;
        }
        setTemplatesLoading(true);
        try {
            const data = await fetchWhatsAppTemplates(token);
            setTemplates(data);
            setShowTemplates(true);
        } catch (err) {
            console.error('Error cargando plantillas:', err);
            alert('Error al cargar las plantillas de WhatsApp');
        } finally {
            setTemplatesLoading(false);
        }
    };

    const handleSendTemplate = async (template) => {
        if (!selectedClientId) return;
        const conv = conversations.find(c => c.clientId === selectedClientId);
        if (!conv?.phone) {
            alert('El cliente no tiene teléfono');
            return;
        }
        setSending(true);
        try {
            await sendWhatsAppMessage(token, {
                phone: conv.phone.startsWith('34') ? conv.phone : `34${conv.phone}`,
                templateName: template.name,
                templateComponents: [],
                clientId: selectedClientId,
            });
            setShowTemplates(false);
            await loadMessages(selectedClientId);
        } catch (err) {
            alert(err.error || 'Error enviando plantilla');
        } finally {
            setSending(false);
        }
    };

    /* ── Drag & Drop ── */
    const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
    const handleDragLeave = () => setDragOver(false);
    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFileSelect(file);
    };

    const filteredConversations = conversations.filter(c => {
        if (!search.trim()) return true;
        const term = search.toLowerCase();
        const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
        return name.includes(term) || (c.phone || '').includes(term);
    });

    const selectedConv = conversations.find(c => c.clientId === selectedClientId);

    const formatTime = (date) => {
        const d = new Date(date);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = d.toDateString() === yesterday.toDateString();

        if (isToday) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        if (isYesterday) return 'Ayer';
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    };

    return (
        <div>
            <PageToolbar title="Mensajes" actions={
                totalUnread > 0 && (
                    <span className="msg-badge" style={{ fontSize: 12, padding: '2px 10px' }}>
                        {totalUnread} sin leer
                    </span>
                )
            } />

            <div className={`msg-container ${selectedClientId ? 'thread-open' : ''}`}>
                {/* Sidebar: lista de conversaciones */}
                <div className="msg-sidebar">
                    <div className="msg-sidebar-header">
                        <input
                            type="text"
                            className="uk-input uk-form-small"
                            placeholder="Buscar..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{ borderRadius: 20, fontSize: 13, paddingLeft: 14 }}
                        />
                    </div>
                    <div className="msg-sidebar-list">
                        {loading ? (
                            <div className="msg-empty">Cargando...</div>
                        ) : filteredConversations.length === 0 ? (
                            <div className="msg-empty">Sin conversaciones</div>
                        ) : (
                            filteredConversations.map(c => (
                                <div
                                    key={c.clientId}
                                    className={`msg-conv-item ${selectedClientId === c.clientId ? 'active' : ''}`}
                                    onClick={() => handleSelectConversation(c.clientId)}
                                >
                                    <div className="msg-conv-avatar">
                                        {(c.firstName || '?')[0]}{(c.lastName || '?')[0]}
                                    </div>
                                    <div className="msg-conv-info">
                                        <div className="msg-conv-top">
                                            <span className="msg-conv-name">
                                                {c.firstName} {c.lastName}
                                            </span>
                                            <span className="msg-conv-time">{formatTime(c.lastMessageAt)}</span>
                                        </div>
                                        <div className="msg-conv-bottom">
                                            <span className="msg-conv-preview">
                                                {c.lastChannel === 'whatsapp' ? (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#25D366" style={{ marginRight: 3, verticalAlign: -1, flexShrink: 0 }}>
                                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                                    </svg>
                                                ) : (
                                                    <span style={{ fontSize: 10, marginRight: 3, color: '#94a3b8', fontWeight: 600 }}>SMS</span>
                                                )}
                                                <span className="msg-conv-text">
                                                    {c.lastDirection === 'inbound' ? '' : 'Tú: '}
                                                    {(() => {
                                                        const mt = c.lastMediaType || detectMediaFromContent(c.lastMessage);
                                                        if (mt) return mediaPreviewText(mt, c.lastMessage);
                                                        return c.lastMessage;
                                                    })()}
                                                </span>
                                            </span>
                                            {c.unreadCount > 0 && (
                                                <span className="msg-badge">{c.unreadCount}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Thread: hilo de mensajes */}
                {selectedClientId ? (
                    <div className="msg-thread" ref={threadRef}>
                        {/* Header */}
                        <div className="msg-thread-header">
                            <button className="msg-back-btn" onClick={handleBack}>
                                <span uk-icon="icon: chevron-left; ratio: 0.9"></span>
                            </button>
                            <div className="msg-conv-avatar small">
                                {(selectedConv?.firstName || '?')[0]}{(selectedConv?.lastName || '?')[0]}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>
                                    {selectedConv?.firstName} {selectedConv?.lastName}
                                </div>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{selectedConv?.phone}</div>
                            </div>
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
                                messages.map(m => {
                                    const effectiveMediaType = m.mediaType || detectMediaFromContent(m.content);
                                    const hasMedia = !!effectiveMediaType;
                                    const hasMediaUrl = !!m.mediaUrl;
                                    const isSticker = effectiveMediaType === 'sticker';

                                    return (
                                    <div key={m.id} className={`msg-bubble-row ${m.direction === 'outbound' ? 'outbound' : 'inbound'}`}>
                                        <div className={`msg-bubble ${m.direction === 'outbound' ? 'outbound' : 'inbound'} ${isSticker ? 'msg-bubble-sticker' : ''}`}>
                                            {/* Contenido multimedia */}
                                            {hasMedia && hasMediaUrl ? (
                                                <MediaBubble
                                                    mediaType={effectiveMediaType}
                                                    mediaUrl={m.mediaUrl}
                                                    content={m.content}
                                                    onImageClick={setLightboxSrc}
                                                />
                                            ) : hasMedia && !hasMediaUrl ? (
                                                <MediaUnavailable mediaType={effectiveMediaType} />
                                            ) : (
                                                <div className="msg-bubble-text">{m.content}</div>
                                            )}

                                            <div className="msg-bubble-meta">
                                                <span className="msg-bubble-channel">
                                                    {m.channel === 'whatsapp' ? 'WA' : 'SMS'}
                                                </span>
                                                <span>{new Date(m.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                                                {m.direction === 'outbound' && (
                                                    <span className="msg-bubble-status">
                                                        {m.status === 'read' ? (
                                                            <span style={{ color: '#53bdeb' }}>✓✓</span>
                                                        ) : m.status === 'delivered' ? '✓✓'
                                                            : m.status === 'sent' ? '✓'
                                                            : m.status === 'failed' ? <span style={{ color: '#ef4444' }}>✗</span>
                                                            : '○'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })
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
                                {templates.length === 0 ? (
                                    <div style={{ fontSize: 12, color: '#999' }}>No hay plantillas aprobadas</div>
                                ) : (
                                    templates.map(t => (
                                        <div key={`${t.name}-${t.language}`} className="msg-template-item" onClick={() => handleSendTemplate(t)}>
                                            <div style={{ fontWeight: 500 }}>{t.name}</div>
                                            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                                                {t.category} &middot; {t.language}
                                                {t.components?.find(c => c.type === 'BODY')?.text && (
                                                    <span style={{ display: 'block', marginTop: 2, fontStyle: 'italic', color: '#aaa' }}>
                                                        {t.components.find(c => c.type === 'BODY').text.substring(0, 80)}...
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {/* Preview del archivo adjunto */}
                        {attachedFile && attachPreview && (
                            <div className="msg-attach-preview">
                                <div className="msg-attach-preview-content">
                                    {attachPreview.type === 'image' && (
                                        <img src={attachPreview.url} alt="Preview" className="msg-attach-thumb" />
                                    )}
                                    {attachPreview.type === 'video' && (
                                        <video src={attachPreview.url} className="msg-attach-thumb" muted />
                                    )}
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
                                <button className="msg-composer-tpl-btn" onClick={loadTemplates} disabled={templatesLoading} title="Plantillas">
                                    {templatesLoading ? '...' : <span uk-icon="icon: file-text; ratio: 0.8"></span>}
                                </button>
                            )}

                            {/* Botón adjuntar */}
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
                                value={newMessage}
                                onChange={e => setNewMessage(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                disabled={sending}
                            />
                            <button
                                className="uk-button uk-button-primary uk-button-small msg-composer-send"
                                onClick={handleSend}
                                disabled={sending || (!newMessage.trim() && !attachedFile)}
                            >
                                {sending
                                    ? <span uk-spinner="ratio: 0.4"></span>
                                    : <span uk-icon="icon: arrow-right; ratio: 0.85"></span>
                                }
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="msg-thread msg-placeholder">
                        <div className="msg-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <span uk-icon="icon: comment; ratio: 2" style={{ color: '#cbd5e1' }}></span>
                            <span style={{ color: '#94a3b8', fontSize: 14 }}>Selecciona una conversación</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Lightbox para imágenes */}
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
