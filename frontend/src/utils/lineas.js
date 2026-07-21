// Las líneas de un pedido no se borran nunca: al ajustar un pedido ya cobrado
// se marcan como anuladas (voidedAt), para no hacer irreconstruible el ticket
// que documenta la factura. Ver docs/ajustes-pedidos-facturados.md.
//
// Eso obliga a distinguir en toda la interfaz:
//   - los cálculos (totales, nº de prendas, pasos de tracking) usan sólo las activas
//   - los tickets impresos y el portal del cliente muestran sólo las activas
//   - la ficha del pedido en el TPV sí muestra las anuladas, tachadas y con su
//     motivo, porque es lo que explica el cambio de importe

export const esAnulada = (linea) => Boolean(linea?.voidedAt);

export const lineasActivas = (lines) => (lines || []).filter((l) => !l?.voidedAt);
