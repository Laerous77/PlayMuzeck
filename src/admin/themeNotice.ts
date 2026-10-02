// src/admin/themeNotice.ts
// Template pemberitahuan yang dikirim ke pengguna saat admin menerapkan / mereset tema.
// Placeholder yang didukung: {tema} → nama tema.

export interface NoticeTemplate {
  id: string;
  label: string;
  title: string;
  message: string;
}

export const CUSTOM_ID = 'custom';
export const NOTICE_TITLE_MAX = 80;
export const NOTICE_MESSAGE_MAX = 400;

export const APPLY_TEMPLATES: NoticeTemplate[] = [
  {
    id: 'apply-new',
    label: 'Tema baru dari admin',
    title: 'Tema baru untukmu',
    message: 'Admin menerapkan tema “{tema}” ke akunmu. Semoga suka!',
  },
  {
    id: 'apply-locked',
    label: 'Tema baru (dikunci)',
    title: 'Tema akunmu diperbarui',
    message: 'Admin menerapkan tema “{tema}” dan mengunci tampilan akunmu. Pengaturan tema pribadi sementara tidak bisa diubah.',
  },
  {
    id: 'apply-event',
    label: 'Tema acara / kampanye',
    title: 'Tampilan spesial sedang aktif',
    message: 'Tampilan “{tema}” sedang dipakai untuk acara spesial. Kamu akan kembali ke tema sebelumnya setelah acara selesai.',
  },
];

export const RESET_TEMPLATES: NoticeTemplate[] = [
  {
    id: 'reset-restored',
    label: 'Dikembalikan ke tema sebelumnya',
    title: 'Tema dikembalikan',
    message: 'Admin mengembalikan tampilanmu ke tema yang kamu pakai sebelumnya.',
  },
  {
    id: 'reset-unlocked',
    label: 'Kunci dibuka',
    title: 'Tema bisa diubah lagi',
    message: 'Tema akunmu sudah dikembalikan dan kuncinya dibuka. Kamu bebas memilih tema sendiri lagi.',
  },
  {
    id: 'reset-builtin',
    label: 'Kembali ke tema bawaan',
    title: 'Kembali ke tema bawaan',
    message: 'Tampilan akunmu dikembalikan ke tema bawaan ({tema}).',
  },
];

export const fillNotice = (text: string, vars: { tema?: string }) =>
  text.replace(/\{tema\}/g, vars.tema ?? '');
