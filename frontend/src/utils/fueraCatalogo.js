// Prendas fuera de catálogo y precios ajustados en el TPV (backend sql/035).
//
// Una prenda que no está en el catálogo se pica con nombre y precio libres sobre
// uno de tres productos genéricos (archivados: no salen en la rejilla), según el
// servicio, para que el taller tenga sus pasos. La regla de verdad del precio y
// de la carga está en el backend (utils/presupuesto.js y cargaPorPrecio en
// utils/cargaTrabajo.js); aquí sólo se replica para enseñarla y para que la
// fecha sugerida cuente la carga de la prenda.

export const TIPOS_FUERA_CATALOGO = [
    { sku: 'FUERA-SECO', label: 'Limpieza en seco' },
    { sku: 'FUERA-LAVADO', label: 'Lavado' },
    { sku: 'FUERA-PLANCHA', label: 'Sólo plancha' },
];

export const esFueraDeCatalogo = (sku) => TIPOS_FUERA_CATALOGO.some(t => t.sku === sku);

// Camisas equivalentes por unidad: precio / 7 (sólo plancha, / 6), en tramos de 0,5, mínimo 0,5
export function cargaPorPrecio(precio, sku) {
    const divisor = sku === 'FUERA-PLANCHA' ? 6 : 7;
    return Math.max(0.5, Math.round((Number(precio) || 0) / divisor * 2) / 2);
}

// Motivos rápidos para ajustar el precio de una prenda del catálogo
export const MOTIVOS_PRECIO = ['Muy sucio', 'Manchas difíciles', 'Trabajo extra', 'Prenda delicada', 'Tamaño grande'];
