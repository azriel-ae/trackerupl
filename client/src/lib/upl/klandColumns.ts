import { ART_ALIASES, FIELD_ALIASES, NETT_ALIASES, SERVICE_ALIASES, columnLetter, normalizeHeader, parseIndonesianNumber } from "./uplParser";

/**
 * Penentuan kolom record C&C / PREGO / KFOOD berdasarkan NAMA HEADER file yang sedang
 * diproses — prinsip yang sama dengan parser KLAND utama (Day-qty / Day-Gros / Tax).
 *
 * Sebelumnya record dibaca dari huruf kolom tetap (C&C: B–F, RESTO: B,D–G). Huruf tetap
 * itu tidak ikut bergeser jika kolom antar file berbeda dan, untuk C&C, tidak sama dengan
 * layout laporan (A Art, B Description, C Day-qty, D Day-Nett, E Service, F Tax, G Day-Gros)
 * sehingga ringkasan (dari header) dan detail (dari huruf) bisa membaca kolom yang berbeda.
 *
 * Pemetaan field record -> header:
 *   keterangan     <- Description / Rincian
 *   qty            <- Day-qty            (opsional)
 *   subtotal       <- Day-Nett
 *   service_charge <- Service
 *   tax            <- Tax                (alias sama dengan parser utama)
 *   total          <- Day-Gros           (kolom yang sama dengan Total Day-Gros pada ringkasan)
 */

export type RecordField = "keterangan" | "art" | "qty" | "subtotal" | "service_charge" | "tax" | "total";
export type RecordColumns = Record<Exclude<RecordField, "qty" | "art">, number> & { qty: number | null; art: number | null };

const RECORD_ALIASES: Record<RecordField, string[]> = {
  keterangan: FIELD_ALIASES.description,
  art: ART_ALIASES,
  qty: FIELD_ALIASES.qty,
  subtotal: NETT_ALIASES,
  service_charge: SERVICE_ALIASES,
  tax: FIELD_ALIASES.tax,
  total: FIELD_ALIASES.subtotal, // alias Day-Gros pada parser utama
};

const REQUIRED: Exclude<RecordField, "qty" | "art">[] = ["keterangan", "subtotal", "service_charge", "tax", "total"];
const HEADER_SCAN_LIMIT = 2000;

export type LocatedColumns = { headerIndex: number; cols: RecordColumns };

/** Cari baris header pertama yang memuat semua field wajib. null jika tidak ada. */
export function locateRecordColumns(matrix: unknown[][]): LocatedColumns | null {
  const limit = Math.min(matrix.length, HEADER_SCAN_LIMIT);
  for (let r = 0; r < limit; r++) {
    const found: Partial<Record<RecordField, number>> = {};
    (matrix[r] ?? []).forEach((cell, c) => {
      const normalized = normalizeHeader(cell);
      if (!normalized) return;
      (Object.keys(RECORD_ALIASES) as RecordField[]).forEach((field) => {
        if (found[field] === undefined && RECORD_ALIASES[field].includes(normalized)) found[field] = c;
      });
    });
    if (REQUIRED.every((field) => found[field] !== undefined)) {
      return { headerIndex: r, cols: { ...(found as Record<Exclude<RecordField, "qty" | "art">, number>), qty: found.qty ?? null, art: found.art ?? null } };
    }
  }
  return null;
}

/** Huruf kolom Excel untuk tampilan ("kolom dipakai"). */
export function columnLettersOf(cols: RecordColumns, firstColumn: number): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(cols) as RecordField[]).forEach((field) => {
    const idx = cols[field];
    if (idx !== null && idx !== undefined) out[field] = columnLetter(firstColumn + idx);
  });
  return out;
}

/**
 * Judul bagian (mis. "3 - RESTO PADI - C&C-FAR" atau "RESTO PADI - C&C-FAR") = baris dengan deskripsi tetapi tanpa
 * nomor Art dan tanpa angka sama sekali (qty, Day-Nett, Service, Tax, Day-Gros kosong). Bukan transaksi, jadi tidak
 * boleh menjadi record walaupun namanya ada di daftar item. Aturan yang sama dengan parser utama (uplParser.ts).
 */
export function isSectionTitleRow(row: unknown[], cols: RecordColumns): boolean {
  const description = String(row[cols.keterangan] ?? "").trim();
  if (!description) return false;
  if (cols.art !== null && String(row[cols.art] ?? "").trim() !== "") return false;
  const numericCols = [cols.qty, cols.subtotal, cols.service_charge, cols.tax, cols.total];
  return numericCols.every((c) => c === null || parseIndonesianNumber(row[c]).value === null);
}
