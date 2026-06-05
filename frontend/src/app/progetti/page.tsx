import StarField from "@/components/effects/StarField";

const progetti = [
  {
    title: "Piattaforma DAO",
    status: "In sviluppo",
    desc: "Sistema di governance decentralizzata su rete Polygon per le decisioni comunitarie.",
    tags: ["Blockchain", "Governance", "Polygon"],
  },
  {
    title: "Economia Circolare",
    status: "Progettazione",
    desc: "Modello economico che redistribuisce valore ai partecipanti dell'ecosistema.",
    tags: ["Economia", "Community", "Token"],
  },
  {
    title: "Hub Formativo",
    status: "Progettazione",
    desc: "Piattaforma educativa su blockchain, DeFi e partecipazione decentralizzata.",
    tags: ["Educazione", "Web3", "DeFi"],
  },
  {
    title: "Bridge ROG-Uranus",
    status: "Pianificato",
    desc: "Integrazione tra l'ecosistema ROG e la piattaforma Uranus.",
    tags: ["Integrazione", "ROG", "Cross-platform"],
  },
];

const statusColor: Record<string, string> = {
  "In sviluppo": "text-uranus-teal border-uranus-teal/30",
  Progettazione: "text-uranus-cyan border-uranus-cyan/30",
  Pianificato: "text-uranus-violet border-uranus-violet/30",
};

export default function ProgettiPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden pt-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#030812] via-[#050a18] to-[#0a1628]" />
        <StarField count={80} />
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <p className="text-sm tracking-[6px] text-uranus-cyan/60 uppercase mb-4">
            Cosa stiamo costruendo
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-[8px] text-white text-glow-cyan mb-6">
            PROGETTI
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Iniziative concrete per costruire il futuro dell&apos;economia
            decentralizzata.
          </p>
        </div>
      </section>

      {/* Projects */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col gap-6">
            {progetti.map((p) => (
              <div key={p.title} className="glass-card p-8">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                  <h3 className="text-xl font-bold tracking-[2px] text-white">
                    {p.title}
                  </h3>
                  <span
                    className={`text-xs font-semibold tracking-[1px] px-3 py-1 rounded-full border ${
                      statusColor[p.status] || "text-white/50 border-white/20"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                <p className="text-sm text-white/50 leading-relaxed mb-4">
                  {p.desc}
                </p>
                <div className="flex flex-wrap gap-2">
                  {p.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs text-white/30 bg-white/5 px-3 py-1 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
