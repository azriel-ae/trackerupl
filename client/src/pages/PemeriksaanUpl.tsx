import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { BrandLogo } from "@/components/BrandLogo";
import SiteNav from "@/components/SiteNav";
import { categoryBrand, resolveLogo } from "@/lib/parserBrands";
import { UPL_BASE, UPL_MODES, uplPath, type UplModeInfo } from "@/lib/uplModes";
import UplChecker from "@/pages/UplChecker";
import OmalaChecker from "@/pages/OmalaChecker";
import OmahPadhangChecker from "@/pages/OmahPadhangChecker";
import InnaTretesChecker from "@/pages/InnaTretesChecker";
import RoyalSenyiurChecker from "@/pages/RoyalSenyiurChecker";
import HotelPlataranChecker from "@/pages/HotelPlataranChecker";
import KedaiHutanCempakaChecker from "@/pages/KedaiHutanCempakaChecker";
import HotelSuryaTretesChecker from "@/pages/HotelSuryaTretesChecker";
import "@/components/Landing.css";
import "./Site.css";

/**
 * Halaman Pemeriksaan UPL: pilih mode -> upload file -> Mulai Pengecekan -> lihat hasil.
 * Setiap mode memakai checker UPL V1 yang sama persis seperti sebelumnya (parser, rumus, dan validasi tidak diubah);
 * halaman ini hanya mengatur tampilan pemilihan mode dan routing.
 */


function ModeLogo({ mode }: { mode: UplModeInfo }) {
  const [failed, setFailed] = useState(false);
  const url = resolveLogo(mode.asset);
  if (!url || failed) return <span className="up-logo-fallback">{mode.name.charAt(0)}</span>;
  return <img src={url} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

function Shell({ trail, children }: { trail: Array<{ label: string; href?: string }>; children: ReactNode }) {
  return (
    <div className="lp-root">
      <div className="lp-card up-card">
        <SiteNav active="upl" />
        <main className="up-main">
          <nav className="up-trail" aria-label="Breadcrumb">
            {trail.map((crumb, index) => (
              <span key={crumb.label} className="up-trail-item">
                {index > 0 && <ChevronRight size={12} />}
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <strong>{crumb.label}</strong>}
              </span>
            ))}
          </nav>
          {children}
        </main>
      </div>
    </div>
  );
}

function ModeHub() {
  return (
    <Shell trail={[{ label: "Beranda", href: "/" }, { label: "Pemeriksaan UPL" }]}>
      <header className="up-head">
        <h1>Pilih mode pemeriksaan</h1>
      </header>


      <nav className="up-modes" aria-label="Mode pemeriksaan UPL">
        {UPL_MODES.map((mode) => (
          <Link key={mode.slug} href={uplPath(mode.slug)} className="up-mode">
            <span className="up-mode-logo"><ModeLogo mode={mode} /></span>
            <span className="up-mode-body">
              <strong>{mode.name}</strong>
              <span className="up-mode-formats">{mode.formats.map((format) => <code key={format}>{format}</code>)}</span>
            </span>
            <span className="up-mode-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
          </Link>
        ))}
      </nav>
    </Shell>
  );
}

function OmalaCategoryHub() {
  const options: Array<{ slug: string; label: "HOTEL" | "RESTO"; text: string }> = [
    { slug: "hotel", label: "HOTEL", text: "Periksa file CSV transaksi hotel THE OMALA." },
    { slug: "resto", label: "RESTO", text: "Periksa file CSV transaksi resto THE OMALA." },
  ];
  return (
    <Shell trail={[{ label: "Beranda", href: "/" }, { label: "Pemeriksaan UPL", href: UPL_BASE }, { label: "THE OMALA" }]}>
      <header className="up-head">
        <h1>THE OMALA · Pilih kategori</h1>
      </header>
      <nav className="up-modes up-modes-2" aria-label="Kategori THE OMALA">
        {options.map((option) => (
          <Link key={option.slug} href={`${uplPath("the-omala")}/${option.slug}`} className="up-mode">
            <span className="up-mode-logo is-category"><BrandLogo spec={categoryBrand(option.label)} size={44} /></span>
            <span className="up-mode-body"><strong>{option.label}</strong><span className="up-mode-formats"><code>.csv</code></span></span>
            <span className="up-mode-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
          </Link>
        ))}
      </nav>
    </Shell>
  );
}

function UnknownMode() {
  return (
    <Shell trail={[{ label: "Beranda", href: "/" }, { label: "Pemeriksaan UPL", href: UPL_BASE }, { label: "Mode tidak ditemukan" }]}>
      <header className="up-head">
        <h1>Mode tidak ditemukan</h1>
        <p>Mode pemeriksaan yang diminta tidak tersedia. Silakan pilih dari daftar mode UPL.</p>
        <Link href={UPL_BASE} className="lp-btn lp-btn-primary up-back">Kembali ke Pemeriksaan UPL</Link>
      </header>
    </Shell>
  );
}

/** Menangani /pemeriksaan-upl dan semua sub-rutenya. */
export default function PemeriksaanUpl() {
  const [location, navigate] = useLocation();
  const parts = location.replace(/^\/pemeriksaan-upl\/?/, "").split("/").filter(Boolean);
  const [mode, sub] = parts;
  const hub = () => navigate(UPL_BASE);
  const omalaMenu = () => navigate(uplPath("the-omala"));

  useEffect(() => { window.scrollTo({ top: 0 }); }, [location]);

  if (!mode) return <ModeHub />;
  if (parts.length > 1 && mode !== "the-omala") return <UnknownMode />;
  switch (mode) {
    case "kland": return <UplChecker onBack={hub} />;
    case "the-omala":
      if (!sub) return <OmalaCategoryHub />;
      if (parts.length === 2 && sub === "hotel") return <OmalaChecker category="HOTEL" onBack={omalaMenu} />;
      if (parts.length === 2 && sub === "resto") return <OmalaChecker category="RESTO" onBack={omalaMenu} />;
      return <UnknownMode />;
    case "omah-padhang": return <OmahPadhangChecker onBack={hub} />;
    case "inna-tretes": return <InnaTretesChecker onBack={hub} />;
    case "royal-senyiur": return <RoyalSenyiurChecker onBack={hub} />;
    case "hotel-plataran": return <HotelPlataranChecker onBack={hub} />;
    case "kedai-hutan-cempaka": return <KedaiHutanCempakaChecker onBack={hub} />;
    case "hotel-surya-tretes": return <HotelSuryaTretesChecker onBack={hub} />;
    default: return <UnknownMode />;
  }
}
