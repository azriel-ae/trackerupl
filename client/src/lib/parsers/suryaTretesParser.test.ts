import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildSuryaNoStruk,
  findDuplicateSuryaNoStruk,
  formatSuryaMoney,
  matchSuryaCategories,
  mergeSuryaSources,
  parseSuryaDecimal,
  parseSuryaFilenameDate,
  parseSuryaGrid,
  parseSuryaTretesWorkbook,
  summarizeSuryaByCategory,
  summarizeSuryaRows,
  suryaFileStem,
  suryaToPlain,
  SURYA_CATEGORIES,
  type SuryaCategory,
  type SuryaGrid,
  type SuryaSource,
} from "./suryaTretesParser";

const must = (source: SuryaSource) => { expect(source.error).toBeUndefined(); expect(source.ok).toBe(true); return source; };
const plain = (value: bigint) => suryaToPlain(value);

const SAMPLE_PATH = fileURLToPath(new URL("../fixtures/SURYA03112026.xls", import.meta.url));
const sampleBuffer = () => { const b = readFileSync(SAMPLE_PATH); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

// ───────── helper: grid sintetis yang meniru laporan asli (18 kolom: blok Day, MTD, YTD) ─────────

/** Nilai { error } menjadi sel error (#DIV/0! dst). null/undefined = sel kosong. */
type Raw = unknown;
const toCell = (v: Raw) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "object" && v !== null && "error" in v) return { t: "e", v: 7, w: String((v as { error: string }).error) };
  return { t: typeof v === "number" ? "n" : "s", v };
};
const gridOf = (rows: Raw[][], sheetName = "Output File"): SuryaGrid => ({
  sheetName,
  lastRow: rows.length,
  lastCol: Math.max(1, ...rows.map((r) => r.length)),
  getCell: (row, col) => toCell(rows[row - 1]?.[col - 1]),
});

const HEADER: Raw[] = ["Art Description", "Day-Nett", "Service", "Tax", "Day-Gros", "(%)", "MTD-Nett", "Service", "Tax", "MTD-Gros", "(%)", null, "YTD-Nett", "Service", "Tax", "YTD-Gros", "(%)", "M-Bugdet"];
// Blok MTD/YTD sengaja berisi angka berbeda (777 / 999) untuk membuktikan keduanya tidak pernah dibaca.
const item = (desc: Raw, nett: Raw, service: Raw, tax: Raw, gros: Raw): Raw[] => [desc, nett, service, tax, gros, 12.5, 777, 777, 777, 777, 12.5, null, 999, 999, 999, 999, 12.5, 555];
const DASHES: Raw[] = ["-----------------------------------", "--------------", "--------------------", "--------------------", "--------------------", "----------"];
const TITLE: Raw[][] = [
  ["\u001bM\u000f"],
  ["SURYA HOTEL PRIGEN TRETES (Pasuruan", { error: "#NAME?" }, null, null, null, null, null, null, null, "Page   :", 1],
  ["Jl. Taman Wisata"],
  ["F/O Turnover Report by Department"],
  [],
];

/** Satu hari lengkap: keempat kategori + baris yang harus diabaikan, dengan header berulang di halaman kedua. */
const dayRows = (): Raw[][] => [
  ...TITLE,
  HEADER,
  DASHES,
  ["0 - FRONT OFFICE"],
  item("100 Lodging (Room Revenue)", 1000000, 100000, 110000, 1210000),
  item("110 Extra Bed", 0, 0, 0, 0),
  item("114 Late C/O", 50000, 5000, 5500, 60500),
  item("143 Shop - Good Sold", 10000, 0, 0, 10000), // di luar kategori
  item("200 Mineral Water", 24793, 2479, 2727, 30000), // di luar kategori
  DASHES,
  item("T O T A L", 1084793, 107479, 118227, 1310499),
  ["1 - SURYA COFFEE SHOP"], // judul seksi memuat kata COFFEE
  item("10 Food COFFEE SHOP", 200000, 20000, 22000, 242000),
  item("911 Disc Food COFFEE SHOP", -20000, -2000, -2200, -24200),
  item("TOTAL FOOD", 180000, 18000, 19800, 217800), // baris total memuat kata FOOD
  ["\f\u001bM\u000f"], // pemisah halaman
  [],
  HEADER, // header berulang di halaman berikutnya
  DASHES,
  ["20 - LAUNDRY, SPA, FITNE"], // judul seksi memuat kata LAUNDRY
  item("10 Laundry", 107438, 10744, 11818, 130000),
  item("601 Swimming Pool", 100000, 0, 10000, 110000), // Service = 0, Tax tetap dari header Tax
  item("501 Tennis", 200000, 20000, 22000, 242000),
  item("650 Sport & Recreation", 0, 0, 0, 0),
  DASHES,
  item("T O T A L", 407438, 30744, 43818, 482000),
  [],
  item("GRAND TOTAL", 1, 1, 1, 3),
  ["\f"],
];

