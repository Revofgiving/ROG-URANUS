import Link from "next/link";

export default function Footer() {
  return (
    <footer className="relative border-t border-uranus-border bg-uranus-deep/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Brand */}
          <div>
            <h3 className="text-lg font-bold tracking-[3px] text-white mb-3">
              ROG-URANUS
            </h3>
            <p className="text-sm text-white/50 leading-relaxed">
              Oltre l&apos;economia tradizionale
              <br />
              ECOSÌNOSTRA!
              <br />
              Un movimento per il futuro decentralizzato.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-sm font-semibold tracking-[2px] text-uranus-cyan mb-4">
              NAVIGAZIONE
            </h4>
            <div className="flex flex-col gap-2">
              {[
                { href: "/ecosistema", label: "Ecosistema" },
                { href: "/dao", label: "DAO" },
                { href: "/progetti", label: "Progetti" },
                { href: "/uranus", label: "ROG-URANUS" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-white/50 hover:text-white transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Powered by ROG */}
          <div className="flex flex-col items-start md:items-end justify-between">
            <div>
              <h4 className="text-sm font-semibold tracking-[2px] text-uranus-cyan mb-4 md:text-right">
                ECOSISTEMA
              </h4>
              <p className="text-sm text-white/50 md:text-right">
                ROG-URANUS è parte dell&apos;ecosistema
              </p>
            </div>
            <a
              href="https://revolutionofgiving.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-uranus-violet/40 text-uranus-violet text-sm font-semibold hover:bg-uranus-violet/10 hover:border-uranus-violet transition-all"
            >
              <span className="text-xs">⚡</span>
              Powered by ROG
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t border-uranus-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/30">
            © {new Date().getFullYear()} ROG-URANUS — Revolution of Giving
          </p>
          <div className="flex gap-6">
            <Link
              href="/login"
              className="text-xs text-white/30 hover:text-uranus-cyan transition-colors"
            >
              Area Membri
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
