/**
 * Runs the wallet-signed x402 loop and tracks it for the UI.
 *
 * Both gates — a member requesting a loan and a leader approving one — are the
 * same protocol with a different price and payer, so they share this hook.
 * Keeping it in one place is what stops the two flows drifting into subtly
 * different payment semantics.
 */

import { useCallback, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isUserCancellation } from '../lib/pera';
import {
  X402_STEP_TEMPLATE,
  type WalletResourceId,
  type X402Step,
  type X402StepId,
  type X402StepStatus,
  decodePaymentResponse,
  payWithPera,
} from '../lib/x402Wallet';

export interface X402Receipt {
  transactionId: string;
  explorerUrl: string;
  amountAlgos: number;
  payTo: string;
  settlement: string;
}

/** Shape the gated routes echo back after settling. */
interface PaidResponse {
  x402?: { transaction: string; explorerUrl: string; settlement: string } | null;
}

export function useX402Payment(resourceId: WalletResourceId) {
  const { user, walletAddress, linkPeraWallet } = useAuth();
  const payer = user?.walletAddress || walletAddress;

  const [steps, setSteps] = useState<X402Step[]>(X402_STEP_TEMPLATE);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<X402Receipt | null>(null);

  const setStep = useCallback((id: X402StepId, status: X402StepStatus, detail?: string) => {
    setSteps((current) =>
      current.map((step) =>
        step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
      ),
    );
  }, []);

  const reset = useCallback(() => {
    setSteps(X402_STEP_TEMPLATE.map((step) => ({ ...step, status: 'pending', detail: undefined })));
    setReceipt(null);
    setRunning(false);
  }, []);

  /**
   * Pays, then performs the gated request with the resulting header.
   *
   * `perform` is supplied by the caller because only it knows the request body.
   * The payment and the action stay inside one user gesture, so there is never
   * a settled payment with no action to show for it.
   */
  const payAndRun = useCallback(
    async <T extends PaidResponse>(
      context: Record<string, unknown>,
      perform: (paymentHeader: string) => Promise<{ data: T; paymentResponse: string | null }>,
    ): Promise<T> => {
      setRunning(true);
      setReceipt(null);
      setSteps(X402_STEP_TEMPLATE.map((step) => ({ ...step, status: 'pending', detail: undefined })));

      // A wallet is mandatory here: this payment must come from an account the
      // user controls, so there is no server-key fallback to quietly use.
      let from = payer;
      if (!from) {
        setStep('challenge', 'active', 'Connecting Pera Wallet…');
        try {
          from = await linkPeraWallet();
        } catch (err) {
          setStep('challenge', 'failed', isUserCancellation(err) ? 'Cancelled' : (err as Error).message);
          setRunning(false);
          throw err;
        }
      }

      let prepared;
      try {
        prepared = await payWithPera({
          resourceId,
          payerAddress: from,
          context,
          onStep: setStep,
        });
      } catch (err) {
        setRunning(false);
        throw err;
      }

      try {
        const { data, paymentResponse } = await perform(prepared.paymentHeader);

        // Prefer the server's own receipt over anything the client assumed.
        const decoded = decodePaymentResponse(paymentResponse);
        const transactionId = data?.x402?.transaction || decoded?.transaction || prepared.txId;
        const settlement = data?.x402?.settlement || 'onchain';

        setStep(
          'settle',
          'done',
          `${settlement === 'onchain' ? 'Settled on-chain' : `Settled (${settlement})`} · ${prepared.amountAlgos} ALGO to ${prepared.payTo.slice(0, 6)}…`,
        );
        setStep('unlock', 'done', 'Payment accepted — request processed');

        setReceipt({
          transactionId,
          explorerUrl:
            data?.x402?.explorerUrl ||
            `https://lora.algokit.io/testnet/transaction/${transactionId}`,
          amountAlgos: prepared.amountAlgos,
          payTo: prepared.payTo,
          settlement,
        });

        setRunning(false);
        return data;
      } catch (err) {
        // A 402 here means verify/settle refused the payment: nothing was
        // debited and nothing was unlocked. Say so rather than implying a
        // partial state.
        setStep('settle', 'failed', (err as Error).message);
        setStep('unlock', 'failed', 'Resource stayed locked — no action was taken');
        setRunning(false);
        throw err;
      }
    },
    [linkPeraWallet, payer, resourceId, setStep],
  );

  return { steps, running, receipt, payAndRun, reset, payer };
}
