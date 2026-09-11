const BASE = '/api';

const STORAGE = {
  access: 'fin.accessToken',
  refresh: 'fin.refreshToken',
  user: 'fin.user',
};

export const tokens = {
  get access() {
    return localStorage.getItem(STORAGE.access);
  },
  get refresh() {
    return localStorage.getItem(STORAGE.refresh);
  },
  save({ accessToken, refreshToken, user }) {
    if (accessToken) localStorage.setItem(STORAGE.access, accessToken);
    if (refreshToken) localStorage.setItem(STORAGE.refresh, refreshToken);
    if (user) localStorage.setItem(STORAGE.user, JSON.stringify(user));
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.user) ?? 'null');
    } catch {
      return null;
    }
  },
  clear() {
    Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Quando o token expira, várias telas falham juntas — uma única renovação atende todas. */
let refreshing = null;

async function refreshSession() {
  const refreshToken = tokens.refresh;
  if (!refreshToken) throw new ApiError('Sessão expirada', 401);

  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    tokens.clear();
    throw new ApiError('Sessão expirada', 401);
  }

  const data = await res.json();
  tokens.save(data);
  return data.accessToken;
}

async function request(method, path, { body, query, raw = false, formData } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const send = async (token) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    let payload;
    if (formData) {
      payload = formData; // o browser define o boundary do multipart
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    return fetch(url, { method, headers, body: payload });
  };

  let res = await send(tokens.access);

  // 401 pode ser token expirado: renova uma vez e repete a chamada.
  if (res.status === 401 && tokens.refresh) {
    try {
      refreshing = refreshing ?? refreshSession();
      const newToken = await refreshing;
      refreshing = null;
      res = await send(newToken);
    } catch (err) {
      refreshing = null;
      tokens.clear();
      window.dispatchEvent(new CustomEvent('auth:expired'));
      throw err;
    }
  }

  if (raw) {
    if (!res.ok) throw new ApiError('Falha ao gerar o arquivo', res.status);
    return res.blob();
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'Resposta inválida do servidor' };
  }

  if (!res.ok) {
    // `details` traz os erros de validação campo a campo (Zod).
    const message = data.details?.length
      ? `${data.error}: ${data.details.map((d) => `${d.campo} — ${d.erro}`).join('; ')}`
      : (data.error ?? `Erro ${res.status}`);
    throw new ApiError(message, res.status, data.details);
  }

  return data;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  del: (path, query) => request('DELETE', path, { query }),
  upload: (path, formData) => request('POST', path, { formData }),
  blob: (path, query) => request('GET', path, { query, raw: true }),
};

/** Dispara o download de um arquivo gerado pela API. */
export async function download(path, query, filename) {
  const blob = await api.blob(path, query);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
