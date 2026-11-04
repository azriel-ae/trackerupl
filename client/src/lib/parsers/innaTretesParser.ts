import * as XLSX from "xlsx";
import { validYmd, numberToPlain } from "../shared/parseHelpers";

// CEK UPL · INNA TRETES (kategori HOTEL, HIBURAN, RESTO dari SATU file Excel bulanan)
//
// Sumber : satu worksheet laporan "Detail Night Audit Report". Semua kolom dibaca berdasarkan NAMA HEADER (bukan huruf kolom
// Excel), jadi urutan kolom boleh berubah. Baris header dicari otomatis (60 baris pertama, baris yang memuat minimal 3 nama header
// yang dikenal). Header wajib yang tidak ditemukan → parser berhenti dengan pesan yang menyebut header tersebut.
//   Header dikenali : Class, Folio, Room, Trn Date, Trans ID, Trn Code, Trans Name, Remark, Reference, Jrnl Code, Shift, Trans Nett
//   Header wajib    : Class (kategori), Folio, Trn Date, Trans ID, Trans Name, Trans Nett (nilai dasar L)
//   Header opsional : Room, Trn Code, Remark, Reference, Jrnl Code, Shift (dikenali, tidak dipakai dalam hasil)
//
// Validasi transaksi (semua kategori)  : Trans ID NOT IN ('', 'Trans ID')   (spasi dinormalisasi hanya untuk pemeriksaan)
// Kategori (header Class, tanpa pencarian luas):
//   HOTEL   : Class = 'ROOM'              → id_agent inna_room
//   HIBURAN : Class = 'POOL'              → id_agent inna_pool
//   RESTO   : Class IN ('FB', 'FB POS')   → id_agent inna_resto
//
// Rumus (SAMA untuk ketiga kategori, JANGAN diubah tanpa persetujuan). L = Trans Nett:
//   no_struk       = CONCAT(Folio, ' - ', Trans ID); bila Folio kosong → hanya Trans ID (tanpa " - " menggantung)
//   date_trans     = Trn Date
//   subtotal       = L
//   service_charge = L - ((L * (11 / 100)) * 10)
//   discount       = 0
//   dpp            = (L * (11 / 100)) * 10
//   tax            = L * (11 / 100)
//   total          = L * 1.21
//   keterangan     = CONCAT('Folio = ', Folio, ' Trans Name= ', Trans Name); bila Folio kosong → 'Trans Name= ...'
// Secara matematis: dpp = 1,1·L, service_charge = −0,1·L, tax = 0,11·L, total = 1,21·L (service_charge bernilai negatif
// untuk L positif). Total ≠ DPP + Service Charge + Tax. Ini sesuai query acuan dan hanya dilaporkan, tidak diubah:
// aturan yang benar BELUM dikonfirmasi (lihat README, "Rumus INNA yang menunggu konfirmasi").
//
// Akurasi: L dibaca sebagai desimal eksak (BigInt, skala 15) dan seluruh rumus dihitung dengan bilangan bulat pada skala 17,
// tanpa floating point dan tanpa pembulatan. Pembulatan 2 desimal hanya terjadi saat TAMPILAN (formatInnaMoney); jumlah
// ringkasan dijumlahkan dari nilai penuh.

export type InnaCategory = "HOTEL" | "HIBURAN" | "RESTO";
export type InnaCategoryFilter = "ALL" | InnaCategory;

export const INNA_CATEGORIES: InnaCategory[] = ["HOTEL", "HIBURAN", "RESTO"];

export const INNA_AGENT: Record<InnaCategory, string> = {
  HOTEL: "inna_room",
  HIBURAN: "inna_pool",
  RESTO: "inna_resto",
};

/** Kode header Class (sudah dinormalisasi: trim, spasi ganda → satu, huruf besar) per kategori. */
export const INNA_SOURCE_CODES: Record<InnaCategory, readonly string[]> = {
  HOTEL: ["ROOM"],
  HIBURAN: ["POOL"],
  RESTO: ["FB", "FB POS"],
};

