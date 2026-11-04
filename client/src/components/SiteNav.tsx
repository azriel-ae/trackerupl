import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { AppLogo } from "@/components/BrandLogo";
import "./Landing.css";

export type NavKey = "home" | "upl" | "about";

const NAV: Array<{ key: NavKey; href: string; label: string }> = [
  { key: "home", href: "/", label: "Beranda" },
  { key: "upl", href: "/pemeriksaan-upl", label: "Pemeriksaan UPL" },
  { key: "about", href: "/tentang", label: "Tentang" },
];

/** Navbar kapsul (pill) bersama untuk Beranda, Pemeriksaan UPL, dan Tentang. */
export default function SiteNav({ active }: { active: NavKey }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const go = (href: string) => { setMenuOpen(false); navigate(href); };

  return (
    <header className="lp-nav-wrap">
      <div className="lp-nav">
        <Link href="/" className="lp-nav-logo" aria-label="CheckingUploadFile — Beranda" onClick={() => setMenuOpen(false)}>
          <AppLogo height={28} />
        </Link>
        <nav className="lp-nav-links" aria-label="Menu utama">
          {NAV.map((item) => (
            <Link key={item.key} href={item.href} className={item.key === active ? "is-active" : undefined} aria-current={item.key === active ? "page" : undefined}>{item.label}</Link>
          ))}
        </nav>
        <button type="button" className="lp-nav-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "Tutup menu" : "Buka menu"} aria-expanded={menuOpen} aria-controls="lp-mobile-menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {menuOpen && (
        <nav id="lp-mobile-menu" className="lp-mobile-menu" aria-label="Menu utama">
          {NAV.map((item) => (
            <button key={item.key} type="button" className={item.key === active ? "is-active" : undefined} onClick={() => go(item.href)}>{item.label}<ArrowRight size={15} /></button>
          ))}
        </nav>
      )}
    </header>
  );
}
