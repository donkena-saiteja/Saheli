import { ExternalLink } from 'lucide-react';

interface TxReferenceProps {
  transactionId?: string | null;
  /** True only when the transaction was actually broadcast and confirmed. */
  onChain?: boolean;
  explorerUrl?: string | null;
  /** Shown when there is no reference at all. */
  fallback?: string | null;
  className?: string;
}

/**
 * Renders a transaction reference honestly.
 *
 * A locally anchored id is a well-formed 52-character base32 string that was
 * never broadcast, so opening it on Lora returns "Transaction not found" and a
 * console 404. Making it look like a working link is both a bad experience and
 * a small lie, so only confirmed transactions get an anchor tag; the rest
 * render as plain text with an explanation of why they are not clickable.
 */
export default function TxReference({
  transactionId,
  onChain,
  explorerUrl,
  fallback,
  className = '',
}: TxReferenceProps) {
  if (!transactionId) {
    return <span className={`text-[11px] font-mono text-muted-foreground ${className}`}>{fallback || '—'}</span>;
  }

  if (onChain) {
    return (
      <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        <a
          href={explorerUrl || `https://lora.algokit.io/testnet/transaction/${transactionId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-mono text-shg-primary hover:underline break-all"
        >
          {transactionId}
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
          title="Broadcast and confirmed on Algorand — this link resolves on the explorer."
        >
          on-chain
        </span>
      </span>
    );
  }

  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span
        className="text-[11px] font-mono text-muted-foreground break-all"
        title="Anchored locally while the relayer was unfunded. This id was never broadcast, so the explorer has nothing to show. Fund the relayer to settle on chain."
      >
        {transactionId}
      </span>
      <span
        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"
        title="Not on chain — fund the relayer, or use Pay from Pera Wallet, to get an explorer-resolvable id."
      >
        local only
      </span>
    </span>
  );
}
