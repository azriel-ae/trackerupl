# Logo perusahaan

Hanya logo mode Pemeriksaan UPL yang disimpan di sini. Nama file harus sama dengan `asset` di `src/lib/uplModes.ts`
dan dengan `FLOATING` di `src/components/Landing.tsx` (logo melayang di hero beranda). Format: svg, png, webp, jpg. Tidak perlu mengubah kode.

| Mode | asset |
| --- | --- |
| KLAND | kland |
| THE OMALA | omala |
| OMAH PADHANG | omahpadhang |
| INNA TRETES | innatretes |
| ROYAL SENYIUR | royalsenyiur |
| HOTEL PLATARAN | plataran |
| KEDAI HUTAN CEMPAKA | kedaihutancempaka |

Logo perusahaan lain (HOKBEN, ASTANA, FORE, NSC, ROTIO, KAI, SAMS, JAMBULUWUK, KOPKEN, POINT COFFEE) sudah dihapus karena
tidak dipakai oleh mode Pemeriksaan UPL mana pun. Untuk menambah mode baru, taruh logonya di sini dan tambahkan di `uplModes.ts`.

## Versi optimized (non-destruktif)

`optimized/` berisi versi turunan logo yang margin kosongnya dipangkas dan latarnya dinormalkan. File asli di folder ini tidak
diubah. Jika ada file dengan nama dasar yang sama di `optimized/`, itulah yang dipakai (lihat `resolveLogo` di `src/lib/parserBrands.tsx`).
Logo `omala` dan `plataran` tidak punya versi optimized, jadi file aslinya yang dipakai.

## Logo melayang di hero (ukuran seragam)

Setiap logo melayang ditampilkan di lingkaran putih 68px dengan `object-fit: contain` (tidak dipotong, rasio asli terjaga).
Ukuran visual tiap logo diatur individual lewat `box: [lebar%, tinggi%]` pada `FLOATING` di `src/components/Landing.tsx`
(persen dari diameter lingkaran, dihitung dari rasio aspek file agar sudut gambar tetap di dalam lingkaran).
Logo berlatar warna (omala, plataran) diberi kotak lebih kecil supaya sudutnya tidak terpotong lingkaran.
Kalau mengganti logo, sesuaikan `box` entri logo itu.
