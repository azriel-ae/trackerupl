import Papa from "papaparse";
import { validYmd } from "@/lib/shared/parseHelpers";

// CEK UPL · KEDAI HUTAN CEMPAKA
// Sumber: CSV "LAPORAN PENJUALAN REKAP" (delimiter koma, angka gaya en-US "32,000.00", tanggal DD/MM/YYYY).
// Di atas tabel ada informasi toko dan judul laporan; di bawahnya ada baris rekap dan footer.
// Baris header DICARI dari nama kolomnya (bukan nomor baris tetap), dan semua kolom dibaca lewat NAMA HEADER
// (bukan posisi A, B, C, ...), sehingga urutan kolom boleh berubah. Tidak ada fallback ke indeks kolom.
//   No Transaksi → no_struk      Tanggal → date_trans (YYYY-MM-DD)   Kode Pel. → keterangan
//   Sub Total    → subtotal      Pot.    → discount                   Pajak     → tax
//   Total Akhir  → total (nilai sumber, tidak dihitung ulang)         service_charge = 0
//   DPP = Sub Total - Pot.
// Header lain (Bayar Tunai, Bayar Kredit, Bayar Kartu Kredit) dikenali tetapi tidak wajib dan tidak dipakai.
// Header wajib yang tidak ditemukan → file ditolak dengan pesan yang menyebut nama header tersebut.

export type KedaiHutanCempakaRow = {
  filename: string;
  no_struk: string;
  date_trans: string; // YYYY-MM-DD
  subtotal: number;
  service_charge: number;
  discount: number;
  dpp: number;
  tax: number;
  total: number;
  keterangan: string;
  sourceRow: number; // nomor baris di file CSV (baris pertama = 1)
  issues: string[]; // catatan validasi; nilai sumber tidak diubah
};

export type KedaiHutanCempakaIssue = { filename: string; row: number | null; message: string };

export type KedaiHutanCempakaFileInfo = {
  filename: string;
  status: "processed" | "duplicate" | "failed";
  transactions: number;
  invalidRows: number;
  summaryRowsSkipped: number;
  message?: string;
};

export type KedaiHutanCempakaSummary = {
  files: number;
  count: number;
  subtotal: number;
  service_charge: number;
  discount: number;
  dpp: number;
  tax: number;
  total: number;
};

export type KedaiHutanCempakaResult = {
  ok: boolean;
  error?: string;
  files: KedaiHutanCempakaFileInfo[];
  rows: KedaiHutanCempakaRow[];
  issues: KedaiHutanCempakaIssue[];
  duplicateReceipts: number; // jumlah no_struk yang sama tetapi identitasnya berbeda (dipertahankan, ditandai)
  duplicateRowsRemoved: number; // transaksi identik di file lain yang tidak dihitung dua kali
  filesFailed: number; // file yang gagal dibaca / header tidak sesuai
  summary: KedaiHutanCempakaSummary;
};

const emptySummary = (): KedaiHutanCempakaSummary => ({ files: 0, count: 0, subtotal: 0, service_charge: 0, discount: 0, dpp: 0, tax: 0, total: 0 });

// Buang noise floating point (mis. 0.1+0.2) tanpa membulatkan nilai sumber secara berarti.
const clean = (value: number) => Math.round(value * 1e6) / 1e6;

// Selisih Total Akhir terhadap DPP + Pajak yang masih dianggap wajar (hanya noise angka/pembulatan 1 rupiah).
const TOTAL_TOLERANCE = 1;

const normalizeHeader = (value: unknown) =>
  String(value ?? "").replace(/^﻿/, "").replace(/\s+/g, " ").trim().toLowerCase();

// Header wajib. Pencocokan memakai nama persis (tanpa membedakan huruf besar/kecil, spasi awal/akhir/ganda dirapikan).
const REQUIRED = {
  receipt: "No Transaksi",
  date: "Tanggal",
  customer: "Kode Pel.",
  subtotal: "Sub Total",
  discount: "Pot.",
  tax: "Pajak",
  total: "Total Akhir",
} as const;
type FieldKey = keyof typeof REQUIRED;
const FIELD_KEYS = Object.keys(REQUIRED) as FieldKey[];

type ColumnMap = Record<FieldKey, number>;

const matchIndexes = (normalized: string[], name: string) => {
  const wanted = normalizeHeader(name);
  return normalized.reduce<number[]>((acc, h, i) => (h === wanted ? [...acc, i] : acc), []);
};

/** Berapa header wajib yang ada pada baris ini (untuk mencari baris header). */
const headerScore = (cells: string[]) => {
  const normalized = cells.map(normalizeHeader);
  return FIELD_KEYS.filter((key) => matchIndexes(normalized, REQUIRED[key]).length > 0).length;
};

