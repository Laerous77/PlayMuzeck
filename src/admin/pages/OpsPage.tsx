import React, { useEffect, useState } from 'react';
import { adminFetch } from '../adminApi';

interface OrderRow {
  id: string;
  customer_name: string;
  customer_email: string;
  total: number;
  status: string;
  created_at: string;
  items: unknown[];
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

export const OpsPage: React.FC = () => {
  const [tab, setTab] = useState<'orders' | 'inquiries' | 'users'>('orders');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  const load = async () => {
    const [o, i, u] = await Promise.all([
      adminFetch<OrderRow[]>('/api/admin/orders'),
      adminFetch<InquiryRow[]>('/api/admin/inquiries'),
      adminFetch<UserRow[]>('/api/admin/users'),
    ]);
    setOrders(o);
    setInquiries(i);
    setUsers(u);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[
          ['orders', `Pesanan (${orders.length})`],
          ['inquiries', `Custom audio (${inquiries.length})`],
          ['users', `Pengguna (${users.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === id ? 'bg-[#FCA311] text-black' : 'bg-[#14213D] border border-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <div className="rounded-2xl bg-[#14213D] border border-white/10 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400 text-left">
              <tr>
                <th className="p-3">Waktu</th>
                <th>Pelanggan</th>
                <th>Total</th>
                <th>Status</th>
                <th>Item</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-white/5">
                  <td className="p-3 text-gray-400">{order.created_at.replace('T', ' ').slice(0, 19)}</td>
                  <td>
                    {order.customer_name}
                    <div className="text-xs text-gray-500">{order.customer_email}</div>
                  </td>
                  <td>Rp {Number(order.total).toLocaleString('id-ID')}</td>
                  <td>{order.status}</td>
                  <td className="max-w-sm truncate text-gray-400">{JSON.stringify(order.items)}</td>
                </tr>
              ))}
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
