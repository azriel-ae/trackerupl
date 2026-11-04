/// <reference types="vite/client" />
import {
  Car,
  CupSoda,
  Drumstick,
  Gamepad2,
  Hotel,
  Layers,
  Tent,
  Ticket,
  Utensils,
  Waves,
  type LucideIcon,
} from "lucide-react";

/**
 * Sistem logo/ikon terpusat CheckingUploadFile (hanya UI, tidak menyentuh logika parser).
 *
 * - `asset` = nama file logo di src/assets/logos (tanpa ekstensi). Dideteksi saat build,
 *   jadi tidak ada request 404 kalau filenya belum ada.
 * - Kalau logo tidak ada / gagal dimuat -> `icon`, atau `monogram` bila tidak ada ikon.
 */
export type BrandSpec = {
  name: string;
  asset?: string;
  icon?: LucideIcon;
  monogram?: string;
  round?: boolean;
  /** Rasio lebar/tinggi kotak logo di kartu parser. Default 1.8 (seragam, supaya nama parser sejajar antar kartu; logo panjang tetap besar). */
  ratio?: number;
};

const logoFiles = import.meta.glob<string>("../assets/logos/*.{svg,png,webp,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
});

// Versi turunan (margin kosong dipangkas, latar dinormalkan) di assets/logos/optimized.
// File asli tidak diubah; kalau ada versi optimized dengan nama sama, itu yang dipakai.
const optimizedFiles = import.meta.glob<string>("../assets/logos/optimized/*.{svg,png,webp,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
});

function indexFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const base = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
    if (base) out[base] = url;
  }
  return out;
}

const logoIndex = indexFiles(logoFiles);
const optimizedIndex = indexFiles(optimizedFiles);

export function resolveLogo(asset?: string): string | undefined {
  if (!asset) return undefined;
  const key = asset.toLowerCase();
  return optimizedIndex[key] ?? logoIndex[key];
}

/** Ikon kategori (HOTEL/RESTO pada THE OMALA, dan label kategori UPL lain). Key = label kategori persis (uppercase). */
export const CATEGORY_BRANDS: Record<string, BrandSpec> = {
  HOTEL: { name: "HOTEL", asset: "cat-hotel", icon: Hotel },
  RESTO: { name: "RESTO", asset: "cat-resto", icon: Utensils },
  "RESTO PREGO": { name: "RESTO PREGO", asset: "cat-prego", icon: Utensils },
  KFOOD: { name: "KFOOD", asset: "cat-kfood", icon: Drumstick },
  "C&C": { name: "C&C", asset: "cat-cc", icon: CupSoda },
  PARKIR: { name: "PARKIR", asset: "cat-parkir", icon: Car },
  "MESIN CAPIT": { name: "MESIN CAPIT", asset: "cat-capit", icon: Gamepad2 },
  "KLAND HIBURAN": { name: "KLAND HIBURAN", asset: "cat-hiburan", icon: Ticket },
  HIBURAN: { name: "HIBURAN", asset: "cat-hiburan", icon: Ticket },
  "WATER SLIDE": { name: "WATER SLIDE", asset: "cat-waterslide", icon: Waves },
  GLAMPING: { name: "GLAMPING", asset: "cat-glamping", icon: Tent },
};

/** Pencocokan persis (bukan "contains") supaya kategori tidak salah ikon. */
export function categoryBrand(label: string): BrandSpec {
  return CATEGORY_BRANDS[label.trim().toUpperCase()] ?? { name: label, icon: Layers };
}
