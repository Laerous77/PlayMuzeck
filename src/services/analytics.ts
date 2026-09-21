const SESSION_KEY = 'muzeck_analytics_session_v1';

let memorySession: string | null = null;
function sessionId() {
  // localStorage bisa melempar error (mode privat / kuota / diblokir) -> jangan sampai crash.
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return (memorySession ||= `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }
}

export function trackEvent(eventType: string, payload: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    eventType,
    sessionId: sessionId(),
    payload,
  });
  fetch('/api/public/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

async function postJson(url: string, payload: object): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, sessionId: sessionId() }),
    });
    if (!res.ok) console.error(`[analytics] ${url} -> HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error(`[analytics] ${url} gagal:`, err);
    return false;
  }
}

export const submitInquiry = (payload: object) => postJson('/api/public/inquiries', payload);
export const submitOrder = (payload: object) => postJson('/api/public/orders', payload);

export async function submitUser(payload: object): Promise<boolean> {
  try {
    // PENTING: rute backend yang benar-benar ada di server/index.ts adalah
    // '/api/users' (bukan '/api/public/users'). Sebelumnya endpoint ini 404
    // secara diam-diam setiap kali user login, sehingga baris user TIDAK
    // PERNAH masuk ke tabel `users` di PostgreSQL. Akibatnya checkout gagal
    // total karena user_collections.user_email punya FOREIGN KEY ke
    // users(email) yang belum ada.
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.error('[submitUser] Gagal mendaftarkan user ke database:', err);
    return false;
  }
}
