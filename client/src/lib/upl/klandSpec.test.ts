import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseUplFile } from "./uplParser";
import {
  BUILT_IN_CATEGORY_CRITERIA,
  UNMAPPED_LABEL,
  categorizeAllRows,
  createBuiltInKategoriResult,
  detectTransactionKategoriColumns,
  summarizeByCategory,
  unmappedItemWarnings,
} from "./kategoriMapper";
import { parseCandCFile } from "./candcParser";
import { parseRestoFile } from "./restoParser";

function fileFromMatrix(name: string, matrix: unknown[][]): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), "TO 011026");
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], name);
}

// 12 nama item K FOOD sesuai aturan KLAND terbaru.
const KFOOD_ITEMS = [
  "Food OPPA KFOOD",
  "Beverage OPPA KFOOD",
  "Other OPPA KFOOD",
  "Disc Bev OPPA KFOOD",
  "Disc Food OPPA KFOOD",
  "RESTO PADI - C&C-FAR",
  "Food Resto Padi",
  "Beverage Resto padi",
  "FOOD ZONE",
  "MP OPPA K FOOD",
  "Disc Food Resto padi",
  "Disc Bev Resto padi",
];

const HEADER = ["Art", "Description", "Day-qty", "Day-Nett", "Service", "Tax", "Day-Gros"];

/** Laporan dengan semua item K FOOD + C&C. `order` mengubah urutan kolom: header tetap menentukan hasil. */
function report(order: number[] = [0, 1, 2, 3, 4, 5, 6]): unknown[][] {
  const pick = (cells: unknown[]) => order.map((i) => cells[i]);
  const rows: unknown[][] = [
    pick(HEADER),
    pick(["", "2 - KFOOD-HANBOK-CANTEEN", "", "", "", "", ""]),
    pick([10, "Food OPPA KFOOD", 2, 100000, 5000, 10500, 115500]),
    pick([11, "Beverage OPPA KFOOD", 1, 20000, 1000, 2100, 23100]),
    pick([30, "Other OPPA KFOOD", 1, 10000, 500, 1050, 11550]),
    pick([911, "Disc Food OPPA KFOOD", 1, -5000, -250, -525, -5775]),
    pick([912, "Disc Bev OPPA KFOOD", 1, -2000, -100, -210, -2310]),
    pick(["", "RESTO PADI - C&C-FAR", "", "", "", "", ""]), // judul bagian tanpa nomor Art dan tanpa angka
    pick([10, "Food Resto Padi", 6, 116883, 5844, 12273, 135000]),
    pick([11, "Beverage Resto padi", 0, 0, 0, 0, 0]),
    pick([19, "Food C & C", 1, 25974, 1299, 2727, 30000]),
    pick([21, "Beverage C & C", 1, 10390, 519, 1091, 12000]),
    pick([27, "FOOD ZONE", 1, 1000, 50, 105, 1155]),
    pick([31, "MP OPPA K FOOD", 1, 2000, 100, 210, 2310]),
    pick([911, "Disc Food Resto padi", 1, -1000, -50, -105, -1155]),
    pick([912, "Disc Bev Resto padi", 1, -500, -25, -52, -577]),
  ];
  return rows;
}

describe("mapping K FOOD terbaru", () => {
  const master = createBuiltInKategoriResult();
  const cols = detectTransactionKategoriColumns(["Art", "Description", "Day-qty", "Day-Nett", "Service", "Tax", "Day-Gros"]);
  const row = (description: string) => ({
    sourceRow: 2, sourceSheet: "S", no_struk: "", description, qtyRaw: "1", qty: 1,
    subtotalRaw: "1", subtotal: 1, taxRaw: "0", tax: 0, cells: ["", description],
  });

  it("daftar K FOOD persis 12 item, tanpa alias typo", () => {
    expect(BUILT_IN_CATEGORY_CRITERIA["K FOOD"]).toEqual(KFOOD_ITEMS);
  });

  it.each(KFOOD_ITEMS)("%s -> K FOOD", (item) => {
    expect(categorizeAllRows([row(item)], master, cols)[0].category).toBe("K FOOD");
  });

  it("alias typo 'Other OPPA KFOD' tidak dikenali dan menghasilkan warning jelas", () => {
    const cats = categorizeAllRows([row("Other OPPA KFOD")], master, cols);
    expect(cats[0].category).toBe(UNMAPPED_LABEL);
    expect(unmappedItemWarnings(cats)[0]).toContain('Item "Other OPPA KFOD" tidak ditemukan');
  });
});

