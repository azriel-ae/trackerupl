# CheckingUploadFile

**Document & Transaction Checking System.** Aplikasi untuk Pengecekan Transaksi UPL: upload file, pilih mode pemeriksaan UPL, jalankan pengecekan, lalu lihat hasilnya. Semua file diproses di browser.

## Mode pemeriksaan UPL

KLAND, THE OMALA (HOTEL / RESTO), OMAH PADHANG, INNA TRETES, ROYAL SENYIUR, HOTEL PLATARAN, KEDAI HUTAN CEMPAKA, HOTEL SURYA TRETES.
Format file tiap mode ada di `client/src/lib/uplModes.ts` dan halaman Tentang.

## Menjalankan

```bash
npm ci --legacy-peer-deps   # install
npm run dev                 # dev server (Vite)
npm run check               # TypeScript
npm test                    # vitest
npm run build               # build client (dist/public) + server (dist/index.js)
npm start                   # jalankan hasil build
```

Deploy Vercel memakai `vercel.json` (`npm run build:vercel`, output `dist/public`). Server Express (`server/index.ts`) menyajikan hasil build dan mengarahkan semua rute ke `index.html`.

## Rute

| Rute | Halaman |
| --- | --- |
| `/` | Beranda |
| `/pemeriksaan-upl` | Pilih mode pemeriksaan UPL |
| `/pemeriksaan-upl/<mode>` | Checker mode (`kland`, `omah-padhang`, `inna-tretes`, `royal-senyiur`, `hotel-plataran`, `kedai-hutan-cempaka`, `hotel-surya-tretes`) |
| `/pemeriksaan-upl/the-omala` | Pilih kategori THE OMALA, lalu `/hotel` atau `/resto` |
| `/tentang` | Tentang |

## Struktur

```
client/
  index.html
  public/                 favicon dan logo aplikasi
  src/
    main.tsx, App.tsx     entry dan router (wouter)
    index.css             style global checker UPL
    pages/                PemeriksaanUpl (hub + routing mode), Tentang, dan satu checker per mode UPL
    components/           Landing, SiteNav (navbar kapsul), BrandLogo, komponen upload bersama; ui/ = shadcn yang dipakai
    assets/logos/         logo perusahaan (lihat README di folder itu)
    lib/
      upl/                KLAND: parser, kategori, C&C, resto, bulanan
      parsers/            parser Omala, Omah Padhang, Inna Tretes, Royal Senyiur, Hotel Plataran, Kedai Hutan Cempaka, Surya Tretes
      shared/             helper lintas parser (monthlyCommon, multiFile, parseHelpers)
      uplModes.ts         metadata mode untuk Beranda, hub, dan Tentang
server/index.ts           server Express statis untuk produksi
```

## Format file OMAH PADHANG

Upload ZIP berisi CSV laporan transaksi (harian: 1 ZIP, bulanan: banyak ZIP). Kolom dibaca dari **nama header**, bukan posisi, sehingga urutan kolom boleh berubah. Nama header tidak peka huruf besar/kecil.

| Header sumber | Dipakai sebagai |
| --- | --- |
| `Receipt Number` | No Struk |
| `Date` + `Time` | Date Trans (`YYYY-MM-DD HH:mm:ss`) |
| `Gross Sales` | Subtotal |
| `Discounts` | Discount |
| `Gratuity` | Service Charge |
| `Tax` | Tax |
| `Total Amount` | Total |
| `Items` | Keterangan |
| `Refunds`, `Net Sales`, `Total Collected` | Validasi data sumber |

- DPP = Subtotal - Discount + Service Charge. `Net Sales` tidak otomatis dipakai sebagai DPP.
- Validasi (hanya catatan di kolom Catatan, angka sumber tidak diubah): `Net Sales = Gross Sales - Discounts - Refunds`; `Total Collected = Net Sales + Gratuity + Tax` dengan toleransi pembulatan laporan Rp100 (selisih maksimal Rp50).
- Bila ada header wajib yang tidak ditemukan, file ditolak dengan pesan yang menyebut header tersebut. Nilai tidak dibaca dari kolom lain dan tidak dianggap nol. Nilai angka yang kosong/tidak valid membuat baris itu ditandai tidak valid.

## Format file KEDAI HUTAN CEMPAKA

