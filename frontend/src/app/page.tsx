import HeroButtons from "@/components/landing/HeroButtons";

export default function Home() {
  return (
    <>
      {/* Sfondo fisso pianeta — sempre visibile */}
      <div
        className="home-hero-bg bg-no-repeat"
        style={{ backgroundImage: "url('/HOMEROG-URANUS.png')" }}
      />

      {/* ====== HERO ====== */}
      <section className="relative min-h-screen flex items-center justify-center bg-transparent pt-12 pb-20">
        {/* Overlay gradient for text readability */}
        <div className="fixed inset-0 bg-gradient-to-r from-[#020711]/70 via-[#020711]/20 to-[#020711]/45 pointer-events-none" />
        <div className="fixed inset-0 bg-radial-[ellipse_at_center] from-transparent via-transparent to-[#020711]/75 pointer-events-none" />

        {/* Content */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <HeroButtons />
        </div>
      </section>
    </>
  );
}
