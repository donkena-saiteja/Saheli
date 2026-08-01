import { useState } from 'react';
import { X, Brain, Zap, AlertCircle, CheckCircle2, Wallet } from 'lucide-react';
import { loansApi } from '../lib/api';
import { toast } from 'sonner';
import { isUserCancellation, shortenAddress } from '../lib/pera';
import { useX402Payment } from '../hooks/useX402Payment';
import X402ProtocolSteps from './X402ProtocolSteps';

interface LoanRequestModalProps {
  onClose: () => void;
  memberId?: string;
  memberName?: string;
  trustScore?: number;
}

const PURPOSES = [
  'Medical / Hospital Expenses',
  'Agricultural Seeds / Equipment',
  'Business Inventory',
  'Education Fees',
  'Home Repair',
  'Emergency (General)',
];

export default function LoanRequestModal({
  onClose,
  memberId = '',
  memberName = 'Lakshmi Devi',
  trustScore = 850,
}: LoanRequestModalProps) {
  const [step, setStep] = useState<'form' | 'evaluating' | 'result'>('form');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [customPurpose, setCustomPurpose] = useState('');
  const [result, setResult] = useState<any>(null);

  // The x402 gate. `/api/loans/request` answers 402 until this settles, so the
  // payment is not a preamble to the request — it IS the thing that unlocks it.
  const { steps, receipt, payAndRun, reset, payer } = useX402Payment('loan-request');

  const handleSubmit = async () => {
    const amt = parseInt(amount);
    const finalPurpose = customPurpose || purpose;
    if (!amt || !finalPurpose) {
      toast.error('Please fill in all fields');
      return;
    }

    setStep('evaluating');

    try {
      const res = await payAndRun(
        { memberId, memberName, amountInr: amt, purpose: finalPurpose },
        (paymentHeader) =>
          loansApi.request({ memberId, amount: amt, purpose: finalPurpose }, paymentHeader),
      );

      setResult(res);
      setStep('result');
      toast.success('x402 fee settled on Algorand — request routed for leader approval.');
    } catch (err: any) {
      console.error(err);
      if (isUserCancellation(err)) {
        toast.info('Cancelled in Pera Wallet — nothing was charged and no loan was requested.');
      } else {
        toast.error(err?.message || 'Loan request failed');
      }
      // Stay on the protocol view so the failed step is readable, and let the
      // member retry without retyping the form.
      setStep('form');
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-shg-primary to-blue-600 p-6 flex items-center justify-between">
          <div>
            <p className="text-white/70 text-xs font-semibold uppercase tracking-widest">AI Micro-Loan</p>
            <h2 className="text-white font-black text-xl font-headline">Request a Loan</h2>
          </div>
          <button onClick={handleClose} className="text-white/70 hover:text-white p-1 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 max-h-[75vh] overflow-y-auto">
          {step === 'form' && (
            <>
              {/* x402 gate — stated before the member commits to anything */}
              <div className="mb-4 rounded-xl border border-shg-primary/25 bg-shg-primary/[0.06] p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="w-4 h-4 text-shg-primary" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-shg-primary">
                    x402 Pay-per-Use
                  </span>
                  <span className="ml-auto text-[11px] font-bold text-shg-primary">0.05 ALGO</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Submitting charges a <strong>0.05 ALGO</strong> underwriting fee, paid from your own
                  Pera Wallet on Algorand TestNet. You approve it on your device — the loan is only
                  created once that payment settles.
                </p>
                {payer && (
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                    Paying from {shortenAddress(payer)}
                  </p>
                )}
              </div>

              {/* Trust Score Badge */}
              <div className="mb-6 p-4 bg-shg-secondary/10 rounded-xl flex items-center gap-3">
                <div className="w-10 h-10 bg-shg-secondary/20 rounded-lg flex items-center justify-center">
                  <Brain className="w-5 h-5 text-shg-secondary" />
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase">Your Trust Score</p>
                  <p className="font-extrabold text-lg text-shg-secondary font-headline">{trustScore}/1000 · Excellent</p>
                </div>
                <CheckCircle2 className="w-5 h-5 text-shg-secondary ml-auto" />
              </div>

              {/* Amount */}
              <div className="mb-4">
                <label className="block text-xs font-bold uppercase text-muted-foreground mb-2">
                  Loan Amount (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">₹</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="5,000"
                    className="w-full pl-10 pr-4 py-3 border border-border rounded-xl text-lg font-bold focus:outline-none focus:ring-2 focus:ring-shg-primary/30 focus:border-shg-primary transition-all"
                  />
                </div>
                {parseInt(amount) <= 5000 && parseInt(amount) > 0 && (
                  <p className="text-xs text-shg-secondary font-semibold mt-1 flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Micro-loans under ₹5,000 are auto-approved by AI!
                  </p>
                )}
              </div>

              {/* Purpose */}
              <div className="mb-6">
                <label className="block text-xs font-bold uppercase text-muted-foreground mb-2">Purpose</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {PURPOSES.map(p => (
                    <button
                      key={p}
                      onClick={() => { setPurpose(p); setCustomPurpose(''); }}
                      className={`p-2.5 text-left text-xs font-semibold rounded-lg border transition-all ${
                        purpose === p
                          ? 'border-shg-primary bg-shg-primary/10 text-shg-primary'
                          : 'border-border hover:border-shg-primary/30 text-muted-foreground'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customPurpose}
                  onChange={e => { setCustomPurpose(e.target.value); setPurpose('custom'); }}
                  placeholder="Or describe your purpose..."
                  className="w-full px-4 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-shg-primary/30 focus:border-shg-primary transition-all"
                />
              </div>

              {/* A failed attempt leaves its protocol trace on screen so the
                  member can see exactly which step refused, then retry. */}
              {steps.some((s) => s.status === 'failed') && (
                <div className="mb-4">
                  <X402ProtocolSteps steps={steps} price="0.05 ALGO" compact />
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!amount || (!purpose && !customPurpose)}
                className="w-full py-3.5 bg-shg-primary text-white rounded-xl font-bold text-sm hover:opacity-90 transition-opacity active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Wallet className="w-4 h-4" />
                Pay 0.05 ALGO &amp; Submit
              </button>
            </>
          )}

          {step === 'evaluating' && (
            <div className="py-2">
              <h3 className="font-black text-lg font-headline mb-1">Settling the x402 payment</h3>
              <p className="text-muted-foreground text-xs mb-4">
                Approve the payment in Pera Wallet. Your loan request is submitted the moment it
                confirms on Algorand.
              </p>
              <X402ProtocolSteps steps={steps} receipt={receipt} price="0.05 ALGO" />
            </div>
          )}

          {step === 'result' && result && (
            <div>
              {/* Result Banner */}
              <div className={`rounded-xl p-4 mb-4 ${
                result.loan?.status === 'approved'
                  ? 'bg-shg-secondary/10 border border-shg-secondary/20'
                  : 'bg-shg-tertiary/10 border border-shg-tertiary/20'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  {result.loan?.status === 'approved'
                    ? <CheckCircle2 className="w-5 h-5 text-shg-secondary" />
                    : <AlertCircle className="w-5 h-5 text-shg-tertiary" />
                  }
                  <span className={`font-bold text-sm ${result.loan?.status === 'approved' ? 'text-shg-secondary' : 'text-shg-tertiary'}`}>
                    {result.loan?.status === 'approved' ? 'LOAN APPROVED ✅' : 'PENDING APPROVAL ⏳'}
                  </span>
                </div>
                <p className="text-sm text-on-surface">{result.message}</p>
              </div>

              {/* The settled payment that unlocked this request */}
              <div className="mb-4">
                <X402ProtocolSteps steps={steps} receipt={receipt} price="0.05 ALGO" compact />
              </div>

              {/* AI Reason */}
              <div className="bg-surface rounded-xl p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-shg-primary" />
                  <span className="text-xs font-bold uppercase text-muted-foreground">AI Reasoning</span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-1">Member: {memberName}</p>
                <p className="text-sm text-on-surface italic">"{result.evaluation?.reason}"</p>
              </div>

              <button
                onClick={handleClose}
                className="w-full py-3 border border-border rounded-xl font-bold text-sm hover:bg-surface transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