Satu CSV "LAPORAN PENJUALAN REKAP" (harian: 1 CSV, bulanan: banyak CSV). Di atas tabel ada info toko dan judul laporan; di bawahnya baris rekap dan footer. **Baris header dicari otomatis dari nama kolomnya** (bukan nomor baris tetap) dan semua kolom dibaca dari **nama header**, bukan huruf kolom, sehingga urutan kolom boleh berubah. Nama header tidak peka huruf besar/kecil; spasi awal/akhir/ganda diabaikan (`Pot. ` dikenali sebagai `Pot.`). Tidak ada fallback ke indeks kolom.

| Header sumber | Dipakai sebagai |
| --- | --- |
| `No Transaksi` | no_struk |
| `Tanggal` (`DD/MM/YYYY`) | date_trans (`YYYY-MM-DD`) |
| `Kode Pel.` | keterangan |
| `Sub Total` | subtotal |
| `Pot.` | discount |
| `Pajak` | tax |
| `Total Akhir` | total (nilai sumber, tidak dihitung ulang) |
| `Bayar Tunai`, `Bayar Kredit`, `Bayar Kartu Kredit` | dikenali, tidak dipakai |

- Service charge = 0. DPP = Sub Total - Pot.
- Angka gaya en-US (`32,000.00`): koma = pemisah ribuan, titik = desimal; nilai desimal lain (mis. `1,000.50`) dibaca benar. Format lain (mis. `32.000,00`, `1,5`) atau kosong membuat baris ditandai tidak valid, tidak dianggap nol.
- Baris transaksi = ada `No Transaksi` dan `Tanggal` berformat `DD/MM/YYYY`. Baris rekap (`TOTAL KESELURUHAN :`, `Sub Total :`, `Pajak :`, ...), footer (tanggal cetak/kasir/halaman), baris kosong, dan header yang diulang dilewati. Deteksi baris rekap memeriksa semua sel, jadi tetap benar saat kolom diacak.
- Header wajib hilang atau ganda: file ditolak dengan pesan yang menyebut nama header tersebut.
- Validasi (hanya catatan, nilai sumber tidak diubah): `Total Akhir` vs DPP + Pajak (toleransi Rp1).
- **Bulanan (banyak CSV)**: tiap file divalidasi sendiri-sendiri, lalu transaksi file valid digabung. Tanggal selalu dari header `Tanggal`, bukan nama file. Ringkasan menampilkan file berhasil, file gagal (dengan pesan, mis. nama header yang hilang), dan total transaksi; subtotal/discount/DPP/pajak/total adalah akumulasi semua file.
- **Pencegahan duplikat**: CSV berisi sama persis dihitung sekali. Transaksi di file *berbeda* dibuang hanya bila seluruh identitasnya sama (No Transaksi, Tanggal, Sub Total, Pot., Pajak, Total Akhir, Kode Pel.), mis. laporan yang tumpang tindih. No Transaksi sama dengan nilai berbeda tidak dibuang, hanya ditandai di kolom Catatan. Baris identik di dalam satu file tidak dibuang.
- Kode: `client/src/lib/parsers/kedaiHutanCempakaParser.ts`, halaman `client/src/pages/KedaiHutanCempakaChecker.tsx`.

## Format file HOTEL SURYA TRETES

Satu file Excel (`.xls` / `.xlsx`) laporan **F/O Turnover Report by Department** memuat empat kategori sekaligus (HOTEL, RESTO, KOLAM RENANG, KEBUGARAN). Tidak perlu empat file terpisah. Harian: 1 file; bulanan: banyak file harian.

Semua kolom dibaca dari **nama header**, bukan huruf kolom atau nomor baris. Nama header tidak peka huruf besar/kecil, spasi, dan tanda hubung.

| Header sumber | Dipakai sebagai |
| --- | --- |
| `Art Description` | Nama item, penentu kategori, bagian `no_struk` |
| `Day-Nett` | subtotal |
| `Service` | service_charge |
| `Tax` | tax |
| `Day-Gros` | total (nilai sumber, tidak dihitung ulang) |
| `(%)` | tidak dipakai |

