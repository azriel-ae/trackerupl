import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import Papa from "papaparse";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertDateTime, parseOmahPadhangCsv, parseOmahPadhangZip, parseOmahPadhangZips } from "./omahPadhangParser";

// Fixture sintetis hanya untuk menguji parser (bukan data hasil aplikasi).
const HEADER = "Outlet,Date,Time,Gross Sales,Discounts,Refunds,Net Sales,Gratuity,Tax,Total Collected,Total Amount,Other Note (Optional),Receipt Number,Collected By,Served By,Customer,Customer Phone,Items,Payment Method,Event Type,Reason of Refund";
const line = (o: Partial<Record<string, string>> = {}) => {
  const v = { outlet: "Outlet 1", date: "05-02-2030", time: "08:09:10", gross: "1000.0", disc: "100.0", ref: "0.0", net: "900.0", grat: "45.0", tax: "94.5", coll: "1039.5", total: "1039.5", note: "", rcpt: "T1", by: "S", served: "", cust: "", phone: "", items: '"A, B, C"', pay: "Cash", event: "Payment", reason: "", ...o };
  return [v.outlet, v.date, v.time, v.gross, v.disc, v.ref, v.net, v.grat, v.tax, v.coll, v.total, v.note, v.rcpt, v.by, v.served, v.cust, v.phone, v.items, v.pay, v.event, v.reason].join(",");
};
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");
const zipOf = async (files: Record<string, string>) => {
  const zip = new JSZip();
  Object.entries(files).forEach(([name, content]) => zip.file(name, content));
  return zip.generateAsync({ type: "uint8array" });
};

describe("convertDateTime", () => {
  it("DD-MM-YYYY HH:mm:ss → YYYY-MM-DD HH:mm:ss", () => {
    expect(convertDateTime("05-02-2030", "08:09:10")).toBe("2030-02-05 08:09:10");
  });
  it("menolak tanggal/waktu tidak valid", () => {
    expect(convertDateTime("31-02-2030", "08:09:10")).toBeNull();
    expect(convertDateTime("05-02-2030", "25:00:00")).toBeNull();
    expect(convertDateTime("", "08:09:10")).toBeNull();
  });
});

