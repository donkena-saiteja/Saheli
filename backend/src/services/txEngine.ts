import Transaction from '../models/Transaction';

/**
 * Transaction lifecycle tracking.
 *
 * Transaction *ids* are no longer minted here — every id now comes from an
 * actual Algorand transaction (see services/algorand.ts). This module only
 * tracks pending -> confirmed state for records whose settlement is still
 * in flight.
 */

type TxStatus = 'pending' | 'confirmed' | 'failed';

type LifecycleRecord = {
  transactionId: string;
  status: TxStatus;
  type: string;
  amount: number;
  createdAt: string;
  confirmedAt?: string;
};

const txLifecycleStore = new Map<string, LifecycleRecord>();

export function registerTransactionLifecycle(params: {
  transactionId: string;
  type?: string;
  amount?: number;
  initialStatus?: TxStatus;
  autoConfirm?: boolean;
  autoConfirmDelayMs?: number;
}): LifecycleRecord {
  const existing = txLifecycleStore.get(params.transactionId);
  if (existing) {
    return existing;
  }

  const record: LifecycleRecord = {
    transactionId: params.transactionId,
    status: params.initialStatus || 'pending',
    type: params.type || 'standard',
    amount: params.amount || 0,
    createdAt: new Date().toISOString(),
  };

  txLifecycleStore.set(params.transactionId, record);

  const shouldAutoConfirm = params.autoConfirm ?? true;
  if (shouldAutoConfirm && record.status === 'pending') {
    const delayMs = params.autoConfirmDelayMs ?? (2000 + Math.floor(Math.random() * 3000));
    setTimeout(() => {
      const current = txLifecycleStore.get(params.transactionId);
      if (!current || current.status !== 'pending') return;
      current.status = 'confirmed';
      current.confirmedAt = new Date().toISOString();
      txLifecycleStore.set(params.transactionId, current);
    }, delayMs);
  }

  return record;
}

export function setTransactionLifecycleStatus(transactionId: string, status: TxStatus): void {
  const existing = txLifecycleStore.get(transactionId);
  if (!existing) {
    txLifecycleStore.set(transactionId, {
      transactionId,
      status,
      type: 'standard',
      amount: 0,
      createdAt: new Date().toISOString(),
      confirmedAt: status === 'confirmed' ? new Date().toISOString() : undefined,
    });
    return;
  }

  existing.status = status;
  if (status === 'confirmed') {
    existing.confirmedAt = existing.confirmedAt || new Date().toISOString();
  }
  txLifecycleStore.set(transactionId, existing);
}

export async function verifyTransaction(transactionId: string): Promise<{
  valid: boolean;
  status: TxStatus | 'not_found';
  confirmedAt?: string;
  type?: string;
  amount?: number;
}> {
  const dbTx = await Transaction.findOne({ transactionId }).lean();
  if (dbTx) {
    const normalizedStatus: TxStatus = (dbTx.status as TxStatus) || 'pending';
    return {
      valid: normalizedStatus !== 'failed',
      status: normalizedStatus,
      confirmedAt: normalizedStatus === 'confirmed' ? new Date().toISOString() : undefined,
      type: dbTx.type,
      amount: dbTx.amount,
    };
  }

  const lifecycleTx = txLifecycleStore.get(transactionId);
  if (lifecycleTx) {
    return {
      valid: lifecycleTx.status !== 'failed',
      status: lifecycleTx.status,
      confirmedAt: lifecycleTx.confirmedAt,
      type: lifecycleTx.type,
      amount: lifecycleTx.amount,
    };
  }

  return {
    valid: false,
    status: 'not_found',
  };
}
