// Ajustes de impresión automática (persistidos en localStorage).
// Controlan qué se imprime solo en cada momento del flujo del pedido.

const KEY = 'printAutoSettings';

const DEFAULTS = {
    onCreate: true, // al crear el pedido: etiquetas de ropa + ticket de cliente
    onPay: true,    // al cobrar: ticket de cliente
    onReady: true,  // al marcar listo (pedido completo): etiqueta interna (recogida)
    onGarmentReady: true, // al completar cada prenda: etiqueta "Finalizado" por prenda
};

export function getPrintSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { ...DEFAULTS, ...saved };
    } catch {
        return { ...DEFAULTS };
    }
}

export function setPrintSettings(partial) {
    const next = { ...getPrintSettings(), ...partial };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
}