const CODE_TO_CATEGORY = new Map<string, InnaCategory>(
  INNA_CATEGORIES.flatMap((category) => INNA_SOURCE_CODES[category].map((code) => [code, category] as const)),
);

export const INNA_CATEGORY_LABEL: Record<InnaCategoryFilter, string> = {
  ALL: "Semua Kategori",
  HOTEL: "HOTEL",
  HIBURAN: "HIBURAN",
  RESTO: "RESTO",
};

/** Skala L saat dibaca (digit desimal). Hasil rumus memakai skala L + 2. */
const INPUT_SCALE = 15;
export const INNA_SCALE = INPUT_SCALE + 2;

export type InnaTretesRow = {
  id_agent: string;
  category: InnaCategory;
  no_struk: string;
  date_trans: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  /** Semua nilai uang: bilangan bulat berskala 10^-INNA_SCALE (eksak). */
  subtotal: bigint;
  service_charge: bigint;
  discount: bigint;
  dpp: bigint;
  tax: bigint;
  total: bigint;
  keterangan: string;
  sourceRow: number; // nomor baris di Excel (1-based)
  sourceCode: string; // kode kategori header Class (ternormalisasi)
  /** Hanya terisi pada hasil gabungan banyak file: nama file asal baris. */
  sourceFile?: string;
};

export type InnaIssueKind = "amount" | "date";
export type InnaIssue = { row: number; kind: InnaIssueKind; transId: string; code: string; value: string; message: string; file?: string };
export type InnaUnmapped = { row: number; code: string; transId: string; transName: string; file?: string };

export type InnaStats = {
  dataRows: number; // baris setelah header yang berisi sesuatu
  blankRows: number;
  repeatedHeaders: number; // Trans ID = "Trans ID"
  nonTransactionRows: number; // Trans ID kosong / baris total laporan
  validRows: number; // transaksi yang masuk ke hasil
  unmappedRows: number;
  invalidAmountRows: number;
  invalidDateRows: number;
  missingFolioRows: number; // Folio kosong (no_struk hanya memuat Trans ID)
  missingNameRows: number; // Trans Name kosong
};

export type InnaSource = {
  ok: boolean;
  error?: string;
  fileName: string;
  sheetName: string;
  headerRow: number; // 1-based, 0 jika tidak ditemukan
  ignoredSheets: string[];
  rows: InnaTretesRow[];
  unmapped: InnaUnmapped[];
  issues: InnaIssue[];
  stats: InnaStats;
};

const emptyStats = (): InnaStats => ({
  dataRows: 0, blankRows: 0, repeatedHeaders: 0, nonTransactionRows: 0, validRows: 0, unmappedRows: 0,
  invalidAmountRows: 0, invalidDateRows: 0, missingFolioRows: 0, missingNameRows: 0,
});

const failSource = (fileName: string, error: string, extra: Partial<InnaSource> = {}): InnaSource => ({
  ok: false, error, fileName, sheetName: "", headerRow: 0, ignoredSheets: [], rows: [], unmapped: [], issues: [], stats: emptyStats(), ...extra,
});

const normalizeSpaces = (value: unknown): string => (value === null || value === undefined ? "" : String(value)).replace(/\s+/g, " ").trim();
const normalizeCode = (value: unknown): string => normalizeSpaces(value).toUpperCase();

/** Nilai sel → teks tampilan apa adanya (angka bulat tanpa ".0"). */
const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? numberToPlain(value) ?? String(value) : String(value);
  return String(value);
};

/** Desimal polos → bigint berskala INPUT_SCALE (setengah menjauhi nol). null = bukan angka valid. */
export function parseInnaDecimal(text: string): bigint | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m) return null;
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  if (intPart === "" && fracPart === "") return null;
  const kept = (fracPart + "0".repeat(INPUT_SCALE)).slice(0, INPUT_SCALE);
  let scaled = BigInt(intPart === "" ? "0" : intPart) * 10n ** BigInt(INPUT_SCALE) + BigInt(kept);
  if (fracPart.charAt(INPUT_SCALE) !== "" && fracPart.charAt(INPUT_SCALE) >= "5") scaled += 1n;
  return m[1] === "-" ? -scaled : scaled;
}

