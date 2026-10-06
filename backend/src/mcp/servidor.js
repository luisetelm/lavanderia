// Servidor MCP de la lavandería: registra las herramientas de herramientas.js
// sobre un contexto (API + usuario) y las expone a cualquier cliente MCP
// (Claude.ai, la app de escritorio, Claude Code).
//
// Lo crean stdio.js (uso local) y http.js (conector remoto con OAuth), una
// instancia por usuario conectado: así cada herramienta llama a la API con
// el token de esa persona y hereda sus permisos.

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {herramientasPara, ejecutarHerramienta} from './herramientas.js';

export const NOMBRE_SERVIDOR = 'tinte-y-burbuja';
export const VERSION_SERVIDOR = '1.0.0';

/** Instrucciones que ve el modelo al conectar (equivalente al bloque de Aula26). */
export function instrucciones(usuario) {
    const quien = usuario?.nombre ? `${usuario.nombre} (${usuario.role})` : (usuario?.role || 'empleado');
    return [
        `Conector de Tinte y Burbuja, la lavandería y tintorería. Usuario conectado: ${quien}.`,
        'Escribe en castellano, con tuteo y tono cercano. Los importes van en euros con IVA incluido.',
        'Fechas en formato YYYY-MM-DD. Hoy lo dice la herramienta carga_de_trabajo (campo hoy).',
        'Reglas de precios: precio pactado del cliente > tarifa de gran cliente > precio público; el descuento del cliente no se aplica a precios pactados. Los grandes clientes (hoteles, restaurantes) tienen días fijos de recogida y entrega y nunca pagan suplemento de urgencia.',
        'Fechas de entrega: la fecha sugerida sale del calendario de carga; adelantarla añade un suplemento de urgencia (porcentaje por día laborable, con tope). Explícalo si el cliente pide prisa.',
        'Estados de pedido: pending (pendiente), in_progress (en proceso), ready (listo para recoger), collected (entregado), cancelled (anulado).',
        'Herramientas de escritura (crear_pedido, cambiar_estado_pedido, registrar_pago, fijar_precio_pactado, enviar_mensaje): enseña antes a la persona lo que vas a hacer (presupuesto con presupuestar_pedido, texto del mensaje, importe del cobro) y actúa sólo cuando lo confirme. Nunca anules ni cobres sin confirmación explícita.',
        'WhatsApp: sólo se puede escribir texto libre si la ventana de 24 h está abierta (el cliente escribió en las últimas 24 h); si no, usa SMS o dilo.',
        'Para buscar un cliente por teléfono usa sólo los dígitos. Si una búsqueda devuelve varios clientes, pregunta cuál antes de seguir.',
        'Si una herramienta devuelve error, explica el motivo tal cual lo da la API (ya viene en castellano) y propone la alternativa.',
    ].join('\n');
}

/**
 * @param {{api: object, usuario: {id:number, role:string, nombre?:string}}} ctx
 */
export function crearServidorMcp(ctx) {
    const server = new McpServer(
        {name: NOMBRE_SERVIDOR, version: VERSION_SERVIDOR},
        {instructions: instrucciones(ctx.usuario)},
    );
    for (const h of herramientasPara(ctx.usuario)) {
        server.registerTool(
            h.nombre,
            {
                title: h.titulo,
                description: h.descripcion,
                inputSchema: h.esquema,
                annotations: {
                    readOnlyHint: h.soloLectura === true,
                    destructiveHint: h.soloLectura !== true,
                    idempotentHint: h.soloLectura === true,
                    openWorldHint: false,
                },
            },
            async (entrada) => {
                const r = await ejecutarHerramienta(h, entrada || {}, ctx);
                if (!r.ok) {
                    return {
                        content: [{type: 'text', text: JSON.stringify({error: r.error, status: r.status, detalle: r.detalle})}],
                        isError: true,
                    };
                }
                return {content: [{type: 'text', text: JSON.stringify(r.resultado)}]};
            },
        );
    }
    return server;
}