const byCat = (source: SuryaSource, cat: SuryaCategory) => source.rows.filter((r) => r.category === cat);
const DAY_FILE = "SURYA03112026.xls";

describe("nama file → tanggal", () => {
  it("SURYADDMMYYYY → YYYY-MM-DD", () => {
    expect(parseSuryaFilenameDate("SURYA03112026.xls")).toEqual({ ok: true, date: "2026-11-03" });
    expect(parseSuryaFilenameDate("SURYA31012026.xlsx")).toEqual({ ok: true, date: "2026-01-31" });
  });
  it("prefix tidak peka huruf besar/kecil; boleh ada pemisah dan akhiran duplikat unduhan", () => {
    expect(parseSuryaFilenameDate("surya03112026.xls")).toEqual({ ok: true, date: "2026-11-03" });
    expect(parseSuryaFilenameDate("SURYA_03112026.xls")).toEqual({ ok: true, date: "2026-11-03" });
    expect(parseSuryaFilenameDate("SURYA03112026 (1).xls")).toEqual({ ok: true, date: "2026-11-03" });
  });
  it("tanggal selalu dari pola nama file, bukan dari angka lain", () => {
    expect(parseSuryaFilenameDate("laporan 2026 SURYA05112026.xls")).toEqual({ ok: true, date: "2026-11-05" });
  });
  it("digit tidak 8, tanggal kalender tidak ada, atau pola tidak cocok → tidak valid dengan pesan", () => {
    const wrongDigits = parseSuryaFilenameDate("SURYA031126.xls");
    expect(wrongDigits.ok).toBe(false);
    expect(!wrongDigits.ok && wrongDigits.error).toContain("6 digit");
    const impossible = parseSuryaFilenameDate("SURYA31022026.xls");
    expect(impossible.ok).toBe(false);
    expect(!impossible.ok && impossible.error).toContain("bukan tanggal kalender");
    const noPrefix = parseSuryaFilenameDate("03112026.xls");
    expect(noPrefix.ok).toBe(false);
    expect(!noPrefix.ok && noPrefix.error).toContain("tidak sesuai");
    expect(parseSuryaFilenameDate("SURYA.xls").ok).toBe(false);
  });
  it("nama dasar file = tanpa ekstensi terakhir", () => {
    expect(suryaFileStem("SURYA03112026.xls")).toBe("SURYA03112026");
    expect(suryaFileStem("SURYA03112026")).toBe("SURYA03112026");
    expect(buildSuryaNoStruk("SURYA03112026.xls", "114 Late C/O")).toBe("SURYA03112026-114 Late C/O");
  });
});

describe("pola kategori", () => {
  const cases: Array<[string, SuryaCategory | null]> = [
    ["100 Lodging (Room Revenue)", "HOTEL"], ["110 Extra Bed", "HOTEL"], ["112 Additional Room Charge", "HOTEL"], ["113 Early C/I", "HOTEL"],
    ["114 Late C/O", "HOTEL"], ["10 Laundry", "HOTEL"], ["35 Outside Laundry", "HOTEL"], ["911 Disc Laundry", "HOTEL"],
    ["10 Food COFFEE SHOP", "RESTO"], ["11 Beverage R.SERV", "RESTO"], ["12 B'fast COFFEE SHOP", "RESTO"], ["14 Dinner COFFEE SHOP", "RESTO"],
    ["13 Lunch Package BQT", "RESTO"], ["320 Outside Catering", "RESTO"], ["151 Beverage Minibar", "RESTO"], ["100 Coffee Break 1", "RESTO"],
    ["200 Room Rental BQT", "RESTO"], ["911 Disc Food BANQUET", "RESTO"], ["Breakfast Package", "RESTO"],
    ["601 Swimming Pool", "KOLAM_RENANG"],
    ["650 Sport & Recreation", "KEBUGARAN"], ["501 Tennis", "KEBUGARAN"],
    ["200 Mineral Water", null], ["143 Shop - Good Sold", null], ["401 Spa & Massage", null], ["403 A/P Commission OTA", null],
    ["130 BC Internet", null], ["140 Transportation", null], ["1901 ST-Room Available", null], ["T O T A L", null],
  ];
  it.each(cases)("%s → %s", (description, expected) => {
    expect(matchSuryaCategories(description)).toEqual(expected ? [expected] : []);
  });
  it("huruf kecil dan spasi ganda tetap dikenali; item ganda kategori terdeteksi", () => {
    expect(matchSuryaCategories("114   LATE   C/O")).toEqual(["HOTEL"]);
    expect(matchSuryaCategories("601 swimming pool")).toEqual(["KOLAM_RENANG"]);
    expect(matchSuryaCategories("Swimming Pool Food")).toEqual(["RESTO", "KOLAM_RENANG"]);
  });
});