/** Semua rumus INNA TRETES dari satu nilai L (bigint skala INPUT_SCALE) → bigint skala INNA_SCALE. Eksak. */
export function computeInnaAmounts(l: bigint) {
  const base = l * 100n; // L pada skala INNA_SCALE
  const tax = l * 11n; //   L * (11/100)
  const dpp = l * 110n; //  (L * (11/100)) * 10
  return {
    subtotal: base, //                       L
    service_charge: base - dpp, //           L - ((L * (11/100)) * 10)
    discount: 0n, //                         0
    dpp, //
    tax, //
    total: l * 121n, //                      L * 1.21
  };
}

/** Bigint skala INNA_SCALE → "Rp1.234,56" (2 desimal hanya untuk tampilan, setengah menjauhi nol, tanpa floating point). */
export function formatInnaMoney(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(INNA_SCALE - 2);
  let cents = abs / unit;
  if (abs % unit >= unit / 2n) cents += 1n;
  const intText = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `Rp${negative && cents !== 0n ? "-" : ""}${intText},${frac}`;
}

/** Representasi desimal penuh (untuk audit/pengujian), tanpa nol di belakang. */
export function innaToPlain(value: bigint): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(INNA_SCALE + 1, "0");
  const int = abs.slice(0, abs.length - INNA_SCALE);
  const frac = abs.slice(abs.length - INNA_SCALE).replace(/0+$/, "");
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

const MONTHS_EN: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, ags: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };

/**
 * Trn Date → YYYY-MM-DD. Mendukung serial Excel (angka atau teks angka), Date, "dd-Mon-yy(yy)", "dd/mm/yyyy", "dd-mm-yyyy", "dd.mm.yyyy", "yyyy-mm-dd".
 * Format bertanda angka dibaca hari-bulan-tahun. Tidak pernah memakai tanggal hari ini sebagai pengganti; null = tidak valid.
 */
export function parseInnaDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : validYmd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1) return null;
    const parts = XLSX.SSF.parse_date_code(value);
    return parts ? validYmd(parts.y, parts.m, parts.d) : null;
  }
  const text = String(value).trim();
  if (text === "") return null;
  // Serial Excel yang tersimpan sebagai teks ("46314" / "46314.35"): hanya rentang tahun 1954-2173 agar angka lain tidak salah dibaca sebagai tanggal.
  if (/^\d{5,6}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial < 20000 || serial > 90000) return null;
    const parts = XLSX.SSF.parse_date_code(serial);
    return parts ? validYmd(parts.y, parts.m, parts.d) : null;
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(text);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS_EN[m[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validYmd(year, month, Number(m[1]));
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T].*)?$/.exec(text);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

type Matrix = unknown[][];

// Nama header sumber (dibandingkan tanpa membedakan huruf besar/kecil dan spasi ganda).
const HEADER_NAMES = ["Class", "Folio", "Room", "Trn Date", "Trans ID", "Trn Code", "Trans Name", "Remark", "Reference", "Jrnl Code", "Shift", "Trans Nett"] as const;
const REQUIRED_HEADERS = ["Class", "Folio", "Trn Date", "Trans ID", "Trans Name", "Trans Nett"] as const;
type RequiredHeader = (typeof REQUIRED_HEADERS)[number];
type ColumnMap = Record<RequiredHeader, number>;
const KNOWN = new Set<string>(HEADER_NAMES.map((name) => name.toUpperCase()));
const HEADER_SEARCH_LIMIT = 60;
const HEADER_MIN_MATCHES = 3;

