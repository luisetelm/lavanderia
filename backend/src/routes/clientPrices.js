// backend/src/routes/clientPrices.js
//
// Precios pactados por cliente (sql/022_precios_pactados.sql).
//
// Un precio pactado sustituye, para un cliente y un producto, a la tarifa
// normal y a la de gran cliente mientras está vigente. La regla de cálculo vive
// en utils/precioLinea.js; aquí sólo se gestionan los acuerdos.
//
// Consultar: cualquier empleado, porque el TPV necesita los precios del cliente.
// Crear, modificar y finalizar: sólo administración.
//
// Vigencia por fechas, ambos días incluidos; sin fecha de fin = indefinido. Dos
// acuerdos del mismo cliente y producto no pueden solaparse, salvo el caso
// habitual de cambiar el precio a partir de una fecha: al crear el nuevo, el
// anterior se cierra solo el día antes.

import {hoy, fechaDb, fechaTexto, preciosPactadosVigentes} from '../utils/precioLinea.js';
import {addDays} from '../utils/workCalendar.js';

const ROLES_EMPLEADO = ['admin', 'cashier', 'worker'];
const SOLO_ADMIN = 'Sólo administración puede gestionar precios pactados.';
const SIN_FIN = '9999-12-31';

const esEmpleado = (req) => ROLES_EMPLEADO.includes(req.user?.role);
const esAdmin = (req) => req.user?.role === 'admin';

function errorHttp(statusCode, message) {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
}

function fechaValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = fechaDb(s);
    return !isNaN(d.getTime()) && fechaTexto(d) === s;
}

function leerPrecio(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
}

const aNumero = (v) => (v == null ? 0 : Number(String(v)));
const fechaEs = (s) => s.split('-').reverse().join('/');
const tramo = (fila) => ({from: fechaTexto(fila.validFrom), to: fechaTexto(fila.validTo)});
const solapan = (a, b) => a.from <= (b.to ?? SIN_FIN) && b.from <= (a.to ?? SIN_FIN);

function conflicto(nombreProducto, t) {
    const periodo = t.to
        ? `del ${fechaEs(t.from)} al ${fechaEs(t.to)}`
        : `desde el ${fechaEs(t.from)} sin fecha de fin`;
    return errorHttp(409, `Ya hay un precio pactado para ${nombreProducto} ${periodo}. Ajusta las fechas para que no se solapen.`);
}

function estado(fila, h) {
    const t = tramo(fila);
    if (t.from > h) return 'futuro';
    if (t.to && t.to < h) return 'finalizado';
    return 'vigente';
}

function serializar(fila, h) {
    const t = tramo(fila);
    return {
        id: fila.id,
        productId: fila.productId,
        productName: fila.product?.name || `Producto ${fila.productId}`,
        basePrice: aNumero(fila.product?.basePrice),
        bigClientPrice: aNumero(fila.product?.bigClientPrice),
        price: aNumero(fila.price),
        validFrom: t.from,
        validTo: t.to,
        note: fila.note,
        createdAt: fila.createdAt,
        createdBy: fila.creator ? `${fila.creator.firstName || ''} ${fila.creator.lastName || ''}`.trim() : null,
        estado: estado(fila, h),
    };
}

