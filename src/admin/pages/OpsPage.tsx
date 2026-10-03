import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, X, Check, Loader2, ChevronDown, ChevronRight, Mail, Ban, RotateCcw, ExternalLink } from 'lucide-react';
import { adminFetch } from '../adminApi';
import { useAdminRole, READONLY_MSG } from '../useAdminRole';

// ---------- Tipe data ----------
interface PaymentOrder {
  order_id: string;
  user_email: string;
  customer_name: string;
  kind: 'cart' | 'donation';
  gross_amount: number;
  status: string;
  fulfilled: boolean;
  created_at: string;
  expires_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  items: any[];
}

interface Buyer {
  email: string;
  name: string;
  paid: number;
  failed: number;
  pending: number;
  cancelled?: number;
  spent: number;
  last_order: string;
  owned_items: number;
}

interface BuyerDetail {
  orders: PaymentOrder[];
  owned: Array<{ category: string; id: string; type_key: string; title: string; purchased_at: string }>;
}

interface InquiryRow {
  id: string;
  title: string;
  email: string;
  genre: string;
  mood: string;
  status: string;
  notes: string;
  created_at: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  last_seen: string;
  has_password: boolean;
  has_google: boolean;
  is_super_admin: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  email_verified_at: string | null;
  bio?: string;
  greeting?: string;
  avatar_url?: string;
  active_frame_id?: string;
  owned_items: number;
  paid_orders: number;
}

interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  products: Record<string, number>;
  bundle: number;
}
interface CatalogDeck {
  id: string;
  title: string;
  price: number;
  badge: string | null;
}
interface CatalogTopic {
  id: string;
  title: string;
  price: number;
}
interface Catalog {
  tracks: CatalogTrack[];
  decks: CatalogDeck[];
  topics: CatalogTopic[];
  features: { editor8Bar: number; audioTools: number; quizCreator: number };
}

// ---------- Konstanta & helper ----------
// 'paid' = pengguna DIANGGAP SUDAH MEMBELI -> server otomatis memberi akses produk.
const STATUSES = [
  { id: 'pending', label: 'Menunggu', cls: 'bg-accent/20 text-accent' },
  { id: 'paid', label: 'Berhasil', cls: 'bg-emerald-500/20 text-emerald-300' },
  { id: 'failed', label: 'Gagal', cls: 'bg-red-500/20 text-red-300' },
  // Dibatalkan pembeli, admin, atau otomatis karena lewat batas bayar (24 jam). Tetap tercatat.
  { id: 'cancelled', label: 'Dibatalkan', cls: 'bg-gray-500/20 text-gray-300' },
] as const;

// Nilai di database tetap baru/proses/selesai; yang tampil: Menunggu/Diproses/Selesai.
const INQUIRY_STATUSES = [
  { id: 'baru', label: 'Menunggu', cls: 'bg-accent/20 text-accent' },
  { id: 'proses', label: 'Diproses', cls: 'bg-sky-500/20 text-sky-300' },
  { id: 'selesai', label: 'Selesai', cls: 'bg-emerald-500/20 text-emerald-300' },
] as const;

// Produk audio PER LAGU. Editor 8 Bar & Audio Tools sekali beli = permanen untuk semua lagu,
// jadi dipilih sebagai jenis produk tersendiri (bukan per track).
const AUDIO_PRODUCTS = [
  { key: 'fullMaster', label: 'Full Master' },
  { key: 'loopVersion', label: 'Loop' },
  { key: 'separatedStems', label: 'Stems' },
  { key: 'sheetMusic', label: 'Partitur' },
];

const KEY_LABEL: Record<string, string> = {
  fullMaster: 'Full Master',
  loopVersion: 'Loop',
  separatedStems: 'Stems',
  sheetMusic: 'Partitur',
  fullEditor8Bar: 'Editor 8 Bar',
  audioToolsSuite: 'Audio Tools',
  quizCreatorSuite: 'Kreator Kuis',
  all: 'Bundle',
};

const statusMeta = (id: string) =>
  STATUSES.find((s) => s.id === id) ?? { id, label: id, cls: 'bg-white/10 text-gray-300' };
const inquiryMeta = (id: string) =>
  INQUIRY_STATUSES.find((s) => s.id === id) ?? { id, label: id, cls: 'bg-white/10 text-gray-300' };

const rupiah = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const fmtTime = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

const itemLabel = (item: any): string => {
  if (!item) return '-';
  if (item.category === 'donation') return 'Donasi';
  const name = item.title || item.name || item.id || item.deckId || item.topicId || '?';
  const key = item.itemTypeKey ? ` (${KEY_LABEL[item.itemTypeKey] ?? item.itemTypeKey})` : '';
  return `${name}${key}`;
};

const inputCls =
  'mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-accent';

const Badge: React.FC<{ cls: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>
);

type ItemKind = 'audio' | 'editor8Bar' | 'audioTools' | 'deck' | 'topic' | 'quizCreator';

// Item yang sudah dipilih admin. `ref` dikirim ke server; server memvalidasi ke DB & menghitung harga sendiri.
interface DraftItem {
  key: string;
  ref: Record<string, unknown>;
  label: string;
  price: number;
}

interface NewOrderForm {
  user_email: string;
  kind: 'cart' | 'donation';
  status: string;
  autoAmount: boolean;
  gross_amount: string;
  itemKind: ItemKind;
  refId: string;
  audioKeys: string[];
  bundle: boolean;
  items: DraftItem[];
}

const emptyOrderForm: NewOrderForm = {
  user_email: '',
  kind: 'cart',
  status: 'paid',
  autoAmount: true,
  gross_amount: '0',
  itemKind: 'audio',
  refId: '',
  audioKeys: ['fullMaster'],
  bundle: false,
  items: [],
};

interface InquiryForm {
  id?: string;
  title: string;
  email: string;
  genre: string;
  mood: string;
  status: string;
  notes: string;
}
const emptyInquiryForm: InquiryForm = { title: '', email: '', genre: '', mood: '', status: 'baru', notes: '' };

