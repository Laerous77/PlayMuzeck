import React, { useEffect, useState } from 'react';
import { Activity, Brain, Heart, Music, ShoppingBag, UserCheck, Users, Wallet, Clock, MessageSquare } from 'lucide-react';
import { adminFetch } from '../adminApi';
import { BUILTIN_DECKS } from '../../data/quiz';

interface DayRow {
  date: string;
  events: number;
  orders: number;
  revenue: number;
  users: number;
}

interface AnalyticsPayload {
  totals: {
    tracks: number;
    topics: number;
    decks: number;
    customDecks: number;
    deckIds?: string[];
    users: number;
    newUsers7d: number;
    suspendedUsers: number;
    orders: number;
    pendingOrders: number;
    buyers: number;
    revenue: number;
    donations: number;
    inquiries: number;
    openInquiries: number;
    events: number;
  };
  days: DayRow[];
  byType: Array<{ type: string; count: number }>;
  topProducts: Array<{ title: string; type_key: string; sold: number }>;
  orderStatuses: Array<{ status: string; count: number }>;
  recentEvents: Array<{ id: string; event_type: string; created_at: string; payload: Record<string, unknown> }>;
  recentOrders: Array<{ order_id: string; user_email: string; kind: string; gross_amount: number; status: string; created_at: string }>;
}

type Metric = 'events' | 'revenue' | 'orders' | 'users';

const METRICS: Array<{ id: Metric; label: string }> = [
  { id: 'events', label: 'Event' },
  { id: 'revenue', label: 'Pendapatan' },
  { id: 'orders', label: 'Pesanan' },
  { id: 'users', label: 'Pengguna baru' },
];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Berhasil', cls: 'text-emerald-300' },
  pending: { label: 'Menunggu', cls: 'text-amber-300' },
  failed: { label: 'Gagal', cls: 'text-red-300' },
  cancelled: { label: 'Dibatalkan', cls: 'text-gray-400' },
};

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

const rupiah = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const fmtTime = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
};

