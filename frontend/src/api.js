const API_BASE = import.meta.env.VITE_API_BASE || '/api';


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
export function fetchOrders(token, {q, status} = {}) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status && status !== 'all') params.set('status', status);
    const qs = params.toString();
    return request(`/orders${qs ? `?${qs}` : ''}`, token, {method: 'GET'});
}


export async function updateOrder(token, taskId, data) {
    const res = await fetch(`/api/orders/${taskId}`, {
        method: 'PATCH', headers: {
            Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        }, body: JSON.stringify(data),
    });
    if (!res.ok) throw await res.json();
    return res.json();
}

export async function fetchUsers(token, {q = '', page = 0, size = 50} = {}) {
    const params = new URLSearchParams({page, size});
    if (q) params.set('q', q);
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


