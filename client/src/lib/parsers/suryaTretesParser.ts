import * as XLSX from "xlsx";
import { numberToPlain, validYmd } from "../shared/parseHelpers";

// CEK UPL · HOTEL SURYA TRETES (Surya Hotel Prigen Tretes) — satu file laporan "F/O Turnover Report by Department" (.xls / .xlsx)
// memuat EMPAT kategori yang diproses dalam satu parser: HOTEL, RESTO, KOLAM RENANG, dan KEBUGARAN.
//
// Header sumber (dibaca dari NAMA header, bukan huruf kolom atau nomor baris tetap):
//   Art Description → nama item; sekaligus penentu kategori, bagian no_struk
//   Day-Nett        → subtotal
//   Service         → service_charge
//   Tax             → tax
//   Day-Gros        → total
//   (%)             → tidak dipakai
// Laporan memuat tiga blok kolom (Day, MTD, YTD) sehingga "Service", "Tax", dan "(%)" muncul tiga kali. Blok yang dipakai hanya blok
// Day: "Service" dan "Tax" adalah header bernama itu yang berada di antara "Day-Nett" dan "Day-Gros". Blok MTD/YTD tidak pernah dibaca.
// Header yang berulang di halaman berikutnya dikenali lagi (peta kolom dibangun ulang pada tiap baris header).
//
// Kategori dari Art Description (tanpa membedakan huruf besar/kecil), dicocokkan dengan pola yang ditetapkan:
//   HOTEL        LODGING|EXTRA BED|ADDITIONAL ROOM|EARLY C.?I|LATE C.?O|LAUNDRY
//   RESTO        FOOD|COFFEE|B.?FAST|BREAKFAST|LUNCH|DINNER|BEVERAGE|BQT|CATERING
//   KOLAM RENANG SWIMMING
//   KEBUGARAN    RECREATION|TENNIS
// Item yang cocok dengan lebih dari satu kategori TIDAK ditebak: dilaporkan sebagai masalah dan tidak dihitung.
//
// Rumus (sama untuk keempat kategori):
//   no_struk       = nama dasar file + Art Description
//   date_trans     = tanggal dari nama file (SURYADDMMYYYY), BUKAN tanggal upload / hari ini
//   subtotal       = Day-Nett
//   service_charge = Service
//   discount       = 0
//   dpp            = Day-Nett + Service
//   tax            = Tax (selalu dari header Tax, juga untuk KOLAM RENANG dan KEBUGARAN; Service tidak pernah dipakai sebagai Tax)
//   total          = Day-Gros (nilai sumber, tidak dihitung ulang)
//   keterangan     = nama dasar file
//
// Baris yang dibaca: hanya baris item (Art Description terisi DAN Day-Gros berisi angka) yang cocok dengan satu kategori.
// Dilewati: judul laporan / nama hotel / halaman, garis pemisah, judul seksi departemen (Day-Gros kosong, mis. "20 - LAUNDRY, SPA, FITNE"),
// baris TOTAL dan GRAND TOTAL, item di luar keempat kategori, dan baris dengan Day-Gros = 0. Service = 0 TIDAK membuat baris dibuang.
// Angka negatif (baris diskon) dihitung apa adanya.
//
// Akurasi: semua angka dibaca sebagai desimal eksak (BigInt, skala 15); dpp = Day-Nett + Service dihitung dengan bilangan bulat, tanpa
// floating point. Pembulatan 2 desimal hanya terjadi saat TAMPILAN (formatSuryaMoney); ringkasan dijumlahkan dari nilai penuh.
// Day-Gros / Day-Nett kosong atau bukan angka pada baris kategori TIDAK dianggap 0: baris dilaporkan sebagai masalah dan tidak dihitung.
// Service / Tax kosong dianggap 0 dan dicatat di kolom Catatan (bukan diam-diam); isi bukan angka dilaporkan sebagai masalah.

export type SuryaCategory = "HOTEL" | "RESTO" | "KOLAM_RENANG" | "KEBUGARAN";

/** Urutan tampil kategori (UI, ringkasan). Urutan ini juga urutan pencocokan pola. */
export const SURYA_CATEGORIES: readonly SuryaCategory[] = ["HOTEL", "RESTO", "KOLAM_RENANG", "KEBUGARAN"];

export const SURYA_CATEGORY_NAMES: Record<SuryaCategory, string> = {
  HOTEL: "HOTEL",
  RESTO: "RESTO",
  KOLAM_RENANG: "KOLAM RENANG",
  KEBUGARAN: "KEBUGARAN",
};

