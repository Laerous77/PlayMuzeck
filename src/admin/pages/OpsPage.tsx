import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, X, Check, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { adminFetch } from '../adminApi';

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
  items: any[];
}

interface Buyer {
  email: string;
  name: string;
  paid: number;
  failed: number;
  pending: number;
  cancelled: number;
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
  is_super_admin: boolean;
}

interface CatalogOption {
  id: string;
  title: string;
}

// ---------- Konstanta & helper ----------
// 'paid' = pengguna DIANGGAP SUDAH MEMBELI -> server otomatis memberi akses produk.
const STATUSES = [
  { id: 'pending', label: 'Menunggu', cls: 'bg-amber-500/20 text-amber-300' },
  { id: 'paid', label: 'Berhasil', cls: 'bg-emerald-500/20 text-emerald-300' },
  { id: 'failed', label: 'Gagal', cls: 'bg-red-500/20 text-red-300' },
  { id: 'cancelled', label: 'Dibatalkan', cls: 'bg-gray-500/20 text-gray-300' },
] as const;

// Nilai di database tetap baru/proses/selesai; yang tampil: Menunggu/Diproses/Selesai.
const INQUIRY_STATUSES = [
  { id: 'baru', label: 'Menunggu', cls: 'bg-amber-500/20 text-amber-300' },
  { id: 'proses', label: 'Diproses', cls: 'bg-sky-500/20 text-sky-300' },
  { id: 'selesai', label: 'Selesai', cls: 'bg-emerald-500/20 text-emerald-300' },
] as const;

const AUDIO_PRODUCTS = [
  { key: 'fullMaster', label: 'Full Master' },
  { key: 'loopVersion', label: 'Loop' },
  { key: 'separatedStems', label: 'Stems' },
  { key: 'sheetMusic', label: 'Partitur' },
  { key: 'fullEditor8Bar', label: 'Editor 8 Bar' },
  { key: 'audioToolsSuite', label: 'Audio Tools' },
];

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
  const key =
    item.itemTypeKey === 'all' ? ' (bundle)' : item.itemTypeKey ? ` (${item.itemTypeKey})` : '';
  return `${name}${key}`;
};

const inputCls =
  'mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#FCA311]';

const Badge: React.FC<{ cls: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>
);

type ItemKind = 'audio' | 'deck' | 'topic' | 'quizCreator';

interface NewOrderForm {
  user_email: string;
  customer_name: string;
  kind: 'cart' | 'donation';
  status: string;
  gross_amount: string;
  itemKind: ItemKind;
  refId: string;
  theme: string;
  audioKeys: string[];
  items: any[];
}

const emptyOrderForm: NewOrderForm = {
  user_email: '',
  customer_name: '',
  kind: 'cart',
  status: 'paid',
  gross_amount: '0',
  itemKind: 'audio',
  refId: '',
  theme: '',
  audioKeys: ['fullMaster'],
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
}
const emptyUserForm: UserForm = { email: '', name: '', role: 'user', password: '' };

