// src/admin/useAdminRole.ts
// Peran admin yang sedang login (dari /api/admin/me). Super Admin = akses penuh;
// admin biasa = hanya CRUD audio & kuis buatannya sendiri, sisanya hanya-baca.
// Penegakan sebenarnya ada di server; hook ini hanya untuk UI.
import { useEffect, useState } from 'react';
import { adminFetch } from './adminApi';

interface AdminMe {
  email: string | null;
  isSuperAdmin: boolean;
}

export const READONLY_MSG = 'Hanya Super Admin yang bisa mengubah bagian ini. Akunmu hanya bisa melihat.';

export function useAdminRole() {
  const [me, setMe] = useState<AdminMe | null>(null);
  useEffect(() => {
    let alive = true;
    adminFetch<AdminMe>('/api/admin/me')
      .then((m) => alive && setMe(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return {
    loading: me === null,
    isSuperAdmin: Boolean(me?.isSuperAdmin),
    email: me?.email ? me.email.toLowerCase() : null,
  };
}
