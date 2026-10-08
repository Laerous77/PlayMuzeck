// server/nameFilter.ts
//
// Filter NAMA TAMPILAN pemain di ruang publik (Arena Global). Terpisah dari pemindai kuis (quizModeration.ts) karena
// nama pendek tidak punya konteks: "anjing banget", "n4zi", "a.n.j.i.n.g", "kontol123" harus tertangkap, sedangkan nama
// sungguhan ("Nazirah", "Dewi", "Taira") tidak boleh ikut terblokir.
//
// Dua daftar:
//   STRONG      : kata panjang & khas; cukup MUNCUL SEBAGAI POTONGAN nama (setelah dinormalkan) untuk diblokir.
//   WHOLE_WORD  : kata pendek / yang juga potongan nama biasa (nazi dalam "Nazia"); hanya diblokir bila berdiri sendiri
//                 sebagai kata (juga bentuk samaran: "n4zi", "n a z i", "bab1").
// Semua kata dibandingkan setelah huruf berulang dirapatkan ("kontooool" -> "kontol").

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i' };

const squash = (w: string) => w.replace(/(.)\1+/g, '$1');

const STRONG = [
  'anjing', 'anjir', 'bangsat', 'bajingan', 'brengsek', 'keparat', 'kampret', 'bangke', 'jancok', 'jancuk', 'cuk', 'goblok', 'tolol',
  'sialan', 'kontol', 'memek', 'pepek', 'ngentot', 'ngewe', 'jembut', 'pantek', 'pukimak', 'cibai', 'lonte', 'pelacur', 'bokep', 'colmek',
  'sepong', 'bispak', 'fuck', 'shit', 'bitch', 'dick', 'pussy', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'hitler', 'blowjob', 'hentai',
].map(squash);

const WHOLE_WORD = [
  'nazi', 'isis', 'asu', 'babi', 'tai', 'tahi', 'bego', 'idiot', 'bodoh', 'kafir', 'perek', 'itil', 'titit', 'peler', 'entot', 'coli',
  'porn', 'porno', 'sex', 'seks', 'ass', 'cum', 'dildo', 'rape', 'kike', 'chink', 'paki', 'tranny', 'kimak', 'cina', 'bacot', 'setan',
].map(squash);

// "cuk" / "dick" / "cunt" muncul di nama biasa ("Cukup", "Dickson", "Scunthorpe"): hanya sebagai kata utuh.
const STRONG_SUBSTRING = STRONG.filter((w) => w !== squash('cuk') && w !== squash('dick'));
const EXTRA_WHOLE = ['cuk', 'dick', 'cunt'].map(squash);

/** Huruf kecil tanpa aksen. */
function base(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const foldLeet = (s: string, oneAs: 'i' | 'l') => s.replace(/[0-9@$!]/g, (c) => (c === '1' ? oneAs : LEET[c] ?? c));

/** Huruf tunggal yang dipisah spasi/titik/strip ("n a z i", "a.n.j.i.n.g") digabung jadi satu kata. */
function joinSpaced(s: string): string {
  return s.replace(/\b(?:[a-z0-9@$!][\s.\-_*]+){2,}[a-z0-9@$!]\b/g, (m) => m.replace(/[\s.\-_*]+/g, ''));
}

export function isBadName(raw: unknown): boolean {
  const norm = base(String(raw ?? ''));
  if (!norm.trim()) return false;
  const wholeSet = new Set([...WHOLE_WORD, ...EXTRA_WHOLE]);

  for (const source of [norm, joinSpaced(norm)]) {
    for (const one of ['i', 'l'] as const) {
      const folded = foldLeet(source, one);
      // 1) potongan: semua huruf disambung (spasi/simbol dibuang), lalu dirapatkan.
      const stripped = squash(folded.replace(/[^a-z]/g, ''));
      if (STRONG_SUBSTRING.some((w) => stripped.includes(w))) return true;
      // 2) kata utuh: dari bentuk yang sudah dilipat leet, dan dari bentuk polos (angka = pemisah / akhiran).
      const wordsFolded = (folded.match(/[a-z]+/g) || []).map(squash);
      const wordsPlain = (source.match(/[a-z]+/g) || []).map(squash);
      for (const w of [...wordsFolded, ...wordsPlain]) if (wholeSet.has(w)) return true;
    }
  }
  return false;
}
