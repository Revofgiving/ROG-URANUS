"use client";

interface WalletPanelProps {
  wallet: string;
  px?: number;
  py?: number;
  titleMb?: number;
}

export default function WalletPanel({ wallet, px = 20, py = 20, titleMb = 16 }: WalletPanelProps) {
  const short = wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "—";

  const wallets = [
    {
      label: "WALLET #1",
      badge: "DONATORE",
      badgeColor: "bg-uranus-teal/20 text-uranus-teal border-uranus-teal/30",
      address: short,
      balance: "10,00",
    },
    {
      label: "WALLET #2",
      badge: "PLUTONE (4/6)",
      badgeColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      address: "0x12cd...4E8f",
      balance: "10,00",
    },
  ];

  return (
    <div className="glass-card" style={{ padding: `${py}px ${px}px` }}>
      <h3
        className="text-sm font-bold tracking-[2px] text-white uppercase"
        style={{ marginBottom: `${titleMb}px` }}
      >
        I Tuoi Wallet
      </h3>

      <div className="space-y-3">
        {wallets.map((w, i) => (
          <div
            key={i}
            className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-white/50 tracking-[1px]">
                {w.label}
              </span>
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${w.badgeColor}`}
              >
                {w.badge}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-mono text-white/60">{w.address}</span>
              <button className="text-white/20 hover:text-white/50 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-white">
                {w.balance} <span className="text-xs text-white/40">USDC</span>
              </span>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-uranus-violet" viewBox="0 0 38 33" fill="none">
                  <path d="M29.5 10.2c-.7-.4-1.6-.4-2.4 0l-5.6 3.3-3.8 2.1-5.5 3.3c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-5c0-.8.4-1.6 1.2-2.1l4.3-2.5c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v3.3l3.8-2.2V7c0-.8-.4-1.6-1.2-2.1L14.6.5c-.7-.4-1.6-.4-2.4 0L5.8 5C5 5.4 4.6 6.2 4.6 7v9.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l5.5-3.2 3.8-2.2 5.5-3.2c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v5c0 .8-.4 1.6-1.2 2.1l-4.3 2.6c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-3.3l-3.8 2.2v3.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l6.5-3.8c.7-.4 1.2-1.2 1.2-2.1V14c0-.8-.4-1.6-1.2-2.1l-6.6-3.8z" fill="#7c3aed"/>
                </svg>
                <span className="text-[10px] text-white/40">Polygon</span>
                <div className="w-2 h-2 rounded-full bg-uranus-teal" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full mt-3 py-2.5 rounded-xl border border-dashed border-white/15 text-xs text-white/40 hover:text-white/70 hover:border-white/30 transition-all">
        + Aggiungi / Cambia Wallet
      </button>
    </div>
  );
}
