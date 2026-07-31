import { useEffect, useState } from 'react';
import { Loader2, Wallet, ExternalLink, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { algorandApi } from '../lib/api';
import { isUserCancellation, shortenAddress, signPayment } from '../lib/pera';
import { useAuth } from '../contexts/AuthContext';

type Purpose = 'deposit' | 'withdrawal' | 'loan_disbursement' | 'loan_repayment' | 'yield';

interface PeraPaymentButtonProps {
  amountInr: number;
  purpose: Purpose;
  label?: string;
  /** Destination. Omit both to pay the SHG treasury. */
  toAddress?: string;
  toMemberId?: string;
  /** Which member the ledger row belongs to. */
  memberId?: string;
  linkedLoanId?: string;
  description?: string;
  className?: string;
  disabled?: boolean;
  onSettled?: (result: { transactionId: string; explorerUrl: string; amountInr: number }) => void;
}

/**
 * Moves real money out of the connected Pera wallet.
 *
 * Three steps, all visible to the user:
 *   1. the server builds the payment (it owns the receiver and the amount)
 *   2. Pera asks the user to approve it on their device
 *   3. the server broadcasts it and only then updates the ledger
 *
 * The resulting transaction id is a genuine TestNet id, so the explorer link
 * resolves — unlike the relayer path, which falls back to local anchoring when
 * the relayer is unfunded.
 */
export default function PeraPaymentButton({
  amountInr,
  purpose,
  label,
  toAddress,
  toMemberId,
  memberId,
  linkedLoanId,
  description,
  className = '',
  disabled = false,
  onSettled,
}: PeraPaymentButtonProps) {
  const { user, walletAddress, linkPeraWallet, walletConnecting } = useAuth();
  const payer = user?.walletAddress || walletAddress;

  const [stage, setStage] = useState<'idle' | 'preparing' | 'signing' | 'submitting' | 'done'>('idle');
  const [receipt, setReceipt] = useState<{ transactionId: string; explorerUrl: string; amountAlgos: number } | null>(
    null,
  );
  const [quote, setQuote] = useState<{
    minimumInr: number;
    maximumInr: number | null;
    reason: string;
    to: { address: string; algos: number; funded: boolean };
  } | null>(null);

  const busy = stage !== 'idle' && stage !== 'done';

  /**
   * Algorand will not let any account sit below 0.1 ALGO, which means a first
   * payment into a never-funded destination has to clear that bar in one go.
   * Asking the server up front lets the button state the minimum instead of
   * letting the user sign something the network will refuse.
   */
  useEffect(() => {
    let cancelled = false;

    algorandApi
      .getPaymentQuote({ fromAddress: payer || undefined, toAddress, toMemberId })
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch(() => {
        // A quote is an optimisation, not a gate — prepare still validates.
        if (!cancelled) setQuote(null);
      });

    return () => {
      cancelled = true;
    };
  }, [payer, toAddress, toMemberId]);

  const belowMinimum = Boolean(quote && amountInr > 0 && amountInr < quote.minimumInr);
  const aboveMaximum = Boolean(
    quote && quote.maximumInr !== null && amountInr > 0 && amountInr > quote.maximumInr,
  );

  const handlePay = async () => {
    let from = payer;

    if (!from) {
      try {
        from = await linkPeraWallet();
      } catch (err) {
        if (isUserCancellation(err)) {
          toast.info('Pera Wallet request cancelled.');
        } else {
          toast.error((err as Error).message || 'Connect a Pera Wallet first.');
        }
        return;
      }
    }

    try {
      setStage('preparing');
      const prepared = await algorandApi.preparePayment({
        fromAddress: from,
        amountInr,
        purpose,
        toAddress,
        toMemberId,
        memberId,
        linkedLoanId,
        description,
      });

      setStage('signing');
      toast.info(`Approve ${prepared.amountAlgos} ALGO in Pera Wallet…`);
      const signedTxn = await signPayment(prepared.unsignedTxn, from);

      setStage('submitting');
      const settled = await algorandApi.submitPayment({
        signedTxn,
        purpose,
        memberId,
        linkedLoanId,
        description,
      });

      setReceipt({
        transactionId: settled.transactionId,
        explorerUrl: settled.explorerUrl,
        amountAlgos: settled.amountAlgos,
      });
      setStage('done');

      toast.success(settled.message);
      if (settled.compliance?.flagged) {
        toast.warning(`Compliance agent flagged this payment: ${settled.compliance.reason}`);
      }

      onSettled?.({
        transactionId: settled.transactionId,
        explorerUrl: settled.explorerUrl,
        amountInr: settled.amountInr,
      });
    } catch (err) {
      setStage('idle');
      if (isUserCancellation(err)) {
        toast.info('Payment cancelled in Pera Wallet — nothing was debited.');
        return;
      }
      toast.error((err as Error).message || 'Payment failed');
    }
  };

  const stageLabel: Record<typeof stage, string> = {
    idle: label || `Pay ₹${amountInr.toLocaleString('en-IN')} from Pera Wallet`,
    preparing: 'Building transaction…',
    signing: 'Waiting for Pera Wallet…',
    submitting: 'Broadcasting to Algorand…',
    done: 'Settled on Algorand',
  };

  if (stage === 'done' && receipt) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-1">
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-700">
          <CheckCircle2 className="w-4 h-4" />
          {receipt.amountAlgos} ALGO debited from {shortenAddress(payer)}
        </p>
        <a
          href={receipt.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-800 hover:underline break-all"
        >
          {receipt.transactionId}
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
        <p className="text-[10px] text-emerald-700/80">Live on Algorand TestNet — open the link to verify.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handlePay}
        disabled={disabled || busy || walletConnecting || belowMinimum || aboveMaximum}
        className={
          className ||
          'w-full inline-flex items-center justify-center gap-2 bg-[#FFEE55] text-slate-900 py-2.5 px-4 rounded-xl font-bold text-sm transition-all hover:brightness-95 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed'
        }
      >
        {busy || walletConnecting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Wallet className="w-4 h-4" />
        )}
        {stageLabel[stage]}
      </button>

      {belowMinimum && quote && (
        <p className="flex items-start gap-1 text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            Minimum ₹{quote.minimumInr.toLocaleString('en-IN')} for this destination. Algorand requires every
            account to hold at least 0.1 ALGO, and this one has not been funded yet.
          </span>
        </p>
      )}

      {aboveMaximum && quote?.maximumInr !== null && quote && (
        <p className="flex items-start gap-1 text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            Your wallet can send at most ₹{quote.maximumInr?.toLocaleString('en-IN')} right now — the rest is
            reserved for the network fee and the 0.1 ALGO minimum balance.
          </span>
        </p>
      )}

      {!belowMinimum && !aboveMaximum && quote && !quote.to.funded && (
        <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          First payment to this address — it must carry at least ₹{quote.minimumInr.toLocaleString('en-IN')} to
          meet Algorand&apos;s account minimum.
        </p>
      )}

      {!payer && (
        <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          No wallet connected yet — this will open Pera first. Fund the address at the TestNet dispenser.
        </p>
      )}
    </div>
  );
}