/** Pola penentu kategori (tanpa flag g, jadi aman dipakai berulang). Jangan diubah tanpa konfirmasi aturan bisnis. */
export const SURYA_CATEGORY_PATTERNS: Record<SuryaCategory, RegExp> = {
  HOTEL: /LODGING|EXTRA BED|ADDITIONAL ROOM|EARLY C.?I|LATE C.?O|LAUNDRY/i,
  RESTO: /FOOD|COFFEE|B.?FAST|BREAKFAST|LUNCH|DINNER|BEVERAGE|BQT|CATERING/i,
  KOLAM_RENANG: /SWIMMING/i,
  KEBUGARAN: /RECREATION|TENNIS/i,
};

/** Nama header sumber yang wajib ada. */
export const SURYA_HEADERS = {
  description: "Art Description",
  nett: "Day-Nett",
  service: "Service",
  tax: "Tax",
  gross: "Day-Gros",
} as const;

/** Pemisah antara nama dasar file dan Art Description pada no_struk (satu tempat, mudah diubah bila aturan sistem lain berbeda). */
export const SURYA_NO_STRUK_SEPARATOR = "-";

/** Skala angka (digit desimal). Semua nilai uang adalah bigint berskala 10^-SURYA_SCALE. */
export const SURYA_SCALE = 15;

/** Selisih Day-Gros terhadap Day-Nett + Service + Tax yang masih dianggap pembulatan laporan (Rp2; sampel asli selisih Rp1). */
const GROSS_TOLERANCE = 2n * 10n ** BigInt(SURYA_SCALE);

export type SuryaRow = {
  category: SuryaCategory;
  no_struk: string;
  date_trans: string; // YYYY-MM-DD
  /** Semua nilai uang: bilangan bulat berskala 10^-SURYA_SCALE (eksak). */
  subtotal: bigint;
  service_charge: bigint;
  discount: bigint;
  dpp: bigint;
  tax: bigint;
  total: bigint;
  keterangan: string;
  /** Art Description apa adanya (setelah karakter kontrol printer dibuang). */
  description: string;
  filename: string;
  sourceRow: number; // nomor baris di sheet (1-based)
  notes: string[]; // catatan validasi; data tidak diubah
};

export type SuryaIssue = { file: string; row: number; label: string; value: string; message: string };

export type SuryaStats = {
  files: number; // file yang berhasil dibaca
  sourceRows: number; // baris setelah header yang berisi sesuatu di Art Description
  hotelRows: number;
  restoRows: number;
  kolamRenangRows: number;
  kebugaranRows: number;
  ignoredRows: number; // baris item (Day-Gros berisi) di luar keempat kategori
  sectionRows: number; // judul seksi / info halaman: Art Description terisi tetapi Day-Gros kosong
  totalRows: number; // TOTAL / GRAND TOTAL / subtotal bagian
  separatorRows: number; // garis pemisah (-----)
  headerRows: number; // baris header yang dikenali (termasuk header berulang di halaman berikutnya)
  zeroRows: number; // baris kategori dengan Day-Gros = 0 (dilewati)
  invalidRows: number; // baris kategori dengan angka kosong / bukan angka (tidak dihitung, dilaporkan)
  ambiguousRows: number; // baris yang cocok lebih dari satu kategori (tidak dihitung, dilaporkan)
  validRows: number; // record yang masuk ke hasil
};

export type SuryaSource = {
  ok: boolean;
  error?: string;
  fileName: string;
  sheetName: string;
  dates: string[]; // tanggal dari nama file tiap file yang berhasil dibaca
  rows: SuryaRow[];
  issues: SuryaIssue[];
  warnings: string[]; // peringatan non-blokir
  stats: SuryaStats;
};

const emptyStats = (): SuryaStats => ({
  files: 0, sourceRows: 0, hotelRows: 0, restoRows: 0, kolamRenangRows: 0, kebugaranRows: 0, ignoredRows: 0, sectionRows: 0, totalRows: 0,
  separatorRows: 0, headerRows: 0, zeroRows: 0, invalidRows: 0, ambiguousRows: 0, validRows: 0,
});

export const failSuryaSource = (fileName: string, error: string, extra: Partial<SuryaSource> = {}): SuryaSource => ({
  ok: false, error, fileName, sheetName: "", dates: [], rows: [], issues: [], warnings: [], stats: emptyStats(), ...extra,
});

