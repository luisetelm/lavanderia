import React, { useMemo, useState } from 'react';
import { convDisplayName, convInitials, formatTime, previewText } from './chatUtils.js';

const WA_ICON = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#25D366" style={{ marginRight: 3, verticalAlign: -1, flexShrink: 0 }}>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
);

/**
 * Lista de conversaciones con buscador y filtro "sólo sin leer".
 * Es la primera pantalla del widget: tiene que dejar ver de un vistazo quién
 * espera respuesta.
 */
export default function ConversationList({ conversations, loading, selectedConvId, onSelect }) {
    const [search, setSearch] = useState('');
    const [onlyUnread, setOnlyUnread] = useState(false);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return conversations.filter(c => {
            if (onlyUnread && !(c.unreadCount > 0)) return false;
            if (!term) return true;
            const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
            return name.includes(term) || (c.phone || '').includes(term);
        });
    }, [conversations, search, onlyUnread]);

    const unreadConvs = conversations.filter(c => c.unreadCount > 0).length;

    return (
        <div className="msg-sidebar">
            <div className="msg-sidebar-header">
                <input
                    type="text"
                    className="uk-input uk-form-small"
                    placeholder="Buscar por nombre o teléfono..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ borderRadius: 20, fontSize: 13, paddingLeft: 14 }}
                />
                <button
                    type="button"
                    className={`msg-filter-chip ${onlyUnread ? 'active' : ''}`}
                    onClick={() => setOnlyUnread(v => !v)}
                    title="Mostrar sólo conversaciones sin leer"
                >
                    Sin leer{unreadConvs > 0 && <span className="msg-badge" style={{ marginLeft: 6 }}>{unreadConvs}</span>}
                </button>
            </div>
            <div className="msg-sidebar-list">
                {loading ? (
                    <div className="msg-empty">Cargando...</div>
                ) : filtered.length === 0 ? (
                    <div className="msg-empty">{onlyUnread ? 'Nada pendiente de leer' : 'Sin conversaciones'}</div>
                ) : (
                    filtered.map(c => (
                        <div
                            key={c.id}
                            className={`msg-conv-item ${selectedConvId === c.id ? 'active' : ''} ${c.unreadCount > 0 ? 'unread' : ''}`}
                            onClick={() => onSelect(c.id)}
                        >
                            <div className={`msg-conv-avatar ${c.clientId ? '' : 'unknown'}`}>
                                {convInitials(c)}
                            </div>
                            <div className="msg-conv-info">
                                <div className="msg-conv-top">
                                    <span className="msg-conv-name">{convDisplayName(c)}</span>
                                    <span className="msg-conv-time">{formatTime(c.lastMessageAt)}</span>
                                </div>
                                <div className="msg-conv-bottom">
                                    <span className="msg-conv-preview">
                                        {c.lastChannel === 'whatsapp' ? WA_ICON : (
                                            <span style={{ fontSize: 10, marginRight: 3, color: '#94a3b8', fontWeight: 600 }}>SMS</span>
                                        )}
                                        <span className="msg-conv-text">
                                            {c.lastDirection === 'inbound' ? '' : 'Tú: '}
                                            {previewText(c)}
                                        </span>
                                    </span>
                                    {c.unreadCount > 0 && <span className="msg-badge">{c.unreadCount}</span>}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
