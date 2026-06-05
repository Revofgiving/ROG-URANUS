import Link from "next/link";
import Image from "next/image";

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-3">
        <Link href="/" className="flex min-w-0 flex-nowrap items-center gap-2 sm:gap-3">
          <Image
            src="/logo-uranus.png"
            alt="ROG-URANUS"
            width={36}
            height={36}
            className="shrink-0"
          />
          <span
            className="max-w-[52vw] truncate whitespace-nowrap text-base font-bold leading-none tracking-[1px] text-white sm:max-w-none sm:text-xl sm:tracking-[4px]"
            style={{ fontFamily: 'var(--font-unciale), fantasy, serif' }}
          >
            ROG-URANUS
          </span>
        </Link>

        <Link
          href="/"
          className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-white/60 transition-all hover:text-white sm:gap-2 sm:px-5 sm:py-2.5"
          style={{
            background: 'rgba(10, 22, 40, 0.4)',
            border: '1px solid rgba(34, 211, 238, 0.2)',
          }}
        >
          <span className="hidden text-lg sm:block">🏠</span>
          <span className="text-[10px] font-bold uppercase tracking-[2px] sm:text-sm">HOME</span>
        </Link>
      </div>
    </nav>
  );
}
