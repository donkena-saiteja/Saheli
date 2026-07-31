import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApiPolling } from '../hooks/useApi';
import { algorandApi } from '../lib/api';

/**
 * Tells the truth about settlement, prominently.
 *
 * When the relayer is unfunded the backend anchors ledger entries locally and
 * mints a well-formed transaction id that exists nowhere on chain — which is
 * exactly why those ids cannot be found on the Lora explorer. Rather than hide
 * that, this banner states it and gives the one-step fix: fund the relayer
 * address at the TestNet dispenser.
 */
export default function ChainStatusBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data: info } = useApiPolling(() => algorandApi.getInfo(), 30000);

  if (!info || dismissed) return null;

  const live = info.mode === 'live';
  const relayer = info.relayer?.address as string | undefined;

  const copyRelayer = async () => {
    if (!relayer) return;
    try {
      await navigator.clipboard.writeText(relayer);
      toast.success('Relayer address copied — paste it into the dispenser');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  if (live) {
    return (
      <div className="mx-6 lg:mx-10 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex flex-wrap items-center gap-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        <p className="text-sm text-emerald-900 flex-1 min-w-0">
          <span className="font-bold">Live settlement on Algorand {info.network}.</span> Round{' '}
          {info.lastRound?.toLocaleString?.() ?? info.lastRound} · relayer holds {info.relayer?.balanceAlgos} ALGO.
          Every transaction id below opens on the explorer.
        </p>
        <button onClick={() => setDismissed(true)} className="text-emerald-700 hover:text-emerald-900">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-6 lg:mx-10 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-900">
            Simulated settlement — these transaction ids will not be found on Lora
          </p>
          <p className="text-sm text-amber-800 mt-1">
            The relayer holds {info.relayer?.balanceAlgos ?? 0} ALGO, so ledger entries are anchored locally instead of
            broadcast. Fund the relayer below and every new transaction settles on TestNet for real — no restart, no
            config change, no deployment needed.
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={copyRelayer}
              className="inline-flex items-center gap-1.5 bg-white border border-amber-300 rounded-lg px-3 py-1.5 text-[11px] font-mono text-amber-900 hover:bg-amber-100 max-w-full"
            >
              <span className="truncate">{relayer}</span>
              <Copy className="w-3 h-3 flex-shrink-0" />
            </button>
            <a
              href={info.relayer?.dispenser || 'https://bank.testnet.algorand.network'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-amber-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold hover:opacity-90"
            >
              Open TestNet Dispenser
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={info.relayer?.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 hover:underline"
            >
              View relayer on Lora
            </a>
          </div>

          <p className="text-[11px] text-amber-700 mt-2">
            Alternatively, any &ldquo;Pay from Pera Wallet&rdquo; action settles on TestNet immediately using your own
            funded wallet, regardless of the relayer.
          </p>
        </div>

        <button onClick={() => setDismissed(true)} className="text-amber-700 hover:text-amber-900 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
