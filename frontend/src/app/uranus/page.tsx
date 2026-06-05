import Link from "next/link";
import StarField from "@/components/effects/StarField";

export default function UranusPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden pt-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#030812] via-[#050a18] to-[#0a1628]" />
        <StarField count={80} />
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <p className="text-sm tracking-[6px] text-uranus-cyan/60 uppercase mb-4">
            Chi siamo
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-[8px] text-white text-glow-cyan mb-6">
            ROG-URANUS
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Un movimento per ridefinire il rapporto tra le persone e
            l&apos;economia, nato dall&apos;ecosistema Revolution of Giving.
          </p>
        </div>
      </section>

      {/* Philosophy */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="glass-card p-10 md:p-14">
            <h2 className="text-2xl font-bold tracking-[3px] text-white mb-8">
              LA NOSTRA FILOSOFIA
            </h2>
            <div className="space-y-6 text-white/60 leading-relaxed">
              <p>
                ROG-URANUS prende il nome dal settimo pianeta del sistema solare — un
                mondo distante, misterioso e rivoluzionario. Come il pianeta che
                ruota su un asse completamente diverso dagli altri, ROG-URANUS
                rappresenta un cambio di paradigma nell&apos;economia.
              </p>
              <p>
                Crediamo che la tecnologia blockchain e la governance
                decentralizzata possano creare un sistema economico più equo,
                dove il valore viene generato e distribuito dalla comunità
                stessa, non concentrato nelle mani di pochi.
              </p>
              <p>
                Ogni decisione in ROG-URANUS passa attraverso la DAO: nessun
                singolo individuo ha il controllo. Il potere è della comunità.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ROG Connection */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold tracking-[4px] text-white text-center mb-12">
            IL LEGAME CON ROG
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card p-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-uranus-violet text-2xl">⚡</span>
                <h3 className="text-lg font-bold tracking-[2px] text-white">
                  Revolution of Giving
                </h3>
              </div>
              <p className="text-sm text-white/50 leading-relaxed">
                ROG è il movimento padre che ha gettato le basi per una nuova
                visione dell&apos;economia del dono. ROG-URANUS ne eredita i valori e
                li proietta nel futuro attraverso la tecnologia.
              </p>
            </div>
            <div className="glass-card p-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-uranus-cyan text-2xl">🪐</span>
                <h3 className="text-lg font-bold tracking-[2px] text-white">
                  ROG-URANUS
                </h3>
              </div>
              <p className="text-sm text-white/50 leading-relaxed">
                La piattaforma decentralizzata che porta l&apos;economia del dono
                nel Web3. Governance DAO, trasparenza on-chain e community-first.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-bold tracking-[4px] text-white mb-12">
            I NOSTRI VALORI
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { icon: "🔓", value: "Trasparenza" },
              { icon: "⚖️", value: "Equità" },
              { icon: "🌱", value: "Sostenibilità" },
              { icon: "🤝", value: "Collaborazione" },
            ].map((v) => (
              <div key={v.value} className="glass-card p-6 text-center">
                <span className="text-3xl mb-3 block">{v.icon}</span>
                <p className="text-sm font-bold tracking-[2px] text-white">
                  {v.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 text-center">
        <Link href="/register" className="btn-uranus">
          Unisciti a ROG-URANUS
        </Link>
      </section>
    </>
  );
}
