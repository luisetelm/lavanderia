// Utilidades compartidas por las piezas del chat (lista, hilo, compositor).
// Vivían dentro de la antigua página de mensajes; al pasar el chat a un widget
// que se monta sobre toda la aplicación, se separan para que cada pieza sea
// pequeña y pueda probarse a mano por separado.

/* ── Adjuntos ── */
export const ACCEPTED_TYPES = [
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
export const ACCEPT_STRING = ACCEPTED_TYPES.join(',');

export function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Media ── */
export const MEDIA_LABELS = {
    image: { icon: '📷', label: 'Imagen' },
    video: { icon: '🎥', label: 'Vídeo' },
    audio: { icon: '🎵', label: 'Audio' },
    document: { icon: '📄', label: 'Documento' },
    sticker: { icon: '🏷️', label: 'Sticker' },
    location: { icon: '📍', label: 'Ubicación' },
    contact: { icon: '👤', label: 'Contacto' },
};

/** Detecta tipo de media a partir del texto (mensajes antiguos sin mediaType) */
export function detectMediaFromContent(content) {
    if (!content) return null;
    const lower = content.toLowerCase().trim();
    if (lower === '[image]' || lower === '[imagen]') return 'image';
    if (lower === '[video]' || lower === '[vídeo]') return 'video';
    if (lower === '[audio]') return 'audio';
    if (lower === '[document]' || lower === '[documento]') return 'document';
    if (lower === '[sticker]') return 'sticker';
    return null;
}

/** Vista previa legible del último mensaje para la lista de conversaciones */
export function previewText(conv) {
    const mediaType = conv.lastMediaType || detectMediaFromContent(conv.lastMessage);
    const info = MEDIA_LABELS[mediaType];
    if (!info) return conv.lastMessage || '';
    const content = conv.lastMessage;
    if (!content || content.startsWith('[')) return `${info.icon} ${info.label}`;
    return `${info.icon} ${content}`;
}

/* ── Identidad de la conversación ── */
export function convDisplayName(conv) {
    if (!conv) return '';
    if (conv.firstName || conv.lastName) return `${conv.firstName || ''} ${conv.lastName || ''}`.trim();
    return `+${conv.phone || 'Desconocido'}`;
}

export function convInitials(conv) {
    if (!conv || !(conv.firstName || conv.lastName)) return '?';
    return `${(conv.firstName || '?')[0]}${(conv.lastName || '?')[0]}`;
}

/** Últimos 9 dígitos: lo que se guarda como teléfono de cliente en España */
export function localPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length > 9 ? digits.slice(-9) : digits;
}

/* ── Fechas ── */
function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function yesterdayOf(now) { const y = new Date(now); y.setDate(y.getDate() - 1); return y; }
const hhmm = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** Hora corta para la lista: "12:30", "Ayer 12:30", "03/05 12:30" */
export function formatTime(date) {
    if (!date) return '';
    const d = new Date(date);
    const now = new Date();
    if (sameDay(d, now)) return hhmm(d);
    if (sameDay(d, yesterdayOf(now))) return `Ayer ${hhmm(d)}`;
    const sameYear = d.getFullYear() === now.getFullYear();
    const datePart = d.toLocaleDateString('es-ES', sameYear
        ? { day: '2-digit', month: '2-digit' }
        : { day: '2-digit', month: '2-digit', year: '2-digit' });
    return `${datePart} ${hhmm(d)}`;
}

/** Etiqueta del separador de día en el hilo */
export function formatDaySeparator(date) {
    const d = new Date(date);
    const now = new Date();
    if (sameDay(d, now)) return 'Hoy';
    if (sameDay(d, yesterdayOf(now))) return 'Ayer';
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString('es-ES', sameYear
        ? { weekday: 'long', day: '2-digit', month: 'long' }
        : { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Fecha+hora para la meta de cada burbuja */
export function formatMsgMeta(date) {
    const d = new Date(date);
    const now = new Date();
    if (sameDay(d, now)) return hhmm(d);
    const sameYear = d.getFullYear() === now.getFullYear();
    const datePart = d.toLocaleDateString('es-ES', sameYear
        ? { day: '2-digit', month: '2-digit' }
        : { day: '2-digit', month: '2-digit', year: '2-digit' });
    return `${datePart} ${hhmm(d)}`;
}

/* ── Pedidos (panel de contexto) ── */
export const ORDER_STATUS = {
    pending:   { text: 'Pendiente', cls: 'uk-label-warning' },
    ready:     { text: 'Listo',     cls: 'uk-label-success' },
    collected: { text: 'Recogido',  cls: '' },
    cancelled: { text: 'Cancelado', cls: 'uk-label-danger' },
};

export const isOrderActive = (o) => o?.status === 'pending' || o?.status === 'ready';

/* ── Permisos ── */
// Sólo quien atiende clientes recibe mensajes; en el taller no pintan nada.
export const puedeVerMensajes = (user) => user?.role === 'admin' || user?.role === 'cashier';
