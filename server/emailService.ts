// server/emailService.ts
// Layanan pengiriman email terpadu menggunakan Resend SDK resmi.
// Mendukung:
// 1. Verifikasi email pengguna baru
// 2. Reset kata sandi (lupa password)
// 3. Notifikasi jadwal & pembatalan hapus akun
// 4. Request Custom Audio dari pelanggan (notifikasi ke Admin & konfirmasi ke Pelanggan)
// 5. Hubungi Kami: Masukan, Ide Kustom, Lapor Bug (notifikasi ke Admin & konfirmasi ke Pelanggan)
// 6. Admin mengirim pesan/email langsung ke pengguna dari Developer Console

import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { SUPER_ADMIN_EMAIL } from './db';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Alamat pengirim email (bisa diatur via RESEND_FROM atau MAIL_FROM di Railway)
// Jika Anda belum punya domain sendiri di Resend, gunakan 'PlayMuzeck <onboarding@resend.dev>' (disediakan resmi oleh Resend)
export const DEFAULT_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'PlayMuzeck <onboarding@resend.dev>';

// Email admin tujuan notifikasi inquiry & feedback (email tempat Anda menerima pemberitahuan)
export const ADMIN_NOTIF_EMAIL =
  process.env.ADMIN_NOTIFICATION_EMAIL ||
  process.env.ADMIN_EMAIL ||
  process.env.SUPER_ADMIN_EMAIL ||
  SUPER_ADMIN_EMAIL ||
  'tanoyashi15@gmail.com';

// Fallback SMTP jika dibutuhkan
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== ''
  ? process.env.SMTP_SECURE === 'true'
  : SMTP_PORT === 465;

const fallbackMailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

/**
 * Fungsi inti pengiriman email:
 * 1. Mengutamakan Resend SDK jika RESEND_API_KEY terpasang di Railway/env.
 * 2. Fallback ke SMTP Nodemailer jika SMTP_HOST dikonfigurasi.
 * 3. Log ke console jika keduanya belum diisi (mode dev/lokal).
 */