// ---------- Halaman ----------
export const OpsPage: React.FC = () => {
  const [tab, setTab] = useState<'orders' | 'buyers' | 'inquiries' | 'users'>('orders');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tracks, setTracks] = useState<CatalogOption[]>([]);
  const [decks, setDecks] = useState<CatalogOption[]>([]);
  const [topics, setTopics] = useState<CatalogOption[]>([]);

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
  const [userForm, setUserForm] = useState<UserForm | null>(null);

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
    adminFetch<any[]>('/api/admin/tracks').then((r) => setTracks(r.map((t) => ({ id: t.id, title: t.title })))).catch(() => {});
    adminFetch<any[]>('/api/admin/decks').then((r) => setDecks(r.map((d) => ({ id: d.id, title: d.title })))).catch(() => {});
    adminFetch<any[]>('/api/admin/topics').then((r) => setTopics(r.map((t) => ({ id: t.id, title: t.title })))).catch(() => {});
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

  const addItem = () => {
    if (!orderForm) return;
    const id = orderForm.refId.trim();
    if (orderForm.itemKind !== 'quizCreator' && !id) return fail(null, 'Pilih atau isi ID produk dulu.');
    let newItems: any[] = [];
    if (orderForm.itemKind === 'audio') {
      if (!orderForm.audioKeys.length) return fail(null, 'Pilih minimal satu jenis produk audio.');
      const t = tracks.find((x) => x.id === id);
      newItems = orderForm.audioKeys.map((k) => ({ category: 'audio', id, trackId: id, itemTypeKey: k, title: t?.title || id, price: 0 }));
    } else if (orderForm.itemKind === 'deck') {
      const d = decks.find((x) => x.id === id);
      newItems = [{ category: 'deck', id, deckId: id, title: d?.title || id, badge: orderForm.theme.trim() || undefined, price: 0 }];
    } else if (orderForm.itemKind === 'topic') {
      const t = topics.find((x) => x.id === id);
      newItems = [{ category: 'topic', id, topicId: id, title: t?.title || id, price: 0 }];
    } else {
      newItems = [{ category: 'feature', id: 'quiz-creator-suite', itemTypeKey: 'quizCreatorSuite', title: 'Kreator Kuis', price: 0 }];
    }
    setError('');
    setOrderForm({ ...orderForm, items: [...orderForm.items, ...newItems], refId: '', theme: '' });
  };

  const submitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForm) return;
    setBusy(true);
    try {
      await adminFetch('/api/admin/payment-orders', {
        method: 'POST',
        body: JSON.stringify({
          user_email: orderForm.user_email,
          customer_name: orderForm.customer_name,
          kind: orderForm.kind,
          status: orderForm.status,
          gross_amount: Number(orderForm.gross_amount) || 0,
          items: orderForm.kind === 'cart' ? orderForm.items : [],
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
    return users.filter((u) => !q || u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q));
  }, [users, userSearch]);

  const submitUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm) return;
    setBusy(true);
    try {
      if (userForm.id) {
        const body: Record<string, string> = { name: userForm.name, role: userForm.role };
        if (userForm.password) body.password = userForm.password;
        await adminFetch(`/api/admin/users/${userForm.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        ok('Pengguna diperbarui.');
      } else {
        await adminFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(userForm) });
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

  const optionsFor = orderForm?.itemKind === 'audio' ? tracks : orderForm?.itemKind === 'deck' ? decks : topics;

  return (
    <div className="space-y-4">
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
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === id ? 'bg-[#FCA311] text-black' : 'bg-[#14213D] border border-white/10'}`}
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
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filter === s.id ? 'bg-white text-black' : 'bg-[#14213D] border border-white/10 text-gray-300'}`}
              >
                {s.label} ({counts[s.id] ?? 0})
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari email / nama / ID..."
              className="ml-auto rounded-lg bg-black/40 border border-white/10 px-3 py-1.5 text-xs text-white outline-none focus:border-[#FCA311]"
            />
            <button onClick={() => setOrderForm({ ...emptyOrderForm })} className="rounded-lg bg-[#FCA311] text-black font-bold px-3 py-1.5 text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Pesanan manual
            </button>
          </div>

          {orderForm && (
            <form onSubmit={submitOrder} className="rounded-2xl bg-[#14213D] border border-[#FCA311]/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">Tambah pesanan manual</h3>
                <button type="button" onClick={() => setOrderForm(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">
                  Email pengguna (harus sama dengan email akunnya)
                  <input required type="email" list="ops-user-emails" className={inputCls} value={orderForm.user_email} onChange={(e) => setOrderForm({ ...orderForm, user_email: e.target.value })} />
                  <datalist id="ops-user-emails">
                    {users.map((u) => (
                      <option key={u.id} value={u.email}>
                        {u.name}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="text-xs text-gray-400">
                  Nama (opsional)
                  <input className={inputCls} value={orderForm.customer_name} onChange={(e) => setOrderForm({ ...orderForm, customer_name: e.target.value })} />
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
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-400">
                  Nominal yang dibayar (Rp)
                  <input type="number" min={0} className={inputCls} value={orderForm.gross_amount} onChange={(e) => setOrderForm({ ...orderForm, gross_amount: e.target.value })} />
                </label>
              </div>

              {orderForm.kind === 'cart' && (
                <div className="rounded-xl border border-white/10 p-3 space-y-3">
                  <p className="text-xs font-semibold text-white">Produk di pesanan ini</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs text-gray-400">
                      Tipe produk
                      <select className={inputCls} value={orderForm.itemKind} onChange={(e) => setOrderForm({ ...orderForm, itemKind: e.target.value as ItemKind, refId: '' })}>
                        <option value="audio">Audio (track)</option>
                        <option value="deck">Deck kuis</option>
                        <option value="topic">Topik kuis</option>
                        <option value="quizCreator">Kreator Kuis (fitur)</option>
                      </select>
                    </label>
                    {orderForm.itemKind !== 'quizCreator' && (
                      <label className="text-xs text-gray-400">
                        Pilih / ketik ID
                        <input list="ops-catalog" className={inputCls} value={orderForm.refId} onChange={(e) => setOrderForm({ ...orderForm, refId: e.target.value })} placeholder="ID produk" />
                        <datalist id="ops-catalog">
                          {optionsFor.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.title}
                            </option>
                          ))}
                        </datalist>
                      </label>
                    )}
                  </div>
                  {orderForm.itemKind === 'audio' && (
                    <div className="flex flex-wrap gap-2">
                      {AUDIO_PRODUCTS.map((p) => {
                        const on = orderForm.audioKeys.includes(p.key);
                        return (
                          <button
                            type="button"
                            key={p.key}
                            onClick={() => setOrderForm({ ...orderForm, audioKeys: on ? orderForm.audioKeys.filter((k) => k !== p.key) : [...orderForm.audioKeys, p.key] })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${on ? 'bg-[#FCA311] text-black' : 'bg-black/40 border border-white/10 text-gray-300'}`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {orderForm.itemKind === 'deck' && (
                    <label className="text-xs text-gray-400 block">
                      Tema / badge deck (opsional, mis. Olahraga)
                      <input className={inputCls} value={orderForm.theme} onChange={(e) => setOrderForm({ ...orderForm, theme: e.target.value })} />
                    </label>
                  )}
                  <button type="button" onClick={addItem} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold">
                    + Tambahkan ke pesanan
                  </button>
                  {orderForm.items.length > 0 && (
                    <ul className="space-y-1">
                      {orderForm.items.map((it, idx) => (
                        <li key={idx} className="flex items-center justify-between text-xs text-gray-300 bg-black/30 rounded-lg px-2 py-1">
                          <span>{itemLabel(it)}</span>
                          <button type="button" onClick={() => setOrderForm({ ...orderForm, items: orderForm.items.filter((_, i) => i !== idx) })} className="text-red-300">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <button disabled={busy} className="rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Simpan pesanan
              </button>
            </form>
          )}

          <div className="rounded-2xl bg-[#14213D] border border-white/10 overflow-x-auto">
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
                        <button onClick={() => editAmount(order)} className="hover:text-[#FCA311]" title="Klik untuk ubah nominal">
                          {rupiah(order.gross_amount)}
                        </button>
                      </td>
                      <td className="py-3">
                        <select value={order.status} onChange={(e) => changeStatus(order, e.target.value)} className={`rounded-lg px-2 py-1 text-xs font-bold outline-none ${meta.cls}`}>
                          {!STATUSES.some((s) => s.id === order.status) && <option value={order.status}>{order.status}</option>}
                          {STATUSES.map((s) => (
                            <option key={s.id} value={s.id} className="bg-[#14213D] text-white">
                              {s.label}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] mt-1 text-gray-500">{order.fulfilled ? 'akses aktif' : 'akses belum diberikan'}</div>
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
          <div className="rounded-2xl bg-[#14213D] border border-white/10 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th className="p-3">Pengguna</th>
                  <th>Berhasil</th>
                  <th>Gagal</th>
                  <th>Menunggu</th>
                  <th>Batal</th>
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
                            {open ? <ChevronDown className="w-4 h-4 text-[#FCA311]" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                            <div>
                              {b.name}
                              <div className="text-xs text-gray-500">{b.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-emerald-300 font-bold">{b.paid}</td>
                        <td className="text-red-300 font-bold">{b.failed}</td>
                        <td className="text-amber-300">{b.pending}</td>
                        <td className="text-gray-400">{b.cancelled}</td>
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
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${inqFilter === s.id ? 'bg-white text-black' : 'bg-[#14213D] border border-white/10 text-gray-300'}`}
              >
                {s.label} ({inqCounts[s.id] ?? 0})
              </button>
            ))}
            <button onClick={() => setInqForm({ ...emptyInquiryForm })} className="ml-auto rounded-lg bg-[#FCA311] text-black font-bold px-3 py-1.5 text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Tambah
            </button>
          </div>

          {inqForm && (
            <form onSubmit={submitInquiry} className="rounded-2xl bg-[#14213D] border border-[#FCA311]/40 p-5 space-y-3">
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
              <button disabled={busy} className="rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Simpan
              </button>
            </form>
          )}

          {visibleInquiries.map((item) => {
            const meta = inquiryMeta(item.status);
            return (
              <div key={item.id} className="rounded-2xl bg-[#14213D] border border-white/10 p-4">
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
                        <option key={s.id} value={s.id} className="bg-[#14213D] text-white">
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
            <p className="text-xs text-gray-400">Data langsung dari tabel users di database.</p>
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Cari nama / email..."
              className="ml-auto rounded-lg bg-black/40 border border-white/10 px-3 py-1.5 text-xs text-white outline-none focus:border-[#FCA311]"
            />
            <button onClick={() => setUserForm({ ...emptyUserForm })} className="rounded-lg bg-[#FCA311] text-black font-bold px-3 py-1.5 text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Pengguna
            </button>
          </div>

          {userForm && (
            <form onSubmit={submitUser} className="rounded-2xl bg-[#14213D] border border-[#FCA311]/40 p-5 space-y-3">
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
              <button disabled={busy} className="rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Simpan
              </button>
            </form>
          )}

          <div className="rounded-2xl bg-[#14213D] border border-white/10 overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th className="p-3">Nama</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Dibuat</th>
                  <th>Terakhir terlihat</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id} className="border-t border-white/5">
                    <td className="p-3">
                      {u.name}
                      {u.is_super_admin && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/20 text-[#FCA311] font-bold text-[10px]">SUPER ADMIN</span>}
                      {!u.has_password && <div className="text-[10px] text-gray-500">tanpa kata sandi (login Google)</div>}
                    </td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td className="text-gray-400 whitespace-nowrap">{fmtTime(u.created_at)}</td>
                    <td className="text-gray-400 whitespace-nowrap">{fmtTime(u.last_seen)}</td>
                    <td className="pr-3 text-right whitespace-nowrap">
                      <button onClick={() => setUserForm({ id: u.id, email: u.email, name: u.name || '', role: u.role || 'user', password: '' })} className="p-1.5 rounded-lg text-gray-300 hover:bg-white/10" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
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
                    <td colSpan={6} className="p-4 text-center text-xs text-gray-500">
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