describe("parseSuryaGrid · empat kategori dalam satu file", () => {
  const src = must(parseSuryaGrid(gridOf(dayRows()), DAY_FILE));

  it("keempat kategori dikenali; judul seksi, TOTAL, GRAND TOTAL, dan item di luar kategori tidak terbaca", () => {
    expect(byCat(src, "HOTEL").map((r) => r.description)).toEqual(["100 Lodging (Room Revenue)", "114 Late C/O", "10 Laundry"]);
    expect(byCat(src, "RESTO").map((r) => r.description)).toEqual(["10 Food COFFEE SHOP", "911 Disc Food COFFEE SHOP"]);
    expect(byCat(src, "KOLAM_RENANG").map((r) => r.description)).toEqual(["601 Swimming Pool"]);
    expect(byCat(src, "KEBUGARAN").map((r) => r.description)).toEqual(["501 Tennis"]);
    expect(src.stats.validRows).toBe(7);
    expect(src.rows.some((r) => /TOTAL|Shop - Good|Mineral Water/i.test(r.description))).toBe(false);
    expect(src.rows.some((r) => /FITNE|SURYA COFFEE/i.test(r.description))).toBe(false);
  });

  it("header di halaman berikutnya dikenali: transaksi halaman 2 tidak hilang", () => {
    expect(src.stats.headerRows).toBe(2);
    expect(src.rows.filter((r) => r.sourceRow > 20).length).toBe(3); // Laundry, Swimming, Tennis ada di halaman 2
  });

  it("rumus: subtotal=Day-Nett, service=Service, discount=0, dpp=Nett+Service, tax=Tax, total=Day-Gros, keterangan=nama dasar file", () => {
    const lodging = src.rows.find((r) => r.description.startsWith("100 Lodging"))!;
    expect(plain(lodging.subtotal)).toBe("1000000");
    expect(plain(lodging.service_charge)).toBe("100000");
    expect(plain(lodging.discount)).toBe("0");
    expect(plain(lodging.dpp)).toBe("1100000");
    expect(plain(lodging.tax)).toBe("110000");
    expect(plain(lodging.total)).toBe("1210000");
    expect(lodging.keterangan).toBe("SURYA03112026");
    expect(lodging.no_struk).toBe("SURYA03112026-100 Lodging (Room Revenue)");
    expect(lodging.date_trans).toBe("2026-11-03");
    expect(lodging.filename).toBe(DAY_FILE);
  });

  it("blok MTD/YTD tidak pernah dibaca (kolom Service dan Tax kembar)", () => {
    expect(src.rows.some((r) => [r.subtotal, r.service_charge, r.tax, r.total].some((v) => plain(v) === "777" || plain(v) === "999"))).toBe(false);
  });

  it("Kolam Renang dan Kebugaran: Tax dari header Tax, bukan dari Service; Service = 0 tidak membuang baris", () => {
    const pool = byCat(src, "KOLAM_RENANG")[0];
    expect(plain(pool.service_charge)).toBe("0");
    expect(plain(pool.tax)).toBe("10000");
    expect(plain(pool.dpp)).toBe("100000"); // Nett + Service(0)
    expect(plain(pool.total)).toBe("110000");
    const tennis = byCat(src, "KEBUGARAN")[0];
    expect(plain(tennis.service_charge)).toBe("20000");
    expect(plain(tennis.tax)).toBe("22000");
    expect(plain(tennis.dpp)).toBe("220000");
    expect(plain(tennis.total)).toBe("242000");
  });

  it("baris diskon (negatif) dihitung apa adanya dan diberi catatan", () => {
    const disc = src.rows.find((r) => r.description.startsWith("911 Disc Food"))!;
    expect(plain(disc.subtotal)).toBe("-20000");
    expect(plain(disc.service_charge)).toBe("-2000");
    expect(plain(disc.dpp)).toBe("-22000");
    expect(plain(disc.tax)).toBe("-2200");
    expect(plain(disc.total)).toBe("-24200");
    expect(disc.notes).toContain("Nominal negatif (diskon)");
  });

  it("baris Day-Gros = 0 dilewati (Extra Bed, Recreation); tidak ada masalah data", () => {
    expect(src.rows.some((r) => /Extra Bed|Recreation/.test(r.description))).toBe(false);
    expect(src.stats.zeroRows).toBe(2);
    expect(src.issues).toEqual([]);
  });

  it("ringkasan per kategori dan total dijumlahkan dari seluruh record", () => {
    const by = summarizeSuryaByCategory(src.rows);
    expect(by.HOTEL.count).toBe(3);
    expect(plain(by.HOTEL.subtotal)).toBe("1157438"); // 1000000 + 50000 + 107438
    expect(plain(by.HOTEL.total)).toBe("1400500"); // 1210000 + 60500 + 130000
    expect(by.RESTO.count).toBe(2);
    expect(plain(by.RESTO.dpp)).toBe("198000"); // (200000+20000) + (-20000-2000)
    expect(plain(by.KOLAM_RENANG.tax)).toBe("10000");
    expect(plain(by.KEBUGARAN.total)).toBe("242000");
    const all = summarizeSuryaRows(src.rows);
    expect(all.count).toBe(7);
    expect(plain(all.total)).toBe("1970300"); // 1400500 (HOTEL) + 217800 (RESTO) + 110000 (KOLAM RENANG) + 242000 (KEBUGARAN)
    expect(plain(all.discount)).toBe("0");
    expect(SURYA_CATEGORIES.reduce((n, c) => n + by[c].count, 0)).toBe(all.count);
  });
});

