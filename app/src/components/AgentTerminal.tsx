import { useEffect, useRef, useState } from 'react';
import { Terminal, Cpu, Zap, ShieldAlert, RefreshCw, Circle } from 'lucide-react';

interface AgentLogEntry {
  id: string;
  tag: 'LOAN' | 'VAULT' | 'REPAY' | 'ALERT' | 'SYSTEM';
  message: string;
  detail?: string;
  amount?: number;
  transactionId?: string;
  timestamp: string;
}

const TAG_STYLES: Record<AgentLogEntry['tag'], { color: string; bg: string; icon: React.ReactNode }> = {
  LOAN: { color: '#34d399', bg: 'rgba(52,211,153,0.15)', icon: <Zap size={10} /> },
  VAULT: { color: '#60a5fa', bg: 'rgba(96,165,250,0.15)', icon: <RefreshCw size={10} /> },
  REPAY: { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', icon: <Circle size={10} /> },
  ALERT: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', icon: <ShieldAlert size={10} /> },
  SYSTEM: { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', icon: <Cpu size={10} /> },
};

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function AgentTerminal({ entries }: { entries: AgentLogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  // Animate entries appearing one by one on mount
  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setVisibleCount(i);
      if (i >= entries.length) clearInterval(timer);
    }, 80);
    return () => clearInterval(timer);
  }, [entries.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries]);

  return (
    <div
      className="rounded-2xl overflow-hidden border"
      style={{
        background: '#0d1117',
        borderColor: 'rgba(52,211,153,0.2)',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      }}
    >
      {/* Terminal header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ borderColor: 'rgba(52,211,153,0.15)', background: '#161b22' }}
      >
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#febc2e' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#28ca41' }} />
        </div>
        <div className="flex items-center gap-2 flex-1">
          <Terminal size={12} style={{ color: '#34d399' }} />
          <span className="text-xs font-bold" style={{ color: '#34d399' }}>
            saheli-agent · autonomous loop
          </span>
        </div>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: '#34d399' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          LIVE
        </span>
      </div>

      {/* Boot line */}
      <div className="px-4 py-2 text-[10px]" style={{ color: '#4b5563', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
        $ agent start --mode=autonomous --network=production
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="p-4 space-y-3 overflow-y-auto"
        style={{ maxHeight: '320px', scrollbarWidth: 'none' }}
      >
        {entries.slice(0, visibleCount).map((entry, idx) => {
          const style = TAG_STYLES[entry.tag] || TAG_STYLES.SYSTEM;
          return (
            <div
              key={entry.id}
              className="flex gap-3 group"
              style={{
                opacity: 1,
                animation: 'fadeSlideIn 0.3s ease-out',
                animationDelay: `${idx * 0.05}s`,
              }}
            >
              {/* Timestamp */}
              <span
                className="text-[9px] pt-0.5 flex-shrink-0 w-14 text-right"
                style={{ color: '#374151' }}
              >
                {timeAgo(entry.timestamp)}
              </span>

              {/* Tag */}
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 flex items-center gap-1 h-fit"
                style={{ color: style.color, background: style.bg }}
              >
                {style.icon}
                {entry.tag}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] leading-tight" style={{ color: '#e2e8f0' }}>
                  {entry.message}
                </p>
                {entry.detail && (
                  <p className="text-[10px] mt-0.5 leading-tight" style={{ color: '#94a3b8' }}>
                    {entry.detail}
                  </p>
                )}
                {entry.transactionId && (
                  <p className="text-[9px] mt-0.5 font-mono" style={{ color: '#60a5fa' }}>
                    id: {entry.transactionId.slice(0, 24)}...
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {entries.length === 0 && (
          <div className="py-8 text-center text-xs" style={{ color: '#374151' }}>
            Waiting for agent activity...
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