- Laporan punya tiga blok kolom (Day, MTD, YTD), jadi `Service`, `Tax`, dan `(%)` muncul tiga kali. Yang dipakai hanya blok Day: `Service` dan `Tax` adalah header bernama itu yang berada di antara `Day-Nett` dan `Day-Gros`. Blok MTD/YTD tidak pernah dibaca.
- Header yang berulang di halaman berikutnya dikenali lagi (peta kolom dibangun ulang pada tiap baris header). Header wajib hilang, ganda, atau tidak berurutan: file ditolak dengan pesan yang menyebut nama header dan nomor baris. Tidak ada fallback ke posisi kolom.
- Kategori dari `Art Description` (tanpa membedakan huruf besar/kecil): HOTEL `LODGING|EXTRA BED|ADDITIONAL ROOM|EARLY C.?I|LATE C.?O|LAUNDRY`; RESTO `FOOD|COFFEE|B.?FAST|BREAKFAST|LUNCH|DINNER|BEVERAGE|BQT|CATERING`; KOLAM RENANG `SWIMMING`; KEBUGARAN `RECREATION|TENNIS`. Item yang cocok lebih dari satu kategori tidak ditebak: dilaporkan sebagai masalah dan tidak dihitung. Pola ada di `SURYA_CATEGORY_PATTERNS`.
- Rumus (sama untuk keempat kategori): `no_struk` = nama dasar file + `-` + Art Description; `date_trans` = tanggal dari nama file; `subtotal` = Day-Nett; `service_charge` = Service; `discount` = 0; `dpp` = Day-Nett + Service; `tax` = Tax; `total` = Day-Gros; `keterangan` = nama dasar file. Tax selalu dari header `Tax` (juga untuk KOLAM RENANG dan KEBUGARAN), Service tidak pernah dipakai sebagai Tax.
- Tanggal dari nama file berpola `SURYADDMMYYYY` (mis. `SURYA03112026.xls` = 2026-11-03), bukan dari posisi kolom dan bukan tanggal upload. Pola tidak cocok atau tanggal kalender tidak ada: file tersebut gagal dengan pesan yang menyebut nama filenya, file lain tetap diproses. Bila "Period" di judul laporan berbeda dari tanggal nama file, muncul peringatan (tanggal yang dipakai tetap dari nama file).
- Baris yang dibaca: Art Description terisi, `Day-Gros` berisi angka, dan cocok dengan satu kategori. Dilewati: judul laporan/hotel/halaman, garis pemisah, judul seksi departemen (mis. `20 - LAUNDRY, SPA, FITNE`, `1 - SURYA COFFEE SHOP` yang memuat kata kunci tetapi `Day-Gros`-nya kosong), `TOTAL` / `GRAND TOTAL`, item di luar keempat kategori (mis. Shop, Mineral Water, A/P Commission), dan baris `Day-Gros` = 0. `Service` = 0 tidak membuang baris. Angka negatif (baris diskon) dihitung apa adanya.
- `Service` / `Tax` kosong dianggap 0 dan dicatat di kolom Catatan. `Day-Nett` / `Day-Gros` kosong atau bukan angka pada baris kategori: baris dilaporkan sebagai masalah dan tidak dihitung (tidak dianggap 0). Catatan tambahan (data tidak diubah): `Day-Gros` berbeda lebih dari Rp2 dari `Day-Nett + Service + Tax`.
- Angka dihitung eksak (BigInt), tanpa floating point; pembulatan 2 desimal hanya saat tampilan.
- **Bulanan**: tiap file divalidasi sendiri-sendiri, tanggalnya dari namanya sendiri, lalu transaksi file valid digabung. Tanggal yang sama pada dua file berbeda diberi peringatan. File identik (nama atau isi) dihitung sekali.
- Kode: `client/src/lib/parsers/suryaTretesParser.ts`, halaman `client/src/pages/HotelSuryaTretesChecker.tsx`.

## Catatan perubahan

### Update UPLCheck · Hotel Surya Tretes (2026-11-04)

**Status**: parser dan halaman mode **HOTEL SURYA TRETES** (`/pemeriksaan-upl/hotel-surya-tretes`) selesai, harian dan bulanan. Aturan lengkap ada di bagian "Format file HOTEL SURYA TRETES".

