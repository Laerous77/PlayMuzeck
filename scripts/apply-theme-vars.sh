#!/usr/bin/env bash
# Ganti warna hardcode di sisi KLIEN (bukan src/admin) menjadi token tema.
# Jalankan dari root project:  bash scripts/apply-theme-vars.sh
# Commit dulu — cek hasilnya dengan `git diff`.
set -euo pipefail

FILES=$(grep -rlE '#FCA311|#14213D|#e58e00' src --include='*.tsx' --include='*.ts' --exclude-dir=admin --exclude-dir=theme || true)
[ -z "$FILES" ] && { echo "Tidak ada file yang perlu diubah."; exit 0; }

echo "$FILES" | xargs sed -i -E \
  -e 's/hover:bg-\[#e58e00\]/hover:bg-accent\/80/g' \
  -e 's/\[#FCA311\]/accent/g' \
  -e 's/\[#14213D\]/surface/g'

echo "Diubah:"; echo "$FILES"
echo
echo "Sisa hardcode (ubah manual, mis. di style={{...}} atau SVG):"
grep -rnE '#FCA311|#14213D|#e58e00' src --exclude-dir=admin --exclude-dir=theme || echo "  (tidak ada)"
echo
echo "Cek manual: 'text-black' pada tombol bg-accent  -> text-on-accent"
echo "            'red-*' untuk warna Kuis            -> accent2 / text-on-accent2"