describe("pembacaan berdasarkan nama header, bukan posisi", () => {
  const baseline = must(parseSuryaGrid(gridOf(dayRows()), DAY_FILE));
  const signature = (s: SuryaSource) => s.rows.map((r) => [r.category, r.no_struk, plain(r.subtotal), plain(r.service_charge), plain(r.dpp), plain(r.tax), plain(r.total)].join("|"));

  it("kolom bergeser (dua kolom kosong di depan) menghasilkan hasil identik", () => {
    const shifted = dayRows().map((row) => [null, null, ...row]);
    expect(signature(must(parseSuryaGrid(gridOf(shifted), DAY_FILE)))).toEqual(signature(baseline));
  });

  it("urutan Service dan Tax di blok Day ditukar menghasilkan hasil identik", () => {
    const swapped = dayRows().map((row) => { const r = [...row]; [r[2], r[3]] = [r[3], r[2]]; return r; });
    expect(signature(must(parseSuryaGrid(gridOf(swapped), DAY_FILE)))).toEqual(signature(baseline));
  });

  it("kolom Art Description tidak harus di kolom pertama", () => {
    const moved = dayRows().map((row) => [...row.slice(1, 5), row[0], ...row.slice(5)]);
    // Art Description dipindah ke kolom 5 (setelah Day-Gros); blok Day-Nett → Day-Gros tetap berurutan.
    expect(signature(must(parseSuryaGrid(gridOf(moved), DAY_FILE)))).toEqual(signature(baseline));
  });

  it("header berulang di halaman 2 dengan posisi kolom berbeda dibaca dengan peta kolom miliknya sendiri", () => {
    const page1: Raw[][] = [...TITLE, HEADER, DASHES, item("100 Lodging (Room Revenue)", 1000000, 100000, 110000, 1210000), item("10 Food COFFEE SHOP", 200000, 20000, 22000, 242000)];
    const shiftedHeader = [null, ...HEADER];
    const page2: Raw[][] = [["\f"], shiftedHeader, [null, ...DASHES], [null, ...item("601 Swimming Pool", 100000, 0, 10000, 110000)], [null, ...item("501 Tennis", 200000, 20000, 22000, 242000)]];
    const res = must(parseSuryaGrid(gridOf([...page1, ...page2]), DAY_FILE));
    expect(res.stats.headerRows).toBe(2);
    expect(res.rows.map((r) => r.category)).toEqual(["HOTEL", "RESTO", "KOLAM_RENANG", "KEBUGARAN"]);
    expect(plain(byCat(res, "KOLAM_RENANG")[0].tax)).toBe("10000");
  });

  it("nama header tidak peka huruf besar/kecil dan spasi/tanda hubung", () => {
    const rows = dayRows();
    const hi = rows.findIndex((r) => r[0] === "Art Description");
    rows[hi] = ["  art  description ", "DAY NETT", "service", "TAX", "day-gros", ...HEADER.slice(5)];
    expect(signature(must(parseSuryaGrid(gridOf(rows), DAY_FILE)))).toEqual(signature(baseline));
  });
});

