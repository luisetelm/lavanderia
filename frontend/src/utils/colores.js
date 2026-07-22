// Colores de prenda: clave interna -> hex para el punto de color de las tarjetas.
// Centralizado aquí porque lo usan tanto el tablero de taller como el de supervisión.
export const COLOR_HEX = {
    negro: '#1e1e1e', blanco: '#f5f5f5', gris: '#9ca3af', azul: '#3b82f6',
    marino: '#1e3a5f', rojo: '#ef4444', verde: '#22c55e', marron: '#92400e',
    beige: '#d4b896', rosa: '#f472b6', amarillo: '#facc15', morado: '#a855f7',
    burdeos: '#7f1d1d', naranja: '#f97316',
};

// El blanco necesita borde para distinguirse del fondo de la tarjeta.
export function colorDotBorder(color) {
    return color === 'blanco' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.1)';
}