**Perubahan**
- Mode baru, memakai pola yang sama dengan HOTEL PLATARAN (satu file, empat kategori, harian/bulanan). Integrasi minimum pada kode lama: satu entri di `uplModes.ts` dan satu `case` + import di `PemeriksaanUpl.tsx`.
- Tanpa kolom `id_agent` (tidak ada ketentuan id agent untuk mode ini) dan belum ada file logo: kartu mode memakai huruf "H" (fallback bawaan). Bila logo ditambahkan, simpan sebagai `client/src/assets/logos/suryatretes.png` (sesuai `asset` di `uplModes.ts`).
- KLAND, THE OMALA, OMAH PADHANG, INNA TRETES, ROYAL SENYIUR, HOTEL PLATARAN, KEDAI HUTAN CEMPAKA: kode, rumus, parser, dan kategori tidak diubah (selisih terhadap versi sebelumnya hanya pada file di bawah).

**File diubah / baru**
- Baru: `client/src/lib/parsers/suryaTretesParser.ts`, `suryaTretesParser.test.ts`, `client/src/lib/fixtures/SURYA03112026.xls`, `client/src/pages/HotelSuryaTretesChecker.tsx`
- Diubah (integrasi): `client/src/lib/uplModes.ts`, `client/src/pages/PemeriksaanUpl.tsx`, `README.md`

**Hasil pengujian**
- File contoh asli `SURYA03112026.xls` (tanggal 2026-11-03): 11 transaksi, tanpa masalah data, 2 baris header dikenali (halaman 1 dan 2).
  - HOTEL: 3 transaksi, Subtotal Rp6.596.797, Service Rp659.680, DPP Rp7.256.477, Tax Rp725.648, Total Rp7.982.125
  - RESTO: 8 transaksi, Subtotal Rp3.335.330, Service Rp333.533, DPP Rp3.668.863, Tax Rp366.886, Total Rp4.035.750
  - KOLAM RENANG dan KEBUGARAN: 0 transaksi, karena `601 Swimming Pool`, `501 Tennis`, dan `650 Sport & Recreation` bernilai 0 pada tanggal ini (dilewati sesuai aturan Day-Gros 0)
  - Gabungan: Subtotal Rp9.932.127, Service Rp993.213, DPP Rp10.925.340, Tax Rp1.092.534, Total Rp12.017.875. Angka ini sama dengan hitungan independen (Python) dari file sumber.
  - Selisih terhadap GRAND TOTAL Day-Gros Rp12.197.000 = Rp179.125, yaitu item di luar keempat kategori: `143 Shop - Good Sold` Rp10.000, `200 Mineral Water` Rp30.000, `403 A/P Commission OTA` Rp139.125.
- `suryaTretesParser.test.ts`: kasus tanggal nama file, pola kategori (semua item sampel), keempat kategori dalam satu file, header berulang (termasuk dengan posisi kolom berbeda), kolom bergeser dan Service/Tax ditukar, kolom Service/Tax kembar (MTD/YTD tidak terbaca), TOTAL/GRAND TOTAL/judul seksi berkata kunci, Day-Gros 0, Service 0, Tax dari header Tax untuk Kolam Renang dan Kebugaran, diskon negatif, angka kosong/teks/error, header hilang (tiap header dan gabungan), header ganda, nama file salah, gabungan banyak file harian, workbook `.xls` dan `.xlsx`.
- Dijalankan di lingkungan pengembangan ini: 79 tes tingkat grid lulus (parser murni; diperiksa juga bahwa tes gagal bila Tax diambil dari Service). Pemeriksaan tipe parser (`tsc --strict`) lulus, dan sintaks halaman checker lolos.
- **Belum dijalankan di sini** (lingkungan tanpa jaringan, `npm ci` tidak bisa dipasang sehingga SheetJS dan vitest tidak ada): 10 tes yang membaca workbook lewat SheetJS (termasuk fixture `.xls` asli dan roundtrip `.xls`/`.xlsx`), `npm test` penuh, `npm run check` penuh, `vite build`, dan uji UI di browser. Sebagai gantinya, isi sel file `.xls` asli dibaca lewat LibreOffice lalu dimasukkan ke parser dan hasilnya dicocokkan dengan angka di atas. Jalankan `npm run check`, `npm test`, dan `npm run build` sebelum dipakai.

