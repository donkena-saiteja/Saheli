# Saheli — Jury Demo Runbook

Follow top to bottom. Everything here has been run end-to-end; nothing is aspirational.

**Total time:** 10 min prep (once, the night before) + 7 min live.

---

## PART 0 — Prep (do this BEFORE the jury arrives)

### 0.1 Start the stack

```bash
cd backend && npm install && npm run dev
```

```bash
cd app && npm install && npm run dev
```

Backend on `:3001`, frontend on `:5173`. Leave both running.

### 0.2 ⚠️ Fund the relayer — THE most important step

**Without this, no transaction id resolves on Lora and your whole chain story collapses.**

```bash
curl -s http://127.0.0.1:3001/api/algorand/info
```

Copy the `relayer.address` value. Then:

1. Open <https://bank.testnet.algorand.network>
2. Paste the address, solve the captcha, **Dispense**
3. Do it **twice** (≈10 ALGO total — plenty for a demo)

Confirm it took:

```bash
curl -s http://127.0.0.1:3001/api/algorand/health
```

You want `"mode": "live"`. If it still says `simulated`, wait 30 seconds (the health check caches) and re-run.

> **How you know it worked in the UI:** the banner at the top of every dashboard turns **green** and shows the current round number. If it is **amber**, you are still in simulated mode — stop and fix it before demoing.

### 0.3 Seed the demo SHG

```bash
curl -X POST http://127.0.0.1:3001/api/auth/seed-demo -H "Content-Type: application/json" -d "{\"reset\":true}"
```

### 0.4 Generate at least one REAL on-chain transaction

Now that the relayer is funded, make one movement so you have a live txid ready to show:

```bash
curl -s http://127.0.0.1:3001/api/members | python -c "import json,sys; print(json.load(sys.stdin)['data'][0]['_id'])"
```

```bash
curl -X POST http://127.0.0.1:3001/api/transactions -H "Content-Type: application/json" -d "{\"memberId\":\"PASTE_ID_HERE\",\"type\":\"deposit\",\"amount\":500,\"description\":\"Demo prep deposit\"}"
```

The response contains `transactionId`, `explorerUrl` and `chainMode`. **`chainMode` must say `live`.** Keep that explorer URL open in a browser tab — it is your Lora proof.

### 0.5 Dry-run the verification suite

```bash
cd backend && npm run verify
```

You want `ALL 46 CHECKS PASSED`. This is your safety net — if a judge doubts anything, you run this.

### 0.6 Optional but strong: OpenAI key

Put `OPENAI_API_KEY=sk-...` in `backend/.env` and restart. The AI agent then *reasons* about fraud instead of using its rule engine, and the panel says "OpenAI" instead of "Rule engine". It works either way — this just makes the agentic story stronger.

### Pre-flight checklist

- [ ] Chain banner is **green**, not amber
- [ ] `npm run verify` → 46/46
- [ ] A live Lora tab is open with a real transaction
- [ ] Three browser windows logged in: Member, Leader, Bank
- [ ] `https://lora.algokit.io/testnet` bookmarked

**Logins** — password `demo1234` for all three:

| Role | Phone |
|---|---|
| Member (Lakshmi Devi) | `+91-9876543210` |
| Leader (Leader Priya) | `+91-9000000001` |
| Bank (Bank Manager) | `+91-9000000002` |

---

## PART 1 — The 7-minute live demo

### Minute 0–1 · The problem and the proof it runs

Open **<http://127.0.0.1:3001/health>**.

> "9 million Self-Help Groups in India, 90 million women, paper ledgers, invisible to every bank. This is the whole system in one screenshot — Algorand round number, x402 configuration, the AI agent, all live."

Point at: `algorand.settlementMode: "live"`, `x402.enabled: true`, `aiAgent.provider`.

### Minute 1–3 · x402 gating a real action  ★ LEAD WITH THIS

> **Setup:** two Pera Wallet accounts on TestNet, each holding at least 0.2 ALGO — one for the member, one for the leader. Both must be on **TestNet** in Pera's settings.

**Step 1 — show the gate before you pay it.** In a terminal:

```bash
curl -i -X POST http://127.0.0.1:3001/api/loans/request -H "Content-Type: application/json" -d "{}"
```

> "Requesting a loan returns a real HTTP **402 Payment Required**. Not a mock, not a paywall on a demo endpoint — this is the actual loan route. Scheme `exact`, the Algorand CAIP-2 network id, asset `0` meaning native ALGO, price 50000 microAlgos, and a `payTo` address hardcoded in the backend."

