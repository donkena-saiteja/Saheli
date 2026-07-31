import { useState } from 'react';
import { X, Brain, Zap, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { loansApi } from '../lib/api';
import { toast } from 'sonner';

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

  const handleSubmit = async () => {
    const amt = parseInt(amount);
    if (!amt || !purpose) {
      toast.error('Please fill in all fields');
      return;
    }

    setStep('evaluating');

    try {
      const res = await loansApi.request({
        memberId,
        amount: amt,
        purpose: customPurpose || purpose,
      });
      setResult(res);

      setStep('result');

      if (res.loan?.status === 'approved') {
        toast.success(`Loan of ₹${amt.toLocaleString('en-IN')} approved!`);
      } else {
        toast.info('Loan submitted. Leader approval required before QR generation.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Loan request failed');
      setStep('form');
    }
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
          <button onClick={onClose} className="text-white/70 hover:text-white p-1 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {step === 'form' && (
            <>
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

              <button
                onClick={handleSubmit}
                disabled={!amount || (!purpose && !customPurpose)}
                className="w-full py-3.5 bg-shg-primary text-white rounded-xl font-bold text-sm hover:opacity-90 transition-opacity active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Brain className="w-4 h-4" />
                Submit for Leader Approval
              </button>
            </>
          )}

          {step === 'evaluating' && (
            <div className="py-12 flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-shg-primary/10 rounded-full flex items-center justify-center mb-6">
                <Loader2 className="w-10 h-10 text-shg-primary animate-spin" />
              </div>
              <h3 className="font-black text-xl font-headline mb-2">AI Evaluating...</h3>
              <p className="text-muted-foreground text-sm">
                Checking your trust score, repayment history, and credit record.
              </p>
              <div className="mt-6 space-y-2 text-left w-full">
                {['Verifying trust score...', 'Analyzing repayment history...', 'Checking liquidity pool...'].map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="w-1.5 h-1.5 bg-shg-secondary rounded-full animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
                    {s}
                  </div>
                ))}
              </div>
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
                onClick={onClose}
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
