import React, { useEffect, useState, useRef, useCallback } from 'react';
import { fetchConversations, fetchMessages, sendMessage, fetchWhatsAppTemplates, sendWhatsAppMessage } from '../api.js';
import PageToolbar from '../components/PageToolbar.jsx';

export default function Messages({ token }) {
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
        // Polling cada 30s
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

    const handleSend = async () => {
        if (!newMessage.trim() || !selectedClientId) return;
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

    const filteredConversations = conversations.filter(c => {
        if (!search.trim()) return true;
        const term = search.toLowerCase();
        const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
        return name.includes(term) || (c.phone || '').includes(term);
    });

    const selectedConv = conversations.find(c => c.clientId === selectedClientId);

    return (
        <div>
            <PageToolbar title="Mensajes" />

            <div style={{
                display: 'grid',
                gridTemplateColumns: '300px 1fr',
                height: 'calc(100vh - 120px)',
                background: '#fff',
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid #e5e5e5',
            }}>
                {/* Left: Conversation list */}
                <div style={{ borderRight: '1px solid #e5e5e5', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: 12, borderBottom: '1px solid #e5e5e5' }}>
                        <input
                            type="text"
                            className="uk-input uk-form-small"
                            placeholder="Buscar conversación..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {loading ? (
                            <div style={{ padding: 16, textAlign: 'center', color: '#999' }}>Cargando...</div>
                        ) : filteredConversations.length === 0 ? (
                            <div style={{ padding: 16, textAlign: 'center', color: '#999' }}>Sin conversaciones</div>
                        ) : (
                            filteredConversations.map(c => (
                                <div
                                    key={c.clientId}
                                    onClick={() => setSelectedClientId(c.clientId)}
                                    style={{
                                        padding: '10px 12px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid #f0f0f0',
                                        background: selectedClientId === c.clientId ? '#e8f4fd' : undefined,
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                                            {c.firstName} {c.lastName}
                                        </div>
                                        {c.unreadCount > 0 && (
                                            <span style={{
                                                background: '#048ABF', color: '#fff', borderRadius: '50%',
                                                width: 20, height: 20, display: 'flex', alignItems: 'center',
                                                justifyContent: 'center', fontSize: 11, fontWeight: 700
                                            }}>
                                                {c.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontSize: 10 }}>
                                            {c.lastChannel === 'whatsapp' ? '📱' : '💬'}
                                        </span>
                                        <span style={{
                                            overflow: 'hidden', textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap', maxWidth: 200
                                        }}>
                                            {c.lastDirection === 'inbound' ? '' : 'Tú: '}
                                            {c.lastMessage}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                                        {new Date(c.lastMessageAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right: Message thread */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {!selectedClientId ? (
                        <div style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#999', fontSize: 14
                        }}>
                            Selecciona una conversación
                        </div>
                    ) : (
                        <>
                            {/* Thread header */}
                            <div style={{
                                padding: '10px 16px', borderBottom: '1px solid #e5e5e5',
                                fontWeight: 600, fontSize: 14
                            }}>
                                {selectedConv?.firstName} {selectedConv?.lastName}
                                <span style={{ fontWeight: 400, color: '#888', marginLeft: 8, fontSize: 12 }}>
                                    {selectedConv?.phone}
                                </span>
                            </div>

                            {/* Messages */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                                {msgLoading ? (
                                    <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>Cargando mensajes...</div>
                                ) : messages.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>Sin mensajes</div>
                                ) : (
                                    messages.map(m => (
                                        <div
                                            key={m.id}
                                            style={{
                                                display: 'flex',
                                                justifyContent: m.direction === 'outbound' ? 'flex-end' : 'flex-start',
                                                marginBottom: 8,
                                            }}
                                        >
                                            <div style={{
                                                maxWidth: '70%',
                                                padding: '8px 12px',
                                                borderRadius: 12,
                                                background: m.direction === 'outbound' ? '#dcf8c6' : '#f0f0f0',
                                                fontSize: 13,
                                            }}>
                                                <div>{m.content}</div>
                                                <div style={{
                                                    fontSize: 10, color: '#888', marginTop: 4,
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    justifyContent: 'flex-end'
                                                }}>
                                                    <span>{m.channel === 'whatsapp' ? 'WA' : 'SMS'}</span>
                                                    <span>{new Date(m.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                                                    {m.direction === 'outbound' && (
                                                        <span style={{ fontSize: 9 }}>
                                                            {m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : m.status === 'sent' ? '✓' : m.status === 'failed' ? '✗' : '○'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Templates panel */}
                            {showTemplates && (
                                <div style={{
                                    borderTop: '1px solid #e5e5e5',
                                    padding: '10px 12px',
                                    maxHeight: 220,
                                    overflowY: 'auto',
                                    background: '#fafafa',
                                }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#555' }}>
                                        Plantillas de WhatsApp
                                    </div>
                                    {templates.length === 0 ? (
                                        <div style={{ fontSize: 12, color: '#999' }}>No hay plantillas aprobadas</div>
                                    ) : (
                                        templates.map(t => (
                                            <div
                                                key={`${t.name}-${t.language}`}
                                                style={{
                                                    padding: '8px 10px',
                                                    marginBottom: 4,
                                                    borderRadius: 6,
                                                    border: '1px solid #e0e0e0',
                                                    background: '#fff',
                                                    cursor: 'pointer',
                                                    fontSize: 13,
                                                }}
                                                onClick={() => handleSendTemplate(t)}
                                            >
                                                <div style={{ fontWeight: 500 }}>{t.name}</div>
                                                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                                                    {t.category} &middot; {t.language}
                                                    {t.components?.find(c => c.type === 'BODY')?.text &&
                                                        <span style={{ display: 'block', marginTop: 2, fontStyle: 'italic' }}>
                                                            {t.components.find(c => c.type === 'BODY').text.substring(0, 100)}...
                                                        </span>
                                                    }
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Composer */}
                            <div style={{
                                padding: '8px 12px', borderTop: '1px solid #e5e5e5',
                                display: 'flex', gap: 8, alignItems: 'center'
                            }}>
                                <select
                                    className="uk-select uk-form-small"
                                    style={{ width: 100 }}
                                    value={channel}
                                    onChange={e => setChannel(e.target.value)}
                                >
                                    <option value="whatsapp">WhatsApp</option>
                                    <option value="sms">SMS</option>
                                </select>
                                {channel === 'whatsapp' && (
                                    <button
                                        className="uk-button uk-button-default uk-button-small"
                                        onClick={loadTemplates}
                                        disabled={templatesLoading}
                                        title="Enviar plantilla"
                                        style={{ padding: '0 8px', minWidth: 36 }}
                                    >
                                        {templatesLoading ? '...' : <span uk-icon="icon: file-text; ratio: 0.8"></span>}
                                    </button>
                                )}
                                <input
                                    type="text"
                                    className="uk-input uk-form-small"
                                    style={{ flex: 1 }}
                                    placeholder="Escribe un mensaje..."
                                    value={newMessage}
                                    onChange={e => setNewMessage(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    disabled={sending}
                                />
                                <button
                                    className="uk-button uk-button-primary uk-button-small"
                                    onClick={handleSend}
                                    disabled={sending || !newMessage.trim()}
                                >
                                    {sending ? '...' : 'Enviar'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
