// ─── API Client for Saheli Saheli ─────────────────────────────────────────
// All backend calls go through this typed client.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('saheli-token');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw buildApiError(res.status, err);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Turns a failed response into an Error that still carries what the caller
 * needs to react.
 *
 * A 402 is not a generic failure — it is the x402 protocol asking for payment,
 * and its body holds the PaymentRequirements. Flattening it to `HTTP 402` would
 * throw away the one thing that makes the response actionable, so the parsed
 * body and the verify/settle reasons ride along on the error.
 */
function buildApiError(status: number, body: any): Error {
  const settleMessage = body?.settleError?.message;
  const verifyMessage = body?.verifyError?.message;

  const message =
    settleMessage ||
    verifyMessage ||
    body?.error ||
    (status === 402 ? 'Payment required' : `HTTP ${status}`);

  return Object.assign(new Error(message), {
    status,
    body,
    isPaymentRequired: status === 402,
    paymentRequirements: body?.accepts?.[0],
  });
}

/** True when the API answered with an x402 challenge rather than a real error. */
export function isPaymentRequiredError(err: unknown): boolean {
  return Boolean((err as { isPaymentRequired?: boolean })?.isPaymentRequired);
}

/** Same as apiFetch, but settles an x402 payment header alongside the request. */
async function apiFetchPaid<T>(
  path: string,
  paymentHeader: string,
  options?: RequestInit,
): Promise<{ data: T; paymentResponse: string | null }> {
  const token = localStorage.getItem('saheli-token');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw buildApiError(res.status, json);

  return { data: json.data, paymentResponse: res.headers.get('x-payment-response') };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (phone: string, password: string) =>
    apiFetch<any>('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) }),
  register: (body: { name: string; phone: string; password: string; role: string; shgId?: string }) =>
    apiFetch<any>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  profile: () => apiFetch<any>('/auth/profile'),

  // ── Pera Wallet sign-in ──
  /** Step 1: ask the server for a single-use challenge to sign. */
  walletChallenge: (address: string) =>
    apiFetch<{
      address: string;
      nonce: string;
      message: string;
      expiresAt: string;
      network: string;
      knownAccount: { name: string; role: string; shgId?: string } | null;
    }>('/auth/wallet/challenge', { method: 'POST', body: JSON.stringify({ address }) }),

  /** Step 2: hand back the signature and receive a JWT session. */
  walletVerify: (body: {
    address: string;
    nonce: string;
    signature: string;
    name?: string;
    role?: string;
    shgId?: string;
  }) => apiFetch<any>('/auth/wallet/verify', { method: 'POST', body: JSON.stringify(body) }),

  /** Attaches a Pera wallet to the account that is already signed in. */
  walletLink: (body: { address: string; nonce: string; signature: string }) =>
    apiFetch<any>('/auth/wallet/link', { method: 'POST', body: JSON.stringify(body) }),
};

// ─── Members ──────────────────────────────────────────────────────────────────

export const membersApi = {
  getAll: () => apiFetch<any[]>('/members'),
  getById: (id: string) => apiFetch<any>(`/members/${id}`),
  getTransactions: (id: string) => apiFetch<any[]>(`/members/${id}/transactions`),
};

// ─── Transactions ──────────────────────────────────────────────────────────────

export const transactionsApi = {
  getAll: () => apiFetch<any[]>('/transactions'),
  getLedger: () => apiFetch<any[]>('/transactions/ledger'),
  create: (body: { memberId: string; type: string; amount: number; description?: string }) =>
    apiFetch<any>('/transactions', { method: 'POST', body: JSON.stringify(body) }),
};

// ─── Loans ────────────────────────────────────────────────────────────────────

export const loansApi = {
  getAll: (status?: string) => apiFetch<any[]>(`/loans${status ? `?status=${status}` : ''}`),
  getById: (id: string) => apiFetch<any>(`/loans/${id}`),
  getBankQueue: () => apiFetch<any[]>('/loans/bank-queue/list'),
  getTreasuryBalance: () => apiFetch<{ balance: number; currency: string }>('/loans/treasury/balance'),
  processBankQueue: (id: string, processedBy?: string) =>
    apiFetch<any>(`/loans/bank-queue/${id}/process`, { method: 'POST', body: JSON.stringify({ processedBy }) }),
  /**
   * x402-gated. Without a settled payment header the API answers 402 and no
   * loan is created, so the header is required rather than optional.
   */
  request: (body: { memberId: string; amount: number; purpose: string }, paymentHeader: string) =>
    apiFetchPaid<any>('/loans/request', paymentHeader, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approve: (id: string, paymentHeader: string, approvedBy?: string) =>
    apiFetchPaid<any>(`/loans/${id}/approve`, paymentHeader, {
      method: 'POST',
      body: JSON.stringify({ approvedBy }),
    }),
  decline: (id: string, reason?: string, declinedBy?: string) =>
    apiFetch<any>(`/loans/${id}/decline`, { method: 'POST', body: JSON.stringify({ reason, declinedBy }) }),
};

// ─── Multi-Sig ────────────────────────────────────────────────────────────────

export const multisigApi = {
  getPending: (destinationRole?: string) =>
    apiFetch<any[]>(`/multisig/pending${destinationRole ? `?destinationRole=${destinationRole}` : ''}`),
  getAll: (status?: string) => apiFetch<any[]>(`/multisig${status ? `?status=${status}` : ''}`),
  /** x402-gated: the leader's Pera wallet settles before the signature counts. */
  sign: (id: string, paymentHeader: string, signerId?: string) =>
    apiFetchPaid<any>(`/multisig/${id}/sign`, paymentHeader, {
      method: 'POST',
      body: JSON.stringify({ signerId }),
    }),
  reject: (id: string, reason?: string, declinedBy?: string) =>
    apiFetch<any>(`/multisig/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason, declinedBy }) }),
};

// ─── AI Compliance & Treasury Agent ───────────────────────────────────────────

export const aiMonitorApi = {
  getStatus: () => apiFetch<any>('/ai-monitor/status'),
  scan: () => apiFetch<any>('/ai-monitor/scan', { method: 'POST', body: JSON.stringify({}) }),
  getAlerts: (status: string = 'open') => apiFetch<any[]>(`/ai-monitor/alerts?status=${status}`),
  reviewAlert: (id: string, status: 'cleared' | 'escalated' | 'open', note?: string) =>
    apiFetch<any>(`/ai-monitor/alerts/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),
  getInvestments: () => apiFetch<any>('/ai-monitor/investments'),
  getSchemes: () => apiFetch<any[]>('/ai-monitor/schemes'),
  ask: (question: string) =>
    apiFetch<any>('/ai-monitor/ask', { method: 'POST', body: JSON.stringify({ question }) }),
  simulateThreat: (pattern: 'structuring' | 'velocity' | 'round_trip' = 'structuring') =>
    apiFetch<any>('/ai-monitor/simulate-threat', { method: 'POST', body: JSON.stringify({ pattern }) }),
};

// ─── Downloadable reports ─────────────────────────────────────────────────────

export const reportsApi = {
  getCatalogue: () => apiFetch<any[]>('/reports/catalogue'),
  /** Absolute URL for a report, so it can be used as an <a href> or fetched. */
  url: (report: string, format: 'xlsx' | 'csv' = 'xlsx', params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    return `${BASE_URL}/reports/${report}.${format}${query}`;
  },
  /**
   * Downloads through fetch rather than a plain link so the Authorization
   * header travels with the request and errors surface as real errors.
   */
  download: async (report: string, format: 'xlsx' | 'csv' = 'xlsx', params?: Record<string, string>) => {
    const token = localStorage.getItem('saheli-token');
    const res = await fetch(reportsApi.url(report, format, params), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(detail.error || `Download failed with HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saheli-${report}-${stamp}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the download has actually started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { bytes: blob.size, filename: a.download };
  },
};

// ─── AI Agent ─────────────────────────────────────────────────────────────────

export const aiAgentApi = {
  getLog: () => apiFetch<any[]>('/ai-agent/log'),
  getInsights: () => apiFetch<any>('/ai-agent/insights'),
  getSuggestions: (memberId?: string) =>
    apiFetch<any[]>(`/ai-agent/suggestions${memberId ? `?memberId=${memberId}` : ''}`),
  chat: (body: { message: string; memberId?: string; memberName?: string }) =>
    apiFetch<any>('/ai-agent/chat', { method: 'POST', body: JSON.stringify(body) }),
};

// ─── QR Code ──────────────────────────────────────────────────────────────────

export const qrApi = {
  generate: (body: {
    transactionId?: string;
    txHash?: string;
    memberId?: string;
    memberName?: string;
    memberPhone?: string;
    amount?: number;
    type?: string;
    // walletAddress?: string; - removed for MERN
    autoSendWhatsApp?: boolean;
  }) => {
    const payload = {
      ...body,
      transactionId: body.transactionId || body.txHash,
    };

    return apiFetch<any>('/qr/generate', { method: 'POST', body: JSON.stringify(payload) });
  },
  verify: (transactionId: string) => apiFetch<any>(`/qr/verify/${transactionId}`),
};

// ─── Stats ────────────────────────────────────────────────────────────────────

export const statsApi = {
  getTreasury: () => apiFetch<any>('/stats/treasury'),
  getInstitutional: () => apiFetch<any>('/stats/institutional'),
  getSHGDirectory: () => apiFetch<any[]>('/stats/shg-directory'),
  getLedger: () => apiFetch<any[]>('/stats/ledger'),
  approveGrant: () => apiFetch<any>('/stats/grants/approve', { method: 'POST', body: JSON.stringify({}) }),
};

// ─── x402 Pay-per-Use ─────────────────────────────────────────────────────────

/** Paths of the payment-gated resources, keyed by resource id. */
const X402_PATHS: Record<string, { path: string; method: 'GET' | 'POST'; body?: any }> = {
  'credit-report': { path: '/x402/credit-report/shg1', method: 'GET' },
  'member-passport': { path: '/x402/member-passport/:memberId', method: 'GET' },
  'verify-proof': { path: '/x402/verify-proof', method: 'POST', body: { transactionId: 'PENDING' } },
  'grant-eligibility': { path: '/x402/grant-eligibility/shg1', method: 'GET' },
  'ai-underwriting': {
    path: '/x402/ai-underwriting',
    method: 'POST',
    body: { memberId: ':memberId', amount: 8000, purpose: 'medical emergency' },
  },
};

/** Resolves placeholders that need a live member id. */
async function resolveX402Target(resourceId: string) {
  const template = X402_PATHS[resourceId];
  // Spreading an undefined entry yields a truthy `{}`, so the guard has to run
  // against the lookup itself, not against the copy.
  if (!template) throw new Error(`Unknown x402 resource: ${resourceId}`);
  const spec = { ...template };

  const needsMember =
    spec.path.includes(':memberId') || JSON.stringify(spec.body || {}).includes(':memberId');

  if (needsMember) {
    const members = await membersApi.getAll();
    const memberId = members?.[0]?._id;
    if (!memberId) throw new Error('No members available. Seed the demo data first.');
    spec.path = spec.path.replace(':memberId', memberId);
    if (spec.body) {
      spec.body = JSON.parse(JSON.stringify(spec.body).replace(':memberId', memberId));
    }
  }

  if (resourceId === 'verify-proof') {
    const txs = await transactionsApi.getAll();
    // `txId` is a truncated display string; only `transactionId` resolves
    // against the ledger or the chain.
    const txId = txs?.find((t: any) => t?.transactionId)?.transactionId;
    if (!txId) {
      throw new Error('No anchored transaction to verify yet. Seed the demo data first.');
    }
    spec.body = { transactionId: txId };
  }

  return spec;
}

export const x402Api = {
  getCatalogue: () => apiFetch<any>('/x402/catalogue'),
  getSupported: () => apiFetch<any>('/x402/supported'),
  getRevenue: () => apiFetch<any>('/x402/revenue'),

  /** The hardcoded receiver every wallet-signed loan payment lands in. */
  getReceiver: () =>
    apiFetch<{
      address: string;
      network: string;
      algos: number;
      funded: boolean;
      explorerUrl: string;
      dispenser?: string;
      hardcoded: boolean;
    }>('/x402/wallet/receiver'),

  /**
   * Step 1 of the wallet-signed loop: the 402 challenge plus the unsigned
   * payment that satisfies it, built server-side so the receiver and amount
   * cannot be altered here.
   */
  walletPrepare: (body: {
    resourceId: 'loan-request' | 'loan-approval';
    payerAddress: string;
    context?: Record<string, unknown>;
  }) =>
    apiFetch<{
      resourceId: 'loan-request' | 'loan-approval';
      unsignedTxn: string;
      txId: string;
      requirements: Record<string, unknown>;
      payer: string;
      payTo: string;
      amountAtomic: string;
      amountAlgos: number;
      assetSymbol: string;
      displayPrice: string;
      description: string;
      network: string;
      explorerPayer: string;
      explorerPayTo: string;
      challenge: unknown;
    }>('/x402/wallet/prepare', { method: 'POST', body: JSON.stringify(body) }),

  /** Calls a gated endpoint with no payment, returning the raw 402 body. */
  probe: async (resourceId: string) => {
    const spec = await resolveX402Target(resourceId);
    const res = await fetch(`${BASE_URL}${spec.path}`, {
      method: spec.method,
      headers: { 'Content-Type': 'application/json' },
      body: spec.method === 'POST' ? JSON.stringify(spec.body || {}) : undefined,
    });
    const json = await res.json();
    if (res.status !== 402) {
      throw new Error(`Expected HTTP 402, got ${res.status}`);
    }
    return json;
  },

  /** Runs the full challenge -> sign -> verify -> settle handshake. */
  demoPay: (resourceId: string, payerSubject?: string) =>
    apiFetch<any>('/x402/demo/pay', {
      method: 'POST',
      body: JSON.stringify({ resourceId, payerSubject }),
    }),

  /** Replays a settled payment header against the genuinely gated endpoint. */
  fetchPaid: async (resourceId: string, paymentHeader: string) => {
    const spec = await resolveX402Target(resourceId);
    const res = await fetch(`${BASE_URL}${spec.path}`, {
      method: spec.method,
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': paymentHeader },
      body: spec.method === 'POST' ? JSON.stringify(spec.body || {}) : undefined,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || `Paid request failed with HTTP ${res.status}`);
    }
    return json.data;
  },
};

// ─── Algorand chain ───────────────────────────────────────────────────────────

export const algorandApi = {
  getInfo: () => apiFetch<any>('/algorand/info'),
  getHealth: () => apiFetch<any>('/algorand/health'),
  getTx: (txId: string) => apiFetch<any>(`/algorand/tx/${txId}`),
  getWallet: (memberId: string) => apiFetch<any>(`/algorand/wallet/${memberId}`),
  getBalance: (address: string) => apiFetch<any>(`/algorand/balance/${address}`),
  getRate: () => apiFetch<any>('/algorand/rate'),

  /**
   * What both sides hold and the smallest amount Algorand will accept.
   * Fetched before the user types, so the 0.1 ALGO minimum-balance rule is
   * explained up front instead of rejecting them after they have signed.
   */
  getPaymentQuote: (params: { fromAddress?: string; toAddress?: string; toMemberId?: string }) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
    ).toString();
    return apiFetch<{
      from: { address: string; algos: number; funded: boolean } | null;
      to: { address: string; algos: number; funded: boolean };
      minimumInr: number;
      maximumInr: number | null;
      microAlgosPerInr: number;
      reason: string;
    }>(`/algorand/payment/quote${query ? `?${query}` : ''}`);
  },

  /** Step 1 of a real wallet payment: the server builds the unsigned txn. */
  preparePayment: (body: {
    fromAddress: string;
    amountInr: number;
    purpose: 'deposit' | 'withdrawal' | 'loan_disbursement' | 'loan_repayment' | 'yield';
    toAddress?: string;
    toMemberId?: string;
    memberId?: string;
    linkedLoanId?: string;
    description?: string;
  }) => apiFetch<any>('/algorand/payment/prepare', { method: 'POST', body: JSON.stringify(body) }),

  /** Step 3: broadcast what Pera signed and record the settled movement. */
  submitPayment: (body: {
    signedTxn: string;
    purpose: string;
    memberId?: string;
    linkedLoanId?: string;
    description?: string;
  }) => apiFetch<any>('/algorand/payment/submit', { method: 'POST', body: JSON.stringify(body) }),
};

// ─── WhatsApp banking ─────────────────────────────────────────────────────────

export const whatsappApi = {
  getInfo: () => apiFetch<any>('/whatsapp/info'),
  simulate: (body: { phone: string; message: string; profileName?: string; fromVoice?: boolean }) =>
    apiFetch<any>('/whatsapp/simulate', { method: 'POST', body: JSON.stringify(body) }),
  reset: (phone: string) =>
    apiFetch<any>('/whatsapp/reset', { method: 'POST', body: JSON.stringify({ phone }) }),
};

// ─── Autonomous Agent ─────────────────────────────────────────────────────────

export const agentApi = {
  getStatus: () => apiFetch<any>('/agent/status'),
  getLog: () => apiFetch<any[]>('/agent/log'),
  getVaults: () => apiFetch<any>('/agent/vaults'),
  invest: (amount?: number) =>
    apiFetch<any>('/agent/invest', { method: 'POST', body: JSON.stringify({ amount }) }),
  harvest: (vaultId?: string) =>
    apiFetch<any>('/agent/harvest', { method: 'POST', body: JSON.stringify({ vaultId }) }),
  emergencyLoan: (body: { memberId?: string; amount: number; purpose?: string }) =>
    apiFetch<any>('/agent/emergency-loan', { method: 'POST', body: JSON.stringify(body) }),
  getRepayments: () => apiFetch<any[]>('/agent/repayments'),
};