**Perlu konfirmasi**
- Separator `no_struk`: dipakai `nama dasar file` + `-` + `Art Description` (mis. `SURYA03112026-100 Lodging (Room Revenue)`). Bila sistem lain memakai pemisah berbeda, ubah `SURYA_NO_STRUK_SEPARATOR` di parser.
- Filter tanggal 3 hari sebelum dan 7 hari setelah tanggal acuan: tidak ada di kode proyek ini, jadi tidak ada yang dipertahankan atau ditambahkan. Parser membaca seluruh transaksi dari file yang valid, masing-masing dengan tanggal nama filenya.

### Update UPLCheck · Kedai Hutan Cempaka (2026-11-02)

**Perubahan**
- Mode baru **KEDAI HUTAN CEMPAKA** (`/pemeriksaan-upl/kedai-hutan-cempaka`), harian dan bulanan, memakai pola yang sama dengan mode lain.
- Integrasi minimum pada kode lama: satu entri di `uplModes.ts`, satu `case` + import di `PemeriksaanUpl.tsx`, dan teks jumlah mode "Enam" menjadi "Tujuh" di `Tentang.tsx` dan `Landing.tsx`.
- Belum ada file logo; kartu mode memakai huruf "K" (fallback bawaan). Logo melayang di beranda tidak diubah.
- Kolom `ID Agent` tidak ditampilkan karena tidak ada ketentuan id agent untuk mode ini.
- KLAND, THE OMALA, OMAH PADHANG, INNA, ROYAL SENYIUR, HOTEL PLATARAN: kode, rumus, parser, dan kategori tidak diubah.

**Perapian UI (2026-11-03)** — hanya tampilan, parser dan rumus tidak diubah
- Beranda: paragraf pengantar, bagian "Fitur" (lima kartu), dan tombol "Lihat Fitur" dihapus; tersisa hero, tombol Mulai Pengecekan, dan deretan logo mode.
- Pemeriksaan UPL: langkah 1-4, paragraf pengantar, dan deskripsi di tiap kartu mode dihapus; kartu hanya berisi logo, nama, dan format. Halaman kategori THE OMALA disederhanakan sama.
- Tentang: kartu penjelasan dan kolom Keterangan dihapus; tersisa tabel Mode dan Format file.
- Semua halaman checker: subjudul di bawah judul, deskripsi panel, teks petunjuk di area upload (kolom/format), catatan "Diproses lokal di browser" (sudah ada badge Local-first di sidebar), blok "CURRENT SOURCE", keterangan "ringkasan dihitung dari seluruh data", kotak placeholder "Upload file untuk melihat ...", dan catatan RESTO di THE OMALA dihapus. Peringatan, error, dan hasil tidak diubah. Status ganda di Kedai Hutan Cempaka dan Omah Padhang dihapus karena sudah ada di tabel file.
- CSS: area upload lebih pendek, jarak judul panel dan switch Harian/Bulanan diperbaiki, tombol utama di halaman Tentang kembali terbaca (teks putih).
- TypeScript, build, dan 283 tes lulus (dua file tes lama dengan fixture hilang tetap gagal seperti sebelumnya).

**Logo (2026-11-02)**
- Logo Kedai Hutan Cempaka ditambahkan di `client/src/assets/logos/kedaihutancempaka.png` (sesuai `asset` di `uplModes.ts`); kartu mode kini menampilkan logo, bukan huruf "K". Logo melayang di hero beranda tidak ditambah.
- Perbaikan logo terpotong pada kartu mode (paling terlihat di OMAH PADHANG; THE OMALA, ROYAL SENYIUR, dan HOTEL PLATARAN ikut terpotong di bagian bawah). Penyebab: baris grid `.up-mode-logo` mengikuti tinggi gambar sehingga `height: 100%` tidak membatasi gambar (mis. tinggi Omah Padhang 90px di kotak 72px). Perbaikan di `client/src/pages/Site.css` saja (`grid-template` dan `box-sizing`/`min-*` pada gambar); file logo tidak diubah. Semua logo kini utuh dengan rasio asli, termasuk INNA TRETES.