describe("parseOmahPadhangCsv", () => {
  it("koma di dalam field Items ber-quote tidak menggeser kolom", () => {
    const r = parseOmahPadhangCsv(csv(line()), "a.csv");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].keterangan).toBe("A, B, C");
    expect(r.rows[0].eventType).toBe("Payment");
  });
  it("memetakan field & rumus: subtotal = Gross Sales, dpp = subtotal - discount + service, total = Total Amount", () => {
    const [row] = parseOmahPadhangCsv(csv(line()), "a.csv").rows;
    expect(row).toMatchObject({ id_agent: "omahpadhang_kabpas", no_struk: "T1", date_trans: "2030-02-05 08:09:10", subtotal: 1000, service_charge: 45, discount: 100, dpp: 945, tax: 94.5, total: 1039.5, refunds: 0, net_sales: 900, total_collected: 1039.5 });
    expect(row.issues).toEqual([]);
  });
  it("Net Sales bukan DPP: DPP dari Gross - Discounts + Gratuity, pajak 10% dari DPP", () => {
    const [row] = parseOmahPadhangCsv(csv(line()), "a.csv").rows;
    expect(row.dpp).not.toBe(row.net_sales);
    expect(row.dpp).toBe(row.net_sales + row.service_charge);
    expect(row.tax).toBeCloseTo(row.dpp * 0.1, 6);
  });
  it("pemetaan memakai header, bukan posisi kolom", () => {
    const cols = HEADER.split(",");
    // item ber-quote: gabungkan ulang saat membalik urutan
    const rec = line({ items: "X" }).split(",");
    const rev = [...cols].reverse().join(",");
    const text = `${rev}\n${[...rec].reverse().join(",")}`;
    const r = parseOmahPadhangCsv(text, "rev.csv");
    expect(rec.length).toBe(cols.length);
    expect(r.rows[0]).toMatchObject({ no_struk: "T1", subtotal: 1000, discount: 100, refunds: 0, tax: 94.5, total: 1039.5, keterangan: "X" });
    expect(r.rows[0].issues).toEqual([]);
  });
  it("mempertahankan desimal, tidak membulatkan", () => {
    const [row] = parseOmahPadhangCsv(csv(line({ gross: "100.35", disc: "0.1", net: "100.25", grat: "0.2", tax: "10.045", coll: "110.495", total: "110.495" })), "a.csv").rows;
    expect(row.dpp).toBeCloseTo(100.45, 6);
    expect(row.subtotal).toBe(100.35);
    expect(row.net_sales).toBe(100.25);
  });
  it("header wajib hilang → error, tidak menebak", () => {
    const bad = csv(line()).replace("Net Sales", "Netto");
    const r = parseOmahPadhangCsv(bad, "a.csv");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Header wajib tidak ditemukan/);
    expect(r.error).toMatch(/"Net Sales"/);
    expect(r.rows).toHaveLength(0);
  });
  it.each(["Receipt Number", "Date", "Time", "Gross Sales", "Discounts", "Refunds", "Net Sales", "Gratuity", "Tax", "Total Collected", "Total Amount", "Items"])("header wajib %s hilang → pesan jelas, kolom lain tidak dipakai sebagai pengganti", (name) => {
    const text = csv(line()).replace(new RegExp(`(^|,)${name}(,|\\n)`), "$1Kolom Lain$2");
    const r = parseOmahPadhangCsv(text, "a.csv");
    expect(r.ok).toBe(false);
    expect(r.error).toContain(`"${name}"`);
    expect(r.rows).toHaveLength(0);
  });
  it("beberapa header hilang → semua disebut dalam satu pesan", () => {
    const r = parseOmahPadhangCsv(csv(line()).replace("Gross Sales", "X1").replace("Refunds", "X2"), "a.csv");
    expect(r.error).toContain('"Gross Sales"');
    expect(r.error).toContain('"Refunds"');
  });
  it("nama header tidak peka huruf besar/kecil dan spasi ganda", () => {
    const r = parseOmahPadhangCsv(csv(line()).replace("Gross Sales", "  gross   SALES "), "a.csv");
    expect(r.ok).toBe(true);
    expect(r.rows[0].subtotal).toBe(1000);
  });
  it("Refunds kosong → baris invalid, tidak dianggap nol", () => {
    const r = parseOmahPadhangCsv(csv(line({ ref: "" })), "a.csv");
    expect(r.rows).toHaveLength(0);
    expect(r.invalidRows).toBe(1);
    expect(r.issues[0].message).toMatch(/Refunds/);
  });
  it("validasi Net Sales = Gross - Discounts - Refunds", () => {
    const ok = parseOmahPadhangCsv(csv(line({ gross: "1000.0", disc: "100.0", ref: "50.0", net: "850.0", grat: "0.0", tax: "0.0", coll: "850.0", total: "850.0" })), "a.csv").rows[0];
    expect(ok.issues).toEqual([]);
    const bad = parseOmahPadhangCsv(csv(line({ net: "950.0" })), "a.csv").rows[0];
    expect(bad.issues.join()).toMatch(/Net Sales/);
    expect(bad.net_sales).toBe(950); // nilai sumber tidak diubah
  });
  it("validasi Total Collected = Net + Gratuity + Tax dengan toleransi pembulatan Rp100", () => {
    const rounded = parseOmahPadhangCsv(csv(line({ gross: "69000.0", disc: "0.0", net: "69000.0", grat: "3450.0", tax: "7245.0", coll: "79700.0", total: "79700.0" })), "a.csv").rows[0];
    expect(rounded.issues).toEqual([]); // 79695 → 79700
    const off = parseOmahPadhangCsv(csv(line({ gross: "69000.0", disc: "0.0", net: "69000.0", grat: "3450.0", tax: "7245.0", coll: "79900.0", total: "79900.0" })), "a.csv").rows[0];
    expect(off.issues.join()).toMatch(/Total Collected/);
    expect(off.total).toBe(79900);
  });
  it("header ambigu → error", () => {
    const r = parseOmahPadhangCsv(csv(line()).replace("Gratuity", "Tax"), "a.csv");
    expect(r.ok).toBe(false);
  });
  it("baris kosong & baris Grand Total dilewati; baris kolom tidak pas ditandai invalid", () => {
    const text = csv(line(), "", "Grand Total,,,1,1,1,1,1,1,1,1,,,,,,,,,,", line({ rcpt: "T2" }), "Outlet 1,05-02-2030,08:00:00,1,1");
    const r = parseOmahPadhangCsv(text, "a.csv");
    expect(r.rows.map((x) => x.no_struk)).toEqual(["T1", "T2"]);
    expect(r.summaryRowsSkipped).toBe(1);
    expect(r.invalidRows).toBe(1);
  });
  it("angka kosong/tidak valid → baris invalid, bukan angka buatan", () => {
    const r = parseOmahPadhangCsv(csv(line({ tax: "" }), line({ net: "abc" })), "a.csv");
    expect(r.rows).toHaveLength(0);
    expect(r.invalidRows).toBe(2);
  });
  it("no struk kosong ditandai, tidak dibuatkan pengganti", () => {
    const [row] = parseOmahPadhangCsv(csv(line({ rcpt: "" })), "a.csv").rows;
    expect(row.no_struk).toBe("");
    expect(row.issues.join()).toMatch(/kosong/);
  });
  it("BOM dan CRLF ditangani", () => {
    const r = parseOmahPadhangCsv("﻿" + csv(line(), line({ rcpt: "T2" })).replace(/\n/g, "\r\n"), "a.csv");
    expect(r.rows).toHaveLength(2);
  });
});

