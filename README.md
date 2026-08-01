# Saheli — SHG Chain

**Agentic AI + Algorand financial hub for India's Women Self-Help Groups.**

Built for **NexVerse — Algo + AI Hackathon** (Algorand Blockchain Club, Aurora University).
Tracks: *Blockchain with Algorand* · *Agentic AI × Blockchain*

> India has 9M+ Self-Help Groups where ~90M women pool savings and lend to each other. Their records are paper ledgers. Their credit history is invisible to every bank. Saheli puts that ledger on Algorand and hands it back to them through WhatsApp — no app, no wallet, no gas, no literacy barrier.

---

## Hackathon requirements

| Requirement | Status | Where |
|---|---|---|
| **x402 Pay-per-Use Payments** (mandatory) | ✅ x402 v2, `exact` scheme on `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe` — **gating the loan lifecycle itself**: a member's Pera Wallet pays before a loan request is accepted, a leader's pays before an approval settles | [`backend/src/x402/`](backend/src/x402/) |
| **AlgoKit** | ✅ 3 Algorand Python contracts, compiled to TEAL v11 | [`contracts/`](contracts/) |
| **Pera Wallet sign-in** | ✅ Challenge/response, single-use nonce, ed25519 verified server-side | [`backend/src/services/walletAuth.ts`](backend/src/services/walletAuth.ts) · [`app/src/lib/pera.ts`](app/src/lib/pera.ts) |
| **Agentic AI** | ✅ Autonomous compliance + treasury agent, OpenAI-reasoned | [`backend/src/services/aiMonitor.ts`](backend/src/services/aiMonitor.ts) |
| **Fully functional during evaluation** | ✅ 44/44 automated checks — `npm run verify` | [`backend/src/scripts/verify.ts`](backend/src/scripts/verify.ts) |

```bash
cd backend && npm run verify
```

```
ALL 44 CHECKS PASSED
```

---

## Running the complete project

Requires **Node 20+**. Nothing else — no MongoDB install, no Python, no Algorand node. The API starts an in-process database automatically if it can't reach one, and falls back to deterministic local settlement if the chain is unreachable.

### Terminal 1 — backend (port 3001)

```bash
cd backend && npm install && npm run dev
```

### Terminal 2 — frontend (port 5173)

```bash
cd app && npm install && npm run dev
```

### Terminal 3 — seed the demo SHG, then prove it all works

```bash
curl -X POST http://127.0.0.1:3001/api/auth/seed-demo -H "Content-Type: application/json" -d "{\"reset\":true}"
```

```bash
cd backend && npm run verify
```

Open <http://localhost:5173> and sign in.

| Role | Phone | Password |
|---|---|---|
| Member | `+91-9876543210` | `demo1234` |
| Leader | `+91-9000000001` | `demo1234` |
| Bank | `+91-9000000002` | `demo1234` |

WhatsApp MPIN: **1234** · Or skip passwords entirely and use **Connect Pera Wallet**.

Health check — proves every mandatory capability in one request: <http://127.0.0.1:3001/health>

### Everything at once (Docker)

```bash
docker compose up --build
```

Frontend <http://localhost:8080> · Backend <http://localhost:3001> · MongoDB `:27017`

### Optional — build and deploy the AlgoKit contracts

```bash
cd contracts && algokit project bootstrap all && algokit project run build
```

Compiled TEAL is already committed, so this is only needed to re-verify or deploy.

---

## Where to check things

| What you want to see | Where |
|---|---|
| **All transactions** | Bank → **Audit Directory** (searchable, filterable, exportable) · Leader → **Audit Logs** |
| One member's transactions | Member dashboard → **Audit Logs** (searchable, with status + explorer links) |
| **Download it all as Excel** | Bank → *Audit Directory* → **Full Pack (.xlsx)** — six sheets |
| **AI fraud detection** | Leader → **AI Insights** → *Fraud Monitor*. Hit **Simulate Threat** to watch it fire |
| **Government scheme advice** | Leader → **AI Insights** → *Idle Fund Advisor* |
| **Approving a loan** | Leader → *Approval Queue* — one card per loan, one click, treasury drops immediately |
| **Money leaving a wallet** | Member → *My Pera Wallet* → **Pay from Pera Wallet** (real TestNet transfer) |
| Transactions as raw JSON | `GET /api/transactions/ledger?limit=100` · `GET /api/transactions?memberId=<id>` |
| A single transaction on chain | `GET /api/algorand/tx/:txId`, or open `https://lora.algokit.io/testnet/transaction/<txId>` |
| Independent proof of a transaction | `GET /api/qr/verify/:transactionId` — checks Algorand first, our ledger second |
| **x402 gating a real action** | Member → **Request Loan** → *Pay 0.05 ALGO & Submit* · Leader → **Pay 0.05 ALGO & Approve** |
| **x402 working, visually** | Any dashboard → **x402 Pay-per-Use** |
| The 402 itself, raw | `curl -i -X POST http://127.0.0.1:3001/api/loans/request -H "Content-Type: application/json" -d "{}"` |
| x402 revenue routed to SHGs | `GET /api/x402/revenue`, or the revenue panel in the x402 console |
| Wallet/relayer/chain status | `GET /api/algorand/info` and `/health` · the banner on every dashboard |
| Your own profile / wallet / sign out | Click the **avatar in the top bar** |

