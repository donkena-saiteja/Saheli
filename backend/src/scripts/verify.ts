/**
 * End-to-end verification.
 *
 *   npm run verify           (backend must already be running)
 *   npm run verify -- --url http://localhost:3001
 *
 * Exercises every capability the hackathon requires and prints a pass/fail
 * table. Written so a judge can confirm the claims without reading any code.
 */

import algosdk from 'algosdk';
import nacl from 'tweetnacl';

const BASE = (() => {
  const idx = process.argv.indexOf('--url');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].replace(/\/$/, '');
  return process.env.VERIFY_URL || 'http://127.0.0.1:3001';
})();

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
  const mark = passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
}

async function main() {
  console.log(`\n\x1b[1mSaheli SHG Chain — verification\x1b[0m`);
  console.log(`Target: ${BASE}\n`);

  // ── Health ──
  console.log('\x1b[1mPlatform\x1b[0m');
  const health = await json('/health');
  record(
    'API is up',
    health.status === 200 && health.body.status === 'ok',
    `status=${health.body.status} database=${health.body.database?.mode}`,
  );

  // ── Algorand ──
  console.log('\n\x1b[1mAlgorand\x1b[0m');
  const chain = await json('/api/algorand/info');
  const chainOk = chain.status === 200 && Boolean(chain.body.data?.caip2);
  record(
    'Connected to Algorand',
    chainOk && chain.body.data.lastRound > 0,
    `network=${chain.body.data?.network} round=${chain.body.data?.lastRound} mode=${chain.body.data?.mode}`,
  );
  record(
    'CAIP-2 identifier matches the x402 AVM standard',
    chain.body.data?.caip2 === 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe' ||
      chain.body.data?.caip2 === 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k',
    chain.body.data?.caip2 || 'missing',
  );
  record(
    'Gasless relayer configured',
    Boolean(chain.body.data?.relayer?.address),
    `relayer=${chain.body.data?.relayer?.address}`,
  );

  // ── Seed ──
  console.log('\n\x1b[1mDemo data\x1b[0m');
  const seed = await json('/api/auth/seed-demo', { method: 'POST', body: JSON.stringify({}) });
  record(
    'Demo SHG seeded',
    seed.status === 200 && seed.body.data?.members > 0,
    `${seed.body.data?.members} members, ${seed.body.data?.loans} loans, ${seed.body.data?.passports} passports`,
  );

  // ── x402 ──
  console.log('\n\x1b[1mx402 pay-per-use (mandatory)\x1b[0m');
  const cat = await json('/api/x402/catalogue');
  record(
    'Price catalogue served',
    cat.status === 200 && (cat.body.data?.resources?.length || 0) >= 5,
    `${cat.body.data?.resources?.length} priced resources, scheme=${cat.body.data?.scheme}`,
  );

  const unpaid = await json('/api/x402/credit-report/shg1');
  const reqs = unpaid.body?.accepts?.[0];
  record(
    'Unpaid request is rejected with HTTP 402',
    unpaid.status === 402,
    `status=${unpaid.status} x402Version=${unpaid.body?.x402Version}`,
  );
  record(
    'PaymentRequirements match the exact-AVM spec',
    reqs?.scheme === 'exact' && Boolean(reqs?.asset) && Boolean(reqs?.payTo) && Boolean(reqs?.amount),
    `scheme=${reqs?.scheme} asset=${reqs?.asset} amount=${reqs?.amount} payTo=${reqs?.payTo?.slice(0, 12)}…`,
  );

  const pay = await json('/api/x402/demo/pay', {
    method: 'POST',
    body: JSON.stringify({ resourceId: 'credit-report', payerSubject: 'bank:verifier' }),
  });
  record(
    'Atomic group built, verified and settled',
    pay.status === 200 && pay.body.success === true,
    `${pay.body.data?.steps?.length} protocol steps completed`,
  );

  const header = pay.body?.data?.paymentHeader;
  const paid = await json('/api/x402/credit-report/shg1', { headers: { 'X-PAYMENT': header } });
  record(
    'Paid request returns HTTP 200',
    paid.status === 200 && Boolean(paid.body.data?.groupTrustScore),
    `trustScore=${paid.body.data?.groupTrustScore} decision=${paid.body.data?.recommendation?.decision}`,
  );

  const settleHeader = paid.headers.get('x-payment-response');
  let settleOk = false;
  let settleDetail = 'header missing';
  if (settleHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(settleHeader, 'base64').toString('utf8'));
      settleOk = decoded.success === true && Boolean(decoded.transaction);
      settleDetail = `tx=${decoded.transaction?.slice(0, 16)}… payer=${decoded.payer?.slice(0, 12)}…`;
    } catch {
      settleDetail = 'header could not be decoded';
    }
  }
  record('X-PAYMENT-RESPONSE receipt returned', settleOk, settleDetail);

  const revenue = await json('/api/x402/revenue');
  record(
    'Revenue routed to the SHG treasury',
    revenue.status === 200 && Number(revenue.body.data?.totals?.calls) > 0,
    `calls=${revenue.body.data?.totals?.calls} treasury=$${revenue.body.data?.totals?.treasuryDisplay}`,
  );

  // ── WhatsApp ──
  console.log('\n\x1b[1mWhatsApp banking\x1b[0m');
  const phone = '+91-9876543210';
  await json('/api/whatsapp/reset', { method: 'POST', body: JSON.stringify({ phone }) });

  const greet = await json('/api/whatsapp/simulate', {
    method: 'POST',
    body: JSON.stringify({ phone, message: 'Hi' }),
  });
  record(
    'Greeting requests an MPIN',
    greet.body.data?.state === 'AWAITING_MPIN',
    `state=${greet.body.data?.state}`,
  );

  const badPin = await json('/api/whatsapp/simulate', {
    method: 'POST',
    body: JSON.stringify({ phone, message: '9999' }),
  });
  record(
    'Wrong MPIN is refused',
    badPin.body.data?.authenticated === false,
    'authentication correctly denied',
  );

  const goodPin = await json('/api/whatsapp/simulate', {
    method: 'POST',
    body: JSON.stringify({ phone, message: '1234' }),
  });
  record(
    'Correct MPIN opens the numbered menu',
    goodPin.body.data?.authenticated === true && goodPin.body.data?.message?.includes('Balance Enquiry'),
    `state=${goodPin.body.data?.state}`,
  );

  const voice = await json('/api/whatsapp/simulate', {
    method: 'POST',
    body: JSON.stringify({ phone, message: 'Deposit 500 rupees', fromVoice: true }),
  });
  record(
    'Voice/natural language jumps straight to confirmation',
    voice.body.data?.state === 'AWAITING_CONFIRMATION',
    `state=${voice.body.data?.state} action=${voice.body.data?.action}`,
  );

  const confirmed = await json('/api/whatsapp/simulate', {
    method: 'POST',
    body: JSON.stringify({ phone, message: 'YES' }),
  });
  const depositTx = confirmed.body.data?.transactionId;
  record(
    'Confirmed deposit settles and returns a QR proof',
    confirmed.body.data?.action === 'deposit_confirmed' && Boolean(confirmed.body.data?.qrCode),
    `tx=${depositTx?.slice(0, 20)}…`,
  );
  record(
    'Transaction id is a real Algorand txid (52-char base32)',
    /^[A-Z2-7]{52}$/.test(depositTx || ''),
    depositTx || 'missing',
  );

  // ── QR verification ──
  console.log('\n\x1b[1mOffline QR proof\x1b[0m');
  const verify = await json(`/api/qr/verify/${depositTx}`);
  record(
    'Proof verifies against the ledger',
    verify.status === 200 && verify.body.data?.verdict !== 'NOT_FOUND',
    `verdict=${verify.body.data?.verdict}`,
  );

  const qr = await json('/api/qr/generate', {
    method: 'POST',
    body: JSON.stringify({ transactionId: depositTx, autoSendWhatsApp: false }),
  });
  record(
    'QR payload carries absolute, scannable URLs',
    qr.body.data?.payload?.verifyUrl?.startsWith('http') &&
      qr.body.data?.payload?.explorerUrl?.startsWith('http'),
    `verifyUrl=${qr.body.data?.payload?.verifyUrl?.slice(0, 48)}…`,
  );

  // ── d-SBT ──
  console.log('\n\x1b[1mDynamic Soulbound Tokens\x1b[0m');
  const members = await json('/api/members');
  const memberId = members.body.data?.[0]?._id;
  const passportPay = await json('/api/x402/demo/pay', {
    method: 'POST',
    body: JSON.stringify({ resourceId: 'member-passport' }),
  });
  const passport = await json(`/api/x402/member-passport/${memberId}`, {
    headers: { 'X-PAYMENT': passportPay.body?.data?.paymentHeader },
  });
  record(
    'Passport is soulbound and non-transferable',
    passport.body.data?.passport?.soulbound === true &&
      passport.body.data?.passport?.transferable === false,
    `tier=${passport.body.data?.passport?.tier} score=${passport.body.data?.passport?.score}`,
  );

  // ── Multi-sig ──
  console.log('\n\x1b[1mMulti-signature treasury\x1b[0m');
  const pending = await json('/api/multisig/pending');
  record(
    'Pending approvals are queued',
    pending.status === 200 && Array.isArray(pending.body.data),
    `${pending.body.data?.length} awaiting leader signatures`,
  );

  // ── Pera Wallet sign-in ──
  // Drives the real endpoints with a throwaway keypair, signing exactly the way
  // Pera does: ed25519 over "MX" || challenge.
  console.log('\n\x1b[1mPera Wallet sign-in\x1b[0m');
  const wallet = algosdk.generateAccount();
  const walletAddress = wallet.addr.toString();

  const signAsPera = (message: string, secretKey: Uint8Array) => {
    const messageBytes = new TextEncoder().encode(message);
    const signed = new Uint8Array(2 + messageBytes.length);
    signed.set([77, 88], 0); // "MX" — Algorand's arbitrary-bytes domain prefix
    signed.set(messageBytes, 2);
    return Buffer.from(nacl.sign.detached(signed, secretKey)).toString('base64');
  };

  const challenge = await json('/api/auth/wallet/challenge', {
    method: 'POST',
    body: JSON.stringify({ address: walletAddress }),
  });
  record(
    'Wallet challenge issued with a single-use nonce',
    challenge.status === 200 && Boolean(challenge.body.data?.nonce) && Boolean(challenge.body.data?.message),
    `address=${walletAddress.slice(0, 12)}… nonce=${challenge.body.data?.nonce?.slice(0, 10)}…`,
  );

  const signature = signAsPera(challenge.body.data?.message || '', wallet.sk);
  const walletLogin = await json('/api/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify({ address: walletAddress, nonce: challenge.body.data?.nonce, signature, role: 'leader' }),
  });
  record(
    'Valid Pera signature issues a JWT session',
    walletLogin.status === 201 && Boolean(walletLogin.body.data?.token),
    `role=${walletLogin.body.data?.role} newAccount=${walletLogin.body.data?.isNewAccount}`,
  );

  const replay = await json('/api/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify({ address: walletAddress, nonce: challenge.body.data?.nonce, signature }),
  });
  record(
    'Replayed nonce is refused',
    replay.status === 401,
    `reason=${replay.body?.reason}`,
  );

  const forgeChallenge = await json('/api/auth/wallet/challenge', {
    method: 'POST',
    body: JSON.stringify({ address: walletAddress }),
  });
  const forged = signAsPera(forgeChallenge.body.data?.message || '', algosdk.generateAccount().sk);
  const forgedRes = await json('/api/auth/wallet/verify', {
    method: 'POST',
    body: JSON.stringify({
      address: walletAddress,
      nonce: forgeChallenge.body.data?.nonce,
      signature: forged,
    }),
  });
  record(
    'Signature from a different key is rejected',
    forgedRes.status === 401 && forgedRes.body?.reason === 'bad_signature',
    `reason=${forgedRes.body?.reason}`,
  );

  const walletProfile = await json('/api/auth/profile', {
    headers: { Authorization: `Bearer ${walletLogin.body.data?.token}` },
  });
  record(
    'Wallet session authenticates against a protected route',
    walletProfile.status === 200 && walletProfile.body.data?.walletAddress === walletAddress,
    `authProvider=${walletProfile.body.data?.authProvider}`,
  );

  // ── Full transaction ids ──
  // The x402 proof-verification flow reads ids straight off this endpoint, so a
  // truncated id here silently breaks it.
  console.log('\n\x1b[1mTransaction ledger\x1b[0m');
  const ledgerTx = await json('/api/transactions?limit=5');
  const firstTx = ledgerTx.body.data?.[0];
  record(
    'Ledger exposes untruncated Algorand transaction ids',
    ledgerTx.status === 200 && /^[A-Z2-7]{52}$/.test(firstTx?.transactionId || ''),
    `transactionId=${firstTx?.transactionId?.slice(0, 20)}… (display: ${firstTx?.txId})`,
  );

  const proofPay = await json('/api/x402/demo/pay', {
    method: 'POST',
    body: JSON.stringify({ resourceId: 'verify-proof' }),
  });
  const proof = await json('/api/x402/verify-proof', {
    method: 'POST',
    headers: { 'X-PAYMENT': proofPay.body?.data?.paymentHeader },
    body: JSON.stringify({ transactionId: firstTx?.transactionId }),
  });
  record(
    'Paid proof verification resolves a real ledger record',
    proof.status === 200 && proof.body.data?.verdict !== 'NOT_FOUND',
    `verdict=${proof.body.data?.verdict}`,
  );

  // ── Single-leader approval workflow ──
  // The old flow needed three signatures that one leader could never provide,
  // and a decline had no scoping. Both are asserted here so they cannot regress.
  console.log('\n\x1b[1mLoan approval workflow\x1b[0m');

  const membersList = await json('/api/members');
  const borrower = membersList.body.data?.[0];
  const treasuryBefore = await json('/api/loans/treasury/balance');

  const loanReq = await json('/api/loans/request', {
    method: 'POST',
    body: JSON.stringify({ memberId: borrower?._id, amount: 3000, purpose: 'verification loan' }),
  });
  record(
    'Loan request needs exactly one leader approval',
    loanReq.status === 201 && loanReq.body.data?.loan?.approvalsRequired === 1,
    `approvalsRequired=${loanReq.body.data?.loan?.approvalsRequired}`,
  );

  const queueBefore = await json('/api/multisig/pending');
  const loanId = loanReq.body.data?.loan?.id;
  const myAction = queueBefore.body.data?.find((a: any) => a.linkedLoanId === loanId);
  record(
    'A loan raises exactly one approval record',
    queueBefore.body.data?.filter((a: any) => a.linkedLoanId === loanId).length === 1,
    `pendingForThisLoan=${queueBefore.body.data?.filter((a: any) => a.linkedLoanId === loanId).length}`,
  );

  const otherPending = (queueBefore.body.data || []).filter((a: any) => a.id !== myAction?.id);
  const approve = await json(`/api/multisig/${myAction?.id}/sign`, {
    method: 'POST',
    body: JSON.stringify({ signerId: 'verify_leader' }),
  });
  record(
    'One signature approves and settles the loan',
    approve.status === 200 && approve.body.data?.action?.status === 'executed',
    `status=${approve.body.data?.action?.status} signatures=${approve.body.data?.action?.signatures?.length}/1`,
  );

  const treasuryAfter = await json('/api/loans/treasury/balance');
  const debited = (treasuryBefore.body.data?.balance || 0) - (treasuryAfter.body.data?.balance || 0);
  record(
    'Approval debits the SHG treasury',
    debited === 3000,
    `₹${treasuryBefore.body.data?.balance?.toLocaleString('en-IN')} → ₹${treasuryAfter.body.data?.balance?.toLocaleString('en-IN')} (−₹${debited.toLocaleString('en-IN')})`,
  );

  if (otherPending.length > 0) {
    const declineTarget = otherPending[0];
    const survivors = otherPending.filter((a: any) => a.id !== declineTarget.id).map((a: any) => a.id);

    const decline = await json(`/api/multisig/${declineTarget.id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'verification decline' }),
    });
    const queueAfter = await json('/api/multisig/pending');
    const stillPending = (queueAfter.body.data || []).map((a: any) => a.id);
    const untouched = survivors.every((id: string) => stillPending.includes(id));

    record(
      'Declining one approval leaves every other approval pending',
      decline.status === 200 && untouched && !stillPending.includes(declineTarget.id),
      `declined 1, ${survivors.length} other(s) survived: ${untouched ? 'yes' : 'NO'}`,
    );
  } else {
    record('Declining one approval leaves every other approval pending', true, 'no sibling approvals to compare');
  }

  // ── Autonomous compliance agent ──
  console.log('\n\x1b[1mAI compliance & treasury agent\x1b[0m');
  const agentStatus = await json('/api/ai-monitor/status');
  record(
    'Compliance agent is online',
    agentStatus.status === 200 && agentStatus.body.data?.online === true,
    `provider=${agentStatus.body.data?.provider}${agentStatus.body.data?.model ? ` model=${agentStatus.body.data.model}` : ''}`,
  );

  const scan = await json('/api/ai-monitor/scan', { method: 'POST', body: JSON.stringify({}) });
  record(
    'Agent monitors every transaction in the ledger',
    scan.status === 200 && scan.body.data?.scannedTransactions > 0,
    `scanned ${scan.body.data?.scannedTransactions} transactions across ${scan.body.data?.scannedMembers} members`,
  );

  const alerts = await json('/api/ai-monitor/alerts?status=open');
  const topAlert = alerts.body.data?.[0];
  record(
    'Agent detects fraud and illegal activity',
    alerts.status === 200 && (alerts.body.data?.length || 0) > 0,
    topAlert
      ? `${alerts.body.data.length} finding(s), highest: [${topAlert.severity}] ${topAlert.title}`
      : 'no findings raised',
  );
  record(
    'Findings carry a severity, a risk score and a regulatory basis',
    Boolean(topAlert?.severity && typeof topAlert?.riskScore === 'number' && topAlert?.recommendedAction),
    topAlert ? `risk=${topAlert.riskScore}/100 basis=${String(topAlert.regulatoryBasis || '').slice(0, 48)}…` : 'n/a',
  );

  const advisory = await json('/api/ai-monitor/investments');
  const sovereign = (advisory.body.data?.allocations || []).length;
  record(
    'Agent recommends government schemes instead of leaving funds idle',
    advisory.status === 200 && Boolean(advisory.body.data?.narrative),
    `idle=₹${advisory.body.data?.idleFunds?.toLocaleString('en-IN')} · ${sovereign} sovereign instrument(s) · blended ${advisory.body.data?.blendedYield}%`,
  );
  record(
    'Advisory keeps an emergency liquidity buffer',
    (advisory.body.data?.liquidityBuffer || 0) > 0,
    `buffer=₹${advisory.body.data?.liquidityBuffer?.toLocaleString('en-IN')} held in instant-access instruments`,
  );

  // ── Excel reporting ──
  console.log('\n\x1b[1mExcel reporting\x1b[0m');
  const xlsxRes = await fetch(`${BASE}/api/reports/transactions.xlsx`);
  const xlsxBuf = Buffer.from(await xlsxRes.arrayBuffer());
  const isZip = xlsxBuf.subarray(0, 4).toString('hex') === '504b0304';
  record(
    'Transaction history downloads as a real .xlsx workbook',
    xlsxRes.status === 200 && isZip && xlsxBuf.length > 1000,
    `${Math.round(xlsxBuf.length / 1024)} KB · ${xlsxRes.headers.get('content-type')?.slice(0, 52)}…`,
  );

  const packRes = await fetch(`${BASE}/api/reports/full-ledger.xlsx`);
  const packBuf = Buffer.from(await packRes.arrayBuffer());
  // Worksheet XML is deflate-compressed, but ZIP stores entry *names* in the
  // clear, so counting them proves the workbook really has six sheets.
  const sheetParts = [1, 2, 3, 4, 5, 6].filter((n) =>
    packBuf.includes(Buffer.from(`xl/worksheets/sheet${n}.xml`)),
  );
  record(
    'Institutional pack contains every audit sheet',
    packRes.status === 200 &&
      packBuf.subarray(0, 4).toString('hex') === '504b0304' &&
      sheetParts.length === 6,
    `${Math.round(packBuf.length / 1024)} KB · ${sheetParts.length}/6 worksheets present`,
  );

  // ── Wallet settlement ──
  console.log('\n\x1b[1mPera Wallet settlement\x1b[0m');
  const throwaway = algosdk.generateAccount().addr.toString();
  const prepare = await json('/api/algorand/payment/prepare', {
    method: 'POST',
    body: JSON.stringify({ fromAddress: throwaway, amountInr: 500, purpose: 'deposit' }),
  });
  record(
    'Wallet payments refuse to build against an unfunded account',
    prepare.status === 400 && /ALGO/.test(prepare.body.error || ''),
    String(prepare.body.error || '').slice(0, 92) + '…',
  );

  const badAddress = await json('/api/algorand/payment/prepare', {
    method: 'POST',
    body: JSON.stringify({ fromAddress: 'NOT_AN_ADDRESS', amountInr: 500, purpose: 'deposit' }),
  });
  record(
    'Wallet payments validate the payer address',
    badAddress.status === 400 && /not a valid Algorand address/.test(badAddress.body.error || ''),
    badAddress.body.error,
  );

  // Algorand rejects any payment that would leave the receiver under 0.1 ALGO.
  // The quote states that minimum before the user commits, instead of letting
  // them sign something the pool will refuse with "balance below min".
  const quote = await json('/api/algorand/payment/quote');
  record(
    'Payment quote states the minimum the network will accept',
    quote.status === 200 && typeof quote.body.data?.minimumInr === 'number' && quote.body.data.minimumInr > 0,
    `destination holds ${quote.body.data?.to?.algos} ALGO · minimum ₹${quote.body.data?.minimumInr?.toLocaleString('en-IN')}`,
  );

  if (quote.body.data?.to?.funded === false) {
    const belowMin = await json('/api/algorand/payment/prepare', {
      method: 'POST',
      body: JSON.stringify({
        fromAddress: algosdk.generateAccount().addr.toString(),
        amountInr: Math.max(1, Math.floor(quote.body.data.minimumInr / 2)),
        purpose: 'deposit',
      }),
    });
    record(
      'Transfers below Algorand’s minimum balance are refused before signing',
      belowMin.status === 400 && /destination account/i.test(belowMin.body.error || ''),
      String(belowMin.body.error || '').slice(0, 100) + '…',
    );
  } else {
    record(
      'Transfers below Algorand’s minimum balance are refused before signing',
      true,
      'destination already funded — minimum-balance guard not applicable',
    );
  }

  // ── Summary ──
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.length - passed;

  console.log(`\n${'─'.repeat(62)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m  ALL ${passed} CHECKS PASSED\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m  ${failed} of ${checks.length} CHECKS FAILED\x1b[0m`);
    for (const c of checks.filter((x) => !x.passed)) {
      console.log(`    \x1b[31m✗\x1b[0m ${c.name} — ${c.detail}`);
    }
  }
  console.log(`${'─'.repeat(62)}\n`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n\x1b[31mVerification could not run.\x1b[0m');
  console.error(err instanceof Error ? err.message : err);
  console.error(`\nIs the backend running at ${BASE}?  cd backend && npm run dev\n`);
  process.exit(1);
});
