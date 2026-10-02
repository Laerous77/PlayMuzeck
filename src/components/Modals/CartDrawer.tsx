// src/components/Modals/CartDrawer.tsx
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Trash2,
  QrCode,
  CheckCircle2,
  ShoppingBag,
  ArrowRight,
  ShieldCheck,
  FileText,
  ChevronLeft,
  User,
  Mail,
  Download,
  Loader2,
} from 'lucide-react';
import { CartItem } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { downloadBlob } from '../../services/exporters';
import { storage } from '../../services/storage';
import {
  payWithQris,
  resumePayment,
  getPendingOrders,
  cancelPendingOrder,
  getPaymentStatus,
  formatDeadline,
  timeLeftLabel,
  PendingOrder,
  QrisHandlers,
} from '../../services/payment';
import { Clock as ClockIcon, Ban as BanIcon, RefreshCw as RefreshIcon } from 'lucide-react';
import { QrisPanel } from './QrisPanel';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onRemoveItem: (id: string) => void;
  /** purchasedItems = item pesanan yang benar-benar dibayar; App hanya membuang item ini dari keranjang. */
  onCheckoutSuccess: (purchasedItems?: CartItem[]) => void;
  onOpenLibrary: () => void;
  onSuccessToast?: (msg: string) => void;
}