**Dukungan banyak file (bulanan)**
- Ditambahkan: hitungan file gagal dan transaksi identik antar-file yang dibuang (`filesFailed`, `duplicateRowsRemoved`), kartu "File berhasil" / "File gagal", dan pesan file bermasalah di halaman. Perilaku satu file tidak berubah.
- Tes: 50 tes untuk mode ini (5 baru: tumpang tindih, no struk sama nilai beda tetap dipertahankan, baris identik dalam satu file tetap, tanggal dari header dengan kolom berbeda urutan, hitungan file berhasil/gagal). Seluruh suite 283 lulus, TypeScript dan build lulus; dua file tes lama yang fixture-nya hilang tetap gagal seperti sebelumnya.

**File diubah / baru**
- Baru: `client/src/lib/parsers/kedaiHutanCempakaParser.ts`, `kedaiHutanCempakaParser.test.ts`, `client/src/lib/fixtures/kedaiHutanCempaka30092026.csv`, `client/src/pages/KedaiHutanCempakaChecker.tsx`
- Diubah (integrasi): `client/src/lib/uplModes.ts`, `client/src/pages/PemeriksaanUpl.tsx`, `client/src/pages/Tentang.tsx`, `client/src/components/Landing.tsx` (hanya teks), `README.md`

**Hasil pengujian**
- `npm run check` (TypeScript): lulus. `vite build`: berhasil.
- `kedaiHutanCempakaParser.test.ts`: 50 tes lulus. File contoh asli 30/09/2026: 6 transaksi, Subtotal Rp438.500, Discount 0, Service 0, DPP Rp438.500, Pajak Rp48.235, Total Rp486.735 (sama dengan harapan dan baris rekap file). Hasil identik setelah kolom dipindah (No Transaksi dari A ke D), dibalik, dan 60 permutasi acak; header di baris berbeda; header dengan huruf besar/spasi berbeda; tiap header wajib yang hilang ditolak dengan pesan yang menyebut namanya; header ganda ditolak.
- Uji UI di browser (Playwright): upload fixture menampilkan 6 baris dan ringkasan yang sama.
- Seluruh suite: 283 tes lulus (233 sebelumnya + 50 baru). Dua file tes tetap gagal dimuat karena fixture tidak ada di repo, seperti sebelumnya: `hotelPlataranParser.test.ts` dan `royalSenyiurParser.test.ts`.

### Update UPLCheck · Omah Padhang (2026-11-01)

**Perubahan**
- Parser Omah Padhang kini mengenali `Gross Sales`, `Refunds`, dan `Total Collected` (selain header yang sudah ada). Semua header wajib dibaca lewat nama.
- `Subtotal` sekarang dari `Gross Sales` (sebelumnya dari `Net Sales`). Rumus DPP tidak berubah (`subtotal - discount + service`), sehingga DPP kini benar saat ada diskon: sebelumnya diskon terpotong dua kali karena `Net Sales` sudah dikurangi diskon. Pada data tanpa diskon hasilnya sama persis.
- Validasi baru: `Net Sales` terhadap `Gross - Discounts - Refunds`, dan `Total Collected` terhadap `Net + Gratuity + Tax` dengan toleransi pembulatan Rp50.
- Pesan header hilang kini menyebut semua header yang kurang dalam satu pesan.
- Logo melayang di hero beranda: entri `fave` tidak punya file logo sehingga tampil sebagai huruf "F". Diganti dengan `jambuluwuk` (file tersedia), dan entri tanpa file logo tidak lagi ditampilkan.
- KLAND dan kategori UPL lain tidak diubah.

**File diubah**
- `client/src/lib/parsers/omahPadhangParser.ts`
- `client/src/lib/parsers/omahPadhangParser.test.ts`
- `client/src/lib/fixtures/omahPadhang20261001.csv` (baru, contoh laporan asli 01-10-2026)
- `client/src/pages/OmahPadhangChecker.tsx` (teks petunjuk header)
- `client/src/components/Landing.tsx` (logo melayang)
- `client/src/assets/logos/README.md`
- `README.md`

