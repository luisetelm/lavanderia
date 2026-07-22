import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTrackingBoard, updateStepStatus, undoStep, batchCompleteSteps } from '../api.js';
import PageToolbar from '../components/PageToolbar.jsx';
import { avisar } from '../utils/dialogo.js';
import { COLOR_HEX, colorDotBorder } from '../utils/colores.js';
import { printFinishedLabelForOrder, printGarmentFinishedLabel } from '../utils/printUtils.js';

/* ─────────────────────────────────────────────────────────────
   Vista de TALLER del tracking (la que ve el trabajador).

   Se diferencia del tablero de supervisión (/tracking/supervision)
   en que aquí sólo está lo accionable:
     - Columnas visibles configurables (se guardan en localStorage,
       porque la tablet del taller es siempre la misma).
     - Búsqueda por nº de pedido: el prefijo TPV/AAAA/ es fijo en
       todos los pedidos del año, así que se muestra como adorno y
       sólo se teclea el número.
     - Objetivos táctiles grandes: se usa de pie y con prisa.
     - Sin cronómetros ni acumulados: son métricas de gestión.
     - Deshacer visible tras cada acción; en taller se marca mal a menudo.
   ───────────────────────────────────────────────────────────── */

const HIDDEN_COLS_KEY = 'trackingHiddenColumns';
const FULLSCREEN_KEY = 'trackingFullscreen';
const ORDER_PREFIX = `TPV/${new Date().getFullYear()}/`;
const UNDO_TIMEOUT_MS = 12000;
const REFRESH_MS = 30000;
const TOUCH_MIN = 48; // altura mínima de un objetivo táctil (px)

// Safari en iPad no permite pantalla completa fuera de un <video>: ahí el botón
// no se muestra y la solución es instalar la app en la pantalla de inicio.
const FULLSCREEN_SUPPORTED = typeof document !== 'undefined'
    && Boolean(document.documentElement?.requestFullscreen);