const CATEGORY_STAT_KEY: Record<SuryaCategory, "hotelRows" | "restoRows" | "kolamRenangRows" | "kebugaranRows"> = {
  HOTEL: "hotelRows",
  RESTO: "restoRows",
  KOLAM_RENANG: "kolamRenangRows",
  KEBUGARAN: "kebugaranRows",
};

/** Kategori yang cocok untuk satu Art Description (spasi ganda dirapatkan hanya untuk pencocokan). Kosong = di luar kategori. */
export function matchSuryaCategories(description: string): SuryaCategory[] {
  const text = description.replace(/\s+/g, " ").trim();
  return SURYA_CATEGORIES.filter((cat) => SURYA_CATEGORY_PATTERNS[cat].test(text));
}

// ───────────────────────── angka ─────────────────────────

/** Desimal polos → bigint berskala SURYA_SCALE (setengah menjauhi nol). null = bukan angka valid. */
export function parseSuryaDecimal(text: string): bigint | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m) return null;
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  if (intPart === "" && fracPart === "") return null;
  const kept = (fracPart + "0".repeat(SURYA_SCALE)).slice(0, SURYA_SCALE);
  let scaled = BigInt(intPart === "" ? "0" : intPart) * 10n ** BigInt(SURYA_SCALE) + BigInt(kept);
  if (fracPart.charAt(SURYA_SCALE) !== "" && fracPart.charAt(SURYA_SCALE) >= "5") scaled += 1n;
  return m[1] === "-" ? -scaled : scaled;
}

/** Bigint skala SURYA_SCALE → "Rp1.234,56" (2 desimal hanya untuk tampilan, setengah menjauhi nol, tanpa floating point). */
export function formatSuryaMoney(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(SURYA_SCALE - 2);
  let cents = abs / unit;
  if (abs % unit >= unit / 2n) cents += 1n;
  const intText = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `Rp${negative && cents !== 0n ? "-" : ""}${intText},${frac}`;
}

/** Representasi desimal penuh (untuk audit/pengujian), tanpa nol di belakang. */
export function suryaToPlain(value: bigint): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(SURYA_SCALE + 1, "0");
  const int = abs.slice(0, abs.length - SURYA_SCALE);
  const frac = abs.slice(abs.length - SURYA_SCALE).replace(/0+$/, "");
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

// ───────────────────────── nama file ─────────────────────────

export type SuryaFilenameDate = { ok: true; date: string } | { ok: false; error: string };

/** Nama dasar file: nama file tanpa ekstensi terakhir ("SURYA03112026.xls" → "SURYA03112026"). */
export const suryaFileStem = (fileName: string): string => fileName.replace(/\.[^./\\]*$/, "");

export const buildSuryaNoStruk = (fileName: string, description: string): string => `${suryaFileStem(fileName)}${SURYA_NO_STRUK_SEPARATOR}${description}`;

/**
 * Tanggal dari nama file: prefix "SURYA" lalu tanggal DDMMYYYY (8 digit), mis. "SURYA03112026.xls" → 2026-11-03.
 * Prefix tidak peka huruf besar/kecil dan boleh diikuti spasi, "_" atau "-". Jumlah digit selain 8, tanggal kalender yang tidak ada
 * (mis. 31 Feb), atau pola yang tidak cocok → tidak valid. Tidak pernah memakai tanggal upload / hari ini sebagai pengganti.
 */
export function parseSuryaFilenameDate(fileName: string): SuryaFilenameDate {
  const stem = suryaFileStem(fileName);
  const hint = 'Nama file harus berbentuk "SURYADDMMYYYY.xls", contoh "SURYA03112026.xls".';
  const loose = /SURYA[\s_-]*(\d+)/i.exec(stem);
  if (!loose) return { ok: false, error: `Format tanggal pada nama file "${fileName}" tidak sesuai: tidak ditemukan "SURYA" diikuti angka tanggal. ${hint}` };
  const digits = loose[1];
  if (digits.length !== 8) return { ok: false, error: `Format tanggal pada nama file "${fileName}" tidak sesuai: ditemukan ${digits.length} digit ("${digits}"), dibutuhkan 8 (DDMMYYYY). ${hint}` };
  const date = validYmd(Number(digits.slice(4)), Number(digits.slice(2, 4)), Number(digits.slice(0, 2)));
  if (!date) return { ok: false, error: `Tanggal "${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}" pada nama file "${fileName}" bukan tanggal kalender yang valid. ${hint}` };
  return { ok: true, date };
}