**Hasil pengujian**
- `npm run check` (TypeScript): lulus. `vite build`: berhasil.
- `omahPadhangParser.test.ts`: 48 tes lulus, termasuk file contoh asli (12 transaksi, tanpa catatan validasi, Subtotal Rp1.087.000, Service Charge Rp54.350, DPP Rp1.141.350, Tax Rp114.135, Total Rp1.255.400), urutan kolom diacak menghasilkan hasil identik, setiap header wajib hilang ditolak dengan pesan jelas.
- Seluruh suite: 182 tes lulus. Tiga file tes gagal dimuat karena fixture contoh tidak ada di repo (sudah demikian sebelum perubahan ini, tidak terkait Omah Padhang; tes INNA kini sudah berjalan, lihat bagian INNA): `hotelPlataranParser.test.ts`, `innaTretesParser.test.ts` (`innatretes20261001.xlsx`), dan `royalSenyiurParser.test.ts` (`royalSenyiur20260901.csv`).

**Menunggu giliran (belum diubah)**
- THE OMALA (HOTEL / RESTO), ROYAL SENYIUR, HOTEL PLATARAN: pembacaan kolom belum ditinjau terhadap prinsip nama header. (INNA sudah selesai, lihat di bawah.)
- KLAND: sudah memakai nama header, tidak diubah.
- Melengkapi fixture tes yang hilang (`hotelPlataranParser.test.ts`, `royalSenyiurParser.test.ts`).

## Format file INNA TRETES

Satu file Excel (.xlsx/.xls) berisi tiga kategori. Semua kolom dibaca dari **nama header**, bukan huruf kolom, sehingga urutan kolom boleh berubah. Baris header dicari otomatis (60 baris pertama); nama header tidak peka huruf besar/kecil dan spasi ganda.

| Header | Fungsi | Status |
| --- | --- | --- |
| `Class` | Penentu kategori | wajib |
| `Folio` | Bagian nomor struk, keterangan | wajib |
| `Trn Date` | Tanggal transaksi (`date_trans`) | wajib |
| `Trans ID` | Bagian nomor struk; filter transaksi valid | wajib |
| `Trans Name` | Keterangan | wajib |
| `Trans Nett` | Nilai dasar perhitungan (L), `subtotal` | wajib |
| `Room`, `Trn Code`, `Remark`, `Reference`, `Jrnl Code`, `Shift` | Dikenali, tidak dipakai dalam hasil | opsional |

- Kategori dari `Class`: HOTEL = `ROOM`, RESTO = `FB` dan `FB POS`, HIBURAN = `POOL`. Kode lain dilaporkan sebagai tidak dikenal, tidak dipaksakan ke kategori.
- Transaksi valid: `Trans ID` tidak kosong dan bukan teks header (`Trans ID`). Baris total laporan dan header berulang dilewati.
- `no_struk` = `Folio - Trans ID`; bila `Folio` kosong, hanya `Trans ID`. `keterangan` = `Folio = <Folio> Trans Name= <Trans Name>`; bila `Folio` kosong, `Trans Name= <Trans Name>`.
- `Trn Date`: serial Excel (angka, termasuk pecahan jam, atau teks angka) dan format teks `dd-Mon-yy`, `dd/mm/yyyy`, `yyyy-mm-dd` dibaca menjadi `YYYY-MM-DD`. Tanggal kosong/tidak valid membuat baris ditandai dan tidak dihitung (tidak pernah memakai tanggal hari ini).
- Header wajib hilang atau ganda: file ditolak dengan pesan yang menyebut semua header bermasalah. `Trans Nett` atau `Trn Date` kosong tidak dianggap nol; barisnya ditandai dan tidak dihitung.

### Rumus INNA yang menunggu konfirmasi

Rumus lama dipertahankan persis (mengikuti query acuan; tidak ada dokumen aturan pajak lain di proyek), dengan L = `Trans Nett`:

| Field | Rumus saat ini | Setara |
| --- | --- | --- |
| service_charge | `L - ((L × 11%) × 10)` | −0,1 × L (negatif untuk L positif) |
| dpp | `(L × 11%) × 10` | 1,1 × L |
| tax | `L × 11%` | 0,11 × L |
| total | `L × 1,21` | 1,21 × L |
| discount | 0 | 0 |

