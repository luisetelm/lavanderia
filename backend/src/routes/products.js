import { Prisma } from '@prisma/client';
import { generateUniqueSku } from '../utils/generateSku.js';
import { hoy, fechaTexto } from '../utils/precioLinea.js';
import { addDays, mondayOf } from '../utils/workCalendar.js';
import { registrarCambiosPrecio, historialPrecios } from '../utils/historialPrecios.js';

// Consultar el catálogo y las fichas: cualquier empleado (el TPV lo necesita).
// Crear y modificar productos: sólo administración, igual que los precios pactados.

const ROLES_EMPLEADO = ['admin', 'cashier', 'worker'];
const SOLO_ADMIN = 'Sólo administración puede crear o modificar productos.';

// Los días se cuentan en la hora local del servidor, como el calendario laboral.
const ZONA = Intl.DateTimeFormat().resolvedOptions().timeZone;

const esEmpleado = (req) => ROLES_EMPLEADO.includes(req.user?.role);
const esAdmin = (req) => req.user?.role === 'admin';

function errorHttp(statusCode, message) {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
}

const fechaValida = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;

const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1;

// "Order"."createdAt" es timestamp sin zona en UTC (así lo guarda Prisma):
// medianoche local de 'YYYY-MM-DD' pasada a ese formato.
const inicioUtc = (s) => new Date(`${s}T00:00:00`).toISOString().slice(0, 23).replace('T', ' ');

// Líneas que cuentan en las estadísticas: no anuladas, de pedidos no cancelados
// y creados en el rango (ambos días incluidos). Usa los alias l y o.
const lineasQueCuentan = (desde, hasta) => Prisma.sql`
    l."voidedAt" IS NULL
    AND o.status IS DISTINCT FROM 'cancelled'
    AND o."createdAt" >= ${inicioUtc(desde)}::timestamp
    AND o."createdAt" <  ${inicioUtc(addDays(hasta, 1))}::timestamp`;

const fechaLocalSql = Prisma.sql`((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA})`;

const nombreCliente = (u) => (u
    ? `${u.firstName || ''} ${u.lastName || ''}`.replace(/\s+/g, ' ').trim() || u.denominacionsocial || `Cliente ${u.id}`
    : null);

const leerIds = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger))];

// Cambio de precios en bloque. Los precios van con IVA incluido; el redondeo es
// el múltiplo de euros al que se ajusta el resultado (0,001 = sin redondear).
const REDONDEOS = [0.001, 0.01, 0.05, 0.1, 0.5, 1];
const CAMPOS_PRECIO = { basePrice: 'Precio', bigClientPrice: 'Tarifa gran cliente' };

function precioNuevo(actual, modo, valor, redondeo) {
    const bruto = modo === 'pct' ? actual * (1 + valor / 100) : actual + valor;
    return Math.round(Math.round(bruto / redondeo) * redondeo * 1000) / 1000;
}

function nombreCategoria(v) {
    const nombre = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!nombre) throw errorHttp(400, 'Indica el nombre de la categoría.');
    return nombre;
}

// P2002: nombre repetido (índice único de sql/024).
function errorCategoria(e, nombre) {
    if (e?.code === 'P2002') throw errorHttp(409, `Ya existe la categoría ${nombre}.`);
    throw e;
}

// Rango pedido por query, por defecto los últimos 30 días. El final no pasa de
// hoy, para no comparar un periodo a medias con uno completo.
function leerRango(query) {
    const h = hoy();
    const hasta = query.to || h;
    const desde = query.from || addDays(hasta, -29);
    if (!fechaValida(desde) || !fechaValida(hasta)) throw errorHttp(400, 'Rango de fechas inválido.');
    if (desde > hasta) throw errorHttp(400, 'La fecha de inicio no puede ser posterior a la de fin.');
    return {desde, hasta: hasta > h ? h : hasta};
}

// Agrupación de la serie según la longitud del rango.
function unidadPara(dias) {
    if (dias <= 31) return 'day';
    if (dias <= 183) return 'week';
    return 'month';
}

