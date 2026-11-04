/**
 * Daftar mode pemeriksaan UPL V1 (satu-satunya sumber untuk Beranda, hub, dan Tentang).
 * Hanya metadata tampilan: tidak menyentuh parser, rumus, atau aturan validasi.
 * `formats` dan `summary` diambil dari input yang benar-benar diterima masing-masing checker.
 */
export type UplModeInfo = {
  slug: string;
  asset: string;
  name: string;
  formats: string[];
  summary: string;
  fit?: "round" | "crop";
};

export const UPL_MODES: UplModeInfo[] = [
  { slug: "kland", asset: "kland", name: "KLAND", formats: [".xlsx", ".xls"], summary: "Harian (1 file) atau bulanan (banyak file). Ringkasan per kategori dan pengecekan silang C&C / Resto." },
  { slug: "the-omala", asset: "omala", name: "THE OMALA", formats: [".csv"], summary: "Pilih kategori HOTEL atau RESTO, lalu periksa file CSV harian atau bulanan." },
  { slug: "omah-padhang", asset: "omahpadhang", name: "OMAH PADHANG", formats: [".zip"], summary: "Upload ZIP berisi CSV transaksi, harian atau bulanan." },
  { slug: "inna-tretes", asset: "innatretes", name: "INNA TRETES", formats: [".xlsx", ".xls"], summary: "Kategori HOTEL, HIBURAN, dan RESTO dari satu file, dengan filter bulan dan tahun." },
  { slug: "royal-senyiur", asset: "royalsenyiur", name: "ROYAL SENYIUR", formats: [".csv"], summary: "Periksa file CSV transaksi, harian atau bulanan." },
  { slug: "hotel-plataran", asset: "plataran", name: "HOTEL PLATARAN", formats: [".xlsx"], summary: "Membaca sheet BODY EMAIL pada file Excel, harian atau bulanan." },
  { slug: "kedai-hutan-cempaka", asset: "kedaihutancempaka", name: "KEDAI HUTAN CEMPAKA", formats: [".csv"], summary: "Laporan Penjualan Rekap CSV, kolom dibaca dari nama header; harian atau bulanan." },
  { slug: "hotel-surya-tretes", asset: "suryatretes", name: "HOTEL SURYA TRETES", formats: [".xls", ".xlsx"], summary: "F/O Turnover Report by Department: kategori Hotel, Resto, Kolam Renang, dan Kebugaran dari satu file, harian atau bulanan." },
];

export const UPL_BASE = "/pemeriksaan-upl";
export const uplPath = (slug?: string) => (slug ? `${UPL_BASE}/${slug}` : UPL_BASE);