// ───────────────────────── sel & header ─────────────────────────

/** Sel minimal (kompatibel dengan CellObject SheetJS): t = tipe ("n" angka, "s" teks, "e" error, "b" boolean, "z" kosong), v = nilai. */
export type SuryaCell = { t: string; v?: unknown; f?: string; w?: string };

/** Akses sel sheet (baris dan kolom 1-based). Memisahkan aturan parser dari pustaka pembaca Excel. */
export type SuryaGrid = {
  sheetName: string;
  lastRow: number;
  lastCol: number;
  getCell: (row: number, col: number) => SuryaCell | undefined;
};

// Karakter kontrol sisa printer (mis. ESC, form feed pada pemisah halaman) dibuang dari teks.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const cellText = (cell: SuryaCell | undefined): string => {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.t === "e") return cell.w ?? "";
  if (typeof cell.v === "number") return numberToPlain(cell.v) ?? String(cell.v);
  return String(cell.v).replace(CONTROL_CHARS, "").trim();
};

type Amount = { kind: "empty" } | { kind: "invalid"; raw: string } | { kind: "ok"; value: bigint };

/** Teks bertipe angka yang diterima: desimal polos saja ("1234.5"). Pemisah ribuan / koma desimal ditolak, bukan ditebak. */
const PLAIN_DECIMAL_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const readAmount = (cell: SuryaCell | undefined): Amount => {
  if (!cell || cell.t === "z" || cell.v === undefined || cell.v === null) return { kind: "empty" };
  if (cell.t === "e") return { kind: "invalid", raw: cell.w ?? "#ERROR" };
  if (typeof cell.v === "number") {
    const plain = numberToPlain(cell.v);
    const value = plain === null ? null : parseSuryaDecimal(plain);
    return value === null ? { kind: "invalid", raw: String(cell.v) } : { kind: "ok", value };
  }
  if (typeof cell.v === "string") {
    const text = cell.v.replace(CONTROL_CHARS, "").trim();
    if (text === "") return { kind: "empty" };
    const value = PLAIN_DECIMAL_TEXT.test(text) ? parseSuryaDecimal(text) : null;
    return value === null ? { kind: "invalid", raw: text } : { kind: "ok", value };
  }
  return { kind: "invalid", raw: String(cell.v) };
};

/** Kunci pembanding header: huruf kecil, hanya huruf/angka ("Day-Nett" = "day nett" = "DAY-NETT"). */
const headerKey = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const KEY_DESCRIPTION = headerKey(SURYA_HEADERS.description);
const KEY_NETT = headerKey(SURYA_HEADERS.nett);
const KEY_SERVICE = headerKey(SURYA_HEADERS.service);
const KEY_TAX = headerKey(SURYA_HEADERS.tax);
const KEY_GROSS = headerKey(SURYA_HEADERS.gross);
const REQUIRED_KEYS = [KEY_DESCRIPTION, KEY_NETT, KEY_SERVICE, KEY_TAX, KEY_GROSS];
const KEY_LABEL: Record<string, string> = {
  [KEY_DESCRIPTION]: SURYA_HEADERS.description,
  [KEY_NETT]: SURYA_HEADERS.nett,
  [KEY_SERVICE]: SURYA_HEADERS.service,
  [KEY_TAX]: SURYA_HEADERS.tax,
  [KEY_GROSS]: SURYA_HEADERS.gross,
};

type SuryaColumns = { description: number; nett: number; service: number; tax: number; gross: number };

/** Huruf kolom hanya untuk pesan ke pengguna; tidak pernah dipakai untuk membaca data. */
const colLetter = (col: number): string => {
  let n = col;
  let out = "";
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
};

/** Posisi (kolom) tiap header wajib pada satu baris. */
const headerPositions = (grid: SuryaGrid, row: number): Map<string, number[]> => {
  const found = new Map<string, number[]>();
  for (let c = 1; c <= grid.lastCol; c++) {
    const text = cellText(grid.getCell(row, c));
    if (text === "") continue;
    const key = headerKey(text);
    if (!REQUIRED_KEYS.includes(key)) continue;
    const list = found.get(key) ?? [];
    list.push(c);
    found.set(key, list);
  }
  return found;
};

type HeaderResult = { ok: true; cols: SuryaColumns } | { ok: false; error: string };

