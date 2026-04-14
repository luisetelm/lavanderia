// backend/src/routes/itineraries.js
export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // ─── GET /api/itineraries ── Listar itinerarios ──
    fastify.get('/', async (req, reply) => {
        try {
            const itineraries = await prisma.itinerary.findMany({
                where: { isActive: true },
                include: {
                    steps: { orderBy: { position: 'asc' } },
                    _count: { select: { products: true } }
                },
                orderBy: { name: 'asc' }
            });
            return reply.send(itineraries);
        } catch (err) {
            console.error('Error en GET /itineraries:', err);
            return reply.status(500).send({ error: 'Error cargando itinerarios' });
        }
    });

    // ─── GET /api/itineraries/:id ── Detalle de un itinerario ──
    fastify.get('/:id', async (req, reply) => {
        const id = Number(req.params.id);
        if (isNaN(id)) return reply.status(400).send({ error: 'ID inválido' });

        try {
            const itinerary = await prisma.itinerary.findUnique({
                where: { id },
                include: {
                    steps: { orderBy: { position: 'asc' } },
                    products: { select: { id: true, name: true } }
                }
            });
            if (!itinerary) return reply.status(404).send({ error: 'Itinerario no encontrado' });
            return reply.send(itinerary);
        } catch (err) {
            console.error('Error en GET /itineraries/:id:', err);
            return reply.status(500).send({ error: 'Error obteniendo itinerario' });
        }
    });

    // ─── POST /api/itineraries ── Crear itinerario ──
    fastify.post('/', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Solo administradores' });
        }

        const { name, description, steps } = req.body;
        if (!name || !name.trim()) return reply.status(400).send({ error: 'El nombre es obligatorio' });
        if (!Array.isArray(steps) || steps.length === 0) {
            return reply.status(400).send({ error: 'Debe tener al menos un paso' });
        }

        try {
            const itinerary = await prisma.itinerary.create({
                data: {
                    name: name.trim(),
                    description: description?.trim() || null,
                    steps: {
                        create: steps.map((s, i) => ({
                            stepKey: s.stepKey,
                            stepLabel: s.stepLabel,
                            position: i + 1,
                            durationMin: s.durationMin || 0,
                            resourceKey: s.resourceKey || null,
                            autoProgress: s.autoProgress || false,
                            isOptional: s.isOptional || false,
                        }))
                    }
                },
                include: { steps: { orderBy: { position: 'asc' } } }
            });
            return reply.status(201).send(itinerary);
        } catch (err) {
            if (err.code === 'P2002') {
                return reply.status(400).send({ error: 'Ya existe un itinerario con ese nombre' });
            }
            console.error('Error en POST /itineraries:', err);
            return reply.status(500).send({ error: 'Error creando itinerario' });
        }
    });

    // ─── PUT /api/itineraries/:id ── Editar itinerario ──
    fastify.put('/:id', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Solo administradores' });
        }

        const id = Number(req.params.id);
        if (isNaN(id)) return reply.status(400).send({ error: 'ID inválido' });

        const { name, description, steps } = req.body;
        if (!name || !name.trim()) return reply.status(400).send({ error: 'El nombre es obligatorio' });
        if (!Array.isArray(steps) || steps.length === 0) {
            return reply.status(400).send({ error: 'Debe tener al menos un paso' });
        }

        try {
            // Comprobar nombre duplicado excluyendo el itinerario actual
            const duplicate = await prisma.itinerary.findFirst({
                where: { name: name.trim(), id: { not: id } },
            });
            if (duplicate) {
                return reply.status(400).send({ error: 'Ya existe un itinerario con ese nombre' });
            }

            // Transacción atómica: remapear OLS → borrar pasos → crear pasos nuevos
            const itinerary = await prisma.$transaction(async (tx) => {
                // 1. Obtener pasos antiguos CON su stepKey para remapear
                const oldSteps = await tx.itineraryStep.findMany({
                    where: { itineraryId: id },
                    select: { id: true, stepKey: true }
                });
                const oldStepIds = oldSteps.map(s => s.id);

                // 2. Guardar mapping OLS → old stepKey ANTES de desvincular
                let olsMapping = [];
                if (oldStepIds.length > 0) {
                    olsMapping = await tx.orderLineStep.findMany({
                        where: { itineraryStepId: { in: oldStepIds } },
                        select: { id: true, itineraryStepId: true }
                    });
                    // Desvincular temporalmente
                    await tx.orderLineStep.updateMany({
                        where: { itineraryStepId: { in: oldStepIds } },
                        data: { itineraryStepId: null }
                    });
                }

                // 3. Eliminar pasos antiguos
                await tx.itineraryStep.deleteMany({ where: { itineraryId: id } });

                // 4. Actualizar itinerario y crear nuevos pasos
                const updated = await tx.itinerary.update({
                    where: { id },
                    data: {
                        name: name.trim(),
                        description: description?.trim() || null,
                        steps: {
                            create: steps.map((s, i) => ({
                                stepKey: s.stepKey,
                                stepLabel: s.stepLabel,
                                position: i + 1,
                                durationMin: s.durationMin || 0,
                                resourceKey: s.resourceKey || null,
                                autoProgress: s.autoProgress || false,
                                isOptional: s.isOptional || false,
                                displayOrder: s.displayOrder ?? (i + 1) * 10,
                            }))
                        }
                    },
                    include: {
                        steps: { orderBy: { position: 'asc' } },
                        _count: { select: { products: true } }
                    }
                });

                // 5. Remapear OLS a los nuevos pasos por stepKey
                if (olsMapping.length > 0 && updated.steps.length > 0) {
                    // old step id → stepKey
                    const oldIdToKey = {};
                    oldSteps.forEach(s => { oldIdToKey[s.id] = s.stepKey; });
                    // stepKey → new step id  (primera coincidencia)
                    const keyToNewId = {};
                    updated.steps.forEach(s => {
                        if (!keyToNewId[s.stepKey]) keyToNewId[s.stepKey] = s.id;
                    });

                    for (const m of olsMapping) {
                        const oldKey = oldIdToKey[m.itineraryStepId];
                        if (oldKey && keyToNewId[oldKey]) {
                            await tx.orderLineStep.update({
                                where: { id: m.id },
                                data: { itineraryStepId: keyToNewId[oldKey] }
                            });
                        }
                        // Si el stepKey ya no existe en el nuevo itinerario, queda null (paso eliminado)
                    }
                }

                return updated;
            });

            return reply.send(itinerary);
        } catch (err) {
            console.error('Error en PUT /itineraries/:id:', err);
            return reply.status(500).send({ error: 'Error actualizando itinerario' });
        }
    });

    // ─── DELETE /api/itineraries/:id ── Desactivar itinerario ──
    fastify.delete('/:id', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Solo administradores' });
        }

        const id = Number(req.params.id);
        if (isNaN(id)) return reply.status(400).send({ error: 'ID inválido' });

        try {
            // Verificar si tiene productos asignados
            const productCount = await prisma.product.count({ where: { itineraryId: id } });
            if (productCount > 0) {
                return reply.status(400).send({
                    error: `No se puede eliminar: hay ${productCount} producto(s) usando este itinerario. Reasígnalos primero.`
                });
            }

            await prisma.itinerary.update({
                where: { id },
                data: { isActive: false }
            });
            return reply.send({ ok: true });
        } catch (err) {
            console.error('Error en DELETE /itineraries/:id:', err);
            return reply.status(500).send({ error: 'Error eliminando itinerario' });
        }
    });

    // ─── GET /api/itineraries/resources ── Obtener recursos disponibles ──
    fastify.get('/resources/list', async (req, reply) => {
        try {
            const resources = await prisma.resourceConfig.findMany({ orderBy: { label: 'asc' } });
            return reply.send(resources);
        } catch (err) {
            return reply.status(500).send({ error: 'Error cargando recursos' });
        }
    });
}

