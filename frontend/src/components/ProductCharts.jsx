import React, {useEffect, useRef, useState} from 'react';

// Gráficos de la ficha de producto, en SVG propio (sin librería), como las
// barras de Stats.jsx. Una serie y un eje por gráfico: unidades e importe no se
// mezclan en el mismo, se elige uno u otro.

const COLORES = {
    serie: '#048ABF',       // color de marca; contraste >= 3:1 sobre blanco
    serieActiva: '#036a93',
    pista: '#dbeef7',       // fondo de los medidores: el mismo azul, más claro
    rejilla: '#eef2f6',
    eje: '#cbd5e1',
    texto: '#1e293b',
    textoSuave: '#64748b',
};

function useAncho(ref) {
    const [ancho, setAncho] = useState(0);
    useEffect(() => {
        if (!ref.current) return undefined;
        const ro = new ResizeObserver(([e]) => setAncho(Math.floor(e.contentRect.width)));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, [ref]);
    return ancho;
}

// Tope "redondo" del eje y separación entre marcas: 0-5-10-15, 0-200-400...
function escala(max, entero, marcas = 4) {
    if (!(max > 0)) return {tope: entero ? marcas : 1, paso: entero ? 1 : 0.25};
    const bruto = max / marcas;
    const mag = 10 ** Math.floor(Math.log10(bruto));
    let paso = [1, 2, 5, 10].map((f) => f * mag).find((p) => p >= bruto);
    if (entero) paso = Math.max(1, Math.round(paso));
    return {tope: paso * Math.ceil(max / paso), paso};
}

// Columna con las esquinas de arriba redondeadas y la base recta.
function columna(x, y, w, h, r = 4) {
    if (h <= 0) return '';
    const rr = Math.min(r, h, w / 2);
    const base = y + h;
    return `M${x},${base}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${base}Z`;
}

/**
 * Columnas de una serie.
 * datos: [{clave, etiqueta, etiquetaLarga, valor, detalle?}]
 */
export function ColumnChart({datos, formato, formatoEje = formato, entero = false, alto = 220, etiqueta}) {
    const ref = useRef(null);
    const ancho = useAncho(ref);
    const [activo, setActivo] = useState(null);

    const m = {izq: 56, der: 8, arr: 22, aba: 26};
    const n = datos.length;
    const plotW = Math.max(0, ancho - m.izq - m.der);
    const plotH = alto - m.arr - m.aba;
    const max = Math.max(0, ...datos.map((d) => d.valor));
    const {tope, paso} = escala(max, entero);
    const banda = n ? plotW / n : 0;
    const anchoColumna = Math.min(24, Math.max(2, banda * 0.62));
    const yDe = (v) => m.arr + plotH - (v / tope) * plotH;
    const cadaCuanto = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 58))));
    const iMax = max > 0 ? datos.findIndex((d) => d.valor === max) : -1;
    const marcas = [];
    for (let v = 0; v <= tope + paso / 1000; v += paso) marcas.push(v);

    const d = activo != null ? datos[activo] : null;
    const xTooltip = d ? Math.min(Math.max(m.izq + activo * banda + banda / 2, 70), ancho - 70) : 0;

    return (
        <div ref={ref} style={{position: 'relative'}}>
            {ancho > 0 && (
                <svg width={ancho} height={alto} role="img" aria-label={etiqueta} style={{display: 'block', overflow: 'visible'}}>
                    {marcas.map((v) => (
                        <g key={v}>
                            <line x1={m.izq} x2={m.izq + plotW} y1={yDe(v)} y2={yDe(v)}
                                  stroke={v === 0 ? COLORES.eje : COLORES.rejilla} strokeWidth="1" shapeRendering="crispEdges"/>
                            <text x={m.izq - 8} y={yDe(v)} dy="0.32em" textAnchor="end" fontSize="11"
                                  fill={COLORES.textoSuave} style={{fontVariantNumeric: 'tabular-nums'}}>
                                {formatoEje(v)}
                            </text>
                        </g>
                    ))}
                    {datos.map((p, i) => {
                        const x = m.izq + i * banda;
                        const y = yDe(p.valor);
                        return (
                            <g key={p.clave}>
                                <path d={columna(x + (banda - anchoColumna) / 2, y, anchoColumna, m.arr + plotH - y)}
                                      fill={activo === i ? COLORES.serieActiva : COLORES.serie}/>
                                {i % cadaCuanto === 0 && (
                                    <text x={x + banda / 2} y={alto - 8} textAnchor="middle" fontSize="11" fill={COLORES.textoSuave}>
                                        {p.etiqueta}
                                    </text>
                                )}
                                {i === iMax && activo == null && (
                                    <text x={x + banda / 2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill={COLORES.texto}>
                                        {formato(p.valor)}
                                    </text>
                                )}
                                <rect x={x} y={m.arr} width={banda} height={plotH} fill="transparent" tabIndex={0}
                                      aria-label={`${p.etiquetaLarga}: ${formato(p.valor)}`} style={{outline: 'none'}}
                                      onPointerEnter={() => setActivo(i)} onPointerLeave={() => setActivo(null)}
                                      onFocus={() => setActivo(i)} onBlur={() => setActivo(null)}/>
                            </g>
                        );
                    })}
                </svg>
            )}
            {d && (
                <div role="tooltip" style={{
                    position: 'absolute', left: xTooltip, top: yDe(d.valor) - 8, transform: 'translate(-50%, -100%)',
                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 4px 12px rgba(15,23,42,0.12)',
                    padding: '6px 10px', pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: '0.78rem', zIndex: 2,
                }}>
                    <div style={{fontWeight: 700, color: COLORES.texto}}>{formato(d.valor)}</div>
                    {d.detalle && <div style={{color: COLORES.textoSuave}}>{d.detalle}</div>}
                    <div style={{color: COLORES.textoSuave}}>{d.etiquetaLarga}</div>
                </div>
            )}
        </div>
    );
}

/** Barra de proporción (0-100 %) sobre una pista del mismo azul. */
export function Medidor({pct}) {
    return (
        <div style={{height: 8, borderRadius: 4, background: COLORES.pista, overflow: 'hidden'}}>
            <div style={{width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: COLORES.serie, borderRadius: 4}}/>
        </div>
    );
}
