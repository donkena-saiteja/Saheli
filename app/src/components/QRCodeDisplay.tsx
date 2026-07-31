import { CheckCircle2, Download, Share2, Shield } from 'lucide-react';

interface QRCodeDisplayProps {
  qrCode: string;        // base64 data URL
  transactionId: string;
  amount?: number;
  type?: string;
  memberName?: string;
  compact?: boolean;
}

export default function QRCodeDisplay({
  qrCode,
  transactionId,
  amount,
  type,
  memberName,
  compact = false,
}: QRCodeDisplayProps) {
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = qrCode;
    a.download = `saheli-proof-${transactionId.slice(0, 12)}.png`;
    a.click();
  };

  if (compact) {
    return (
      <div className="flex flex-col items-center p-4 bg-white rounded-2xl border border-border/50">
        <img src={qrCode} alt="QR Proof" className="w-32 h-32 rounded-lg mb-3" />
        <div className="flex items-center gap-1 text-shg-secondary text-xs font-bold mb-1">
          <CheckCircle2 className="w-3 h-3" />
          Verified
        </div>
        <p className="text-[10px] font-mono text-muted-foreground text-center">
          {transactionId.slice(0, 24)}...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-border/50 p-6 flex flex-col items-center text-center">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-shg-primary" />
        <h3 className="font-bold text-on-surface font-headline">Offline Proof Certificate</h3>
      </div>

      {/* QR Code */}
      <div className="relative p-3 bg-white rounded-2xl shadow-lg border-4 border-surface mb-4">
        <img src={qrCode} alt="Transaction QR Code" className="w-44 h-44 rounded-lg" />
        <div className="absolute inset-0 border-2 border-shg-primary/10 rounded-2xl pointer-events-none" />
      </div>

      {/* Badge */}
      <div className="flex items-center gap-1.5 bg-shg-secondary/10 text-shg-secondary px-3 py-1.5 rounded-full text-xs font-bold mb-4">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Verified Transaction
      </div>

      {/* Details */}
      <div className="w-full bg-surface rounded-xl p-4 mb-4 text-left space-y-2">
        {memberName && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Member</span>
            <span className="font-semibold">{memberName}</span>
          </div>
        )}
        {amount && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-bold text-shg-primary">₹{amount.toLocaleString('en-IN')}</span>
          </div>
        )}
        {type && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Type</span>
            <span className="capitalize font-semibold">{type.replace(/_/g, ' ')}</span>
          </div>
        )}
        <div className="flex justify-between text-sm pt-2 border-t border-border/50">
          <span className="text-muted-foreground">Reference</span>
          <span className="font-mono text-xs text-on-surface">{transactionId.slice(0, 16)}...</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 w-full">
        <button
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-surface transition-colors"
        >
          <Download className="w-4 h-4" />
          Download
        </button>
        <button
          onClick={() => {
            if (navigator.share) {
              navigator.share({ title: 'Saheli Proof', text: `Ref: ${transactionId}` });
            }
          }}
          className="flex items-center justify-center gap-2 px-3 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-surface transition-colors"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