describe("parseOmahPadhangZip", () => {
  it("mengekstrak ZIP, menggabungkan banyak CSV, ringkasan dari seluruh data", async () => {
    const bytes = await zipOf({ "x/a.csv": csv(line(), line({ rcpt: "T2" })), "x/b.csv": csv(line({ rcpt: "T3", gross: "100.0", net: "100.0", disc: "0.0", grat: "5.0", tax: "10.5", coll: "115.5", total: "115.5" })), "readme.txt": "bukan csv" });
    const r = await parseOmahPadhangZip(bytes, "t.zip");
    expect(r.ok).toBe(true);
    expect(r.csvFound).toBe(2);
    expect(r.rows).toHaveLength(3);
    expect(r.summary).toMatchObject({ files: 2, count: 3, subtotal: 2100, service_charge: 95, discount: 200, dpp: 1995, tax: 199.5, total: 2194.5 });
  });
  it("CSV berisi sama yang muncul dua kali tidak digandakan", async () => {
    const same = csv(line());
    const r = await parseOmahPadhangZip(await zipOf({ "a.csv": same, "copy/b.csv": same }), "t.zip");
    expect(r.rows).toHaveLength(1);
    expect(r.files.filter((f) => f.status === "duplicate")).toHaveLength(1);
  });
  it("no struk duplikat antar-file tidak dihapus, hanya ditandai", async () => {
    const r = await parseOmahPadhangZip(await zipOf({ "a.csv": csv(line()), "b.csv": csv(line({ gross: "1.0", net: "1.0", disc: "0.0", grat: "0.0", tax: "0.0", coll: "1.0", total: "1.0" })) }), "t.zip");
    expect(r.rows).toHaveLength(2);
    expect(r.duplicateReceipts).toBe(1);
    expect(r.rows[0].issues.join()).toMatch(/duplikat/);
  });
  it("ZIP rusak → error jelas", async () => {
    const r = await parseOmahPadhangZip(new Uint8Array([1, 2, 3, 4]), "rusak.zip");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rusak/);
    expect(r.rows).toHaveLength(0);
  });
  it("ZIP tanpa CSV → error jelas", async () => {
    const r = await parseOmahPadhangZip(await zipOf({ "a.txt": "x" }), "t.zip");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tidak berisi file CSV/);
  });
  it("CSV dengan header salah → error, tanpa transaksi", async () => {
    const r = await parseOmahPadhangZip(await zipOf({ "a.csv": "foo,bar\n1,2" }), "t.zip");
    expect(r.ok).toBe(false);
    expect(r.rows).toHaveLength(0);
  });
  it("menolak file non-zip (CSV langsung)", async () => {
    const r = await parseOmahPadhangZip(new TextEncoder().encode(csv(line())), "a.csv");
    expect(r.ok).toBe(false);
  });
});

