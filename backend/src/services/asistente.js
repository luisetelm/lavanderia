// Asistente interno: redacta una respuesta para una conversación del chat
// (WhatsApp/SMS) usando la API de Claude con las mismas herramientas del
// conector MCP (src/mcp/herramientas.js), sólo las de lectura. No envía nada:
// devuelve un borrador que el empleado revisa en el compositor del chat.
//
// Las herramientas llaman a la propia API por HTTP con un JWT corto del
// empleado que pide la sugerencia, así se aplican sus permisos.
//
//   ANTHROPIC_API_KEY   clave de la API de Claude (sin ella, 503)
//   ASISTENTE_MODELO    por defecto claude-opus-5-5

import Anthropic from '@anthropic-ai/sdk';
import {betaZodTool} from '@anthropic-ai/sdk/helpers/beta/zod';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import jwt from 'jsonwebtoken';
import {crearApi} from '../mcp/api.js';
import {herramientasPara, ejecutarHerramienta} from '../mcp/herramientas.js';
import {instrucciones} from '../mcp/servidor.js';

const MODELO = process.env.ASISTENTE_MODELO || 'claude-opus-5-5';

// Salida estructurada: el mensaje para el cliente y, aparte, lo que debe
// comprobar quien atiende. Nunca van juntos en el mismo texto, porque el
// mensaje acaba en el compositor del chat y podría enviarse tal cual.
const Respuesta = z.object({
    mensaje: z.string().describe('Texto que se enviará al cliente, listo para mandar'),
    notas: z.string().nullable().describe('Qué debe comprobar o decidir la persona antes de enviar (dudas, datos que faltan). null si no hay nada'),
});

export class ErrorAsistente extends Error {
    constructor(status, mensaje) {
        super(mensaje);
        this.statusCode = status;
    }
}

function apiInterna() {
    return (process.env.MCP_API_URL || `http://127.0.0.1:${process.env.PORT || 4000}/api`).replace(/\/+$/, '');
}

/**
 * @param {object} opts
 * @param {{userId:number, role:string, email?:string}} opts.usuario  req.user del empleado
 * @param {string} opts.nombreUsuario
 * @param {number} opts.conversacionId
 * @param {string} [opts.indicacion]  lo que el empleado quiere decir, si lo ha escrito
 * @returns {Promise<{texto:string, notas:string|null, herramientas:string[], modelo:string}>}
 */