**Step 2 — member pays.** Log in as **Member** (sign in with Pera Wallet) → **Request Loan** → enter ₹5,000, pick *Medical* → **Pay 0.05 ALGO & Submit**.

Narrate the five steps as they light up on screen:

| Step | Say this |
|---|---|
| 1 | "The 402 challenge — the price and the terms the server advertised." |
| 2 | "The server builds the payment. Note that: **the server** decides the receiver and the amount, so the browser can't redirect the money." |
| 3 | "Pera asks her to approve it. **Her private key never leaves her phone.**" |
| 4 | "The facilitator runs all 8 checks from the exact-AVM spec, then broadcasts to Algorand and waits for confirmation." |
| 5 | "Only now does the loan exist." |

**Open the transaction id in Lora.** It resolves — real TestNet, real money, real finality.

**Step 3 — leader pays.** Switch to **Leader** → the approval queue → **Pay 0.05 ALGO & Approve**. Same five steps, different wallet, different payer role.

> "So x402 isn't decorating this product — it's load-bearing. A loan cannot be requested and cannot be approved without a settled on-chain payment from the specific person doing it. If the payment fails, nothing happens: no loan, no treasury movement."

**If a judge asks "did you just fake the txid?":**

```bash
cd backend && npm run verify:x402
```

> "Sixteen assertions. Including one that specifically proves settlement reaches the Algorand node rather than silently returning a fabricated transaction id — we pay from an empty wallet and assert that **algod itself** rejects it."

### Minute 3–4 · x402 as a business model

Log in as **Bank** → sidebar → **x402 Pay-per-Use**.

**Click `1. Request without paying`.**

> "A real HTTP 402 Payment Required. This is the spec-exact `PaymentRequirements` object — scheme `exact`, network is the Algorand CAIP-2 identifier, the asset is USDC, the price is 250000 atomic units."

**Click `2. Pay $0.25 and unlock`.**

Walk the five steps as they render:

| Step | Say this |
|---|---|
| 1 | "Server advertises the price." |
| 2 | "Client builds a **2-transaction Algorand atomic group**. Fees are pooled by the relayer, so the payer spends no ALGO." |
| 3 | "Facilitator verifies — all 8 checks from the exact-AVM spec. `isValid: true`, and here is the payer address." |
| 4 | "Facilitator settles and returns a transaction id." |
| 5 | "Resource unlocked, and **80% of that $0.25 routed to the SHG treasury**." |

Then scroll to the revenue panel:

> "This is the part I actually care about. An SHG's repayment history is its most valuable asset, and today banks extract it for free. Here, institutional access is metered per call and **the money flows back to the women**. That's not a paywall bolted onto a demo — it is the business model."

Scroll to **Wallet-signed gates**:

> "And these two are the loan gates you just saw me pay. Same protocol, same facilitator — but settled by a person in Pera rather than a server key. There's the hardcoded receiver address and its live balance; you watched it go up twice."

### Minute 3–4.5 · The AI agent catching fraud, live

Switch to **Leader** → **AI Insights** → *Fraud Monitor*.

> "This agent reads every transaction the group makes. It already found two things."

Point at the `critical` **structuring** finding:

> "Four deposits of ₹9,400 within 24 hours — each one deliberately under the ₹10,000 reporting threshold, together ₹37,600. That is textbook structuring under PMLA Section 12. The agent cites the regulation and tells the leader exactly what to do."

**Now click `Simulate Threat`.**

> "I'll inject a brand-new laundering pattern right now — the agent has no idea it's coming."

Within seconds a new finding appears.

> "Caught in one sweep. Nine typologies: structuring, round-tripping, velocity, dormant-account spikes, over-exposure, duplicate settlement references. Detection is deterministic so it's auditable; OpenAI does the reasoning and writes the recommendation."

Switch to the **Idle Fund Advisor** tab:

> "Second job. Pooled savings earning zero percent is a real loss. The agent holds back an emergency buffer — because this group's promise is a same-day loan when someone's child is in hospital — and puts the rest into **Government of India instruments only**. Mahila Samman Savings Certificate, which is a women-only scheme. Treasury Bills. RBI Floating Rate Bonds. And it tells them exactly what idleness costs per month."

### Minute 4.5–5.5 · One-click approval, money actually moving

Stay as **Leader** → **Treasury Management**.

