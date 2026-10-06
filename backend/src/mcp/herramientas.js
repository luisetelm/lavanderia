// Herramientas del conector MCP de la lavandería.
//
// Cada herramienta es {nombre, titulo, descripcion, esquema, soloLectura,
// roles?, ejecutar}. `esquema` es un «shape» de zod (objeto de campos) para
// que sirva igual al servidor MCP (registerTool) y al asistente interno que
// usa la API de Claude (betaZodTool con z.object(esquema)).
//
// `ejecutar(entrada, ctx)` recibe ctx = {api, usuario:{id, role, nombre}} y
// devuelve un objeto serializable; los errores de la API (ApiError) llegan
// al modelo como resultado con isError para que los explique.

import {z} from 'zod';
import {ApiError} from './api.js';

export const ESTADOS = {
    pending: 'pendiente',
    in_progress: 'en proceso',
    ready: 'listo para recoger',
    collected: 'entregado',
    cancelled: 'anulado',
};
const ESTADOS_ACTIVOS = 'pending,in_progress,ready';
const ROLES_EMPLEADO = ['admin', 'cashier', 'worker'];

const num = (v) => (v == null || v === '' ? null : Number(v));
const eur = (v) => Math.round((Number(v) || 0) * 100) / 100;
const fecha = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const fechaHora = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : null);
const nombreDe = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.denominacionsocial || null : null);
const hoy = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const sumarDias = (ymd, n) => {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const error = (mensaje, status = 400) => new ApiError(status, mensaje);

const zFecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
const zEstado = z.enum(['pending', 'in_progress', 'ready', 'collected', 'cancelled']);

// ─── Formato compacto de pedido ──────────────────────────────────────────
function lineaCompacta(l) {
    return {
        id: l.id,
        producto: l.productName || l.product?.name || `producto ${l.productId}`,
        productoId: l.productId,
        varianteId: l.variantId || null,
        cantidad: l.quantity,
        precioUnitario: eur(l.unitPrice),
        descuentoPct: Number(l.discount) || 0,
        total: eur(l.totalPrice),
        color: l.color || undefined,
        anulada: l.voidedAt ? {fecha: fecha(l.voidedAt), motivo: l.voidReason || null} : undefined,
    };
}

function pedidoCompacto(o) {
    return {
        id: o.id,
        numero: o.orderNum,
        estado: o.status,
        estadoTexto: ESTADOS[o.status] || o.status,
        total: eur(o.total),
        pagado: !!o.paid,
        metodoPago: o.paymentMethod || null,
        fechaEntrega: fecha(o.fechaLimite),
        creado: fechaHora(o.createdAt),
        cliente: o.client ? {
            id: o.client.id,
            nombre: nombreDe(o.client),
            telefono: o.client.phone || null,
            facturacionMensual: o.client.autoMonthlyInvoice === true || undefined,
        } : (o.clientId ? {id: o.clientId} : null),
        lineas: Array.isArray(o.lines) ? o.lines.map(lineaCompacta) : undefined,
    };
}

function clienteCompacto(u) {
    return {
        id: u.id,
        nombre: nombreDe(u),
        empresa: u.denominacionsocial || undefined,
        nif: u.nif || undefined,
        telefono: u.phone || null,
        email: u.email || null,
        granCliente: u.isbigclient === true,
        descuentoPct: Number(u.discount) || 0,
        facturacionMensual: u.autoMonthlyInvoice === true,
        canalAvisos: u.notifyChannel || 'whatsapp',
        activo: u.isActive !== false,
        direccion: u.direccion ? [u.direccion, u.codigopostal, u.localidad].filter(Boolean).join(', ') : undefined,
    };
}

/** Acepta un id numérico o un número de pedido tipo TPV/2026/0123 y devuelve el id. */
async function resolverPedidoId(api, pedido) {
    const s = String(pedido).trim();
    if (/^\d+$/.test(s)) return Number(s);
    const r = await api.get('/orders/find', {num: s});
    return r.id;
}

/** Busca la conversación de un cliente o teléfono en la lista de conversaciones. */
async function buscarConversacion(api, {conversacionId, clienteId, telefono}) {
    if (conversacionId) return {id: Number(conversacionId)};
    const lista = await api.get('/messages/conversations');
    const tel = telefono ? String(telefono).replace(/[\s\-().]/g, '').replace(/^(\+34|0034)/, '') : null;
    const c = lista.find(x => (clienteId && x.clientId === Number(clienteId))
        || (tel && String(x.phone || '').replace(/^(\+34|0034)/, '').endsWith(tel)));
    if (!c) throw error('No hay ninguna conversación con ese cliente o teléfono. Sólo se puede escribir a clientes con conversación abierta (que hayan escrito o recibido avisos antes).', 404);
    return c;
}

function exigirRol(ctx, roles, accion) {
    if (!roles.includes(ctx.usuario?.role)) {
        throw error(`Sólo ${roles.join(' o ')} puede ${accion}. El usuario conectado es ${ctx.usuario?.role || 'desconocido'}.`, 403);
    }
}

// ─── Herramientas ────────────────────────────────────────────────────────
export const HERRAMIENTAS = [
    {
        nombre: 'buscar_cliente',
        titulo: 'Buscar cliente',
        descripcion: 'Busca clientes por nombre, apellidos, empresa, teléfono o email. Devuelve id, nombre, teléfono, si es gran cliente (tarifa especial, días fijos de recogida y entrega, sin suplemento de urgencia), descuento y si factura a fin de mes. Usa el id devuelto en el resto de herramientas. Para buscar por teléfono escribe sólo los dígitos, sin espacios ni +34.',
        soloLectura: true,
        esquema: {
            texto: z.string().min(1).describe('Nombre, apellidos, empresa, email o teléfono (sólo dígitos)'),
            limite: z.number().int().min(1).max(50).optional().describe('Máximo de resultados, por defecto 10'),
        },
        async ejecutar({texto, limite = 10}, {api}) {
            const q = /^[\d\s+\-()]+$/.test(texto) ? texto.replace(/[\s\-().]/g, '').replace(/^(\+34|0034)/, '') : texto.trim();
            const r = await api.get('/users', {q, role: 'customer', size: limite, page: 0});
            return {
                total: r.meta?.total ?? r.data?.length ?? 0,
                clientes: (r.data || []).map(clienteCompacto),
            };
        },
    },
    {
        nombre: 'ver_cliente',
        titulo: 'Ver ficha de cliente',
        descripcion: 'Ficha completa de un cliente: datos de contacto y facturación, condiciones (gran cliente, descuento, días fijos), sus últimos pedidos, facturas recientes y los precios pactados vigentes.',
        soloLectura: true,
        esquema: {
            clienteId: z.number().int().describe('Id del cliente (de buscar_cliente)'),
            pedidos: z.number().int().min(0).max(50).optional().describe('Cuántos pedidos recientes incluir, por defecto 10'),
        },
        async ejecutar({clienteId, pedidos = 10}, {api, usuario}) {
            const u = await api.get(`/users/${clienteId}`);
            const ficha = clienteCompacto(u);
            const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
            if (u.isbigclient) {
                ficha.diasRecogida = (u.pickupDays || []).map(d => DIAS[d]);
                ficha.diasEntrega = (u.deliveryDays || []).map(d => DIAS[d]);
                ficha.cargaSemanalPrevista = Number(u.expectedLoad) || 0;
            }
            const ordenes = (u.orders || []).slice(0, pedidos).map(o => ({
                ...pedidoCompacto(o),
                lineas: (o.lines || []).filter(l => !l.voidedAt).map(l => `${l.quantity}x ${l.product?.name || ''}`.trim()),
            }));
            let preciosPactados = [];
            if (ROLES_EMPLEADO.includes(usuario?.role)) {
                try {
                    const p = await api.get(`/users/${clienteId}/prices`);
                    preciosPactados = (p.precios || []).filter(x => x.estado !== 'finalizado').map(x => ({
                        productoId: x.productId, producto: x.productName, precio: x.price,
                        precioNormal: x.basePrice, desde: x.validFrom, hasta: x.validTo, estado: x.estado, nota: x.note || undefined,
                    }));
                } catch { /* sin permiso o tabla ausente: se omite */ }
            }
            return {
                cliente: ficha,
                totalPedidos: (u.orders || []).length,
                pedidosRecientes: ordenes,
                facturasRecientes: (u.invoices || []).slice(0, 10).map(f => ({
                    id: f.id, numero: f.number, fecha: fecha(f.issuedAt), total: eur(f.totalGross), pagada: !!f.paid, estadoPago: f.paymentStatus,
                })),
                preciosPactados,
            };
        },
    },
    {
        nombre: 'catalogo',
        titulo: 'Catálogo de productos y servicios',
        descripcion: 'Lista los productos y servicios (prendas, lavado por kg, tintorería, hostelería...) con su id, precio público (IVA incluido), tarifa de gran cliente y variantes. Filtra por texto si se indica. Los precios que aquí salen son los públicos: para saber lo que paga un cliente concreto usa precio_efectivo o presupuestar_pedido.',
        soloLectura: true,
        esquema: {
            buscar: z.string().optional().describe('Texto a buscar en el nombre o la categoría'),
            incluirArchivados: z.boolean().optional().describe('Incluir productos archivados (por defecto no)'),
        },
        async ejecutar({buscar, incluirArchivados = false}, {api}) {
            const lista = await api.get('/products', incluirArchivados ? {archived: 'all'} : undefined);
            const t = (buscar || '').trim().toLowerCase();
            const filtrados = lista.filter(p => !t || `${p.name} ${p.category?.name || ''} ${p.sku || ''}`.toLowerCase().includes(t));
            filtrados.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
            return {
                total: filtrados.length,
                productos: filtrados.slice(0, 150).map(p => ({
                    id: p.id,
                    nombre: p.name,
                    sku: p.sku || undefined,
                    categoria: p.category?.name || null,
                    precio: eur(p.basePrice),
                    precioGranCliente: Number(p.bigClientPrice) > 0 ? Number(p.bigClientPrice) : null,
                    variantes: (p.variants || []).length ? p.variants.map(v => ({id: v.id, nombre: v.name, suplemento: eur(v.priceModifier)})) : undefined,
                    archivado: p.archivedAt ? true : undefined,
                    seccionWeb: p.webSection || undefined,
                })),
                truncado: filtrados.length > 150 ? 'Se muestran 150; afina la búsqueda.' : undefined,
            };
        },
    },
    {
        nombre: 'precio_efectivo',
        titulo: 'Precio para un cliente',
        descripcion: 'Precio que paga un cliente concreto por un producto, resolviendo la regla real de la lavandería: precio pactado vigente del cliente > tarifa de gran cliente > precio público, más el suplemento de la variante; el descuento del cliente sólo se aplica si no hay precio pactado. Sin clienteId devuelve el precio público.',
        soloLectura: true,
        esquema: {
            productoId: z.number().int().describe('Id del producto (de catalogo)'),
            clienteId: z.number().int().optional().describe('Id del cliente; si se omite, precio público'),
            varianteId: z.number().int().optional().describe('Id de la variante, si el producto las tiene'),
            cantidad: z.number().positive().optional().describe('Cantidad (unidades o kg), por defecto 1'),
        },
        async ejecutar({productoId, clienteId, varianteId, cantidad = 1}, {api}) {
            const q = await api.post('/orders/quote', {
                clientId: clienteId, lines: [{productId: productoId, variantId: varianteId, quantity: cantidad}],
            });
            const l = q.lineas[0];
            return {
                producto: l.productName,
                cliente: q.client?.nombre || 'precio público',
                cantidad: l.quantity,
                precioUnitario: l.unitPrice,
                origenPrecio: l.origenPrecio,
                descuentoPct: l.discount,
                total: l.totalPrice,
                ivaIncluido: true,
            };
        },
    },
    {
        nombre: 'listar_pedidos',
        titulo: 'Listar pedidos',
        descripcion: 'Lista pedidos con filtros: texto (número de pedido o datos del cliente), estado, cliente, fechas de creación o de entrega. Estados: pending (pendiente), in_progress (en proceso), ready (listo para recoger), collected (entregado), cancelled (anulado). Sin filtros devuelve los más recientes. Fechas en formato YYYY-MM-DD.',
        soloLectura: true,
        esquema: {
            texto: z.string().optional().describe('Número de pedido o nombre/teléfono/email del cliente'),
            estado: z.union([zEstado, z.literal('activos'), z.literal('todos')]).optional().describe('Estado; «activos» = pendiente, en proceso o listo; por defecto todos'),
            clienteId: z.number().int().optional().describe('Sólo pedidos de este cliente'),
            creadoDesde: zFecha.optional(),
            creadoHasta: zFecha.optional(),
            entregaDesde: zFecha.optional().describe('Fecha de entrega comprometida desde'),
            entregaHasta: zFecha.optional(),
            ordenarPor: z.enum(['createdAt', 'fechaLimite', 'updatedAt']).optional().describe('Por defecto createdAt'),
            pagina: z.number().int().min(1).optional().describe('Página (empieza en 1)'),
            tamano: z.number().int().min(1).max(50).optional().describe('Pedidos por página, por defecto 20'),
        },
        async ejecutar(e, {api}) {
            const tam = e.tamano || 20;
            const pag = e.pagina || 1;
            const estado = e.estado === 'activos' ? ESTADOS_ACTIVOS : (e.estado === 'todos' ? undefined : e.estado);
            if (e.clienteId) {
                const u = await api.get(`/users/${e.clienteId}`);
                let ordenes = u.orders || [];
                if (estado) {
                    const set = new Set(estado.split(','));
                    ordenes = ordenes.filter(o => set.has(o.status));
                }
                if (e.creadoDesde) ordenes = ordenes.filter(o => fecha(o.createdAt) >= e.creadoDesde);
                if (e.creadoHasta) ordenes = ordenes.filter(o => fecha(o.createdAt) <= e.creadoHasta);
                if (e.entregaDesde) ordenes = ordenes.filter(o => fecha(o.fechaLimite) >= e.entregaDesde);
                if (e.entregaHasta) ordenes = ordenes.filter(o => fecha(o.fechaLimite) <= e.entregaHasta);
                const total = ordenes.length;
                const pagina = ordenes.slice((pag - 1) * tam, pag * tam);
                return {
                    cliente: {id: u.id, nombre: nombreDe(u)},
                    total, pagina: pag, paginas: Math.ceil(total / tam),
                    pedidos: pagina.map(o => ({
                        ...pedidoCompacto(o),
                        lineas: (o.lines || []).filter(l => !l.voidedAt).map(l => `${l.quantity}x ${l.product?.name || ''}`.trim()),
                    })),
                };
            }
            const query = {
                q: e.texto, status: estado, sortBy: e.ordenarPor, sortOrder: 'desc', page: pag - 1, size: tam,
                deliveryFrom: e.entregaDesde, deliveryTo: e.entregaHasta,
            };
            if (e.creadoDesde || e.creadoHasta) {
                query.startDate = e.creadoDesde || '2000-01-01';
                query.endDate = e.creadoHasta || hoy();
            }
            const r = await api.get('/orders', query);
            return {
                total: r.meta?.total ?? 0, pagina: pag, paginas: r.meta?.totalPages ?? 1,
                pedidos: (r.data || []).map(o => ({
                    ...pedidoCompacto(o),
                    lineas: (o.lines || []).filter(l => !l.voidedAt).map(l => `${l.quantity}x ${l.product?.name || ''}`.trim()),
                })),
            };
        },
    },
    {
        nombre: 'ver_pedido',
        titulo: 'Ver pedido',
        descripcion: 'Detalle completo de un pedido por id o por número (TPV/2026/0123): cliente, líneas con precios y notas de recepción, estado de cada paso del taller, pagos, facturas, saldo pendiente y el historial de eventos.',
        soloLectura: true,
        esquema: {
            pedido: z.union([z.number().int(), z.string()]).describe('Id numérico o número de pedido (TPV/AAAA/NNNN)'),
        },
        async ejecutar({pedido}, {api}) {
            const id = await resolverPedidoId(api, pedido);
            const [o, h] = await Promise.all([
                api.get(`/orders/${id}`),
                api.get(`/orders/${id}/history`).catch(() => null),
            ]);
            const base = pedidoCompacto(o);
            base.observaciones = o.observaciones || undefined;
            base.observacionesInternas = o.observacionesInternas || undefined;
            base.lineas = (o.lines || []).map(l => {
                const c = lineaCompacta(l);
                const notas = (Array.isArray(l.annotations) ? l.annotations : []).filter(a => a.type === 'note').map(a => a.text);
                const fotos = (Array.isArray(l.annotations) ? l.annotations : []).filter(a => a.type === 'photo').length;
                const pasos = (l.steps || []);
                const hechos = pasos.filter(s => s.status === 'done').length;
                const actual = pasos.find(s => s.status !== 'done');
                return {
                    ...c,
                    notas: notas.length ? notas : undefined,
                    fotos: fotos || undefined,
                    taller: pasos.length ? {
                        pasosHechos: `${hechos}/${pasos.length}`,
                        pasoActual: actual ? actual.stepLabel : 'terminado',
                        pasos: pasos.map(s => `${s.stepLabel}: ${s.status === 'done' ? 'hecho' : s.status === 'in_progress' ? 'en curso' : 'pendiente'}`),
                    } : undefined,
                };
            });
            base.pagos = (o.payments || []).map(p => ({id: p.id, importe: eur(p.amount), metodo: p.method, estado: p.status, fecha: fechaHora(p.createdAt)}));
            base.facturas = (o.facturas || []).map(f => ({id: f.id, numero: f.number, total: eur(f.totalGross), pagada: !!f.paid, pdf: f.pdfPath}));
            if (h) {
                base.saldo = {pagado: eur(h.pagado), pendiente: eur(h.saldo), accion: h.pendiente || null};
                base.historial = (h.eventos || []).slice(-12).map(ev => ({
                    fecha: fechaHora(ev.fecha), tipo: ev.tipo, importe: ev.importe != null ? eur(ev.importe) : undefined,
                    metodo: ev.metodo || undefined, numero: ev.numero || undefined, concepto: ev.concepto || undefined,
                    nota: ev.nota || undefined, usuario: ev.usuario || undefined,
                }));
            }
            return base;
        },
    },
    {
        nombre: 'entregas_del_dia',
        titulo: 'Entregas de un día',
        descripcion: 'Qué pedidos hay que entregar un día (por fecha de entrega comprometida) y cuáles están atrasados (fecha pasada y aún no entregados). Útil para preparar el día o responder a un cliente si su pedido está listo.',
        soloLectura: true,
        esquema: {
            fecha: zFecha.optional().describe('Día, por defecto hoy'),
        },
        async ejecutar({fecha: f}, {api}) {
            const dia = f || hoy();
            const [entregas, atrasados] = await Promise.all([
                api.get('/orders', {deliveryFrom: dia, deliveryTo: dia, status: ESTADOS_ACTIVOS, sortBy: 'fechaLimite', sortOrder: 'asc', page: 0, size: 100}),
                dia >= hoy() ? api.get('/orders', {deliveryTo: sumarDias(hoy(), -1), status: ESTADOS_ACTIVOS, sortBy: 'fechaLimite', sortOrder: 'asc', page: 0, size: 100}) : Promise.resolve({data: []}),
            ]);
            const resumen = (o) => ({
                ...pedidoCompacto(o),
                lineas: (o.lines || []).filter(l => !l.voidedAt).map(l => `${l.quantity}x ${l.product?.name || ''}`.trim()),
            });
            return {
                fecha: dia,
                entregas: (entregas.data || []).map(resumen),
                listosParaRecoger: (entregas.data || []).filter(o => o.status === 'ready').length,
                atrasados: (atrasados.data || []).map(resumen),
            };
        },
    },
    {
        nombre: 'carga_de_trabajo',
        titulo: 'Carga de trabajo y fechas de entrega',
        descripcion: 'Calendario de carga del taller: para cada día, si está abierto, la carga comprometida (en camisas equivalentes) frente al tope diario, la reserva para grandes clientes y la fecha de entrega sugerida. Sirve para proponer una fecha de entrega y para explicar el suplemento de urgencia (un porcentaje por cada día laborable que se adelante la entrega respecto a la fecha sugerida, con tope).',
        soloLectura: true,
        esquema: {
            semanas: z.number().int().min(1).max(6).optional().describe('Semanas a mostrar, por defecto 2'),
            inicio: zFecha.optional().describe('Primer día (se ajusta al lunes de esa semana), por defecto hoy'),
        },
        async ejecutar({semanas = 2, inicio}, {api}) {
            const r = await api.get('/orders/delivery-dates', {weeks: semanas, start: inicio});
            const pctPorDia = r.urgency?.pctPerDay ?? 0;
            const pctMax = r.urgency?.maxPct ?? 0;
            return {
                hoy: r.today,
                fechaSugerida: r.suggestedDate,
                topeDiario: r.loadMax,
                suplementoUrgencia: {porDiaLaborable: `${pctPorDia}%`, maximo: `${pctMax}%`},
                dias: (r.days || []).filter(d => !d.isPast).map(d => ({
                    fecha: d.date,
                    abierto: d.isWorking,
                    etiqueta: d.label || undefined,
                    pedidos: d.orders,
                    carga: d.load,
                    tope: d.loadMax,
                    reservadaGrandesClientes: d.reserved || undefined,
                    reservadaPara: d.reservedClients?.length ? d.reservedClients : undefined,
                    libre: d.isWorking ? Math.max(0, Math.round((d.loadMax - d.load - (d.reserved || 0)) * 10) / 10) : 0,
                    suplementoSiSeEntregaEseDia: d.isWorking && d.daysAhead > 0 ? `${Math.min(pctMax, d.daysAhead * pctPorDia)}%` : undefined,
                })),
            };
        },
    },
    {
        nombre: 'resumen_ventas',
        titulo: 'Resumen de ventas y caja',
        descripcion: 'Sólo administración. Sin fechas: el día de hoy (pedidos, cobros, pendientes de cobro, caja actual, pedidos por estado). Con desde/hasta: ingresos del periodo por método de pago y los productos más vendidos.',
        soloLectura: true,
        roles: ['admin'],
        esquema: {
            desde: zFecha.optional(),
            hasta: zFecha.optional(),
        },
        async ejecutar({desde, hasta}, ctx) {
            exigirRol(ctx, ['admin'], 'ver las ventas');
            const {api} = ctx;
            if (!desde && !hasta) {
                const d = await api.get('/dashboard');
                return {
                    fecha: hoy(),
                    hoy: {
                        pedidosCreados: d.todayStats?.ordersCount,
                        importePedidos: eur(d.todayStats?.totalRevenue),
                        cobrados: {pedidos: d.todayStats?.paidCount, importe: eur(d.todayStats?.paidRevenue)},
                        pendientesDeCobro: {pedidos: d.todayStats?.unpaidCount, importe: eur(d.todayStats?.unpaidRevenue)},
                        porMetodo: {efectivo: d.todayStats?.cashCount, tarjeta: d.todayStats?.cardCount},
                    },
                    pedidosPorEstado: {pendientes: d.ordersByStatus?.pending, listos: d.ordersByStatus?.ready, entregadosHoy: d.ordersByStatus?.collectedToday},
                    entregas: {hoy: d.deliveries?.today, atrasadas: d.deliveries?.overdue},
                    caja: {
                        saldoActual: eur(d.cashStatus?.currentBalance), apertura: eur(d.cashStatus?.openingAmount),
                        movimientosSinCerrar: d.cashStatus?.movementsCount,
                        ultimoCierre: fechaHora(d.cashStatus?.lastClosureAt), cerradoPor: d.cashStatus?.lastClosureBy || null,
                    },
                };
            }
            const from = desde || hasta;
            const to = hasta || desde;
            const [filas, top] = await Promise.all([
                api.get('/cash/income-report', {from, to}),
                api.get('/dashboard/top-products', {from, to, groupBy: 'range', limit: 10}).catch(() => null),
            ]);
            const porMetodo = {};
            const porDia = {};
            let total = 0;
            let cobros = 0;
            let facturasSinCobro = 0;
            for (const f of filas || []) {
                const imp = Number(f.amount) || 0;
                if (f.orphan) { facturasSinCobro += 1; continue; }
                total += imp;
                cobros += 1;
                const m = f.method || 'otro';
                porMetodo[m] = eur((porMetodo[m] || 0) + imp);
                const d = fecha(f.createdAt);
                porDia[d] = eur((porDia[d] || 0) + imp);
            }
            return {
                periodo: {desde: from, hasta: to},
                ingresosCobrados: eur(total),
                numeroCobros: cobros,
                porMetodo,
                porDia,
                facturasEmitidasSinCobro: facturasSinCobro || undefined,
                productosMasVendidos: top?.months?.[0]?.items?.map(i => ({producto: i.productName, unidades: i.qty, importe: eur(i.revenue)})) || undefined,
            };
        },
    },
    {
        nombre: 'conversaciones',
        titulo: 'Conversaciones con clientes',
        descripcion: 'Lista las conversaciones de WhatsApp y SMS con clientes (las más recientes primero), con el último mensaje, los no leídos y si la ventana de 24 h de WhatsApp está abierta (sólo entonces se puede enviar texto libre por WhatsApp; si está cerrada hace falta una plantilla o SMS).',
        soloLectura: true,
        esquema: {
            soloNoLeidas: z.boolean().optional().describe('Sólo conversaciones con mensajes sin leer'),
            limite: z.number().int().min(1).max(100).optional().describe('Por defecto 20'),
        },
        async ejecutar({soloNoLeidas = false, limite = 20}, {api}) {
            const lista = await api.get('/messages/conversations');
            const filtradas = lista.filter(c => !soloNoLeidas || c.unreadCount > 0);
            return {
                total: filtradas.length,
                conversaciones: filtradas.slice(0, limite).map(c => ({
                    id: c.id,
                    clienteId: c.clientId,
                    nombre: nombreDe(c) || null,
                    telefono: c.phone,
                    ultimoMensaje: c.lastMessage,
                    canal: c.lastChannel,
                    direccion: c.lastDirection === 'inbound' ? 'del cliente' : 'nuestro',
                    fecha: fechaHora(c.lastMessageAt),
                    noLeidos: c.unreadCount,
                    ventanaWhatsappAbierta: !!c.waWindowOpen,
                    ventanaExpira: c.waWindowOpen ? fechaHora(c.waWindowExpiresAt) : undefined,
                })),
            };
        },
    },
    {
        nombre: 'conversacion',
        titulo: 'Leer una conversación',
        descripcion: 'Mensajes de una conversación con un cliente (por id de conversación, id de cliente o teléfono), de más antiguo a más reciente, incluidos los avisos automáticos (pedido listo, recogido...).',
        soloLectura: true,
        esquema: {
            conversacionId: z.number().int().optional(),
            clienteId: z.number().int().optional(),
            telefono: z.string().optional().describe('Teléfono, sólo dígitos'),
            limite: z.number().int().min(1).max(200).optional().describe('Últimos N mensajes, por defecto 30'),
        },
        async ejecutar({conversacionId, clienteId, telefono, limite = 30}, {api}) {
            if (!conversacionId && !clienteId && !telefono) throw error('Indica conversacionId, clienteId o telefono.');
            const c = await buscarConversacion(api, {conversacionId, clienteId, telefono});
            const msgs = await api.get('/messages', {conversationId: c.id, size: limite});
            return {
                conversacionId: c.id,
                cliente: c.clientId ? {id: c.clientId, nombre: nombreDe(c)} : null,
                telefono: c.phone,
                ventanaWhatsappAbierta: c.waWindowOpen,
                mensajes: msgs.map(m => ({
                    fecha: fechaHora(m.createdAt),
                    de: m.direction === 'inbound' ? 'cliente' : 'lavandería',
                    canal: m.channel,
                    texto: m.content,
                    estado: m.status,
                    adjunto: m.mediaType || undefined,
                    automatico: m.source === 'notification' || undefined,
                    pedidoId: m.orderId || undefined,
                })),
            };
        },
    },
    {
        nombre: 'presupuestar_pedido',
        titulo: 'Presupuestar un pedido (sin guardar)',
        descripcion: 'Calcula lo que costaría un pedido sin crearlo: precio de cada línea con la regla real (pactado > gran cliente > público, descuento del cliente), la fecha de entrega (la indicada o la propuesta por el calendario) y el suplemento de urgencia si la fecha adelanta la sugerida. Úsalo siempre antes de crear_pedido para enseñar el total y pedir confirmación.',
        soloLectura: true,
        esquema: {
            clienteId: z.number().int().optional().describe('Cliente; sin él se usan precios públicos'),
            lineas: z.array(z.object({
                productoId: z.number().int(),
                varianteId: z.number().int().optional(),
                cantidad: z.number().positive().describe('Unidades o kg'),
            })).min(1),
            fechaEntrega: zFecha.optional().describe('Fecha de entrega deseada; si se omite se propone una'),
            sinSuplemento: z.boolean().optional().describe('true para eximir del suplemento de urgencia'),
        },
        async ejecutar({clienteId, lineas, fechaEntrega, sinSuplemento}, {api}) {
            const q = await api.post('/orders/quote', {
                clientId: clienteId,
                lines: lineas.map(l => ({productId: l.productoId, variantId: l.varianteId, quantity: l.cantidad})),
                fechaLimite: fechaEntrega,
                sinSuplemento: sinSuplemento === true,
            });
            return {
                cliente: q.client || 'precio público',
                lineas: q.lineas.map(l => ({
                    producto: l.productName, cantidad: l.quantity, precioUnitario: l.unitPrice,
                    origenPrecio: l.origenPrecio, descuentoPct: l.discount, total: l.totalPrice,
                })),
                total: q.total,
                ivaIncluido: true,
                fechaEntrega: q.fechaLimite,
                fechaPropuestaPorCalendario: !q.fechaLimiteElegida,
                suplementoUrgencia: q.suplementoUrgencia ? {
                    fechaSugerida: q.suplementoUrgencia.fechaSugerida, diasAdelantados: q.suplementoUrgencia.dias,
                    porcentaje: `${q.suplementoUrgencia.pct}%`, importe: eur(q.suplementoUrgencia.importe),
                } : null,
            };
        },
    },
    {
        nombre: 'crear_pedido',
        titulo: 'Crear pedido',
        descripcion: 'Crea un pedido real (aparece en el TPV, se imprimen etiquetas y se avisa al cliente cuando esté listo). Antes hay que presupuestar con presupuestar_pedido, enseñar el total y la fecha a la persona y obtener su confirmación explícita: sólo entonces se llama con confirmadoPorUsuario=true. Cliente existente por clienteId, o cliente nuevo con nombre, apellidos y teléfono (si el teléfono ya existe, el pedido se asigna a ese cliente).',
        soloLectura: false,
        esquema: {
            clienteId: z.number().int().optional().describe('Cliente existente'),
            clienteNuevo: z.object({
                nombre: z.string().min(1),
                apellidos: z.string().min(1),
                telefono: z.string().min(9),
                email: z.string().email().optional(),
            }).optional().describe('Alta de cliente nuevo si no hay clienteId'),
            lineas: z.array(z.object({
                productoId: z.number().int(),
                varianteId: z.number().int().optional(),
                cantidad: z.number().positive(),
                color: z.string().optional(),
                notas: z.string().optional().describe('Nota de recepción de la prenda (mancha, rotura...)'),
            })).min(1),
            fechaEntrega: zFecha.optional(),
            observaciones: z.string().optional().describe('Observaciones del pedido (visibles en el ticket)'),
            sinSuplemento: z.boolean().optional(),
            confirmadoPorUsuario: z.boolean().describe('true sólo si la persona ha visto el presupuesto y ha confirmado'),
        },
        async ejecutar(e, {api}) {
            if (e.confirmadoPorUsuario !== true) {
                return {creado: false, motivo: 'Falta la confirmación de la persona. Presupuesta con presupuestar_pedido, enséñale el total y la fecha, y vuelve a llamar con confirmadoPorUsuario=true cuando lo confirme.'};
            }
            if (!e.clienteId && !e.clienteNuevo) throw error('Indica clienteId o los datos de clienteNuevo.');
            const body = {
                clientId: e.clienteId,
                clientFirstName: e.clienteNuevo?.nombre,
                clientLastName: e.clienteNuevo?.apellidos,
                clientPhone: e.clienteNuevo?.telefono,
                clientEmail: e.clienteNuevo?.email,
                lines: e.lineas.map(l => ({productId: l.productoId, variantId: l.varianteId, quantity: l.cantidad, color: l.color, notes: l.notas})),
                fechaLimite: e.fechaEntrega,
                observaciones: e.observaciones,
                sinSuplemento: e.sinSuplemento === true,
            };
            const o = await api.post('/orders', body);
            return {creado: true, pedido: pedidoCompacto(o)};
        },
    },
    {
        nombre: 'cambiar_estado_pedido',
        titulo: 'Cambiar estado de un pedido',
        descripcion: 'Cambia el estado de un pedido: pending (pendiente), in_progress (en proceso), ready (listo para recoger), collected (entregado al cliente) o cancelled (anulado, deja el total a 0). Un pedido no cobrado no puede marcarse como entregado salvo que el cliente facture a fin de mes. Al pasar a listo o entregado se puede avisar al cliente. Confirma con la persona antes de anular o entregar.',
        soloLectura: false,
        esquema: {
            pedido: z.union([z.number().int(), z.string()]).describe('Id o número de pedido'),
            estado: zEstado,
            avisarCliente: z.enum(['no', 'segun_cliente', 'whatsapp', 'sms']).optional().describe('Aviso al cliente al pasar a listo/entregado: «segun_cliente» usa su canal preferido. Por defecto no.'),
        },
        async ejecutar({pedido, estado, avisarCliente = 'no'}, {api}) {
            const id = await resolverPedidoId(api, pedido);
            const sendSMS = avisarCliente === 'no' ? false : avisarCliente === 'sms' ? true : avisarCliente === 'whatsapp' ? 'whatsapp' : 'auto';
            const o = await api.patch(`/orders/${id}`, {status: estado, sendSMS});
            return {pedido: pedidoCompacto(o), avisoEnviado: avisarCliente !== 'no' && ['ready', 'collected'].includes(estado) && !!o.client?.phone};
        },
    },
    {
        nombre: 'registrar_pago',
        titulo: 'Registrar el cobro de un pedido',
        descripcion: 'Cobra un pedido completo en efectivo o con tarjeta (TPV físico). Con tarjeta se emite la factura simplificada; en efectivo se anota el movimiento de caja y se devuelve el cambio. No admite cobros parciales. Confirma siempre con la persona antes de cobrar.',
        soloLectura: false,
        esquema: {
            pedido: z.union([z.number().int(), z.string()]).describe('Id o número de pedido'),
            metodo: z.enum(['efectivo', 'tarjeta']),
            importeRecibido: z.number().positive().optional().describe('Obligatorio en efectivo: lo que entrega el cliente'),
        },
        async ejecutar({pedido, metodo, importeRecibido}, {api}) {
            const id = await resolverPedidoId(api, pedido);
            const r = await api.post(`/orders/${id}/pay`, {method: metodo === 'efectivo' ? 'cash' : 'card', receivedAmount: importeRecibido});
            return {pedido: pedidoCompacto(r.order), cambio: eur(r.change)};
        },
    },
    {
        nombre: 'fijar_precio_pactado',
        titulo: 'Fijar precio pactado a un cliente',
        descripcion: 'Sólo administración. Pacta un precio por unidad (IVA incluido) para un producto y un cliente desde una fecha, opcionalmente hasta otra. Sustituye a la tarifa normal o de gran cliente y no se le aplica el descuento del cliente. Si ya había uno vigente que empieza antes, se cierra el día anterior. Confirma con la persona antes de fijarlo.',
        soloLectura: false,
        roles: ['admin'],
        esquema: {
            clienteId: z.number().int(),
            productoId: z.number().int(),
            precio: z.number().min(0).describe('Precio unitario con IVA, hasta 3 decimales'),
            desde: zFecha.optional().describe('Por defecto hoy'),
            hasta: zFecha.optional().describe('Último día incluido; sin fecha = indefinido'),
            nota: z.string().max(255).optional(),
        },
        async ejecutar({clienteId, productoId, precio, desde, hasta, nota}, ctx) {
            exigirRol(ctx, ['admin'], 'gestionar precios pactados');
            const r = await ctx.api.post(`/users/${clienteId}/prices`, {productId: productoId, price: precio, validFrom: desde, validTo: hasta ?? null, note: nota});
            return {creado: true, precioPactadoId: r.id, anterioresCerrados: r.cerrados || []};
        },
    },
    {
        nombre: 'enviar_mensaje',
        titulo: 'Enviar mensaje a un cliente',
        descripcion: 'Envía un mensaje de texto a un cliente por WhatsApp o SMS dentro de una conversación existente. Por WhatsApp sólo funciona con la ventana de 24 h abierta (el cliente ha escrito en las últimas 24 h); si está cerrada, la API lo rechaza y hay que usar SMS. Enseña el texto a la persona y pide confirmación antes de enviarlo. Escribe como la lavandería: cercano, breve, en castellano.',
        soloLectura: false,
        esquema: {
            conversacionId: z.number().int().optional(),
            clienteId: z.number().int().optional().describe('Alternativa a conversacionId'),
            texto: z.string().min(1).max(1000),
            canal: z.enum(['whatsapp', 'sms']).optional().describe('Por defecto whatsapp'),
            pedidoId: z.number().int().optional().describe('Pedido al que se refiere, si procede'),
        },
        async ejecutar({conversacionId, clienteId, texto, canal = 'whatsapp', pedidoId}, {api}) {
            if (!conversacionId && !clienteId) throw error('Indica conversacionId o clienteId.');
            const c = await buscarConversacion(api, {conversacionId, clienteId});
            const r = await api.post('/messages/send', {conversationId: c.id, channel: canal, content: texto, orderId: pedidoId});
            return {enviado: true, conversacionId: c.id, canal, mensajeId: r.message?.id, estado: r.message?.status};
        },
    },
];

export const herramientaPorNombre = (nombre) => HERRAMIENTAS.find(h => h.nombre === nombre);

/** Herramientas disponibles para un usuario (según su rol). */
export function herramientasPara(usuario) {
    return HERRAMIENTAS.filter(h => !h.roles || h.roles.includes(usuario?.role));
}

/** Ejecuta una herramienta y devuelve {resultado} o {error} sin lanzar. */
export async function ejecutarHerramienta(h, entrada, ctx) {
    try {
        const resultado = await h.ejecutar(entrada, ctx);
        return {ok: true, resultado};
    } catch (e) {
        if (e instanceof ApiError) {
            return {ok: false, error: e.message, status: e.status, detalle: e.cuerpo?.code || undefined};
        }
        return {ok: false, error: e?.message || String(e)};
    }
}
