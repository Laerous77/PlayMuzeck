// src/services/extraToolsQuota.ts
// PENGHITUNG CADANGAN (lokal). Kuota resmi dicatat di server: lihat services/toolQuota.ts dan server/toolQuotaCore.ts.
// File ini hanya dipakai bila server tidak terjangkau, supaya alat tetap terbatas 2x per alat per hari (tanggal lokal).
// Catatan jujur: data di localStorage bisa dihapus pengguna, jadi ini bukan pembatas yang kuat.
// Bila localStorage tidak tersedia (mode privat dsb.), dipakai penyimpanan memori selama halaman terbuka,
// supaya batas 2x tetap berlaku dan tidak jadi celah tanpa batas.
export const DAILY_FREE_QUOTA = 2;

const PREFIX = 'pm_tool_quota_';
// Kunci format lama: dibaca sekali agar pemakaian hari ini tidak ter-reset saat versi ini dirilis.
const LEGACY_EXTRA_PREFIX = 'pm_extra_quota_';
const LEGACY_BUILTIN_PREFIX = 'muzeck_daily_quota_';

export const dayKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type QuotaStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const memory = new Map<string, string>();
const memoryStore: QuotaStore = {
  get length() { return memory.size; },
  key: (i: number) => [...memory.keys()][i] ?? null,
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v); },
  removeItem: (k: string) => { memory.delete(k); },
};

const defaultStore = (): QuotaStore => {
  try {
    if (typeof localStorage === 'undefined') return memoryStore;
    const probe = '__pm_quota_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryStore;
  }
};

const toCount = (raw: string | null): number => (raw ? Math.max(0, Math.floor(Number(raw)) || 0) : 0);

function readUsed(s: QuotaStore, today: string, toolId: string): number {
  const raw = s.getItem(`${PREFIX}${today}_${toolId}`);
  if (raw !== null) return toCount(raw);
  // migrasi dari format lama (hari ini saja)
  let used = toCount(s.getItem(`${LEGACY_EXTRA_PREFIX}${today}_${toolId}`));
  try {
    const legacy = s.getItem(`${LEGACY_BUILTIN_PREFIX}${today}`);
    if (legacy) {
      const left = Number(JSON.parse(legacy)?.[toolId]);
      if (Number.isFinite(left)) used = Math.max(used, DAILY_FREE_QUOTA - Math.max(0, Math.min(DAILY_FREE_QUOTA, Math.floor(left))));
    }
  } catch { /* abaikan data lama yang rusak */ }
  return used;
}

function purgeOldDays(s: QuotaStore, today: string) {
  for (let i = s.length - 1; i >= 0; i--) {
    const k = s.key(i);
    if (!k) continue;
    if (k.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${today}_`)) s.removeItem(k);
    else if (k.startsWith(LEGACY_EXTRA_PREFIX) && !k.startsWith(`${LEGACY_EXTRA_PREFIX}${today}_`)) s.removeItem(k);
    else if (k.startsWith(LEGACY_BUILTIN_PREFIX) && k !== `${LEGACY_BUILTIN_PREFIX}${today}`) s.removeItem(k);
  }
}

/** Sisa jatah gratis hari ini untuk satu alat (Infinity bila Audio Tools sudah dimiliki). */
export function remainingQuota(toolId: string, unlimited = false, s: QuotaStore | null = defaultStore()): number {
  if (unlimited) return Infinity;
  const st = s ?? memoryStore;
  try { return Math.max(0, DAILY_FREE_QUOTA - readUsed(st, dayKey(), toolId)); } catch { return DAILY_FREE_QUOTA; }
}

/** Pakai satu jatah. Mengembalikan false bila jatah hari ini habis (tidak ada yang dikurangi). */
export function consumeQuota(toolId: string, unlimited = false, s: QuotaStore | null = defaultStore()): boolean {
  if (unlimited) return true;
  const st = s ?? memoryStore;
  try {
    const today = dayKey();
    purgeOldDays(st, today);
    const used = readUsed(st, today, toolId);
    if (used >= DAILY_FREE_QUOTA) return false;
    st.setItem(`${PREFIX}${today}_${toolId}`, String(used + 1));
    return true;
  } catch {
    // penyimpanan gagal di tengah jalan: pakai memori agar batas tetap berlaku
    if (st === memoryStore) return true;
    return consumeQuota(toolId, false, memoryStore);
  }
}

/** Kembalikan satu jatah (mis. ekspor gagal setelah jatah terpakai). Tidak pernah melebihi batas awal. */
export function refundQuota(toolId: string, unlimited = false, s: QuotaStore | null = defaultStore()): void {
  if (unlimited) return;
  const st = s ?? memoryStore;
  try {
    const today = dayKey();
    const used = readUsed(st, today, toolId);
    st.setItem(`${PREFIX}${today}_${toolId}`, String(Math.max(0, used - 1)));
  } catch { /* abaikan */ }
}

// Nama lama dipertahankan agar kode yang sudah ada tetap berjalan.
export const remainingExtraQuota = remainingQuota;
export const consumeExtraQuota = consumeQuota;
