import {worker} from "globals";

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
import UIkit from 'uikit';


async function request(path, token, opts = {}) {
    const headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, {
        ...opts, headers,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) {
            // Emitir un evento personalizado cuando se recibe un 401
            window.dispatchEvent(new CustomEvent('unauthorized'));
        }
        throw {status: res.status, ...err};
    }

    return res.json();
}

export function login(email, password) {
    return request('/auth/login', null, {
        method: 'POST', body: JSON.stringify({email, password}),
    });
}

export function fetchMe(token) {
    return request('/auth/me', token);
}

export function forgotPassword(email) {
    return request('/auth/forgot-password', null, {
        method: 'POST',
        body: JSON.stringify({ email }),
    });
}

export function resetPassword(token, password) {
    return request('/auth/reset-password', null, {
        method: 'POST',
        body: JSON.stringify({ token, password }),
    });
}

export function register(data) {
    return request('/auth/register', null, {
        method: 'POST', body: JSON.stringify(data),
    });
}

export function fetchProducts(token) {
    return request('/products', token);
}

export function createProduct(token, product) {
    return request('/products', token, {
        method: 'POST', body: JSON.stringify(product),
    });
}

export function updateProduct(token, id, data) {
    return request(`/products/${id}`, token, {
        method: 'PUT', body: JSON.stringify(data),
    });
}

export function importProducts(token, formData) {
    return request(`/csv/products`, token, {
        method: 'POST', body: formData
    });
}


export function createOrder(token, order) {
    return request('/orders', token, {
        method: 'POST', body: JSON.stringify(order),
    });
}

export function fetchDates(page, token) {
    return request(`/orders/delivery-dates?page=${page}`, token, {
        method: 'GET',
    });
}

export function fetchOrders(token, {q, status, workerId, sortBy, sortOrder, startDate, endDate} = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status && status !== 'all') params.set('status', status);
    if (sortBy) params.set('sortBy', sortBy);
    if (sortOrder) params.set('sortOrder', sortOrder);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (workerId) params.set('workerId',parseInt(workerId,10));
    const qs = params.toString();
    return request(`/orders${qs ? `?${qs}` : ''}`, token, {method: 'GET'});
}

export function facturarPedido(token, orderId) {
    return request(`/orders/${orderId}/invoice`, token, {
        method: 'POST', body: JSON.stringify({}),
    });
}

export async function updateOrder(token, taskId, data) {
    const res = await fetch(`/api/orders/${taskId}`, {
        method: 'PATCH', headers: {
            Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        }, body: JSON.stringify(data),
    });
    if (!res.ok) throw await res.json();

    // Mostrar notificación de éxito
    UIkit.notification({
        message: 'Cambios guardados correctamente',
        status: 'default',
        pos: 'top-right',
        timeout: 3000
    });

    return res.json();
}

