import StarField from "@/components/effects/StarField";

const servizi = [
  {
    icon: "🏛️",
    title: "Governance DAO",
    desc: "Partecipa alle decisioni attraverso il sistema di voto decentralizzato su Polygon.",
  },
  {
    icon: "💱",
    title: "Economia Circolare",
    desc: "Un modello economico sostenibile che redistribuisce valore all'intera comunità.",
  },
  {
    icon: "🎓",
    title: "Formazione",
    desc: "Percorsi educativi su blockchain, DeFi e partecipazione decentralizzata.",
  },
  {
    icon: "🤲",
    title: "Donazioni Trasparenti",
    desc: "Ogni transazione è verificabile on-chain. Totale trasparenza sui fondi.",
  },
  {
    icon: "🔗",
    title: "Integrazione ROG",
    desc: "Collegamento diretto con l'ecosistema Revolution of Giving.",
  },
  {
    icon: "🌍",
    title: "Impatto Globale",
    desc: "Progetti concreti che generano cambiamento reale nelle comunità.",
  },
];

export default function EcosistemaPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden pt-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#030812] via-[#050a18] to-[#0a1628]" />
        <StarField count={80} />
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <p className="text-sm tracking-[6px] text-uranus-cyan/60 uppercase mb-4">
            Il nostro mondo
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-[8px] text-white text-glow-cyan mb-6">
            ECOSISTEMA
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Un universo di servizi e opportunità interconnessi, alimentato dalla
            comunità e governato dalla trasparenza.
          </p>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {servizi.map((s) => (
              <div key={s.title} className="glass-card p-8">
                <span className="text-4xl mb-4 block">{s.icon}</span>
                <h3 className="text-lg font-bold tracking-[2px] text-white mb-3">
                  {s.title}
                </h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold tracking-[4px] text-white mb-8">
            ARCHITETTURA
          </h2>
          <div className="glass-card p-10">
            <div className="flex flex-col md:flex-row items-center justify-center gap-8">
              {[
                { label: "ROG", sub: "Movimento Padre" },
                { label: "→", sub: "" },
                { label: "URANUS", sub: "Piattaforma" },
                { label: "→", sub: "" },
                { label: "DAO", sub: "Governance" },
              ].map((item, i) => (
                <div key={i} className="text-center">
                  <p
                    className={`text-2xl font-bold tracking-[3px] ${
                      item.label === "→"
                        ? "text-uranus-cyan/40"
                        : "text-uranus-cyan"
                    }`}
                  >
                    {item.label}
                  </p>
                  {item.sub && (
                    <p className="text-xs text-white/40 mt-1 tracking-[1px]">
                      {item.sub}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