type CheckoutStep = 'cart' | 'buyer_data' | 'payment_process' | 'success';

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cartItems,
  onRemoveItem,
  onCheckoutSuccess,
  onOpenLibrary,
  onSuccessToast,
}) => {
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('cart');
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);
  const [isSyncingWithDB, setIsSyncingWithDB] = useState(false);
  // Pesan galat NYATA dari server saat pencatatan pembelian gagal (sebelumnya
  // hanya alert generik sehingga penyebab sebenarnya tidak pernah terlihat).
  const [syncError, setSyncError] = useState<string | null>(null);
  // Invoice yang sedang berjalan. Dipertahankan supaya "Coba Simpan Ulang"
  // memakai invoice yang SAMA, bukan membuat invoice baru tiap klik.
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);

  // Model pesanan seperti marketplace: pesanan 'Menunggu' dibuat di server begitu checkout dibuka.
  // Menutup popup Snap / drawer TIDAK membatalkannya; pembeli harus bayar atau membatalkan sendiri.
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  // true hanya di mode demo server (panel QRIS lokal tanpa pesanan di server).
  const [demoFlow, setDemoFlow] = useState(false);
  const demoFlowRef = useRef(false);
  const finishingRef = useRef(false);
  const [, setTick] = useState(0); // render ulang hitung mundur

  const userSession = storage.getUserSession();

  // PERBAIKAN: nilai awal dulunya hardcode ke akun palsu ('Tuan Hiang' /
  // hiang@playmuzeck.id). Kalau state ini sempat dipakai sebelum sinkronisasi
  // di bawah selesai (misalnya render pertama), pembeli lain bisa saja
  // ter-checkout memakai identitas orang lain. Sekarang mulai dari data sesi
  // yang sebenarnya (atau kosong), tidak pernah dari nama/email bukan milik
  // user yang sedang login.
  const [buyerName, setBuyerName] = useState(userSession?.name || '');
  const [buyerEmail, setBuyerEmail] = useState(userSession?.email || '');

  // BUG SEBELUMNYA: useState(initialValue) di atas cuma dievaluasi SEKALI
  // saat CartDrawer pertama kali mount — kalau itu terjadi sebelum user
  // login, buyerName/buyerEmail terkunci selamanya ke nilai placeholder,
  // walau user login belakangan atau BERGANTI AKUN (logout lalu login akun
  // lain). Field-nya readOnly juga, jadi user tidak bisa memperbaikinya
  // manual. Akibatnya checkout bisa mengirim email akun yang SALAH / tidak
  // ada di tabel `users`. Fix: re-sync setiap kali drawer dibuka atau sesi
  // user berubah (login/logout/ganti akun), dan reset nomor telepon supaya
  // tidak ada sisa data dari sesi pengguna sebelumnya di perangkat yang sama.
  useEffect(() => {
    if (isOpen) {
      const freshSession = storage.getUserSession();
      setBuyerName(freshSession?.name || '');
      setBuyerEmail(freshSession?.email || '');
    }
  }, [isOpen, userSession?.email]);

  const [completedOrder, setCompletedOrder] = useState<{
    invoiceId: string;
    timestamp: string;
    items: CartItem[];
    total: number;
    paymentMethodName: string;
    buyer: { name: string; email: string };
  } | null>(null);

  // Muat pesanan 'Menunggu' milik pembeli (dipanggil saat drawer dibuka & berkala). Mengembalikan state
  // layar ke "Menunggu Pembayaran" bila ada pesanan yang belum selesai.
  const loadPending = async () => {
    if (!storage.getUserSession()?.isLoggedIn) return;
    const list = await getPendingOrders();
    if (list === null) return; // gagal memuat: jangan ubah tampilan
    const cartOrder = list.find((o) => o.kind === 'cart') || null;

    if (cartOrder && cartOrder.status === 'paid') {
      // Sudah dibayar tapi akses belum diaktifkan (mis. popup ditutup setelah membayar) -> aktifkan otomatis.
      if (finishingRef.current) return;
      finishingRef.current = true;
      setPendingOrder(cartOrder);
      try {
        await handleFinishTransaction(cartOrder.orderId, { items: cartOrder.items, total: cartOrder.amount });
      } finally {
        finishingRef.current = false;
      }
      return;
    }

    setPendingOrder(cartOrder);
    if (cartOrder) {
      setActiveInvoiceId(cartOrder.orderId);
      setCurrentStep((s) => (s === 'success' ? s : 'payment_process'));
    } else {
      setCurrentStep((s) => (s === 'payment_process' && !demoFlowRef.current ? 'cart' : s));
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setIsLoadingPending(true);
    loadPending().finally(() => {
      if (alive) setIsLoadingPending(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Selama ada pesanan menunggu: segarkan hitung mundur & cek status tiap 30 detik
  // (menangkap pembayaran yang masuk lewat webhook dan pesanan yang melewati batas bayar).
  useEffect(() => {
    if (!isOpen || !pendingOrder) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      loadPending();
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingOrder?.orderId]);

  const subtotal = cartItems.reduce((sum, item) => sum + item.price, 0);
  const tax = Math.round(subtotal * 0.11);
  const grandTotal = subtotal + tax;

  const formatIDR = (val: number) => `Rp${val.toLocaleString('id-ID')}`;

  const handleProceedToBuyerData = () => {
    if (cartItems.length === 0) return;
    if (isLoadingPending) return; // tunggu cek pesanan menunggu selesai
    if (!userSession?.isLoggedIn) {
      alert("Harap login terlebih dahulu untuk melanjutkan proses checkout. Data pembelian akan diikat secara permanen pada akun Anda di database.");
      return;
    }
    setCurrentStep('buyer_data');
  };

  const syncPurchasesToDatabase = async (
    invoiceId: string,
    override?: { items: any[]; total: number }
  ): Promise<{ ok: boolean; message?: string; partialWarning?: string }> => {
    setIsSyncingWithDB(true);
    try {
      // Seluruh field item dikirim APA ADANYA (`...item`). Sebelumnya payload
      // hanya memilih id/trackId/deckId/topicId/category/itemTypeKey, sehingga
      // field tambahan milik item bundle (daftar produk yang ikut terbeli,
      // dsb.) terbuang di klien dan server hanya mengaktifkan satu produk
      // (Master). Field `id` tetap dinormalisasi ke id asli trek/deck/topik.
      const payload = {
        invoiceId,
        email: buyerEmail,
        items: (override && override.items.length ? override.items : cartItems).map((item: any) => ({
          ...item,
          id: item.category === 'audio' ? (item.trackId || item.id) : (item.deckId || item.topicId || item.id),
          cartItemId: item.cartItemId ?? item.id,
        })),
        totalPaid: override ? override.total : grandTotal,
      };

      const res = await fetch('/api/user/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const detail = body?.error || body?.message || `HTTP ${res.status}`;
        throw new Error(`Server menolak pencatatan pembelian: ${detail}`);
      }

      // PERBAIKAN: server sekarang bisa membalas 207 (sukses sebagian) kalau
      // ada item yang gagal dicatat tapi item lain berhasil. Sebelumnya kode
      // ini hanya cek res.ok (yang tetap true untuk 207), jadi kegagalan
      // sebagian item tidak pernah terlihat oleh pengguna — transaksi
      // dianggap 100% sukses walau sebenarnya sebagian produk tidak
      // tersimpan. Sekarang kegagalan sebagian ditampilkan jelas.
      if (body?.partial && Array.isArray(body?.failed) && body.failed.length > 0) {
        const namesFailed = body.failed
          .map((f: any) => f?.item?.title || f?.item?.id || 'produk')
          .join(', ');
        return {
          ok: true,
          partialWarning: `${body.failed.length} produk GAGAL tersimpan (${namesFailed}). Produk lain sudah tercatat. Hubungi kami lewat menu "Hubungi Kami" dengan invoice ini agar segera diperbaiki manual.`,
        };
      }

      return { ok: true };
    } catch (error: any) {
      console.error('[DB Sync Error] Pembelian belum sepenuhnya tersimpan di server.', error);
      return { ok: false, message: error?.message || 'Gagal terhubung ke server.' };
    } finally {
      setIsSyncingWithDB(false);
    }
  };

  const handleFinishTransaction = async (invoiceId: string, override?: { items: any[]; total: number }) => {
    setSyncError(null);
    setActiveInvoiceId(invoiceId);
    const result = await syncPurchasesToDatabase(invoiceId, override);
    if (!result.ok) {
      // Tetap di layar QRIS dan tampilkan alasan sebenarnya + tombol coba ulang.
      setSyncError(`${result.message} (Invoice: ${invoiceId})`);
      setCurrentStep('payment_process');
      return;
    }
    if (result.partialWarning && onSuccessToast) {
      onSuccessToast(result.partialWarning);
    }
    const now = new Date();
    const formattedDate = `${now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;

    setCompletedOrder({
      invoiceId,
      timestamp: formattedDate,
      items: override && override.items.length ? [...override.items] : [...cartItems],
      total: override ? override.total : grandTotal,
      paymentMethodName: 'QRIS Dinamis (Midtrans Verified)',
      buyer: { name: buyerName, email: buyerEmail },
    });

    setPendingOrder(null);
    setCurrentStep('success');
    audioEngine.playCorrectSound();
    // Hanya item yang ada di PESANAN ini yang dianggap terbeli (item yang ditambahkan belakangan tetap di keranjang).
    onCheckoutSuccess(((override && override.items.length ? override.items : cartItems) as unknown) as CartItem[]);
  };

  // Handler Snap yang sama untuk "Bayar" pertama kali maupun "Bayar Sekarang" (lanjutkan).
  const buildSnapHandlers = (
    orderId: string,
    order?: { items: any[]; total: number },
    extra?: Partial<QrisHandlers>
  ): QrisHandlers => ({
    onSuccess: () => {
      setIsProcessingCheckout(false);
      handleFinishTransaction(orderId, order);
    },
    onPending: () => {
      setIsProcessingCheckout(false);
      setCurrentStep('payment_process');
      if (onSuccessToast) onSuccessToast('Menunggu Anda menyelesaikan pembayaran QRIS...');
    },
    onError: (msg, code) => {
      setIsProcessingCheckout(false);
      if (code === 'PENDING_EXISTS') {
        // Masih ada pesanan lain yang menunggu: tampilkan, jangan buat yang baru.
        loadPending();
        if (onSuccessToast) onSuccessToast(msg || 'Masih ada pesanan yang menunggu pembayaran.');
        return;
      }
      if (code === 'GONE') {
        loadPending();
        if (onSuccessToast) onSuccessToast(msg || 'Pesanan ini sudah tidak bisa dilanjutkan.');
        return;
      }
      alert(msg || 'Pembayaran Midtrans QRIS gagal atau dibatalkan.');
    },
    // Menutup popup TIDAK membatalkan pesanan: pembeli kembali ke layar "Menunggu Pembayaran".
    onClose: () => setIsProcessingCheckout(false),
    ...extra,
  });

  const handleResumePayment = async () => {
    if (!pendingOrder) return;
    setIsProcessingCheckout(true);
    setSyncError(null);
    const opened = await resumePayment(
      pendingOrder.orderId,
      buildSnapHandlers(pendingOrder.orderId, { items: pendingOrder.items, total: pendingOrder.amount })
    );
    if (!opened) setIsProcessingCheckout(false);
  };

  const handleCancelPending = async () => {
    if (!pendingOrder || isCancelling) return;
    if (!confirm('Batalkan pesanan ini?\n\nPembayaran yang belum dilakukan tidak akan diproses. Item tetap ada di keranjang dan kamu bisa membuat pesanan baru.')) return;
    setIsCancelling(true);
    const ok = await cancelPendingOrder(pendingOrder.orderId);
    setIsCancelling(false);
    if (!ok) {
      // Mungkin sudah lunas / sudah dibatalkan oleh batas bayar: ambil status terbaru dari server.
      await loadPending();
      if (onSuccessToast) onSuccessToast('Pesanan tidak bisa dibatalkan (mungkin sudah dibayar atau sudah dibatalkan).');
      return;
    }
    setPendingOrder(null);
    setActiveInvoiceId(null);
    setSyncError(null);
    setCurrentStep('cart');
    if (onSuccessToast) onSuccessToast('Pesanan dibatalkan. Item masih ada di keranjang.');
  };

  const handleProceedToPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyerName.trim() || !buyerEmail.trim()) {
      alert('Data akun tidak lengkap. Silakan keluar lalu masuk kembali.');
      return;
    }

    setIsProcessingCheckout(true);
    setSyncError(null);
    // Suffix acak: 6 digit terakhir Date.now() bisa bentrok antar pengguna.
    const orderId = `INV-MUZ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    setActiveInvoiceId(orderId);

    const snapOpened = await payWithQris(
      {
        orderId,
        amount: grandTotal,
        customer: { name: buyerName, email: buyerEmail },
        items: cartItems,
      },
      buildSnapHandlers(orderId, { items: cartItems as any[], total: grandTotal }, {
        // Pesanan sudah tercatat di server: mulai sekarang pembeli harus membayar atau membatalkannya.
        onCreated: ({ expiresAt }) => {
          setPendingOrder({
            orderId,
            kind: 'cart',
            amount: grandTotal,
            status: 'pending',
            createdAt: new Date().toISOString(),
            expiresAt,
            items: cartItems as any[],
          });
          setCurrentStep('payment_process');
        },
      })
    );
    if (snapOpened) return;

    // Snap tidak terbuka. Panel QRIS lokal HANYA untuk mode demo server; selain itu jujur bilang belum aktif
    // (dulu tampil QR palsu lalu ditolak server dengan pesan membingungkan).
    setIsProcessingCheckout(false);
    const st = await getPaymentStatus();
    if (st.mode !== 'demo') {
      alert(
        st.mode === 'unreachable'
          ? 'Tidak dapat menghubungi server pembayaran. Coba lagi.'
          : 'Pembayaran online belum aktif di server ini. Hubungi admin.'
      );
      return;
    }
    demoFlowRef.current = true;
    setDemoFlow(true);
    setCurrentStep('payment_process');
  };

  const handleDownloadInvoice = () => {
    if (!completedOrder) return;
    const orderSubtotal = completedOrder.items.reduce((sum, it: any) => sum + (Number(it.price) || 0), 0);
    const orderTax = Math.max(0, completedOrder.total - orderSubtotal);
    const invoiceContent = `=====================================================
                 PlayMuzeck DIGITAL STUDIO
            BUKTI PEMBAYARAN & INVOICE RESMI
=====================================================
Nomor Invoice    : ${completedOrder.invoiceId}
Tanggal Transaksi: ${completedOrder.timestamp}
Status           : LUNAS / MIDTRANS QRIS VERIFIED
Metode Bayar     : ${completedOrder.paymentMethodName}

DATA PEMESAN:
Nama Lengkap     : ${completedOrder.buyer.name}
Email            : ${completedOrder.buyer.email}

RINCIAN PEMBELIAN PRODUK DIGITAL:
-----------------------------------------------------
${completedOrder.items
  .map((it, idx) => `${idx + 1}. ${it.title.padEnd(35)}${formatIDR(it.price)}`)
  .join('\n')}
-----------------------------------------------------
Subtotal         : ${formatIDR(orderSubtotal)}
PPN 11%          : ${formatIDR(orderTax)}
TOTAL PEMBAYARAN : ${formatIDR(completedOrder.total)}
=====================================================`;

    const blob = new Blob([invoiceContent], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `PlayMuzeck_Invoice_${completedOrder.invoiceId}.txt`);
    if (onSuccessToast) onSuccessToast('Invoice resmi berhasil diunduh!');
  };

  const handleFinishAndGoLibrary = () => {
    setCurrentStep('cart');
    setCompletedOrder(null);
    onClose();
    window.location.reload(); 
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/75 backdrop-blur-sm cursor-pointer"
      />

      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 350 }}
        className="relative z-10 w-full max-w-lg bg-[#14213D] border-l border-white/[0.08] shadow-2xl flex flex-col h-full overflow-hidden"
      >
        <div className="p-4 sm:p-5 border-b border-white/[0.08] bg-black/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {currentStep !== 'cart' && currentStep !== 'success' && !(currentStep === 'payment_process' && pendingOrder && !demoFlow) && (
              <button
                onClick={() => {
                  if (currentStep === 'payment_process') setCurrentStep('buyer_data');
                  else if (currentStep === 'buyer_data') setCurrentStep('cart');
                }}
                className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors mr-1 cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div className="p-2 rounded-xl bg-[#FCA311] text-black">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {currentStep === 'cart' && 'Keranjang Belanja'}
                {currentStep === 'buyer_data' && 'Konfirmasi & QRIS Midtrans'}
                {currentStep === 'payment_process' && (pendingOrder && !demoFlow ? 'Menunggu Pembayaran' : 'Pindai QRIS Midtrans')}
                {currentStep === 'success' && 'Pembayaran Terverifikasi'}
              </h3>
              <p className="text-xs text-gray-400 font-medium">
                {currentStep === 'success'
                  ? 'Transaksi Lunas Terverifikasi'
                  : currentStep === 'payment_process' && pendingOrder && !demoFlow
                  ? `${pendingOrder.items.length || cartItems.length} Produk • ${pendingOrder.orderId}`
                  : `${cartItems.length} Produk Digital Terpilih`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <AnimatePresence mode="wait">
            {currentStep === 'cart' && (
              <motion.div key="cart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                {cartItems.length === 0 ? (
                  <div className="py-16 text-center space-y-4">
                    <div className="w-14 h-14 rounded-full bg-black/40 border border-white/[0.08] text-gray-500 mx-auto flex items-center justify-center">
                      <ShoppingBag className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Keranjang Masih Kosong</h4>
                      <p className="text-xs text-gray-400 max-w-xs mx-auto mt-1">
                        Pilih paket kuis atau trek audio untuk menambahkan ke keranjang.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cartItems.map((item: any) => (
                      <div
                        key={`${item.id}::${item.itemTypeKey || ''}`}
                        className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06] flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <span className="text-xs font-bold text-white leading-snug">{item.title}</span>
                          <p className="text-[11px] text-gray-400 line-clamp-2">{item.description}</p>
                          <div className="text-xs font-bold text-[#FCA311] font-mono pt-1">
                            {formatIDR(item.price)}
                          </div>
                        </div>

                        <button
                          onClick={() => onRemoveItem(`${item.id}::${item.itemTypeKey || ''}`)}
                          className="p-1.5 text-gray-500 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {currentStep === 'buyer_data' && (
              <motion.div key="buyer_data" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-[#FCA311]/40 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#FCA311] text-black flex items-center justify-center shrink-0">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black text-white block">Metode Resmi: QRIS Nasional (Midtrans)</span>
                    <span className="text-[11px] text-gray-300">
                      Bebas biaya admin. Mendukung GoPay, OVO, DANA, ShopeePay, BCA, Livin, dan semua m-Banking.
                    </span>
                  </div>
                </div>

                <form id="buyer-info-form" onSubmit={handleProceedToPayment} className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-gray-400" /> Nama Lengkap (Sesuai Akun)
                    </label>
                    <input
                      type="text"
                      required
                      readOnly
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-sm text-gray-300 focus:outline-none cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-gray-400" /> Email Akun Database
                    </label>
                    <input
                      type="email"
                      required
                      readOnly
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-sm text-emerald-400 font-mono font-bold focus:outline-none cursor-not-allowed"
                    />
                  </div>
                </form>
              </motion.div>
            )}

            {currentStep === 'payment_process' && pendingOrder && !demoFlow && (
              <motion.div key="pending_payment" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-[#FCA311]/40 space-y-2">
                  <div className="flex items-center gap-2 text-[#FCA311] font-black text-sm">
                    <ClockIcon className="w-4 h-4" />
                    <span>Menunggu Pembayaran</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Pesananmu sudah dibuat. Menutup jendela pembayaran tidak membatalkannya. Selesaikan pembayaran,
                    atau batalkan pesanan jika tidak jadi membeli.
                  </p>
                  {pendingOrder.expiresAt && (
                    <div className="text-xs text-gray-200">
                      Bayar sebelum <span className="font-bold text-white">{formatDeadline(pendingOrder.expiresAt)}</span>
                      <span className="text-[#FCA311] font-bold"> • sisa {timeLeftLabel(pendingOrder.expiresAt)}</span>
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-black/60 border border-white/[0.08] text-xs space-y-2">
                  <div className="flex justify-between text-gray-400">
                    <span>No. Pesanan:</span>
                    <span className="font-mono text-white font-bold break-all text-right">{pendingOrder.orderId}</span>
                  </div>
                  {pendingOrder.items.length > 0 && (
                    <div className="pt-2 border-t border-white/[0.08] space-y-1">
                      {pendingOrder.items.map((it: any, idx: number) => (
                        <div key={`${it.cartItemId || it.id}-${idx}`} className="flex justify-between gap-3 text-gray-300">
                          <span className="truncate">{it.title || it.id}</span>
                          <span className="font-mono shrink-0">{formatIDR(Number(it.price) || 0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pt-2 border-t border-white/[0.08] flex justify-between font-bold text-white">
                    <span>Total (termasuk PPN):</span>
                    <span className="text-base text-[#FCA311] font-mono">{formatIDR(pendingOrder.amount)}</span>
                  </div>
                </div>

                {syncError && (
                  <div className="p-3 rounded-xl bg-[#780000]/25 border border-[#780000] text-red-200 text-xs">{syncError}</div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={isProcessingCheckout || isSyncingWithDB || isCancelling}
                    onClick={handleResumePayment}
                    className="w-full py-3.5 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-sm shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    {isProcessingCheckout ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Membuka Midtrans Snap...</span>
                      </>
                    ) : (
                      <>
                        <QrCode className="w-4 h-4" />
                        <span>Bayar Sekarang</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={isProcessingCheckout || isSyncingWithDB || isCancelling}
                    onClick={() => handleFinishTransaction(pendingOrder.orderId, { items: pendingOrder.items, total: pendingOrder.amount })}
                    className="w-full py-2.5 rounded-xl bg-black/60 hover:bg-black/90 border border-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isSyncingWithDB ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshIcon className="w-4 h-4 text-[#FCA311]" />}
                    <span>Saya sudah bayar — cek status</span>
                  </button>

                  <button
                    type="button"
                    disabled={isProcessingCheckout || isSyncingWithDB || isCancelling}
                    onClick={handleCancelPending}
                    className="w-full py-2.5 rounded-xl border border-red-400/40 text-red-300 hover:bg-red-500/10 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <BanIcon className="w-4 h-4" />}
                    <span>Batalkan Pesanan</span>
                  </button>
                </div>
              </motion.div>
            )}

            {currentStep === 'payment_process' && (!pendingOrder || demoFlow) && (
              <QrisPanel
                key="payment_process"
                amount={grandTotal}
                isBusy={isSyncingWithDB}
                errorMessage={syncError}
                onConfirm={() => handleFinishTransaction(activeInvoiceId || `INV-MUZ-${Date.now().toString().slice(-6)}`)}
              />
            )}

            {currentStep === 'success' && completedOrder && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 text-center py-2">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-1">
                  <h4 className="text-xl font-bold text-white">Database Telah Diperbarui!</h4>
                  <p className="text-xs text-gray-300">
                    Terima kasih, {completedOrder.buyer.name}. Seluruh produk digital telah tertaut secara permanen di server PlayMuzeck.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-black/60 border border-white/[0.08] text-left text-xs space-y-2">
                  <div className="flex justify-between text-gray-400">
                    <span>No. Invoice:</span>
                    <span className="font-mono text-white font-bold">{completedOrder.invoiceId}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Metode:</span>
                    <span className="text-emerald-400 font-bold">{completedOrder.paymentMethodName}</span>
                  </div>
                  <div className="pt-2 border-t border-white/[0.08] flex justify-between font-bold text-white">
                    <span>Total Lunas:</span>
                    <span className="text-base text-[#FCA311] font-mono">{formatIDR(completedOrder.total)}</span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={handleDownloadInvoice}
                    className="w-full py-2.5 rounded-xl bg-black/60 hover:bg-black/90 border border-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#FCA311]" />
                    <span>Unduh Bukti Transaksi (Invoice Resmi)</span>
                  </button>

                  <button
                    onClick={handleFinishAndGoLibrary}
                    className="w-full py-3 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95 mt-2"
                  >
                    <span>Sinkronkan ke Koleksi Saya</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {cartItems.length > 0 && currentStep !== 'payment_process' && currentStep !== 'success' && (
          <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-black/60 space-y-3">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-gray-400">
                <span>Subtotal ({cartItems.length} item):</span>
                <span className="text-white font-mono">{formatIDR(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>PPN (11%):</span>
                <span className="text-white font-mono">{formatIDR(tax)}</span>
              </div>
              <div className="flex justify-between text-base font-extrabold text-white pt-1.5 border-t border-white/[0.08]">
                <span>Total Tagihan:</span>
                <span className="text-lg text-[#FCA311] font-mono">{formatIDR(grandTotal)}</span>
              </div>
            </div>

            {currentStep === 'cart' && (
              <button
                onClick={handleProceedToBuyerData}
                className="w-full py-3.5 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-sm shadow-lg shadow-amber-500/25 transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95"
              >
                <span>Lanjut ke Data Pemesan</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {currentStep === 'buyer_data' && (
              <button
                type="submit"
                form="buyer-info-form"
                disabled={isProcessingCheckout}
                className="w-full py-3.5 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-sm shadow-lg shadow-amber-500/25 transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
              >
                {isProcessingCheckout ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Membuka Midtrans Snap...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="w-4 h-4" />
                    <span>Bayar Sekarang dengan QRIS</span>
                  </>
                )}
              </button>
            )}

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Didukung Gateway Resmi Midtrans Snap & QRIS Nasional.</span>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};