function readHiddenCols() {
    try {
        const parsed = JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isToday(date) {
    if (!date) return false;
    const d = new Date(date);
    const today = new Date();
    return d.getFullYear() === today.getFullYear()
        && d.getMonth() === today.getMonth()
        && d.getDate() === today.getDate();
}

function isPast(date) {
    if (!date) return false;
    return new Date(date) < new Date();
}

/* Urgencia reducida a lo que el trabajador puede accionar: dos tonos
   (rojo / ámbar) y una etiqueta de texto, para no depender del color. */
function getUrgency(item) {
    if (isToday(item.fechaLimite)) return { label: 'HOY', tone: 'warn' };
    if (isPast(item.fechaLimite)) return { label: 'URGENTE', tone: 'crit' };
    if (item.urgency === 'critical') return { label: 'SIN MARGEN', tone: 'crit' };
    if (item.urgency === 'tight') return { label: 'JUSTO', tone: 'warn' };
    return null;
}

const TONES = {
    crit: { accent: '#dc2626', bg: '#fef2f2', chipBg: '#fee2e2', chipFg: '#b91c1c' },
    warn: { accent: '#d97706', bg: '#fffbeb', chipBg: '#fef3c7', chipFg: '#b45309' },
};

/* "TPV/2026/0095" -> { prefix: "TPV/2026/", seq: "0095" } */
function splitOrderNum(orderNum) {
    const parts = String(orderNum || '').split('/');
    if (parts.length < 2) return { prefix: '', seq: String(orderNum || '') };
    const seq = parts.pop();
    return { prefix: `${parts.join('/')}/`, seq };
}

/* Búsqueda por nº de pedido. Acepta "95", "0095" y también el número
   completo pegado ("TPV/2026/0095"). Compara sólo la parte secuencial,
   así encuentra igual los pedidos de años anteriores. */
function matchesOrderQuery(orderNum, query) {
    const raw = query.includes('/') ? query.slice(query.lastIndexOf('/') + 1) : query;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return true;
    const { seq } = splitOrderNum(orderNum);
    if (seq.includes(digits)) return true;
    const strip = s => s.replace(/^0+/, '') || '0';
    return strip(seq).startsWith(strip(digits));
}

function formatClock(ms) {
    if (!ms) return null;
    return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export default function TrackingWorkshop({ token }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [hiddenCols, setHiddenCols] = useState(readHiddenCols);
    const [colsPanelOpen, setColsPanelOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [actionLoading, setActionLoading] = useState(null);
    const [undoInfo, setUndoInfo] = useState(null); // { stepIds, label }
    const [batchModal, setBatchModal] = useState(null);
    const [searchFocused, setSearchFocused] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const undoTimer = useRef(null);

    const loadBoard = useCallback(async () => {
        try {
            const result = await fetchTrackingBoard(token);
            setData(result);
            setLastUpdated(Date.now());
            setLoadError(false);
        } catch (err) {
            console.error('Error cargando tracking:', err);
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { loadBoard(); }, [loadBoard]);

    /* El refresco automático reordena las tarjetas bajo el dedo, así que se
       pausa mientras el trabajador está buscando o tiene un panel abierto. */
    const refreshPaused = Boolean(query) || Boolean(batchModal) || colsPanelOpen;
    useEffect(() => {
        if (refreshPaused) return;
        const id = setInterval(loadBoard, REFRESH_MS);
        return () => clearInterval(id);
    }, [loadBoard, refreshPaused]);

    useEffect(() => {
        try {
            localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(hiddenCols));
        } catch { /* localStorage lleno o bloqueado: no es crítico */ }
    }, [hiddenCols]);

    useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

    // Mantener el botón sincronizado si se sale con Escape o con un gesto.
    useEffect(() => {
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        onChange();
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    /* A pantalla completa se oculta el menú lateral (ver .taller-inmersivo en
       uikit-theme.less). Se limpia al salir de la página: si no, quien navegue
       a otra sección se quedaría sin menú. */
    useEffect(() => {
        document.body.classList.toggle('taller-inmersivo', isFullscreen);
        return () => document.body.classList.remove('taller-inmersivo');
    }, [isFullscreen]);

    /* El navegador sólo concede la pantalla completa dentro de un gesto del
       usuario, así que NO se puede activar sola al abrir la página. Si quedó
       activada en esta tablet, se recupera en el primer toque sobre la pantalla. */
    useEffect(() => {
        if (!FULLSCREEN_SUPPORTED) return;
        let quedoActivada = false;
        try { quedoActivada = localStorage.getItem(FULLSCREEN_KEY) === '1'; } catch { /* ignorar */ }
        if (!quedoActivada) return;
        const restaurar = () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => { /* sin gesto válido */ });
            }
        };
        window.addEventListener('pointerdown', restaurar, { once: true });
        return () => window.removeEventListener('pointerdown', restaurar);
    }, []);

    const toggleFullscreen = () => {
        const guardar = (v) => {
            try { localStorage.setItem(FULLSCREEN_KEY, v); } catch { /* ignorar */ }
        };
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => { /* ya fuera */ });
            guardar('0');
        } else {
            document.documentElement.requestFullscreen()
                .then(() => guardar('1'))
                .catch(() => avisar('El navegador no ha permitido la pantalla completa', 'warning'));
        }
    };

    const armUndo = useCallback((stepIds, label) => {
        if (undoTimer.current) clearTimeout(undoTimer.current);
        setUndoInfo({ stepIds, label });
        undoTimer.current = setTimeout(() => setUndoInfo(null), UNDO_TIMEOUT_MS);
    }, []);

    const handleUndo = async () => {
        if (!undoInfo) return;
        const { stepIds } = undoInfo;
        if (undoTimer.current) clearTimeout(undoTimer.current);
        setUndoInfo(null);
        try {
            for (const id of [...stepIds].reverse()) await undoStep(token, id);
            avisar('Acción deshecha', 'warning', 2000);
        } catch (e) {
            avisar(e?.error || 'No se pudo deshacer', 'danger', 4000);
        } finally {
            await loadBoard();
        }
    };

    // Etiqueta de "finalizado" del pedido completo (respeta la config onReady).
    const printFinishedLabel = useCallback(async (orderId) => {
        const order = await printFinishedLabelForOrder(token, orderId);
        if (order) {
            avisar(`Pedido ${order.orderNum} listo · etiqueta impresa`, 'success', 2500);
        }
    }, [token]);

    // Etiqueta "Finalizado" de una prenda concreta (respeta onGarmentReady).
    // Devuelve true si salió: quien la llama usa eso para no imprimir además la
    // etiqueta de recogida del pedido, que duplicaría el ticket de la prenda.
    const printGarmentLabelFor = useCallback(async (item) => {
        if (!item) return false;
        return printGarmentFinishedLabel({
            orderNum: item.orderNum,
            clientName: item.clientName,
            productName: item.productName,
            quantity: item.quantity,
            fechaLimite: item.fechaLimite,
        }, token);
    }, [token]);

    const handleStart = async (item) => {
        setActionLoading(item.stepId);
        try {
            await updateStepStatus(token, item.stepId, { action: 'start' });
            await loadBoard();
            armUndo([item.stepId], `${item.productName} iniciado`);
        } catch (e) {
            console.error('Error iniciando paso:', e);
            avisar('Error al iniciar', 'danger', 3000);
        } finally {
            setActionLoading(null);
        }
    };

    const handleComplete = async (item) => {
        setActionLoading(item.stepId);
        try {
            const res = await updateStepStatus(token, item.stepId, { action: 'complete' });
            await loadBoard();
            armUndo([item.stepId], `${item.productName} · ${splitOrderNum(item.orderNum).seq} completado`);
            // La etiqueta de la prenda ya lleva el QR del pedido: si sale, no se
            // imprime además la de recogida. La de recogida queda para pedidos
            // que llegan a listo sin pasar por el tracking.
            const salioEtiquetaPrenda = res?.lineBecameReady ? await printGarmentLabelFor(item) : false;
            if (res?.orderBecameReady && !salioEtiquetaPrenda) await printFinishedLabel(res.orderId);
        } catch (e) {
            console.error('Error completando paso:', e);
            avisar('Error al completar', 'danger', 3000);
        } finally {
            setActionLoading(null);
        }
    };

    const runBatch = async (stepIds, action, items) => {
        try {
            const res = await batchCompleteSteps(token, stepIds, action);
            setBatchModal(null);
            await loadBoard();
            armUndo(stepIds, action === 'start'
                ? `${stepIds.length} prendas iniciadas`
                : `${stepIds.length} prendas completadas`);
            if (action === 'complete') {
                // Los pedidos cuyas prendas ya han sacado etiqueta no necesitan
                // además la de recogida: la de prenda lleva el mismo QR.
                const conEtiquetaDePrenda = new Set();
                for (const lid of (res?.readyLineIds || [])) {
                    const it = items.find(i => i.orderLineId === lid);
                    if (it && await printGarmentLabelFor(it)) conEtiquetaDePrenda.add(it.orderId);
                }
                for (const oid of (res?.readyOrderIds || [])) {
                    if (!conEtiquetaDePrenda.has(oid)) await printFinishedLabel(oid);
                }
            }
        } catch (e) {
            console.error('Error en acción por lote:', e);
            avisar('Error en la acción por lote', 'danger', 3000);
        }
    };

    const board = useMemo(() => data?.board || [], [data]);

    /* Columnas visibles + filtrado por búsqueda. Se cuenta también cuántas
       coincidencias caen en columnas ocultas: si no, buscar un pedido que
       está en una fase oculta parece un fallo de la aplicación. */
    const { visibleColumns, matchCount, hiddenMatchCount, totalVisibleItems } = useMemo(() => {
        const visible = [];
        let matches = 0;
        let hiddenMatches = 0;
        let total = 0;
        for (const col of board) {
            const isHidden = hiddenCols.includes(col.stepKey);
            const filtered = query ? col.items.filter(i => matchesOrderQuery(i.orderNum, query)) : col.items;
            if (isHidden) {
                hiddenMatches += query ? filtered.length : 0;
                continue;
            }
            total += col.items.length;
            matches += filtered.length;
            visible.push({ ...col, items: filtered });
        }
        return {
            visibleColumns: visible,
            matchCount: matches,
            hiddenMatchCount: hiddenMatches,
            totalVisibleItems: total,
        };
    }, [board, hiddenCols, query]);

    const toggleCol = (stepKey) => {
        setHiddenCols(prev => prev.includes(stepKey)
            ? prev.filter(k => k !== stepKey)
            : [...prev, stepKey]);
    };

    if (loading && !data) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <div uk-spinner="ratio: 1.5"></div>
                <p style={{ color: '#64748b' }}>Cargando tablero...</p>
            </div>
        );
    }

    return (
        <div style={{ paddingBottom: undoInfo ? 90 : 16 }}>
            <PageToolbar
                title="Taller"
                filters={[]}
                actions={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                            className={`uk-button uk-button-small ${hiddenCols.length > 0 ? 'uk-button-primary' : 'uk-button-default'}`}
                            onClick={() => setColsPanelOpen(o => !o)}
                            type="button"
                        >
                            <span uk-icon="icon: table; ratio: 0.8" style={{ marginRight: 4 }}></span>
                            Fases{hiddenCols.length > 0 ? ` (${board.length - hiddenCols.length}/${board.length})` : ''}
                        </button>
                        <button
                            className="uk-button uk-button-default uk-button-small"
                            onClick={loadBoard}
                            type="button"
                            title={lastUpdated ? `Actualizado a las ${formatClock(lastUpdated)}` : 'Actualizar'}
                        >
                            <span uk-icon="icon: refresh; ratio: 0.8"></span>
                        </button>
                        {FULLSCREEN_SUPPORTED && (
                            <button
                                className={`uk-button uk-button-small ${isFullscreen ? 'uk-button-primary' : 'uk-button-default'}`}
                                onClick={toggleFullscreen}
                                type="button"
                                title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                                aria-pressed={isFullscreen}
                            >
                                <span uk-icon={`icon: ${isFullscreen ? 'shrink' : 'expand'}; ratio: 0.8`}></span>
                            </button>
                        )}
                    </div>
                }
            >
                {/* Búsqueda por nº de pedido */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', flex: '1 1 320px', maxWidth: 560,
                        border: `2px solid ${searchFocused ? '#048ABF' : (query ? '#94a3b8' : '#cbd5e1')}`,
                        boxShadow: searchFocused ? '0 0 0 4px rgba(4,138,191,0.15)' : 'none',
                        borderRadius: 10, background: '#fff', overflow: 'hidden', height: 60,
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}>
                        <span style={{ padding: '0 4px 0 14px', color: searchFocused ? '#048ABF' : '#94a3b8', display: 'flex' }}>
                            <span uk-icon="icon: search; ratio: 1.1"></span>
                        </span>
                        <span style={{
                            padding: '0 2px 0 8px', color: '#94a3b8', fontSize: '1rem',
                            fontVariantNumeric: 'tabular-nums', userSelect: 'none', whiteSpace: 'nowrap',
                        }}>
                            {ORDER_PREFIX}
                        </span>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                            placeholder="0095"
                            aria-label="Buscar por número de pedido"
                            style={{
                                flex: 1, minWidth: 0, border: 'none', outline: 'none', height: '100%',
                                fontSize: '1.7rem', fontWeight: 700, letterSpacing: '0.04em',
                                fontVariantNumeric: 'tabular-nums', background: 'transparent', color: '#1e293b',
                            }}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                aria-label="Limpiar búsqueda"
                                style={{
                                    width: 56, height: '100%', border: 'none', background: 'transparent',
                                    color: '#64748b', cursor: 'pointer', fontSize: '1.7rem', lineHeight: 1,
                                }}
                            >
                                ×
                            </button>
                        )}
                    </div>
                    <span style={{
                        fontSize: query ? '0.95rem' : '0.85rem',
                        fontWeight: query ? 600 : 400,
                        color: query && matchCount === 0 ? '#b45309' : '#64748b',
                    }}>
                        {query
                            ? `${matchCount} ${matchCount === 1 ? 'coincidencia' : 'coincidencias'}`
                            : `${totalVisibleItems} ${totalVisibleItems === 1 ? 'prenda' : 'prendas'} en proceso`}
                        {lastUpdated && !query && (
                            <span style={{ color: '#94a3b8' }}> · {formatClock(lastUpdated)}</span>
                        )}
                    </span>
                </div>

                {/* Panel de fases visibles */}
                {colsPanelOpen && (
                    <div style={{
                        marginTop: 10, padding: 12, background: '#f8fafc',
                        border: '1px solid #e2e8f0', borderRadius: 8,
                    }}>
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            marginBottom: 8, gap: 8, flexWrap: 'wrap',
                        }}>
                            <span style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
                                Fases visibles en esta tablet
                            </span>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                    className="uk-button uk-button-default uk-button-small"
                                    type="button"
                                    onClick={() => setHiddenCols([])}
                                >
                                    Todas
                                </button>
                                <button
                                    className="uk-button uk-button-default uk-button-small"
                                    type="button"
                                    onClick={() => setHiddenCols(board.map(c => c.stepKey))}
                                >
                                    Ninguna
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {board.map(col => {
                                const active = !hiddenCols.includes(col.stepKey);
                                return (
                                    <button
                                        key={col.stepKey}
                                        type="button"
                                        onClick={() => toggleCol(col.stepKey)}
                                        aria-pressed={active}
                                        style={{
                                            minHeight: 42, padding: '0 14px', borderRadius: 21, cursor: 'pointer',
                                            border: `1px solid ${active ? '#048ABF' : '#cbd5e1'}`,
                                            background: active ? '#e0f2fe' : '#fff',
                                            color: active ? '#036a94' : '#64748b',
                                            fontWeight: active ? 700 : 400, fontSize: '0.85rem',
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                        }}
                                    >
                                        {active ? '✓' : '○'} {col.stepLabel}
                                        <span style={{ opacity: 0.7 }}>({col.items.length})</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </PageToolbar>

            {/* Datos posiblemente desactualizados: en el taller el wifi falla. */}
            {loadError && (
                <div className="uk-alert uk-alert-warning" style={{ marginBottom: 12 }}>
                    <strong>Sin conexión con el servidor.</strong>{' '}
                    {lastUpdated
                        ? `Estos datos son de las ${formatClock(lastUpdated)}.`
                        : 'No se han podido cargar los datos.'}{' '}
                    <button
                        className="uk-button uk-button-default uk-button-small"
                        onClick={loadBoard}
                        type="button"
                        style={{ marginLeft: 8 }}
                    >
                        Reintentar
                    </button>
                </div>
            )}

            {query && matchCount === 0 && hiddenMatchCount > 0 && (
                <div className="uk-alert uk-alert-primary" style={{ marginBottom: 12 }}>
                    Ese pedido está en una fase que tienes oculta
                    ({hiddenMatchCount} {hiddenMatchCount === 1 ? 'prenda' : 'prendas'}).{' '}
                    <button
                        className="uk-button uk-button-default uk-button-small"
                        onClick={() => setHiddenCols([])}
                        type="button"
                    >
                        Ver todas las fases
                    </button>
                </div>
            )}

            {board.length === 0 && (
                <div className="uk-alert uk-alert-primary uk-text-center">
                    No hay itinerarios configurados. Configura itinerarios y asígnalos a productos para ver el tablero.
                </div>
            )}

            {board.length > 0 && visibleColumns.length === 0 && (
                <div className="uk-alert uk-alert-primary uk-text-center">
                    No hay ninguna fase visible.{' '}
                    <button
                        className="uk-button uk-button-default uk-button-small"
                        onClick={() => setHiddenCols([])}
                        type="button"
                    >
                        Mostrar todas
                    </button>
                </div>
            )}

            {/* A pantalla completa todas las fases van en una fila con scroll
                horizontal, como un tablero de taller. En ventana normal se
                reparten en rejilla para no obligar a desplazarse en una tablet
                que ya tiene el menú ocupando ancho. */}
            <div style={isFullscreen ? {
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                paddingBottom: 8,
            } : {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
                alignItems: 'start',
            }}>
                {visibleColumns.map(column => (
                    <WorkshopColumn
                        key={column.stepKey}
                        column={column}
                        query={query}
                        actionLoading={actionLoading}
                        inmersivo={isFullscreen}
                        onStart={handleStart}
                        onComplete={handleComplete}
                        onOpenBatch={setBatchModal}
                    />
                ))}
            </div>

            {batchModal && (
                <BatchModal
                    data={batchModal}
                    onConfirm={(stepIds) => runBatch(stepIds, batchModal.action, batchModal.items)}
                    onClose={() => setBatchModal(null)}
                />
            )}

            {undoInfo && (
                <UndoBar label={undoInfo.label} onUndo={handleUndo} onDismiss={() => setUndoInfo(null)} />
            )}
        </div>
    );
}

/* ── Columna ── */
function WorkshopColumn({ column, query, actionLoading, inmersivo, onStart, onComplete, onOpenBatch }) {
    const isBatch = column.resource?.processingMode === 'batch';
    const pendingItems = column.items.filter(i => i.status === 'pending');
    const inProgressItems = column.items.filter(i => i.status === 'in_progress');

    return (
        <div className="uk-card uk-card-default" style={{
            overflow: 'hidden', borderRadius: 10,
            // En la fila horizontal la columna no debe encogerse ni estirarse.
            ...(inmersivo ? { flex: '0 0 320px' } : {}),
        }}>
            <div style={{
                padding: '12px 14px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc',
                display: 'flex', alignItems: 'center', gap: 8,
            }}>
                <strong style={{ fontSize: '1rem', flex: 1 }}>{column.stepLabel}</strong>
                <span className="uk-badge" style={{ background: '#048ABF', minWidth: 24, textAlign: 'center' }}>
                    {column.items.length}
                </span>
            </div>

            {/* Acciones por lote: sólo tienen sentido en recursos de tipo lote (lavadoras, secadoras). */}
            {isBatch && column.items.length > 1 && (
                <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 6 }}>
                    {column.autoProgress && pendingItems.length > 0 && (
                        <button
                            className="uk-button uk-button-default"
                            style={{ flex: 1, minHeight: 44, fontSize: '0.85rem' }}
                            type="button"
                            onClick={() => onOpenBatch({ ...column, action: 'start', items: pendingItems })}
                        >
                            ▶ Iniciar lote ({pendingItems.length})
                        </button>
                    )}
                    <button
                        className="uk-button uk-button-primary"
                        style={{ flex: 1, minHeight: 44, fontSize: '0.85rem' }}
                        type="button"
                        onClick={() => onOpenBatch({
                            ...column,
                            action: 'complete',
                            items: column.autoProgress ? inProgressItems : column.items,
                        })}
                    >
                        ✓ Completar lote ({column.autoProgress ? inProgressItems.length : column.items.length})
                    </button>
                </div>
            )}

            <div style={{
                padding: 8, display: 'flex', flexDirection: 'column', gap: 8,
                // Cada columna se desplaza por dentro para que su cabecera y el
                // recuento sigan visibles mientras se recorre la fila.
                ...(inmersivo ? { maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' } : {}),
            }}>
                {column.items.length === 0 ? (
                    <div style={{ padding: '24px 12px', textAlign: 'center', color: '#cbd5e1', fontSize: '0.85rem' }}>
                        {query ? 'Sin coincidencias' : 'Nada pendiente'}
                    </div>
                ) : (
                    column.items.map(item => (
                        <GarmentCard
                            key={item.stepId}
                            item={item}
                            busy={actionLoading === item.stepId}
                            onStart={onStart}
                            onComplete={onComplete}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

/* ── Tarjeta de prenda ── */
function GarmentCard({ item, busy, onStart, onComplete }) {
    const urgency = getUrgency(item);
    const tone = urgency ? TONES[urgency.tone] : null;
    const isInProgress = item.status === 'in_progress';
    const { prefix, seq } = splitOrderNum(item.orderNum);

    // Misma regla que el tablero de supervisión: los pasos autoProgress se
    // inician primero y sólo entonces se pueden completar.
    const showStart = item.autoProgress && item.status === 'pending';
    const showComplete = !item.autoProgress || isInProgress;

    return (
        <div style={{
            border: '1px solid #e2e8f0',
            borderLeft: `5px solid ${tone ? tone.accent : (isInProgress ? '#2563eb' : '#e2e8f0')}`,
            borderRadius: 8,
            background: isInProgress ? '#eff6ff' : (tone ? tone.bg : '#fff'),
            padding: 10,
        }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{prefix}</span>
                    <strong style={{ fontSize: '1.25rem', letterSpacing: '0.02em' }}>{seq}</strong>
                </span>
                {urgency && (
                    <span style={{
                        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em',
                        padding: '2px 8px', borderRadius: 10,
                        background: tone.chipBg, color: tone.chipFg,
                    }}>
                        {urgency.label}
                    </span>
                )}
                {isInProgress && (
                    <span style={{
                        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em',
                        padding: '2px 8px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8',
                    }}>
                        EN PROCESO
                    </span>
                )}
            </div>

            <div style={{
                fontSize: '1rem', fontWeight: 600, marginTop: 4,
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                {item.color && COLOR_HEX[item.color] && (
                    <span style={{
                        width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                        background: COLOR_HEX[item.color], border: colorDotBorder(item.color),
                    }}></span>
                )}
                {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.productName}
            </div>

            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2 }}>
                {item.clientName}
                {item.fechaLimite && (
                    <> · Entrega {new Date(item.fechaLimite).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</>
                )}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {showStart && (
                    <button
                        className="uk-button uk-button-default"
                        style={{ flex: 1, minHeight: TOUCH_MIN, fontSize: '0.95rem', fontWeight: 600 }}
                        type="button"
                        disabled={busy}
                        onClick={() => onStart(item)}
                    >
                        {busy ? '...' : '▶ Iniciar'}
                    </button>
                )}
                {showComplete && (
                    <button
                        className="uk-button uk-button-primary"
                        style={{ flex: 1, minHeight: TOUCH_MIN, fontSize: '0.95rem', fontWeight: 600 }}
                        type="button"
                        disabled={busy}
                        onClick={() => onComplete(item)}
                    >
                        {busy ? '...' : '✓ Completar'}
                    </button>
                )}
            </div>
        </div>
    );
}

/* ── Barra de deshacer ── */
function UndoBar({ label, onUndo, onDismiss }) {
    return (
        <div style={{
            position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 1050,
            display: 'flex', alignItems: 'center', gap: 12, maxWidth: 560, margin: '0 auto',
            background: '#1e293b', color: '#fff', borderRadius: 10, padding: '10px 12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}>
            <span style={{ flex: 1, fontSize: '0.9rem', minWidth: 0 }}>{label}</span>
            <button
                type="button"
                onClick={onUndo}
                style={{
                    minHeight: 44, padding: '0 18px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid #64748b', background: 'transparent', color: '#fff',
                    fontWeight: 700, fontSize: '0.9rem',
                }}
            >
                Deshacer
            </button>
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Cerrar"
                style={{
                    width: 40, minHeight: 44, border: 'none', background: 'transparent',
                    color: '#94a3b8', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1,
                }}
            >
                ×
            </button>
        </div>
    );
}

/* ── Modal de lote (táctil) ── */
function BatchModal({ data, onConfirm, onClose }) {
    const [selected, setSelected] = useState(data.items.map(i => i.stepId));
    const isStart = data.action === 'start';

    const toggle = (stepId) => {
        setSelected(prev => prev.includes(stepId)
            ? prev.filter(id => id !== stepId)
            : [...prev, stepId]);
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: '#fff', borderRadius: 12, padding: 20,
                    maxWidth: 480, width: '100%', maxHeight: '85vh',
                    display: 'flex', flexDirection: 'column',
                }}
                onClick={e => e.stopPropagation()}
            >
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 4px' }}>
                    {isStart ? 'Iniciar' : 'Completar'}: {data.stepLabel}
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 12px' }}>
                    Marca las prendas que entran en el lote.
                    {data.resource && (
                        <span style={{ display: 'block', marginTop: 4 }}>
                            Capacidad: {data.resource.batchCapacity} {(data.resource.capacityUnit || 'items') === 'kg' ? 'kg' : 'uds'}
                            {data.resource.cycleDurationMin ? ` · ${data.resource.cycleDurationMin} min/ciclo` : ''}
                        </span>
                    )}
                </p>

                <div style={{ overflowY: 'auto', flex: 1, marginBottom: 12 }}>
                    {data.items.map(item => {
                        const { prefix, seq } = splitOrderNum(item.orderNum);
                        return (
                            <label
                                key={item.stepId}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '10px 4px', borderBottom: '1px solid #f1f5f9',
                                    cursor: 'pointer', minHeight: TOUCH_MIN,
                                }}
                            >
                                <input
                                    type="checkbox"
                                    className="uk-checkbox"
                                    checked={selected.includes(item.stepId)}
                                    onChange={() => toggle(item.stepId)}
                                    style={{ width: 22, height: 22, flexShrink: 0 }}
                                />
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {item.color && COLOR_HEX[item.color] && (
                                            <span style={{
                                                width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                                                background: COLOR_HEX[item.color], border: colorDotBorder(item.color),
                                            }}></span>
                                        )}
                                        {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.productName}
                                    </span>
                                    <span style={{ fontSize: '0.78rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                                        <span style={{ color: '#94a3b8' }}>{prefix}</span>{seq} · {item.clientName}
                                    </span>
                                </span>
                            </label>
                        );
                    })}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        className="uk-button uk-button-default"
                        style={{ flex: 1, minHeight: TOUCH_MIN }}
                        type="button"
                        onClick={onClose}
                    >
                        Cancelar
                    </button>
                    <button
                        className="uk-button uk-button-primary"
                        style={{ flex: 2, minHeight: TOUCH_MIN, fontWeight: 600 }}
                        type="button"
                        onClick={() => onConfirm(selected)}
                        disabled={selected.length === 0}
                    >
                        {isStart ? 'Iniciar' : 'Completar'} ({selected.length})
                    </button>
                </div>
            </div>
        </div>
    );
}
