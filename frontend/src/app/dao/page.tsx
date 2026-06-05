import Link from "next/link";
import StarField from "@/components/effects/StarField";

const steps = [
  {
    num: "01",
    title: "Connetti il Wallet",
    desc: "Collega il tuo wallet Polygon per accedere alla piattaforma di governance.",
  },
  {
    num: "02",
    title: "Ricevi i Token",
    desc: "Ottieni i token di governance partecipando all'ecosistema Uranus.",
  },
  {
    num: "03",
    title: "Vota le Proposte",
    desc: "Esprimi la tua opinione sulle proposte della community.",
  },
  {
    num: "04",
    title: "Crea Proposte",
    desc: "Presenta le tue idee alla community per il voto collettivo.",
  },
];

export default function DaoPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden pt-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#030812] via-[#050a18] to-[#0a1628]" />
        <StarField count={80} />
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <p className="text-sm tracking-[6px] text-uranus-cyan/60 uppercase mb-4">
            Governance decentralizzata
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-[8px] text-white text-glow-cyan mb-6">
            DAO
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Il potere decisionale appartiene alla comunità. Ogni membro ha voce
            in capitolo attraverso un sistema di governance trasparente su rete
            Polygon.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold tracking-[4px] text-white text-center mb-16">
            COME FUNZIONA
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {steps.map((s) => (
              <div key={s.num} className="glass-card p-8 flex gap-6">
                <span className="text-4xl font-bold text-uranus-cyan/30 shrink-0">
                  {s.num}
                </span>
                <div>
                  <h3 className="text-lg font-bold tracking-[2px] text-white mb-2">
                    {s.title}
                  </h3>
                  <p className="text-sm text-white/50 leading-relaxed">
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="glass-card p-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              {[
                { value: "—", label: "Proposte Attive" },
                { value: "—", label: "Membri DAO" },
                { value: "Polygon", label: "Rete" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="text-3xl font-bold text-uranus-cyan mb-2">
                    {stat.value}
                  </p>
                  <p className="text-sm text-white/40 tracking-[1px]">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 text-center">
        <Link href="/register" className="btn-uranus">
          Partecipa alla DAO
        </Link>
      </section>
    </>
  );
}