Read the **Total Liquidity** figure out loud. Then in the **Approval Queue**:

**Click `Approve` on one loan.**

> "One SHG leader, one signature. Watch the treasury."

The liquidity figure drops by exactly the loan amount, and the toast states the new balance.

**Click `Decline` on another** (type any reason):

> "And declining one touches only that request — the rest of the queue is untouched."

### Minute 5.5–6.5 · The Lora proof

Switch to **Bank** → **Audit Directory**.

> "Every movement, anchored on Algorand."

Point at the badges:

> "Green `on-chain` means it was broadcast and confirmed — that link resolves. Grey `local only` would mean it wasn't. We never dress one up as the other."

**Click a green transaction id.** Lora opens in a new tab.

> "That's the transaction on Algorand TestNet. Sender, receiver, round, and the note field carries our ledger record — the SHG's own data, on a public chain, verifiable by anyone without asking us."

Back in the app, click **Full Pack (.xlsx)** and open it in Excel:

> "Six sheets — summary, transactions, members, loans, disbursements, compliance findings. A bank officer gets the whole audit in a format they already use."

### Minute 6.5–7 · Close with the verification suite

```bash
cd backend && npm run verify
```

> "46 automated checks against the running system. x402, Algorand, Pera Wallet signatures, single-leader approval, treasury debits, fraud detection, government-scheme advice, Excel integrity. Nothing here is a mock."

---

## PART 2 — Verifying transactions on Lora (what to do if a judge asks)

### The one-liner

> "Take any transaction id from the app, put it on `lora.algokit.io/testnet`, and it's there."

### Step by step

**1. Get an id from the app**
Bank → Audit Directory → any row with a green `on-chain` badge. Click it (opens Lora directly), or copy the 52-character id.

**2. Or get one from the API**

```bash
curl -s "http://127.0.0.1:3001/api/transactions/ledger?limit=5"
```

Use the **`transactionId`** field — the full 52 characters. Do *not* use `txId`, which is truncated for narrow UI rows and resolves to nothing.

**3. Verify it three independent ways**

| Method | Command / URL |
|---|---|
| Lora explorer | `https://lora.algokit.io/testnet/transaction/<transactionId>` |
| Our API, reading the chain | `curl http://127.0.0.1:3001/api/algorand/tx/<transactionId>` |
| Raw Algorand indexer (nothing of ours involved) | `https://testnet-idx.algonode.cloud/v2/transactions/<transactionId>` |

That third one is the strongest: it is a public Algorand node with no Saheli code in the path.

**4. What the judge sees on Lora**

- Sender / receiver
- Confirmed round and timestamp
- Fee (paid by the relayer — the member spends nothing)
- **The note field**, containing the JSON ledger record: `{"app":"saheli-shg-chain","kind":"deposit","memberId":...}`

> "That note is the SHG's ledger entry. It's immutable, timestamped and public."

### If a judge asks "why does this one say local only?"

Be straight — it scores better than hedging:

> "That entry was written while the relayer was unfunded, so it was anchored locally instead of broadcast. We label it rather than pretend. Every green one is real. And any 'Pay from Pera Wallet' action settles on chain regardless of the relayer."

### Live wallet settlement (the strongest single moment, if you have a funded Pera wallet)

Member → **My Pera Wallet** → enter **₹1,000** or more → **Pay from Pera Wallet** → approve on your phone.

> "That's real ALGO leaving my wallet."

The balance drops, and the receipt shows a transaction id that opens on Lora immediately.

⚠️ **Minimum is ₹1,000 on the first payment to an unfunded address.** Algorand requires every account to hold at least 0.1 ALGO, and ₹500 is only 0.05 ALGO. The app tells you this and disables the button — but know it before you're on stage. After the first payment, any amount works.

---

## PART 3 — Verifying x402 (five pieces of evidence)

Run these in a terminal beside the browser. Each one proves something different.

### Evidence 1 — the gate is real

```bash
curl -i http://127.0.0.1:3001/api/x402/credit-report/shg1
```

Point at:
- `HTTP/1.1 402 Payment Required`
- `Accept-Payment: exact algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe`
- `accepts[0]` with `scheme`, `network`, `asset`, `amount`, `payTo`, `extra.feePayer`

> "That CAIP-2 network identifier is the Algorand TestNet genesis hash. It has to match `@x402/avm`'s constant exactly or verification fails — we're typed against the official packages, not hand-rolling the payload."

