import { useState, type CSSProperties } from "react";
import { resolveLogo, type BrandSpec } from "@/lib/parserBrands";

/** Logo resmi bila ada, otherwise ikon/monogram. Tidak pernah menampilkan gambar rusak. */
export function BrandLogo({ spec, size = 44, wide, parser }: { spec: BrandSpec; size?: number; wide?: boolean; /** Kartu parser: ukuran diatur CSS (64px desktop, 56px mobile), lebar mengikuti spec.ratio. */ parser?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = resolveLogo(spec.asset);
  const Icon = spec.icon;
  const cls = `brand-logo${spec.round ? " is-round" : ""}${parser ? " is-parser" : ""}`;
  const style = (parser
    ? { "--logo-r": spec.ratio ?? 1.8 }
    : { width: wide ? Math.round(size * 1.3) : size, height: size, "--logo-h": `${size}px` }) as unknown as CSSProperties;
  return (
    <span className={cls} style={style} aria-hidden="true">
      {url && !failed ? (
        <img src={url} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />
      ) : Icon ? (
        <Icon size={parser ? 30 : Math.round(size * 0.5)} strokeWidth={1.8} />
      ) : (
        <span className="brand-monogram" style={{ fontSize: parser ? 28 : size * 0.44 }}>{spec.monogram ?? spec.name.charAt(0)}</span>
      )}
    </span>
  );
}

const BRAND_BLUE = "var(--nx-logo-blue, #2563EB)";

function LogoSymbol() {
  return (
    <>
      <rect width="96" height="96" rx="24" fill={BRAND_BLUE} />
      {/* dokumen dengan sudut terlipat + tanda centang = "file yang diperiksa" */}
      <path fill="#fff" d="M30 20h23l15 15v39a5 5 0 0 1-5 5H30a5 5 0 0 1-5-5V25a5 5 0 0 1 5-5z" />
      <path fill="#bfdbfe" d="M53 20v10a5 5 0 0 0 5 5h10z" />
      <path fill="none" stroke={BRAND_BLUE} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" d="M36 56l8 8 16-18" />
    </>
  );
}

/** Simbol CheckingUploadFile saja (area kecil / favicon): kotak biru + dokumen bercentang. */
export function AppMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg className={`nx-mark${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 96 96" role="img" aria-label="CheckingUploadFile">
      <LogoSymbol />
    </svg>
  );
}

/** Logo horizontal CheckingUploadFile: simbol + wordmark teks. `height` = tinggi simbol dalam px (ukuran lain mengikuti lewat variabel CSS --h). */
export function AppLogo({ height = 40, className }: { height?: number; className?: string }) {
  return (
    <span className={`app-logo${className ? ` ${className}` : ""}`} role="img" aria-label="CheckingUploadFile" style={{ "--h": `${height}px` } as CSSProperties}>
      <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><LogoSymbol /></svg>
      <span className="app-logo-word" aria-hidden="true">Checking<b>UploadFile</b></span>
    </span>
  );
}

/** Branding sidebar halaman pemeriksaan: logo penuh saat lebar, ikon saja saat sidebar ciut (diatur CSS). */
export function SidebarBrand() {
  return (
    <div className="brand-lockup">
      <AppLogo className="brand-full" height={30} />
      <AppMark className="brand-icon" size={34} />
    </div>
  );
}
