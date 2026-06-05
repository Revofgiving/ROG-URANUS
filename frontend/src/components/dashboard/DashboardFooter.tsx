"use client";

const footerItems = [
  {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: "Sicurezza garantita",
    sub: "Smart Contract verificato",
  },
  {
    icon: (
      <svg className="w-4 h-4 text-uranus-violet" viewBox="0 0 38 33" fill="none">
        <path d="M29.5 10.2c-.7-.4-1.6-.4-2.4 0l-5.6 3.3-3.8 2.1-5.5 3.3c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-5c0-.8.4-1.6 1.2-2.1l4.3-2.5c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v3.3l3.8-2.2V7c0-.8-.4-1.6-1.2-2.1L14.6.5c-.7-.4-1.6-.4-2.4 0L5.8 5C5 5.4 4.6 6.2 4.6 7v9.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l5.5-3.2 3.8-2.2 5.5-3.2c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v5c0 .8-.4 1.6-1.2 2.1l-4.3 2.6c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-3.3l-3.8 2.2v3.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l6.5-3.8c.7-.4 1.2-1.2 1.2-2.1V14c0-.8-.4-1.6-1.2-2.1l-6.6-3.8z" fill="#7c3aed"/>
      </svg>
    ),
    title: "Blockchain Polygon",
    sub: "Transazioni trasparenti",
  },
  {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
    title: "Supporto attivo",
    sub: "Canale Telegram",
  },
];

export default function DashboardFooter() {
  return (
    <footer className="border-t border-white/[0.05] px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-8">
        {footerItems.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-white/20">{item.icon}</span>
            <div>
              <p className="text-[10px] font-bold text-white/40">{item.title}</p>
              <p className="text-[9px] text-white/20">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-uranus-cyan/30" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
        <p className="text-[10px] text-white/20">
          Sistema di Economia del Dono Circolare
        </p>
        <span className="text-[10px] text-white/15 ml-2">
          © URANUS {new Date().getFullYear()} — Tutti i diritti riservati
        </span>
      </div>
    </footer>
  );
}