const sheetToMatrix = (sheet: XLSX.WorkSheet): Matrix => {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  // Mulai dari A1 supaya nomor baris Excel tetap absolut walaupun !ref tidak dimulai di A1.
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1, raw: true, defval: null, blankrows: true,
    range: { s: { r: 0, c: 0 }, e: { r: range.e.r, c: range.e.c } },
  }) as Matrix;
};

/** Baris header = baris pertama (60 baris teratas) yang memuat minimal HEADER_MIN_MATCHES nama header yang dikenal. */
const findHeaderRow = (matrix: Matrix): number => {
  const limit = Math.min(matrix.length, HEADER_SEARCH_LIMIT);
  for (let i = 0; i < limit; i++) {
    const matches = new Set((matrix[i] ?? []).map(normalizeCode).filter((cell) => KNOWN.has(cell)));
    if (matches.size >= HEADER_MIN_MATCHES) return i;
  }
  return -1;
};

/** Header → indeks kolom. Header wajib hilang/ganda → pesan error jelas (tidak pernah mengambil kolom lain). */
const mapColumns = (row: unknown[]): { map?: ColumnMap; error?: string } => {
  const normalized = row.map(normalizeCode);
  const missing: string[] = [];
  const duplicated: string[] = [];
  const map = {} as ColumnMap;
  for (const name of REQUIRED_HEADERS) {
    const wanted = name.toUpperCase();
    const hits = normalized.reduce<number[]>((acc, cell, index) => (cell === wanted ? [...acc, index] : acc), []);
    if (hits.length === 0) missing.push(`"${name}"`);
    else if (hits.length > 1) duplicated.push(`"${name}" (muncul ${hits.length}x)`);
    map[name] = hits[0] ?? -1;
  }
  const problems: string[] = [];
  if (missing.length) problems.push(`header wajib tidak ditemukan: ${missing.join(", ")}`);
  if (duplicated.length) problems.push(`header ganda: ${duplicated.join(", ")}`);
  return problems.length ? { error: problems.join("; ") } : { map };
};

const isBlankRow = (row: unknown[]) => row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");