export async function sendMail(options: SendMailOptions): Promise<{ success: boolean; id?: string }> {
  const from = options.from || DEFAULT_FROM;
  const to = Array.isArray(options.to) ? options.to : [options.to];

  // 1. Prioritas Utama: Resend SDK
  if (resend) {
    try {
      const response = await resend.emails.send({
        from,
        to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      if (response.error) {
        console.error('[Resend Error]', response.error);
        throw new Error(`Resend API Error: ${response.error.message}`);
      }

      console.log(`[Resend OK] Email terkirim ke ${to.join(', ')} (ID: ${response.data?.id})`);
      return { success: true, id: response.data?.id };
    } catch (err: any) {
      console.error('[Resend Exception] Gagal mengirim email via Resend:', err?.message || err);
      // Jika strict mode gagal, coba fallback ke SMTP jika ada
      if (!fallbackMailer) {
        throw err;
      }
    }
  }

  // 2. Fallback: SMTP Nodemailer
  if (fallbackMailer) {
    try {
      const info = await fallbackMailer.sendMail({
        from,
        to: to.join(', '),
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      console.log(`[SMTP Fallback OK] Email terkirim ke ${to.join(', ')} (MessageId: ${info.messageId})`);
      return { success: true, id: info.messageId };
    } catch (err: any) {
      console.error('[SMTP Exception] Gagal mengirim email via SMTP:', err?.message || err);
      throw err;
    }
  }

  // 3. Fallback Dev Mode (Cetak ke Terminal)
  console.log(`\n======================================================
[EMAIL DEV LOG - RESEND/SMTP BELUM DIKONFIGURASI]
Pengirim : ${from}
Penerima : ${to.join(', ')}
Subjek   : ${options.subject}
Isi Teks :
${options.text}
======================================================\n`);

  return { success: true };
}

/**
 * Wrapper strict untuk alur kritis (misal: saat admin sengaja klik "Kirim Email" di konsol admin).
 * Akan melempar Error jika pengiriman gagal agar UI admin menampilkan pesan error yang tepat.
 */
export async function sendMailStrict(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!resend && !fallbackMailer) {
    throw new Error('Layanan email belum dikonfigurasi. Atur variabel RESEND_API_KEY di Railway.');
  }

  await sendMail({
    to,
    subject,
    text,
    html,
  });
}

// -------------------------------------------------------------
// TEMPLATE EMAIL BERDESAIN BERSIH & ELEGAN
// -------------------------------------------------------------

function renderEmailLayout(title: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b111e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e5e5e5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b111e; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #14213D; border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 24px 30px; background-color: #0d1628; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: left;">
              <span style="font-size: 20px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px;">
                PlayMuzeck<span style="color: #FCA311;">.</span>
              </span>
              <span style="font-size: 11px; font-family: monospace; color: #8e99af; margin-left: 10px; text-transform: uppercase;">
                Audio &amp; Pusat Kuis
              </span>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 30px; line-height: 1.6; font-size: 14px; color: #d1d5db;">
              ${contentHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background-color: #0d1628; border-top: 1px solid rgba(255,255,255,0.06); text-align: center; font-size: 11px; color: #6b7280;">
              &copy; ${new Date().getFullYear()} PlayMuzeck Platform. Seluruh hak cipta dilindungi.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// 1. Verifikasi Email
export async function sendVerificationEmail(email: string, verifyUrl: string): Promise<void> {
  const subject = 'Verifikasi Email Akun PlayMuzeck';
  const text = `Halo!\n\nTerima kasih telah mendaftar di PlayMuzeck.\nSilakan klik tautan di bawah ini untuk mengaktifkan akunmu (tautan berlaku selama 24 jam):\n\n${verifyUrl}\n\nJika kamu tidak merasa mendaftar di PlayMuzeck, abaikan email ini.`;
  
  const html = renderEmailLayout('Verifikasi Email Akun', `
    <h2 style="color: #ffffff; font-size: 20px; font-weight: 800; margin-top: 0;">Konfirmasi Alamat Email Anda</h2>
    <p>Terima kasih telah mendaftar di platform <strong>PlayMuzeck</strong>. Silakan klik tombol di bawah ini untuk mengaktifkan akun Anda dan mulai menjelajahi workstation audio serta arena kuis.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${verifyUrl}" style="background-color: #FCA311; color: #000000; text-decoration: none; padding: 13px 26px; font-weight: 800; font-size: 14px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 15px rgba(252,163,17,0.3);">
        Aktivasi Akun Saya
      </a>
    </div>

    <p style="font-size: 12px; color: #9ca3af;">Atau salin tautan berikut ke peramban web Anda:<br>
      <a href="${verifyUrl}" style="color: #FCA311; word-break: break-all;">${verifyUrl}</a>
    </p>
    <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">Tautan ini berlaku selama 24 jam. Jika Anda tidak merasa mendaftarkan akun di PlayMuzeck, Anda dapat mengabaikan email ini dengan aman.</p>
  `);

  await sendMail({ to: email, subject, text, html });
}

// 2. Reset Kata Sandi
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  const subject = 'Atur Ulang Kata Sandi Akun PlayMuzeck';
  const text = `Halo,\n\nKami menerima permintaan untuk mengatur ulang kata sandi akun PlayMuzeck Anda (${email}).\nSilakan klik tautan berikut untuk membuat kata sandi baru (berlaku 30 menit):\n\n${resetUrl}\n\nJika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini dan kata sandi Anda tetap aman.`;

  const html = renderEmailLayout('Atur Ulang Kata Sandi', `
    <h2 style="color: #ffffff; font-size: 20px; font-weight: 800; margin-top: 0;">Atur Ulang Kata Sandi</h2>
    <p>Kami menerima permintaan untuk mengatur ulang kata sandi akun PlayMuzeck yang terdaftar dengan surel <strong>${email}</strong>.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" style="background-color: #FCA311; color: #000000; text-decoration: none; padding: 13px 26px; font-weight: 800; font-size: 14px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 15px rgba(252,163,17,0.3);">
        Buat Kata Sandi Baru
      </a>
    </div>

    <p style="font-size: 12px; color: #9ca3af;">Atau salin tautan berikut ke peramban Anda:<br>
      <a href="${resetUrl}" style="color: #FCA311; word-break: break-all;">${resetUrl}</a>
    </p>
    <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">Tautan ini hanya berlaku selama 30 menit dan hanya dapat digunakan sekali. Jika bukan Anda yang meminta reset ini, silakan abaikan pesan ini.</p>
  `);

  await sendMail({ to: email, subject, text, html });
}

// 3. Notifikasi Permintaan Custom Audio
export interface CustomAudioInquiryData {
  id: string;
  title: string;
  genre: string;
  mood: string;
  duration: string;
  notes?: string;
  email: string;
}

export async function sendCustomAudioInquiryNotifications(inquiry: CustomAudioInquiryData): Promise<void> {
  const adminSubject = `[Custom Audio Baru] "${inquiry.title}" oleh ${inquiry.email}`;
  const adminText = `Ada permintaan Custom Audio baru masuk:\n\n` +
    `ID: ${inquiry.id}\n` +
    `Judul: ${inquiry.title}\n` +
    `Email Pelanggan: ${inquiry.email}\n` +
    `Genre: ${inquiry.genre}\n` +
    `Mood / Suasana: ${inquiry.mood}\n` +
    `Durasi: ${inquiry.duration}\n` +
    `Catatan / Brief:\n${inquiry.notes || '-'}\n`;

  const adminHtml = renderEmailLayout('Permintaan Custom Audio Baru', `
    <h2 style="color: #FCA311; font-size: 18px; margin-top: 0;">Permintaan Custom Audio Baru</h2>
    <p>Pelanggan telah mengajukan brief pesanan aransemen audio orisinal:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px;">
      <tr><td style="padding: 6px 0; color: #9ca3af; width: 140px;">ID Permintaan:</td><td style="color: #ffffff; font-family: monospace;">${inquiry.id}</td></tr>
      <tr><td style="padding: 6px 0; color: #9ca3af;">Judul Proyek:</td><td style="color: #ffffff; font-weight: bold;">${inquiry.title}</td></tr>
      <tr><td style="padding: 6px 0; color: #9ca3af;">Email Pemesan:</td><td style="color: #38bdf8;"><a href="mailto:${inquiry.email}" style="color: #38bdf8;">${inquiry.email}</a></td></tr>
      <tr><td style="padding: 6px 0; color: #9ca3af;">Genre Musik:</td><td style="color: #ffffff;">${inquiry.genre}</td></tr>
      <tr><td style="padding: 6px 0; color: #9ca3af;">Mood / Suasana:</td><td style="color: #ffffff;">${inquiry.mood}</td></tr>
      <tr><td style="padding: 6px 0; color: #9ca3af;">Target Durasi:</td><td style="color: #ffffff;">${inquiry.duration}</td></tr>
    </table>
    <div style="background-color: #0b111e; padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); margin-top: 10px;">
      <strong style="color: #ffffff; display: block; margin-bottom: 6px;">Catatan &amp; Brief:</strong>
      <p style="margin: 0; color: #e5e5e5; font-size: 13px; white-space: pre-wrap;">${inquiry.notes || '(Tidak ada catatan tambahan)'}</p>
    </div>
  `);

  // Kirim email notifikasi ke Admin
  await sendMail({ to: ADMIN_NOTIF_EMAIL, subject: adminSubject, text: adminText, html: adminHtml }).catch((e) =>
    console.error('[sendCustomAudioInquiryNotifications] Gagal kirim ke admin:', e)
  );

  // Kirim email konfirmasi ke Pelanggan
  const clientSubject = `Konfirmasi Pesanan Custom Audio: "${inquiry.title}" - PlayMuzeck`;
  const clientText = `Halo,\n\nTerima kasih telah mengajukan permintaan Custom Audio "${inquiry.title}" di PlayMuzeck.\n\n` +
    `Detail brief Anda:\n` +
    `- Genre: ${inquiry.genre}\n` +
    `- Mood: ${inquiry.mood}\n` +
    `- Durasi: ${inquiry.duration}\n\n` +
    `Tim produser kami sedang meninjau brief Anda. Kami akan menghubungi Anda melalui surel ini (${inquiry.email}) untuk langkah selanjutnya.\n\nSalam hangat,\nTim PlayMuzeck`;

  const clientHtml = renderEmailLayout('Pesanan Custom Audio Diterima', `
    <h2 style="color: #ffffff; font-size: 18px; margin-top: 0;">Permintaan Custom Audio Anda Diterima</h2>
    <p>Halo,</p>
    <p>Terima kasih telah mempercayakan aransemen musik Anda kepada tim <strong>PlayMuzeck</strong>. Brief proyek <strong>"${inquiry.title}"</strong> telah berhasil kami terima dan dicatat di sistem kami.</p>
    
    <div style="background-color: #0b111e; padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 4px 0; color: #9ca3af; width: 120px;">Genre:</td><td style="color: #ffffff;">${inquiry.genre}</td></tr>
        <tr><td style="padding: 4px 0; color: #9ca3af;">Mood:</td><td style="color: #ffffff;">${inquiry.mood}</td></tr>
        <tr><td style="padding: 4px 0; color: #9ca3af;">Durasi:</td><td style="color: #ffffff;">${inquiry.duration}</td></tr>
      </table>
    </div>

    <p>Tim produser kami akan segera meninjau detail dan referensi yang Anda berikan. Sampel atau informasi penawaran lebih lanjut akan kami kirimkan langsung ke alamat surel ini.</p>
    <p style="margin-top: 25px; color: #9ca3af; font-size: 13px;">Salam hangat,<br><strong style="color: #ffffff;">PlayMuzeck Audio Collective</strong></p>
  `);

  if (inquiry.email && inquiry.email.includes('@')) {
    await sendMail({ to: inquiry.email, subject: clientSubject, text: clientText, html: clientHtml }).catch((e) =>
      console.error('[sendCustomAudioInquiryNotifications] Gagal kirim ke pemesan:', e)
    );
  }
}

// 4. Notifikasi Hubungi Kami (Masukan, Ide Kustom, Lapor Bug)
export interface ContactFeedbackData {
  category: 'feedback' | 'custom' | 'report' | 'other' | string;
  subject?: string;
  message: string;
  email: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  feedback: 'Masukan & Saran',
  custom: 'Ide Kustom Audio/Kuis',
  report: 'Laporan Bug & Kendala',
  other: 'Lainnya',
};

export async function sendContactFeedbackNotifications(data: ContactFeedbackData): Promise<void> {
  const catLabel = CATEGORY_LABELS[data.category] || data.category;
  const adminSubject = `[Pesan Pengguna: ${catLabel}] ${data.subject || 'Tanpa Subjek'} (${data.email})`;
  const adminText = `Pesan baru diterima dari form Hubungi Kami:\n\n` +
    `Kategori: ${catLabel}\n` +
    `Pengirim: ${data.email}\n` +
    `Subjek: ${data.subject || '(Tanpa subjek)'}\n\n` +
    `Isi Pesan:\n${data.message}\n`;

  const adminHtml = renderEmailLayout('Pesan Pengguna Baru Masuk', `
    <h2 style="color: #FCA311; font-size: 18px; margin-top: 0;">Pesan Baru (${catLabel})</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px;">
      <tr><td style="padding: 6px 0; color: #9ca3af; width: 120px;">Kategori:</td><td style="color: #ffffff; font-weight: bold;">${catLabel}</td></tr>
      <tr><td style="padding: 6px 0; color: #9ca3af;">Pengirim:</td><td style="color: #38bdf8;"><a href="mailto:${data.email}" style="color: #38bdf8;">${data.email}</a></td></tr>
      <tr><td style="padding: 6px 0; color: #9ca3af;">Subjek:</td><td style="color: #ffffff;">${data.subject || '(Tanpa subjek)'}</td></tr>
    </table>
    <div style="background-color: #0b111e; padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); margin-top: 10px;">
      <strong style="color: #ffffff; display: block; margin-bottom: 6px;">Isi Pesan:</strong>
      <p style="margin: 0; color: #e5e5e5; font-size: 13px; white-space: pre-wrap;">${data.message}</p>
    </div>
  `);

  // Kirim ke Admin
  await sendMail({ to: ADMIN_NOTIF_EMAIL, subject: adminSubject, text: adminText, html: adminHtml }).catch((e) =>
    console.error('[sendContactFeedbackNotifications] Gagal kirim ke admin:', e)
  );

  // Kirim konfirmasi ke Pengirim
  const clientSubject = `Terima kasih atas pesan Anda (${catLabel}) - PlayMuzeck`;
  const clientText = `Halo,\n\nTerima kasih telah menghubungi PlayMuzeck.\nPesan Anda perihal "${data.subject || catLabel}" telah kami terima dengan baik.\n\n` +
    `Isi pesan Anda:\n"${data.message}"\n\n` +
    `Tim kami akan menindaklanjuti pesan Anda sesegera mungkin jika diperlukan.\n\nSalam hangat,\nTim PlayMuzeck`;

  const clientHtml = renderEmailLayout('Pesan Anda Telah Diterima', `
    <h2 style="color: #ffffff; font-size: 18px; margin-top: 0;">Pesan Anda Telah Diterima</h2>
    <p>Halo,</p>
    <p>Terima kasih telah meluangkan waktu untuk mengirimkan pesan (${catLabel.toLowerCase()}) ke <strong>PlayMuzeck</strong>. Kami sangat mengapresiasi kontribusi dan partisipasi Anda dalam pengembangan platform ini.</p>
    
    <div style="background-color: #0b111e; padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); margin: 20px 0;">
      ${data.subject ? `<div style="font-size: 12px; color: #9ca3af; margin-bottom: 4px;">Subjek: <strong style="color: #ffffff;">${data.subject}</strong></div>` : ''}
      <p style="margin: 0; color: #d1d5db; font-size: 13px; white-space: pre-wrap;">${data.message}</p>
    </div>

    <p style="font-size: 13px;">Tim kami akan meninjau dan menindaklanjuti pesan ini. Jika ada informasi lanjutan yang perlu dikonfirmasi, kami akan membalas langsung ke surel ini.</p>
    <p style="margin-top: 25px; color: #9ca3af; font-size: 13px;">Salam hangat,<br><strong style="color: #ffffff;">PlayMuzeck Support &amp; Creative Team</strong></p>
  `);

  if (data.email && data.email.includes('@')) {
    await sendMail({ to: data.email, subject: clientSubject, text: clientText, html: clientHtml }).catch((e) =>
      console.error('[sendContactFeedbackNotifications] Gagal kirim ke pengirim:', e)
    );
  }
}