> **Note on `txId` vs `transactionId`.** Ledger list responses carry both: `txId` is truncated for narrow UI rows, `transactionId` is the full 52-character Algorand id. Always use `transactionId` for lookups — the truncated one resolves to nothing.

---

## 1. x402 Pay-per-Use — and the business model behind it

Most hackathon x402 integrations bolt a paywall onto a demo endpoint. Ours **is the revenue model**.

An SHG's most valuable asset is its repayment history — and today banks, MFIs and NGOs extract it for free. Saheli inverts that: institutional access is metered per API call, and **the money flows back into the SHG treasury**.

### Two classes of priced resource

**A. Wallet-signed gates on the loan lifecycle** — settled in native ALGO by a human approving in **Pera Wallet**. These are not side features: the loan lifecycle *cannot proceed* without them.

| Resource | Price | Who pays | Receiver |
|---|---|---|---|
| `POST /api/loans/request` | 0.05 ALGO | **SHG member**, from her own Pera Wallet | hardcoded |
| `POST /api/multisig/:id/sign` | 0.05 ALGO | **SHG leader**, from his own Pera Wallet | hardcoded |

Call either without an `X-PAYMENT` header and you get a real HTTP **402** — no loan is created, no treasury moves. The member signs the underwriting fee on her device before her request is evaluated; the leader signs the disbursement fee before his approval counts. Both land in a receiver address hardcoded in [`backend/src/x402/pricing.ts`](backend/src/x402/pricing.ts), so the server owns the destination and a tampered client cannot redirect it.

These settle in **native ALGO (`asset: "0"`)** rather than USDC, deliberately: a freshly created Pera wallet holds only dispenser ALGO and is opted in to no ASA, so a USDC `axfer` could never clear on demo day.

**B. Machine-to-machine data resources** — settled in USDC by an institution's server key.

| Resource | Price | Who pays | → SHG |
|---|---|---|---|
| `GET /api/x402/credit-report/:shgId` | $0.25 | Bank underwriting | 80% |
| `GET /api/x402/member-passport/:memberId` | $0.10 | Bank / MFI | 90% |
| `POST /api/x402/verify-proof` | $0.01 | Fintech, at scale | 70% |
| `GET /api/x402/grant-eligibility/:shgId` | $0.50 | NGO / Government | 85% |
| `POST /api/x402/ai-underwriting` | $1.00 | **Autonomous AI agent** | 60% |

That last row is the agentic-commerce story: a bank's underwriting agent discovers the endpoint, receives a 402, pays autonomously, and consumes the answer — no invoice, no human, no account setup.

### The wallet-signed loop, end to end

```
Member taps "Pay 0.05 ALGO & Submit"
  │
  ├─ POST /api/loans/request                 → 402 Payment Required + PaymentRequirements
  ├─ POST /api/x402/wallet/prepare           → server builds the unsigned payment
  │                                            (receiver + amount fixed server-side)
  ├─ Pera Wallet signs on the device         → private key never leaves the phone
  ├─ POST /api/loans/request                 → retried with X-PAYMENT: base64(payload)
  │     ├─ facilitator.verify()              → 8 spec checks
  │     └─ facilitator.settle()              → broadcast to Algorand, wait for confirmation
  └─ 201 Created + X-PAYMENT-RESPONSE        → loan routed for approval
```

Run it yourself against a live server:

```bash
npm run verify:x402
```

16 assertions covering the 402 shape, the hardcoded receiver, native-ALGO settlement, tamper rejection (redirecting the payment and underpaying are both refused), and — importantly — that settlement genuinely reaches algod rather than silently faking a transaction id.

### Proving x402 actually ran — five independent pieces of evidence

**In the UI:** log in → **x402 Pay-per-Use** in the sidebar → click *1. Request without paying*, then *2. Pay and unlock*. The raw 402 body, all five protocol steps, and the unlocked resource render on screen.

**On the command line**, each step leaves a trace you can check yourself:

```bash
# EVIDENCE 1 — the gate is real. Unpaid requests get a spec-exact HTTP 402.
curl -i http://127.0.0.1:3001/api/x402/credit-report/shg1
```

Look for `HTTP/1.1 402 Payment Required`, the `Accept-Payment: exact algorand:SGO1…` header, and an `accepts[0]` carrying `scheme`, `network`, `asset`, `amount`, `payTo` and `extra.feePayer`.

```bash
# EVIDENCE 2 — the full handshake, one step at a time.
curl -X POST http://127.0.0.1:3001/api/x402/demo/pay -H "Content-Type: application/json" -d "{\"resourceId\":\"credit-report\"}"
```

Returns `steps[1..5]`: the challenge, the signed 2-transaction Algorand atomic group, the facilitator `verify` result (`isValid: true` plus the payer address), the `settle` result (transaction id + settlement mode), and the treasury credit. It also returns `paymentHeader` — the base64 `X-PAYMENT` value.

```bash
# EVIDENCE 3 — replay that header against the genuinely gated endpoint.
curl -i -H "X-PAYMENT: <paymentHeader from step 2>" http://127.0.0.1:3001/api/x402/credit-report/shg1
```

