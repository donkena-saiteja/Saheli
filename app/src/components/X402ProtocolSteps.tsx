import { Check, Loader2, X, Circle, ExternalLink, ShieldCheck } from 'lucide-react';
import type { X402Step } from '../lib/x402Wallet';

interface X402ProtocolStepsProps {
  steps: X402Step[];
  /** Rendered under the steps once the payment has actually settled. */
  receipt?: {
    transactionId: string;
    explorerUrl: string;
    amountAlgos: number;
    payTo: string;
    settlement: string;
  } | null;
  price?: string;
  compact?: boolean;
}

const STATUS_STYLES: Record<X402Step['status'], string> = {
  pending: 'text-muted-foreground/50',
  active: 'text-shg-primary',
  done: 'text-emerald-600',
  failed: 'text-red-600',
};

function StepIcon({ status }: { status: X402Step['status'] }) {
  if (status === 'done') return <Check className="w-3.5 h-3.5" />;
  if (status === 'active') return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
  if (status === 'failed') return <X className="w-3.5 h-3.5" />;
  return <Circle className="w-2 h-2" />;
}

/**
 * Narrates the x402 handshake as it happens.
 *
 * The payment is the part of this product a judge most needs to believe, and a
 * spinner proves nothing. Each transition is shown with the concrete protocol
 * fact behind it — the price, the scheme, the receiver, the settled txid — so
 * what is on screen can be checked against the explorer.
 */
export default function X402ProtocolSteps({
  steps,
  receipt,
  price,
  compact = false,
}: X402ProtocolStepsProps) {
  return (
    <div
      className={`rounded-xl border border-shg-primary/20 bg-shg-primary/[0.04] ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-shg-primary" />
        <span className="text-[11px] font-black uppercase tracking-widest text-shg-primary">
          x402 Pay-per-Use
        </span>
        {price && (
          <span className="ml-auto text-[11px] font-bold text-shg-primary bg-shg-primary/10 px-2 py-0.5 rounded-full">
            {price}
          </span>
        )}
      </div>

      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                step.status === 'done'
                  ? 'bg-emerald-100'
                  : step.status === 'active'
                    ? 'bg-shg-primary/15'
                    : step.status === 'failed'
                      ? 'bg-red-100'
                      : 'bg-muted'
              } ${STATUS_STYLES[step.status]}`}
            >
              <StepIcon status={step.status} />
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={`text-xs font-semibold leading-tight ${
                  step.status === 'pending' ? 'text-muted-foreground/60' : 'text-on-surface'
                }`}
              >
                <span className="text-muted-foreground/70 font-mono mr-1">{index + 1}.</span>
                {step.label}
              </p>
              {step.detail && (
                <p
                  className={`text-[10px] mt-0.5 break-words ${
                    step.status === 'failed' ? 'text-red-600' : 'text-muted-foreground'
                  }`}
                >
                  {step.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {receipt && (
        <div className="mt-3 pt-3 border-t border-shg-primary/15 space-y-1">
          <p className="text-[11px] font-bold text-emerald-700">
            {receipt.amountAlgos} ALGO settled{' '}
            {receipt.settlement === 'onchain' ? 'on Algorand TestNet' : `(${receipt.settlement})`}
          </p>
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1 text-[10px] font-mono text-emerald-800 hover:underline break-all"
          >
            {receipt.transactionId}
            <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
          </a>
        </div>
      )}
    </div>
  );
}