/**
 * Baris header = baris yang berisi "Art Description". Kolom lain dicari dari namanya: "Day-Nett" dan "Day-Gros" harus tunggal;
 * "Service" dan "Tax" adalah header bernama itu yang berada di antara keduanya (blok Day; blok MTD/YTD diabaikan).
 */
function resolveHeader(grid: SuryaGrid, row: number): HeaderResult | null {
  const found = headerPositions(grid, row);
  if (!found.has(KEY_DESCRIPTION)) return null;
  const missing: string[] = [];
  const problems: string[] = [];

  const single = (key: string): number | undefined => {
    const cols = found.get(key) ?? [];
    if (cols.length === 0) { missing.push(KEY_LABEL[key]); return undefined; }
    if (cols.length > 1) { problems.push(`header "${KEY_LABEL[key]}" ganda (kolom ${cols.map(colLetter).join(", ")})`); return undefined; }
    return cols[0];
  };
  const description = single(KEY_DESCRIPTION);
  const nett = single(KEY_NETT);
  const gross = single(KEY_GROSS);

  const blockKnown = nett !== undefined && gross !== undefined;
  if (blockKnown && nett > gross) problems.push(`"${SURYA_HEADERS.nett}" harus berada di sebelah kiri "${SURYA_HEADERS.gross}"`);
  const inBlock = (key: string): number | undefined => {
    const all = found.get(key) ?? [];
    if (all.length === 0) { missing.push(KEY_LABEL[key]); return undefined; }
    if (!blockKnown || nett > gross) return undefined; // blok Day belum bisa ditentukan; masalahnya sudah dilaporkan di atas
    const cols = all.filter((c) => c > nett && c < gross);
    if (cols.length === 0) { missing.push(`${KEY_LABEL[key]} (di antara ${SURYA_HEADERS.nett} dan ${SURYA_HEADERS.gross})`); return undefined; }
    if (cols.length > 1) { problems.push(`header "${KEY_LABEL[key]}" ganda di antara ${SURYA_HEADERS.nett} dan ${SURYA_HEADERS.gross} (kolom ${cols.map(colLetter).join(", ")})`); return undefined; }
    return cols[0];
  };
  const service = inBlock(KEY_SERVICE);
  const tax = inBlock(KEY_TAX);

  if (missing.length || problems.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`header wajib tidak ditemukan: ${missing.join(", ")}`);
    if (problems.length) parts.push(`header bermasalah: ${problems.join("; ")}`);
    return { ok: false, error: `Baris header ${row} pada sheet "${grid.sheetName}": ${parts.join(". ")}. File tidak diproses.` };
  }
  return { ok: true, cols: { description: description!, nett: nett!, service: service!, tax: tax!, gross: gross! } };
}

/** Header wajib yang ada di mana pun pada sheet (untuk pesan "header hilang" bila tidak ada baris header sama sekali). */
const scanHeaderKeys = (grid: SuryaGrid): Set<string> => {
  const keys = new Set<string>();
  for (let r = 1; r <= grid.lastRow; r++) {
    for (let c = 1; c <= grid.lastCol; c++) {
      const text = cellText(grid.getCell(r, c));
      if (text === "") continue;
      const key = headerKey(text);
      if (REQUIRED_KEYS.includes(key)) keys.add(key);
    }
  }
  return keys;
};

const excelSerialToYmd = (serial: number): string | null => {
  if (!Number.isFinite(serial) || serial < 61) return null;
  const probe = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return validYmd(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate());
};

/** Tanggal "Period :" pada judul laporan (sebelum baris header pertama). Hanya untuk pembanding; null bila tidak ada / tidak terbaca. */
function readSheetPeriod(grid: SuryaGrid, beforeRow: number): string | null {
  for (let r = 1; r < beforeRow; r++) {
    for (let c = 1; c <= grid.lastCol; c++) {
      if (!/^period\s*:?$/i.test(cellText(grid.getCell(r, c)))) continue;
      for (let k = c + 1; k <= Math.min(grid.lastCol, c + 3); k++) {
        const cell = grid.getCell(r, k);
        if (!cell || cell.v === undefined || cell.v === null) continue;
        if (typeof cell.v === "number") return excelSerialToYmd(cell.v);
        if (cell.v instanceof Date) return validYmd(cell.v.getFullYear(), cell.v.getMonth() + 1, cell.v.getDate());
        const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(String(cell.v).trim());
        return m ? validYmd(Number(m[3]), Number(m[2]), Number(m[1])) : null;
      }
    }
  }
  return null;
}

