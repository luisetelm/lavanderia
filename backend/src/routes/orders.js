// backend/src/routes/orders.js
//import nextOrderNum from '../utils/generateOrderNum.js';
import {isValidSpanishPhone} from '../utils/validatePhone.js';
import {sendSMScustomer} from "../services/twilio.js";
import {crearFactura} from "./invoices.js";

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    fastify.post('/', async (req, reply) => {
        const prisma = fastify.prisma;

        console.log('Entrando a /api/orders, body:', req.body, 'query:', req.query);
        console.log('Modelos Prisma:', {
            order: !!prisma.order, user: !!prisma.user, product: !!prisma.product,
        });


        const {
            clientId,
            clientFirstName,
            clientLastName,
            clientEmail,
            clientPhone,
            lines,
            observaciones,
            fechaLimite: fechaLimiteRaw,
            workerId,
        } = req.body;

        // Validaciones básicas similares a las que ya tienes
        let client = null;
        if (clientId) {
            client = await prisma.user.findUnique({where: {id: Number(clientId)}});
            if (!client) return reply.status(400).send({error: 'clientId inválido'});
            if (client.role === 'customer' && !client.phone) {
                return reply.status(400).send({error: 'El cliente debe tener teléfono'});
            }
        } else {
            if (!clientFirstName || !clientLastName) {
                return reply.status(400).send({error: 'clientFirstName y clientLastName son obligatorios'});
            }
            if (!clientPhone || !isValidSpanishPhone(clientPhone)) {
                return reply.status(400).send({error: 'Teléfono válido obligatorio (ej: 600123456)'});
            }

            if (clientEmail) {
                client = await prisma.user.upsert({
                    where: {email: clientEmail}, update: {
                        firstName: clientFirstName, lastName: clientLastName, phone: clientPhone, role: 'customer',
                    }, create: {
                        firstName: clientFirstName,
                        lastName: clientLastName,
                        email: clientEmail,
                        phone: clientPhone,
                        role: 'customer',
                        password: null,
                    },
                });
            } else {
                client = await prisma.user.findFirst({where: {phone: clientPhone}});
                if (!client) {
                    client = await prisma.user.create({
                        data: {
                            firstName: clientFirstName,
                            lastName: clientLastName,
                            phone: clientPhone,
                            role: 'customer',
                            password: null,
                        },
                    });
                }
            }
        }

        if (!lines || !Array.isArray(lines) || lines.length === 0) {
            return reply.status(400).send({error: 'Debe haber al menos una línea en el pedido'});
        }

        // Calcular totales y preparar líneas
        let total = 0;
        const lineCreates = [];

        for (const l of lines) {
            const product = await prisma.product.findUnique({where: {id: l.productId}});
            if (!product) return reply.status(400).send({error: `Producto inválido: ${l.productId}`});

            // Determinar qué precio usar según si el cliente es gran cliente
            let unitPrice = product.basePrice;
            if (client.isbigclient && product.bigClientPrice && product.bigClientPrice > 0) {
                unitPrice = parseFloat(product.bigClientPrice);
            }

            // Aplicar modificador de variante si existe
            if (l.variantId) {
                const variant = await prisma.productVariant.findUnique({where: {id: l.variantId}});
                if (variant) unitPrice += variant.priceModifier;
            }

            const quantity = l.quantity || 1;
            const totalPrice = unitPrice * quantity;
            total += totalPrice;

            lineCreates.push({
                productId: l.productId,
                variantId: l.variantId || null,
                quantity,
                unitPrice,
                totalPrice,
                notes: l.notes || '',
            });
        }

        // Fecha límite: si viene, se parsea; si no, se propone (ej. dentro de una semana laboral)
        const defaultFechaLimite = () => {
            const d = new Date();
            d.setDate(d.getDate() + 7);
            // avanza hasta día laborable si cae en fin de semana
            while (d.getDay() === 0 || d.getDay() === 6) {
                d.setDate(d.getDate() + 1);
            }
            return d;
        };

        let fechaLimite = fechaLimiteRaw ? new Date(fechaLimiteRaw) : defaultFechaLimite();
        // opcional: rechazar pasado
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (fechaLimite < today) {
            return reply.status(400).send({error: 'La fecha límite no puede ser anterior a hoy.'});
        }

        // Generar orderNum (usa tu helper correctamente con fastify)
        const orderNum = await nextOrderNum(prisma);


        // Crear pedido en estado pendiente (sin pago)
        const order = await prisma.order.create({
            data: {
                orderNum,
                clientId: client.id,
                total,
                paid: false,
                paymentMethod: null,
                observaciones: observaciones || null,
                fechaLimite,
                lines: {create: lineCreates},
                workerId: workerId
            }, include: {
                lines: {
                    include: {product: true},
                }, client: {
                    select: {
                        id: true, firstName: true, lastName: true, email: true, phone: true,
                    },
                },
            },
        });

        // Serializar como hacías
        const serialized = {
            ...order, lines: order.lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                variantId: l.variantId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                totalPrice: l.totalPrice,
                notes: l.notes,
                productName: l.product?.name || '',
            })),
        };

        return reply.send(serialized);
    });

    fastify.patch('/:id', async (req, reply) => {
        const prisma = fastify.prisma;
        const orderId = Number(req.params.id);
        const {status, observaciones, fechaLimite: fechaLimiteRaw, sendSMS, workerId, observacionesInternas} = req.body;


        const data = {};

        if (status) {
            data.status = status;
            data.updatedAt = new Date();

            if (status === 'cancelled') {
                data.total = 0;
            }

        } else {
            data.status = 'pending';
        }


        if (observaciones !== undefined) data.observaciones = observaciones;
        if (observacionesInternas !== undefined) data.observacionesInternas = observacionesInternas;
        if (fechaLimiteRaw !== undefined) {
            const fechaLimite = new Date(fechaLimiteRaw);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (fechaLimite < today) {
                return reply.status(400).send({error: 'La fecha límite no puede ser anterior a hoy.'});
            }
            data.fechaLimite = fechaLimite;
        }

        if (workerId !== undefined) {
            // Convertir string vacío o null a null, sino convertir a número
            if (workerId === '' || workerId === null) {
                data.workerId = null;
            } else {
                const workerIdNum = Number(workerId);
                if (isNaN(workerIdNum)) {
                    return reply.status(400).send({error: 'workerId debe ser un número válido'});
                }
                data.workerId = workerIdNum;
            }
        }

        console.log('data', data);


        if (Object.keys(data).length === 0) {
            return reply.status(400).send({error: 'Nada para actualizar'});
        }

        const updated = await prisma.order.update({
            where: {id: orderId}, data, include: {
                lines: {
                    include: {product: true},
                }, client: {
                    select: {
                        id: true, firstName: true, lastName: true, email: true, phone: true,
                    },
                },
            },
        });


        // Si se marca como ready, notificar al cliente
        if (status === 'ready' && updated.client?.phone && sendSMS) {
            const client = updated.client;
            const orderNum = updated.orderNum || '';
            const clientName = client.firstName || '';
            const message = `Hola ${clientName}, tu pedido ${orderNum} está listo para recoger. Consulta nuestro horario de apertura: https://share.google/d4uMKGaiCaBywfRt2`;

            // SMS
            try {
                const sms = await sendSMScustomer(client.phone, message);
                await prisma.notification.create({
                    data: {
                        orderid: updated.id,
                        type: 'sms',
                        recipient: client.phone,
                        content: message,
                        status: 'sent',
                        statusCode: parseInt(sms.code),
                        subid: sms.subid,
                        statusMessage: sms.message,
                    },
                });
            } catch (err) {
                const sms = await sendSMScustomer(client.phone, message);
                await prisma.notification.create({
                    data: {
                        orderid: updated.id,
                        type: 'sms',
                        recipient: client.phone,
                        content: message,
                        status: 'failed',
                        statusCode: parseInt(sms.code),
                        subid: sms.subid,
                        statusMessage: sms.message,
                    },
                });
            }

        }

        if (status === 'collected' && updated.client?.phone && sendSMS) {
            const client = updated.client;
            const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
            const message = `Hola ${clientName}, esperamos que todo haya ido perfecto en Tinte y Burbuja 😊. Si puedes, déjanos una reseña: https://g.page/r/Cau9_6UCpQ8ZEBI/review`;

            // SMS
            try {
                await sendSMScustomer(client.phone, message);
                await prisma.notification.create({
                    data: {
                        orderid: updated.id, type: 'sms', recipient: client.phone, content: message, status: 'sent',
                    },
                });
            } catch (err) {
                await prisma.notification.create({
                    data: {
                        orderid: updated.id, type: 'sms', recipient: client.phone, content: message, status: 'failed',
                    },
                });
            }

        }

        return reply.send(updated);
    });

    fastify.post('/:id/pay', async (req, reply) => {
        const prisma = fastify.prisma;
        const orderId = Number(req.params.id);
        const {method, receivedAmount} = req.body; // method: 'cash' | 'card'

        try {
            const order = await prisma.order.findUnique({where: {id: orderId}});
            if (!order) return reply.status(404).send({error: 'Pedido no encontrado'});

            if (order.paid) {
                return reply.status(400).send({error: 'Pedido ya está pagado'});
            }

            if (method !== 'cash' && method !== 'card') {
                return reply.status(400).send({error: 'Método de pago inválido'});
            }

            const updateData = {
                paymentMethod: method, paid: true,
            };

            let change = 0;
            if (method === 'cash') {
                if (receivedAmount === undefined) {
                    return reply.status(400).send({error: 'Debe indicar cantidad recibida para efectivo'});
                }
                const received = parseFloat(receivedAmount);
                if (isNaN(received) || received < order.total) {
                    return reply.status(400).send({error: 'Cantidad recibida insuficiente'});
                }
                change = received - order.total;
            }

            await crearFactura(prisma, {orderIds: [orderId], type: 's'});

            const updated = await prisma.order.update({
                where: {id: orderId}, data: updateData, include: {
                    lines: {include: {product: true}}, client: {
                        select: {id: true, firstName: true, lastName: true, email: true, phone: true},
                    }, invoiceTickets: {
                        include: {
                            order: {
                                include: {
                                    lines: {
                                        include: {product: true}
                                    }
                                }
                            }
                        }
                    },
                },
            });


            return reply.send({order: updated, change: method === 'cash' ? change : 0});
        } catch (err) {
            console.error('Error en /orders/:id/pay:', err);
            return reply
                .status(500)
                .send({error: 'Fallo interno al procesar el pago', details: err.message});
        }
    });

    fastify.get('/', async (req, reply) => {
        const prisma = fastify.prisma;
        const {q, status, workerId, sortBy = 'createdAt', sortOrder = 'desc', startDate, endDate} = req.query || {};

        const where = {};

        if (status && status !== 'all') {
            where.status = status;
        }

        if (workerId) {
            where.workerId = parseInt(workerId);
        }

        if (startDate && endDate) {
            const startDateObj = new Date(startDate);
            const endDateObj = new Date(endDate);
            where.createdAt = {
                gte: startDateObj, lte: endDateObj,
            };
        }


        if (q && String(q).trim()) {
            const term = String(q).trim();
            where.OR = [{orderNum: {contains: term, mode: 'insensitive'}}, {
                client: {
                    OR: [{firstName: {contains: term, mode: 'insensitive'}}, {
                        lastName: {
                            contains: term, mode: 'insensitive'
                        }
                    }, {email: {contains: term, mode: 'insensitive'}}, {phone: {contains: term}},],
                },
            },];
        }

        // Configurar ordenación
        const validSortFields = ['createdAt', 'fechaLimite', 'updatedAt'];
        const validSortOrders = ['asc', 'desc'];

        const orderByField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
        const orderByDirection = validSortOrders.includes(sortOrder) ? sortOrder : 'desc';

        try {
            const orders = await prisma.order.findMany({
                where, include: {
                    lines: {include: {product: true},}, client: {
                        select: {id: true, firstName: true, lastName: true, phone: true, email: true},
                    }, notification: {
                        select: {id: true, type: true, sentAt: true, status: true, content: true}
                    }, invoiceTickets: {
                        include: {
                            invoices: true
                        }
                    }
                }, orderBy: {[orderByField]: orderByDirection},
            });



            return reply.send(orders);

        } catch (err) {
            console.error('Error en GET /api/orders:', err);
            return reply.status(500).send({error: 'Error al obtener pedidos'});
        }
    });

    fastify.get('/:id', async (req, reply) => {
        const prisma = fastify.prisma;
        const orderId = Number(req.params.id);
        if (isNaN(orderId)) {
            return reply.status(400).send({error: 'ID de pedido inválido'});
        }

        try {
            const order = await prisma.order.findUnique({
                where: {id: orderId}, include: {
                    lines: {include: {product: true /* , variant: true */}},
                    client: {select: {id: true, firstName: true, lastName: true, email: true, phone: true}},
                    notification: {select: {id: true, type: true, sentAt: true, status: true, content: true}},
                    invoiceTickets: {
                        include: {
                            invoices: true
                        },
                    },
                },
            });


            if (!order) {
                return reply.status(404).send({error: 'Pedido no encontrado'});
            }


            // Aplanar/normalizar facturas de forma segura
            const invoices = [];
            const invoiceTickets = order.invoiceTickets;

            if (Array.isArray(invoiceTickets)) {
                invoiceTickets.forEach(it => {
                    const inv = it?.invoices;
                    if (!inv) return;
                    if (Array.isArray(inv)) inv.forEach(i => invoices.push(i));
                    else invoices.push(inv);
                });
            } else if (invoiceTickets && typeof invoiceTickets === 'object') {
                // caso donde invoiceTickets es un objeto único
                const inv = invoiceTickets.invoices;
                if (inv) {
                    if (Array.isArray(inv)) inv.forEach(i => invoices.push(i));
                    else invoices.push(inv);
                }
            }

            // Generar ruta pdf solo para facturas válidas
            invoices.forEach(invoice => {
                if (invoice && invoice.id) {
                    invoice.pdfPath = `/invoices_pdfs/factura_${invoice.id}.pdf`;
                }
            });

            console.log('invoices', invoices);


            // Normalizar/cocinar la línea para que tenga todo lo que el frontend espera:
            const serializedLines = order.lines.map((l) => {
                // fallback name desde product si no viene explícito
                const productName = l.product?.name || `#${l.productId}`;
                // basePrice + posible modificador de variante
                let unitPrice = l.unitPrice;
                // Si no se guardó en unitPrice y quieres reconstruir:
                // let base = l.product?.basePrice || 0;
                // if (l.variantId && l.variant) base += l.variant.priceModifier;
                // unitPrice = unitPrice || base;

                return {
                    id: l.id,
                    productId: l.productId,
                    variantId: l.variantId || null,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    totalPrice: l.totalPrice,
                    notes: l.notes || '',
                    productName: l.product?.name || '',
                    product: {
                        id: l.product?.id, name: l.product?.name, basePrice: l.product?.basePrice,
                    },
                };
            });

            const serialized = {
                ...order, lines: serializedLines, facturas: invoices,
            };

            return reply.send(serialized);
        } catch (err) {
            console.error('Error en GET /orders/:id:', err);
            return reply.status(500).send({error: 'Error al obtener el pedido'});
        }
    });

    fastify.patch('/lines/:lineId', async (req, reply) => {
        const prisma = fastify.prisma;
        const lineId = Number(req.params.lineId);
        const {discount} = req.body;

        if (isNaN(lineId)) {
            return reply.status(400).send({error: 'ID de línea inválido'});
        }

        try {
            // Obtener la línea actual con su pedido
            const currentLine = await prisma.orderLine.findUnique({
                where: {id: lineId},
                include: {order: true}
            });

            if (!currentLine) {
                return reply.status(404).send({error: 'Línea no encontrada'});
            }

            // Verificar que el pedido no esté pagado
            if (currentLine.order.paid) {
                return reply.status(400).send({error: 'No se puede modificar una línea de un pedido ya pagado'});
            }

            // Validar descuento
            if (discount !== undefined) {
                const discountValue = parseFloat(discount);
                if (isNaN(discountValue) || discountValue < 0 || discountValue > 100) {
                    return reply.status(400).send({error: 'El descuento debe ser un porcentaje entre 0 y 100'});
                }

                // Calcular nuevo totalPrice con descuento
                const subtotal = currentLine.unitPrice * currentLine.quantity;
                const discountAmount = (subtotal * discountValue) / 100;
                const newTotalPrice = subtotal - discountAmount;

                // Actualizar la línea
                await prisma.orderLine.update({
                    where: {id: lineId},
                    data: {
                        discount: discountValue,
                        totalPrice: parseFloat(newTotalPrice.toFixed(2))
                    }
                });
            }

            // Recalcular el total del pedido
            const allLines = await prisma.orderLine.findMany({
                where: {orderId: currentLine.orderId}
            });

            const newOrderTotal = allLines.reduce((sum, line) => {
                return sum + (line.id === lineId
                    ? parseFloat((currentLine.unitPrice * currentLine.quantity * (1 - (discount || 0) / 100)).toFixed(2))
                    : line.totalPrice);
            }, 0);

            // Actualizar el total del pedido
            await prisma.order.update({
                where: {id: currentLine.orderId},
                data: {total: parseFloat(newOrderTotal.toFixed(2))}
            });

            // Devolver el pedido actualizado completo
            const updatedOrder = await prisma.order.findUnique({
                where: {id: currentLine.orderId},
                include: {
                    lines: {include: {product: true}},
                    client: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phone: true
                        }
                    },
                    notification: {
                        select: {
                            id: true,
                            type: true,
                            sentAt: true,
                            status: true,
                            content: true
                        }
                    },
                    invoiceTickets: {
                        include: {invoices: true}
                    }
                }
            });

            return reply.send(updatedOrder);
        } catch (err) {
            console.error('Error actualizando línea:', err);
            return reply.status(500).send({error: 'Error al actualizar la línea'});
        }
    });

    fastify.get('/delivery-dates', async (req, reply) => {
        try {
            const {page = 0} = req.query;
            const pageNum = parseInt(page) || 0; // Permitir páginas negativas

            // Generar las fechas del carrusel para esta página (permitiendo páginas negativas)
            const dates = [];
            let startDate = new Date();
            startDate.setDate(startDate.getDate() + 3); // Empezar desde mañana para el carrusel

            // Calcular cuántos días laborables saltar (puede ser negativo)
            let daysToSkip = 0;
            let tempDate = new Date(startDate);

            if (pageNum >= 0) {
                // Páginas positivas: avanzar hacia el futuro
                for (let p = 0; p < pageNum; p++) {
                    let laborableCount = 0;
                    while (laborableCount < 5) {
                        if (tempDate.getDay() !== 0 && tempDate.getDay() !== 6) {
                            laborableCount++;
                        }
                        tempDate.setDate(tempDate.getDate() + 1);
                        daysToSkip++;
                    }
                }
            } else {
                // Páginas negativas: retroceder hacia el pasado
                for (let p = 0; p < Math.abs(pageNum); p++) {
                    let laborableCount = 0;
                    while (laborableCount < 5) {
                        tempDate.setDate(tempDate.getDate() - 1);
                        if (tempDate.getDay() !== 0 && tempDate.getDay() !== 6) {
                            laborableCount++;
                        }
                        daysToSkip--;
                    }
                }
            }

            // Establecer fecha de inicio para esta página
            let current = new Date(startDate);
            current.setDate(current.getDate() + daysToSkip);

            // Generar exactamente 5 días laborables
            while (dates.length < 5) {
                if (current.getDay() !== 0 && current.getDay() !== 6) {
                    dates.push(current.toISOString().split('T')[0]);
                }
                current.setDate(current.getDate() + 1);
            }

            // Convertir strings de fecha a objetos Date para la consulta
            const dateObjects = dates.map(dateStr => new Date(dateStr + 'T00:00:00.000Z'));

            // Obtener pedidos para estas fechas
            const orders = await prisma.order.findMany({
                where: {
                    fechaLimite: {in: dateObjects}
                }, include: {
                    lines: {
                        include: {product: true}
                    }
                }
            });

            // Agrupar por fecha
            const loadByDay = {};
            dates.forEach(date => {
                loadByDay[date] = orders.filter(o => o.fechaLimite.toISOString().split('T')[0] === date);
            });

            // Calcular fecha sugerida solo en la primera página (page = 0)
            // y asegurar que esté dentro de las fechas disponibles
            let suggestedDate = null;
            if (pageNum == 0) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                // Buscar la fecha sugerida solo entre las fechas disponibles
                // y que cumplan con el mínimo de 2 días desde hoy
                const minDate = new Date(today);
                minDate.setDate(minDate.getDate() + 2); // Mínimo 2 días
                const minDateStr = minDate.toISOString().split('T')[0];

                console.log(`Looking for suggested date among available dates: ${dates.join(', ')}`);
                console.log(`Minimum date required: ${minDateStr}`);

                for (const dateStr of dates) {
                    // Solo considerar fechas que cumplan el mínimo de 2 días
                    if (dateStr >= minDateStr) {
                        const ordersForDay = loadByDay[dateStr] || [];
                        const totalItems = ordersForDay.reduce((sum, order) => sum + order.lines.reduce((s, l) => s + l.quantity, 0), 0);

                        console.log(`Date ${dateStr} has ${totalItems} total items`);

                        if (totalItems < 8) {
                            suggestedDate = dateStr;
                            console.log(`Found suggested date: ${dateStr}`);
                            break;
                        }
                    }
                }

                // Si no se encuentra ninguna fecha con menos de 8 items en la página 0,
                // buscar en páginas siguientes hasta encontrar una fecha adecuada
                if (!suggestedDate) {
                    console.log('No suitable date found in page 0, searching in future pages');
                    let searchPage = 1;
                    let maxSearchPages = 3; // Buscar máximo 3 páginas hacia adelante

                    while (!suggestedDate && searchPage <= maxSearchPages) {
                        // Generar fechas para la página de búsqueda
                        const searchDates = [];
                        let searchStartDate = new Date();
                        searchStartDate.setDate(searchStartDate.getDate() + 1);

                        let searchDaysToSkip = 0;
                        let searchTempDate = new Date(searchStartDate);

                        for (let p = 0; p < searchPage; p++) {
                            let laborableCount = 0;
                            while (laborableCount < 5) {
                                if (searchTempDate.getDay() !== 0 && searchTempDate.getDay() !== 6) {
                                    laborableCount++;
                                }
                                searchTempDate.setDate(searchTempDate.getDate() + 1);
                                searchDaysToSkip++;
                            }
                        }

                        let searchCurrent = new Date(searchStartDate);
                        searchCurrent.setDate(searchCurrent.getDate() + searchDaysToSkip);

                        while (searchDates.length < 5) {
                            if (searchCurrent.getDay() !== 0 && searchCurrent.getDay() !== 6) {
                                searchDates.push(searchCurrent.toISOString().split('T')[0]);
                            }
                            searchCurrent.setDate(searchCurrent.getDate() + 1);
                        }

                        // Buscar en las fechas de esta página
                        const searchDateObjects = searchDates.map(dateStr => new Date(dateStr + 'T00:00:00.000Z'));
                        const searchOrders = await prisma.order.findMany({
                            where: {fechaLimite: {in: searchDateObjects}}, include: {lines: true}
                        });

                        const searchLoadByDay = {};
                        searchDates.forEach(date => {
                            searchLoadByDay[date] = searchOrders.filter(o => o.fechaLimite.toISOString().split('T')[0] === date);
                        });

                        for (const dateStr of searchDates) {
                            if (dateStr >= minDateStr) {
                                const ordersForDay = searchLoadByDay[dateStr] || [];
                                const totalItems = ordersForDay.reduce((sum, order) => sum + order.lines.reduce((s, l) => s + l.quantity, 0), 0);

                                if (totalItems < 8) {
                                    suggestedDate = dateStr;
                                    console.log(`Found suggested date in page ${searchPage}: ${dateStr}`);
                                    break;
                                }
                            }
                        }

                        searchPage++;
                    }
                }

                // Si aún no se encuentra, usar la primera fecha disponible que cumpla el mínimo
                if (!suggestedDate) {
                    suggestedDate = dates.find(dateStr => dateStr >= minDateStr);
                    console.log(`No date with <8 items found, using first available: ${suggestedDate}`);
                }

                console.log(`Final suggested date: ${suggestedDate}`);
            }

            return {
                dates, loadByDay, suggestedDate: pageNum === 0 ? suggestedDate : null
            };

        } catch (error) {
            console.error('Error in delivery-dates endpoint:', error);
            reply.status(500).send({error: 'Error interno'});
        }
    });

    fastify.setErrorHandler((error, request, reply) => {
        console.error('Error no capturado:', error);
        reply.status(500).send({error: 'Error interno'});
    });

}

export async function nextOrderNum(prisma) {

    const year = new Date().getFullYear();

    const lastOrder = await prisma.order.findFirst({
        where: {
            orderNum: {
                startsWith: `TPV/${year}/`,
            },
        }, orderBy: {
            orderNum: 'desc',
        },
    });

    let nextNumber = 1;

    if (lastOrder) {
        const lastNum = parseInt(lastOrder.orderNum.split('/')[2]);
        nextNumber = lastNum + 1;
    }

    return `TPV/${year}/${String(nextNumber).padStart(4, '0')}`;
}
