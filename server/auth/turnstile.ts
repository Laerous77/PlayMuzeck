// server/auth/turnstile.ts
// Verifikasi Cloudflare Turnstile (CAPTCHA gratis) untuk form yang memicu pengiriman email.
// Aktif otomatis kalau TURNSTILE_SECRET diisi di server/.env (dan VITE_TURNSTILE_SITE_KEY di frontend).
// Kalau kosong, pemeriksaan dilewati supaya deploy lama tidak rusak (peringatan tercetak saat server start).

const SECRET = process.env.TURNSTILE_SECRET || '';

export const turnstileEnabled = () => Boolean(process.env.TURNSTILE_SECRET);

export async function verifyTurnstile(token: unknown, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET || SECRET;
  if (!secret) return true;
  if (typeof token !== 'string' || token.length < 10 || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    const j: any = await r.json().catch(() => null);
    return Boolean(j?.success);
  } catch (e) {
    console.error('[turnstile] gagal verifikasi:', e);
    return false;
  }
}
