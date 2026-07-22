import React, { useEffect, useState, useCallback } from 'react';
import { fetchTrackingBoard, updateStepStatus, batchCompleteSteps, undoStep } from '../api.js';
import { useNavigate } from 'react-router-dom';
import UIkit from 'uikit';
import PageToolbar from '../components/PageToolbar.jsx';
import { confirmar } from '../utils/dialogo.js';
import { COLOR_HEX } from '../utils/colores.js';
import { printFinishedLabelForOrder, printGarmentFinishedLabel } from '../utils/printUtils.js';

/* Qué paso se deshace desde una tarjeta:
   - si el paso actual está en curso, se deshace su inicio;
   - si está pendiente, se retrocede la prenda al último paso ya completado.
   Devuelve null cuando no hay nada que deshacer (prenda en su primer paso). */
function getUndoTarget(item) {
    if (item.status === 'in_progress') {
        return { stepId: item.stepId, label: 'el inicio de este paso' };
    }
    const done = (item.lineStepsTiming || []).filter(s => s.status === 'done');
    if (done.length === 0) return null;
    const last = done[done.length - 1]; // lineStepsTiming ya viene ordenado
    return { stepId: last.id, label: `el paso "${last.stepLabel}"` };
}

function isPast(date) {
    if (!date) return false;
    return new Date(date) < new Date();
}

function isToday(date) {
    if (!date) return false;
    const d = new Date(date);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
}