Temuan: service_charge bernilai negatif, DPP = 110% dari L, dan `total` tidak sama dengan DPP + Service Charge + Tax. **Perlu konfirmasi** aturan yang benar untuk Service Charge, DPP, dan Total sebelum diubah. Satu petunjuk (bukan dasar perubahan): `1,21 × L` pada file sampel menghasilkan angka bulat (mis. total HIBURAN 135.000 dan RESTO 1.134.000 pada sampel 19-10-2026), sehingga total tampaknya memang dimaksudkan = DPP + Tax dengan service charge 10% × L dan DPP = 1,1 × L. Ini hanya dugaan; rumus belum diubah.

### Update UPLCheck · INNA (2026-11-01)

**Perubahan**
- Parser INNA kini memetakan semua kolom lewat nama header (sebelumnya memakai posisi A, B, D, E, G, L). Berlaku untuk ketiga kategori (HOTEL, RESTO, HIBURAN).
- Header opsional (`Room`, `Trn Code`, `Remark`, `Reference`, `Jrnl Code`, `Shift`) dikenali dan boleh tidak ada.
- Pesan error menyebut nama header yang hilang/ganda; pesan baris bermasalah memakai nama header, bukan huruf kolom.
- `no_struk` saat `Folio` kosong: sebelumnya `" - 62943"` (diawali tanda hubung dan spasi), sekarang `"62943"`. `keterangan` saat `Folio` kosong: sebelumnya `"Folio =  Trans Name= X"`, sekarang `"Trans Name= X"`. Bila hasil ini dicocokkan teks per teks dengan data sistem lain, format lama tidak lagi sama untuk transaksi tanpa Folio.
- `Trn Date` berupa teks serial Excel (mis. `"46314"`) kini juga dibaca sebagai tanggal.
- Rumus, filter kategori, filter `Trans ID`, ringkasan, tampilan, dan alur upload tidak diubah.

**File diubah**
- `client/src/lib/parsers/innaTretesParser.ts`
- `client/src/lib/parsers/innaTretesParser.test.ts`
- `client/src/lib/fixtures/innatretes20261019.xlsx` (baru, contoh laporan asli 19-10-2026)
- `client/src/pages/InnaTretesChecker.tsx` (teks petunjuk dan catatan)
- `README.md`

**Hasil pengujian**
- `npm run check` (TypeScript): lulus. `vite build`: berhasil.
- `innaTretesParser.test.ts`: 51 tes lulus. Termasuk file sampel asli 19-10-2026: 78 transaksi (HOTEL 49, HIBURAN 3, RESTO 26 = FB 18 + FB POS 8), seluruh tanggal 2026-10-19, tanpa baris bermasalah, jumlah per kategori sama dengan hitungan independen Python Decimal; urutan kolom diacak menghasilkan hasil identik; tiap header wajib yang hilang ditolak dengan pesan jelas; header ganda ditolak; header opsional boleh hilang.
- Seluruh suite: 233 tes lulus. Dua file tes gagal dimuat karena fixture contoh tidak ada di repo (sudah demikian sebelumnya): `hotelPlataranParser.test.ts` dan `royalSenyiurParser.test.ts` (`royalSenyiur20260901.csv`). Tes INNA yang sebelumnya gagal karena fixture `innatretes20261001.xlsx` hilang kini berjalan dengan fixture baru.

**Menunggu giliran / konfirmasi**
- Konfirmasi rumus Service Charge, DPP, dan Total INNA (lihat di atas).
- THE OMALA, ROYAL SENYIUR, HOTEL PLATARAN: peninjauan pembacaan berdasarkan nama header.
- Melengkapi fixture tes yang hilang untuk HOTEL PLATARAN dan ROYAL SENYIUR.

### Update logo melayang beranda (2026-11-01)

- Logo melayang di hero beranda sekarang hanya logo enam mode Pemeriksaan UPL: KLAND, INNA TRETES, OMAH PADHANG, ROYAL SENYIUR, HOTEL PLATARAN, THE OMALA (`FLOATING` di `client/src/components/Landing.tsx`).
- Logo yang tidak dipakai mode Pemeriksaan UPL dihapus dari `client/src/assets/logos/optimized/`: astana, fore, hokben, jambuluwuk, kai, kopken, nsc, pointcoffee, rotio, sams.
- `client/src/assets/logos/README.md` ditulis ulang. Hasil build hanya memuat logo enam mode tersebut. TypeScript lulus, build berhasil, 233 tes lulus (dua file tes lama tetap gagal dimuat karena fixture hilang, seperti sebelumnya).
