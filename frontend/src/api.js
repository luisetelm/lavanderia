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