export default function TrackingBoard({ token }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [batchModal, setBatchModal] = useState(null);
    const [now, setNow] = useState(Date.now());
    const [expandedSteps, setExpandedSteps] = useState({}); // { [stepId]: true }
    const navigate = useNavigate();

    // Reloj para refrescar cronómetros de pasos en curso (1s)
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    const loadBoard = useCallback(async () => {
        try {
            const result = await fetchTrackingBoard(token);
            setData(result);
        } catch (err) {
            console.error('Error cargando tracking:', err);
        } finally {
            setLoading(false);
        }
    }, [token]);

    // Imprime la etiqueta de "finalizado" (recogida) de un pedido que acaba de
    // pasar a "listo" al completar su tracking. Usa el helper central (respeta onReady).
    const printFinishedLabel = useCallback(async (orderId) => {
        const order = await printFinishedLabelForOrder(token, orderId);
        if (order) {
            UIkit.notification({ message: `Pedido ${order.orderNum} listo · etiqueta de finalizado impresa`, status: 'success', pos: 'top-right', timeout: 2500 });
        }
    }, [token]);

    // Busca un item (prenda) del tablero por su stepId actual.
    const findItemByStepId = useCallback((stepId) => {
        if (!data?.board) return null;
        for (const col of data.board) {
            const found = col.items.find(i => i.stepId === stepId);
            if (found) return found;
        }
        return null;
    }, [data]);

    // Imprime la etiqueta "Finalizado" de una prenda concreta (respeta onGarmentReady).
    // Devuelve true si la etiqueta salió: quien la llama lo usa para no imprimir
    // además la de recogida, que duplicaría el ticket de la prenda.
    const printGarmentLabelFor = useCallback(async (item) => {
        if (!item) return false;
        const printed = await printGarmentFinishedLabel({
            orderNum: item.orderNum,
            clientName: item.clientName,
            productName: item.productName,
            quantity: item.quantity,
            fechaLimite: item.fechaLimite,
        }, token);
        if (printed) {
            UIkit.notification({ message: `Prenda finalizada · etiqueta impresa (${item.orderNum})`, status: 'success', pos: 'top-right', timeout: 2000 });
        }
        return printed;
    }, [token]);

    useEffect(() => {
        loadBoard();
        const interval = setInterval(loadBoard, 30000);
        return () => clearInterval(interval);
    }, [loadBoard]);

    const handleComplete = async (stepId) => {
        setActionLoading(stepId);
        // Capturar los datos de la prenda ANTES de recargar el tablero (luego cambia de columna).
        const item = findItemByStepId(stepId);
        try {
            const res = await updateStepStatus(token, stepId, { action: 'complete' });
            await loadBoard();
            UIkit.notification({ message: 'Paso completado', status: 'success', pos: 'top-right', timeout: 1500 });
            // Si la prenda quedó totalmente finalizada, imprimir su etiqueta "Finalizado".
            // Esa etiqueta ya lleva el QR del pedido, así que sustituye a la de
            // recogida; la de recogida queda para pedidos sin tracking.
            const salioEtiquetaPrenda = res?.lineBecameReady ? await printGarmentLabelFor(item) : false;
            if (res?.orderBecameReady && !salioEtiquetaPrenda) {
                await printFinishedLabel(res.orderId);
            }
        } catch (e) {
            console.error('Error completando paso:', e);
            UIkit.notification({ message: 'Error al completar', status: 'danger', pos: 'top-right', timeout: 2000 });
        } finally {
            setActionLoading(null);
        }
    };

    const handleStart = async (stepId) => {
        setActionLoading(stepId);
        try {
            await updateStepStatus(token, stepId, { action: 'start' });
            await loadBoard();
            UIkit.notification({ message: 'Proceso iniciado', status: 'primary', pos: 'top-right', timeout: 1500 });
        } catch (e) {
            console.error('Error iniciando paso:', e);
            UIkit.notification({ message: 'Error al iniciar', status: 'danger', pos: 'top-right', timeout: 2000 });
        } finally {
            setActionLoading(null);
        }
    };

    const handleUndo = async (item) => {
        const target = getUndoTarget(item);
        if (!target) return;
        const ok = await confirmar(
            `Se va a deshacer ${target.label} de "${item.productName}" (#${item.orderNum}).\n\nLa prenda volverá a quedar pendiente en esa fase.`,
            { titulo: 'Deshacer paso', textoConfirmar: 'Deshacer', peligroso: true }
        );
        if (!ok) return;
        setActionLoading(item.stepId);
        try {
            await undoStep(token, target.stepId);
            await loadBoard();
            UIkit.notification({ message: 'Paso deshecho', status: 'warning', pos: 'top-right', timeout: 1500 });
        } catch (e) {
            console.error('Error deshaciendo paso:', e);
            const msg = e?.error || 'Error al deshacer';
            UIkit.notification({ message: msg, status: 'danger', pos: 'top-right', timeout: 3000 });
        } finally {
            setActionLoading(null);
        }
    };

    const handleBatchComplete = async (stepIds, items = [], action = 'complete') => {
        try {
            const res = await batchCompleteSteps(token, stepIds, action);
            setBatchModal(null);
            await loadBoard();
            UIkit.notification({
                message: action === 'start'
                    ? `${stepIds.length} prendas en proceso`
                    : `${stepIds.length} prendas completadas`,
                status: 'success', pos: 'top-right', timeout: 2000,
            });
            if (action !== 'complete') return;
            // Etiqueta "Finalizado" por cada prenda que quedó totalmente terminada.
            // Los pedidos que ya han sacado etiqueta de prenda no llevan además
            // la de recogida: sería el mismo ticket por duplicado.
            const conEtiquetaDePrenda = new Set();
            for (const lid of (res?.readyLineIds || [])) {
                const it = items.find(i => i.orderLineId === lid);
                if (it && await printGarmentLabelFor(it)) conEtiquetaDePrenda.add(it.orderId);
            }
            for (const oid of (res?.readyOrderIds || [])) {
                if (!conEtiquetaDePrenda.has(oid)) await printFinishedLabel(oid);
            }
        } catch (e) {
            console.error('Error batch:', e);
        }
    };

    if (loading && !data) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <div uk-spinner="ratio: 1"></div>
                <p style={{ color: '#64748b' }}>Cargando tablero...</p>
            </div>
        );
    }

    if (!data) return null;

    const { board } = data;
    const totalItems = board.reduce((sum, col) => sum + col.items.length, 0);

    return (
        <div>
            <PageToolbar
                title="Tracking · Supervisión"
                filters={[]}
                actions={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            {totalItems} prendas en proceso
                        </span>
                        <button className="uk-button uk-button-default uk-button-small" onClick={loadBoard} style={{ fontSize: '0.78rem' }}>
                            ↻
                        </button>
                    </div>
                }
            />

            {/* Leyenda */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: '0.72rem', color: '#64748b', flexWrap: 'wrap' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 2, marginRight: 4 }}></span> Entrega pasada</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 2, marginRight: 4 }}></span> Entrega hoy</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 2, marginRight: 4 }}></span> En proceso</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 2, marginRight: 4 }}></span> Lote (varias prendas)</span>
                <span>🔴 Tiempo insuficiente</span>
                <span>🟡 Plazo ajustado</span>
                <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>⏱ Tiempo total pendiente</span>
            </div>

            {/* Board */}
            <div style={{
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                paddingBottom: 16,
                margin: '0 -16px',
                padding: '0 16px 16px',
            }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${board.length}, minmax(220px, 280px))`,
                    gap: 12,
                    minWidth: board.length * 232,
                }}>
                {board.map(column => {
                    const isBatch = column.resource?.processingMode === 'batch';
                    const hasAutoProgress = column.autoProgress;
                    const isEmpty = column.items.length === 0;

                    return (
                        <div key={column.stepKey} className="uk-card uk-card-default" style={{
                            overflow: 'hidden', minWidth: 200,
                            opacity: isEmpty ? 0.55 : 1,
                            transition: 'opacity 0.3s ease',
                        }}>
                            {/* Column header */}
                            <div style={{
                                padding: '12px 14px',
                                borderBottom: '1px solid #e5e7eb',
                                display: 'flex', alignItems: 'center', gap: 8,
                                background: isEmpty ? '#f1f5f9' : '#f8fafc',
                            }}>
                                <strong style={{ fontSize: '0.85rem', flex: 1, color: isEmpty ? '#94a3b8' : 'inherit' }}>
                                    {column.stepLabel}
                                </strong>
                                <span className="uk-badge" style={{
                                    background: isEmpty ? '#cbd5e1' : '#3b82f6',
                                    minWidth: 22, textAlign: 'center',
                                }}>
                                    {column.items.length}
                                </span>
                            </div>

                            {/* Resource info */}
                            {column.resource && !isEmpty && (
                                <div style={{ padding: '4px 14px', background: isBatch ? '#f0fdf4' : '#f0f9ff', fontSize: '0.68rem', color: isBatch ? '#15803d' : '#0369a1', borderBottom: '1px solid #e0f2fe' }}>
                                    {column.resource.label} ({column.resource.units}u)
                                    {isBatch && <span> · Lote max. {column.resource.batchCapacity} {(column.resource.capacityUnit || 'items') === 'kg' ? 'kg' : 'uds'}</span>}
                                </div>
                            )}

                            {/* Batch action */}
                            {isBatch && column.items.length > 1 && (
                                <div style={{ padding: '6px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 4 }}>
                                    {hasAutoProgress && column.items.some(i => i.status === 'pending') && (
                                        <button
                                            className="uk-button uk-button-default uk-button-small"
                                            style={{ fontSize: '0.7rem', padding: '4px 8px', flex: 1 }}
                                            onClick={() => setBatchModal({
                                                ...column, action: 'start',
                                                items: column.items.filter(i => i.status === 'pending'),
                                            })}
                                        >
                                            Iniciar lote ({column.items.filter(i => i.status === 'pending').length})
                                        </button>
                                    )}
                                    <button
                                        className="uk-button uk-button-primary uk-button-small"
                                        style={{ fontSize: '0.7rem', padding: '4px 8px', flex: 1 }}
                                        onClick={() => setBatchModal({
                                            ...column, action: 'complete',
                                            items: hasAutoProgress
                                                ? column.items.filter(i => i.status === 'in_progress')
                                                : column.items,
                                        })}
                                    >
                                        Completar ({hasAutoProgress
                                            ? column.items.filter(i => i.status === 'in_progress').length
                                            : column.items.length})
                                    </button>
                                </div>
                            )}

                            {/* Items */}
                            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                                {isEmpty ? (
                                    <div style={{ padding: '28px 14px', textAlign: 'center', color: '#cbd5e1', fontSize: '0.78rem' }}>
                                        —
                                    </div>
                                ) : (
                                    column.items.map(item => {
                                        const isInProgress = item.status === 'in_progress';
                                        let bgColor = 'transparent';
                                        if (isInProgress) bgColor = '#dbeafe';
                                        else if (isPast(item.fechaLimite)) bgColor = '#fef2f2';
                                        else if (isToday(item.fechaLimite)) bgColor = '#fffbeb';

                                        const urgencyIcon = item.urgency === 'critical' ? '🔴'
                                            : item.urgency === 'tight' ? '🟡' : null;

                                        const formatEstimate = (min) => {
                                            if (!min || min <= 0) return null;
                                            if (min < 60) return `~${min}min`;
                                            const h = Math.floor(min / 60);
                                            const m = min % 60;
                                            return m > 0 ? `~${h}h${m}m` : `~${h}h`;
                                        };

                                        // ── Helpers de tiempos reales (en vivo) ──
                                        const formatHHMM = (iso) => {
                                            if (!iso) return null;
                                            const d = new Date(iso);
                                            const today = new Date();
                                            const sameDay = d.toDateString() === today.toDateString();
                                            const hhmm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                                            if (sameDay) return hhmm;
                                            return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${hhmm}`;
                                        };
                                        const formatDurationMs = (ms) => {
                                            if (!ms || ms <= 0) return '0s';
                                            const s = Math.floor(ms / 1000);
                                            const h = Math.floor(s / 3600);
                                            const m = Math.floor((s % 3600) / 60);
                                            const sec = s % 60;
                                            if (h > 0) return `${h}h ${m}m`;
                                            if (m > 0) return `${m}m ${sec}s`;
                                            return `${sec}s`;
                                        };

                                        // Tiempo del paso actual (si está iniciado o en curso)
                                        const currentStepStartedMs = item.startedAt ? new Date(item.startedAt).getTime() : null;
                                        const currentStepElapsedMs = (isInProgress && currentStepStartedMs)
                                            ? Math.max(0, now - currentStepStartedMs)
                                            : 0;
                                        // Tiempo total acumulado en la prenda = pasos ya completados + paso actual en curso
                                        const totalElapsedMs = (item.lineElapsedMsCompleted || 0) + currentStepElapsedMs;

                                        return (
                                            <div key={item.stepId} style={{
                                                padding: '8px 14px',
                                                borderBottom: '1px solid #f1f5f9',
                                                background: bgColor,
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                                                    <div
                                                        style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                                                        onClick={() => navigate('/tareas', { state: { filterOrderId: item.orderId, orderNumber: item.orderNum } })}
                                                    >
                                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                                                            {urgencyIcon && <span title={item.urgency === 'critical' ? 'Tiempo insuficiente' : 'Plazo ajustado'}>{urgencyIcon}</span>}
                                                            {item.color && COLOR_HEX[item.color] && (
                                                                <span style={{
                                                                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                                                    background: COLOR_HEX[item.color],
                                                                    border: item.color === 'blanco' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.1)',
                                                                }}></span>
                                                            )}
                                                            {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.productName}
                                                            {isInProgress && (
                                                                <span style={{ fontSize: '0.65rem', color: '#2563eb', marginLeft: 6, fontWeight: 400 }}>
                                                                    EN PROCESO
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                                                            #{item.orderNum} · {item.clientName}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                                            {item.fechaLimite && (
                                                                <span style={{
                                                                    fontSize: '0.65rem', marginTop: 2,
                                                                    color: isPast(item.fechaLimite) ? '#ef4444' : '#94a3b8',
                                                                    fontWeight: isPast(item.fechaLimite) ? 600 : 400,
                                                                }}>
                                                                    {isPast(item.fechaLimite) ? 'URGENTE · ' : ''}
                                                                    Entrega: {new Date(item.fechaLimite).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                                                </span>
                                                            )}
                                                            {(item.totalRemainingMin > 0 || item.estimatedMin > 0) && (
                                                                <span style={{
                                                                    fontSize: '0.6rem', marginTop: 2, padding: '0 5px',
                                                                    background: item.urgency === 'critical' ? '#fef2f2' : item.urgency === 'tight' ? '#fffbeb' : '#f0f9ff',
                                                                    color: item.urgency === 'critical' ? '#dc2626' : item.urgency === 'tight' ? '#d97706' : '#0369a1',
                                                                    borderRadius: 4, border: '1px solid',
                                                                    borderColor: item.urgency === 'critical' ? '#fca5a5' : item.urgency === 'tight' ? '#fde68a' : '#bae6fd',
                                                                }}
                                                                    title={`Este paso: ${formatEstimate(item.estimatedMin) || '0min'} · Total pendiente: ${formatEstimate(item.totalRemainingMin) || '0min'}`}
                                                                >
                                                                    ⏱ {formatEstimate(item.totalRemainingMin || item.estimatedMin)}
                                                                    {item.totalRemainingMin > 0 && item.estimatedMin > 0 && item.totalRemainingMin !== item.estimatedMin && (
                                                                        <span style={{ opacity: 0.65 }}> (paso: {formatEstimate(item.estimatedMin)})</span>
                                                                    )}
                                                                </span>
                                                            )}
                                                            {/* Inicio del paso actual + cronómetro en curso */}
                                                            {currentStepStartedMs && (
                                                                <span style={{
                                                                    fontSize: '0.6rem', marginTop: 2, padding: '0 5px',
                                                                    background: isInProgress ? '#eff6ff' : '#f1f5f9',
                                                                    color: isInProgress ? '#1d4ed8' : '#475569',
                                                                    borderRadius: 4,
                                                                    border: '1px solid',
                                                                    borderColor: isInProgress ? '#bfdbfe' : '#e2e8f0',
                                                                    fontVariantNumeric: 'tabular-nums',
                                                                }}
                                                                    title={`Paso iniciado a las ${formatHHMM(item.startedAt)}`}
                                                                >
                                                                    ▶ {formatHHMM(item.startedAt)}
                                                                    {isInProgress && (
                                                                        <span style={{ marginLeft: 4, fontWeight: 600 }}>
                                                                            · {formatDurationMs(currentStepElapsedMs)}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            )}
                                                            {/* Tiempo total acumulado en la prenda (todos los pasos) */}
                                                            {totalElapsedMs > 0 && (
                                                                <span style={{
                                                                    fontSize: '0.6rem', marginTop: 2, padding: '0 5px',
                                                                    background: '#f8fafc', color: '#475569',
                                                                    borderRadius: 4, border: '1px solid #e2e8f0',
                                                                    fontVariantNumeric: 'tabular-nums',
                                                                }}
                                                                    title={`Tiempo total acumulado de ejecución de esta prenda${item.lineFirstStartedAt ? ` (desde ${formatHHMM(item.lineFirstStartedAt)})` : ''}`}
                                                                >
                                                                    Σ {formatDurationMs(totalElapsedMs)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                                        {/* Botón expandir tiempos por paso */}
                                                        {Array.isArray(item.lineStepsTiming) && item.lineStepsTiming.length > 0 && (
                                                            <button
                                                                className="uk-button uk-button-default uk-button-small"
                                                                style={{ fontSize: '0.65rem', padding: '2px 6px', color: '#475569', borderColor: '#cbd5e1' }}
                                                                onClick={() => setExpandedSteps(prev => ({ ...prev, [item.stepId]: !prev[item.stepId] }))}
                                                                title="Ver tiempos de cada paso"
                                                            >
                                                                {expandedSteps[item.stepId] ? '▴' : '▾'}
                                                            </button>
                                                        )}
                                                        {/* Deshacer: devuelve la prenda a la fase anterior (o cancela el inicio) */}
                                                        {getUndoTarget(item) && (
                                                            <button
                                                                className="uk-button uk-button-default uk-button-small"
                                                                style={{ fontSize: '0.65rem', padding: '2px 6px', color: '#b45309', borderColor: '#fcd34d' }}
                                                                onClick={() => handleUndo(item)}
                                                                disabled={actionLoading === item.stepId}
                                                                title="Deshacer el último paso de esta prenda"
                                                            >
                                                                ↶
                                                            </button>
                                                        )}
                                                        {/* Botón Iniciar: solo para pasos autoProgress que estén pending */}
                                                        {item.autoProgress && item.status === 'pending' && (
                                                            <button
                                                                className="uk-button uk-button-default uk-button-small"
                                                                style={{ fontSize: '0.65rem', padding: '2px 8px', color: '#2563eb', borderColor: '#93c5fd' }}
                                                                onClick={() => handleStart(item.stepId)}
                                                                disabled={actionLoading === item.stepId}
                                                                title="Iniciar proceso"
                                                            >
                                                                {actionLoading === item.stepId ? '...' : '▶'}
                                                            </button>
                                                        )}
                                                        {/* Botón Completar */}
                                                        {(!item.autoProgress || item.status === 'in_progress') && (
                                                            <button
                                                                className="uk-button uk-button-primary uk-button-small"
                                                                style={{ fontSize: '0.65rem', padding: '2px 10px' }}
                                                                onClick={() => handleComplete(item.stepId)}
                                                                disabled={actionLoading === item.stepId}
                                                                title="Marcar como completado"
                                                            >
                                                                {actionLoading === item.stepId ? '...' : '✓'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                {/* Panel expandido: tiempos de cada paso */}
                                                {expandedSteps[item.stepId] && Array.isArray(item.lineStepsTiming) && item.lineStepsTiming.length > 0 && (
                                                    <div style={{
                                                        marginTop: 6, padding: '6px 8px',
                                                        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4,
                                                        fontSize: '0.68rem',
                                                    }}>
                                                        <div style={{ fontWeight: 600, color: '#475569', marginBottom: 4, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                                                            Cronología de pasos
                                                        </div>
                                                        {item.lineStepsTiming.map(s => {
                                                            const isCurr = s.id === item.stepId;
                                                            // Calcular tiempo vivo si está en curso
                                                            let liveMs = s.elapsedMs;
                                                            if (s.status === 'in_progress' && s.startedAt) {
                                                                liveMs = Math.max(0, now - new Date(s.startedAt).getTime());
                                                            }
                                                            const statusIcon = s.status === 'done' ? '✓'
                                                                : s.status === 'in_progress' ? '▶'
                                                                : '○';
                                                            const statusColor = s.status === 'done' ? '#16a34a'
                                                                : s.status === 'in_progress' ? '#2563eb'
                                                                : '#94a3b8';
                                                            return (
                                                                <div key={s.id} style={{
                                                                    display: 'grid',
                                                                    gridTemplateColumns: 'auto 1fr auto',
                                                                    gap: 6, alignItems: 'center',
                                                                    padding: '2px 0',
                                                                    fontWeight: isCurr ? 600 : 400,
                                                                }}>
                                                                    <span style={{ color: statusColor, width: 12, textAlign: 'center' }}>{statusIcon}</span>
                                                                    <span style={{ color: s.status === 'pending' ? '#94a3b8' : '#1e293b' }}>
                                                                        {s.stepLabel}
                                                                        {s.startedAt && (
                                                                            <span style={{ marginLeft: 6, color: '#94a3b8', fontWeight: 400 }}>
                                                                                {formatHHMM(s.startedAt)}
                                                                                {s.completedAt && ` → ${formatHHMM(s.completedAt)}`}
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <span style={{
                                                                        fontVariantNumeric: 'tabular-nums',
                                                                        color: statusColor,
                                                                        minWidth: 50, textAlign: 'right',
                                                                    }}>
                                                                        {liveMs != null ? formatDurationMs(liveMs) : '—'}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
                </div>
            </div>

            {board.length === 0 && (
                <div className="uk-alert uk-alert-primary uk-text-center" style={{ marginTop: 20 }}>
                    No hay itinerarios configurados. Configura itinerarios y asígnalos a productos para ver el tablero.
                </div>
            )}

            {board.length > 0 && totalItems === 0 && (
                <div className="uk-alert uk-alert-primary uk-text-center" style={{ marginTop: 20 }}>
                    No hay prendas en proceso. Los pedidos nuevos aparecerán aquí automáticamente.
                </div>
            )}

            {/* Batch Complete Modal */}
            {batchModal && (
                <BatchCompleteModal
                    data={batchModal}
                    onComplete={(stepIds) => handleBatchComplete(stepIds, batchModal.items || [], batchModal.action || 'complete')}
                    onClose={() => setBatchModal(null)}
                />
            )}
        </div>
    );
}

function BatchCompleteModal({ data, onComplete, onClose }) {
    const [selected, setSelected] = useState(data.items.map(i => i.stepId));

    const toggleItem = (stepId) => {
        setSelected(prev =>
            prev.includes(stepId) ? prev.filter(id => id !== stepId) : [...prev, stepId]
        );
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.4)', zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
        }} onClick={onClose}>
            <div style={{
                background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '100%',
                maxHeight: '80vh', overflowY: 'auto',
            }} onClick={e => e.stopPropagation()}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 4px' }}>
                    Completar: {data.stepLabel}
                </h3>
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 16px' }}>
                    Selecciona las prendas completadas
                    {data.resource && (
                        <span style={{ display: 'block', marginTop: 4, fontSize: '0.72rem' }}>
                            Capacidad del lote: {data.resource.batchCapacity} prendas · {data.resource.cycleDurationMin} min/ciclo
                        </span>
                    )}
                </p>

                <div style={{ marginBottom: 16 }}>
                    {data.items.map(item => (
                        <label key={item.stepId} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 0', borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer', fontSize: '0.85rem',
                        }}>
                            <input
                                type="checkbox"
                                className="uk-checkbox"
                                checked={selected.includes(item.stepId)}
                                onChange={() => toggleItem(item.stepId)}
                            />
                            <div>
                                <strong>
                                    {item.color && COLOR_HEX[item.color] && (
                                        <span style={{
                                            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                                            background: COLOR_HEX[item.color], marginRight: 6, verticalAlign: 'middle',
                                            border: item.color === 'blanco' ? '1px solid #ccc' : 'none',
                                        }}></span>
                                    )}
                                    {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.productName}
                                </strong>
                                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                    #{item.orderNum} · {item.clientName}
                                </div>
                            </div>
                        </label>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="uk-button uk-button-default uk-button-small" onClick={onClose}>
                        Cancelar
                    </button>
                    <button
                        className="uk-button uk-button-primary uk-button-small"
                        onClick={() => onComplete(selected)}
                        disabled={selected.length === 0}
                    >
                        Completar ({selected.length})
                    </button>
                </div>
            </div>
        </div>
    );
}