describe("angka kosong, negatif, dan tidak valid", () => {
  const page = (...items: Raw[][]): SuryaGrid => gridOf([...TITLE, HEADER, DASHES, ...items]);

  it("Service atau Tax kosong dianggap 0 dan dicatat; baris tidak dibuang", () => {
    const res = must(parseSuryaGrid(page(item("601 Swimming Pool", 100000, null, 10000, 110000), item("501 Tennis", 100000, 10000, null, 110000)), DAY_FILE));
    expect(res.rows.length).toBe(2);
    expect(plain(res.rows[0].service_charge)).toBe("0");
    expect(res.rows[0].notes.join(";")).toContain("Service kosong dianggap 0");
    expect(plain(res.rows[1].tax)).toBe("0");
    expect(res.rows[1].notes.join(";")).toContain("Tax kosong dianggap 0");
  });

  it("Day-Nett kosong atau Day-Gros bukan angka → masalah dilaporkan, baris tidak dihitung", () => {
    const res = must(parseSuryaGrid(page(
      item("601 Swimming Pool", null, 0, 10000, 110000),
      item("501 Tennis", 100000, 0, 0, "abc"),
      item("114 Late C/O", 100000, 0, { error: "#DIV/0!" }, 100000),
      item("100 Lodging", 100000, 10000, 11000, 121000),
    ), DAY_FILE));
    expect(res.rows.map((r) => r.description)).toEqual(["100 Lodging"]);
    expect(res.stats.invalidRows).toBe(3);
    expect(res.issues.map((i) => i.row)).toEqual([8, 9, 10]); // TITLE 5 baris + header + garis → item mulai baris 8
    expect(res.issues[0].message).toContain("Day-Nett");
    expect(res.issues[1].message).toContain("Day-Gros");
    expect(res.issues[2].message).toContain("Tax");
  });

  it("angka teks desimal polos diterima; format ribuan ditolak (tidak ditebak)", () => {
    const res = must(parseSuryaGrid(page(item("100 Lodging", "1000.50", "100", "110", "1210.50"), item("501 Tennis", "1.000,00", 0, 0, 1000)), DAY_FILE));
    expect(res.rows.length).toBe(1);
    expect(plain(res.rows[0].subtotal)).toBe("1000.5");
    expect(plain(res.rows[0].total)).toBe("1210.5");
    expect(res.issues.length).toBe(1);
  });

  it("desimal tetap eksak, tanpa selisih floating point", () => {
    const res = must(parseSuryaGrid(page(item("100 Lodging", 0.1, 0.2, 0.03, 0.33)), DAY_FILE));
    expect(plain(res.rows[0].dpp)).toBe("0.3");
    expect(plain(res.rows[0].total)).toBe("0.33");
  });

  it("Day-Gros = 0 tetapi Nett tidak nol: tetap dilewati, tetapi diberi peringatan", () => {
    const res = must(parseSuryaGrid(page(item("601 Swimming Pool", 5000, 0, 0, 0)), DAY_FILE));
    expect(res.rows.length).toBe(0);
    expect(res.warnings.join(" ")).toContain("Day-Gros = 0");
  });

  it("selisih Day-Gros vs Nett+Service+Tax: pembulatan Rp1 tidak dicatat, selisih besar dicatat; nilai sumber tidak diubah", () => {
    const res = must(parseSuryaGrid(page(item("10 Food COFFEE SHOP", 915702, 91570, 100727, 1108000), item("11 Beverage COFFEE SHOP", 100000, 10000, 11000, 125000)), DAY_FILE));
    expect(res.rows[0].notes).toEqual([]);
    expect(res.rows[1].notes.join(";")).toContain("berbeda");
    expect(plain(res.rows[1].total)).toBe("125000");
  });

  it("item yang cocok dengan lebih dari satu kategori tidak ditebak", () => {
    const res = must(parseSuryaGrid(page(item("Swimming Pool Food", 100000, 10000, 11000, 121000), item("100 Lodging", 100000, 10000, 11000, 121000)), DAY_FILE));
    expect(res.rows.map((r) => r.description)).toEqual(["100 Lodging"]);
    expect(res.stats.ambiguousRows).toBe(1);
    expect(res.issues[0].message).toContain("lebih dari satu kategori");
  });

  it("no_struk ganda dalam satu file ditandai, data tidak digabung", () => {
    const res = must(parseSuryaGrid(page(item("100 Lodging", 1, 0, 0, 1), item("100 Lodging", 2, 0, 0, 2)), DAY_FILE));
    expect(res.rows.length).toBe(2);
    expect([...findDuplicateSuryaNoStruk(res.rows)]).toEqual(["SURYA03112026-100 Lodging"]);
  });
});

describe("karakter kontrol printer dan baris non-transaksi", () => {
  it("baris pemisah halaman dan karakter kontrol tidak menjadi transaksi; karakter kontrol di nama item dibuang", () => {
    const res = must(parseSuryaGrid(gridOf([...TITLE, HEADER, DASHES, ["\f\u001bM\u000f"], item("\f114 Late C/O", 50000, 5000, 5500, 60500)]), DAY_FILE));
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].description).toBe("114 Late C/O");
    expect(res.rows[0].no_struk).toBe("SURYA03112026-114 Late C/O");
  });
  it("judul seksi yang memuat kata kunci (LAUNDRY, COFFEE) tidak menjadi transaksi", () => {
    const res = must(parseSuryaGrid(gridOf([...TITLE, HEADER, DASHES, ["20 - LAUNDRY, SPA, FITNE"], ["1 - SURYA COFFEE SHOP"], item("100 Lodging", 1, 0, 0, 1)]), DAY_FILE));
    expect(res.rows.length).toBe(1);
    expect(res.stats.sectionRows).toBeGreaterThanOrEqual(2);
  });
  it("baris sebelum header pertama (judul, nama hotel) diabaikan walau kolomnya berisi angka/teks", () => {
    const res = must(parseSuryaGrid(gridOf([["Food Beverage Lodging", 5, 5, 5, 5], ...TITLE, HEADER, item("100 Lodging", 1, 0, 0, 1)]), DAY_FILE));
    expect(res.rows.length).toBe(1);
  });
});

