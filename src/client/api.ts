const TOKEN_KEY = 'orbit_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore storage restriction
  }
}

export function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('/api/files/')) return trimmed;
  const token = getStoredToken();
  if (!token) return trimmed;
  if (trimmed.includes('token=')) return trimmed;
  const sep = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${sep}token=${encodeURIComponent(token)}`;
}

export class ApiError extends Error {
  status: number;
  data?: Record<string, unknown>;
  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const resp = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new ApiError(data.error || `İstek başarısız (${resp.status})`, resp.status, data as Record<string, unknown>);
  }
  return data;
}

export function uploadFilesWithProgress(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void
): Promise<{ files: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; url: string }> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    const token = getStoredToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed);
        } else {
          reject(new ApiError(parsed.error || 'Dosya yükleme hatası.', xhr.status));
        }
      } catch {
        reject(new ApiError('Sunucu yanıtı çözümlenemedi.', xhr.status));
      }
    };

    xhr.onerror = () => reject(new ApiError('Ağ hatası nedeniyle dosya yüklenemedi.', 0));
    xhr.send(formData);
  });
}