/** Cari baris header berdasarkan nama kolom: baris pertama dengan jumlah header wajib terbanyak. */
function findHeaderRow(table: string[][]): { index: number; score: number } {
  let best = { index: -1, score: 0 };
  table.forEach((cells, index) => {
    const score = headerScore(cells);
    if (score > best.score) best = { index, score };
  });
  return best;
}

function mapColumns(header: string[]): { map?: ColumnMap; error?: string } {
  const normalized = header.map(normalizeHeader);
  const missing: string[] = [];
  const ambiguous: string[] = [];
  const map = {} as ColumnMap;
  FIELD_KEYS.forEach((key) => {
    const hits = matchIndexes(normalized, REQUIRED[key]);
    if (hits.length > 1) ambiguous.push(`"${REQUIRED[key]}" (muncul ${hits.length}x)`);
    else if (!hits.length) missing.push(`"${REQUIRED[key]}"`);
    map[key] = hits.length ? hits[0] : -1;
  });
  const problems: string[] = [];
  if (missing.length) problems.push(`Header wajib tidak ditemukan: ${missing.join(", ")}. Kolom dibaca berdasarkan nama header, bukan posisi, jadi nama header di file harus sama`);
  if (ambiguous.length) problems.push(`Header ambigu: ${ambiguous.join(", ")}`);
  if (problems.length) return { error: problems.join("; ") + "." };
  return { map };
}

/**
 * Angka gaya en-US: "32,000.00", "438500", "1,234.56", "-500.00".
 * Koma hanya sebagai pemisah ribuan (kelompok 3 digit) dan titik sebagai desimal. Selain itu → null
 * (kosong/tidak valid tidak pernah dianggap nol dan tidak ditebak).
 */
export function parseSourceNumber(raw: string | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) return Number(text.replace(/,/g, ""));
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return null;
}

/** "DD/MM/YYYY" → "YYYY-MM-DD" (divalidasi; tidak ada tanggal bawaan). */
export function convertDate(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(raw ?? "").trim());
  return m ? validYmd(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

const looksLikeDate = (raw: string) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(raw ?? "").trim());

// Label rekap di bawah tabel, mis. "TOTAL KESELURUHAN :", "Sub Total :", "Potongan :", "Pajak :", "Total Akhir :", "Bayar KK :".
// Dicek pada SEMUA sel, bukan pada kolom tertentu, supaya tetap benar bila urutan kolom berubah.
const RECAP_LABEL = /^(total keseluruhan|sub ?total|potongan|service|pajak|total akhir|bayar [a-z ]+|grand total|total)\s*:/i;
const isRecapRow = (cells: string[]) => cells.some((cell) => RECAP_LABEL.test(String(cell ?? "").replace(/\s+/g, " ").trim()));

export type KedaiHutanCempakaCsvParse = {
  ok: boolean;
  error?: string;
  rows: KedaiHutanCempakaRow[];
  issues: KedaiHutanCempakaIssue[];
  invalidRows: number;
  summaryRowsSkipped: number;
};