describe("parseOmahPadhangZips (banyak ZIP)", () => {
  it("satu ZIP = hasil identik dengan parseOmahPadhangZip", async () => {
    const data = await zipOf({ "a.csv": csv(line({ rcpt: "T1" })) });
    const single = await parseOmahPadhangZip(data, "x.zip");
    const multi = await parseOmahPadhangZips([{ data, name: "x.zip" }]);
    expect(multi.result).toEqual(single);
    expect(multi.zips).toMatchObject([{ zipName: "x.zip", status: "processed", transactions: 1 }]);
  });

  it("beberapa ZIP harian digabung menjadi satu dataset; ringkasan dari seluruh baris", async () => {
    const z1 = await zipOf({ "d1.csv": csv(line({ rcpt: "A1", date: "01-09-2030" }), line({ rcpt: "A2", date: "01-09-2030" })) });
    const z2 = await zipOf({ "d2.csv": csv(line({ rcpt: "B1", date: "02-09-2030" })) });
    const z3 = await zipOf({ "d3.csv": csv(line({ rcpt: "C1", date: "03-09-2030" })) });
    const { result, zips } = await parseOmahPadhangZips([{ data: z1, name: "01.zip" }, { data: z2, name: "02.zip" }, { data: z3, name: "03.zip" }]);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(4);
    expect(result.summary.count).toBe(4);
    expect(result.summary.files).toBe(3);
    expect(result.summary.total).toBeCloseTo(4 * 1039.5, 6);
    expect(zips.map((z) => z.status)).toEqual(["processed", "processed", "processed"]);
    expect(result.rows[0].filename).toBe("01.zip › d1.csv"); // asal baris tetap bisa ditelusuri
  });

  it("ZIP yang sama dipilih dua kali dengan isi sama tidak menggandakan transaksi", async () => {
    const a = await zipOf({ "d1.csv": csv(line({ rcpt: "A1" })) });
    const b = await zipOf({ "copy-of-d1.csv": csv(line({ rcpt: "A1" })) });
    const c = await zipOf({ "d2.csv": csv(line({ rcpt: "B1", date: "02-09-2030" })) });
    const { result, zips } = await parseOmahPadhangZips([{ data: a, name: "a.zip" }, { data: b, name: "b.zip" }, { data: c, name: "c.zip" }]);
    expect(result.rows).toHaveLength(2);
    expect(zips.map((z) => z.status)).toEqual(["processed", "skipped", "processed"]);
  });

  it("satu ZIP gagal di antara ZIP valid: ditandai failed, yang lain tetap dihitung", async () => {
    const good = await zipOf({ "d1.csv": csv(line({ rcpt: "A1" })) });
    const { result, zips } = await parseOmahPadhangZips([{ data: good, name: "good.zip" }, { data: new Uint8Array([1, 2, 3]), name: "rusak.zip" }, { data: good, name: "notzip.txt" }]);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(zips.find((z) => z.zipName === "rusak.zip")?.status).toBe("failed");
    expect(zips.find((z) => z.zipName === "notzip.txt")?.status).toBe("failed");
  });

  it("semua ZIP gagal → hasil gagal dengan alasan per file", async () => {
    const { result, zips } = await parseOmahPadhangZips([{ data: new Uint8Array([1]), name: "a.zip" }, { data: new Uint8Array([2]), name: "b.zip" }]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("a.zip");
    expect(zips.every((z) => z.status === "failed")).toBe(true);
  });

  it("no_struk yang sama lintas ZIP ditandai (tidak dihapus), tanpa penandaan ganda", async () => {
    const a = await zipOf({ "d1.csv": csv(line({ rcpt: "DUP", date: "01-09-2030" })) });
    const b = await zipOf({ "d2.csv": csv(line({ rcpt: "DUP", date: "02-09-2030" })) });
    const { result } = await parseOmahPadhangZips([{ data: a, name: "a.zip" }, { data: b, name: "b.zip" }]);
    expect(result.rows).toHaveLength(2);
    expect(result.duplicateReceipts).toBe(1);
    result.rows.forEach((r) => expect(r.issues.filter((m) => m.startsWith("No struk duplikat"))).toHaveLength(1));
  });
});

describe("file contoh asli Omah Padhang 01-10-2026", () => {
  const SAMPLE = readFileSync(fileURLToPath(new URL("../fixtures/omahPadhang20261001.csv", import.meta.url)), "utf-8");

  it("12 transaksi terbaca, seluruh validasi sumber lolos tanpa catatan", () => {
    const r = parseOmahPadhangCsv(SAMPLE, "sample.csv");
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(12);
    expect(r.invalidRows).toBe(0);
    r.rows.forEach((row) => expect(row.issues).toEqual([]));
  });
  it("nilai baris pertama sesuai sumber", () => {
    const [row] = parseOmahPadhangCsv(SAMPLE, "sample.csv").rows;
    expect(row).toMatchObject({ no_struk: "1O54JB", date_trans: "2026-10-01 20:13:37", subtotal: 69000, discount: 0, refunds: 0, net_sales: 69000, service_charge: 3450, dpp: 72450, tax: 7245, total_collected: 79700, total: 79700 });
    expect(row.keterangan).toBe("Wedang Jahe Gula Batu, Pisang Goreng Omah Padhang, Ronde");
  });
  it("ringkasan seluruh data & pajak = 10% DPP pada setiap baris", () => {
    const { rows } = parseOmahPadhangCsv(SAMPLE, "sample.csv");
    const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
    expect(sum((r) => r.subtotal)).toBe(1087000);
    expect(sum((r) => r.service_charge)).toBe(54350);
    expect(sum((r) => r.dpp)).toBe(1141350);
    expect(sum((r) => r.tax)).toBeCloseTo(114135, 6);
    expect(sum((r) => r.total)).toBe(1255400);
    rows.forEach((r) => expect(r.tax).toBeCloseTo(r.dpp * 0.1, 6));
  });
  it("urutan kolom diacak → hasil identik", () => {
    const base = Papa.parse<string[]>(SAMPLE, { skipEmptyLines: "greedy" }).data;
    const order = base[0].map((_, i) => i).sort((a, b) => ((a * 7 + 3) % 21) - ((b * 7 + 3) % 21));
    expect(order).not.toEqual(base[0].map((_, i) => i));
    const shuffled = Papa.unparse(base.map((r) => order.map((i) => r[i])));
    const a = parseOmahPadhangCsv(SAMPLE, "x.csv");
    const b = parseOmahPadhangCsv(shuffled, "x.csv");
    expect(b.ok).toBe(true);
    expect(b.rows).toEqual(a.rows);
  });
  it("lewat ZIP: ringkasan sama", async () => {
    const r = await parseOmahPadhangZip(await zipOf({ "Report Transaction.csv": SAMPLE }), "report.zip");
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ files: 1, count: 12, subtotal: 1087000, service_charge: 54350, discount: 0, dpp: 1141350, total: 1255400 });
  });
});