describe("header wajib hilang atau bermasalah", () => {
  const withHeader = (header: Raw[]) => gridOf([...TITLE, header, DASHES, item("100 Lodging", 1, 0, 0, 1)]);
  const without = (name: string, occurrence = 0): Raw[] => { const h = [...HEADER]; let n = 0; return h.map((c) => (c === name && n++ === occurrence ? null : c)); };

  it("Day-Gros hilang → pesan menyebut Day-Gros", () => {
    const res = parseSuryaGrid(withHeader(without("Day-Gros")), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Day-Gros");
    expect(res.rows).toEqual([]);
  });
  it("Day-Nett hilang → pesan menyebut Day-Nett", () => {
    const res = parseSuryaGrid(withHeader(without("Day-Nett")), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Day-Nett");
  });
  it("Tax di blok Day hilang walau Tax blok MTD/YTD ada → tetap ditolak, tidak mengambil Tax blok lain", () => {
    const res = parseSuryaGrid(withHeader(without("Tax", 0)), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Tax");
  });
  it("Service di blok Day hilang → ditolak", () => {
    const res = parseSuryaGrid(withHeader(without("Service", 0)), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Service");
  });
  it("beberapa header hilang → semuanya disebut dalam satu pesan", () => {
    const h = without("Day-Nett"); const g = h.map((c) => (c === "Day-Gros" ? null : c));
    const res = parseSuryaGrid(withHeader(g), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Day-Nett");
    expect(res.error).toContain("Day-Gros");
  });
  it("Day-Nett ganda → ditolak (ambigu)", () => {
    const h = [...HEADER]; h[6] = "Day-Nett";
    const res = parseSuryaGrid(withHeader(h), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ganda");
  });
  it("Art Description hilang (tidak ada baris header) → pesan menyebut Art Description", () => {
    const res = parseSuryaGrid(withHeader(without("Art Description")), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Art Description");
    expect(res.error).not.toContain("Day-Nett");
  });
  it("header berulang yang rusak di halaman 2 juga ditolak, tidak diam-diam memakai peta kolom lama", () => {
    const rows = [...TITLE, HEADER, item("100 Lodging", 1, 0, 0, 1), ["\f"], without("Day-Gros"), item("601 Swimming Pool", 1, 0, 0, 1)];
    const res = parseSuryaGrid(gridOf(rows), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Day-Gros");
    expect(res.error).toContain("header");
  });
  it("sheet tanpa header sama sekali menyebut semua header yang hilang", () => {
    const res = parseSuryaGrid(gridOf([["foo", "bar"], ["x", 1]]), DAY_FILE);
    expect(res.ok).toBe(false);
    for (const name of ["Art Description", "Day-Nett", "Service", "Tax", "Day-Gros"]) expect(res.error).toContain(name);
  });
});

describe("nama file tidak sesuai", () => {
  it("pola tanggal salah → file gagal dengan peringatan jelas, tidak memakai tanggal hari ini", () => {
    const res = parseSuryaGrid(gridOf(dayRows()), "laporan-hotel.xls");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("laporan-hotel.xls");
    expect(res.error).toContain("tidak sesuai");
    expect(res.rows).toEqual([]);
  });
  it("tanggal kalender tidak ada → gagal", () => {
    const res = parseSuryaGrid(gridOf(dayRows()), "SURYA31112026.xls"); // 31 November tidak ada
    expect(res.ok).toBe(false);
    expect(res.error).toContain("bukan tanggal kalender");
  });
});

describe("tanggal Period di dalam laporan", () => {
  const serial = (ymd: string) => Math.round((Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
  const withPeriod = (ymd: string): Raw[][] => [["\u001bM"], ["SURYA HOTEL"], ["Jl. Taman Wisata", null, null, null, null, null, null, null, null, "Period :", serial(ymd)], HEADER, item("100 Lodging", 1, 0, 0, 1)];
  it("sama dengan tanggal nama file → tanpa peringatan", () => {
    expect(must(parseSuryaGrid(gridOf(withPeriod("2026-11-03")), DAY_FILE)).warnings).toEqual([]);
  });
  it("berbeda → peringatan, tanggal tetap dari nama file", () => {
    const res = must(parseSuryaGrid(gridOf(withPeriod("2026-11-02")), DAY_FILE));
    expect(res.rows[0].date_trans).toBe("2026-11-03");
    expect(res.warnings.join(" ")).toContain("2026-11-02");
  });
});

describe("banyak file harian → satu hasil bulanan", () => {
  const day = (file: string, nett: number) => must(parseSuryaGrid(gridOf([...TITLE, HEADER, DASHES, item("100 Lodging (Room Revenue)", nett, nett / 10, nett / 10, (nett / 10) * 12), item("601 Swimming Pool", 1000, 0, 100, 1100)]), file));

  it("setiap file memakai tanggalnya sendiri; semua transaksi file valid digabung", () => {
    const merged = must(mergeSuryaSources([day("SURYA01112026.xls", 1000000), day("SURYA02112026.xls", 2000000), day("SURYA03112026.xls", 3000000)]));
    expect(merged.rows.length).toBe(6);
    expect(merged.dates).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(merged.rows.map((r) => `${r.date_trans}:${r.filename}`)).toEqual([
      "2026-11-01:SURYA01112026.xls", "2026-11-01:SURYA01112026.xls", "2026-11-02:SURYA02112026.xls", "2026-11-02:SURYA02112026.xls", "2026-11-03:SURYA03112026.xls", "2026-11-03:SURYA03112026.xls",
    ]);
    expect(merged.rows[0].no_struk).toBe("SURYA01112026-100 Lodging (Room Revenue)");
    expect(merged.rows[2].no_struk).toBe("SURYA02112026-100 Lodging (Room Revenue)");
    expect(merged.stats.files).toBe(3);
    expect(merged.stats.validRows).toBe(6);
    const by = summarizeSuryaByCategory(merged.rows);
    expect(by.HOTEL.count).toBe(3);
    expect(plain(by.HOTEL.subtotal)).toBe("6000000");
    expect(plain(by.KOLAM_RENANG.total)).toBe("3300");
    expect(findDuplicateSuryaNoStruk(merged.rows).size).toBe(0);
  });

  it("file gagal tidak ikut digabung; file valid tetap diproses", () => {
    const bad = parseSuryaGrid(gridOf(dayRows()), "salah.xls");
    const merged = must(mergeSuryaSources([day("SURYA01112026.xls", 1000000), bad, day("SURYA02112026.xls", 2000000)]));
    expect(merged.rows.length).toBe(4);
    expect(merged.stats.files).toBe(2);
  });

  it("semua file gagal → hasil gagal dengan pesan tiap file", () => {
    const merged = mergeSuryaSources([parseSuryaGrid(gridOf(dayRows()), "a.xls"), parseSuryaGrid(gridOf(dayRows()), "b.xls")]);
    expect(merged.ok).toBe(false);
    expect(merged.error).toContain("a.xls");
    expect(merged.error).toContain("b.xls");
  });

  it("satu file valid mengembalikan hasil file itu apa adanya", () => {
    const one = day("SURYA01112026.xls", 1000000);
    expect(mergeSuryaSources([one])).toBe(one);
  });

  it("tanggal yang sama pada dua file berbeda diberi peringatan, transaksi tidak dibuang diam-diam", () => {
    const merged = must(mergeSuryaSources([day("SURYA01112026.xls", 1000000), day("SURYA01112026 (1).xls", 1000000)]));
    expect(merged.rows.length).toBe(4);
    expect(merged.warnings.join(" ")).toContain("2026-11-01");
  });
});

describe("angka dan tampilan", () => {
  it("parseSuryaDecimal / formatSuryaMoney", () => {
    expect(suryaToPlain(parseSuryaDecimal("1234.5")!)).toBe("1234.5");
    expect(parseSuryaDecimal("abc")).toBeNull();
    expect(parseSuryaDecimal("")).toBeNull();
    expect(formatSuryaMoney(parseSuryaDecimal("1234.5")!)).toBe("Rp1.234,50");
    expect(formatSuryaMoney(parseSuryaDecimal("-7379500")!)).toBe("Rp-7.379.500,00");
    expect(formatSuryaMoney(0n)).toBe("Rp0,00");
  });
});

describe("workbook Excel (.xls / .xlsx)", () => {
  const book = (rows: Raw[][], bookType: "xlsx" | "xls" = "xlsx", sheetName = "Output File") => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows as unknown[][]), sheetName);
    return XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer;
  };

  it("file contoh asli SURYA03112026.xls: Hotel, Resto, Kolam Renang, Kebugaran dibaca dari satu file", () => {
    const res = must(parseSuryaTretesWorkbook(sampleBuffer(), "SURYA03112026.xls"));
    expect(res.dates).toEqual(["2026-11-03"]);
    expect(res.issues).toEqual([]);
    expect(res.stats.headerRows).toBe(2); // header di halaman 1 dan halaman 2
    expect(res.stats.hotelRows).toBe(3);
    expect(res.stats.restoRows).toBe(8);
    expect(res.stats.kolamRenangRows).toBe(0); // 601 Swimming Pool bernilai 0 pada tanggal ini
    expect(res.stats.kebugaranRows).toBe(0); // 501 Tennis dan 650 Sport & Recreation bernilai 0 pada tanggal ini
    expect(res.stats.validRows).toBe(11);
    expect(res.rows.every((r) => r.date_trans === "2026-11-03" && r.keterangan === "SURYA03112026" && r.filename === "SURYA03112026.xls")).toBe(true);
    // baris TOTAL / GRAND TOTAL / judul seksi tidak terbaca sebagai transaksi
    expect(res.rows.some((r) => /total/i.test(r.description.replace(/\s/g, "")))).toBe(false);
    expect(res.rows.some((r) => /^\d+ - /.test(r.description))).toBe(false);
    // item di luar keempat kategori tidak ikut
    expect(res.rows.some((r) => /Mineral Water|Shop|Commission/i.test(r.description))).toBe(false);
  });

  it("file contoh asli: jumlah per kategori sama dengan hitungan independen dari file sumber", () => {
    const res = must(parseSuryaTretesWorkbook(sampleBuffer(), "SURYA03112026.xls"));
    const by = summarizeSuryaByCategory(res.rows);
    const line = (c: SuryaCategory) => [by[c].count, ...[by[c].subtotal, by[c].service_charge, by[c].dpp, by[c].tax, by[c].total].map(plain)].join("|");
    expect(line("HOTEL")).toBe("3|6596797|659680|7256477|725648|7982125");
    expect(line("RESTO")).toBe("8|3335330|333533|3668863|366886|4035750");
    expect(line("KOLAM_RENANG")).toBe("0|0|0|0|0");
    expect(line("KEBUGARAN")).toBe("0|0|0|0|0");
    const all = summarizeSuryaRows(res.rows);
    expect([all.count, ...[all.subtotal, all.service_charge, all.dpp, all.tax, all.total].map(plain)].join("|")).toBe("11|9932127|993213|10925340|1092534|12017875");
    // selisih terhadap GRAND TOTAL Day-Gros 12.197.000 = item di luar kategori: Shop 10.000 + Mineral Water 30.000 + A/P Commission OTA 139.125
    expect(12197000 - Number(plain(all.total))).toBe(10000 + 30000 + 139125);
  });

  it("file contoh asli: baris Lodging dan diskon sesuai sumber", () => {
    const res = must(parseSuryaTretesWorkbook(sampleBuffer(), "SURYA03112026.xls"));
    const lodging = res.rows.find((r) => r.description.startsWith("100 Lodging"))!;
    expect([lodging.category, plain(lodging.subtotal), plain(lodging.service_charge), plain(lodging.dpp), plain(lodging.tax), plain(lodging.total)]).toEqual(["HOTEL", "6098760", "609876", "6708636", "670864", "7379500"]);
    expect(lodging.no_struk).toBe("SURYA03112026-100 Lodging (Room Revenue)");
    const disc = res.rows.find((r) => r.description.startsWith("911 Disc Food COFFEE SHOP"))!;
    expect([disc.category, plain(disc.subtotal), plain(disc.service_charge), plain(disc.tax), plain(disc.total)]).toEqual(["RESTO", "-157025", "-15702", "-17273", "-190000"]);
  });

  it("file yang sama dengan nama bertanggal lain: tanggal mengikuti nama file; perbedaan dengan Period di laporan diberi peringatan", () => {
    const res = must(parseSuryaTretesWorkbook(sampleBuffer(), "SURYA04112026.xls"));
    expect(res.dates).toEqual(["2026-11-04"]);
    expect(res.rows.every((r) => r.date_trans === "2026-11-04")).toBe(true);
    expect(res.warnings.join(" ")).toContain("2026-11-03");
  });

  it("nama file salah → gagal tanpa membaca isi", () => {
    const res = parseSuryaTretesWorkbook(sampleBuffer(), "laporan.xls");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("laporan.xls");
  });

  it("workbook sintetis .xlsx dan .xls menghasilkan hasil identik dengan grid yang sama", () => {
    const rows = dayRows();
    const fromGrid = must(parseSuryaGrid(gridOf(rows), DAY_FILE));
    // karakter kontrol printer tidak aman disimpan di BIFF; buang dulu pada sumber sintetis (parser membuangnya pula)
    // eslint-disable-next-line no-control-regex
    const clean = rows.map((r) => r.map((c) => (typeof c === "string" ? c.replace(/[\u0000-\u001f]/g, "") : typeof c === "object" ? null : c)));
    const sig = (s: SuryaSource) => s.rows.map((r) => `${r.category}|${r.no_struk}|${plain(r.dpp)}|${plain(r.tax)}|${plain(r.total)}`);
    expect(sig(must(parseSuryaTretesWorkbook(book(clean, "xlsx"), DAY_FILE)))).toEqual(sig(fromGrid));
    expect(sig(must(parseSuryaTretesWorkbook(book(clean, "xls"), DAY_FILE)))).toEqual(sig(fromGrid));
  });

  it("header hilang pada workbook → pesan menyebut header yang hilang", () => {
    const rows = dayRows();
    const hi = rows.findIndex((r) => r[0] === "Art Description");
    rows[hi] = rows[hi].map((c) => (c === "Day-Gros" ? null : c));
    const res = parseSuryaTretesWorkbook(book(rows), DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Day-Gros");
  });

  it("dua sheet yang sama-sama memuat header → ditolak karena ambigu", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, item("100 Lodging", 1, 0, 0, 1)] as unknown[][]), "A");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, item("100 Lodging", 2, 0, 0, 2)] as unknown[][]), "B");
    const res = parseSuryaTretesWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, DAY_FILE);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("2 sheet");
  });

  it("sheet lain tanpa header Art Description diabaikan", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Food", 1, 1, 1, 1]] as unknown[][]), "Catatan");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, item("100 Lodging", 1, 0, 0, 1)] as unknown[][]), "Output File");
    const res = must(parseSuryaTretesWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, DAY_FILE));
    expect(res.sheetName).toBe("Output File");
    expect(res.rows.length).toBe(1);
  });

  it("file yang bukan Excel → gagal dengan pesan jelas", () => {
    const res = parseSuryaTretesWorkbook(new TextEncoder().encode("bukan excel").buffer as ArrayBuffer, DAY_FILE);
    expect(res.ok).toBe(false);
  });
});
