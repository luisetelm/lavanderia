/**
 * Google Business Profile API service para gestión de reseñas.
 *
 * Env vars:
 *   GOOGLE_CLIENT_ID       - OAuth2 Client ID
 *   GOOGLE_CLIENT_SECRET   - OAuth2 Client Secret
 *   GOOGLE_REDIRECT_URI    - OAuth2 redirect (e.g. https://app.tinteyburbuja.com/api/google/callback)
 *   GOOGLE_ACCOUNT_ID      - Google Business account ID
 *   GOOGLE_LOCATION_ID     - Google Business location ID
 *
 * Los tokens OAuth2 se guardan en la tabla AppSettings (key: google_access_token, google_refresh_token).
 */

const SCOPES = [
    'https://www.googleapis.com/auth/business.manage',
];

export function getAuthUrl() {
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code',
            code,
        }),
    });
    return res.json();
}

export async function refreshAccessToken(refreshToken) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });
    return res.json();
}

// La cuenta y el local de Perfil de Empresa se eligen desde la página de
// reseñas una vez conectado Google y se guardan en AppSettings; las variables
// de entorno GOOGLE_ACCOUNT_ID / GOOGLE_LOCATION_ID quedan como respaldo.
const CLAVE_CUENTA = 'google_account_id';
const CLAVE_LOCAL = 'google_location_id';

async function leerAjuste(prisma, key) {
    const fila = await prisma.appSettings.findUnique({ where: { key } });
    return fila?.value || null;
}

async function guardarAjuste(prisma, key, value) {
    await prisma.appSettings.upsert({ where: { key }, update: { value }, create: { key, value } });
}

const idValido = (v) => !!v && v !== '...';

/** Cuenta y local configurados (AppSettings, si no la variable de entorno). */
export async function leerLocal(prisma) {
    const accountId = (await leerAjuste(prisma, CLAVE_CUENTA)) || process.env.GOOGLE_ACCOUNT_ID;
    const locationId = (await leerAjuste(prisma, CLAVE_LOCAL)) || process.env.GOOGLE_LOCATION_ID;
    return {
        accountId: idValido(accountId) ? accountId : null,
        locationId: idValido(locationId) ? locationId : null,
    };
}

export async function guardarLocal(prisma, { accountId, locationId }) {
    await guardarAjuste(prisma, CLAVE_CUENTA, String(accountId));
    await guardarAjuste(prisma, CLAVE_LOCAL, String(locationId));
    return { accountId: String(accountId), locationId: String(locationId) };
}

async function getAccessToken(prisma) {
    const tokenSetting = await prisma.appSettings.findUnique({ where: { key: 'google_access_token' } });
    const refreshSetting = await prisma.appSettings.findUnique({ where: { key: 'google_refresh_token' } });

    if (!tokenSetting?.value || !refreshSetting?.value) {
        throw new Error('Google no está conectado. Configúralo primero.');
    }

    // Intentar refrescar siempre (simple approach)
    const result = await refreshAccessToken(refreshSetting.value);

    if (result.access_token) {
        await prisma.appSettings.upsert({
            where: { key: 'google_access_token' },
            update: { value: result.access_token },
            create: { key: 'google_access_token', value: result.access_token },
        });
        return result.access_token;
    }

    return tokenSetting.value;
}

async function leerJson(res, contexto) {
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `${contexto}: ${res.status}`);
    }
    return res.json();
}

/**
 * Cuentas de Perfil de Empresa a las que llega el usuario conectado, con sus
 * locales, para elegir cuál gestiona la aplicación. Usa las APIs públicas de
 * cuentas e información de negocio (no hacen falta permisos especiales).
 * @returns {Promise<Array<{accountId: string, accountName: string, locations: Array<{locationId: string, title: string, address: string}>}>>}
 */
export async function listarLocales(prisma) {
    const accessToken = await getAccessToken(prisma);
    const headers = { Authorization: `Bearer ${accessToken}` };

    const cuentas = await leerJson(
        await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers }),
        'Error listando cuentas de Google',
    );

    const resultado = [];
    for (const acc of cuentas.accounts || []) {
        const accountId = String(acc.name || '').replace('accounts/', '');
        const params = new URLSearchParams({ readMask: 'name,title,storefrontAddress', pageSize: '100' });
        const locales = await leerJson(
            await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?${params}`, { headers }),
            `Error listando locales de la cuenta ${acc.accountName || accountId}`,
        );
        resultado.push({
            accountId,
            accountName: acc.accountName || accountId,
            locations: (locales.locations || []).map(l => ({
                locationId: String(l.name || '').replace('locations/', ''),
                title: l.title || '',
                address: [
                    ...(l.storefrontAddress?.addressLines || []),
                    l.storefrontAddress?.locality,
                ].filter(Boolean).join(', '),
            })),
        });
    }
    return resultado;
}

async function localConfigurado(prisma) {
    const { accountId, locationId } = await leerLocal(prisma);
    if (!accountId || !locationId) {
        throw new Error('Falta elegir el local de Perfil de Empresa. Hazlo desde la página de reseñas.');
    }
    return { accountId, locationId };
}

export async function fetchReviews(prisma) {
    const accessToken = await getAccessToken(prisma);
    const { accountId, locationId } = await localConfigurado(prisma);

    const url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Google API error: ${res.status}`);
    }

    const data = await res.json();
    return data.reviews || [];
}

export async function replyToReview(prisma, reviewId, replyText) {
    const accessToken = await getAccessToken(prisma);
    const { accountId, locationId } = await localConfigurado(prisma);

    const url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}/reply`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: replyText }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Error respondiendo reseña: ${res.status}`);
    }

    return res.json();
}
