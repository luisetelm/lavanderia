// Copia de un producto para darla de alta como uno nuevo (duplicar): sin id, sin
// SKU (se genera al guardar), activa y con el nombre marcado para cambiarlo.
export const copiaDeProducto = (p) => ({...p, id: undefined, sku: '', archivedAt: null, name: `${p.name} (copia)`});
