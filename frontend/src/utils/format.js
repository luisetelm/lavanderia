const eur = new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR'});

export function formatEUR(num) {
    return eur.format(typeof num === 'number' ? num : Number(num || 0));
}