describe("parser KLAND membaca header, bukan posisi", () => {
  it.each([
    ["urutan standar", [0, 1, 2, 3, 4, 5, 6]],
    ["urutan kolom berubah", [6, 5, 4, 3, 2, 1, 0]],
  ])("%s: C&C, K FOOD, dan ringkasan sama", async (_label, order) => {
    const file = fileFromMatrix("011026.xlsx", report(order));
    const parsed = await parseUplFile(file);
    const per = summarizeByCategory(categorizeAllRows(parsed.fullRows, createBuiltInKategoriResult(), detectTransactionKategoriColumns(parsed.workbook!.headerValues)));

    const candc = await parseCandCFile(file);
    expect(candc.records.map((r) => [r.keterangan, r.qty, r.subtotal, r.service_charge, r.dpp, r.tax, r.total])).toEqual([
      ["Food C & C", 1, 25974, 1299, 27273, 2727, 30000],
      ["Beverage C & C", 1, 10390, 519, 10909, 1091, 12000],
    ]);
    expect(per["C&C"]).toMatchObject({ count: 2, subtotalTotal: 42000, taxTotal: 3818 });

    const kfood = await parseRestoFile(file, "KFOOD");
    // urutan record mengikuti urutan baris file; judul "RESTO PADI - C&C-FAR" tidak menjadi record
    expect(kfood.records.map((r) => r.keterangan)).toEqual([
      "Food OPPA KFOOD", "Beverage OPPA KFOOD", "Other OPPA KFOOD", "Disc Food OPPA KFOOD", "Disc Bev OPPA KFOOD",
      "Food Resto Padi", "Beverage Resto padi", "FOOD ZONE", "MP OPPA K FOOD", "Disc Food Resto padi", "Disc Bev Resto padi",
    ]);
    expect(kfood.records.find((r) => r.keterangan === "Disc Bev OPPA KFOOD")).toMatchObject({ subtotal: -2000, discount: -2000, tax: -210, total: -2310 });
    expect(kfood.records.find((r) => r.keterangan === "Disc Food OPPA KFOOD")).toMatchObject({ subtotal: -5000, discount: -5000 });
    expect(per["K FOOD"].count).toBe(11);
    expect(kfood.warnings).toEqual([]);
  });

  it("judul bagian tanpa nomor transaksi bukan transaksi (parser utama, C&C, dan RESTO)", async () => {
    const file = fileFromMatrix("011026.xlsx", report());
    const parsed = await parseUplFile(file);
    expect(parsed.fullRows.some((r) => /RESTO PADI - C&C-FAR|KFOOD-HANBOK/i.test(r.description))).toBe(false);
    expect(parsed.stats?.skippedSectionRows).toBeGreaterThanOrEqual(2);
  });

  it("file tanpa header ditolak (tidak ada cadangan huruf kolom tetap)", async () => {
    const res = await parseCandCFile(fileFromMatrix("011026.xlsx", [["", "Food C & C", 1, 2, 3, 4, 5]]));
    expect(res.ok).toBe(false);
  });
});

describe("item tidak ditemukan", () => {
  it("K FOOD: warning per item yang tidak ada di file", async () => {
    const rows = report().filter((r) => !["FOOD ZONE", "Disc Bev OPPA KFOOD"].includes(String(r[1])));
    const res = await parseRestoFile(fileFromMatrix("011026.xlsx", rows), "KFOOD");
    expect(res.warnings).toEqual(['Item K FOOD "Disc Bev OPPA KFOOD" tidak ditemukan pada file ini.', 'Item K FOOD "FOOD ZONE" tidak ditemukan pada file ini.']);
  });

  it("C&C: warning jika item C&C tidak ada", async () => {
    const rows = report().filter((r) => r[1] !== "Beverage C & C");
    const res = await parseCandCFile(fileFromMatrix("011026.xlsx", rows));
    expect(res.warnings).toEqual(['Item C&C "Beverage C & C" tidak ditemukan pada file ini.']);
  });

  it("item yang tidak ada di aturan kategori -> Tidak Terpetakan + warning", async () => {
    const rows = [...report(), [99, "Item Baru Tidak Dikenal", 1, 100, 0, 10, 110]];
    const parsed = await parseUplFile(fileFromMatrix("011026.xlsx", rows));
    const cats = categorizeAllRows(parsed.fullRows, createBuiltInKategoriResult(), detectTransactionKategoriColumns(parsed.workbook!.headerValues));
    expect(unmappedItemWarnings(cats)).toHaveLength(1);
    expect(unmappedItemWarnings(cats)[0]).toContain("Item Baru Tidak Dikenal");
  });
});

describe("validasi konsistensi data (hanya identitas yang terverifikasi dari file nyata)", () => {
  it("Day-Nett + Service + Tax = Day-Gros per baris; selisih menghasilkan warning", async () => {
    const rows = [HEADER, [10, "Food OPPA KFOOD", 1, 1000, 100, 110, 9999]];
    const parsed = await parseUplFile(fileFromMatrix("011026.xlsx", rows));
    expect(parsed.warnings.some((w) => /Day-Nett \+ Service \+ Tax tidak sama dengan Day-Gros/.test(w))).toBe(true);
  });
});
