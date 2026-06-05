"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface LogEntry {
  id: number;
  time: string;
  message: string;
  type: "" | "success" | "error";
}

interface LogContextValue {
  entries: LogEntry[];
  log: (msg: string, type?: LogEntry["type"]) => void;
  clear: () => void;
}

const LogContext = createContext<LogContextValue>({
  entries: [],
  log: () => {},
  clear: () => {},
});

let _id = 0;

export function LogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const log = useCallback((msg: string, type: LogEntry["type"] = "") => {
    const entry: LogEntry = {
      id: ++_id,
      time: new Date().toLocaleTimeString("it-IT"),
      message: msg,
      type,
    };
    setEntries((prev) => [entry, ...prev].slice(0, 100));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return (
    <LogContext.Provider value={{ entries, log, clear }}>
      {children}
    </LogContext.Provider>
  );
}

export function useLog() {
  return useContext(LogContext);
}

export default function LogPanel() {
  const { entries, clear } = useLog();

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider">Log</h3>
        <button
          onClick={clear}
          className="text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          Pulisci
        </button>
      </div>
      <div
        className="bg-[#0d1117] border border-[#1f2937] rounded-lg p-3 max-h-[200px] overflow-y-auto font-mono text-xs text-[#8b949e] dashboard-scroll"
      >
        {entries.length === 0 && (
          <span className="text-white/20">Nessun log...</span>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            className={
              e.type === "error"
                ? "text-red-400 py-0.5"
                : e.type === "success"
                ? "text-green-400 py-0.5"
                : "py-0.5"
            }
          >
            [{e.time}] {e.message}
          </div>
        ))}
      </div>
    </div>
  );
}
