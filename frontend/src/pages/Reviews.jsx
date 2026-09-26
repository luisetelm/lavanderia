import React, { useEffect, useState } from 'react';
import { avisar } from '../utils/dialogo.js';
import { fetchGoogleStatus, fetchGoogleReviews, replyGoogleReview, fetchGoogleAuthUrl, fetchGoogleLocations, saveGoogleLocation } from '../api.js';
import PageToolbar from '../components/PageToolbar.jsx';

const stars = (rating) => {
    const map = { FIVE: 5, FOUR: 4, THREE: 3, TWO: 2, ONE: 1 };
    const n = map[rating] || 0;
    return '★'.repeat(n) + '☆'.repeat(5 - n);
};

export default function Reviews({ token }) {
    const [connected, setConnected] = useState(false);
    const [hasLocation, setHasLocation] = useState(false);
    const [locations, setLocations] = useState(null); // cuentas con sus locales, para elegir
    const [error, setError] = useState('');
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all, unreplied, 1-5
    const [replyingId, setReplyingId] = useState(null);
    const [replyText, setReplyText] = useState('');
    const [sending, setSending] = useState(false);

    const load = async () => {
        setError('');
        setLoading(true);
        try {
            const status = await fetchGoogleStatus(token);
            setConnected(status.connected);
            const conLocal = !!(status.accountId && status.locationId);
            setHasLocation(conLocal);
            if (status.connected && !conLocal) {
                // Conectado pero sin local elegido: se listan los de la cuenta para escoger
                setLocations(await fetchGoogleLocations(token));
            } else if (status.connected) {
                setReviews(await fetchGoogleReviews(token));
            }
        } catch (err) {
            console.error('Error cargando reseñas:', err);
            setError(err.error || 'No se han podido cargar las reseñas');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

    // Pide al backend la URL de autorización y manda ahí al navegador
    const conectarGoogle = async () => {
        try {
            const { url } = await fetchGoogleAuthUrl(token);
            window.location.href = url;
        } catch (err) {
            avisar(err.error || 'No se ha podido iniciar la conexión con Google', 'danger');
        }
    };

    const elegirLocal = async (accountId, locationId) => {
        try {
            await saveGoogleLocation(token, accountId, locationId);
            setLocations(null);
            await load();
        } catch (err) {
            avisar(err.error || 'No se ha podido guardar el local', 'danger');
        }
    };

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

            {error && (
                <div className="uk-alert-danger" uk-alert="true" style={{ marginBottom: 16 }}>
                    <p>{error}</p>
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>
            ) : !connected ? (
                <div className="uk-card uk-card-default uk-card-body" style={{ textAlign: 'center' }}>
                    <h3>Google no conectado</h3>
                    <p>Conecta la cuenta de Google que gestiona el Perfil de Empresa (hola@labuhardilla.online) para leer y responder las reseñas.</p>
                    <button type="button" className="uk-button uk-button-primary" onClick={conectarGoogle}>
                        Conectar Google
                    </button>
                </div>
            ) : !hasLocation ? (
                <div className="uk-card uk-card-default uk-card-body">
                    <h3>Elige el local</h3>
                    <p>Google está conectado. Elige el Perfil de Empresa cuyas reseñas quieres gestionar aquí.</p>
                    {!locations || locations.length === 0 ? (
                        <p className="uk-text-muted">La cuenta conectada no tiene ningún Perfil de Empresa accesible.</p>
                    ) : locations.map(acc => (
                        <div key={acc.accountId} style={{ marginBottom: 16 }}>
                            <strong>{acc.accountName}</strong>
                            <ul className="uk-list uk-list-divider">
                                {acc.locations.length === 0 && <li className="uk-text-muted">Sin locales</li>}
                                {acc.locations.map(loc => (
                                    <li key={loc.locationId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                        <span style={{ flex: 1, minWidth: 200 }}>
                                            {loc.title}
                                            {loc.address && <span className="uk-text-muted uk-text-small"> · {loc.address}</span>}
                                        </span>
                                        <button type="button" className="uk-button uk-button-primary uk-button-small"
                                                onClick={() => elegirLocal(acc.accountId, loc.locationId)}>
                                            Usar este local
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
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