export async function sugerirRespuesta({usuario, nombreUsuario, conversacionId, indicacion}) {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new ErrorAsistente(503, 'El asistente no está configurado (falta ANTHROPIC_API_KEY).');
    }
    const token = jwt.sign({userId: usuario.userId, role: usuario.role, email: usuario.email}, process.env.JWT_SECRET, {expiresIn: '10m'});
    const api = crearApi({baseUrl: apiInterna(), obtenerToken: async () => token});
    const ctx = {api, usuario: {id: usuario.userId, role: usuario.role, nombre: nombreUsuario}};

    const usadas = [];
    const tools = herramientasPara(ctx.usuario).filter(h => h.soloLectura).map(h => betaZodTool({
        name: h.nombre,
        description: h.descripcion,
        inputSchema: z.object(h.esquema),
        run: async (entrada) => {
            usadas.push(h.nombre);
            const r = await ejecutarHerramienta(h, entrada, ctx);
            return JSON.stringify(r.ok ? r.resultado : {error: r.error, status: r.status});
        },
    }));

    // La conversación se lee aquí y va en el primer mensaje: ahorra una vuelta
    // de herramienta (la más lenta) y el modelo sólo consulta lo que falte.
    console.log(`[asistente] conversación ${conversacionId}: leyendo con ${apiInterna()}`);
    const hConv = herramientasPara(ctx.usuario).find(h => h.nombre === 'conversacion');
    const conv = await ejecutarHerramienta(hConv, {conversacionId, limite: 25}, ctx);
    if (!conv.ok) throw new ErrorAsistente(conv.status === 404 ? 404 : 502, conv.error);
    const inicio = Date.now();
    console.log(`[asistente] conversación ${conversacionId}: ${conv.resultado?.mensajes?.length ?? 0} mensajes leídos, llamando a ${MODELO}`);

    const sistema = [
        instrucciones(ctx.usuario),
        '',
        'Tarea: redactar la respuesta que la lavandería mandará por el chat a un cliente. No puedes enviar nada; sólo propones el texto y la persona lo revisa.',
        'La conversación ya viene en el mensaje. Consulta sólo lo que falte para contestar (pedidos del cliente con listar_pedidos o ver_pedido, precios con precio_efectivo o presupuestar_pedido, entregas, carga de trabajo), con las menos llamadas posibles; no inventes datos, fechas ni precios.',
        'Si el cliente pregunta por un pedido, mira su estado real y la fecha de entrega. Si pide precio, da el que le corresponde a él (precio_efectivo) y di que es con IVA. Si pide una fecha antes de la sugerida, avisa del suplemento de urgencia.',
        'Escribe como la lavandería: cercano, breve (dos o tres frases salvo que haga falta más), en castellano, con tuteo, sin emojis salvo que el cliente los use. Firma como Tinte y Burbuja sólo si la conversación es nueva.',
        'Si falta información para contestar bien, propón el mensaje más útil posible y explica en «notas» qué debe comprobar o decidir la persona. El campo «mensaje» es sólo lo que leerá el cliente: nada de notas, corchetes, dudas internas ni explicaciones ahí.',
    ].join('\n');

    const client = new Anthropic({timeout: 45_000, maxRetries: 1});
    const runner = client.beta.messages.toolRunner({
        model: MODELO,
        max_tokens: 4000,
        output_config: {effort: 'low', format: zodOutputFormat(Respuesta)},
        // Si un clasificador rechaza la petición, la API la reintenta sola en
        // otro modelo en vez de dejar al empleado sin sugerencia.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: sistema,
        tools,
        max_iterations: 5,
        messages: [{
            role: 'user',
            content: [
                `Conversación ${conversacionId}:`,
                JSON.stringify(conv.resultado),
                '',
                indicacion
                    ? `Redacta la respuesta. Lo que quiero transmitir: ${indicacion}`
                    : 'Redacta la respuesta al último mensaje del cliente.',
            ].join('\n'),
        }],
    });

    let final;
    try {
        final = await Promise.race([
            runner.runUntilDone(), // done() sólo espera; runUntilDone() ejecuta el bucle
            new Promise((_, rej) => setTimeout(() => rej(new ErrorAsistente(504, 'El asistente ha tardado demasiado; vuelve a intentarlo.')), 100_000)),
        ]);
    } catch (e) {
        if (e instanceof ErrorAsistente) throw e;
        if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ErrorAsistente(504, 'La API de Claude no ha respondido a tiempo.');
        if (e instanceof Anthropic.AuthenticationError) throw new ErrorAsistente(503, 'La clave de la API de Claude no es válida.');
        if (e instanceof Anthropic.RateLimitError) throw new ErrorAsistente(429, 'El asistente está saturado; prueba en un momento.');
        if (e instanceof Anthropic.APIConnectionError) throw new ErrorAsistente(502, 'No se pudo conectar con la API de Claude.');
        throw e;
    }
    if (final?.stop_reason === 'refusal') {
        throw new ErrorAsistente(422, 'El asistente ha declinado redactar esta respuesta.');
    }
    const crudo = (final?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    let salida;
    try {
        salida = Respuesta.parse(JSON.parse(crudo));
    } catch {
        throw new ErrorAsistente(502, 'El asistente ha devuelto una respuesta que no se puede interpretar.');
    }
    const texto = salida.mensaje.trim();
    const notas = salida.notas?.trim() || null;
    if (!texto) throw new ErrorAsistente(502, 'El asistente no ha devuelto texto.');
    console.log(`[asistente] conversación ${conversacionId}: ${Date.now() - inicio} ms, herramientas: ${[...new Set(usadas)].join(', ') || 'ninguna'}, modelo ${final?.model || MODELO}`);
    return {texto, notas, herramientas: [...new Set(usadas)], modelo: final?.model || MODELO};
}
