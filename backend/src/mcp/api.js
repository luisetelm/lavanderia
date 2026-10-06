// Cliente HTTP de la API de la lavandería para el conector MCP.
//
// El conector nunca toca la base de datos: todo pasa por /api con el token
// del usuario, así se aplican las mismas reglas (precios pactados, avisos,
// historial, permisos) que desde el TPV.

export class ApiError extends Error {
    constructor(status, mensaje, cuerpo) {
        super(mensaje);
        this.name = 'ApiError';
        this.status = status;
        this.cuerpo = cuerpo;
    }
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl   p. ej. https://app.tinteyburbuja.com/api
 * @param {() => Promise<string>} opts.obtenerToken  devuelve un JWT válido
 * @param {() => Promise<string>} [opts.renovarToken] se llama tras un 401 para reintentar una vez
 */
export function crearApi({baseUrl, obtenerToken, renovarToken}) {
    const base = String(baseUrl).replace(/\/+$/, '');

    async function llamar(metodo, ruta, {query, body} = {}, reintento = false) {
        const url = new URL(base + ruta);
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                if (v === undefined || v === null || v === '') continue;
                url.searchParams.set(k, String(v));
            }
        }
        const token = await obtenerToken();
        const res = await fetch(url, {
            method: metodo,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
                Accept: 'application/json',
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const texto = await res.text();
        let datos = null;
        try { datos = texto ? JSON.parse(texto) : null; } catch { datos = {raw: texto}; }

        if (res.status === 401 && renovarToken && !reintento) {
            await renovarToken();
            return llamar(metodo, ruta, {query, body}, true);
        }
        if (!res.ok) {
            const mensaje = datos?.error || datos?.message || `HTTP ${res.status} en ${metodo} ${ruta}`;
            throw new ApiError(res.status, mensaje, datos);
        }
        return datos;
    }

    return {
        get: (ruta, query) => llamar('GET', ruta, {query}),
        post: (ruta, body) => llamar('POST', ruta, {body: body ?? {}}),
        put: (ruta, body) => llamar('PUT', ruta, {body: body ?? {}}),
        patch: (ruta, body) => llamar('PATCH', ruta, {body: body ?? {}}),
        del: (ruta) => llamar('DELETE', ruta),
    };
}

/**
 * Inicia sesión en la API con email y contraseña.
 * @returns {Promise<{token: string, user: object}>}
 */
export async function iniciarSesion(baseUrl, email, password) {
    const res = await fetch(String(baseUrl).replace(/\/+$/, '') + '/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, password}),
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, datos.error || 'No se pudo iniciar sesión', datos);
    return datos;
}

/** Payload de un JWT sin verificar la firma (sólo para saber quién es el usuario). */
export function decodificarJwt(token) {
    try {
        const parte = String(token).split('.')[1];
        return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}
