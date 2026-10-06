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
import {z} from 'zod';
import jwt from 'jsonwebtoken';
import {crearApi} from '../mcp/api.js';
import {herramientasPara, ejecutarHerramienta} from '../mcp/herramientas.js';
import {instrucciones} from '../mcp/servidor.js';

const MODELO = process.env.ASISTENTE_MODELO || 'claude-opus-5-5';

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
 * @returns {Promise<{texto:string, herramientas:string[], modelo:string}>}
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

    const sistema = [
        instrucciones(ctx.usuario),
        '',
        'Tarea: redactar la respuesta que la lavandería mandará por el chat a un cliente. No puedes enviar nada; sólo propones el texto y la persona lo revisa.',
        `Empieza leyendo la conversación ${conversacionId} con la herramienta conversacion. Consulta lo que haga falta (pedidos del cliente con listar_pedidos o ver_pedido, precios con precio_efectivo o presupuestar_pedido, entregas, carga de trabajo) antes de contestar; no inventes datos, fechas ni precios.`,
        'Si el cliente pregunta por un pedido, mira su estado real y la fecha de entrega. Si pide precio, da el que le corresponde a él (precio_efectivo) y di que es con IVA. Si pide una fecha antes de la sugerida, avisa del suplemento de urgencia.',
        'Escribe como la lavandería: cercano, breve (dos o tres frases salvo que haga falta más), en castellano, con tuteo, sin emojis salvo que el cliente los use. Firma como Tinte y Burbuja sólo si la conversación es nueva.',
        'Si falta información para contestar bien, propón el mensaje más útil posible y, en una línea final entre corchetes, indica a la persona qué debe comprobar.',
        'Responde únicamente con el texto del mensaje (y la línea entre corchetes si procede), sin comillas ni explicaciones.',
    ].join('\n');

    const client = new Anthropic();
    const runner = client.beta.messages.toolRunner({
        model: MODELO,
        max_tokens: 4000,
        output_config: {effort: 'medium'},
        // Si un clasificador rechaza la petición, la API la reintenta sola en
        // otro modelo en vez de dejar al empleado sin sugerencia.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: sistema,
        tools,
        max_iterations: 10,
        messages: [{
            role: 'user',
            content: indicacion
                ? `Redacta la respuesta para la conversación ${conversacionId}. Lo que quiero transmitir: ${indicacion}`
                : `Redacta la respuesta para la conversación ${conversacionId}.`,
        }],
    });

    let final;
    try {
        final = await runner.done();
    } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new ErrorAsistente(503, 'La clave de la API de Claude no es válida.');
        if (e instanceof Anthropic.RateLimitError) throw new ErrorAsistente(429, 'El asistente está saturado; prueba en un momento.');
        if (e instanceof Anthropic.APIConnectionError) throw new ErrorAsistente(502, 'No se pudo conectar con la API de Claude.');
        throw e;
    }
    if (final?.stop_reason === 'refusal') {
        throw new ErrorAsistente(422, 'El asistente ha declinado redactar esta respuesta.');
    }
    const texto = (final?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!texto) throw new ErrorAsistente(502, 'El asistente no ha devuelto texto.');
    return {texto, herramientas: [...new Set(usadas)], modelo: final?.model || MODELO};
}
