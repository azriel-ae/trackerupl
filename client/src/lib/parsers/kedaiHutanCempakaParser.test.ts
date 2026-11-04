import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertDate, parseKedaiHutanCempakaCsv, parseKedaiHutanCempakaFiles, parseSourceNumber } from "./kedaiHutanCempakaParser";

// Fixture asli: laporan penjualan rekap 30/09/2026 (6 transaksi).
const FIXTURE = readFileSync(fileURLToPath(new URL("../fixtures/kedaiHutanCempaka30092026.csv", import.meta.url)), "utf8");

const EXPECTED = { count: 6, subtotal: 438500, discount: 0, service_charge: 0, dpp: 438500, tax: 48235, total: 486735 };

const parse = (text: string) => parseKedaiHutanCempakaCsv(text, "t.csv");
const toCsv = (table: string[][]) => Papa.unparse(table, { newline: "\n" });

// Mengacak urutan kolom di SEMUA baris (judul, header, transaksi, rekap, footer) dengan permutasi yang sama.
const permute = (text: string, order: number[]) => {
  const table = Papa.parse<string[]>(text, { skipEmptyLines: false }).data;
  return toCsv(table.map((cells) => {
    const full = [...cells, ...Array(Math.max(0, order.length - cells.length)).fill("")];
    return order.map((i) => full[i]);
  }));
};

const HEADERS = ["No Transaksi", "Tanggal", "Kode Pel.", "Sub Total", "Pot.", "Pajak", "Total Akhir"];
const mini = (rows: string[][], header = HEADERS) => toCsv([["Toko"], [""], header, ...rows]);
const trx = (o: Partial<Record<string, string>> = {}) => {
  const v = { no: "K1", date: "30/09/2026", cust: "UMUM", sub: "1,000.00", pot: "0.00", tax: "110.00", total: "1,110.00", ...o };
  return [v.no, v.date, v.cust, v.sub, v.pot, v.tax, v.total];
};

describe("parseSourceNumber", () => {
  it("angka en-US dengan pemisah ribuan dan desimal", () => {
    expect(parseSourceNumber("32,000.00")).toBe(32000);
    expect(parseSourceNumber("1,234,567.89")).toBe(1234567.89);
    expect(parseSourceNumber("0.00")).toBe(0);
    expect(parseSourceNumber("48235")).toBe(48235);
    expect(parseSourceNumber("-500.50")).toBe(-500.5);
    expect(parseSourceNumber("  3,520.00 ")).toBe(3520);
  });
  it("nilai desimal selain .00 tetap aman (bukan sekadar REPLACE)", () => {
    expect(parseSourceNumber("1,000.50")).toBe(1000.5);
    expect(parseSourceNumber("12.345")).toBe(12.345);
    expect(parseSourceNumber("100.05")).toBe(100.05);
  });
  it("kosong atau format tidak dikenali → null (tidak dianggap nol, tidak ditebak)", () => {
    expect(parseSourceNumber("")).toBeNull();
    expect(parseSourceNumber(undefined)).toBeNull();
    expect(parseSourceNumber("abc")).toBeNull();
    expect(parseSourceNumber("1,5")).toBeNull();
    expect(parseSourceNumber("32.000,00")).toBeNull();
    expect(parseSourceNumber("1,00,000.00")).toBeNull();
  });
});

describe("convertDate", () => {
  it("DD/MM/YYYY → YYYY-MM-DD", () => {
    expect(convertDate("30/09/2026")).toBe("2026-09-30");
    expect(convertDate("1/2/2026")).toBe("2026-02-01");
  });
  it("menolak tanggal tidak valid", () => {
    expect(convertDate("31/02/2026")).toBeNull();
    expect(convertDate("30/13/2026")).toBeNull();
    expect(convertDate("2026-09-30")).toBeNull();
    expect(convertDate("30/09/2026 20:33")).toBeNull();
    expect(convertDate("")).toBeNull();
  });
});

