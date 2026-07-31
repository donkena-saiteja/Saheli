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
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const json = await res.json();
  return json.data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (phone: string, password: string) =>
    apiFetch<any>('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) }),
  register: (body: { name: string; phone: string; password: string; role: string; shgId?: string }) =>
    apiFetch<any>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  profile: () => apiFetch<any>('/auth/profile'),
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
  getAll: () => apiFetch<any[]>('/loans'),
  getById: (id: string) => apiFetch<any>(`/loans/${id}`),
  getBankQueue: () => apiFetch<any[]>('/loans/bank-queue/list'),
  processBankQueue: (id: string, processedBy?: string) =>
    apiFetch<any>(`/loans/bank-queue/${id}/process`, { method: 'POST', body: JSON.stringify({ processedBy }) }),
  request: (body: { memberId: string; amount: number; purpose: string }) =>
    apiFetch<any>('/loans/request', { method: 'POST', body: JSON.stringify(body) }),
  approve: (id: string) =>
    apiFetch<any>(`/loans/${id}/approve`, { method: 'POST', body: JSON.stringify({}) }),
};

// ─── Multi-Sig ────────────────────────────────────────────────────────────────

export const multisigApi = {
  getPending: () => apiFetch<any[]>('/multisig/pending'),
  getAll: () => apiFetch<any[]>('/multisig'),
  sign: (id: string, signerId?: string) =>
    apiFetch<any>(`/multisig/${id}/sign`, { method: 'POST', body: JSON.stringify({ signerId }) }),
  reject: (id: string) =>
    apiFetch<any>(`/multisig/${id}/reject`, { method: 'POST', body: JSON.stringify({}) }),
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
  const spec = { ...X402_PATHS[resourceId] };
  if (!spec) throw new Error(`Unknown x402 resource: ${resourceId}`);

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
    const txId = txs?.[0]?.txId?.replace(/\.\.\.$/, '');
    spec.body = { transactionId: txId || 'UNKNOWN' };
  }

  return spec;
}

export const x402Api = {
  getCatalogue: () => apiFetch<any>('/x402/catalogue'),
  getSupported: () => apiFetch<any>('/x402/supported'),
  getRevenue: () => apiFetch<any>('/x402/revenue'),

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