export function parseKedaiHutanCempakaCsv(text: string, filename: string): KedaiHutanCempakaCsvParse {
  const issues: KedaiHutanCempakaIssue[] = [];
  const fail = (error: string): KedaiHutanCempakaCsvParse => ({ ok: false, error, rows: [], issues, invalidRows: 0, summaryRowsSkipped: 0 });
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter: ",", quoteChar: '"', skipEmptyLines: false });
  const table = parsed.data.filter((cells) => Array.isArray(cells));
  if (!table.length || table.every((cells) => cells.every((cell) => String(cell ?? "").trim() === ""))) return fail("CSV kosong.");

  const found = findHeaderRow(table);
  if (found.index < 0) {
    return fail(`Baris header tidak ditemukan. Header wajib tidak ditemukan: ${FIELD_KEYS.map((k) => `"${REQUIRED[k]}"`).join(", ")}. Kolom dibaca berdasarkan nama header, bukan posisi.`);
  }
  const header = table[found.index];
  const { map, error } = mapColumns(header);
  if (!map) return fail(error ?? "Header tidak valid.");
  const maxIndex = Math.max(...FIELD_KEYS.map((k) => map[k]));

  const rows: KedaiHutanCempakaRow[] = [];
  let invalidRows = 0;
  let summaryRowsSkipped = 0;
  const bad = (rowNo: number, message: string) => { invalidRows += 1; issues.push({ filename, row: rowNo, message }); };
  const cell = (cells: string[], key: FieldKey) => String(cells[map[key]] ?? "").trim();

  table.slice(found.index + 1).forEach((cells, offset) => {
    const rowNo = found.index + offset + 2; // baris pertama file = 1
    if (cells.every((c) => String(c ?? "").trim() === "")) return;
    // Baris rekap ("TOTAL KESELURUHAN :", "Pajak :", ...) dan header yang diulang di tiap halaman bukan transaksi.
    if (isRecapRow(cells) || normalizeHeader(cells[map.receipt]) === normalizeHeader(REQUIRED.receipt)) { summaryRowsSkipped += 1; return; }
    const receipt = cell(cells, "receipt");
    const dateRaw = cell(cells, "date");
    // Transaksi = ada No Transaksi dan tanggal berformat DD/MM/YYYY. Baris lain (mis. footer "tanggal cetak, kasir, 1/1")
    // dilewati; kecuali jelas berisi nilai Total Akhir → ditandai tidak valid agar tidak hilang diam-diam.
    if (!receipt || !looksLikeDate(dateRaw)) {
      if (receipt && parseSourceNumber(cells[map.total]) !== null) bad(rowNo, `Tanggal tidak valid: "${dateRaw}" (format DD/MM/YYYY)`);
      else summaryRowsSkipped += 1;
      return;
    }
    if (cells.length <= maxIndex) { bad(rowNo, "Jumlah kolom kurang dari posisi header (baris tidak dipetakan agar nilai tidak bergeser)"); return; }
    const date = convertDate(dateRaw);
    if (!date) { bad(rowNo, `Tanggal tidak valid: "${dateRaw}"`); return; }
    const nums = {
      subtotal: parseSourceNumber(cells[map.subtotal]),
      discount: parseSourceNumber(cells[map.discount]),
      tax: parseSourceNumber(cells[map.tax]),
      total: parseSourceNumber(cells[map.total]),
    };
    const badField = (Object.keys(nums) as Array<keyof typeof nums>).find((key) => nums[key] === null);
    if (badField) { bad(rowNo, `Nilai ${REQUIRED[badField]} kosong/tidak valid: "${cell(cells, badField)}"`); return; }
    const subtotal = nums.subtotal as number, discount = nums.discount as number, tax = nums.tax as number, total = nums.total as number;
    const dpp = clean(subtotal - discount);
    const rowIssues: string[] = [];
    // Validasi data sumber (hanya catatan; Total Akhir dan Pajak tetap nilai dari file).
    if (Math.abs(total - clean(dpp + tax)) > TOTAL_TOLERANCE) rowIssues.push(`Total Akhir ${total} ≠ DPP + Pajak (${clean(dpp + tax)}) — perlu diperiksa`);
    rows.push({
      filename,
      no_struk: receipt,
      date_trans: date,
      subtotal,
      service_charge: 0,
      discount,
      dpp,
      tax,
      total,
      keterangan: cell(cells, "customer"),
      sourceRow: rowNo,
      issues: rowIssues,
    });
  });
  return { ok: true, rows, issues, invalidRows, summaryRowsSkipped };
}

export function summarizeKedaiHutanCempaka(rows: KedaiHutanCempakaRow[], files: number): KedaiHutanCempakaSummary {
  const sum = (pick: (row: KedaiHutanCempakaRow) => number) => clean(rows.reduce((acc, row) => acc + pick(row), 0));
  return {
    files,
    count: rows.length,
    subtotal: sum((r) => r.subtotal),
    service_charge: sum((r) => r.service_charge),
    discount: sum((r) => r.discount),
    dpp: sum((r) => r.dpp),
    tax: sum((r) => r.tax),
    total: sum((r) => r.total),
  };
}