describe("file contoh asli 30/09/2026", () => {
  const r = parse(FIXTURE);
  it("6 transaksi, total sama dengan laporan", () => {
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(EXPECTED.count);
    const sum = (k: "subtotal" | "discount" | "service_charge" | "dpp" | "tax" | "total") => r.rows.reduce((a, x) => a + x[k], 0);
    expect(sum("subtotal")).toBe(EXPECTED.subtotal);
    expect(sum("discount")).toBe(EXPECTED.discount);
    expect(sum("service_charge")).toBe(EXPECTED.service_charge);
    expect(sum("dpp")).toBe(EXPECTED.dpp);
    expect(sum("tax")).toBe(EXPECTED.tax);
    expect(sum("total")).toBe(EXPECTED.total);
  });
  it("pemetaan field per baris", () => {
    expect(r.rows[0]).toMatchObject({ no_struk: "KSR09260328", date_trans: "2026-09-30", keterangan: "UMUM", subtotal: 32000, discount: 0, service_charge: 0, dpp: 32000, tax: 3520, total: 35520 });
    expect(r.rows[3]).toMatchObject({ no_struk: "KSR09260331", subtotal: 194500, tax: 21395, total: 215895 });
  });
  it("baris rekap, footer, dan baris kosong tidak dibaca sebagai transaksi; tidak ada baris bermasalah", () => {
    expect(r.invalidRows).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.summaryRowsSkipped).toBeGreaterThan(0);
    expect(r.rows.every((x) => /^KSR\d+$/.test(x.no_struk) && x.issues.length === 0)).toBe(true);
  });
  it("total tetap dari Total Akhir sumber dan jumlah sama dengan baris rekap file", () => {
    expect(r.rows.map((x) => x.total)).toEqual([35520, 59940, 72150, 215895, 36630, 66600]);
  });
});

describe("ketahanan terhadap pergeseran kolom", () => {
  const baseline = parse(FIXTURE).rows.map(({ sourceRow, ...rest }) => rest);
  const strip = (text: string) => parse(text).rows.map(({ sourceRow, ...rest }) => rest);

  it("No Transaksi pindah dari kolom A ke D (kolom lain ikut bergeser)", () => {
    // urutan baru: kolom 1,2,3 dulu, lalu No Transaksi di posisi ke-4 (indeks 3)
    const text = permute(FIXTURE, [1, 2, 3, 0, 4, 5, 6, 7, 8, 9, 10]);
    expect(Papa.parse<string[]>(text).data[7][3].trim()).toBe("No Transaksi");
    expect(strip(text)).toEqual(baseline);
  });
  it("urutan dibalik", () => {
    expect(strip(permute(FIXTURE, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]))).toEqual(baseline);
  });
  it("seluruh kolom diacak (banyak permutasi acak deterministik) → hasil identik", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 60; n++) {
      const order = [...Array(11).keys()];
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const r = parse(permute(FIXTURE, order));
      expect(r.ok, `urutan ${order}`).toBe(true);
      expect(r.invalidRows, `urutan ${order}`).toBe(0);
      expect(r.rows.map(({ sourceRow, ...rest }) => rest), `urutan ${order}`).toEqual(baseline);
    }
  });
  it("kolom yang tidak dipakai boleh hilang / ada kolom tambahan", () => {
    const table = Papa.parse<string[]>(FIXTURE, { skipEmptyLines: false }).data.map((c) => c.slice(0, 7)); // tanpa kolom Bayar*
    expect(strip(toCsv(table))).toEqual(baseline);
    const wider = Papa.parse<string[]>(FIXTURE, { skipEmptyLines: false }).data.map((c, i) => ["X", ...c, i === 7 ? "Kolom Baru" : "z"]);
    expect(strip(toCsv(wider))).toEqual(baseline);
  });
  it("posisi baris header tidak tetap (tambah/kurangi baris di atas header)", () => {
    expect(strip("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n" + FIXTURE)).toEqual(baseline);
    expect(strip(FIXTURE.split("\n").slice(7).join("\n"))).toEqual(baseline); // header di baris pertama
  });
  it("header dinormalkan: kapitalisasi dan spasi awal/akhir/ganda diabaikan (contoh 'Pot. ')", () => {
    expect(strip(FIXTURE.replace("No Transaksi,Tanggal,Kode Pel.,Sub Total,Pot. ,Pajak,Total Akhir", "  NO TRANSAKSI ,tanggal,KODE  PEL.,sub total,POT.   ,pajak , Total  Akhir"))).toEqual(baseline);
    expect(parse(FIXTURE).ok).toBe(true); // file asli memang memakai "Pot. "
  });
});

