import React, {useState, useEffect} from 'react';
import {useDraftOrder} from '../hooks/useDraftOrder.js';
import './DraftLines.css';
import {confirmar} from '../utils/dialogo.js';
import {MOTIVOS_PRECIO} from '../utils/fueraCatalogo.js';

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

const MAX_CANTIDAD = 9999;

/* Cantidad de la línea: con − y + para retocar, y escribible para las grandes
   (50, 80, 100 servilletas). Se aplica al salir del campo o con Intro; vacío
   o 0 vuelve al valor anterior (para quitar la línea está la ×). */
function CantidadLinea({value, onChange}) {
    const [texto, setTexto] = useState(String(value));
    useEffect(() => { setTexto(String(value)); }, [value]);

    const aplicar = () => {
        const n = parseInt(texto, 10);
        if (!Number.isFinite(n) || n < 1) { setTexto(String(value)); return; }
        const q = Math.min(n, MAX_CANTIDAD);
        if (q !== value) onChange(q);
        setTexto(String(q));
    };

    return (
        <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className="dl-qty-input"
            aria-label="Cantidad"
            title="Escribe la cantidad"
            value={texto}
            size={Math.max(2, texto.length)}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setTexto(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={aplicar}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === 'Escape') { setTexto(String(value)); e.currentTarget.blur(); }
            }}
        />
    );
}

const precioTexto = (n) => (Math.round(Number(n) * 100) / 100).toString().replace('.', ',');
const leerPrecio = (t) => {
    const n = Number(String(t).replace(',', '.').trim());
    return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 100) / 100 : null;
};

/* Ajustar el precio de una prenda (un traje muy sucio): precio por unidad y
   motivo, que es obligatorio y queda en la ficha del pedido. En una prenda
   fuera de catálogo se cambian su nombre y su precio. */
function PrecioLinea({c, tarifa, onApply, onClear, onClose}) {
    const fuera = Boolean(c.fueraCatalogo);
    const [precio, setPrecio] = useState(precioTexto(c.precioManual ?? tarifa));
    const [motivo, setMotivo] = useState(c.motivoPrecio || '');
    const [nombre, setNombre] = useState(c.nombreLibre || '');
    const valor = leerPrecio(precio);
    const puede = valor !== null && (fuera ? nombre.trim() && valor > 0 : motivo.trim());

    return (
        <div className="dl-detail dl-price-edit">
            {fuera ? (
                <input type="text" className="dl-input" value={nombre} maxLength={120}
                       onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la prenda"/>
            ) : (
                <div className="dl-price-tarifa">Tarifa: <strong>{precioTexto(tarifa)} €</strong> por unidad</div>
            )}
            <div className="dl-price-row">
                <label className="dl-price-field">
                    <span>Precio por unidad</span>
                    <input type="text" inputMode="decimal" className="dl-input" value={precio} autoFocus
                           onFocus={(e) => e.target.select()}
                           onChange={(e) => setPrecio(e.target.value.replace(/[^0-9.,]/g, ''))}/>
                    <span>€</span>
                </label>
                {!fuera && [['+20 %', 1.2], ['+50 %', 1.5], ['×2', 2]].map(([t, f]) => (
                    <button key={t} type="button" className="dl-chip" onClick={() => setPrecio(precioTexto(tarifa * f))}>{t}</button>
                ))}
            </div>
            {!fuera && (
                <>
                    <div className="dl-chips">
                        {MOTIVOS_PRECIO.map(m => (
                            <button key={m} type="button" className={`dl-chip ${motivo === m ? 'is-selected' : ''}`}
                                    onClick={() => setMotivo(m)}>{m}</button>
                        ))}
                    </div>
                    <input type="text" className="dl-input" value={motivo} maxLength={200}
                           onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del cambio de precio (obligatorio)"/>
                </>
            )}
            <div className="dl-price-actions">
                <button type="button" className="dl-chip is-primary" disabled={!puede}
                        onClick={() => { onApply(valor, motivo.trim(), nombre.trim()); onClose(); }}>
                    Aplicar
                </button>
                {!fuera && c.precioManual != null && (
                    <button type="button" className="dl-chip" onClick={() => { onClear(); onClose(); }}>Volver a la tarifa</button>
                )}
                <button type="button" className="dl-chip" onClick={onClose}>Cancelar</button>
            </div>
        </div>
    );
}