interface UserForm {
  id?: string;
  email: string;
  name: string;
  role: string;
  password: string;
  bio: string;
  greeting: string;
  avatarUrl: string; // foto saat ini (hanya pratinjau; admin hanya bisa menghapus)
  removeAvatar: boolean;
}
const emptyUserForm: UserForm = { email: '', name: '', role: 'user', password: '', bio: '', greeting: '', avatarUrl: '', removeAvatar: false };

// ---------- Halaman ----------
export const OpsPage: React.FC = () => {
  const { isSuperAdmin } = useAdminRole();
  const [tab, setTab] = useState<'orders' | 'buyers' | 'inquiries' | 'users'>('orders');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  // pesanan
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [orderForm, setOrderForm] = useState<NewOrderForm | null>(null);
  // pembeli
  const [openBuyer, setOpenBuyer] = useState<string | null>(null);
  const [buyerDetail, setBuyerDetail] = useState<BuyerDetail | null>(null);
  const [buyerLoading, setBuyerLoading] = useState(false);
  // custom audio
  const [inqFilter, setInqFilter] = useState('all');
  const [inqForm, setInqForm] = useState<InquiryForm | null>(null);
  // pengguna
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [userForm, setUserForm] = useState<UserForm | null>(null);
  const [emailForm, setEmailForm] = useState<{ user: UserRow; subject: string; message: string } | null>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const ok = (m: string) => { setError(''); setMessage(m); };
  const fail = (err: unknown, fallback: string) => { setMessage(''); setError(err instanceof Error ? err.message : fallback); };

  const load = async () => {
    try {
      const [o, b, i, u] = await Promise.all([
        adminFetch<PaymentOrder[]>('/api/admin/payment-orders'),
        adminFetch<Buyer[]>('/api/admin/buyers'),
        adminFetch<InquiryRow[]>('/api/admin/inquiries'),
        adminFetch<UserRow[]>('/api/admin/users'),
      ]);
      setOrders(o);
      setBuyers(b);
      setInquiries(i);
      setUsers(u);
    } catch (err) {
      fail(err, 'Gagal memuat data.');
    }
  };

  useEffect(() => {
    load();
    adminFetch<Catalog>('/api/admin/product-catalog').then(setCatalog).catch((err) => fail(err, 'Gagal memuat katalog produk.'));
  }, []);

  // ===== PESANAN =====
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const s of STATUSES) c[s.id] = 0;
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (filter === 'all' || o.status === filter) &&
        (!q || o.user_email.toLowerCase().includes(q) || (o.customer_name || '').toLowerCase().includes(q) || o.order_id.toLowerCase().includes(q))
    );
  }, [orders, filter, search]);

  const changeStatus = async (order: PaymentOrder, status: string) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    if (status === order.status) return;
    let revoke = true;
    if (order.status === 'paid' && order.fulfilled) {
      revoke = confirm(
        `Pesanan ini sedang "Berhasil" dan penggunanya sudah punya akses.\n\nOK = ubah status DAN cabut akses produknya.\nBatal = jangan ubah apa-apa.`
      );
      if (!revoke) return;
    }
    try {
      await adminFetch(`/api/admin/payment-orders/${order.order_id}`, { method: 'PATCH', body: JSON.stringify({ status, revoke }) });
      ok(status === 'paid' ? `Pesanan ${order.user_email} ditandai berhasil — akses produk diberikan.` : `Status pesanan ${order.user_email} → ${statusMeta(status).label}.`);
      await load();
    } catch (err) {
      fail(err, 'Gagal mengubah status.');
    }
  };

  const editAmount = async (order: PaymentOrder) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    const v = prompt('Nominal baru (Rp):', String(order.gross_amount));
    if (v === null) return;
    const n = Number(v.replace(/[^\d]/g, ''));
    if (!Number.isFinite(n)) return;
    try {
      await adminFetch(`/api/admin/payment-orders/${order.order_id}`, { method: 'PATCH', body: JSON.stringify({ gross_amount: n }) });
      ok('Nominal diperbarui.');
      await load();
    } catch (err) {
      fail(err, 'Gagal mengubah nominal.');
    }
  };

  const removeOrder = async (order: PaymentOrder) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    if (!confirm(`Hapus pesanan ${order.user_email} (${rupiah(order.gross_amount)})?`)) return;
    let revoke = false;
    if (order.status === 'paid' && order.fulfilled) {
      revoke = confirm('Cabut juga akses produk yang diberikan pesanan ini?\n\nOK = cabut akses\nBatal = hapus pesanan saja, akses tetap');
    }
    try {
      await adminFetch(`/api/admin/payment-orders/${order.order_id}?revoke=${revoke ? 1 : 0}`, { method: 'DELETE' });
      ok(revoke ? 'Pesanan dihapus dan akses dicabut.' : 'Pesanan dihapus.');
      await load();
    } catch (err) {
      fail(err, 'Gagal menghapus pesanan.');
    }
  };

  const draftTotal = orderForm ? orderForm.items.reduce((a, b) => a + b.price, 0) : 0;

  const addItem = () => {
    if (!orderForm || !catalog) return;
    const f = orderForm;
    let item: DraftItem | null = null;

    if (f.itemKind === 'audio') {
      const t = catalog.tracks.find((x) => x.id === f.refId);
      if (!t) return fail(null, 'Pilih lagu dari daftar.');
      if (f.bundle) {
        item = { key: `audio|${t.id}|all`, ref: { kind: 'audio', trackId: t.id, bundle: true }, label: `${t.title} — Bundle lengkap`, price: t.bundle };
      } else {
        if (!f.audioKeys.length) return fail(null, 'Pilih minimal satu jenis produk audio.');
        const names = f.audioKeys.map((k) => KEY_LABEL[k] ?? k).join(', ');
        const price = f.audioKeys.reduce((a, k) => a + (t.products[k] ?? 0), 0);
        item = { key: `audio|${t.id}|${[...f.audioKeys].sort().join(',')}`, ref: { kind: 'audio', trackId: t.id, keys: f.audioKeys }, label: `${t.title} — ${names}`, price };
      }
    } else if (f.itemKind === 'editor8Bar') {
      item = { key: 'editor8Bar', ref: { kind: 'editor8Bar' }, label: 'Editor 8 Bar (permanen, semua lagu)', price: catalog.features.editor8Bar };
    } else if (f.itemKind === 'audioTools') {
      item = { key: 'audioTools', ref: { kind: 'audioTools' }, label: 'Audio Tools (permanen)', price: catalog.features.audioTools };
    } else if (f.itemKind === 'quizCreator') {
      item = { key: 'quizCreator', ref: { kind: 'quizCreator' }, label: 'Kreator Kuis (permanen)', price: catalog.features.quizCreator };
    } else if (f.itemKind === 'deck') {
      const d = catalog.decks.find((x) => x.id === f.refId);
      if (!d) return fail(null, 'Pilih deck dari daftar.');
      item = { key: `deck|${d.id}`, ref: { kind: 'deck', deckId: d.id }, label: `Deck: ${d.title}`, price: d.price };
    } else {
      const t = catalog.topics.find((x) => x.id === f.refId);
      if (!t) return fail(null, 'Pilih topik dari daftar.');
      item = { key: `topic|${t.id}`, ref: { kind: 'topic', topicId: t.id }, label: `Topik: ${t.title} (termasuk semua deck-nya)`, price: t.price };
    }

    if (f.items.some((x) => x.key === item!.key)) return fail(null, 'Produk itu sudah ada di pesanan ini.');
    setError('');
    setOrderForm({ ...f, items: [...f.items, item], refId: '' });
  };

  const submitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    e.preventDefault();
    if (!orderForm) return;
    const account = users.find((u) => u.email.toLowerCase() === orderForm.user_email.trim().toLowerCase());
    if (!account) return fail(null, 'Email itu belum terdaftar. Pilih dari daftar pengguna, atau buat akunnya dulu di tab Pengguna.');
    if (orderForm.kind === 'cart' && !orderForm.items.length) return fail(null, 'Tambahkan minimal satu produk ke pesanan.');
    setBusy(true);
    try {
      const needsAmount = orderForm.kind === 'donation' || !orderForm.autoAmount;
      await adminFetch('/api/admin/payment-orders', {
        method: 'POST',
        body: JSON.stringify({
          user_email: account.email,
          kind: orderForm.kind,
          status: orderForm.status,
          gross_amount: needsAmount ? Number(orderForm.gross_amount) || 0 : null,
          items: orderForm.kind === 'cart' ? orderForm.items.map((i) => i.ref) : [],
        }),
      });
      ok(orderForm.status === 'paid' ? 'Pesanan dibuat dan akses langsung diberikan.' : 'Pesanan manual dibuat.');
      setOrderForm(null);
      await load();
    } catch (err) {
      fail(err, 'Gagal membuat pesanan.');
    } finally {
      setBusy(false);
    }
  };

  // ===== PEMBELI =====
  const toggleBuyer = async (email: string) => {
    if (openBuyer === email) {
      setOpenBuyer(null);
      setBuyerDetail(null);
      return;
    }
    setOpenBuyer(email);
    setBuyerDetail(null);
    setBuyerLoading(true);
    try {
      setBuyerDetail(await adminFetch<BuyerDetail>(`/api/admin/buyers/${encodeURIComponent(email)}`));
    } catch (err) {
      fail(err, 'Gagal memuat detail pembeli.');
    } finally {
      setBuyerLoading(false);
    }
  };

  // ===== CUSTOM AUDIO =====
  const inqCounts = useMemo(() => {
    const c: Record<string, number> = { all: inquiries.length, baru: 0, proses: 0, selesai: 0 };
    for (const i of inquiries) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [inquiries]);
  const visibleInquiries = inquiries.filter((i) => inqFilter === 'all' || i.status === inqFilter);

  const setInquiryStatus = async (item: InquiryRow, status: string) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    try {
      await adminFetch(`/api/admin/inquiries/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      ok(`"${item.title}" → ${inquiryMeta(status).label}.`);
      await load();
    } catch (err) {
      fail(err, 'Gagal mengubah status.');
    }
  };

  const submitInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    e.preventDefault();
    if (!inqForm) return;
    setBusy(true);
    try {
      const { id, ...payload } = inqForm;
      if (id) await adminFetch(`/api/admin/inquiries/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await adminFetch('/api/admin/inquiries', { method: 'POST', body: JSON.stringify(payload) });
      ok(id ? 'Permintaan diperbarui.' : 'Permintaan ditambahkan.');
      setInqForm(null);
      await load();
    } catch (err) {
      fail(err, 'Gagal menyimpan permintaan.');
    } finally {
      setBusy(false);
    }
  };

  const removeInquiry = async (item: InquiryRow) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    if (!confirm(`Hapus "${item.title}" dari ${item.email || 'pengirim'}?`)) return;
    try {
      await adminFetch(`/api/admin/inquiries/${item.id}`, { method: 'DELETE' });
      ok('Permintaan dihapus.');
      await load();
    } catch (err) {
      fail(err, 'Gagal menghapus permintaan.');
    }
  };

  // ===== PENGGUNA =====
  const visibleUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter(
      (u) =>
        (userFilter === 'all' || (userFilter === 'suspended' ? !!u.suspended_at : !u.suspended_at)) &&
        (!q || u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))
    );
  }, [users, userSearch, userFilter]);
  const suspendedCount = users.filter((u) => u.suspended_at).length;

  const suspendUser = async (u: UserRow) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    const reason = prompt(`Tangguhkan akun ${u.email}?\n\nPengguna langsung ter-logout dan tidak bisa masuk lagi sampai dipulihkan. Produk yang sudah dibeli tetap tersimpan.\n\nAlasan (opsional):`);
    if (reason === null) return;
    try {
      await adminFetch(`/api/admin/users/${u.id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });
      ok(`Akun ${u.email} ditangguhkan.`);
      await load();
    } catch (err) {
      fail(err, 'Gagal menangguhkan akun.');
    }
  };

  const restoreUser = async (u: UserRow) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    if (!confirm(`Pulihkan akun ${u.email}? Pengguna bisa masuk lagi.`)) return;
    try {
      await adminFetch(`/api/admin/users/${u.id}/restore`, { method: 'POST' });
      ok(`Akun ${u.email} dipulihkan.`);
      await load();
    } catch (err) {
      fail(err, 'Gagal memulihkan akun.');
    }
  };

  const sendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    e.preventDefault();
    if (!emailForm) return;
    setBusy(true);
    // Batas waktu 40 dtk (server sendiri menyerah di ~20 dtk) supaya tombol tidak "loading terus".
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      await adminFetch(`/api/admin/users/${emailForm.user.id}/email`, {
        method: 'POST',
        body: JSON.stringify({ subject: emailForm.subject, message: emailForm.message }),
        signal: controller.signal,
      });
      ok(`Email terkirim ke ${emailForm.user.email}.`);
      setEmailForm(null);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        fail(new Error('Server tidak menjawab dalam 40 detik, jadi pengiriman dihentikan. Cek pengaturan SMTP di server, atau pakai tombol "Buka Gmail".'), 'Gagal mengirim email.');
      } else {
        fail(err, 'Gagal mengirim email.');
      }
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  const submitUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    e.preventDefault();
    if (!userForm) return;
    setBusy(true);
    try {
      if (userForm.id) {
        const body: Record<string, string | boolean> = {
          name: userForm.name,
          role: userForm.role,
          bio: userForm.bio,
          greeting: userForm.greeting,
          ...(userForm.removeAvatar ? { removeAvatar: true } : {}),
        };
        if (userForm.password) body.password = userForm.password;
        await adminFetch(`/api/admin/users/${userForm.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        ok('Pengguna diperbarui.');
      } else {
        await adminFetch('/api/admin/users', { method: 'POST', body: JSON.stringify({ email: userForm.email, name: userForm.name, role: userForm.role, password: userForm.password }) });
        ok('Pengguna ditambahkan.');
      }
      setUserForm(null);
      await load();
    } catch (err) {
      fail(err, 'Gagal menyimpan pengguna.');
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (u: UserRow) => {
    if (!isSuperAdmin) { fail(null, READONLY_MSG); return; }
    if (
      !confirm(
        `Hapus pengguna ${u.email}?\n\nKoleksi produk, donasi, dan token reset milik pengguna ini ikut terhapus. Riwayat pesanannya tetap tersimpan.`
      )
    )
      return;
    try {
      await adminFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      ok('Pengguna dihapus.');
      await load();
    } catch (err) {
      fail(err, 'Gagal menghapus pengguna.');
    }
  };


  return (
    <div className="space-y-4">
      {!isSuperAdmin && (
        <p className="text-xs rounded-xl bg-accent/10 border border-accent/30 text-accent px-3 py-2">
          Mode hanya-baca: akunmu bisa melihat semua data di sini, tetapi hanya Super Admin yang bisa mengubahnya.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['orders', `Pesanan (${orders.length})`],
            ['buyers', `Pembeli (${buyers.length})`],
            ['inquiries', `Custom audio (${inquiries.length})`],
            ['users', `Pengguna (${users.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === id ? 'bg-accent text-on-accent' : 'bg-surface border border-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 font-medium">{error}</p>}
      {message && <p className="text-xs text-emerald-400 font-medium">{message}</p>}

      {/* ================= PESANAN ================= */}
      {tab === 'orders' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Mengubah ke <b className="text-emerald-300">Berhasil</b> otomatis memberi pengguna akses ke produk di pesanan itu. Mengubah dari Berhasil ke
            status lain mencabut aksesnya.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {[{ id: 'all', label: 'Semua' }, ...STATUSES].map((s) => (
              <button
                key={s.id}
                onClick={() => setFilter(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filter === s.id ? 'bg-white text-black' : 'bg-surface border border-white/10 text-gray-300'}`}
              >
                {s.label} ({counts[s.id] ?? 0})
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari email / nama / ID..."
              className="ml-auto rounded-lg bg-black/40 border border-white/10 px-3 py-1.5 text-xs text-white outline-none focus:border-accent"
            />
            <button onClick={() => setOrderForm({ ...emptyOrderForm })} className="rounded-lg bg-accent text-on-accent font-bold px-3 py-1.5 text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Pesanan manual
            </button>
          </div>

          {orderForm && (
            <form onSubmit={submitOrder} className="rounded-2xl bg-surface border border-accent/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">Tambah pesanan manual</h3>
                <button type="button" onClick={() => setOrderForm(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {!catalog && <p className="text-xs text-gray-400">Memuat katalog produk dari database...</p>}
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">
                  Pengguna (harus sudah punya akun)
                  <input required type="email" list="ops-user-emails" className={inputCls} value={orderForm.user_email} onChange={(e) => setOrderForm({ ...orderForm, user_email: e.target.value })} />
                  <datalist id="ops-user-emails">
                    {users.map((u) => (
                      <option key={u.id} value={u.email}>
                        {u.name}
                      </option>
                    ))}
                  </datalist>
                  {orderForm.user_email && !users.some((u) => u.email.toLowerCase() === orderForm.user_email.trim().toLowerCase()) && (
                    <span className="text-[10px] text-red-300">Belum terdaftar — buat akunnya dulu di tab Pengguna.</span>
                  )}
                </label>
                <label className="text-xs text-gray-400">
                  Jenis
                  <select className={inputCls} value={orderForm.kind} onChange={(e) => setOrderForm({ ...orderForm, kind: e.target.value as 'cart' | 'donation' })}>
                    <option value="cart">Pembelian produk</option>
                    <option value="donation">Donasi</option>
                  </select>
                </label>
                <label className="text-xs text-gray-400">
                  Status awal
                  <select className={inputCls} value={orderForm.status} onChange={(e) => setOrderForm({ ...orderForm, status: e.target.value })}>
                    {STATUSES.filter((s) => s.id !== 'cancelled').map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-xs text-gray-400">
                  Nominal (Rp)
                  {orderForm.kind === 'cart' && (
                    <label className="flex items-center gap-2 mt-1 text-gray-300">
                      <input type="checkbox" checked={orderForm.autoAmount} onChange={(e) => setOrderForm({ ...orderForm, autoAmount: e.target.checked })} />
                      Otomatis dari harga produk ({rupiah(draftTotal)})
                    </label>
                  )}
                  {(orderForm.kind === 'donation' || !orderForm.autoAmount) && (
                    <input type="number" min={0} className={inputCls} value={orderForm.gross_amount} onChange={(e) => setOrderForm({ ...orderForm, gross_amount: e.target.value })} />
                  )}
                </div>
              </div>

              {orderForm.kind === 'cart' && catalog && (
                <div className="rounded-xl border border-white/10 p-3 space-y-3">
                  <p className="text-xs font-semibold text-white">Produk di pesanan ini (hanya produk yang ada di database)</p>
                  <label className="text-xs text-gray-400 block">
                    Tipe produk
                    <select className={inputCls} value={orderForm.itemKind} onChange={(e) => setOrderForm({ ...orderForm, itemKind: e.target.value as ItemKind, refId: '' })}>
                      <optgroup label="Audio">
                        <option value="audio">Lagu (Master / Loop / Stems / Partitur)</option>
                        <option value="editor8Bar">Editor 8 Bar — sekali beli, permanen</option>
                        <option value="audioTools">Audio Tools — sekali beli, permanen</option>
                      </optgroup>
                      <optgroup label="Kuis">
                        <option value="deck">Deck kuis</option>
                        <option value="topic">Topik kuis</option>
                        <option value="quizCreator">Kreator Kuis — sekali beli, permanen</option>
                      </optgroup>
                    </select>
                  </label>

                  {orderForm.itemKind === 'audio' && (
                    <>
                      <label className="text-xs text-gray-400 block">
                        Lagu
                        <select className={inputCls} value={orderForm.refId} onChange={(e) => setOrderForm({ ...orderForm, refId: e.target.value })}>
                          <option value="">— pilih lagu —</option>
                          {catalog.tracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title} · {t.artist}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(() => {
                        const t = catalog.tracks.find((x) => x.id === orderForm.refId);
                        return (
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs text-gray-300">
                              <input type="checkbox" checked={orderForm.bundle} onChange={(e) => setOrderForm({ ...orderForm, bundle: e.target.checked })} />
                              Bundle lengkap (semua produk lagu + Editor 8 Bar + Audio Tools){t ? ` — ${rupiah(t.bundle)}` : ''}
                            </label>
                            {!orderForm.bundle && (
                              <div className="flex flex-wrap gap-2">
                                {AUDIO_PRODUCTS.map((p) => {
                                  const on = orderForm.audioKeys.includes(p.key);
                                  return (
                                    <button
                                      type="button"
                                      key={p.key}
                                      onClick={() => setOrderForm({ ...orderForm, audioKeys: on ? orderForm.audioKeys.filter((k) => k !== p.key) : [...orderForm.audioKeys, p.key] })}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${on ? 'bg-accent text-on-accent' : 'bg-black/40 border border-white/10 text-gray-300'}`}
                                    >
                                      {p.label}
                                      {t ? ` · ${rupiah(t.products[p.key] ?? 0)}` : ''}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {orderForm.itemKind === 'editor8Bar' && (
                    <p className="text-xs text-gray-300 bg-black/30 rounded-lg p-2">Editor 8 Bar · {rupiah(catalog.features.editor8Bar)} · sekali beli, terbuka permanen untuk SEMUA lagu di akun ini. Kalau sudah dimiliki, tidak dobel.</p>
                  )}
                  {orderForm.itemKind === 'audioTools' && (
                    <p className="text-xs text-gray-300 bg-black/30 rounded-lg p-2">Audio Tools · {rupiah(catalog.features.audioTools)} · sekali beli, terbuka permanen di akun ini.</p>
                  )}
                  {orderForm.itemKind === 'quizCreator' && (
                    <p className="text-xs text-gray-300 bg-black/30 rounded-lg p-2">Kreator Kuis (editor kuis) · {rupiah(catalog.features.quizCreator)} · sekali beli, terbuka permanen di akun ini.</p>
                  )}

                  {orderForm.itemKind === 'deck' && (
                    <label className="text-xs text-gray-400 block">
                      Deck
                      <select className={inputCls} value={orderForm.refId} onChange={(e) => setOrderForm({ ...orderForm, refId: e.target.value })}>
                        <option value="">— pilih deck —</option>
                        {catalog.decks.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title} · {rupiah(d.price)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {orderForm.itemKind === 'topic' && (
                    <label className="text-xs text-gray-400 block">
                      Topik
                      <select className={inputCls} value={orderForm.refId} onChange={(e) => setOrderForm({ ...orderForm, refId: e.target.value })}>
                        <option value="">— pilih topik —</option>
                        {catalog.topics.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title} · {rupiah(t.price)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <button type="button" onClick={addItem} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold">
                    + Tambahkan ke pesanan
                  </button>
                  {orderForm.items.length > 0 && (
                    <ul className="space-y-1">
                      {orderForm.items.map((it) => (
                        <li key={it.key} className="flex items-center justify-between text-xs text-gray-300 bg-black/30 rounded-lg px-2 py-1">
                          <span>
                            {it.label} · <span className="text-gray-500">{rupiah(it.price)}</span>
                          </span>
                          <button type="button" onClick={() => setOrderForm({ ...orderForm, items: orderForm.items.filter((x) => x.key !== it.key) })} className="text-red-300">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <button disabled={busy || !catalog} className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Simpan pesanan
              </button>
            </form>
          )}

          <div className="rounded-2xl bg-surface border border-white/10 overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th className="p-3">Waktu</th>
                  <th>Pelanggan</th>
                  <th>Nominal</th>
                  <th>Status</th>
                  <th>Isi pesanan</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const meta = statusMeta(order.status);
                  return (
                    <tr key={order.order_id} className="border-t border-white/5 align-top">
                      <td className="p-3 text-gray-400 whitespace-nowrap">
                        {fmtTime(order.created_at)}
                        <div className="text-[10px] text-gray-600 font-mono">{order.order_id}</div>
                      </td>
                      <td className="py-3">
                        {order.customer_name}
                        <div className="text-xs text-gray-500">{order.user_email}</div>
                      </td>
                      <td className="py-3 whitespace-nowrap">
                        <button onClick={() => editAmount(order)} className="hover:text-accent" title="Klik untuk ubah nominal">
                          {rupiah(order.gross_amount)}
                        </button>
                      </td>
                      <td className="py-3">
                        <select value={order.status} onChange={(e) => changeStatus(order, e.target.value)} className={`rounded-lg px-2 py-1 text-xs font-bold outline-none ${meta.cls}`}>
                          {!STATUSES.some((s) => s.id === order.status) && <option value={order.status}>{order.status}</option>}
                          {STATUSES.map((s) => (
                            <option key={s.id} value={s.id} className="bg-surface text-white">
                              {s.label}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] mt-1 text-gray-500">{order.fulfilled ? 'akses aktif' : 'akses belum diberikan'}</div>
                        {order.status === 'pending' && order.expires_at && (
                          <div className="text-[10px] mt-0.5 text-accent/80">bayar sebelum {fmtTime(order.expires_at)}</div>
                        )}
                        {order.status === 'cancelled' && (
                          <div className="text-[10px] mt-0.5 text-gray-400">
                            {order.cancel_reason || 'dibatalkan'}
                            {order.cancelled_at ? ` • ${fmtTime(order.cancelled_at)}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3 max-w-xs text-gray-400 text-xs">{order.kind === 'donation' ? 'Donasi' : order.items.map(itemLabel).join(', ') || '-'}</td>
                      <td className="py-3 pr-3 text-right">
                        <button onClick={() => removeOrder(order)} className="p-1.5 rounded-lg text-red-300 hover:bg-red-500/10" title="Hapus">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleOrders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-xs text-gray-500">
                      Tidak ada pesanan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= PEMBELI ================= */}
      {tab === 'buyers' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Klik nama pembeli untuk melihat semua produk, status, tanggal, dan ID pesanannya.</p>
          <div className="rounded-2xl bg-surface border border-white/10 overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th className="p-3">Pengguna</th>
                  <th>Berhasil</th>
                  <th>Gagal</th>
                  <th>Menunggu</th>
                  <th>Dibatalkan</th>
                  <th>Total bayar</th>
                  <th>Produk dimiliki</th>
                  <th>Pesanan terakhir</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((b) => {
                  const open = openBuyer === b.email;
                  return (
                    <React.Fragment key={b.email}>
                      <tr onClick={() => toggleBuyer(b.email)} className={`border-t border-white/5 cursor-pointer hover:bg-white/5 ${open ? 'bg-white/5' : ''}`}>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {open ? <ChevronDown className="w-4 h-4 text-accent" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                            <div>
                              {b.name}
                              <div className="text-xs text-gray-500">{b.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-emerald-300 font-bold">{b.paid}</td>
                        <td className="text-red-300 font-bold">{b.failed}</td>
                        <td className="text-accent">{b.pending}</td>
                        <td className="text-gray-400">{b.cancelled ?? 0}</td>
                        <td>{rupiah(b.spent)}</td>
                        <td>{b.owned_items}</td>
                        <td className="text-gray-400 whitespace-nowrap">{fmtTime(b.last_order)}</td>
                      </tr>
                      {open && (
                        <tr className="border-t border-white/5 bg-black/20">
                          <td colSpan={8} className="p-4">
                            {buyerLoading && <p className="text-xs text-gray-400">Memuat detail...</p>}
                            {buyerDetail && (
                              <div className="space-y-4">
                                <div>
                                  <h4 className="text-xs font-bold text-white mb-2">Riwayat pesanan per produk</h4>
                                  <div className="overflow-x-auto rounded-xl border border-white/10">
                                    <table className="w-full text-xs min-w-[640px]">
                                      <thead className="text-gray-400 text-left bg-black/30">
                                        <tr>
                                          <th className="p-2">Produk</th>
                                          <th>Status</th>
                                          <th>Tanggal pesan</th>
                                          <th>ID pesanan</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {buyerDetail.orders.flatMap((o) =>
                                          (o.kind === 'donation' ? [{ category: 'donation' }] : o.items.length ? o.items : [{ title: '(kosong)' }]).map((it: any, idx: number) => (
                                            <tr key={`${o.order_id}-${idx}`} className="border-t border-white/5">
                                              <td className="p-2 text-gray-200">
                                                {o.kind === 'donation' ? `Donasi ${rupiah(o.gross_amount)}` : itemLabel(it)}
                                              </td>
                                              <td>
                                                <Badge cls={statusMeta(o.status).cls}>{statusMeta(o.status).label}</Badge>
                                              </td>
                                              <td className="text-gray-400 whitespace-nowrap">{fmtTime(o.created_at)}</td>
                                              <td className="font-mono text-[10px] text-gray-500">{o.order_id}</td>
                                            </tr>
                                          ))
                                        )}
                                        {buyerDetail.orders.length === 0 && (
                                          <tr>
                                            <td colSpan={4} className="p-3 text-center text-gray-500">
                                              Belum ada pesanan.
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                                <div>
                                  <h4 className="text-xs font-bold text-white mb-2">Produk yang saat ini dimiliki ({buyerDetail.owned.length})</h4>
                                  {buyerDetail.owned.length === 0 ? (
                                    <p className="text-xs text-gray-500">Belum memiliki produk.</p>
                                  ) : (
                                    <div className="flex flex-wrap gap-2">
                                      {buyerDetail.owned.map((p, idx) => (
                                        <span key={idx} className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-gray-200" title={`Diperoleh ${fmtTime(p.purchased_at)}`}>
                                          {p.title}
                                          {p.type_key ? <span className="text-gray-500"> · {p.type_key}</span> : null}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <p className="text-[11px] text-gray-500">Untuk mengubah status atau menghapus pesanan, buka tab Pesanan.</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {buyers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-xs text-gray-500">
                      Belum ada pembeli.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= CUSTOM AUDIO / PESAN ================= */}
      {tab === 'inquiries' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {[{ id: 'all', label: 'Semua' }, ...INQUIRY_STATUSES].map((s) => (
              <button
                key={s.id}
                onClick={() => setInqFilter(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${inqFilter === s.id ? 'bg-white text-black' : 'bg-surface border border-white/10 text-gray-300'}`}
              >
                {s.label} ({inqCounts[s.id] ?? 0})
              </button>
            ))}
            <button onClick={() => setInqForm({ ...emptyInquiryForm })} className="ml-auto rounded-lg bg-accent text-on-accent font-bold px-3 py-1.5 text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Tambah
            </button>
          </div>

          {inqForm && (
            <form onSubmit={submitInquiry} className="rounded-2xl bg-surface border border-accent/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">{inqForm.id ? 'Edit permintaan' : 'Tambah permintaan'}</h3>
                <button type="button" onClick={() => setInqForm(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">
                  Judul
                  <input required className={inputCls} value={inqForm.title} onChange={(e) => setInqForm({ ...inqForm, title: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Email pengirim
                  <input type="email" className={inputCls} value={inqForm.email} onChange={(e) => setInqForm({ ...inqForm, email: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Genre / kategori
                  <input className={inputCls} value={inqForm.genre} onChange={(e) => setInqForm({ ...inqForm, genre: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Mood / sumber
                  <input className={inputCls} value={inqForm.mood} onChange={(e) => setInqForm({ ...inqForm, mood: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Status
                  <select className={inputCls} value={inqForm.status} onChange={(e) => setInqForm({ ...inqForm, status: e.target.value })}>
                    {INQUIRY_STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="text-xs text-gray-400 block">
                Pesan / catatan
                <textarea rows={4} className={inputCls} value={inqForm.notes} onChange={(e) => setInqForm({ ...inqForm, notes: e.target.value })} />
              </label>
              <button disabled={busy} className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Simpan
              </button>
            </form>
          )}

          {visibleInquiries.map((item) => {
            const meta = inquiryMeta(item.status);
            return (
              <div key={item.id} className="rounded-2xl bg-surface border border-white/10 p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-white break-words">{item.title}</h3>
                    <p className="text-xs text-gray-400">
                      {item.email || '(tanpa email)'} · {item.genre || '-'} · {item.mood || '-'} · {fmtTime(item.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <select value={item.status} onChange={(e) => setInquiryStatus(item, e.target.value)} className={`rounded-lg px-2 py-1 text-xs font-bold outline-none ${meta.cls}`}>
                      {!INQUIRY_STATUSES.some((s) => s.id === item.status) && <option value={item.status}>{item.status}</option>}
                      {INQUIRY_STATUSES.map((s) => (
                        <option key={s.id} value={s.id} className="bg-surface text-white">
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setInqForm({ id: item.id, title: item.title || '', email: item.email || '', genre: item.genre || '', mood: item.mood || '', status: item.status, notes: item.notes || '' })}
                      className="p-1.5 rounded-lg text-gray-300 hover:bg-white/10"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => removeInquiry(item)} className="p-1.5 rounded-lg text-red-300 hover:bg-red-500/10" title="Hapus">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-200 mt-3 whitespace-pre-wrap break-words rounded-xl bg-black/30 p-3">{item.notes || <span className="text-gray-500">(tidak ada pesan)</span>}</p>
              </div>
            );
          })}
          {visibleInquiries.length === 0 && <p className="text-center text-xs text-gray-500 py-6">Tidak ada permintaan.</p>}
        </div>
      )}

      {/* ================= PENGGUNA ================= */}
      {tab === 'users' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['all', `Semua (${users.length})`],
                ['active', `Aktif (${users.length - suspendedCount})`],
                ['suspended', `Ditangguhkan (${suspendedCount})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setUserFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${userFilter === id ? 'bg-white text-black' : 'bg-surface border border-white/10 text-gray-300'}`}
              >
                {label}
              </button>
            ))}
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Cari nama / email..."
              className="ml-auto rounded-lg bg-black/40 border border-white/10 px-3 py-1.5 text-xs text-white outline-none focus:border-accent"
            />
            <button onClick={() => setUserForm({ ...emptyUserForm })} className="rounded-lg bg-accent text-on-accent font-bold px-3 py-1.5 text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Pengguna
            </button>
          </div>

          {userForm && (
            <form onSubmit={submitUser} className="rounded-2xl bg-surface border border-accent/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">{userForm.id ? 'Edit pengguna' : 'Tambah pengguna'}</h3>
                <button type="button" onClick={() => setUserForm(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">
                  Email {userForm.id && '(tidak bisa diubah)'}
                  <input required type="email" disabled={!!userForm.id} className={`${inputCls} disabled:opacity-50`} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Nama
                  <input className={inputCls} value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Role (label saja; akses admin diatur di menu Admin)
                  <select className={inputCls} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <label className="text-xs text-gray-400">
                  {userForm.id ? 'Kata sandi baru (kosongkan jika tidak diubah)' : 'Kata sandi (opsional, min. 4 karakter)'}
                  <input type="password" autoComplete="new-password" className={inputCls} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                </label>
              </div>
              {userForm.id && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-3">
                    {userForm.avatarUrl && !userForm.removeAvatar ? (
                      <img src={userForm.avatarUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-white/15" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-white font-black">
                        {(userForm.name || userForm.email || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 space-y-1">
                      {userForm.avatarUrl && !userForm.removeAvatar ? (
                        <button type="button" onClick={() => setUserForm({ ...userForm, removeAvatar: true })} className="px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 font-bold">
                          Hapus foto profil
                        </button>
                      ) : (
                        <span>{userForm.removeAvatar ? 'Foto akan dihapus saat disimpan (kembali ke inisial nama).' : 'Pengguna belum punya foto profil.'}</span>
                      )}
                      <div className="text-[10px] text-gray-500">Foto hanya bisa diunggah oleh pemilik akun; admin hanya bisa menghapusnya.</div>
                    </div>
                  </div>
                  <label className="text-xs text-gray-400 block">
                    <span className="flex justify-between"><span>Bio singkat</span><span className="font-mono text-gray-500">{userForm.bio.length}/160</span></span>
                    <textarea rows={2} maxLength={160} className={`${inputCls} resize-none`} value={userForm.bio} onChange={(e) => setUserForm({ ...userForm, bio: e.target.value })} />
                  </label>
                  <label className="text-xs text-gray-400 block">
                    <span className="flex justify-between"><span>Sapaan kustom (boleh pakai {'{nama}'})</span><span className="font-mono text-gray-500">{userForm.greeting.length}/80</span></span>
                    <input maxLength={80} className={inputCls} value={userForm.greeting} onChange={(e) => setUserForm({ ...userForm, greeting: e.target.value })} />
                  </label>
                </div>
              )}
              <button disabled={busy} className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Simpan
              </button>
            </form>
          )}

          {emailForm && (
            <form onSubmit={sendEmail} className="rounded-2xl bg-surface border border-sky-400/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">
                  Email ke {emailForm.user.name || emailForm.user.email} <span className="text-gray-400 font-normal text-xs">&lt;{emailForm.user.email}&gt;</span>
                </h3>
                <button type="button" onClick={() => setEmailForm(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <label className="text-xs text-gray-400 block">
                Subjek
                <input required className={inputCls} value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} />
              </label>
              <label className="text-xs text-gray-400 block">
                Pesan
                <textarea required rows={6} className={inputCls} value={emailForm.message} onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} className="rounded-xl bg-sky-400 text-black font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Kirim dari server
                </button>
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emailForm.user.email)}&su=${encodeURIComponent(emailForm.subject)}&body=${encodeURIComponent(emailForm.message)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" /> Buka Gmail
                </a>
                <a
                  href={`mailto:${emailForm.user.email}?subject=${encodeURIComponent(emailForm.subject)}&body=${encodeURIComponent(emailForm.message)}`}
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" /> Buka di aplikasi email
                </a>
              </div>
            </form>
          )}

          <div className="rounded-2xl bg-surface border border-white/10 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th className="p-3">Nama</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Pembelian</th>
                  <th>Dibuat</th>
                  <th>Terakhir terlihat</th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id} className={`border-t border-white/5 ${u.suspended_at ? 'bg-red-500/5' : ''}`}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" loading="lazy" className="w-7 h-7 rounded-lg object-cover border border-white/10 shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center text-[11px] font-black text-gray-300 shrink-0">
                            {(u.name || u.email || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span>{u.name}</span>
                      </div>
                      {u.bio && <div className="text-[10px] text-gray-500 max-w-[220px] truncate" title={u.bio}>{u.bio}</div>}
                      {u.is_super_admin && <span className="ml-2 px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold text-[10px]">SUPER ADMIN</span>}
                      <div className="text-[10px] text-gray-500">
                        {u.has_google && !u.has_password ? 'login Google' : u.has_password ? 'kata sandi' : 'tanpa kata sandi'}
                        {!u.email_verified_at && ' · email belum diverifikasi'}
                      </div>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {u.suspended_at ? (
                        <div title={u.suspended_reason || ''}>
                          <Badge cls="bg-red-500/20 text-red-300">Ditangguhkan</Badge>
                          <div className="text-[10px] text-gray-500 max-w-[160px] truncate">{u.suspended_reason || fmtTime(u.suspended_at)}</div>
                        </div>
                      ) : (
                        <Badge cls="bg-emerald-500/20 text-emerald-300">Aktif</Badge>
                      )}
                    </td>
                    <td className="text-xs text-gray-300">
                      {u.paid_orders} pesanan
                      <div className="text-[10px] text-gray-500">{u.owned_items} produk dimiliki</div>
                    </td>
                    <td className="text-gray-400 whitespace-nowrap">{fmtTime(u.created_at)}</td>
                    <td className="text-gray-400 whitespace-nowrap">{fmtTime(u.last_seen)}</td>
                    <td className="pr-3 text-right whitespace-nowrap">
                      <button onClick={() => setEmailForm({ user: u, subject: '', message: '' })} className="p-1.5 rounded-lg text-sky-300 hover:bg-sky-500/10" title="Kirim email">
                        <Mail className="w-4 h-4" />
                      </button>
                      <button onClick={() => setUserForm({ id: u.id, email: u.email, name: u.name || '', role: u.role || 'user', password: '', bio: u.bio || '', greeting: u.greeting || '', avatarUrl: u.avatar_url || '', removeAvatar: false })} className="p-1.5 rounded-lg text-gray-300 hover:bg-white/10" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!u.is_super_admin &&
                        (u.suspended_at ? (
                          <button onClick={() => restoreUser(u)} className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/10" title="Pulihkan akun">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={() => suspendUser(u)} className="p-1.5 rounded-lg text-accent hover:bg-accent/10" title="Tangguhkan akun">
                            <Ban className="w-4 h-4" />
                          </button>
                        ))}
                      {!u.is_super_admin && (
                        <button onClick={() => removeUser(u)} className="p-1.5 rounded-lg text-red-300 hover:bg-red-500/10" title="Hapus">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-xs text-gray-500">
                      Tidak ada pengguna.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
