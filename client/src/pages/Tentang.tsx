import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import SiteNav from "@/components/SiteNav";
import { UPL_MODES, uplPath } from "@/lib/uplModes";
import "@/components/Landing.css";
import "./Site.css";

export default function Tentang() {
  return (
    <div className="lp-root">
      <div className="lp-card up-card">
        <SiteNav active="about" />
        <main className="up-main">
          <header className="up-head">
            <h1>CheckingUploadFile</h1>
          </header>

          <section className="up-about-modes" aria-labelledby="up-about-modes-title">
            <h2 id="up-about-modes-title">Mode dan format file</h2>
            <div className="up-table-wrap">
              <table>
                <thead><tr><th>Mode</th><th>Format file</th></tr></thead>
                <tbody>
                  {UPL_MODES.map((mode) => (
                    <tr key={mode.slug}>
                      <td><Link href={uplPath(mode.slug)}>{mode.name}</Link></td>
                      <td>{mode.formats.map((format) => <code key={format}>{format}</code>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="up-about-cta">
            <Link href="/pemeriksaan-upl" className="lp-btn lp-btn-primary">Mulai Pengecekan <ArrowRight size={15} /></Link>
          </div>
        </main>
      </div>
    </div>
  );
}
