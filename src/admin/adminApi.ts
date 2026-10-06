// src/admin/adminApi.ts
export async function publicFetch<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(endpoint, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function adminFetch<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(endpoint, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Admin HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
