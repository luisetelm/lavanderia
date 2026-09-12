import React, {useState} from 'react';
import {useDraftOrder} from '../hooks/useDraftOrder.js';
import './DraftLines.css';

// Líneas del pedido en curso (prendas) con toda su edición: color, cantidad,
// nota y fotos, desglose en prendas individuales, pasos opcionales y borrado.
// Se usa en claro dentro del POS y en oscuro en la barra flotante del borrador.

const GARMENT_COLORS = [
    { key: 'negro',    label: 'Negro',     hex: '#1e1e1e' },
    { key: 'blanco',   label: 'Blanco',    hex: '#f5f5f5' },
    { key: 'gris',     label: 'Gris',      hex: '#9ca3af' },
    { key: 'azul',     label: 'Azul',      hex: '#3b82f6' },
    { key: 'marino',   label: 'Marino',    hex: '#1e3a5f' },
    { key: 'rojo',     label: 'Rojo',      hex: '#ef4444' },
    { key: 'verde',    label: 'Verde',     hex: '#22c55e' },
    { key: 'marron',   label: 'Marrón',    hex: '#92400e' },
    { key: 'beige',    label: 'Beige',     hex: '#d4b896' },
    { key: 'rosa',     label: 'Rosa',      hex: '#f472b6' },
    { key: 'amarillo', label: 'Amarillo',  hex: '#facc15' },
    { key: 'morado',   label: 'Morado',    hex: '#a855f7' },
    { key: 'burdeos',  label: 'Burdeos',   hex: '#7f1d1d' },
    { key: 'naranja',  label: 'Naranja',   hex: '#f97316' },
];

const QUICK_NOTES = ['Mancha difícil', 'Prenda delicada', 'Sin garantía', 'Botones sueltos', 'Color desteñido'];

/* Comprime una foto a JPEG pequeño antes de guardarla en el borrador */
const compressPhoto = (file) => new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
        img.onload = () => {
            const MAX = 800;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
                const ratio = Math.min(MAX / w, MAX / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
});