// ───────────────────────── parsing ─────────────────────────

const SEPARATOR_LINE = /^[-=_.*\s]+$/;
const TOTAL_LABEL = /^(GRAND|SUB)?TOTAL/;

/**
 * Aturan baca satu sheet laporan. Kegagalan struktur (nama file tidak valid, header wajib hilang/ganda, tidak ada baris header)
 * menghasilkan ok=false dengan pesan yang jelas; tidak ada tebakan kolom atau data pengganti.
 */
export function parseSuryaGrid(grid: SuryaGrid, fileName: string): SuryaSource {
  const where = `sheet "${grid.sheetName}"`;
  const dateResult = parseSuryaFilenameDate(fileName);
  if (!dateResult.ok) return failSuryaSource(fileName, dateResult.error, { sheetName: grid.sheetName });
  const date = dateResult.date;
  const stem = suryaFileStem(fileName);

  const stats = emptyStats();
  const rows: SuryaRow[] = [];
  const issues: SuryaIssue[] = [];
  const warnings: string[] = [];
  let cols: SuryaColumns | null = null;
  let firstHeaderRow = 0;

  const issue = (row: number, label: string, value: string, message: string) => issues.push({ file: fileName, row, label, value, message });

  for (let r = 1; r <= grid.lastRow; r++) {
    const header = resolveHeader(grid, r);
    if (header) {
      if (!header.ok) return failSuryaSource(fileName, header.error, { sheetName: grid.sheetName });
      cols = header.cols; // peta kolom dibangun ulang pada setiap header (halaman berikutnya)
      stats.headerRows++;
      if (!firstHeaderRow) firstHeaderRow = r;
      continue;
    }
    if (!cols) continue; // judul laporan sebelum header pertama

    const description = cellText(grid.getCell(r, cols.description));
    if (description === "") continue;
    stats.sourceRows++;
    if (SEPARATOR_LINE.test(description)) { stats.separatorRows++; continue; }
    if (TOTAL_LABEL.test(description.replace(/\s+/g, "").toUpperCase())) { stats.totalRows++; continue; }

    const gross = readAmount(grid.getCell(r, cols.gross));
    if (gross.kind === "empty") { stats.sectionRows++; continue; } // judul seksi / info halaman, bukan item

    const matches = matchSuryaCategories(description);
    if (matches.length === 0) { stats.ignoredRows++; continue; }
    if (matches.length > 1) {
      stats.ambiguousRows++;
      issue(r, description, "", `"${description}" cocok dengan lebih dari satu kategori (${matches.map((m) => SURYA_CATEGORY_NAMES[m]).join(", ")}) — baris tidak dihitung, kategori tidak ditebak.`);
      continue;
    }
    const category = matches[0];
    const catName = SURYA_CATEGORY_NAMES[category];

    if (gross.kind === "invalid") {
      stats.invalidRows++;
      issue(r, description, gross.raw, `${SURYA_HEADERS.gross} "${gross.raw}" pada "${description}" (${catName}) bukan angka valid — baris tidak dihitung.`);
      continue;
    }

    const nett = readAmount(grid.getCell(r, cols.nett));
    const service = readAmount(grid.getCell(r, cols.service));
    const tax = readAmount(grid.getCell(r, cols.tax));

    if (gross.value === 0n) {
      stats.zeroRows++;
      const nonZero = [nett, service, tax].some((a) => a.kind === "ok" && a.value !== 0n);
      if (nonZero) warnings.push(`Baris ${r} "${description}" (${catName}): ${SURYA_HEADERS.gross} = 0 tetapi ${SURYA_HEADERS.nett}/${SURYA_HEADERS.service}/${SURYA_HEADERS.tax} tidak nol — baris dilewati sesuai aturan.`);
      continue;
    }

    const badField = (amount: Amount, header: string, allowEmpty: boolean): boolean => {
      if (amount.kind === "ok") return false;
      if (amount.kind === "empty" && allowEmpty) return false;
      const raw = amount.kind === "invalid" ? amount.raw : "";
      issue(r, description, raw, amount.kind === "empty"
        ? `${header} pada "${description}" (${catName}) kosong — baris tidak dihitung.`
        : `${header} "${raw}" pada "${description}" (${catName}) bukan angka valid — baris tidak dihitung.`);
      return true;
    };
    // Day-Nett wajib terisi; Service / Tax kosong dianggap 0 dan dicatat. Semua dicek agar tiap masalah dilaporkan.
    const badNett = badField(nett, SURYA_HEADERS.nett, false);
    const badService = badField(service, SURYA_HEADERS.service, true);
    const badTax = badField(tax, SURYA_HEADERS.tax, true);
    if (badNett || badService || badTax) { stats.invalidRows++; continue; } // dihitung per baris, bukan per kolom

    const nettValue = (nett as { value: bigint }).value;
    const serviceValue = service.kind === "ok" ? service.value : 0n;
    const taxValue = tax.kind === "ok" ? tax.value : 0n;
    const notes: string[] = [];
    if (service.kind === "empty") notes.push(`${SURYA_HEADERS.service} kosong dianggap 0`);
    if (tax.kind === "empty") notes.push(`${SURYA_HEADERS.tax} kosong dianggap 0`);
    if (gross.value < 0n) notes.push("Nominal negatif (diskon)");
    const diff = nettValue + serviceValue + taxValue - gross.value;
    if ((diff < 0n ? -diff : diff) > GROSS_TOLERANCE) notes.push(`${SURYA_HEADERS.gross} berbeda dari ${SURYA_HEADERS.nett} + ${SURYA_HEADERS.service} + ${SURYA_HEADERS.tax} (selisih ${formatSuryaMoney(diff)})`);

    rows.push({
      category,
      no_struk: buildSuryaNoStruk(fileName, description),
      date_trans: date,
      subtotal: nettValue,
      service_charge: serviceValue,
      discount: 0n,
      dpp: nettValue + serviceValue,
      tax: taxValue,
      total: gross.value,
      keterangan: stem,
      description,
      filename: fileName,
      sourceRow: r,
      notes,
    });
    stats[CATEGORY_STAT_KEY[category]]++;
    stats.validRows++;
  }
  stats.files = 1;

  if (!firstHeaderRow) {
    const present = scanHeaderKeys(grid);
    const missing = REQUIRED_KEYS.filter((key) => !present.has(key)).map((key) => KEY_LABEL[key]);
    return failSuryaSource(
      fileName,
      `Header wajib tidak ditemukan pada ${where}: ${(missing.length ? missing : [SURYA_HEADERS.description]).join(", ")}. File tidak diproses.`,
      { sheetName: grid.sheetName },
    );
  }

  if (stats.validRows === 0) warnings.push(`Tidak ada transaksi Hotel, Resto, Kolam Renang, atau Kebugaran dengan ${SURYA_HEADERS.gross} bukan nol pada ${where}.`);

  const sheetPeriod = readSheetPeriod(grid, firstHeaderRow);
  if (sheetPeriod !== null && sheetPeriod !== date) warnings.push(`Tanggal "Period" di dalam laporan (${sheetPeriod}) berbeda dari tanggal pada nama file (${date}). Yang dipakai adalah tanggal dari nama file.`);

  return { ok: true, fileName, sheetName: grid.sheetName, dates: [date], rows, issues, warnings, stats };
}

