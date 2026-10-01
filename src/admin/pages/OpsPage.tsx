import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X, Check, Loader2 } from 'lucide-react';
import { adminFetch } from '../adminApi';

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
}

interface CatalogOption {
  id: string;
  title: string;
}

// 'paid' = pengguna DIANGGAP SUDAH MEMBELI -> server otomatis memberi akses produk.
// Keluar dari 'paid' -> server mencabut akses (kalau dipilih).
const STATUSES = [
  { id: 'pending', label: 'Menunggu', cls: 'bg-amber-500/20 text-amber-300' },
  { id: 'paid', label: 'Berhasil', cls: 'bg-emerald-500/20 text-emerald-300' },
  { id: 'failed', label: 'Gagal', cls: 'bg-red-500/20 text-red-300' },
  { id: 'cancelled', label: 'Dibatalkan', cls: 'bg-gray-500/20 text-gray-300' },
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
const rupiah = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const fmtTime = (s: string) => (s || '').replace('T', ' ').slice(0, 19);

const itemLabel = (item: any): string => {
  if (!item) return '-';
  if (item.category === 'donation') return 'Donasi';
  const name = item.title || item.name || item.id || item.deckId || item.topicId || '?';
  const key = item.itemTypeKey && item.itemTypeKey !== 'all' ? ` (${item.itemTypeKey})` : item.itemTypeKey === 'all' ? ' (bundle)' : '';
  return `${name}${key}`;
};

type ItemKind = 'audio' | 'deck' | 'topic' | 'quizCreator';

interface NewOrderForm {
  user_email: string;
  customer_name: string;
  kind: 'cart' | 'donation';
  status: string;
  gross_amount: string;
  itemKind: ItemKind;
  refId: string; // id track / deck / topik
  theme: string; // badge/tema deck (opsional)
  audioKeys: string[];
  items: any[]; // keranjang yang sudah ditambahkan
}

const emptyForm: NewOrderForm = {
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

export const OpsPage: React.FC = () => {
  const [tab, setTab] = useState<'orders' | 'buyers' | 'inquiries' | 'users'>('orders');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tracks, setTracks] = useState<CatalogOption[]>([]);
  const [decks, setDecks] = useState<CatalogOption[]>([]);
  const [topics, setTopics] = useState<CatalogOption[]>([]);

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<NewOrderForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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
      setError(err instanceof Error ? err.message : 'Gagal memuat data.');
    }
  };

  useEffect(() => {
    load();
    // Katalog untuk pemilih produk (gagal = tidak fatal, ID bisa diketik manual).
    adminFetch<any[]>('/api/admin/tracks').then((r) => setTracks(r.map((t) => ({ id: t.id, title: t.title })))).catch(() => {});
    adminFetch<any[]>('/api/admin/decks').then((r) => setDecks(r.map((d) => ({ id: d.id, title: d.title })))).catch(() => {});
    adminFetch<any[]>('/api/admin/topics').then((r) => setTopics(r.map((t) => ({ id: t.id, title: t.title })))).catch(() => {});
  }, []);

  const ok = (m: string) => { setError(''); setMessage(m); };
  const fail = (err: unknown, fallback: string) => { setMessage(''); setError(err instanceof Error ? err.message : fallback); };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const s of STATUSES) c[s.id] = 0;
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const visible = useMemo(() => {
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
      await adminFetch(`/api/admin/payment-orders/${order.order_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, revoke }),
      });
      ok(
        status === 'paid'
          ? `Pesanan ${order.user_email} ditandai berhasil — akses produk diberikan.`
          : `Status pesanan ${order.user_email} → ${statusMeta(status).label}.`
      );
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
    if (!form) return;
    const id = form.refId.trim();
    if (form.itemKind !== 'quizCreator' && !id) return fail(null, 'Pilih atau isi ID produk dulu.');
    let newItems: any[] = [];
    if (form.itemKind === 'audio') {
      if (!form.audioKeys.length) return fail(null, 'Pilih minimal satu jenis produk audio.');
      const t = tracks.find((x) => x.id === id);
      newItems = form.audioKeys.map((k) => ({ category: 'audio', id, trackId: id, itemTypeKey: k, title: t?.title || id, price: 0 }));
    } else if (form.itemKind === 'deck') {
      const d = decks.find((x) => x.id === id);
      newItems = [{ category: 'deck', id, deckId: id, title: d?.title || id, badge: form.theme.trim() || undefined, price: 0 }];
    } else if (form.itemKind === 'topic') {
      const t = topics.find((x) => x.id === id);
      newItems = [{ category: 'topic', id, topicId: id, title: t?.title || id, price: 0 }];
    } else {
      newItems = [{ category: 'feature', id: 'quiz-creator-suite', itemTypeKey: 'quizCreatorSuite', title: 'Kreator Kuis', price: 0 }];
    }
    setError('');
    setForm({ ...form, items: [...form.items, ...newItems], refId: '', theme: '' });
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await adminFetch('/api/admin/payment-orders', {
        method: 'POST',
        body: JSON.stringify({
          user_email: form.user_email,
          customer_name: form.customer_name,
          kind: form.kind,
          status: form.status,
          gross_amount: Number(form.gross_amount) || 0,
          items: form.kind === 'cart' ? form.items : [],
        }),
      });
      ok(form.status === 'paid' ? 'Pesanan dibuat dan akses langsung diberikan.' : 'Pesanan manual dibuat.');
      setForm(null);
      await load();
    } catch (err) {
      fail(err, 'Gagal membuat pesanan.');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#FCA311]';
  const optionsFor = form?.itemKind === 'audio' ? tracks : form?.itemKind === 'deck' ? decks : topics;

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
            <button
              onClick={() => setForm({ ...emptyForm })}
              className="rounded-lg bg-[#FCA311] text-black font-bold px-3 py-1.5 text-xs flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Pesanan manual
            </button>
          </div>

          {form && (
            <form onSubmit={submitForm} className="rounded-2xl bg-[#14213D] border border-[#FCA311]/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">Tambah pesanan manual</h3>
                <button type="button" onClick={() => setForm(null)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-gray-400">
                  Email pengguna (harus sama dengan email akunnya)
                  <input required type="email" className={inputCls} value={form.user_email} onChange={(e) => setForm({ ...form, user_email: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Nama (opsional)
                  <input className={inputCls} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
                </label>
                <label className="text-xs text-gray-400">
                  Jenis
                  <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'cart' | 'donation' })}>
                    <option value="cart">Pembelian produk</option>
                    <option value="donation">Donasi</option>
                  </select>
                </label>
                <label className="text-xs text-gray-400">
                  Status awal
                  <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-400">
                  Nominal yang dibayar (Rp)
                  <input type="number" min={0} className={inputCls} value={form.gross_amount} onChange={(e) => setForm({ ...form, gross_amount: e.target.value })} />
                </label>
              </div>

              {form.kind === 'cart' && (
                <div className="rounded-xl border border-white/10 p-3 space-y-3">
                  <p className="text-xs font-semibold text-white">Produk di pesanan ini</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs text-gray-400">
                      Tipe produk
                      <select className={inputCls} value={form.itemKind} onChange={(e) => setForm({ ...form, itemKind: e.target.value as ItemKind, refId: '' })}>
                        <option value="audio">Audio (track)</option>
                        <option value="deck">Deck kuis</option>
                        <option value="topic">Topik kuis</option>
                        <option value="quizCreator">Kreator Kuis (fitur)</option>
                      </select>
                    </label>
                    {form.itemKind !== 'quizCreator' && (
                      <label className="text-xs text-gray-400">
                        Pilih / ketik ID
                        <input
                          list="ops-catalog"
                          className={inputCls}
                          value={form.refId}
                          onChange={(e) => setForm({ ...form, refId: e.target.value })}
                          placeholder="ID produk"
                        />
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

                  {form.itemKind === 'audio' && (
                    <div className="flex flex-wrap gap-2">
                      {AUDIO_PRODUCTS.map((p) => {
                        const on = form.audioKeys.includes(p.key);
                        return (
                          <button
                            type="button"
                            key={p.key}
                            onClick={() =>
                              setForm({ ...form, audioKeys: on ? form.audioKeys.filter((k) => k !== p.key) : [...form.audioKeys, p.key] })
                            }
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${on ? 'bg-[#FCA311] text-black' : 'bg-black/40 border border-white/10 text-gray-300'}`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {form.itemKind === 'deck' && (
                    <label className="text-xs text-gray-400 block">
                      Tema / badge deck (opsional, mis. Olahraga)
                      <input className={inputCls} value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} />
                    </label>
                  )}

                  <button type="button" onClick={addItem} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold">
                    + Tambahkan ke pesanan
                  </button>

                  {form.items.length > 0 && (
                    <ul className="space-y-1">
                      {form.items.map((it, idx) => (
                        <li key={idx} className="flex items-center justify-between text-xs text-gray-300 bg-black/30 rounded-lg px-2 py-1">
                          <span>{itemLabel(it)}</span>
                          <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })} className="text-red-300">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <button
                disabled={busy}
                className="rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60"
              >
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
                {visible.map((order) => {
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
                        <select
                          value={order.status}
                          onChange={(e) => changeStatus(order, e.target.value)}
                          className={`rounded-lg px-2 py-1 text-xs font-bold outline-none ${meta.cls}`}
                        >
                          {!STATUSES.some((s) => s.id === order.status) && <option value={order.status}>{order.status}</option>}
                          {STATUSES.map((s) => (
                            <option key={s.id} value={s.id} className="bg-[#14213D] text-white">
                              {s.label}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] mt-1 text-gray-500">{order.fulfilled ? 'akses aktif' : 'akses belum diberikan'}</div>
                      </td>
                      <td className="py-3 max-w-xs text-gray-400 text-xs">
                        {order.kind === 'donation' ? 'Donasi' : order.items.map(itemLabel).join(', ') || '-'}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <button onClick={() => removeOrder(order)} className="p-1.5 rounded-lg text-red-300 hover:bg-red-500/10" title="Hapus">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
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

      {tab === 'buyers' && (
        <div className="rounded-2xl bg-[#14213D] border border-white/10 overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
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
              {buyers.map((b) => (
                <tr key={b.email} className="border-t border-white/5">
                  <td className="p-3">
                    {b.name}
                    <div className="text-xs text-gray-500">{b.email}</div>
                  </td>
                  <td className="text-emerald-300 font-bold">{b.paid}</td>
                  <td className="text-red-300 font-bold">{b.failed}</td>
                  <td className="text-amber-300">{b.pending}</td>
                  <td className="text-gray-400">{b.cancelled}</td>
                  <td>{rupiah(b.spent)}</td>
                  <td>{b.owned_items}</td>
                  <td className="text-gray-400 whitespace-nowrap">{fmtTime(b.last_order)}</td>
                </tr>
              ))}
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
      )}

      {tab === 'inquiries' && (
        <div className="space-y-3">
          {inquiries.map((item) => (
            <div key={item.id} className="rounded-2xl bg-[#14213D] border border-white/10 p-4">
              <div className="flex justify-between gap-3">
                <div>
                  <h3 className="font-bold text-white">{item.title}</h3>
                  <p className="text-xs text-gray-400">
                    {item.email} · {item.genre} · {item.mood}
                  </p>
                </div>
                <select
                  value={item.status}
                  onChange={async (e) => {
                    await adminFetch(`/api/admin/inquiries/${item.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ status: e.target.value }),
                    });
                    await load();
                  }}
                  className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-sm"
                >
                  <option value="baru">baru</option>
                  <option value="proses">proses</option>
                  <option value="selesai">selesai</option>
                </select>
              </div>
              <p className="text-sm text-gray-300 mt-2">{item.notes}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'users' && (
        <div className="rounded-2xl bg-[#14213D] border border-white/10 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left">
              <tr>
                <th className="p-3">Nama</th>
                <th>Email</th>
                <th>Role</th>
                <th>Terakhir terlihat</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-white/5">
                  <td className="p-3">{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td className="text-gray-400">{user.last_seen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