export default function DraftLines({theme = 'light', emptyText = null}) {
    const {
        cart, discount, getPriceForItem, agreedPriceFor,
        updateQuantity, removeFromCart, updateLineNotes, addLinePhoto, removeLinePhoto,
        splitLine, toggleOptionalStep, setLineItinerary, setLineColor, setLinePrice,
    } = useDraftOrder();
    const [openLineId, setOpenLineId] = useState(null);
    const [precioLineId, setPrecioLineId] = useState(null); // prenda con el ajuste de precio abierto
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
                const tarifa = getPriceForItem({...c, precioManual: null});
                const ajustado = !c.fueraCatalogo && c.precioManual !== null && c.precioManual !== undefined;
                const baseTotal = Number(c.basePrice) * c.quantity;
                const pactado = agreedPriceFor(c.productId) !== null;
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
                                {c.fueraCatalogo && <em className="dl-agreed" title="Prenda fuera de catálogo">fuera de catálogo</em>}
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
                                <CantidadLinea value={c.quantity} onChange={(q) => updateQuantity(c.lineId, q)}/>
                                <button type="button" className="dl-btn" aria-label="Una más"
                                        onClick={() => updateQuantity(c.lineId, c.quantity + 1)}>+</button>
                            </div>

                            {/* Precio */}
                            <div className="dl-price">
                                {ajustado ? (
                                    <>
                                        <s>{(tarifa * c.quantity).toFixed(2)}</s>
                                        <em className="dl-agreed is-adjusted" title={c.motivoPrecio || 'Precio ajustado'}>ajustado</em>
                                    </>
                                ) : (
                                    <>
                                        {hasDiscount && !pactado && !c.fueraCatalogo && <s>{baseTotal.toFixed(2)}</s>}
                                        {pactado && !c.fueraCatalogo && <em className="dl-agreed" title="Precio pactado con este cliente">pactado</em>}
                                    </>
                                )}
                                <span>{lineTotal.toFixed(2)} €</span>
                            </div>

                            {/* Acciones */}
                            <div className="dl-actions">
                                <button type="button"
                                        className={`dl-btn ${precioLineId === c.lineId ? 'is-active' : ''}`}
                                        title={c.fueraCatalogo ? 'Nombre y precio de la prenda' : 'Ajustar el precio de esta prenda'}
                                        aria-label="Ajustar precio"
                                        onClick={() => setPrecioLineId(precioLineId === c.lineId ? null : c.lineId)}>
                                    €
                                </button>
                                <button type="button"
                                        className={`dl-btn ${isOpen ? 'is-active' : ''}`}
                                        title="Nota o foto de la prenda"
                                        onClick={() => setOpenLineId(isOpen ? null : c.lineId)}>
                                    <span uk-icon="icon: comment; ratio: 0.6"></span>
                                    <span uk-icon="icon: camera; ratio: 0.6"></span>
                                </button>
                                {c.quantity > 1 && (
                                    <button type="button" className="dl-btn" title="Desglosar en prendas individuales"
                                            onClick={async () => {
                                                // Con muchas unidades saldrían decenas de líneas.
                                                if (c.quantity > 20 && !(await confirmar(
                                                    `Se crearán ${c.quantity} líneas, una por prenda. ¿Desglosar?`,
                                                    {textoConfirmar: 'Desglosar'}))) return;
                                                splitLine(c.lineId);
                                            }}>
                                        <span uk-icon="icon: grid; ratio: 0.6"></span>
                                    </button>
                                )}
                                <button type="button" className="dl-btn dl-btn-danger" title="Quitar del pedido"
                                        aria-label="Quitar del pedido"
                                        onClick={() => removeFromCart(c.lineId)}>×</button>
                            </div>
                        </div>

                        {precioLineId === c.lineId && (
                            <PrecioLinea c={c} tarifa={tarifa}
                                         onApply={(precio, motivo, nombre) => setLinePrice(c.lineId, precio, motivo, nombre)}
                                         onClear={() => setLinePrice(c.lineId, null)}
                                         onClose={() => setPrecioLineId(null)}/>
                        )}
                        {ajustado && precioLineId !== c.lineId && c.motivoPrecio && (
                            <div className="dl-price-note">Precio ajustado: {c.motivoPrecio}</div>
                        )}

                        {/* Itinerario: sólo si el producto puede ir por más de uno */}
                        {(c.itineraryOptions || []).length > 1 && (
                            <div className="dl-extras">
                                <span className="dl-extras-label">Itinerario:</span>
                                {c.itineraryOptions.map(op => (
                                    <button key={op.id} type="button"
                                            className={`dl-chip ${c.itineraryId === op.id ? 'is-selected' : ''}`}
                                            onClick={() => setLineItinerary(c.lineId, op.id)}>
                                        {c.itineraryId === op.id ? '✓ ' : ''}{op.name}
                                    </button>
                                ))}
                            </div>
                        )}

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
