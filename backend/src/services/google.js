/**
 * Google Business Profile API service para gestión de reseñas.
 *
 * Env vars:
 *   GOOGLE_CLIENT_ID       - OAuth2 Client ID
 *   GOOGLE_CLIENT_SECRET   - OAuth2 Client Secret
 *   GOOGLE_REDIRECT_URI    - OAuth2 redirect (e.g. https://app.tinteyburbuja.es/api/google/callback)
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

export async function fetchReviews(prisma) {
    const accessToken = await getAccessToken(prisma);
    const accountId = process.env.GOOGLE_ACCOUNT_ID;
    const locationId = process.env.GOOGLE_LOCATION_ID;

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
    const accountId = process.env.GOOGLE_ACCOUNT_ID;
    const locationId = process.env.GOOGLE_LOCATION_ID;

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
