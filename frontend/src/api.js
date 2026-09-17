const API_BASE = import.meta.env.VITE_API_BASE || '/api';
import UIkit from 'uikit';


async function request(path, token, opts = {}) {
    const headers = opts.headers || {};
    // Sólo se anuncia JSON cuando de verdad se manda algo. Fastify rechaza una
    // petición con Content-Type: application/json y cuerpo vacío ("Body cannot
    // be empty when content-type is set to 'application/json'"), que era lo que
    // hacía fallar siempre a las llamadas sin cuerpo: confirmar una impresión
    // (y provocar que la etiqueta se reimprimiera) o borrar por id.
    if (opts.body !== undefined && opts.body !== null) {
        headers['Content-Type'] = 'application/json';
    }
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
        // 403 por cuenta desactivada => también cerrar sesión
        if (res.status === 403 && /desactivad/i.test(err.error || '')) {
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

// Sin opciones, sólo los productos activos. archived: 'all' | 'only'.
export function fetchProducts(token, {archived} = {}) {
    return request(`/products${archived ? `?archived=${archived}` : ''}`, token);
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

// --- Ficha de producto ---
export function fetchProduct(token, id) {
    return request(`/products/${id}`, token);
}

export function fetchProductStats(token, id, {from, to} = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/products/${id}/stats?${params}`, token);
}

export function fetchProductLines(token, id, {from, to, page = 0, size = 20} = {}) {
    const params = new URLSearchParams({page: String(page), size: String(size)});
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/products/${id}/lines?${params}`, token);
}

export function fetchProductAgreedPrices(token, id) {
    return request(`/products/${id}/agreed-prices`, token);
}

export function fetchProductPriceHistory(token, id) {
    return request(`/products/${id}/price-history`, token);
}

// Sólo administración
export function fetchProductTimes(token, id, {from, to} = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/products/${id}/times?${params}`, token);
}

// --- Catálogo: actividad, categorías y acciones en bloque ---
export function fetchProductsSummary(token) {
    return request('/products/summary', token);
}

export function fetchProductCategories(token) {
    return request('/products/categories', token);
}

export function createProductCategory(token, name) {
    return request('/products/categories', token, {method: 'POST', body: JSON.stringify({name})});
}

export function updateProductCategory(token, id, name) {
    return request(`/products/categories/${id}`, token, {method: 'PUT', body: JSON.stringify({name})});
}

export function deleteProductCategory(token, id) {
    return request(`/products/categories/${id}`, token, {method: 'DELETE'});
}

// datos: {ids, campo: 'basePrice'|'bigClientPrice'|'ambos', modo: 'pct'|'importe', valor, redondeo, aplicar}
export function bulkProductPrices(token, datos) {
    return request('/products/bulk-prices', token, {method: 'POST', body: JSON.stringify(datos)});
}

export function archiveProducts(token, ids, archived = true) {
    return request('/products/bulk-archive', token, {method: 'POST', body: JSON.stringify({ids, archived})});
}


export function createOrder(token, order) {
    return request('/orders', token, {
        method: 'POST', body: JSON.stringify(order),
    });
}

// Calendario de entrega del POS: semanas completas desde `start` (lunes de
// esa semana) con días abiertos/cerrados, carga por día y fecha sugerida.
export function fetchDates(token, {start, weeks = 2} = {}) {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    params.set('weeks', String(weeks));
    return request(`/orders/delivery-dates?${params}`, token);
}

export function fetchOrders(token, {q, status, workerId, sortBy, sortOrder, startDate, endDate, page, size} = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status && status !== 'all') params.set('status', status);
    if (sortBy) params.set('sortBy', sortBy);
    if (sortOrder) params.set('sortOrder', sortOrder);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (workerId) params.set('workerId',parseInt(workerId,10));
    if (page !== undefined && page !== null) params.set('page', page);
    if (size !== undefined && size !== null) params.set('size', size);
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

export async function fetchUsers(token, {q = '', role, propiedad, page = 0, size = 50} = {}) {
    const params = new URLSearchParams({page, size});
    if (q) params.set('q', q);
    if (role) params.set('role', role);
    if (propiedad) params.set('propiedad', propiedad); // gran_cliente, facturacion_automatica, con_descuento, dias_fijos, sin_notificaciones, inactivos
    return request(`/users?${params}`, token, {})
}

// Entregas de un gran cliente por día de la semana y carga habitual (últimos meses)
export function fetchClientLoadProfile(token, id, meses = 3) {
    return request(`/users/${id}/load-profile?meses=${meses}`, token);
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

// ── Precios pactados por cliente (docs/precios-pactados.md) ──

// Todos los acuerdos del cliente: { hoy, precios: [...] }
export function fetchClientPrices(token, clientId) {
    return request(`/users/${clientId}/prices`, token);
}

// Precios pactados vigentes hoy: { [productId]: { id, price, validTo, note } }
export function fetchEffectivePrices(token, clientId) {
    return request(`/users/${clientId}/effective-prices`, token);
}

export function createClientPrice(token, clientId, data) {
    return request(`/users/${clientId}/prices`, token, {
        method: 'POST', body: JSON.stringify(data),
    });
}

export function updateClientPrice(token, clientId, priceId, data) {
    return request(`/users/${clientId}/prices/${priceId}`, token, {
        method: 'PUT', body: JSON.stringify(data),
    });
}

// Finaliza el acuerdo desde hoy, o lo elimina si aún no había empezado
export function endClientPrice(token, clientId, priceId) {
    return request(`/users/${clientId}/prices/${priceId}`, token, {method: 'DELETE'});
}

// Historial global de inicios de sesión (solo admin)
export function fetchLoginLogs(token, { page = 0, size = 50, success } = {}) {
    const params = new URLSearchParams({ page, size });
    if (success !== undefined && success !== null && success !== '') params.set('success', success);
    return request(`/users/login-logs/all?${params}`, token);
}

// Inicios de sesión de un usuario concreto
export function fetchUserLoginLogs(token, id) {
    return request(`/users/${id}/login-logs`, token);
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

// Resuelve un pedido por su número (orderNum, p.ej. "TPV/2025/0095").
// Usado por la página de búsqueda al escanear el QR de los tickets internos.
export function findOrderByNum(token, num) {
    return request(`/orders/find?num=${encodeURIComponent(num)}`, token);
}

// ── Cola de impresión ──
// Un dispositivo sin impresora encola el encargo; el puesto que la tiene lo
// reclama, lo imprime y confirma. Ver docs y sql/010.
export function encolarImpresion(token, {type, orderId = null, payload = null}) {
    return request('/print-jobs', token, {
        method: 'POST',
        body: JSON.stringify({type, orderId, payload}),
    });
}

export function reclamarImpresiones(token, {puesto, max = 5}) {
    return request('/print-jobs/claim', token, {
        method: 'POST',
        body: JSON.stringify({puesto, max}),
    });
}

export function marcarImpresionHecha(token, id) {
    return request(`/print-jobs/${id}/done`, token, {method: 'POST'});
}

export function marcarImpresionFallida(token, id, error) {
    return request(`/print-jobs/${id}/failed`, token, {
        method: 'POST',
        body: JSON.stringify({error: String(error || '').slice(0, 500)}),
    });
}

export function fetchColaImpresion(token, status) {
    return request(`/print-jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`, token);
}

// Historial económico de un pedido: cobros, devoluciones, facturas y
// anulaciones, con el saldo pendiente de cobrar o devolver.
export function fetchOrderHistory(token, orderId) {
    return request(`/orders/${orderId}/history`, token);
}

// Ajusta un pedido ya cobrado: añade productos/servicios y/o anula líneas
// cobradas por error. Emite los documentos fiscales que correspondan y liquida
// la diferencia. Ver docs/ajustes-pedidos-facturados.md.
export function adjustOrder(token, orderId, {add = [], void: toVoid = [], reason, settlementMethod = null}) {
    return request(`/orders/${orderId}/adjustments`, token, {
        method: 'POST',
        body: JSON.stringify({add, void: toVoid, reason, settlementMethod}),
    });
}

// Resuelve los pedidos activos de un cliente a partir del magic link impreso
// en el QR de su ticket. Devuelve { client, orders }.
export function findOrdersByPortalToken(token, magicToken) {
    return request(`/orders/find-by-portal-token?token=${encodeURIComponent(magicToken)}`, token);
}

// Obtiene el "magic link" del portal del cliente para un pedido (QR del ticket de cliente).
export function fetchOrderPortalLink(token, orderId) {
    return request(`/orders/${orderId}/portal-link`, token);
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

// Ingresos reales por fecha de cobro (Payment.createdAt), para reportar a gestoría.
// A diferencia de fetchOrders (que filtra por fecha de creación del pedido), esto
// refleja el dinero efectivamente cobrado dentro del rango, sin importar cuándo se
// creó el pedido o se emitió la factura.
export function fetchIncomeReport(token, { from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request(`/cash/income-report${qs ? `?${qs}` : ''}`, token, { method: 'GET' });
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

// Marca/desmarca un pago no-efectivo como conciliado (extracto banco/TPV)
export function reconcilePayment(token, paymentId, reconciled) {
    return request(`/cash/payments/${paymentId}/reconcile`, token, {
        method: 'PATCH',
        body: JSON.stringify({ reconciled }),
    });
}

// Concilia/desconcilia de golpe todos los pagos con tarjeta TPV del periodo de un cierre
export function reconcileClosureTpv(token, closureId, reconciled = true) {
    return request(`/cash/closures/${closureId}/reconcile-tpv`, token, {
        method: 'PATCH',
        body: JSON.stringify({ reconciled }),
    });
}

// Descarga el informe PDF de cierres de caja del periodo (un cierre por página)
export async function downloadClosuresReport(token, { from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const url = `${API_BASE}/cash/closures/report.pdf${params.toString() ? `?${params}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        if (res.status === 401) window.dispatchEvent(new CustomEvent('unauthorized'));
        throw new Error(`Error generando informe: ${res.status}`);
    }
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `cierres_${from || 'inicio'}_${to || 'fin'}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    return true;
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

// Domiciliación SEPA del cliente del portal
export function portalFetchSepa(token) {
    return request('/portal/sepa', token);
}

// Devuelve la URL de la página de Stripe donde firmar la orden
export function portalStartSepa(token) {
    return request('/portal/sepa/setup', token, { method: 'POST' });
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

// --- Campañas de marketing (WhatsApp) ---
export function fetchCampaignTemplates(token) {
    return request('/campaigns/templates', token);
}

export function previewCampaignAudience(token, filters) {
    return request('/campaigns/audience/preview', token, {
        method: 'POST',
        body: JSON.stringify({ filters }),
    });
}

export function fetchCampaigns(token) {
    return request('/campaigns', token);
}

export function fetchCampaign(token, id) {
    return request(`/campaigns/${id}`, token);
}

export function createCampaign(token, { name, templateName, language, filters }) {
    return request('/campaigns', token, {
        method: 'POST',
        body: JSON.stringify({ name, templateName, language, filters }),
    });
}

export function sendCampaign(token, id) {
    return request(`/campaigns/${id}/send`, token, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export function deleteCampaign(token, id) {
    return request(`/campaigns/${id}`, token, { method: 'DELETE' });
}

// --- Mensajería unificada ---
export function fetchConversations(token) {
    return request('/messages/conversations', token);
}

// Sin `before`: los últimos `size` mensajes; con `before` (ISO), los `size` anteriores a esa fecha
export function fetchMessages(token, { conversationId, size = 50, before } = {}) {
    const params = new URLSearchParams({ size });
    if (conversationId) params.set('conversationId', conversationId);
    if (before) params.set('before', before);
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

// Vincula la conversación de un número desconocido a un cliente existente
export function linkConversationClient(token, conversationId, clientId) {
    return request(`/messages/conversations/${conversationId}/link-client`, token, {
        method: 'POST',
        body: JSON.stringify({ clientId }),
    });
}

export async function sendMediaMessage(token, { file, conversationId, caption, channel }) {
    // Los campos van ANTES del archivo: el backend (@fastify/multipart) sólo
    // tiene disponibles los campos que preceden al fichero al leerlo.
    const formData = new FormData();
    formData.append('conversationId', String(conversationId));
    if (caption) formData.append('caption', caption);
    formData.append('channel', channel || 'whatsapp');
    formData.append('file', file);

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

export function updateWorkSchedule(token, weekly, { loadMax, urgencyPctPerDay, urgencyMaxPct } = {}) {
    const body = { weekly };
    if (loadMax !== undefined) body.loadMax = loadMax;
    if (urgencyPctPerDay !== undefined) body.urgencyPctPerDay = urgencyPctPerDay;
    if (urgencyMaxPct !== undefined) body.urgencyMaxPct = urgencyMaxPct;
    return request('/tracking/schedule', token, {
        method: 'PUT',
        body: JSON.stringify(body),
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

// Saldo de Stripe: disponible, pendiente, transferencias al banco y últimos movimientos (solo admin)
export function fetchStripeBalance(token) {
    return request('/stripe/balance', token);
}

// Cobros, devoluciones y comisiones incluidos en una transferencia al banco
export function fetchStripePayoutTransactions(token, payoutId) {
    return request(`/stripe/payouts/${payoutId}/transactions`, token);
}

// --- Domiciliación SEPA (solo admin, docs/domiciliacion-sepa.md) ---
// Estado de la orden del cliente, sus facturas por cobrar y sus adeudos
export function fetchClientSepa(token, clientId) {
    return request(`/stripe/sepa/clients/${clientId}`, token);
}

// Enlace a la página de Stripe donde el cliente firma la orden (caduca en 24 h)
export function createSepaMandateLink(token, clientId) {
    return request(`/stripe/sepa/clients/${clientId}/link`, token, { method: 'POST' });
}

export function cancelSepaMandate(token, clientId) {
    return request(`/stripe/sepa/clients/${clientId}/mandate`, token, { method: 'DELETE' });
}

// Lanza el adeudo de una factura contra la orden activa del cliente
export function chargeInvoiceSepa(token, invoiceId) {
    return request(`/stripe/sepa/invoices/${invoiceId}/charge`, token, { method: 'POST' });
}

// Adeudos recientes; attention = sólo rechazados o devueltos sin resolver
export function fetchSepaDebits(token, { attention = false } = {}) {
    return request(`/stripe/sepa/debits${attention ? '?attention=1' : ''}`, token);
}

// Listado simple de facturas emitidas en el rango (por número), para exportar a gestoría
export function fetchInvoicesReport(token, { from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request(`/invoices/report${qs ? `?${qs}` : ''}`, token, { method: 'GET' });
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
