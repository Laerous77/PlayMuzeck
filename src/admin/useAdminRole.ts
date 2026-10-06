// src/admin/useAdminRole.ts
// Peran admin yang sedang login (dari /api/admin/me). Super Admin = akses penuh;
// admin biasa = hanya CRUD audio & kuis buatannya sendiri, sisanya hanya-baca.
// Penegakan sebenarnya ada di server; hook ini hanya untuk UI.
import { useEffect, useState } from 'react';
import { adminFetch, AdminMe } from './adminApi';

export const READONLY_MSG = 'Hanya Super Admin yang bisa mengubah bagian ini. Akunmu hanya bisa melihat.';

export function useAdminRole() {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    adminFetch<AdminMe>('/api/admin/me')
      .then((m) => {
        if (alive) setMe(m);
      })
      // Sesi habis (401) ditangani global lewat ADMIN_EXPIRED_EVENT; galat lain ditandai supaya
      // `loading` tidak menggantung selamanya.
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return {
    loading: me === null && !failed,
    isSuperAdmin: Boolean(me?.isSuperAdmin),
    email: me?.email ? me.email.toLowerCase() : null,
  };
}