export async function updateOrderLine(token, lineId, data) {
    const res = await fetch(`/api/orders/lines/${lineId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw await res.json();

    return res.json();
}

export async function addLineAnnotation(token, lineId, data) {
    const res = await fetch(`/api/orders/lines/${lineId}/annotations`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw await res.json();
    return res.json();
}

export async function fetchUsers(token, {q = '', role, page = 0, size = 50} = {}) {
    const params = new URLSearchParams({page, size});
    if (q) params.set('q', q);
    if (role) params.set('role', role);
    return request(`/users?${params}`, token, {})
}

export function fetchUser(token, id) {
    return request(`/users/${id}`, token);
}

export function createUser(token, data) {
    return request('/users', token, {
        method: 'POST', body: JSON.stringify(data),
    });
}

export function updateUser(token, id, data) {
    return request(`/users/${id}`, token, {
        method: 'PUT', body: JSON.stringify(data),
    });
}

export function payWithCard(token, orderId) {
    return request(`/orders/${orderId}/pay`, token, {
        method: 'POST', body: JSON.stringify({method: 'card'}),
    });
}

export function payWithCash(token, orderId, receivedAmount) {
    return request(`/orders/${orderId}/pay`, token, {
        method: 'POST', body: JSON.stringify({
            method: 'cash', receivedAmount: parseFloat(receivedAmount),
        }),
    });
}

// helper para refrescar un pedido existente (asume que tu backend tiene GET /orders/:id)
export function fetchOrder(token, orderId) {

    return request(`/orders/${orderId}`, token);
}

// Nuevas funciones de API para caja.
// javascript
// Caja: usar el helper request() y rutas relativas a API_BASE

export function fetchUnclosedCashMovements(token) {
    return request('/cash/movements/unclosed', token, { method: 'GET' });
}

export function fetchUnclosedCashSummary(token) {
    return request('/cash/unclosed-summary', token, { method: 'GET' });
}

export function fetchLastClosure(token) {
    return request('/cash/last-closure', token, { method: 'GET' });
}

export function createCashMovement(token, payload) {
    return request('/cash/movements', token, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export function updateCashMovement(token, id, payload) {
    return request(`/cash/movements/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
}

export function deleteCashMovement(token, id) {
    return request(`/cash/movements/${id}`, token, {
        method: 'DELETE',
        body: JSON.stringify({}),
    });
}


export function fetchCashClosures(token, { from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request(`/cash/closures${qs ? `?${qs}` : ''}`, token);
}

export function fetchClosureMovements(token, closureId) {
    return request(`/cash/closures/${closureId}/movements`, token);
}

export function closeCashRegister(token, { countedAmount, notes, user }) {
    return request('/cash/close', token, {
        method: 'POST',
        body: JSON.stringify({ countedAmount, notes, user }),
    });
}

export function retryNotification(token, id, phone) {
    return request(`/notifications/${id}/retry`, token, {
        method: 'POST',
        body: JSON.stringify({id, phone}),
    });
}

export function collectInvoice(token, invoiceId, { method, note } = {}) {
    return request(`/invoices/${invoiceId}/collect`, token, {
        method: 'POST',
        body: JSON.stringify({ method, note }),
    });
}

export function collectInvoicesBatch(token, invoiceIds, method) {
    return request('/invoices/collect-batch', token, {
        method: 'POST',
        body: JSON.stringify({ invoiceIds, method }),
    });
}

export function fetchUnpaidInvoices(token, { q = '', page = 0, size = 50 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('page', page);
    params.set('size', size);
    return request(`/invoices/unpaid?${params}`, token);
}

// --- Portal de cliente ---
export function portalRequestAccess(phone) {
    return request('/portal/request-access', null, {
        method: 'POST',
        body: JSON.stringify({ phone }),
    });
}

export function portalVerifyToken(magicToken) {
    return request(`/portal/verify?token=${encodeURIComponent(magicToken)}`, null);
}

export function portalFetchMe(token) {
    return request('/portal/me', token);
}

export function portalUpdatePreferences(token, { notifyChannel }) {
    return request('/portal/preferences', token, {
        method: 'PATCH',
        body: JSON.stringify({ notifyChannel }),
    });
}

export function portalFetchOrders(token) {
    return request('/portal/orders', token);
}

export function portalFetchOrder(token, id) {
    return request(`/portal/orders/${id}`, token);
}

export function portalFetchInvoices(token) {
    return request('/portal/invoices', token);
}

export function portalPay(token, { type, id }) {
    return request('/portal/pay', token, {
        method: 'POST',
        body: JSON.stringify({ type, id }),
    });
}

// --- WhatsApp ---
export function sendWhatsAppMessage(token, { phone, content, templateName, templateComponents, orderId, clientId }) {
    return request('/whatsapp/send', token, {
        method: 'POST',
        body: JSON.stringify({ phone, content, templateName, templateComponents, orderId, clientId }),
    });
}

export function fetchWhatsAppTemplates(token) {
    return request('/whatsapp/templates', token);
}

export function setupDefaultTemplates(token) {
    return request('/whatsapp/templates/setup-defaults', token, { method: 'POST', body: JSON.stringify({}) });
}

export function fetchWhatsAppMessages(token, { clientId, page = 0, size = 50 } = {}) {
    const params = new URLSearchParams({ page, size });
    if (clientId) params.set('clientId', clientId);
    return request(`/whatsapp/messages?${params}`, token);
}

// --- Mensajería unificada ---
export function fetchConversations(token) {
    return request('/messages/conversations', token);
}

export function fetchMessages(token, { conversationId, page = 0, size = 50 } = {}) {
    const params = new URLSearchParams({ page, size });
    if (conversationId) params.set('conversationId', conversationId);
    return request(`/messages?${params}`, token);
}

export function sendMessage(token, { conversationId, channel, content, orderId }) {
    return request('/messages/send', token, {
        method: 'POST',
        body: JSON.stringify({ conversationId, channel, content, orderId }),
    });
}

export function markConversationAsRead(token, conversationId) {
    return request(`/messages/read/${conversationId}`, token, { method: 'POST', body: JSON.stringify({}) });
}

export async function sendMediaMessage(token, { file, conversationId, caption, channel }) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversationId', String(conversationId));
    if (caption) formData.append('caption', caption);
    formData.append('channel', channel || 'whatsapp');

    const res = await fetch(`${API_BASE}/messages/send-media`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw data;
    return data;
}

// --- Google Reviews ---
export function fetchGoogleStatus(token) {
    return request('/google/status', token);
}

// --- Dashboard ---
export function fetchDashboard(token) {
    return request('/dashboard', token);
}

export function fetchWorkerPerformance(token, { from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request(`/dashboard/worker-performance${qs ? `?${qs}` : ''}`, token);
}

export function fetchTopProducts(token, { from, to, limit, groupBy } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (limit) params.set('limit', limit);
    if (groupBy) params.set('groupBy', groupBy);
    const qs = params.toString();
    return request(`/dashboard/top-products${qs ? `?${qs}` : ''}`, token);
}

// --- Tracking ---
export function fetchTrackingBoard(token) {
    return request('/tracking/board', token);
}

export function fetchOrderTracking(token, orderId) {
    return request(`/tracking/order/${orderId}`, token);
}

export function updateStepStatus(token, stepId, data) {
    return request(`/tracking/steps/${stepId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

export function undoStep(token, stepId) {
    return request(`/tracking/steps/${stepId}/undo`, token, {
        method: 'PATCH',
        body: JSON.stringify({}),
    });
}

export function batchCompleteSteps(token, stepIds, action = 'complete') {
    return request('/tracking/steps/batch-complete', token, {
        method: 'POST',
        body: JSON.stringify({ stepIds, action }),
    });
}

// --- Itinerarios ---
export function fetchItineraries(token) {
    return request('/itineraries', token);
}

export function fetchItinerary(token, id) {
    return request(`/itineraries/${id}`, token);
}

export function createItinerary(token, data) {
    return request('/itineraries', token, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export function updateItinerary(token, id, data) {
    return request(`/itineraries/${id}`, token, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
}

export function deleteItinerary(token, id) {
    return request(`/itineraries/${id}`, token, {
        method: 'DELETE',
        body: JSON.stringify({}),
    });
}

export function fetchItineraryResources(token) {
    return request('/itineraries/resources/list', token);
}

export function fetchWorkSchedule(token) {
    return request('/tracking/schedule', token);
}

export function updateWorkSchedule(token, weekly) {
    return request('/tracking/schedule', token, {
        method: 'PUT',
        body: JSON.stringify({ weekly }),
    });
}

export function addScheduleException(token, data) {
    return request('/tracking/schedule/exceptions', token, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export function deleteScheduleException(token, id) {
    return request(`/tracking/schedule/exceptions/${id}`, token, {
        method: 'DELETE',
        body: JSON.stringify({}),
    });
}

export function fetchTrackingResources(token) {
    return request('/tracking/resources', token);
}

export function createTrackingResource(token, data) {
    return request('/tracking/resources', token, {
        method: 'POST', body: JSON.stringify(data),
    });
}

export function updateTrackingResource(token, id, data) {
    return request(`/tracking/resources/${id}`, token, {
        method: 'PUT', body: JSON.stringify(data),
    });
}

export function deleteTrackingResource(token, id) {
    return request(`/tracking/resources/${id}`, token, { method: 'DELETE' });
}

export function recalculateTracking(token, orderId) {
    return request(`/orders/${orderId}/recalculate-tracking`, token, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export function fetchOrderEstimate(token, orderId) {
    return request(`/tracking/estimate/${orderId}`, token);
}

export function fetchGoogleReviews(token) {
    return request('/google/reviews', token);
}

export function replyGoogleReview(token, reviewId, comment) {
    return request(`/google/reviews/${reviewId}/reply`, token, {
        method: 'POST',
        body: JSON.stringify({ comment }),
    });
}

export function createStripeCheckout(token, { type, id }) {
    return request('/stripe/checkout', token, {
        method: 'POST',
        body: JSON.stringify({ type, id }),
    });
}

export function getPaymentLink(token, type, id) {
    return request(`/stripe/payment-link/${type}/${id}`, token);
}

export function createInvoice(token, { orderIds, type = 'normal', invoiceData = {} }) {
    return request('/invoices', token, {
        method: 'POST',
        body: JSON.stringify({ orderIds, type, invoiceData })
    });
}

export async function downloadInvoicePDF(token, invoiceId) {
    const filename = `factura_${invoiceId}.pdf`;
    const url = `${API_BASE}/invoices/pdf/${filename}`;

    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            if (res.status === 401) {
                window.dispatchEvent(new CustomEvent('unauthorized'));
            }
            throw new Error(`Error descargando factura: ${res.status}`);
        }

        // Convertir la respuesta a blob
        const blob = await res.blob();

        // Crear un enlace temporal y descargarlo
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);

        // Mostrar notificación de éxito
        UIkit.notification({
            message: 'Factura descargada correctamente',
            status: 'success',
            pos: 'top-right',
            timeout: 3000
        });

        return true;
    } catch (error) {
        console.error('Error descargando factura:', error);
        UIkit.notification({
            message: 'Error al descargar la factura',
            status: 'danger',
            pos: 'top-right',
            timeout: 3000
        });
        throw error;
    }
}