// Valida precio, fechas y nota. Lanza 400 con un mensaje que se puede enseñar tal cual.
function validarDatos({price, validFrom, validTo, note}) {
    const precio = leerPrecio(price);
    if (precio === null) throw errorHttp(400, 'El precio pactado debe ser un número mayor o igual que cero.');
    if (!fechaValida(validFrom)) throw errorHttp(400, 'La fecha de inicio no es válida.');
    if (validTo !== null && !fechaValida(validTo)) throw errorHttp(400, 'La fecha de fin no es válida.');
    if (validTo !== null && validTo < validFrom) throw errorHttp(400, 'La fecha de fin no puede ser anterior a la de inicio.');
    const nota = note == null ? null : (String(note).trim().slice(0, 255) || null);
    return {precio, desde: validFrom, hasta: validTo, nota};
}

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // Responde los errores con statusCode con su mensaje; el resto, 500.
    const conErrores = (handler) => async (req, reply) => {
        try {
            return await handler(req, reply);
        } catch (e) {
            if (e.statusCode) return reply.status(e.statusCode).send({error: e.message});
            req.log.error(e);
            return reply.status(500).send({error: 'Error gestionando precios pactados'});
        }
    };

    const clienteDe = async (req) => {
        const clientId = Number(req.params.id);
        if (!Number.isInteger(clientId)) throw errorHttp(400, 'Cliente inválido.');
        const cliente = await prisma.user.findUnique({where: {id: clientId}, select: {id: true}});
        if (!cliente) throw errorHttp(404, 'Cliente no encontrado.');
        return clientId;
    };

    const acuerdoDe = async (clientId, req) => {
        const fila = await prisma.clientProductPrice.findFirst({
            where: {id: Number(req.params.priceId) || 0, clientId},
            include: {product: {select: {name: true}}},
        });
        if (!fila) throw errorHttp(404, 'Precio pactado no encontrado.');
        return fila;
    };

    // Todos los acuerdos del cliente: vigentes, próximos y finalizados.
    fastify.get('/:id/prices', conErrores(async (req) => {
        if (!esEmpleado(req)) throw errorHttp(403, 'No autorizado.');
        const clientId = await clienteDe(req);
        const h = hoy();
        const filas = await prisma.clientProductPrice.findMany({
            where: {clientId},
            include: {
                product: {select: {name: true, basePrice: true, bigClientPrice: true}},
                creator: {select: {firstName: true, lastName: true}},
            },
        });
        const precios = filas
            .map((f) => serializar(f, h))
            .sort((a, b) => a.productName.localeCompare(b.productName, 'es') || b.validFrom.localeCompare(a.validFrom));
        return {hoy: h, precios};
    }));

    // Precios pactados vigentes hoy, por producto. Es lo que consulta el TPV.
    fastify.get('/:id/effective-prices', conErrores(async (req) => {
        if (!esEmpleado(req)) throw errorHttp(403, 'No autorizado.');
        const clientId = await clienteDe(req);
        const pactados = await preciosPactadosVigentes(prisma, clientId);
        const precios = {};
        for (const [productId, f] of pactados) {
            precios[productId] = {id: f.id, price: aNumero(f.price), validTo: fechaTexto(f.validTo), note: f.note};
        }
        return precios;
    }));

    // Nuevo acuerdo. Si ya había uno anterior para el producto que seguiría
    // vigente, se cierra el día antes del nuevo.
    fastify.post('/:id/prices', conErrores(async (req, reply) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const clientId = await clienteDe(req);
        const body = req.body || {};

        const producto = await prisma.product.findUnique({
            where: {id: Number(body.productId) || 0},
            select: {id: true, name: true},
        });
        if (!producto) throw errorHttp(400, 'Producto no encontrado.');

        const {precio, desde, hasta, nota} = validarDatos({
            price: body.price,
            validFrom: body.validFrom || hoy(),
            validTo: body.validTo || null,
            note: body.note,
        });

        const {creado, cerrados} = await prisma.$transaction(async (tx) => {
            const existentes = await tx.clientProductPrice.findMany({where: {clientId, productId: producto.id}});
            const nuevo = {from: desde, to: hasta};
            const aCerrar = [];
            for (const e of existentes) {
                const t = tramo(e);
                if (!solapan(t, nuevo)) continue;
                // Sólo se cierra solo si empezó antes y no le queda tramo
                // después del nuevo; en otro caso hay que decidirlo a mano.
                const empiezaAntes = t.from < desde;
                const noQuedaTramoDespues = hasta === null || (t.to !== null && t.to <= hasta);
                if (empiezaAntes && noQuedaTramoDespues) aCerrar.push(e);
                else throw conflicto(producto.name, t);
            }
            for (const e of aCerrar) {
                await tx.clientProductPrice.update({
                    where: {id: e.id},
                    data: {validTo: fechaDb(addDays(desde, -1))},
                });
            }
            const fila = await tx.clientProductPrice.create({
                data: {
                    clientId,
                    productId: producto.id,
                    price: precio,
                    validFrom: fechaDb(desde),
                    validTo: hasta ? fechaDb(hasta) : null,
                    note: nota,
                    createdBy: req.user?.userId || null,
                },
            });
            return {creado: fila, cerrados: aCerrar.map((e) => e.id)};
        });

        return reply.status(201).send({id: creado.id, cerrados});
    }));

    // Modificar precio, fechas o nota. El producto no cambia: para otro producto, otro acuerdo.
    fastify.put('/:id/prices/:priceId', conErrores(async (req) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const clientId = await clienteDe(req);
        const fila = await acuerdoDe(clientId, req);
        const body = req.body || {};
        const actual = tramo(fila);

        const {precio, desde, hasta, nota} = validarDatos({
            price: body.price !== undefined ? body.price : fila.price,
            validFrom: body.validFrom || actual.from,
            validTo: body.validTo !== undefined ? (body.validTo || null) : actual.to,
            note: body.note !== undefined ? body.note : fila.note,
        });

        const otros = await prisma.clientProductPrice.findMany({
            where: {clientId, productId: fila.productId, id: {not: fila.id}},
        });
        for (const e of otros) {
            const t = tramo(e);
            if (solapan(t, {from: desde, to: hasta})) throw conflicto(fila.product.name, t);
        }

        await prisma.clientProductPrice.update({
            where: {id: fila.id},
            data: {price: precio, validFrom: fechaDb(desde), validTo: hasta ? fechaDb(hasta) : null, note: nota},
        });
        return {id: fila.id};
    }));

    // Finalizar: deja de aplicarse desde hoy. Si aún no había empezado, o empieza
    // hoy, se elimina; si ya se aplicó, se cierra ayer para conservar el histórico.
    fastify.delete('/:id/prices/:priceId', conErrores(async (req) => {
        if (!esAdmin(req)) throw errorHttp(403, SOLO_ADMIN);
        const clientId = await clienteDe(req);
        const fila = await acuerdoDe(clientId, req);
        const h = hoy();
        const t = tramo(fila);

        if (t.from >= h) {
            await prisma.clientProductPrice.delete({where: {id: fila.id}});
            return {eliminado: true};
        }
        if (t.to !== null && t.to < h) throw errorHttp(400, 'Este precio pactado ya estaba finalizado.');

        const ayer = addDays(h, -1);
        await prisma.clientProductPrice.update({where: {id: fila.id}, data: {validTo: fechaDb(ayer)}});
        return {finalizado: true, validTo: ayer};
    }));
}