export function parseInnaTretesWorkbook(buffer: ArrayBuffer, fileName: string): InnaSource {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return failSource(fileName, "File tidak dapat dibaca sebagai workbook Excel (.xlsx/.xls).");
  }
  if (!workbook.SheetNames.length) return failSource(fileName, "Workbook tidak memiliki sheet.");

  const candidates: Array<{ name: string; matrix: Matrix; headerIndex: number }> = [];
  const withoutHeader: string[] = [];
  for (const name of workbook.SheetNames) {
    const matrix = sheetToMatrix(workbook.Sheets[name]);
    const headerIndex = findHeaderRow(matrix);
    if (headerIndex >= 0) candidates.push({ name, matrix, headerIndex });
    else withoutHeader.push(name);
  }
  if (candidates.length === 0) {
    return failSource(fileName, `Struktur file tidak sesuai: tidak ada sheet dengan header transaksi (baris yang memuat nama header seperti ${HEADER_NAMES.slice(0, 3).map((n) => `"${n}"`).join(", ")}, ... pada ${HEADER_SEARCH_LIMIT} baris pertama). Sheet diperiksa: ${workbook.SheetNames.join(", ")}.`, { ignoredSheets: withoutHeader });
  }
  if (candidates.length > 1) {
    return failSource(fileName, `Lebih dari satu sheet memiliki header transaksi (${candidates.map((c) => c.name).join(", ")}). Tidak dapat dipastikan sheet mana yang dipakai — file tidak diproses agar transaksi tidak terhitung dua kali.`);
  }

  const { name: sheetName, matrix, headerIndex } = candidates[0];
  const { map: col, error: headerError } = mapColumns(matrix[headerIndex] ?? []);
  if (!col) {
    return failSource(fileName, `Header sheet "${sheetName}" baris ${headerIndex + 1} tidak sesuai format INNA TRETES: ${headerError}. Kolom dibaca berdasarkan nama header, bukan posisi.`, { sheetName, headerRow: headerIndex + 1, ignoredSheets: withoutHeader });
  }

  const stats = emptyStats();
  const rows: InnaTretesRow[] = [];
  const unmapped: InnaUnmapped[] = [];
  const issues: InnaIssue[] = [];

  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const sheetRow = i + 1;
    if (isBlankRow(row)) { stats.blankRows++; continue; }
    stats.dataRows++;

    const transIdText = normalizeSpaces(row[col["Trans ID"]]);
    if (transIdText === "") { stats.nonTransactionRows++; continue; } // Trans ID = ''
    if (transIdText.toUpperCase() === "TRANS ID") { stats.repeatedHeaders++; continue; } // Trans ID = 'Trans ID'
    const code = normalizeCode(row[col.Class]);
    if (/^(GRAND )?TOTAL\b/.test(code)) { stats.nonTransactionRows++; continue; } // baris total laporan

    const category = CODE_TO_CATEGORY.get(code);
    if (!category) {
      stats.unmappedRows++;
      unmapped.push({ row: sheetRow, code: normalizeSpaces(row[col.Class]), transId: transIdText, transName: normalizeSpaces(row[col["Trans Name"]]) });
      continue;
    }

    const transId = cellText(row[col["Trans ID"]]);
    let problem = false;

    const date = parseInnaDate(row[col["Trn Date"]]);
    if (date === null) {
      problem = true;
      stats.invalidDateRows++;
      const raw = cellText(row[col["Trn Date"]]);
      issues.push({ row: sheetRow, kind: "date", transId: transIdText, code, value: raw, message: raw === "" ? "Tanggal (Trn Date) kosong — baris tidak dihitung." : `Tanggal (Trn Date) "${raw}" tidak dapat dibaca — baris tidak dihitung.` });
    }

    const rawL = row[col["Trans Nett"]];
    let amount: bigint | null = null;
    const lText = typeof rawL === "number" ? numberToPlain(rawL) : rawL === null || rawL === undefined ? "" : String(rawL).trim();
    if (lText === null || lText === "" || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(lText)) {
      problem = true;
      stats.invalidAmountRows++;
      const raw = cellText(rawL);
      issues.push({ row: sheetRow, kind: "amount", transId: transIdText, code, value: raw, message: raw.trim() === "" ? "Nilai transaksi (Trans Nett) kosong — baris tidak dihitung." : `Nilai transaksi (Trans Nett) "${raw}" bukan angka valid — baris tidak dihitung.` });
    } else {
      amount = parseInnaDecimal(lText);
      if (amount === null) {
        problem = true;
        stats.invalidAmountRows++;
        issues.push({ row: sheetRow, kind: "amount", transId: transIdText, code, value: lText, message: `Nilai transaksi (Trans Nett) "${lText}" tidak dapat dibaca — baris tidak dihitung.` });
      }
    }
    if (problem || date === null || amount === null) continue;

    const folio = cellText(row[col.Folio]);
    const transName = cellText(row[col["Trans Name"]]);
    if (folio.trim() === "") stats.missingFolioRows++;
    if (transName.trim() === "") stats.missingNameRows++;

    rows.push({
      id_agent: INNA_AGENT[category],
      category,
      no_struk: folio.trim() === "" ? transId : `${folio} - ${transId}`, // CONCAT(Folio, ' - ', Trans ID); Folio kosong → Trans ID saja
      date_trans: date,
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)),
      ...computeInnaAmounts(amount),
      keterangan: folio.trim() === "" ? `Trans Name= ${transName}` : `Folio = ${folio} Trans Name= ${transName}`, // CONCAT('Folio = ', Folio, ' Trans Name= ', Trans Name)
      sourceRow: sheetRow,
      sourceCode: code,
    });
    stats.validRows++;
  }

  return { ok: true, fileName, sheetName, headerRow: headerIndex + 1, ignoredSheets: withoutHeader, rows, unmapped, issues, stats };
}