const gridOfSheet = (sheetName: string, sheet: XLSX.WorkSheet): SuryaGrid | null => {
  const ref = sheet["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  return {
    sheetName,
    lastRow: range.e.r + 1,
    lastCol: range.e.c + 1,
    getCell: (row, col) => sheet[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] as XLSX.CellObject | undefined,
  };
};

/** Membaca satu workbook Excel (.xls / .xlsx). Sheet yang dibaca = sheet yang memuat header "Art Description". */
export function parseSuryaTretesWorkbook(buffer: ArrayBuffer, fileName: string): SuryaSource {
  const dateResult = parseSuryaFilenameDate(fileName);
  if (!dateResult.ok) return failSuryaSource(fileName, dateResult.error);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return failSuryaSource(fileName, "File tidak dapat dibaca sebagai workbook Excel (.xls / .xlsx).");
  }
  const grids = workbook.SheetNames
    .map((name) => ({ name, grid: workbook.Sheets[name] ? gridOfSheet(name, workbook.Sheets[name]) : null }))
    .filter((entry): entry is { name: string; grid: SuryaGrid } => entry.grid !== null);
  if (grids.length === 0) return failSuryaSource(fileName, "File Excel kosong: tidak ada sheet yang berisi data.");

  const withHeader = grids.filter(({ grid }) => {
    for (let r = 1; r <= grid.lastRow; r++) if (headerPositions(grid, r).has(KEY_DESCRIPTION)) return true;
    return false;
  });
  if (withHeader.length > 1) {
    return failSuryaSource(fileName, `Ada ${withHeader.length} sheet yang memuat header "${SURYA_HEADERS.description}" (${withHeader.map((s) => s.name).join(", ")}). Tidak dapat dipastikan sheet mana yang dipakai.`);
  }
  // Tanpa header sama sekali: pakai sheet pertama agar pesan menyebut header apa saja yang hilang.
  const chosen = withHeader[0] ?? grids[0];
  return parseSuryaGrid(chosen.grid, fileName);
}

