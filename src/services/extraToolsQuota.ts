// src/services/extraToolsQuota.ts
// Kuota gratis harian per alat untuk AudioExtraTools (disimpan di localStorage, sama seperti Audio Tools bawaan).
// Catatan jujur: localStorage bisa dihapus pengguna, jadi ini pembatas "sopan", bukan keamanan.
const DAILY_FREE = 2;
const PREFIX = 'pm_extra_quota_';

const dayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const store = (): Store | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

export function remainingExtraQuota(toolId: string, unlimited = false, s: Store | null = store()): number {
  if (unlimited) return Infinity;
  if (!s) return DAILY_FREE; // localStorage tidak tersedia: jangan menghalangi pengguna
  try {
    const raw = s.getItem(`${PREFIX}${dayKey()}_${toolId}`);
    const used = raw ? Math.max(0, Math.floor(Number(raw)) || 0) : 0;
    return Math.max(0, DAILY_FREE - used);
  } catch { return DAILY_FREE; }
}

/** Pakai satu jatah. Mengembalikan false bila jatah hari ini habis. */
export function consumeExtraQuota(toolId: string, unlimited = false, s: Store | null = store()): boolean {
  if (unlimited) return true;
  if (!s) return true;
  try {
    const today = dayKey();
    // bersihkan kunci hari-hari sebelumnya
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${today}_`)) s.removeItem(k);
    }
    const key = `${PREFIX}${today}_${toolId}`;
    const used = Math.max(0, Math.floor(Number(s.getItem(key))) || 0);
    if (used >= DAILY_FREE) return false;
    s.setItem(key, String(used + 1));
    return true;
  } catch { return true; }
}