export type InnaPeriod = { year: number; month: number };
export type InnaPeriodInfo = InnaPeriod & { count: number };

export const MONTH_NAMES_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const formatInnaPeriod = (p: InnaPeriod) => `${MONTH_NAMES_ID[p.month - 1] ?? p.month} ${p.year}`;

/** Bulan yang benar-benar memiliki transaksi valid, urut dari yang paling lama. Bulan tanpa transaksi tidak muncul. */
export function listInnaPeriods(rows: readonly InnaTretesRow[]): InnaPeriodInfo[] {
  const map = new Map<string, InnaPeriodInfo>();
  for (const row of rows) {
    const key = `${row.year}-${row.month}`;
    const hit = map.get(key);
    if (hit) hit.count++;
    else map.set(key, { year: row.year, month: row.month, count: 1 });
  }
  return [...map.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

/** Terapkan filter periode dan kategori bersamaan. period null = tidak memfilter bulan. */
export function filterInnaRows(rows: readonly InnaTretesRow[], period: InnaPeriod | null, category: InnaCategoryFilter): InnaTretesRow[] {
  return rows.filter((row) => (period === null || (row.year === period.year && row.month === period.month)) && (category === "ALL" || row.category === category));
}

export function countInnaByCategory(rows: readonly InnaTretesRow[]): Record<InnaCategory, number> {
  const counts: Record<InnaCategory, number> = { HOTEL: 0, HIBURAN: 0, RESTO: 0 };
  for (const row of rows) counts[row.category]++;
  return counts;
}

export type InnaSummary = {
  count: number;
  subtotal: bigint;
  dpp: bigint;
  discount: bigint;
  service_charge: bigint;
  tax: bigint;
  total: bigint;
};

/** Ringkasan dari SELURUH baris yang diberikan (bukan halaman preview). */
export function summarizeInnaRows(rows: readonly InnaTretesRow[]): InnaSummary {
  const s: InnaSummary = { count: 0, subtotal: 0n, dpp: 0n, discount: 0n, service_charge: 0n, tax: 0n, total: 0n };
  for (const row of rows) {
    s.count++;
    s.subtotal += row.subtotal;
    s.dpp += row.dpp;
    s.discount += row.discount;
    s.service_charge += row.service_charge;
    s.tax += row.tax;
    s.total += row.total;
  }
  return s;
}

/**
 * Menggabungkan beberapa file Inna Tretes (mis. satu file per hari atau satu file per bulan) yang SUDAH diparse dengan
 * parseInnaTretesWorkbook menjadi satu sumber. Aturan baca dan rumus tiap file tidak diubah. Hanya file ok yang digabung;
 * satu file → dikembalikan apa adanya. Tiap baris/masalah membawa nama file asal agar nomor baris Excel tidak ambigu.
 */
export function mergeInnaSources(sources: readonly InnaSource[]): InnaSource {
  const ok = sources.filter((src) => src.ok);
  if (ok.length === 1) return ok[0];
  if (ok.length === 0) return failSource(sources.map((src) => src.fileName).join(", "), sources.map((src) => `${src.fileName}: ${src.error ?? "gagal dibaca"}`).join(" | "));
  const stats = emptyStats();
  ok.forEach((src) => {
    (Object.keys(stats) as Array<keyof InnaStats>).forEach((key) => { stats[key] += src.stats[key]; });
  });
  return {
    ok: true,
    fileName: `${ok.length} file`,
    sheetName: [...new Set(ok.map((src) => src.sheetName))].join(", "),
    headerRow: 0,
    ignoredSheets: [...new Set(ok.flatMap((src) => src.ignoredSheets))],
    rows: ok.flatMap((src) => src.rows.map((row) => ({ ...row, sourceFile: src.fileName }))),
    unmapped: ok.flatMap((src) => src.unmapped.map((u) => ({ ...u, file: src.fileName }))),
    issues: ok.flatMap((src) => src.issues.map((i) => ({ ...i, file: src.fileName }))),
    stats,
  };
}
