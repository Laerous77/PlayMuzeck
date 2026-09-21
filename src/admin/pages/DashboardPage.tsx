import React, { useEffect, useState } from 'react';
import { Activity, Brain, Music, ShoppingBag, Users, Wallet } from 'lucide-react';
import { adminFetch } from '../adminApi';

interface AnalyticsPayload {
  totals: {
    tracks: number;
    topics: number;
    decks: number;
    users: number;
    orders: number;
    inquiries: number;
    events: number;
    openInquiries: number;
    revenue: number;
  };
  days: Array<{ date: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  recentEvents: Array<{ id: string; event_type: string; created_at: string; payload: Record<string, unknown> }>;
}

const rupiah = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

export const DashboardPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setData(await adminFetch<AnalyticsPayload>('/api/admin/analytics'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat analitik');
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) return <p className="text-gray-400">Memuat analitik...</p>;

  const maxDay = Math.max(1, ...data.days.map((d) => d.count));
  const cards = [
    { label: 'Pendapatan', value: rupiah(data.totals.revenue), icon: Wallet },
    { label: 'Pesanan', value: data.totals.orders, icon: ShoppingBag },
    { label: 'Pengguna', value: data.totals.users, icon: Users },
    { label: 'Event', value: data.totals.events, icon: Activity },
    { label: 'Track Audio', value: data.totals.tracks, icon: Music },
    { label: 'Deck Kuis', value: data.totals.decks, icon: Brain },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl bg-[#14213D] border border-white/10 p-4">
            <card.icon className="w-4 h-4 text-[#FCA311] mb-2" />
            <p className="text-xs text-gray-400">{card.label}</p>
            <p className="text-lg font-extrabold text-white">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-2xl bg-[#14213D] border border-white/10 p-5">
          <h3 className="font-bold text-white mb-4">Aktivitas 14 hari</h3>
          <div className="flex items-end gap-1 h-40">
            {data.days.map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-[#FCA311]"
                  style={{ height: `${Math.max(6, (day.count / maxDay) * 100)}%` }}
                  title={`${day.date}: ${day.count}`}
                />
                <span className="text-[9px] text-gray-500">{day.date.slice(8)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5">
          <h3 className="font-bold text-white mb-3">Event per jenis</h3>
          <div className="space-y-2">
            {data.byType.length === 0 && <p className="text-sm text-gray-400">Belum ada event.</p>}
            {data.byType.map((row) => (
              <div key={row.type} className="flex justify-between text-sm">
                <span className="text-gray-300">{row.type}</span>
                <span className="font-bold text-white">{row.count}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-200 mt-4">Inquiry terbuka: {data.totals.openInquiries}</p>
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
                <td className="py-2 text-gray-400 whitespace-nowrap">{event.created_at.replace('T', ' ').slice(0, 19)}</td>
                <td className="text-[#FCA311]">{event.event_type}</td>
                <td className="text-gray-300 truncate max-w-xl">{JSON.stringify(event.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
