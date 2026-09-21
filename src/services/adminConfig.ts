export const ADMIN_EMAILS: string[] = [
  'frfrareu@gmail.com',
  // tambahkan email admin lain di sini, contoh:
  // 'admin-kedua@gmail.com',
];

const NORMALIZED_ADMINS = ADMIN_EMAILS.map((e) => e.trim().toLowerCase());

// CATATAN: ini hanya untuk menyembunyikan UI. Hak admin WAJIB dicek ulang di server.
export function isUserAdmin(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return NORMALIZED_ADMINS.includes(normalized);
}

export const PRIMARY_ADMIN_EMAIL = ADMIN_EMAILS[0];