// ───────────────────────── gabung & ringkasan ─────────────────────────

/**
 * Menggabungkan beberapa file yang SUDAH diparse (mode BULANAN) menjadi satu hasil. Tiap record tetap membawa no_struk, date_trans,
 * keterangan, dan nama file asalnya sendiri (tanggal tiap file dari nama filenya sendiri). Hanya file ok yang digabung; file gagal
 * dilaporkan oleh pemanggil. Tanggal yang sama pada dua file berbeda diberi peringatan (kemungkinan laporan ganda).
 */
export function mergeSuryaSources(sources: readonly SuryaSource[]): SuryaSource {
  const ok = sources.filter((src) => src.ok);
  if (ok.length === 1) return ok[0];
  if (ok.length === 0) return failSuryaSource(sources.map((src) => src.fileName).join(", "), sources.map((src) => `${src.fileName}: ${src.error ?? "gagal dibaca"}`).join(" | ") || "Tidak ada file yang dapat dihitung.");
  const stats = emptyStats();
  for (const src of ok) (Object.keys(stats) as Array<keyof SuryaStats>).forEach((key) => { stats[key] += src.stats[key]; });
  const warnings = ok.flatMap((src) => src.warnings.map((w) => `${src.fileName}: ${w}`));
  const byDate = new Map<string, string[]>();
  for (const src of ok) for (const d of src.dates) byDate.set(d, [...(byDate.get(d) ?? []), src.fileName]);
  for (const [d, names] of byDate) if (names.length > 1) warnings.push(`Tanggal ${d} ada pada ${names.length} file (${names.join(", ")}); transaksi dari semua file tersebut dihitung.`);
  return {
    ok: true,
    fileName: `${ok.length} file`,
    sheetName: [...new Set(ok.map((src) => src.sheetName))].join(", "),
    dates: ok.flatMap((src) => src.dates),
    rows: ok.flatMap((src) => src.rows),
    issues: ok.flatMap((src) => src.issues),
    warnings,
    stats,
  };
}

export type SuryaSummary = {
  count: number;
  subtotal: bigint;
  service_charge: bigint;
  discount: bigint;
  dpp: bigint;
  tax: bigint;
  total: bigint;
};

/** Ringkasan dari SELURUH record yang diberikan (bukan halaman preview). */
export function summarizeSuryaRows(rows: readonly SuryaRow[]): SuryaSummary {
  const s: SuryaSummary = { count: 0, subtotal: 0n, service_charge: 0n, discount: 0n, dpp: 0n, tax: 0n, total: 0n };
  for (const row of rows) {
    s.count++;
    s.subtotal += row.subtotal;
    s.service_charge += row.service_charge;
    s.discount += row.discount;
    s.dpp += row.dpp;
    s.tax += row.tax;
    s.total += row.total;
  }
  return s;
}

/** Ringkasan per kategori dari SELURUH record; kategori tanpa record tetap muncul dengan nilai 0. */
export function summarizeSuryaByCategory(rows: readonly SuryaRow[]): Record<SuryaCategory, SuryaSummary> {
  return {
    HOTEL: summarizeSuryaRows(rows.filter((r) => r.category === "HOTEL")),
    RESTO: summarizeSuryaRows(rows.filter((r) => r.category === "RESTO")),
    KOLAM_RENANG: summarizeSuryaRows(rows.filter((r) => r.category === "KOLAM_RENANG")),
    KEBUGARAN: summarizeSuryaRows(rows.filter((r) => r.category === "KEBUGARAN")),
  };
}

/** no_struk yang muncul lebih dari sekali (Art Description yang sama pada file yang sama). Data tidak diubah. */
export function findDuplicateSuryaNoStruk(rows: readonly SuryaRow[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const row of rows) { if (seen.has(row.no_struk)) dup.add(row.no_struk); else seen.add(row.no_struk); }
  return dup;
}
