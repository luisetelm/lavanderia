import React, { useEffect, useState } from 'react';
import { avisar } from '../utils/dialogo.js';
import { fetchGoogleStatus, fetchGoogleReviews, replyGoogleReview } from '../api.js';
import PageToolbar from '../components/PageToolbar.jsx';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const stars = (rating) => {
    const map = { FIVE: 5, FOUR: 4, THREE: 3, TWO: 2, ONE: 1 };
    const n = map[rating] || 0;
    return '★'.repeat(n) + '☆'.repeat(5 - n);
};

export default function Reviews({ token }) {
    const [connected, setConnected] = useState(false);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, unreplied, 1-5
    const [replyingId, setReplyingId] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const status = await fetchGoogleStatus(token);
                setConnected(status.connected);
                if (status.connected) {
                    const data = await fetchGoogleReviews(token);
                    setReviews(data);
                }
            } catch (err) {
                console.error('Error cargando reseñas:', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [token]);

    const handleReply = async (reviewId) => {
        if (!replyText.trim()) return;
        setSending(true);
        try {
            await replyGoogleReview(token, reviewId, replyText.trim());
            setReplyingId(null);
            setReplyText('');
            // Refrescar reseñas
            const data = await fetchGoogleReviews(token);
            setReviews(data);
        } catch (err) {
            avisar(err.error || 'Error respondiendo', 'danger');
        } finally {
            setSending(false);
        }
    };

    const filteredReviews = reviews.filter(r => {
        if (filter === 'unreplied') return !r.reviewReply;
        if (['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].includes(filter)) return r.starRating === filter;
        return true;
    });

    return (
        <div>
            <PageToolbar
                title="Reseñas de Google"
                filters={connected && !loading ? [
                    {
                        label: 'Filtrar',
                        active: filter !== 'all',
                        options: [
                            { label: `Todas (${reviews.length})`, active: filter === 'all', onClick: () => setFilter('all') },
                            { label: `Sin responder (${reviews.filter(r => !r.reviewReply).length})`, active: filter === 'unreplied', onClick: () => setFilter('unreplied') },
                            ...['FIVE', 'FOUR', 'THREE', 'TWO', 'ONE'].map(r => ({
                                label: stars(r).slice(0, { FIVE: 5, FOUR: 4, THREE: 3, TWO: 2, ONE: 1 }[r]),
                                active: filter === r,
                                onClick: () => setFilter(filter === r ? 'all' : r),
                            })),
                        ]
                    }
                ] : []}
            />

            {loading ? (
                <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>
            ) : !connected ? (
                <div className="uk-card uk-card-default uk-card-body" style={{ textAlign: 'center' }}>
                    <h3>Google no conectado</h3>
                    <p>Conecta tu cuenta de Google Business Profile para gestionar las reseñas.</p>
                    <a
                        href={`${API_BASE}/google/auth`}
                        className="uk-button uk-button-primary"
                    >
                        Conectar Google
                    </a>
                </div>
            ) : (
                <div className="uk-card uk-card-default uk-card-body">
                    {filteredReviews.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>No hay reseñas</div>
                    ) : (
                        filteredReviews.map(review => (
                            <div
                                key={review.reviewId || review.name}
                                style={{
                                    padding: 16, marginBottom: 12,
                                    borderRadius: 8, border: '1px solid #e5e5e5',
                                    borderLeft: review.reviewReply ? '3px solid #5cb85c' : '3px solid #f0ad4e',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <div>
                                        <strong>{review.reviewer?.displayName || 'Anónimo'}</strong>
                                        <span style={{ marginLeft: 8, color: '#f0ad4e', fontSize: 16 }}>
                                            {stars(review.starRating)}
                                        </span>
                                    </div>
                                    <span style={{ fontSize: 12, color: '#888' }}>
                                        {review.createTime ? new Date(review.createTime).toLocaleDateString('es-ES') : ''}
                                    </span>
                                </div>

                                {review.comment && (
                                    <p style={{ margin: '8px 0', fontSize: 14 }}>{review.comment}</p>
                                )}

                                {/* Existing reply */}
                                {review.reviewReply && (
                                    <div style={{
                                        background: '#f8f8f8', borderRadius: 4,
                                        padding: '8px 12px', marginTop: 8, fontSize: 13,
                                    }}>
                                        <strong>Tu respuesta:</strong> {review.reviewReply.comment}
                                    </div>
                                )}

                                {/* Reply form */}
                                {!review.reviewReply && (
                                    <div style={{ marginTop: 8 }}>
                                        {replyingId === (review.reviewId || review.name) ? (
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <textarea
                                                    className="uk-textarea"
                                                    rows={2}
                                                    value={replyText}
                                                    onChange={e => setReplyText(e.target.value)}
                                                    placeholder="Escribe tu respuesta..."
                                                    style={{ flex: 1, fontSize: 13 }}
                                                />
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <button
                                                        className="uk-button uk-button-primary uk-button-small"
                                                        onClick={() => handleReply(review.reviewId || review.name)}
                                                        disabled={sending || !replyText.trim()}
                                                    >
                                                        {sending ? '...' : 'Enviar'}
                                                    </button>
                                                    <button
                                                        className="uk-button uk-button-default uk-button-small"
                                                        onClick={() => { setReplyingId(null); setReplyText(''); }}
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                className="uk-button uk-button-default uk-button-small"
                                                onClick={() => setReplyingId(review.reviewId || review.name)}
                                            >
                                                Responder
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