describe("header wajib hilang", () => {
  it.each(HEADERS)("tanpa '%s' → ditolak dengan pesan yang menyebut header tersebut", (name) => {
    const header = HEADERS.map((h) => (h === name ? "Lain" : h));
    const r = parse(mini([trx()], header));
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.error).toContain(`"${name}"`);
  });
  it("tidak ada fallback ke posisi kolom: nilai tidak dibaca dari kolom lain dan tidak dianggap nol", () => {
    const r = parse(mini([trx()], ["No Transaksi", "Tanggal", "Kode Pel.", "Sub Total", "Potongan", "Pajak", "Total Akhir"]));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"Pot."');
  });
  it("beberapa header hilang disebut semuanya dalam satu pesan", () => {
    const r = parse(mini([trx()], ["No Transaksi", "Tanggal", "Kode Pel.", "Sub Total", "x", "y", "Total Akhir"]));
    expect(r.error).toContain('"Pot."');
    expect(r.error).toContain('"Pajak"');
  });
  it("tidak ada header sama sekali → pesan menyebut semua header wajib", () => {
    const r = parse("a,b,c\n1,2,3\n");
    expect(r.ok).toBe(false);
    HEADERS.forEach((h) => expect(r.error).toContain(`"${h}"`));
  });
  it("header ganda ditolak sebagai ambigu", () => {
    const r = parse(mini([[...trx(), "x"]], [...HEADERS, "Pajak"]));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"Pajak"');
  });
  it("CSV kosong ditolak", () => {
    expect(parse("").ok).toBe(false);
    expect(parse(",,\n,,\n").ok).toBe(false);
  });
});

describe("perhitungan dan validasi", () => {
  it("DPP = Sub Total - Pot.; service 0; total dan pajak diambil dari sumber (tidak dihitung ulang)", () => {
    const [row] = parse(mini([trx({ sub: "100,000.00", pot: "10,000.50", tax: "9,900.00", total: "99,899.50" })])).rows;
    expect(row).toMatchObject({ subtotal: 100000, discount: 10000.5, service_charge: 0, dpp: 89999.5, tax: 9900, total: 99899.5 });
  });
  it("Total Akhir sumber dipertahankan walau tidak cocok, dengan catatan 'perlu diperiksa'", () => {
    const [row] = parse(mini([trx({ total: "1,500.00" })])).rows;
    expect(row.total).toBe(1500);
    expect(row.issues.join(" ")).toContain("Total Akhir");
  });
  it("selisih pembulatan 1 rupiah tidak diberi catatan", () => {
    expect(parse(mini([trx({ total: "1,110.50" })])).rows[0].issues).toEqual([]);
  });
  it("nilai desimal tidak terpotong", () => {
    const [row] = parse(mini([trx({ sub: "1,000.55", tax: "110.06", total: "1,110.61" })])).rows;
    expect(row.subtotal).toBe(1000.55);
    expect(row.tax).toBe(110.06);
    expect(row.total).toBe(1110.61);
    expect(row.issues).toEqual([]);
  });
  it("tanggal DD/MM/YYYY menjadi YYYY-MM-DD", () => {
    expect(parse(mini([trx({ date: "05/10/2026" })])).rows[0].date_trans).toBe("2026-10-05");
  });
});