export const DashboardPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState<Metric>('events');

  const load = async () => {
    try {
      setData(await adminFetch<AnalyticsPayload>('/api/admin/analytics'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat analitik');
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  if (!data) return <p className={error ? 'text-red-400' : 'text-gray-400'}>{error || 'Memuat analitik...'}</p>;

  const t = data.totals;
  // Deck bawaan hanya ada di kode frontend, bukan di tabel decks — hitung terpisah (hindari dobel bila id-nya juga ada di DB).
  const dbIds = new Set(t.deckIds || []);
  const builtinCount = BUILTIN_DECKS.filter((b) => !dbIds.has(b.id)).length;
  const values = data.days.map((d) => d[metric]);
  const maxVal = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const fmtMetric = (n: number) => (metric === 'revenue' ? rupiah(n) : String(n));

  const cards = [
    { label: 'Pendapatan', value: rupiah(t.revenue), sub: t.donations ? `termasuk donasi ${rupiah(t.donations)}` : 'pesanan berhasil', icon: Wallet },
    { label: 'Pesanan berhasil', value: t.orders, sub: `${t.pendingOrders} menunggu`, icon: ShoppingBag },
    { label: 'Pembeli', value: t.buyers, sub: 'akun unik', icon: UserCheck },
    { label: 'Pengguna', value: t.users, sub: `+${t.newUsers7d} 7 hari${t.suspendedUsers ? ` · ${t.suspendedUsers} ditangguhkan` : ''}`, icon: Users },
    { label: 'Event', value: t.events, sub: 'total tercatat', icon: Activity },
    { label: 'Track audio', value: t.tracks, sub: 'di katalog', icon: Music },
    { label: 'Kuis', value: builtinCount + t.decks + (t.customDecks || 0), sub: `${builtinCount} bawaan · ${t.decks} admin · ${t.customDecks || 0} pengguna`, icon: Brain },
    { label: 'Pesan masuk', value: t.openInquiries, sub: `${t.inquiries} total`, icon: MessageSquare },
  ];

  return (
    <div className="space-y-6">
      {error && <p className="text-xs text-red-400">Pembaruan terakhir gagal: {error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl bg-[#14213D] border border-white/10 p-4">
            <card.icon className="w-4 h-4 text-[#FCA311] mb-2" />
            <p className="text-xs text-gray-400">{card.label}</p>
            <p className="text-lg font-extrabold text-white break-words">{card.value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-2xl bg-[#14213D] border border-white/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="font-bold text-white">Aktivitas 14 hari terakhir</h3>
              <p className="text-[11px] text-gray-500">
                Total {fmtMetric(total)} · zona waktu WIB · kiri = lama, kanan = hari ini
              </p>
            </div>
            <div className="flex gap-1">
              {METRICS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMetric(m.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${metric === m.id ? 'bg-[#FCA311] text-black' : 'bg-black/30 text-gray-300'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-1 h-40">
            {data.days.map((day) => {
              const v = day[metric];
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                  <div
                    className={`w-full rounded-t ${v > 0 ? 'bg-[#FCA311]' : 'bg-white/10'}`}
                    style={{ height: `${v > 0 ? Math.max(6, (v / maxVal) * 100) : 3}%` }}
                    title={`${day.date}: ${fmtMetric(v)}`}
                  />
                  <span className="text-[9px] text-gray-500">{day.date.slice(8)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 space-y-5">
          <div>
            <h3 className="font-bold text-white mb-3">Status pesanan</h3>
            <div className="space-y-1.5">
              {data.orderStatuses.length === 0 && <p className="text-sm text-gray-400">Belum ada pesanan.</p>}
              {data.orderStatuses.map((s) => {
                const meta = STATUS_LABEL[s.status] ?? { label: s.status, cls: 'text-gray-300' };
                return (
                  <div key={s.status} className="flex justify-between text-sm">
                    <span className={meta.cls}>{meta.label}</span>
                    <span className="font-bold text-white">{s.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <h3 className="font-bold text-white mb-3">Event per jenis</h3>
            <div className="space-y-1.5">
              {data.byType.length === 0 && <p className="text-sm text-gray-400">Belum ada event.</p>}
              {data.byType.map((row) => (
                <div key={row.type} className="flex justify-between text-sm">
                  <span className="text-gray-300 truncate pr-2">{row.type}</span>
                  <span className="font-bold text-white">{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5">
          <h3 className="font-bold text-white mb-3 flex items-center gap-2">
            <Heart className="w-4 h-4 text-[#FCA311]" /> Produk terlaris
          </h3>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-gray-400">Belum ada penjualan.</p>
          ) : (
            <div className="space-y-2">
              {data.topProducts.map((p, i) => (
                <div key={`${p.title}-${p.type_key}-${i}`} className="flex items-center justify-between text-sm gap-3">
                  <span className="text-gray-200 truncate">
                    {p.title}
                    {p.type_key && <span className="text-gray-500"> · {KEY_LABEL[p.type_key] ?? p.type_key}</span>}
                  </span>
                  <span className="font-bold text-white shrink-0">{p.sold}×</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 overflow-x-auto">
          <h3 className="font-bold text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#FCA311]" /> Pesanan terbaru
          </h3>
          <table className="w-full text-sm min-w-[360px]">
            <tbody>
              {data.recentOrders.length === 0 && (
                <tr>
                  <td className="text-gray-400 text-sm">Belum ada pesanan.</td>
                </tr>
              )}
              {data.recentOrders.map((o) => {
                const meta = STATUS_LABEL[o.status] ?? { label: o.status, cls: 'text-gray-300' };
                return (
                  <tr key={o.order_id} className="border-t border-white/5 first:border-0">
                    <td className="py-2 pr-2">
                      <div className="text-gray-200 truncate max-w-[200px]">{o.user_email}</div>
                      <div className="text-[10px] text-gray-500">{fmtTime(o.created_at)}</div>
                    </td>
                    <td className="text-white whitespace-nowrap">{rupiah(o.gross_amount)}</td>
                    <td className={`text-xs font-bold text-right ${meta.cls}`}>{meta.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 overflow-x-auto">
        <h3 className="font-bold text-white mb-3">Event terbaru</h3>
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-left">
            <tr>
              <th className="py-2">Waktu</th>
              <th>Jenis</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {data.recentEvents.map((event) => (
              <tr key={event.id} className="border-t border-white/5">
                <td className="py-2 text-gray-400 whitespace-nowrap">{fmtTime(event.created_at)}</td>
                <td className="text-[#FCA311]">{event.event_type}</td>
                <td className="text-gray-300 truncate max-w-xl">{JSON.stringify(event.payload)}</td>
              </tr>
            ))}
            {data.recentEvents.length === 0 && (
              <tr>
                <td colSpan={3} className="py-3 text-gray-500 text-center text-xs">
                  Belum ada event.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
};