### Evidence 2 — the full handshake

```bash
curl -X POST http://127.0.0.1:3001/api/x402/demo/pay -H "Content-Type: application/json" -d "{\"resourceId\":\"credit-report\"}"
```

Returns `steps[1..5]` and a base64 `paymentHeader`. Step 3 shows `isValid: true` plus the payer address; step 4 shows the settlement id and mode.

### Evidence 3 — replay it against the genuinely gated endpoint

```bash
curl -i -H "X-PAYMENT: <paymentHeader from step 2>" http://127.0.0.1:3001/api/x402/credit-report/shg1
```

Now `HTTP/1.1 200 OK`. Two things prove payment was processed rather than skipped:

- the **`x-payment-response`** header — base64 JSON with `success`, `payer`, `transaction`, `network`
- **`paidWith`** in the body — resource id, payer, settlement mode, amount

Decode the receipt in front of them:

```bash
node -e "console.log(JSON.parse(Buffer.from(process.argv[1],'base64').toString()))" <x-payment-response value>
```

### Evidence 4 — payments are persisted with their revenue split

```bash
curl http://127.0.0.1:3001/api/x402/revenue
```

`totals.calls` increments per paid request. `treasuryAtomic` is the share routed back to the SHG.

> "$0.25 in, $0.20 to the treasury. That's an 80% revenue share, enforced in code."

### Evidence 5 — enforcement is not decorative

```bash
curl -i -H "X-PAYMENT: dGFtcGVyZWQ=" http://127.0.0.1:3001/api/x402/credit-report/shg1
```

`HTTP/1.1 400` with a `Malformed X-PAYMENT header` error — **never** the resource.

> "A forged header gets you nothing."

### Be ready for this question: "is the x402 payment actually on chain?"

Answer honestly — it is a better answer than a dodge:

> "The 402 gate, the payload structure, all 8 verification checks and the revenue split are real and running. The settlement leg reports `simulated` because the demo payer would need TestNet **USDC** and an opt-in to that asset — funding ALGO isn't enough. Every response labels the mode; we never claim on-chain when it isn't. Point the API at a payer holding TestNet USDC and the identical code path settles for real — that's the `sendRawTransaction` call in `facilitator.ts:265`."

Then pivot to strength:

> "And the SHG's own ledger — the part that matters to these women — **is** on chain. Let me show you on Lora."

---

## PART 4 — Judge questions, with answers

**"Is any of this mocked?"**
> `npm run verify` — 46 checks against the running system. Chain calls go to public AlgoNode endpoints; you can verify any transaction on a node we don't control.

**"Why custodial wallets for members?"**
> A woman in a village cannot safeguard a 25-word seed phrase, and losing it means losing her savings. Members get deterministically derived accounts and never touch a key. Leaders, banks and NGOs sign in with Pera and hold their own keys. Production belongs in an HSM with threshold signing — it's in our Known Limits.

**"What if OpenAI is down?"**
> The agent still detects fraud and still allocates funds — detection is nine deterministic rules and the allocator is deterministic. The LLM adds reasoning and narrative. Every response says which one answered.

**"What's the real-world impact?"**
> Three things a paper ledger can't do: a credit history a bank will actually lend against, fraud detection an SHG could never afford, and savings that earn government-scheme returns instead of zero. Plus the group gets paid when institutions read its data.

**"How is this agentic, not just automated?"**
> The agent observes without being asked, decides severity and allocation itself, acts on chain, and pays for what it consumes. The `$1.00 ai-underwriting` endpoint is the clearest case — a bank's agent discovers it, gets a 402, pays autonomously, consumes the answer. No invoice, no human, no account setup.

---

## Emergency fixes during the demo

| Symptom | Fix |
|---|---|
| Banner is amber / no Lora links | Relayer ran out or was never funded — dispense again |
| Dashboards empty | Backend restarted and the in-memory DB was wiped → re-run the seed command from 0.3 |
| "Invalid phone number or password" | Same cause — re-seed |
| Fraud monitor shows nothing | Click **Run Scan**, then **Simulate Threat** |
| Pera payment refuses | Amount is below ₹1,000 on a first payment — raise it |
| Port 5173 busy | Vite falls back to 5174; check the terminal for the actual URL |

> **Set `MONGODB_URI` to a MongoDB Atlas connection string before the event.** Without it the API uses an in-process database that is wiped on every restart — that is what causes the two "empty / can't log in" rows above.