describe("baris tidak valid dan baris bukan transaksi", () => {
  it("angka kosong / tidak valid → baris ditandai tidak valid, menyebut nama header, tidak dihitung", () => {
    const r = parse(mini([trx(), trx({ no: "K2", tax: "" }), trx({ no: "K3", total: "abc" })]));
    expect(r.rows.map((x) => x.no_struk)).toEqual(["K1"]);
    expect(r.invalidRows).toBe(2);
    expect(r.issues[0].message).toContain("Pajak");
    expect(r.issues[1].message).toContain("Total Akhir");
  });
  it("tanggal tidak valid pada baris transaksi ditandai, bukan diam-diam hilang", () => {
    const r = parse(mini([trx({ date: "31/02/2026" }), trx({ no: "K2", date: "" })]));
    expect(r.rows).toHaveLength(0);
    expect(r.invalidRows).toBe(2);
  });
  it("baris footer dengan timestamp dan nama kasir dilewati", () => {
    const r = parse(mini([trx(), ["30/09/2026 20:33", "kasir", "", "", "", "", "1/1"]]));
    expect(r.rows).toHaveLength(1);
    expect(r.invalidRows).toBe(0);
  });
  it("baris rekap dilewati walau jatuh di bawah kolom No Transaksi", () => {
    const r = parse(mini([trx(), ["TOTAL KESELURUHAN :", "Sub Total :", "", "1,000.00", "", "", ""], ["Pajak :", "", "", "", "", "110.00", ""]]));
    expect(r.rows).toHaveLength(1);
    expect(r.invalidRows).toBe(0);
  });
  it("header yang diulang di tengah data dilewati", () => {
    const r = parse(mini([trx(), HEADERS, trx({ no: "K2" })]));
    expect(r.rows.map((x) => x.no_struk)).toEqual(["K1", "K2"]);
    expect(r.invalidRows).toBe(0);
  });
  it("baris yang lebih pendek dari posisi header ditandai (nilai tidak bergeser)", () => {
    const r = parse(mini([["K1", "30/09/2026", "UMUM", "1,000.00"]]));
    expect(r.rows).toHaveLength(0);
    expect(r.invalidRows).toBe(1);
  });
  it("CRLF dan BOM didukung", () => {
    const r = parse("﻿" + FIXTURE.replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(6);
  });
});

describe("parseKedaiHutanCempakaFiles (harian & bulanan)", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("satu file harian: total sesuai harapan", async () => {
    const r = await parseKedaiHutanCempakaFiles([{ name: "30092026.csv", data: bytes(FIXTURE) }]);
    expect(r.ok).toBe(true);
    expect(r.summary).toEqual({ files: 1, ...EXPECTED });
    expect(r.duplicateReceipts).toBe(0);
  });
  it("urutan kolom diubah → ringkasan tetap sama", async () => {
    const r = await parseKedaiHutanCempakaFiles([{ name: "a.csv", data: bytes(permute(FIXTURE, [3, 0, 7, 1, 10, 2, 5, 9, 4, 8, 6])) }]);
    expect(r.summary).toEqual({ files: 1, ...EXPECTED });
  });
  it("bulanan: banyak file digabung; isi identik hanya dihitung sekali", async () => {
    const other = mini([trx({ no: "Z1", date: "01/10/2026" })]);
    const r = await parseKedaiHutanCempakaFiles([
      { name: "30092026.csv", data: bytes(FIXTURE) },
      { name: "30092026 (1).csv", data: bytes(FIXTURE) },
      { name: "01102026.csv", data: bytes(other) },
    ]);
    expect(r.ok).toBe(true);
    expect(r.files.filter((f) => f.status === "duplicate")).toHaveLength(1);
    expect(r.summary.count).toBe(7);
    expect(r.summary.files).toBe(2);
    expect(r.summary.total).toBe(EXPECTED.total + 1110);
  });
  it("no struk yang sama di file berbeda ditandai, datanya tidak dihapus", async () => {
    const a = mini([trx({ no: "D1" })]);
    const b = mini([trx({ no: "D1", sub: "2,000.00", tax: "220.00", total: "2,220.00" })]);
    const r = await parseKedaiHutanCempakaFiles([{ name: "a.csv", data: bytes(a) }, { name: "b.csv", data: bytes(b) }]);
    expect(r.summary.count).toBe(2);
    expect(r.duplicateReceipts).toBe(1);
    expect(r.rows.every((x) => x.issues.some((m) => m.includes("duplikat")))).toBe(true);
  });
  it("transaksi identik di file berbeda (laporan tumpang tindih) hanya dihitung sekali", async () => {
    const a = mini([trx({ no: "O1" }), trx({ no: "O2", sub: "2,000.00", tax: "220.00", total: "2,220.00" })]);
    const b = mini([trx({ no: "O2", sub: "2,000.00", tax: "220.00", total: "2,220.00" }), trx({ no: "O3", sub: "3,000.00", tax: "330.00", total: "3,330.00" })]);
    const r = await parseKedaiHutanCempakaFiles([{ name: "a.csv", data: bytes(a) }, { name: "b.csv", data: bytes(b) }]);
    expect(r.summary.count).toBe(3);
    expect(r.duplicateRowsRemoved).toBe(1);
    expect(r.duplicateReceipts).toBe(0);
    expect(r.summary.total).toBe(1110 + 2220 + 3330);
    expect(r.summary.subtotal).toBe(1000 + 2000 + 3000);
  });
  it("no struk sama tetapi tanggal / kode pelanggan berbeda tidak dibuang", async () => {
    const a = mini([trx({ no: "S1" })]);
    const b = mini([trx({ no: "S1", date: "01/10/2026" })]);
    const c = mini([trx({ no: "S1", cust: "ANDI" })]);
    const r = await parseKedaiHutanCempakaFiles([{ name: "a.csv", data: bytes(a) }, { name: "b.csv", data: bytes(b) }, { name: "c.csv", data: bytes(c) }]);
    expect(r.summary.count).toBe(3);
    expect(r.duplicateRowsRemoved).toBe(0);
    expect(r.duplicateReceipts).toBe(1);
  });
  it("baris identik di DALAM satu file tidak dibuang (perilaku satu file tidak berubah)", async () => {
    const r = await parseKedaiHutanCempakaFiles([{ name: "a.csv", data: bytes(mini([trx(), trx()])) }]);
    expect(r.summary.count).toBe(2);
    expect(r.duplicateRowsRemoved).toBe(0);
  });
  it("tanggal dari header Tanggal, bukan nama file; akumulasi dari banyak file dengan kolom berbeda urutan", async () => {
    const f1 = mini([trx({ no: "M1", date: "02/10/2026" })]);
    const f2 = toCsv([["Toko"], ["Total Akhir", "Pajak", "Tanggal", "No Transaksi", "Pot.", "Sub Total", "Kode Pel."], ["2,220.00", "220.00", "15/10/2026", "M2", "0.00", "2,000.00", "UMUM"]]);
    const r = await parseKedaiHutanCempakaFiles([{ name: "30092026.csv", data: bytes(f1) }, { name: "xx.csv", data: bytes(f2) }]);
    expect(r.rows.map((x) => x.date_trans).sort()).toEqual(["2026-10-02", "2026-10-15"]);
    expect(r.summary).toMatchObject({ files: 2, count: 2, subtotal: 3000, discount: 0, dpp: 3000, tax: 330, total: 3330 });
    expect(r.filesFailed).toBe(0);
  });
  it("menghitung file berhasil dan gagal; file header salah menyebut nama header", async () => {
    const r = await parseKedaiHutanCempakaFiles([{ name: "a.csv", data: bytes(FIXTURE) }, { name: "b.csv", data: bytes(mini([trx()], ["No Transaksi", "Tanggal", "Kode Pel.", "Sub Total", "Potongan", "Pajak", "Total Akhir"])) }]);
    expect(r.summary.files).toBe(1);
    expect(r.filesFailed).toBe(1);
    expect(r.files.find((f) => f.filename === "b.csv")?.message).toContain('"Pot."');
    expect(r.summary.count).toBe(6);
  });
  it("file gagal tidak menyumbang transaksi; file lain tetap diproses", async () => {
    const r = await parseKedaiHutanCempakaFiles([{ name: "ok.csv", data: bytes(FIXTURE) }, { name: "rusak.csv", data: bytes("a,b\n1,2\n") }, { name: "x.xlsx", data: bytes("zzz") }]);
    expect(r.ok).toBe(true);
    expect(r.summary.count).toBe(6);
    expect(r.files.filter((f) => f.status === "failed")).toHaveLength(2);
  });
  it("semua file gagal → hasil gagal dengan pesan header", async () => {
    const r = await parseKedaiHutanCempakaFiles([{ name: "rusak.csv", data: bytes("a,b\n1,2\n") }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"No Transaksi"');
  });
});
