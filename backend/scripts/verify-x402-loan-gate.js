/**
 * End-to-end x402 loan-gate test.
 *
 * Drives the real HTTP surface exactly the way the browser will:
 *   402 challenge -> build payment -> sign (stands in for Pera) -> X-PAYMENT -> settle
 *
 * Set TEST_PAYER_MNEMONIC to a funded 25-word TestNet mnemonic to run the
 * green path all the way to an on-chain settlement. Without it the script
 * still proves the gate, the payload shape, verification and tamper rejection,
 * and that settlement genuinely reaches algod instead of silently simulating.
 */
const algosdk = require('algosdk');

const API = 'http://localhost:3001';
const RECEIVER = 'LK55I23YL4XPLQMWPOTYKBHL5VJ6EETGWGGC63AZ7G3XXR6BCB3VI3FW6E';
const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };

async function call(path, { method = 'POST', body, header } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(header ? { 'X-PAYMENT': header } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, paymentResponse: res.headers.get('x-payment-response') };
}

/** Signs the payment the way Pera would, and wraps it in an X-PAYMENT header. */
async function buildHeader(account, requirements, { amount, receiver } = {}) {
  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: receiver || requirements.payTo,
    amount: Number(amount ?? requirements.amount),
    note: new Uint8Array(Buffer.from(JSON.stringify({ app: 'saheli-shg-chain', protocol: 'x402' }))),
    suggestedParams: sp,
  });
  const signed = Buffer.from(txn.signTxn(account.sk)).toString('base64');
  const payload = {
    x402Version: 2,
    accepted: requirements,
    payload: { paymentGroup: [signed], paymentIndex: 0 },
  };
  return { header: Buffer.from(JSON.stringify(payload)).toString('base64'), txId: txn.txID() };
}

(async () => {
  console.log('\n=== 1. Gate returns HTTP 402 ===');
  const challenge = await call('/api/loans/request', {
    body: { memberId: '507f1f77bcf86cd799439011', amount: 5000, purpose: 'medical emergency' },
  });
  ok('loan request without payment is 402', challenge.status === 402, `got ${challenge.status}`);
  const req = challenge.json.accepts?.[0];
  ok('x402Version is 2', challenge.json.x402Version === 2);
  ok('scheme is exact', req?.scheme === 'exact');
  ok('asset is native ALGO ("0")', req?.asset === '0', `got ${req?.asset}`);
  ok('payTo is the HARDCODED receiver', req?.payTo === RECEIVER, req?.payTo);
  ok('amount is 50000 microAlgos', req?.amount === '50000');
  ok('no feePayer advertised (payer self-funds)', req?.extra?.feePayer === undefined);

  console.log('\n=== 2. Leader approval gate ===');
  const appr = await call('/api/multisig/some-id/sign', { body: { signerId: 'Leader' } });
  ok('multisig sign without payment is 402', appr.status === 402, `got ${appr.status}`);
  ok('approval payTo is the same hardcoded receiver', appr.json.accepts?.[0]?.payTo === RECEIVER);

  console.log('\n=== 3. Receiver status endpoint ===');
  const recv = await call('/api/x402/wallet/receiver', { method: 'GET' });
  ok('receiver endpoint responds', recv.status === 200);
  ok('receiver address matches', recv.json.data?.address === RECEIVER);
  ok('receiver is funded on TestNet', recv.json.data?.funded === true, `${recv.json.data?.algos} ALGO`);

  console.log('\n=== 4. Tamper rejection (server owns receiver + amount) ===');
  const attacker = algosdk.generateAccount();
  const wrongReceiver = await buildHeader(attacker, req, { receiver: attacker.addr });
  const r1 = await call('/api/loans/request', {
    body: { memberId: '507f1f77bcf86cd799439011', amount: 5000, purpose: 'medical' },
    header: wrongReceiver.header,
  });
  ok('redirecting payment to another address is rejected', r1.status === 402,
     r1.json.verifyError?.reason || `status ${r1.status}`);

  const shortPay = await buildHeader(attacker, req, { amount: 1 });
  const r2 = await call('/api/loans/request', {
    body: { memberId: '507f1f77bcf86cd799439011', amount: 5000, purpose: 'medical' },
    header: shortPay.header,
  });
  ok('underpaying is rejected', r2.status === 402,
     r2.json.verifyError?.reason || `status ${r2.status}`);

  console.log('\n=== 5. Settlement really reaches Algorand ===');
  const broke = await buildHeader(attacker, req);
  const r3 = await call('/api/loans/request', {
    body: { memberId: '507f1f77bcf86cd799439011', amount: 5000, purpose: 'medical' },
    header: broke.header,
  });
  const settleErr = r3.json.settleError?.message || '';
  ok('valid payload from an empty wallet is NOT silently simulated', r3.status === 402);
  ok('algod actually rejected it (proves live broadcast)',
     /ALGO|overspend|balance|minimum/i.test(settleErr), settleErr.slice(0, 120));

  console.log('\n=== 6. Green path (needs TEST_PAYER_MNEMONIC) ===');
  if (!process.env.TEST_PAYER_MNEMONIC) {
    console.log('  SKIP  set TEST_PAYER_MNEMONIC to a funded TestNet mnemonic to settle for real');
  } else {
    const payer = algosdk.mnemonicToSecretKey(process.env.TEST_PAYER_MNEMONIC.trim());
    const prep = await call('/api/x402/wallet/prepare', {
      body: { resourceId: 'loan-request', payerAddress: payer.addr.toString(), context: { purpose: 'medical' } },
    });
    ok('prepare returns an unsigned txn', Boolean(prep.json.data?.unsignedTxn), prep.json.error);
    if (prep.json.data?.unsignedTxn) {
      const decoded = algosdk.decodeUnsignedTransaction(Buffer.from(prep.json.data.unsignedTxn, 'base64'));
      ok('server-built receiver is the hardcoded one', decoded.payment.receiver.toString() === RECEIVER);
      ok('server-built amount matches the price', String(decoded.payment.amount) === '50000');

      const signed = Buffer.from(decoded.signTxn(payer.sk)).toString('base64');
      const header = Buffer.from(JSON.stringify({
        x402Version: 2,
        accepted: prep.json.data.requirements,
        payload: { paymentGroup: [signed], paymentIndex: 0 },
      })).toString('base64');

      const members = await call('/api/members', { method: 'GET' });
      const memberId = members.json.data?.find((m) => m.role === 'member')?._id
        || members.json.data?.[0]?._id || '507f1f77bcf86cd799439011';

      const paid = await call('/api/loans/request', {
        body: { memberId, amount: 5000, purpose: 'medical emergency' },
        header,
      });
      ok('paid loan request returns 201', paid.status === 201, JSON.stringify(paid.json).slice(0, 200));
      ok('settled on chain', paid.json.data?.x402?.settlement === 'onchain', paid.json.data?.x402?.settlement);
      ok('X-PAYMENT-RESPONSE receipt attached', Boolean(paid.paymentResponse));
      if (paid.json.data?.x402) console.log('        tx:', paid.json.data.x402.explorerUrl);
    }
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})();