export default function DraftLines({theme = 'light', emptyText = null}) {
    const {
        cart, discount, getPriceForItem,
        updateQuantity, removeFromCart, updateLineNotes, addLinePhoto, removeLinePhoto,
        splitLine, toggleOptionalStep, setLineColor,
    } = useDraftOrder();
    const [openLineId, setOpenLineId] = useState(null);
    const hasDiscount = Number(discount) > 0;

    const handlePhotoCapture = async (lineId, e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            const dataUrl = await compressPhoto(file);
            addLinePhoto(lineId, dataUrl);
        }
        e.target.value = '';
    };

    if (!cart.length) {
        return emptyText ? <div className={`dl dl-${theme} dl-empty`}>{emptyText}</div> : null;
    }

    return (
        <div className={`dl dl-${theme}`}>
            {cart.map(c => {
                const unitPrice = getPriceForItem(c);
                const lineTotal = unitPrice * c.quantity;
                const baseTotal = Number(c.basePrice) * c.quantity;
                const hasDetail = c.notes || (c.photos && c.photos.length > 0);
                const optionalSteps = c.availableOptionalSteps || [];
                const isOpen = openLineId === c.lineId;
                const color = c.color ? GARMENT_COLORS.find(g => g.key === c.color) : null;

                return (
                    <div key={c.lineId} className={`dl-line ${isOpen ? 'is-open' : ''}`}>
                        <div className="dl-row">
                            {/* Nombre + indicadores */}
                            <div className="dl-name" title={c.name}>
                                {color && (
                                    <span className={`dl-dot ${color.key === 'blanco' ? 'is-white' : ''}`}
                                          style={{background: color.hex}} title={color.label}/>
                                )}
                                <span className="dl-name-text">{c.name}</span>
                                {hasDetail && (
                                    <span className="dl-flags">
                                        {c.notes && <span uk-icon="icon: file-edit; ratio: 0.5" title={c.notes}></span>}
                                        {c.photos?.length > 0 && <span uk-icon="icon: camera; ratio: 0.5" title={`${c.photos.length} foto(s)`}></span>}
                                    </span>
                                )}
                            </div>

                            {/* Color de la prenda */}
                            <div className="dl-colors" title="Color de la prenda">
                                {GARMENT_COLORS.map(gc => (
                                    <button
                                        key={gc.key}
                                        type="button"
                                        title={gc.label}
                                        aria-label={gc.label}
                                        aria-pressed={c.color === gc.key}
                                        className={`dl-color ${c.color === gc.key ? 'is-selected' : ''} ${gc.key === 'blanco' ? 'is-white' : ''}`}
                                        style={{background: gc.hex}}
                                        onClick={() => setLineColor(c.lineId, c.color === gc.key ? null : gc.key)}
                                    />
                                ))}
                            </div>

                            {/* Cantidad */}
                            <div className="dl-qty">
                                <button type="button" className="dl-btn" aria-label="Una menos"
                                        onClick={() => updateQuantity(c.lineId, c.quantity - 1)}>−</button>
                                <span className="dl-qty-num">{c.quantity}</span>
                                <button type="button" className="dl-btn" aria-label="Una más"
                                        onClick={() => updateQuantity(c.lineId, c.quantity + 1)}>+</button>
                            </div>

                            {/* Precio */}
                            <div className="dl-price">
                                {hasDiscount && <s>{baseTotal.toFixed(2)}</s>}
                                <span>{lineTotal.toFixed(2)} €</span>
                            </div>

                            {/* Acciones */}
                            <div className="dl-actions">
                                <button type="button"
                                        className={`dl-btn ${isOpen ? 'is-active' : ''}`}
                                        title="Nota o foto de la prenda"
                                        onClick={() => setOpenLineId(isOpen ? null : c.lineId)}>
                                    <span uk-icon="icon: comment; ratio: 0.6"></span>
                                    <span uk-icon="icon: camera; ratio: 0.6"></span>
                                </button>
                                {c.quantity > 1 && (
                                    <button type="button" className="dl-btn" title="Desglosar en prendas individuales"
                                            onClick={() => splitLine(c.lineId)}>
                                        <span uk-icon="icon: grid; ratio: 0.6"></span>
                                    </button>
                                )}
                                <button type="button" className="dl-btn dl-btn-danger" title="Quitar del pedido"
                                        aria-label="Quitar del pedido"
                                        onClick={() => removeFromCart(c.lineId)}>×</button>
                            </div>
                        </div>

                        {/* Pasos opcionales del itinerario */}
                        {optionalSteps.length > 0 && (
                            <div className="dl-extras">
                                <span className="dl-extras-label">Extra:</span>
                                {optionalSteps.map(step => {
                                    const selected = (c.optionalStepIds || []).includes(step.id);
                                    return (
                                        <button key={step.id} type="button"
                                                className={`dl-chip ${selected ? 'is-selected' : ''}`}
                                                onClick={() => toggleOptionalStep(c.lineId, step.id)}>
                                            {selected ? '✓ ' : ''}{step.stepLabel}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {/* Detalle: nota y fotos */}
                        {isOpen && (
                            <div className="dl-detail">
                                <div className="dl-chips">
                                    {QUICK_NOTES.map(chip => (
                                        <button key={chip} type="button" className="dl-chip"
                                                onClick={() => {
                                                    const cur = (c.notes || '').trim();
                                                    updateLineNotes(c.lineId, cur + (cur ? '. ' : '') + chip);
                                                }}>
                                            {chip}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    type="text"
                                    className="dl-input"
                                    value={c.notes || ''}
                                    onChange={(e) => updateLineNotes(c.lineId, e.target.value)}
                                    placeholder="Nota: mancha, daño, etc."
                                />
                                <div className="dl-photos">
                                    {(c.photos || []).map((photo, pi) => (
                                        <div key={pi} className="dl-photo">
                                            <img src={photo} alt={`Foto ${pi + 1}`}/>
                                            <button type="button" aria-label="Quitar foto"
                                                    onClick={() => removeLinePhoto(c.lineId, pi)}>×</button>
                                        </div>
                                    ))}
                                    <label className="dl-photo-add" title="Añadir foto">
                                        <span uk-icon="icon: plus; ratio: 0.8"></span>
                                        <input type="file" accept="image/*" capture="environment" multiple
                                               onChange={(e) => handlePhotoCapture(c.lineId, e)}/>
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
