const API_BASE = '/api';
function getToken() {
    return localStorage.getItem('stas_token');
}
export function setToken(token) {
    localStorage.setItem('stas_token', token);
}
export function clearToken() {
    localStorage.removeItem('stas_token');
}
async function request(path, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
    });
    if (res.status === 401) {
        clearToken();
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
}
// Auth
export const auth = {
    loginUrl: () => `${API_BASE}/auth/github`,
    me: () => request('/auth/me'),
    logout: () => request('/auth/logout', { method: 'POST' }),
};
// Runs
export const runs = {
    list: (params) => {
        const qs = new URLSearchParams();
        if (params?.page)
            qs.set('page', String(params.page));
        if (params?.perPage)
            qs.set('perPage', String(params.perPage));
        if (params?.status)
            qs.set('status', params.status);
        if (params?.repo)
            qs.set('repo', params.repo);
        if (params?.from)
            qs.set('from', params.from);
        if (params?.to)
            qs.set('to', params.to);
        const query = qs.toString();
        return request(`/runs${query ? `?${query}` : ''}`);
    },
    get: (id) => request(`/runs/${id}`),
};
// Repos
export const repos = {
    list: () => request('/repos'),
    connect: (body) => request('/repos', { method: 'POST', body: JSON.stringify(body) }),
    disconnect: (id) => request(`/repos/${id}`, { method: 'DELETE' }),
};
// Stats
export const stats = {
    get: () => request('/stats'),
};
// Audit
export const audit = {
    list: (params) => {
        const qs = new URLSearchParams();
        if (params?.page)
            qs.set('page', String(params.page));
        if (params?.perPage)
            qs.set('perPage', String(params.perPage));
        const query = qs.toString();
        return request(`/audit${query ? `?${query}` : ''}`);
    },
};
// Settings
export const settings = {
    get: () => request('/settings'),
    update: (body) => request('/settings', { method: 'PUT', body: JSON.stringify(body) }),
};
//# sourceMappingURL=client.js.map