// Decode: UTF-8 (dengan/tanpa BOM); jika bukan UTF-8 valid, fallback ke windows-1252.
function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export const formatKedaiHutanCempakaMoney = (value: number) => `Rp${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

const failure = (error: string, extra: Partial<KedaiHutanCempakaResult> = {}): KedaiHutanCempakaResult => ({
  ok: false, error, files: [], rows: [], issues: [], duplicateReceipts: 0, duplicateRowsRemoved: 0, filesFailed: 0, summary: emptySummary(), ...extra,
});

const DUP_RECEIPT_PREFIX = "No struk duplikat";

export type KedaiHutanCempakaInput = { name: string; data: Blob | ArrayBuffer | Uint8Array };

/**
 * Memproses satu atau beberapa file CSV (harian: 1 file, bulanan: banyak file) lalu menggabungkan transaksi valid.
 * - File berisi sama persis dengan file yang sudah diproses hanya dihitung sekali; transaksi identik antar-file hanya dihitung sekali.
 * - File yang gagal (bukan CSV, header wajib hilang) ditandai "failed" dan tidak menyumbang transaksi.
 * - no_struk yang sama tetapi nilainya berbeda ditandai, datanya tidak dihapus (identitas belum cukup untuk memastikan duplikat).
 */
export async function parseKedaiHutanCempakaFiles(inputs: KedaiHutanCempakaInput[]): Promise<KedaiHutanCempakaResult> {
  if (!inputs.length) return failure("Belum ada file.");
  const files: KedaiHutanCempakaFileInfo[] = [];
  const issues: KedaiHutanCempakaIssue[] = [];
  const rows: KedaiHutanCempakaRow[] = [];
  const seen = new Map<string, string>();
  const failed = (filename: string, message: string) => {
    files.push({ filename, status: "failed", transactions: 0, invalidRows: 0, summaryRowsSkipped: 0, message });
    issues.push({ filename, row: null, message });
  };

  for (const input of [...inputs].sort((a, b) => a.name.localeCompare(b.name, "id", { numeric: true, sensitivity: "base" }))) {
    if (!/\.csv$/i.test(input.name)) { failed(input.name, "File harus berformat .csv."); continue; }
    let text: string;
    try {
      const buffer = input.data instanceof Blob ? await input.data.arrayBuffer() : input.data;
      text = decodeBytes(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    } catch {
      failed(input.name, "Gagal membaca file.");
      continue;
    }
    const fingerprint = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
    const original = seen.get(fingerprint);
    if (original !== undefined) {
      files.push({ filename: input.name, status: "duplicate", transactions: 0, invalidRows: 0, summaryRowsSkipped: 0, message: `Isi sama dengan ${original}; tidak dihitung ulang` });
      continue;
    }
    seen.set(fingerprint, input.name);
    const parsed = parseKedaiHutanCempakaCsv(text, input.name);
    if (!parsed.ok) { failed(input.name, parsed.error ?? "CSV tidak valid"); continue; }
    files.push({ filename: input.name, status: "processed", transactions: parsed.rows.length, invalidRows: parsed.invalidRows, summaryRowsSkipped: parsed.summaryRowsSkipped });
    issues.push(...parsed.issues);
    rows.push(...parsed.rows);
  }

  const processed = files.filter((f) => f.status === "processed").length;
  if (!processed) {
    return failure(`Tidak ada CSV valid. ${files.map((f) => `${f.filename}: ${f.message ?? f.status}`).join("; ")}`, { files, issues });
  }

  // Cegah transaksi ganda ANTAR-FILE (mis. laporan yang tumpang tindih): hanya bila seluruh identitas sama
  // (no struk, tanggal, subtotal, pot., pajak, total, kode pel.). No struk sama tetapi nilai berbeda TIDAK dibuang.
  // Dalam satu file tidak ada yang dibuang, sehingga hasil satu file sama seperti sebelumnya.
  const identity = (r: KedaiHutanCempakaRow) => [r.no_struk, r.date_trans, r.subtotal, r.discount, r.tax, r.total, r.keterangan].join("\u0001");
  const firstSeen = new Map<string, string>(); // identitas → file pertama
  const unique: KedaiHutanCempakaRow[] = [];
  let duplicateRowsRemoved = 0;
  for (const row of rows) {
    const key = identity(row);
    const origin = firstSeen.get(key);
    if (origin !== undefined && origin !== row.filename) {
      duplicateRowsRemoved += 1;
      issues.push({ filename: row.filename, row: row.sourceRow, message: `Transaksi ${row.no_struk} identik dengan transaksi di ${origin}; tidak dihitung ulang` });
      continue;
    }
    if (origin === undefined) firstSeen.set(key, row.filename);
    unique.push(row);
  }
  rows.length = 0;
  rows.push(...unique);

  // Tandai no_struk yang sama tetapi identitasnya berbeda (data TIDAK dihapus).
  const counts = new Map<string, number>();
  rows.forEach((row) => { counts.set(row.no_struk, (counts.get(row.no_struk) ?? 0) + 1); });
  let duplicateReceipts = 0;
  counts.forEach((n) => { if (n > 1) duplicateReceipts += 1; });
  rows.forEach((row) => {
    const n = counts.get(row.no_struk) ?? 0;
    if (n > 1) row.issues.push(`${DUP_RECEIPT_PREFIX} (${n}x) dengan nilai berbeda — perlu diperiksa`);
  });

  return { ok: true, files, rows, issues, duplicateReceipts, duplicateRowsRemoved, filesFailed: files.filter((f) => f.status === "failed").length, summary: summarizeKedaiHutanCempaka(rows, processed) };
}