Now `HTTP/1.1 200 OK`. Two things prove payment was processed rather than skipped:
- the **`X-PAYMENT-RESPONSE`** response header — base64 JSON with `success`, `payer`, `transaction`, `network`
- the **`paidWith`** field in the body — resource id, payer, settlement mode and amount

Decode the receipt:

```bash
node -e "console.log(JSON.parse(Buffer.from(process.argv[1],'base64').toString()))" <X-PAYMENT-RESPONSE value>
```

```bash
# EVIDENCE 4 — every settled payment is persisted, with its revenue split.
curl http://127.0.0.1:3001/api/x402/revenue
```

`totals.calls` increments on each paid request, and `treasuryDisplay` is the share routed back to the SHG. `recent[]` lists each payment with its `transactionId`, `settlement` mode and `explorerUrl`.

```bash
# EVIDENCE 5 — payment is genuinely enforced, not decorative.
curl -i -H "X-PAYMENT: dGFtcGVyZWQ=" http://127.0.0.1:3001/api/x402/credit-report/shg1
```

A forged or malformed header returns 400/402 with a `verifyError.reason` — never the resource.

**The automated suite** (`cd backend && npm run verify`) asserts all of this and prints a pass/fail table, so you can demonstrate it in one command in front of a judge.

> **Settlement mode, stated honestly.** With an unfunded relayer, `settle` returns `settlement: "simulated"` and every response says so. The 402 gate, the payload structure, verification and the revenue split are all real regardless. Fund the relayer address from `/api/algorand/info` at the [TestNet dispenser](https://bank.testnet.algorand.network) and the same flow settles on chain with no config change.

### Implementation notes

Typed against the **official `@x402/core` and `@x402/avm` v2.20 packages**, so the payloads are structurally guaranteed to match the standard rather than merely resembling it.

- `PaymentRequirements`, `PaymentPayload`, `SettleResponse` — official types, not hand-rolled
- Verification implements all 8 checks from [`scheme_exact_algo.md`](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_algo.md): version, scheme, network, group size ≤16, msgpack decode, asset/amount/receiver match, fee-payer safety, group simulation
- `X-PAYMENT` / `X-PAYMENT-RESPONSE` headers, base64 JSON
- **Local facilitator by default** so the mandatory feature cannot be broken by third-party downtime mid-judging. Set `X402_FACILITATOR_URL=https://facilitator.goplausible.xyz` to settle through the public facilitator instead.

---

## 2. The autonomous AI agent

Two jobs, both running without a human in the loop.

### Job 1 — watch every rupee for fraud and illegal activity

The agent reads the entire ledger and applies nine money-laundering typologies. Detection is **deterministic** and runs on our own data; **OpenAI** then reasons about each signal, sets the final severity, and writes the recommendation a village SHG leader can act on. That split matters: with no API key the agent still detects and still files alerts — it just writes them itself.

| Typology | What it catches |
|---|---|
| **Structuring** | Legs deliberately kept under the ₹10,000 / ₹50,000 reporting bar that sum above it |
| **Round-tripping** | Money in, near-identical amount straight back out — the pool used as a pass-through |
| **Velocity** | Mule-account bursts: many movements in one hour against a weekly-cadence group |
| **Dormant spike** | A 45-day-silent account suddenly moving 5× its own average |
| **Over-exposure** | Borrowing beyond NABARD's 3× savings-linked credit ceiling |
| **Duplicate reference** | One settlement id credited to two different members |
| **Unverifiable anchor** | Rows marked confirmed with no resolvable Algorand txid |
| **Off-hours** | High-value movements between midnight and 5am |
| **Treasury drain** | Outflow overtaking inflow — the pool can no longer honour emergency lending |

Every alert carries a severity, a 0-100 risk score, the **regulatory basis** (PMLA §12, RBI KYC Master Direction §42, FATF R.20, NABARD norms) and a triage state that survives re-scans.

```bash
curl -X POST http://127.0.0.1:3001/api/ai-monitor/scan
curl http://127.0.0.1:3001/api/ai-monitor/alerts
```

**Show it live.** The demo ledger has two textbook patterns woven into its history, and *Simulate Threat* injects a fresh one and re-scans on the spot:

```bash
curl -X POST http://127.0.0.1:3001/api/ai-monitor/simulate-threat -H "Content-Type: application/json" -d "{\"pattern\":\"structuring\"}"
```

```
[critical] risk 86  structuring     Possible structuring by Meera Patel
    4 separate deposits totalling ₹37,600 inside 24h, each leg below the
    ₹10,000 reporting threshold (₹9,400 + ₹9,400 + ₹9,400 + ₹9,400).
```

### Job 2 — never let the savings sit idle

An SHG's pooled savings earning 0% is a real, measurable loss. The agent sizes the emergency-loan buffer first — because the group's core promise is same-day lending, and an 8% seven-year bond is worthless if a member can't get ₹5,000 for a hospital tonight — then allocates the rest across **Government of India instruments only**.

| Instrument | Rate | Liquidity | Why this group |
|---|---|---|---|
| 91-Day Treasury Bill | 6.8% | Instant | Sovereign parking for the emergency buffer |
| **Mahila Samman Savings Certificate** | 7.5% | 2 years | Women-only scheme — designed for exactly this saver |
| RBI Floating Rate Savings Bond | 8.05% | 7 years | Highest sovereign coupon; resets with inflation |
| National Savings Certificate | 7.7% | 5 years | Pledgeable at the linkage bank, so it still backs credit |
| Sovereign Gold Bond | 2.5% + gold | 8 years | Replaces the physical gold rural households already buy |

Plus Sukanya Samriddhi, POMIS, NABARD Rural Bonds and State Development Loans in the catalogue. No equities, no crypto, no private lending — sovereign and quasi-sovereign only.

```bash
curl http://127.0.0.1:3001/api/ai-monitor/investments
```

```
₹88,279 is sitting idle and earning nothing. Holding ₹30,000 back so any member
can still get an emergency loan the same day, the remaining ₹58,279 can go into
government schemes at a blended 6.92% — about ₹4,025 a year, or ₹335 every month
the group currently forgoes.
```

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/ai-monitor/status` | Agent health, provider, open-alert counts by severity |
| `POST /api/ai-monitor/scan` | Sweep the whole ledger and file findings |
| `GET /api/ai-monitor/alerts` | Triage queue, ranked by risk score |
| `POST /api/ai-monitor/alerts/:id/review` | Clear or escalate a finding |
| `GET /api/ai-monitor/investments` | Idle-fund allocation across government schemes |
| `POST /api/ai-monitor/ask` | Natural-language questions over the group's real figures |
| `POST /api/ai-monitor/simulate-threat` | Inject a live pattern and re-scan (demo) |

The agent also sweeps automatically every 5 minutes (`AI_MONITOR_INTERVAL_MS`) and screens each new transaction inline as it is written, so structuring is caught as it happens rather than in the next batch.

**Where to see it:** Leader → *AI Insights*, or Bank → *Grant Approval*. Members get a read-only view under *AI Assistant*.

---

## 3. Excel reporting

Every dataset downloads as a real `.xlsx` — typed dates, numeric currency cells, a frozen bold header and an autofilter — generated by a **zero-dependency writer** built on Node's `zlib` ([`services/xlsx.ts`](backend/src/services/xlsx.ts)). No SheetJS in the deployment.

| Report | Sheets |
|---|---|
| `GET /api/reports/transactions.xlsx` | Transactions · Summary |
| `GET /api/reports/full-ledger.xlsx` | Summary · Transactions · Members · Loans · Bank Disbursements · Compliance Alerts |
| `GET /api/reports/members.xlsx` | Member register with trust scores and wallet addresses |
| `GET /api/reports/loans.xlsx` | Loan book with approval state and AI recommendation |
| `GET /api/reports/compliance.xlsx` | Agent findings with regulatory basis |

Every report also serves `.csv` (UTF-8 BOM, so Excel reads ₹ and Devanagari names correctly). Filter transactions with `?memberId=`, `?type=`, `?status=`, `?limit=`.

**In the UI:** Bank → *Audit Directory* → **Full Pack (.xlsx)**; Leader → **Export Excel**; Member → *Audit Logs* → **Excel** (their own statement only).

---

## 4. WhatsApp banking — exactly like SBI

**Twilio only. Works on the Sandbox with no template approval.**

Rural women already know how to bank on WhatsApp: send `Hi`, get a numbered menu, reply with a number, enter your MPIN, confirm with `YES`. We copied that interaction model exactly, because familiarity *is* the accessibility feature.

```
You:  Hi
Bot:  🪷 Namaste Lakshmi Devi!
      🔐 Please reply with your 4-digit MPIN to continue.

You:  1234
Bot:  ✅ Verified.
      ╭───────────────────────────╮
         SAHELI WhatsApp Banking
      ╰───────────────────────────╯
      1 ⟩ Balance Enquiry        6 ⟩ Trust Score (d-SBT)
      2 ⟩ Deposit Money          7 ⟩ Get QR Proof
      3 ⟩ Mini Statement         8 ⟩ Withdraw Money
      4 ⟩ Request Loan           9 ⟩ Help & Support
      5 ⟩ Loan Status

You:  2
Bot:  💵 DEPOSIT MONEY — how much?

You:  500
Bot:  ⚠️ CONFIRM DEPOSIT
      Amount      : ₹500
      New balance : ₹25,000
      Network fee : ₹0 (paid by Saheli)
      Reply YES to confirm or NO to cancel.

You:  YES
Bot:  ✅ DEPOSIT SUCCESSFUL
      Tx ID : A7O5EKCJRJOQB7S627D64KQLHNOFGKITCFZ72TRNXYQUFJDLO7FQ
      🔗 https://lora.algokit.io/testnet/transaction/A7O5EK...
      📱 QR proof attached.
```

Also handled: MPIN lockout after 3 failures, 10-minute session expiry, `MENU`/`BACK`/`EXIT`/`HELP` from any state, and **voice notes** — a Hindi/Telugu voice note is transcribed by Whisper and skips straight to the confirmation step.

> **Is this achievable with Twilio alone? Yes.** Numbered menus are plain text messages, which the Twilio WhatsApp Sandbox supports immediately. Only *interactive button/list widgets* require an approved WhatsApp Business sender — and SBI doesn't use those either.

The in-browser simulator calls `/api/whatsapp/simulate`, which invokes **the same `handleWhatsAppMessage` state machine as the live webhook**. Demo and production cannot drift apart.

### Going live on Twilio

1. Twilio Console → Messaging → Try it out → **WhatsApp Sandbox**
2. Send the join code to `+1 415 523 8886` from your phone
3. Expose the backend: `npx ngrok http 3001`
4. Set the sandbox webhook to `https://<ngrok>.ngrok.io/webhook/whatsapp` (POST)
5. Put `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, and `PUBLIC_BASE_URL` in `backend/.env`
6. Message `Hi` from a seeded member number

---

## 5. Pera Wallet sign-in — and real wallet settlement

Saheli derives custodial accounts for members who cannot safeguard a seed phrase — that is the right trade-off for a rural SHG member, and it is documented under *Known limits*. But SHG leaders, bank officers and NGO auditors **can** hold their own keys, and they should not have to trust us with a password either.

So there are two ways in: phone + password, or **Connect Pera Wallet**.

### How it works

```
Client                          Server                        Pera Wallet
  │  POST /auth/wallet/challenge   │                                │
  │  { address } ─────────────────>│                                │
  │                                │  mint single-use nonce (5 min) │
  │  <──── { nonce, message } ─────│                                │
  │                                                                 │
  │  signData("MX" || message) ────────────────────────────────────>│
  │  <──────────────────────── ed25519 signature ───────────────────│
  │                                │                                │
  │  POST /auth/wallet/verify      │                                │
  │  { address, nonce, sig } ─────>│  verify sig against the        │
  │                                │  address' public key,          │
  │                                │  burn the nonce                │
  │  <──────── { user, JWT } ──────│                                │
```

- **No key, seed phrase or password ever reaches the server.** Only a signature over text the server itself issued.
- **The nonce is single-use and expires in 5 minutes.** It is burned on the first verification attempt whatever the outcome, so a captured signature cannot be replayed.
- **`"MX"` prefix.** Algorand's domain separator for signing arbitrary (non-transaction) bytes. Both sides prepend it, matching `PeraWalletConnect.verifySignature` exactly — so a signature can never be mistaken for a transaction authorisation.
- **Costs nothing.** It is a signature, not a transaction: no fee, no chain write, no funds moved.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/wallet/challenge` | Mint a nonce for an address. Also reports whether the wallet is already known. |
| `POST /api/auth/wallet/verify` | Exchange a signature for a JWT. Creates the account on first sign-in. |
| `POST /api/auth/wallet/link` | Attach a wallet to an account that is already signed in (password → self-custody upgrade). |

First signature for an address creates the account with the role selected on the sign-in screen. Returning wallets keep the profile they already have. Existing password users can link a wallet from the **profile menu** in the top bar without losing their history.

### Real settlement — money genuinely leaving the wallet

Sign-in is a signature. **Settlement is a payment**, and it follows the same trust model: the server builds the transaction, the wallet approves it, the server broadcasts it.

```
Client                            Server                        Pera Wallet
  │  POST /algorand/payment/prepare  │                               │
  │  { fromAddress, amountInr } ────>│  build unsigned payment,      │
  │                                  │  check the payer can cover it │
  │  <──── { unsignedTxn, txId } ────│                               │
  │                                                                  │
  │  signTransaction(unsignedTxn) ──────────────────────────────────>│
  │  <───────────────────── signed blob ─────────────────────────────│
  │                                  │                               │
  │  POST /algorand/payment/submit   │                               │
  │  { signedTxn } ─────────────────>│  broadcast → waitForConfirm   │
  │                                  │  THEN write the ledger row    │
  │  <──── { txId, round, ... } ─────│  and move the balances        │
```

Two things this buys:

- **The client cannot forge a credit.** The receiver and amount are fixed server-side, and the ledger is only written *after* algod confirms the transfer. The database is never credited for money that did not move.
- **The explorer link always resolves**, regardless of relayer funding.

Rupees settle against a demo peg (`INR_TO_MICROALGO`, default ₹1 = 0.0001 ALGO), so a single 10-ALGO dispenser top-up covers ₹100,000 of demo movement.

### The 0.1 ALGO minimum balance — why a small first payment is refused

Algorand requires **every** account to hold at least 0.1 ALGO, and the transaction pool rejects any payment that would leave the *receiver* below that line. At the default peg, ₹500 is only 0.05 ALGO — so the very first payment into a never-funded treasury fails with:

```
TransactionPool.Remember: account A7CHNC2C… balance 50000 below min 100000
```

Saheli pre-flights **both sides** before building the transaction, so this surfaces as a clear message *before* anything is signed, never as a rejection afterwards:

```bash
curl "http://127.0.0.1:3001/api/algorand/payment/quote"
```

```json
{ "to": { "algos": 0, "funded": false }, "minimumInr": 1000,
  "reason": "The destination has never been funded, so the first payment must carry it to Algorand's 0.1 ALGO minimum — at least ₹1,000." }
```

The payment button reads that quote, states the minimum inline and stays disabled below it. Two ways past it: send at least the stated minimum, or fund the destination address once at the dispenser — after which any amount works. Raw pool errors are also translated into plain English at submit time, since state can change between prepare and submit.

| Where | What it does |
|---|---|
| Member → *My Pera Wallet* | Deposit savings, repay a loan — debits the member's wallet |
| Leader → *Settle a Payout On-Chain* | Pay a member — debits the leader's wallet, credits the member |

`GET /api/algorand/balance/:address` returns the live on-chain balance, so the card shows what the wallet really holds rather than what the app believes.

### Verified behaviour

`npm run verify` exercises the real endpoints with a throwaway keypair, signing exactly the way Pera does:

```
PASS  Wallet challenge issued with a single-use nonce
PASS  Valid Pera signature issues a JWT session
PASS  Replayed nonce is refused
PASS  Signature from a different key is rejected
PASS  Wallet session authenticates against a protected route
```

Set `VITE_ALGORAND_NETWORK` (frontend) to match `ALGORAND_NETWORK` (backend) — `testnet` by default. Pointing the wallet at a different chain than the API is the one way to misconfigure this.

---

## 6. Algorand

Every transaction id in this project is a **real 52-character Algorand txid**, and every explorer link resolves.

- **Gasless.** Members never hold ALGO. The relayer contributes a fee-pooling transaction so member transfers carry `fee=0`.
- **Walletless.** Member accounts are derived deterministically (HMAC-SHA512 → 32-byte seed → Algorand keypair). Same member, same address, no key management, no seed phrase to lose.
- **Atomic multi-sig.** Leader approvals are bundled into a single atomic group — all approvals land in one block or none do, so funds cannot move on a partial quorum.
- **Note anchoring.** Ledger records are written as the note of a 0-amount payment: real, verifiable, needs no ASA opt-in, costs 0.001 ALGO.

### "I can't find my transaction on Lora" — read this

If a transaction id doesn't resolve on [Lora](https://lora.algokit.io/testnet), it is because **the relayer is unfunded**, not because anything is broken.

The backend connects to TestNet on boot. If the relayer holds ALGO it broadcasts for real; if it holds nothing it cannot pay the 0.001 ALGO fee, so it falls back to deterministic local anchoring and labels the row `simulated`. The id is a well-formed 52-character base32 string, but it was never broadcast, so the explorer has nothing to show.

**This has nothing to do with deployment.** You do *not* need to deploy the project to get transactions on TestNet — localhost talks to the same public network. There are exactly two ways to get explorer-resolvable ids:

**Option A — fund the relayer (30 seconds, fixes everything globally)**

```bash
curl -s http://127.0.0.1:3001/api/algorand/info
```

Copy `relayer.address`, paste it into the [TestNet dispenser](https://bank.testnet.algorand.network), and dispense. Every transaction from that moment settles on chain. No restart, no config change — the health cache re-probes within 30 seconds. The amber banner at the top of every dashboard turns green and shows the current round.

**Option B — pay from your own Pera Wallet (works even with an unfunded relayer)**

Any *Pay from Pera Wallet* button builds the payment server-side, has Pera sign it on your device, broadcasts it, and waits for confirmation before touching the ledger. Those ids are always real. Fund your own Pera TestNet account at the same dispenser.

**Telling them apart in the UI:** every ledger row carries a badge. `on-chain` (green) renders as a clickable explorer link because it resolves; `local only` (grey) renders as plain text, because linking an id that was never broadcast just produces a "Transaction not found" page and a console 404. Nothing is ever presented as on-chain when it isn't.

```bash
# Which mode am I in, and why?
curl http://127.0.0.1:3001/api/algorand/health
```

---

## 7. AlgoKit smart contracts

Algorand Python (`algopy`), compiled with `puyapy` 5.9 to **TEAL v11**. Compiled artifacts are committed so they can be verified without a Python toolchain.

| Contract | ABI methods | Purpose |
|---|---|---|
| [`ShgTreasury`](contracts/smart_contracts/shg_treasury/contract.py) | 10 | Pooled savings, quorum-gated withdrawals, agentic emergency lending |
| [`X402Gateway`](contracts/smart_contracts/x402_gateway/contract.py) | 5 | On-chain x402 receipts with a chain-enforced revenue split |
| [`DsbtRegistry`](contracts/smart_contracts/dsbt_registry/contract.py) | 10 | Dynamic Soulbound credit passports |

Two details worth a judge's attention:

- `ShgTreasury._group_carries_approvals` asserts `Global.group_size >= approvals + 1`. A caller cannot simply *claim* three approvals — three real leader-signed transactions must be in the same atomic group.
- `DsbtRegistry` mints passports with `total=1`, `default_frozen=True`, and freeze/clawback retained by the application, and **exposes no transfer method at all**. Reputation is structurally unsellable.

See [`contracts/README.md`](contracts/README.md) to build and deploy.

---

## 8. Dynamic Soulbound Tokens (d-SBT)

A static credit score tells a bank one number it has to trust. A d-SBT tells it the whole story.

Every repayment, deposit streak, or default rewrites the score, recomputes the tier, and **re-anchors the new state on chain**. A lender reads the trajectory, not a snapshot.

| Tier | Score | Credit multiplier |
|---|---|---|
| 🥉 Bronze | 0–649 | 1× savings |
| 🥈 Silver | 650–799 | 2× savings |
| 🥇 Gold | 800–899 | 3× savings |
| 💎 Platinum | 900–1000 | 5× savings |

---

## Architecture

```
Saheli/
├── contracts/                       AlgoKit — Algorand Python
│   ├── smart_contracts/
│   │   ├── shg_treasury/            multi-sig pooled treasury
│   │   ├── x402_gateway/            pay-per-use receipts + revenue split
│   │   └── dsbt_registry/           dynamic soulbound passports
│   └── artifacts/                   compiled TEAL v11 + ARC-56 (committed)
│
├── backend/                         Node + Express + TypeScript
│   └── src/
│       ├── x402/                    ★ MANDATORY REQUIREMENT
│       │   ├── facilitator.ts         verify/settle, exact-AVM spec
│       │   ├── middleware.ts          the HTTP 402 gate
│       │   ├── payer.ts               atomic group builder (client side)
│       │   └── pricing.ts             price catalogue + revenue split
│       ├── services/
│       │   ├── algorand.ts            chain layer: accounts, anchoring, gasless
│       │   ├── walletPayments.ts      ★ real Pera-signed settlement (prepare/submit)
│       │   ├── aiMonitor.ts           ★ fraud typologies + government scheme advisor
│       │   ├── openai.ts              LLM client, degrades to rules when absent
│       │   ├── loanWorkflow.ts        ★ single-leader approval + treasury debit
│       │   ├── xlsx.ts                zero-dependency Excel writer
│       │   ├── whatsappBanking.ts     SBI-style state machine
│       │   ├── dsbt.ts                soulbound passports
│       │   ├── agentEngine.ts         autonomous treasury agent
│       │   └── seed.ts                realistic demo SHG + planted AML patterns
│       ├── routes/
│       └── scripts/verify.ts        44-check end-to-end suite
│
└── app/                             React 19 + Vite + Tailwind
    └── src/components/
        ├── X402Console.tsx           the protocol, visualised
        ├── AIAgentPanel.tsx          ★ fraud monitor · fund advisor · agent Q&A
        ├── PeraPaymentButton.tsx     ★ prepare → sign → broadcast, three steps
        ├── ChainStatusBanner.tsx     states honestly whether txids resolve
        └── WhatsAppDemo.tsx          drives the real state machine
```

---

## Demo script for judges (7 minutes)

**Before you start:** fund the relayer at the [TestNet dispenser](https://bank.testnet.algorand.network) using the address from `/api/algorand/info`. Takes 30 seconds and turns every explorer link live.

1. **Open `/health`** — Algorand round number, x402 config and AI agent status in one screenshot. Nothing to click.
2. **Log in as Bank** → *x402 Pay-per-Use* → **"Request without paying"**. A real HTTP 402 with spec-exact `PaymentRequirements`. Then **"Pay $0.25 and unlock"** — five protocol steps, then a credit report with an actual lending decision.
3. Scroll to **revenue** — that $0.20 went to the SHG treasury. *This is how the women get paid for their own data.*
4. **Bank → Audit Directory** — 90+ anchored movements, every txid a live explorer link. Hit **Full Pack (.xlsx)** and open the six-sheet workbook in Excel in front of them.
5. **Leader → AI Insights → Fraud Monitor.** Two findings are already there: a `critical` structuring pattern and a `high` round-trip, each with its regulatory basis. Now hit **Simulate Threat** — the agent catches a brand-new laundering pattern within one sweep, live.
6. **Switch to *Idle Fund Advisor*** — the agent has allocated the group's idle savings across Mahila Samman Savings Certificate, T-Bills and RBI Floating Rate Bonds, and tells them exactly how many rupees a month idleness is costing.
7. **Leader → Treasury.** Note the liquidity figure, approve a pending loan with **one click**, watch the treasury drop by exactly that amount. Decline another — the rest of the queue is untouched.
8. **Member → My Pera Wallet → Pay from Pera Wallet.** Approve on the phone. Real ALGO leaves the wallet, the balance drops, and the resulting txid opens on Lora.
9. **Open the WhatsApp assistant** → `Hi` → `1234` → 🎙️ *"I need 5000 rupees urgently for hospital"* → `YES`. Emergency loan evaluated against the on-chain trust score, with a QR proof.
10. **`cd backend && npm run verify`** — 44/44, live, in front of them.

---

## Environment

Everything is optional. The stack runs with an empty `.env`.

```bash
cp backend/.env.example backend/.env
```

| Variable | Effect if unset |
|---|---|
| `MONGODB_URI` | In-process database starts automatically — **and is wiped on every restart** |
| `ALGORAND_RELAYER_MNEMONIC` | Deterministic derived relayer; fund it to go live |
| `INR_TO_MICROALGO` | ₹1 settles as 100 microAlgos in Pera-signed payments |
| `X402_FACILITATOR_URL` | Built-in local facilitator (no external dependency) |
| `TWILIO_*` | Browser simulator still works; live WhatsApp disabled |
| `OPENAI_API_KEY` | **AI agent still detects fraud and allocates funds** using its rule engine; LLM reasoning, narratives and Q&A are disabled, and voice transcription is off |
| `AI_MONITOR_INTERVAL_MS` | Agent sweeps the full ledger every 5 minutes |
| `SARVAM_API_KEY` | Falls back to LibreTranslate, then passthrough |
| `JWT_SECRET` | Falls back to a public default — **must be set in production** |
| `WALLET_CHALLENGE_TTL_MS` | Pera sign-in challenges expire after 5 minutes |
| `VITE_ALGORAND_NETWORK` (frontend) | Pera Wallet connects to TestNet |

## Deployment

### Locally, everything at once

```bash
docker compose up --build
```

Frontend `:8080` · Backend `:3001` · MongoDB `:27017`

### Free hosting that fits this stack

The frontend is a static Vite bundle and the backend is a long-running Node process, so they want different hosts. Every option below has a genuinely free tier.

| Piece | Recommended free host | Notes |
|---|---|---|
| **Frontend** (`app/`) | **Vercel** or **Netlify** or **Cloudflare Pages** | Build `npm run build`, publish `dist`. All three give unlimited static bandwidth on the free plan and a HTTPS domain. |
| **Backend** (`backend/`) | **Render** free web service | Build `npm install && npm run build`, start `npm start`. Free instances sleep after ~15 min idle and take ~50 s to wake — **hit `/health` right before demoing**. |
| Backend alternative | **Railway** ($5 monthly credit) or **Fly.io** | No cold starts on Fly's free allowance. Railway's credit covers a hackathon comfortably. |
| **Database** | **MongoDB Atlas M0** | 512 MB, free forever. Paste the connection string into `MONGODB_URI`. Allow `0.0.0.0/0` in Network Access or the host cannot reach it. |
| Everything in one box | **Render** (single service) | Build the frontend into the backend and set `FRONTEND_DIST_PATH` — the API already serves `dist/` and falls back to `index.html` for client routes. One URL, no CORS. |

**Deploying frontend and backend separately** — set these before building:

```bash
# app/.env.production
VITE_API_BASE_URL=https://your-api.onrender.com/api
VITE_ALGORAND_NETWORK=testnet
```

```bash
# backend environment
CORS_ORIGINS=https://your-app.vercel.app
MONGODB_URI=<your Atlas connection string>
JWT_SECRET=<a long random string>
NODE_ENV=production
```

`CORS_ORIGINS` and `JWT_SECRET` are the two that actually bite: without the first the browser blocks every call, and without the second you ship with a publicly known signing key.

**Cheapest reliable setup for judging:** Vercel (frontend) + Render (backend) + Atlas M0 (database). Zero cost, HTTPS everywhere, and Twilio can reach the webhook without ngrok.

### Pre-deployment checklist

- [ ] `JWT_SECRET` set to something long and random
- [ ] `CORS_ORIGINS` set to the deployed frontend origin
- [ ] **`MONGODB_URI` pointing at Atlas**, with the host's IP allowed — without it the API falls back to an in-process database that is **wiped on every restart**, which on a free host means every cold start
- [ ] `VITE_API_BASE_URL` baked in at build time (Vite inlines it — setting it at runtime does nothing)
- [ ] `VITE_ALGORAND_NETWORK` matches the backend's `ALGORAND_NETWORK`
- [ ] `PUBLIC_BASE_URL` set to the public HTTPS URL, so QR proofs carry scannable links
- [ ] `ALGORAND_RELAYER_MNEMONIC` set to a **funded** account, or fund the derived one from `/api/algorand/info` — otherwise every txid is `simulated` and no explorer link resolves
- [ ] `OPENAI_API_KEY` set if you want the agent to reason rather than fall back to its rule engine
- [ ] Seed once after deploying: `curl -X POST https://your-api/api/auth/seed-demo -d '{"reset":true}'`
- [ ] `npm run verify -- --url https://your-api.onrender.com` passes against the deployed API

## Scripts

**Backend**

| Command | Purpose |
|---|---|
| `npm run dev` | Start backend with auto-reload |
| `npm run verify` | 44-check end-to-end suite (backend must be running) |
| `npm run typecheck` | Strict TypeScript, zero errors |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |

**Frontend**

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on `:5173`, proxying `/api` and `/health` to `:3001` |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |

---

## Known limits

Stated plainly, because a judge will find them anyway:

- **Custodial keys for members.** Member accounts are derived from a platform master seed. That's the correct trade-off for users who cannot safeguard a seed phrase, but it means the platform is trusted for those accounts. Leaders, banks and NGOs can sign in with Pera Wallet instead and hold their own keys. Production belongs in an HSM/KMS with threshold signing.
- **Wallet challenges are held in memory.** Single-use and expiring in minutes, so persisting them buys nothing — but a multi-instance deployment behind a load balancer needs Redis here, or a challenge issued by one instance won't verify on another.
- **Settlement mode.** Live on-chain settlement needs a funded relayer. Unfunded, the API says `simulated` — never anything stronger.
- **Contracts compile but are not deployed.** TEAL is committed and verifiable; deploying needs a funded TestNet account (`algokit project deploy`). The backend anchors to chain regardless.
- **DeFi yield is modelled.** Folks Finance / Tinyman APYs drive a simulation; live pool integration is the next step, not a claim we make.
- **Government scheme rates are indicative.** The allocator uses published small-savings and RBI rates and says so on every response. Actually subscribing to NSC or MSSC happens at a post office, not over an API — Saheli produces the instruction, not the execution.
- **The demo ledger contains two planted AML patterns.** They are labelled `red-team pattern` in their descriptions. They exist so the fraud detector has something real to find; the agent is given no hint they are there and catches them with the same rules it runs against genuine activity.
- **Demo MPIN is `1234`** for every seeded account.
