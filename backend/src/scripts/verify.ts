/**
 * End-to-end verification.
 *
 *   npm run verify           (backend must already be running)
 *   npm run verify -- --url http://localhost:3001
 *
 * Exercises every capability the hackathon requires and prints a pass/fail
 * table. Written so a judge can confirm the claims without reading any code.
 */

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
