// server/auth/emailCheck.ts
// Memastikan domain email benar-benar bisa menerima pesan (punya MX) dan bukan email sekali pakai.
// Dipakai di pendaftaran, form custom audio, dan pembuatan pengguna oleh admin.
import dns from 'node:dns/promises';

// Tambah sesuai kebutuhan, atau ganti dengan paket `disposable-email-domains`.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', '10minutemail.net',
  'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com',
  'throwawaymail.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com',
  'emailondeck.com', 'spamgourmet.com', 'tempail.com', 'burnermail.io', 'mohmal.com', 'moakt.com',
]);

const cache = new Map<string, { ok: boolean; at: number }>();
const CACHE_MS = 60 * 60_000;

/** true = domain punya MX & bukan email sekali pakai. Gangguan DNS sementara TIDAK memblokir pengguna asli. */
export async function isDeliverableEmail(email: string): Promise<boolean> {
  const domain = String(email || '').split('@')[1]?.trim().toLowerCase();
  if (!domain || domain.length > 253 || !domain.includes('.')) return false;
  if (DISPOSABLE.has(domain)) return false;

  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;

  let ok: boolean;
  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 3000)),
    ]);
    ok = mx.some((r) => r.exchange && r.exchange !== '.');
  } catch (e: any) {
    // Domain jelas tidak ada / tidak punya MX -> tolak. Error sementara (timeout, SERVFAIL) -> izinkan.
    ok = !['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(e?.code);
    if (!ok) cache.set(domain, { ok, at: Date.now() });
    return ok;
  }
  cache.set(domain, { ok, at: Date.now() });
  if (cache.size > 5000) cache.clear();
  return ok;
}
