import { useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { AppLogo } from "@/components/BrandLogo";
import SiteNav from "@/components/SiteNav";
import { resolveLogo } from "@/lib/parserBrands";
import { UPL_MODES, uplPath } from "@/lib/uplModes";
import "./Landing.css";

/**
 * Beranda CheckingUploadFile (hanya UI). Desain hero mengikuti beranda NSTAX lama:
 * navbar kapsul, logo besar di tengah, orbit melingkar, dan logo perusahaan yang melayang.
 * Tidak menyentuh parser, rumus, atau aturan pemeriksaan UPL.
 */

/**
 * Logo melayang (dekoratif, tidak bisa diklik). `dx`/`y` = posisi pusat logo terhadap pusat hero (px, ukuran desktop lebar);
 * `small` = posisi di layar kecil (persen). Isinya hanya logo enam mode Pemeriksaan UPL (sama dengan UPL_MODES di lib/uplModes.ts).
 */
type Fit = "round" | "crop";
/**
 * Ukuran visual tiap logo di dalam lingkaran putih, dalam persen diameter lingkaran: `box` = [lebar, tinggi].
 * Gambar ditampilkan dengan object-fit: contain (tidak dipotong, rasio asli terjaga) di dalam kotak ini.
 * Kotak dihitung dari rasio aspek file yang dipakai (assets/logos, versi optimized bila ada) supaya sudutnya tetap
 * di dalam lingkaran dengan jarak aman: logo persegi/kotak ~57%, logo lonjong 64-88% lebar, logo bulat 86%.
 * Tidak ada logo yang diperbesar melebihi ukuran piksel aslinya (lingkaran 68px; file terkecil 256px).
 */
const FLOATING: Array<{ label: string; asset: string; box: [number, number]; dx: number; y: number; delay: number; small?: { x: number; y: number } }> = [
  { label: "KLAND", asset: "kland", box: [80, 43], dx: -323, y: 147, delay: 0, small: { x: 14, y: 40 } },
  { label: "INNA TRETES", asset: "innatretes", box: [82, 40], dx: -462, y: 255, delay: 1.2 },
  { label: "OMAH PADHANG", asset: "omahpadhang", box: [60, 63], dx: -288, y: 471, delay: 0.6, small: { x: 18, y: 0 } },
  { label: "ROYAL SENYIUR", asset: "royalsenyiur", box: [64, 57], dx: 336, y: 144, delay: 1.8, small: { x: 86, y: 40 } },
  { label: "HOTEL PLATARAN", asset: "plataran", box: [58, 58], dx: 481, y: 259, delay: 0.3 },
  { label: "THE OMALA", asset: "omala", box: [50, 63], dx: 289, y: 473, delay: 1.5, small: { x: 82, y: 0 } },
];

function Logo({ asset, label, fit, box }: { asset: string; label: string; fit?: Fit; box?: [number, number] }) {
  const [failed, setFailed] = useState(false);
  const url = resolveLogo(asset);
  if (!url || failed) return <span className="lp-logo-fallback">{label.charAt(0)}</span>;
  const style = box ? ({ "--lw": box[0], "--lh": box[1] } as unknown as CSSProperties) : undefined;
  return <img className={fit ? `is-${fit}` : undefined} style={style} src={url} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

function Orbit() {
  // Orbit tipis di belakang konten (SVG ringan). Aksen biru hanya pada sebagian busur.
  return (
    <div className="lp-orbit" aria-hidden="true">
      <svg viewBox="-600 -600 1200 1200" focusable="false">
        <defs>
          <linearGradient id="lp-blue" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6aa2ff" stopOpacity=".95" />
            <stop offset="1" stopColor="#6aa2ff" stopOpacity=".15" />
          </linearGradient>
        </defs>
        <circle r="336" fill="none" stroke="#e6ebf3" strokeWidth="1.2" />
        <circle r="440" fill="none" stroke="#edf0f6" strokeWidth="1.2" />
        <circle r="577" fill="none" stroke="#f1f3f8" strokeWidth="1.2" />
        <circle r="336" fill="none" stroke="url(#lp-blue)" strokeWidth="1.3" pathLength="100" strokeDasharray="22 78" transform="rotate(95)" />
        <circle r="440" fill="none" stroke="url(#lp-blue)" strokeWidth="1.2" pathLength="100" strokeDasharray="16 84" transform="rotate(-20)" />
        <circle r="577" fill="none" stroke="url(#lp-blue)" strokeWidth="1.1" pathLength="100" strokeDasharray="14 86" transform="rotate(150)" />
        <circle cx="-336" cy="-6" r="2.6" fill="#4f8df7" />
        <circle cx="338" cy="12" r="2.6" fill="#4f8df7" />
        <circle cx="-440" cy="-110" r="2.2" fill="#4f8df7" />
        <circle cx="577" cy="-62" r="2.2" fill="#4f8df7" />
        <circle cx="520" cy="250" r="2.2" fill="#4f8df7" />
        <circle cx="-262" cy="-212" r="2.2" fill="#4f8df7" />
      </svg>
    </div>
  );
}

export default function Landing() {
  const [, navigate] = useLocation();

  return (
    <div className="lp-root">
      <div className="lp-card">
        <SiteNav active="home" />

        <section className="lp-hero" aria-labelledby="lp-title">
          <Orbit />
          {FLOATING.filter((item) => resolveLogo(item.asset)).map((item) => (
            <div
              key={item.label}
              className={`lp-float${item.small ? " is-small" : ""}${item.small?.y === 0 ? " is-bottom" : ""}`}
              style={{ "--dx": item.dx, "--y": item.y, "--sx": item.small?.x, "--sy": item.small?.y, "--delay": `${item.delay}s` } as unknown as CSSProperties}
              aria-hidden="true"
            >
              <div className="lp-float-btn" title={item.label}>
                <Logo asset={item.asset} label={item.label} box={item.box} />
              </div>
            </div>
          ))}
          <div className="lp-hero-content">
            <AppLogo className="lp-hero-logo" height={64} />
            <span className="lp-tagline">Document &amp; Transaction Checking System</span>
            <h1 id="lp-title">Pengecekan Transaksi UPL Lebih Cepat dan Akurat</h1>
                        <div className="lp-cta">
              <button type="button" className="lp-btn lp-btn-primary" onClick={() => navigate(uplPath())}>Mulai Pengecekan <ArrowRight size={15} /></button>
            </div>
          </div>
        </section>

        <section className="lp-sources" aria-label="Mode pemeriksaan UPL yang tersedia">
          <div className="lp-sources-label"><span>Mode tersedia</span></div>
          <ul>
            {UPL_MODES.map((mode) => (
              <li key={mode.slug}>
                <Link href={uplPath(mode.slug)} aria-label={`Buka ${mode.name}`} title={mode.name}><Logo asset={mode.asset} label={mode.name} fit={mode.fit} /></Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