// Todos los periodos del rango, para que la serie tenga ceros donde no hubo pedidos.
function periodos(desde, hasta, unidad) {
    const lista = [];
    if (unidad === 'day') {
        for (let d = desde; d <= hasta; d = addDays(d, 1)) lista.push(d);
    } else if (unidad === 'week') {
        for (let d = mondayOf(desde); d <= hasta; d = addDays(d, 7)) lista.push(d);
    } else {
        let [y, m] = desde.split('-').map(Number);
        for (let d = `${desde.slice(0, 7)}-01`; d <= hasta;) {
            lista.push(d);
            m += 1;
            if (m > 12) { m = 1; y += 1; }
            d = `${y}-${String(m).padStart(2, '0')}-01`;
        }
    }
    return lista;
}

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // Responde los errores con statusCode con su mensaje; el resto, 500.
    const conErrores = (handler) => async (req, reply) => {
        try {
            return await handler(req, reply);
        } catch (e) {
            if (e.statusCode) return reply.status(e.statusCode).send({ error: e.message });
            req.log.error(e);
            return reply.status(500).send({ error: 'Error consultando el producto' });
        }
    };

    const productoDe = async (req) => {
        if (!esEmpleado(req)) throw errorHttp(403, 'No autorizado.');
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) throw errorHttp(400, 'Producto inválido.');
        const producto = await prisma.product.findUnique({
            where: { id },
            select: { id: true, basePrice: true, bigClientPrice: true },
        });
        if (!producto) throw errorHttp(404, 'Producto no encontrado');
        return producto;
    };

    // Unidades, importe (con IVA), pedidos y clientes del producto en el rango,
    // más el importe de todos los productos para calcular su peso.
    const resumen = async (productId, desde, hasta) => {
        const [r] = await prisma.$queryRaw`
            SELECT coalesce(sum(l.quantity) FILTER (WHERE l."productId" = ${productId}), 0)::int     AS unidades,
                   coalesce(sum(l."totalPrice") FILTER (WHERE l."productId" = ${productId}), 0)::float AS importe,
                   count(DISTINCT l."orderId") FILTER (WHERE l."productId" = ${productId})::int         AS pedidos,
                   count(DISTINCT o."clientId") FILTER (WHERE l."productId" = ${productId})::int        AS clientes,
                   coalesce(sum(l."totalPrice"), 0)::float                                              AS "importeTodos"
            FROM "OrderLine" l
            JOIN "Order" o ON o.id = l."orderId"
            WHERE ${lineasQueCuentan(desde, hasta)}`;
        return r;
    };

    // Por defecto sólo los activos, que es lo que necesitan el TPV, los ajustes de
    // pedidos y los precios pactados. ?archived=all incluye los archivados y
    // ?archived=only devuelve sólo ellos.
    fastify.get('/', async (req, reply) => {
        const archived = req.query?.archived;
        const where = archived === 'all' ? {} : archived === 'only' ? { archivedAt: { not: null } } : { archivedAt: null };
        const products = await prisma.product.findMany({
            where,
            include: { variants: true, category: true, itinerary: { select: { id: true, name: true, steps: { where: { isOptional: true }, select: { id: true, stepKey: true, stepLabel: true, position: true }, orderBy: { position: 'asc' } } } } },
        });
        return products;
    });

    // Actividad reciente de cada producto para el catálogo: unidades de los
    // últimos 30 días, unidades de las últimas 12 semanas (de lunes a domingo,
    // la actual incluida) y fecha del último pedido. Mismo criterio que la
    // ficha: sin pedidos cancelados ni líneas anuladas.
    fastify.get('/summary', conErrores(async (req) => {
        if (!esEmpleado(req)) throw errorHttp(403, 'No autorizado.');
        const h = hoy();
        const desde30 = addDays(h, -29);
        const semanas = Array.from({ length: 12 }, (_, i) => addDays(mondayOf(h), (i - 11) * 7));

        const [porSemana, ultimos] = await Promise.all([
            prisma.$queryRaw`
                SELECT l."productId" AS "productId",
                       to_char(date_trunc('week', ${fechaLocalSql}), 'YYYY-MM-DD') AS semana,
                       sum(l.quantity)::int AS unidades,
                       coalesce(sum(l.quantity) FILTER (WHERE o."createdAt" >= ${inicioUtc(desde30)}::timestamp), 0)::int AS "unidades30"
                FROM "OrderLine" l
                JOIN "Order" o ON o.id = l."orderId"
                WHERE ${lineasQueCuentan(semanas[0], h)}
                GROUP BY 1, 2`,
            prisma.$queryRaw`
                SELECT l."productId" AS "productId", to_char(max(${fechaLocalSql}), 'YYYY-MM-DD') AS "ultimoPedido"
                FROM "OrderLine" l
                JOIN "Order" o ON o.id = l."orderId"
                WHERE l."voidedAt" IS NULL AND o.status IS DISTINCT FROM 'cancelled'
                GROUP BY 1`,
        ]);

        const productos = {};
        const de = (id) => (productos[id] ??= { unidades30: 0, semanas: semanas.map(() => 0), ultimoPedido: null });
        for (const f of porSemana) {
            const p = de(f.productId);
            p.unidades30 += f.unidades30;
            const i = semanas.indexOf(f.semana);
            if (i >= 0) p.semanas[i] += f.unidades;
        }
        for (const u of ultimos) de(u.productId).ultimoPedido = u.ultimoPedido;
        return { hoy: h, semanas, productos };
    }));

    fastify.get('/categories', conErrores(async (req) => {
        if (!esEmpleado(req)) throw errorHttp(403, 'No autorizado.');
        const categorias = await prisma.productCategory.findMany({
            orderBy: { name: 'asc' },
            include: { _count: { select: { products: true } } },
        });
        return categorias.map((c) => ({ id: c.id, name: c.name, productos: c._count.products }));
    }));

    const categoriaDe = async (req) => {
        const id = Number(req.params.catId) || 0;
        const categoria = await prisma.productCategory.findUnique({ where: { id } });
        if (!categoria) throw errorHttp(404, 'Categoría no encontrada.');
        return categoria;
    };

    fastify.post('/categories', conErrores(async (req, reply) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const name = nombreCategoria(req.body?.name);
        const categoria = await prisma.productCategory.create({ data: { name } }).catch((e) => errorCategoria(e, name));
        return reply.status(201).send({ id: categoria.id, name: categoria.name, productos: 0 });
    }));

    fastify.put('/categories/:catId', conErrores(async (req) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const { id } = await categoriaDe(req);
        const name = nombreCategoria(req.body?.name);
        await prisma.productCategory.update({ where: { id }, data: { name } }).catch((e) => errorCategoria(e, name));
        return { id, name };
    }));

    // Borrar una categoría deja sus productos sin categoría; nada más cambia en ellos.
    fastify.delete('/categories/:catId', conErrores(async (req) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const { id } = await categoriaDe(req);
        const [liberados] = await prisma.$transaction([
            prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
            prisma.productCategory.updateMany({ where: { parentId: id }, data: { parentId: null } }),
            prisma.productCategory.delete({ where: { id } }),
        ]);
        return { eliminada: true, productos: liberados.count };
    }));

    // Cambio de precios en bloque (?aplicar=false sólo calcula la vista previa).
    // La fórmula está únicamente aquí, para que lo que se ve sea lo que se guarda.
    // Un precio a 0 significa que el producto no lo usa (p. ej. sin tarifa de gran
    // cliente) y se deja igual. Los precios pactados con clientes no se tocan.
    fastify.post('/bulk-prices', conErrores(async (req) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const body = req.body || {};
        const ids = leerIds(body.ids);
        const campos = body.campo === 'ambos' ? Object.keys(CAMPOS_PRECIO) : [body.campo];
        const valor = Number(String(body.valor ?? '').replace(',', '.'));
        const redondeo = Number(body.redondeo);
        if (!ids.length) throw errorHttp(400, 'Elige al menos un producto.');
        if (!campos.every((c) => CAMPOS_PRECIO[c])) throw errorHttp(400, 'Precio a cambiar no válido.');
        if (!['pct', 'importe'].includes(body.modo)) throw errorHttp(400, 'Tipo de cambio no válido.');
        if (!Number.isFinite(valor) || valor === 0) throw errorHttp(400, 'Indica cuánto cambia el precio.');
        if (!REDONDEOS.includes(redondeo)) throw errorHttp(400, 'Redondeo no válido.');

        const productos = await prisma.product.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, basePrice: true, bigClientPrice: true },
            orderBy: { name: 'asc' },
        });
        const cambios = [];
        const actualizaciones = [];
        for (const p of productos) {
            const data = {};
            for (const campo of campos) {
                const antes = Number(p[campo] || 0);
                if (antes <= 0) continue;
                const despues = precioNuevo(antes, body.modo, valor, redondeo);
                if (despues < 0) throw errorHttp(400, `${p.name} quedaría con ${CAMPOS_PRECIO[campo].toLowerCase()} negativo.`);
                if (despues === antes) continue;
                data[campo] = despues;
                cambios.push({ id: p.id, name: p.name, campo, antes, despues });
            }
            if (Object.keys(data).length) actualizaciones.push(prisma.product.update({ where: { id: p.id }, data }));
        }

        const aplicar = body.aplicar === true && actualizaciones.length > 0;
        if (aplicar) {
            await prisma.$transaction(actualizaciones);
            const signo = valor > 0 ? '+' : '';
            const cifra = valor.toLocaleString('es-ES', { maximumFractionDigits: 3 });
            await registrarCambiosPrecio(
                prisma,
                cambios.map((c) => ({ productId: c.id, campo: c.campo, antes: c.antes, despues: c.despues })),
                {
                    origen: 'bloque',
                    nota: `${signo}${cifra} ${body.modo === 'pct' ? '%' : '€'}, redondeo ${redondeo.toLocaleString('es-ES')} €`,
                    userId: req.user?.userId,
                    log: req.log,
                },
            );
        }
        return { aplicado: aplicar, productos: productos.length, cambios };
    }));

    // Archivar (archived=true, por defecto) o restaurar productos. Archivar no
    // borra nada: el producto sale del TPV y conserva su ficha y sus pedidos.
    fastify.post('/bulk-archive', conErrores(async (req) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const ids = leerIds(req.body?.ids);
        if (!ids.length) throw errorHttp(400, 'Elige al menos un producto.');
        const archivar = req.body?.archived !== false;
        const r = await prisma.product.updateMany({
            where: { id: { in: ids }, archivedAt: archivar ? null : { not: null } },
            data: { archivedAt: archivar ? new Date() : null },
        });
        return { actualizados: r.count };
    }));

    fastify.get('/:id', async (req, reply) => {
        const { id } = req.params;
        const product = await prisma.product.findUnique({
            where: { id: Number(id) },
            include: { variants: true, category: true, itinerary: { include: { steps: { orderBy: { position: 'asc' } } } } },
        });
        if (!product) return reply.status(404).send({ error: 'Producto no encontrado' });
        return product;
    });

    // Estadísticas de pedidos del producto en un rango (?from&to, YYYY-MM-DD).
    // Sin pedidos cancelados ni líneas anuladas. Importes con IVA, como el catálogo.
    fastify.get('/:id/stats', conErrores(async (req) => {
        const { id: productId } = await productoDe(req);
        const { desde, hasta } = leerRango(req.query || {});
        const dias = diasEntre(desde, hasta);
        const unidad = unidadPara(dias);
        const anteriorHasta = addDays(desde, -1);
        const anteriorDesde = addDays(desde, -dias);
        const filtro = lineasQueCuentan(desde, hasta);

        const [actual, anterior, serie, semana, juntos, clientes] = await Promise.all([
            resumen(productId, desde, hasta),
            resumen(productId, anteriorDesde, anteriorHasta),
            prisma.$queryRaw`
                SELECT to_char(date_trunc(${unidad}, ${fechaLocalSql}), 'YYYY-MM-DD') AS periodo,
                       sum(l.quantity)::int AS unidades,
                       sum(l."totalPrice")::float AS importe
                FROM "OrderLine" l
                JOIN "Order" o ON o.id = l."orderId"
                WHERE l."productId" = ${productId} AND ${filtro}
                GROUP BY 1`,
            prisma.$queryRaw`
                SELECT extract(isodow FROM ${fechaLocalSql})::int AS dia,
                       sum(l.quantity)::int AS unidades,
                       count(DISTINCT l."orderId")::int AS pedidos
                FROM "OrderLine" l
                JOIN "Order" o ON o.id = l."orderId"
                WHERE l."productId" = ${productId} AND ${filtro}
                GROUP BY 1`,
            prisma.$queryRaw`
                WITH pedidos AS (
                    SELECT DISTINCT l."orderId"
                    FROM "OrderLine" l
                    JOIN "Order" o ON o.id = l."orderId"
                    WHERE l."productId" = ${productId} AND ${filtro}
                )
                SELECT p.id AS "productId", p.name, count(DISTINCT x."orderId")::int AS pedidos
                FROM pedidos pe
                JOIN "OrderLine" x ON x."orderId" = pe."orderId" AND x."productId" <> ${productId} AND x."voidedAt" IS NULL
                JOIN "Product" p ON p.id = x."productId"
                GROUP BY p.id, p.name
                ORDER BY pedidos DESC, p.name
                LIMIT 5`,
            prisma.$queryRaw`
                SELECT o."clientId" AS "clientId",
                       sum(l.quantity)::int AS unidades,
                       sum(l."totalPrice")::float AS importe,
                       count(DISTINCT l."orderId")::int AS pedidos,
                       to_char(max(${fechaLocalSql}), 'YYYY-MM-DD') AS "ultimoPedido"
                FROM "OrderLine" l
                JOIN "Order" o ON o.id = l."orderId"
                WHERE l."productId" = ${productId} AND ${filtro}
                GROUP BY o."clientId"
                ORDER BY unidades DESC, importe DESC
                LIMIT 10`,
        ]);

        const usuarios = await prisma.user.findMany({
            where: { id: { in: clientes.map((c) => c.clientId).filter(Boolean) } },
            select: { id: true, firstName: true, lastName: true, denominacionsocial: true },
        });
        const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));
        const porPeriodo = new Map(serie.map((p) => [p.periodo, p]));
        const porDia = new Map(semana.map((d) => [d.dia, d]));

        // Cambios de precio del periodo, para marcarlos en la gráfica (el alta no es un cambio).
        const historial = await historialPrecios(prisma, productId, {
            desde: new Date(`${desde}T00:00:00`),
            hasta: new Date(`${addDays(hasta, 1)}T00:00:00`),
        });
        const cambiosPrecio = (historial || [])
            .filter((c) => c.antes !== null)
            .reverse()
            .map((c) => ({ dia: c.dia, campo: c.campo, antes: c.antes, despues: c.despues }));

        const kpis = (r) => ({ unidades: r.unidades, importe: r.importe, pedidos: r.pedidos, clientes: r.clientes });

        return {
            range: { from: desde, to: hasta, dias, previous: { from: anteriorDesde, to: anteriorHasta } },
            unidad,
            actual: kpis(actual),
            anterior: kpis(anterior),
            importeTodos: actual.importeTodos,
            serie: periodos(desde, hasta, unidad).map((periodo) => ({
                periodo,
                unidades: porPeriodo.get(periodo)?.unidades || 0,
                importe: porPeriodo.get(periodo)?.importe || 0,
            })),
            diasSemana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({
                dia,
                unidades: porDia.get(dia)?.unidades || 0,
                pedidos: porDia.get(dia)?.pedidos || 0,
            })),
            cambiosPrecio,
            juntos: juntos.map((j) => ({ ...j, pct: actual.pedidos ? (j.pedidos / actual.pedidos) * 100 : 0 })),
            clientes: clientes.map((c) => ({
                ...c,
                nombre: c.clientId ? nombreCliente(usuarioPorId.get(c.clientId)) || `Cliente ${c.clientId}` : null,
            })),
        };
    }));

    // Líneas de pedido del producto, las más recientes primero (?from&to&page&size).
    // A diferencia de las estadísticas, incluye las anuladas y los pedidos
    // cancelados: es el registro de todo lo que se ha pedido.
    fastify.get('/:id/lines', conErrores(async (req) => {
        const { id: productId } = await productoDe(req);
        const { desde, hasta } = leerRango(req.query || {});
        const size = Math.min(Math.max(parseInt(req.query.size, 10) || 20, 1), 100);
        const page = Math.max(parseInt(req.query.page, 10) || 0, 0);

        const where = {
            productId,
            order: { createdAt: { gte: new Date(`${desde}T00:00:00`), lt: new Date(`${addDays(hasta, 1)}T00:00:00`) } },
        };
        const [total, lineas] = await Promise.all([
            prisma.orderLine.count({ where }),
            prisma.orderLine.findMany({
                where,
                orderBy: [{ order: { createdAt: 'desc' } }, { id: 'desc' }],
                skip: page * size,
                take: size,
                select: {
                    id: true, quantity: true, unitPrice: true, discount: true, totalPrice: true, voidedAt: true, voidReason: true,
                    order: {
                        select: {
                            id: true, orderNum: true, createdAt: true, status: true, paid: true,
                            client: { select: { id: true, firstName: true, lastName: true, denominacionsocial: true } },
                        },
                    },
                },
            }),
        ]);

        return {
            data: lineas.map((l) => ({
                id: l.id,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discount: l.discount || 0,
                totalPrice: l.totalPrice,
                voidedAt: l.voidedAt,
                voidReason: l.voidReason,
                orderId: l.order.id,
                orderNum: l.order.orderNum,
                createdAt: l.order.createdAt,
                status: l.order.status,
                paid: l.order.paid,
                clientId: l.order.client?.id || null,
                cliente: nombreCliente(l.order.client),
            })),
            meta: { page, size, total, pages: Math.ceil(total / size) },
        };
    }));

    // Precios pactados de este producto con cualquier cliente (se gestionan
    // desde la ficha del cliente, routes/clientPrices.js).
    fastify.get('/:id/agreed-prices', conErrores(async (req) => {
        const producto = await productoDe(req);
        const h = hoy();
        const filas = await prisma.clientProductPrice.findMany({
            where: { productId: producto.id },
            include: { client: { select: { id: true, firstName: true, lastName: true, denominacionsocial: true } } },
        });
        const ORDEN = { vigente: 0, futuro: 1, finalizado: 2 };
        const precios = filas.map((f) => {
            const validFrom = fechaTexto(f.validFrom);
            const validTo = fechaTexto(f.validTo);
            const estado = validFrom > h ? 'futuro' : validTo && validTo < h ? 'finalizado' : 'vigente';
            return {
                id: f.id,
                clientId: f.clientId,
                cliente: nombreCliente(f.client),
                price: Number(f.price),
                validFrom,
                validTo,
                note: f.note,
                estado,
            };
        }).sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.cliente.localeCompare(b.cliente, 'es') || b.validFrom.localeCompare(a.validFrom));

        return {
            hoy: h,
            basePrice: Number(producto.basePrice),
            bigClientPrice: Number(producto.bigClientPrice || 0),
            precios,
        };
    }));

    // Historial de cambios de precio (sql/025). disponible=false si falta la tabla.
    fastify.get('/:id/price-history', conErrores(async (req) => {
        const producto = await productoDe(req);
        const cambios = await historialPrecios(prisma, producto.id);
        return { disponible: cambios !== null, cambios: cambios || [] };
    }));

    // Tiempos de las prendas de este producto en pedidos del rango. Sólo
    // administración: las métricas de tiempo son de gestión, no del taller.
    //
    // Se mide desde el alta del pedido hasta que se completa cada paso del
    // itinerario. No se mide cuánto dura cada paso (completedAt - startedAt)
    // porque en el taller casi siempre se marca «Completar» sin «Iniciar» y
    // saldría a cero. «A tiempo» = terminada el día de entrega o antes.
    fastify.get('/:id/times', conErrores(async (req) => {
        if (!esAdmin(req)) throw errorHttp(403, 'Sólo administración puede ver los tiempos.');
        const { id: productId } = await productoDe(req);
        const { desde, hasta } = leerRango(req.query || {});
        const filtro = lineasQueCuentan(desde, hasta);

        const [[resumen], pasos] = await Promise.all([
            prisma.$queryRaw`
                WITH lineas AS (
                    SELECT l.id,
                           (o."createdAt" AT TIME ZONE 'UTC') AS alta,
                           (o."fechaLimite" AT TIME ZONE 'UTC') AS limite,
                           o.status AS estado,
                           count(ls.id) AS pasos,
                           count(ls.id) FILTER (WHERE ls.status = 'done') AS hechos,
                           max(ls.completed_at) AS fin
                    FROM "OrderLine" l
                    JOIN "Order" o ON o.id = l."orderId"
                    JOIN order_line_steps ls ON ls.order_line_id = l.id
                    WHERE l."productId" = ${productId} AND ${filtro}
                    GROUP BY l.id, o."createdAt", o."fechaLimite", o.status
                ), t AS (
                    SELECT *, hechos = pasos AS terminada, extract(epoch FROM fin - alta) / 3600 AS horas FROM lineas
                )
                SELECT count(*)::int AS "conSeguimiento",
                       count(*) FILTER (WHERE terminada)::int AS terminadas,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY horas) FILTER (WHERE terminada AND horas >= 0) AS "medianaHoras",
                       percentile_cont(0.9) WITHIN GROUP (ORDER BY horas) FILTER (WHERE terminada AND horas >= 0) AS "p90Horas",
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM limite - alta) / 3600) FILTER (WHERE limite IS NOT NULL) AS "plazoHoras",
                       count(*) FILTER (WHERE terminada AND limite IS NOT NULL)::int AS "conFecha",
                       count(*) FILTER (WHERE terminada AND limite IS NOT NULL
                           AND (fin AT TIME ZONE ${ZONA})::date <= (limite AT TIME ZONE ${ZONA})::date)::int AS "aTiempo",
                       count(*) FILTER (WHERE NOT terminada AND estado NOT IN ('collected', 'cancelled'))::int AS "enCurso",
                       count(*) FILTER (WHERE NOT terminada AND estado NOT IN ('collected', 'cancelled') AND limite IS NOT NULL
                           AND (limite AT TIME ZONE ${ZONA})::date < (now() AT TIME ZONE ${ZONA})::date)::int AS "enCursoFueraDePlazo"
                FROM t`,
            prisma.$queryRaw`
                SELECT coalesce(s.step_label, sc.step_label, 'Otro') AS paso,
                       min(coalesce(s.position, sc.position, 0)) AS orden,
                       count(*)::int AS prendas,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ls.completed_at - (o."createdAt" AT TIME ZONE 'UTC')) / 3600) AS "medianaHoras"
                FROM order_line_steps ls
                JOIN "OrderLine" l ON l.id = ls.order_line_id
                JOIN "Order" o ON o.id = l."orderId"
                LEFT JOIN itinerary_step s ON s.id = ls.itinerary_step_id
                LEFT JOIN service_step_config sc ON sc.id = ls.step_config_id
                WHERE l."productId" = ${productId} AND ls.status = 'done'
                  AND ls.completed_at >= (o."createdAt" AT TIME ZONE 'UTC') AND ${filtro}
                GROUP BY 1
                ORDER BY 2, 1`,
        ]);

        const horas = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
        return {
            range: { from: desde, to: hasta },
            resumen: {
                ...resumen,
                medianaHoras: horas(resumen.medianaHoras),
                p90Horas: horas(resumen.p90Horas),
                plazoHoras: horas(resumen.plazoHoras),
            },
            pasos: pasos.map((p) => ({ paso: p.paso, prendas: p.prendas, medianaHoras: horas(p.medianaHoras) })),
        };
    }));

    fastify.post('/', async (req, reply) => {
        if (!esAdmin(req)) return reply.status(403).send({ error: SOLO_ADMIN });
        let { name, sku, basePrice, categoryId, description, type, weight, bigClientPrice, serviceOptions, itineraryId, labelCount, countsForLoad, workloadWeight, printWashLabel } = req.body;
        if (!name || basePrice == null) return reply.status(400).send({ error: 'Name and basePrice required' });

        if (!sku || sku.trim() === '') {
            sku = await generateUniqueSku(prisma);
        } else {
            // opcional: validar que no exista ya
            const exists = await prisma.product.findUnique({ where: { sku } });
            if (exists) return reply.status(400).send({ error: 'SKU ya existe' });
        }

        const product = await prisma.product.create({
            data: {
                name,
                sku,
                basePrice: parseFloat(basePrice),
                categoryId: categoryId ? Number(categoryId) : null,
                description,
                type: type || 'service',
                weight: weight != null ? parseFloat(weight) : 0,
                bigClientPrice: bigClientPrice != null ? parseFloat(bigClientPrice) : 0,
                itineraryId: itineraryId ? Number(itineraryId) : null,
                labelCount: labelCount != null ? Math.max(1, parseInt(labelCount, 10) || 1) : 1,
                printWashLabel: printWashLabel != null ? !!printWashLabel : true,
                countsForLoad: countsForLoad != null ? !!countsForLoad : true,
                workloadWeight: workloadWeight != null ? Math.max(0, parseFloat(workloadWeight) || 0) : 1,
                serviceOptions: serviceOptions || {
                    dryWash: false,
                    wetWash: false,
                    ironing: false,
                    externalService: false
                }
            },
        });
        await registrarCambiosPrecio(
            prisma,
            [
                { productId: product.id, campo: 'basePrice', antes: null, despues: product.basePrice },
                ...(Number(product.bigClientPrice) > 0 ? [{ productId: product.id, campo: 'bigClientPrice', antes: null, despues: product.bigClientPrice }] : []),
            ],
            { origen: 'alta', userId: req.user?.userId, log: req.log },
        );
        return reply.status(201).send(product);
    });

    fastify.put('/:id', async (req, reply) => {
        if (!esAdmin(req)) return reply.status(403).send({ error: SOLO_ADMIN });
        const { id } = req.params;
        const { name, sku, basePrice, categoryId, description, type, weight, bigClientPrice, serviceOptions, itineraryId, labelCount, countsForLoad, workloadWeight, printWashLabel } = req.body;
        try {
            const data = {};
            if (name !== undefined) data.name = name;
            if (sku !== undefined) data.sku = sku;
            if (basePrice !== undefined) data.basePrice = parseFloat(basePrice);
            if (categoryId !== undefined) data.categoryId = categoryId ? Number(categoryId) : null;
            if (description !== undefined) data.description = description;
            if (type !== undefined) data.type = type;
            if (weight !== undefined) data.weight = parseFloat(weight);
            if (bigClientPrice !== undefined) data.bigClientPrice = parseFloat(bigClientPrice);
            if (serviceOptions !== undefined) data.serviceOptions = serviceOptions;
            if (itineraryId !== undefined) data.itineraryId = itineraryId ? Number(itineraryId) : null;
            if (labelCount !== undefined) data.labelCount = Math.max(1, parseInt(labelCount, 10) || 1);
            if (printWashLabel !== undefined) data.printWashLabel = !!printWashLabel;
            if (countsForLoad !== undefined) data.countsForLoad = !!countsForLoad;
            if (workloadWeight !== undefined) data.workloadWeight = Math.max(0, parseFloat(workloadWeight) || 0);

            const previo = await prisma.product.findUnique({
                where: { id: Number(id) },
                select: { basePrice: true, bigClientPrice: true },
            });
            const product = await prisma.product.update({
                where: { id: Number(id) },
                data,
            });
            await registrarCambiosPrecio(
                prisma,
                Object.keys(CAMPOS_PRECIO)
                    .filter((campo) => data[campo] !== undefined)
                    .map((campo) => ({ productId: product.id, campo, antes: previo?.[campo], despues: product[campo] })),
                { origen: 'edicion', userId: req.user?.userId, log: req.log },
            );
            return product;
        } catch (e) {
            return reply.status(404).send({ error: 'Producto no encontrado' });
        }
    });
}
