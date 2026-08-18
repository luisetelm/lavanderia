import React from 'react';
import { MEDIA_LABELS } from './chatUtils.js';

/* ── Placeholder cuando la media no está disponible ── */
export function MediaUnavailable({ mediaType }) {
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

/* ── Burbuja multimedia ── */
export default function MediaBubble({ mediaType, mediaUrl, content, onImageClick }) {
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
