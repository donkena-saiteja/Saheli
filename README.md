# Saheli — SHG Chain

**Agentic AI + Algorand financial hub for India's Women Self-Help Groups.**

Built for **NexVerse — Algo + AI Hackathon** (Algorand Blockchain Club, Aurora University).
Tracks: *Blockchain with Algorand* · *Agentic AI × Blockchain*

> India has 9M+ Self-Help Groups where ~90M women pool savings and lend to each other. Their records are paper ledgers. Their credit history is invisible to every bank. Saheli puts that ledger on Algorand and hands it back to them through WhatsApp — no app, no wallet, no gas, no literacy barrier.

---

## Hackathon requirements

| Requirement | Status | Where |
|---|---|---|
| **x402 Pay-per-Use Payments** (mandatory) | ✅ Implemented — x402 v2, `exact` scheme on `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe` | [`backend/src/x402/`](backend/src/x402/) |
| **AlgoKit** | ✅ 3 Algorand Python contracts, compiled to TEAL v11 | [`contracts/`](contracts/) |
| **Fully functional during evaluation** | ✅ 22/22 automated checks — `npm run verify` | [`backend/src/scripts/verify.ts`](backend/src/scripts/verify.ts) |

```bash
cd backend && npm run verify
```

```
ALL 22 CHECKS PASSED
```

---

## Quick start (60 seconds, zero external dependencies)

No MongoDB installation required — the API starts an in-process database automatically if it can't reach one.

```bash
git clone <repo> && cd Saheli
cd backend && npm install && npm run dev
```

```bash
cd app && npm install && npm run dev
```

Then seed a full demo SHG:

```bash
curl -X POST http://127.0.0.1:3001/api/auth/seed-demo -H "Content-Type: application/json" -d "{\"reset\":true}"
```

| Role | Phone | Password |
|---|---|---|
| Member | `+91-9876543210` | `demo1234` |
| Leader | `+91-9000000001` | `demo1234` |
| Bank | `+91-9000000002` | `demo1234` |

WhatsApp MPIN: **1234**

Health check — proves both mandatory capabilities in one request: <http://127.0.0.1:3001/health>

---

## 1. x402 Pay-per-Use — and the business model behind it

Most hackathon x402 integrations bolt a paywall onto a demo endpoint. Ours **is the revenue model**.

An SHG's most valuable asset is its repayment history — and today banks, MFIs and NGOs extract it for free. Saheli inverts that: institutional access is metered per API call, and **the money flows back into the SHG treasury**.

### Priced resources

| Resource | Price | Who pays | → SHG |
|---|---|---|---|
| `GET /api/x402/credit-report/:shgId` | $0.25 | Bank underwriting | 80% |
| `GET /api/x402/member-passport/:memberId` | $0.10 | Bank / MFI | 90% |
| `POST /api/x402/verify-proof` | $0.01 | Fintech, at scale | 70% |
| `GET /api/x402/grant-eligibility/:shgId` | $0.50 | NGO / Government | 85% |
| `POST /api/x402/ai-underwriting` | $1.00 | **Autonomous AI agent** | 60% |

That last row is the agentic-commerce story: a bank's underwriting agent discovers the endpoint, receives a 402, pays autonomously, and consumes the answer — no invoice, no human, no account setup.

### See it work

```bash
# 1. Unpaid -> HTTP 402 with spec-exact PaymentRequirements
curl -i http://127.0.0.1:3001/api/x402/credit-report/shg1
```

```bash
# 2. Full handshake: challenge -> atomic group -> verify -> settle
curl -X POST http://127.0.0.1:3001/api/x402/demo/pay -H "Content-Type: application/json" -d "{\"resourceId\":\"credit-report\"}"
```

```bash
# 3. Revenue routed back to the women
curl http://127.0.0.1:3001/api/x402/revenue
```

Or open **x402 Pay-per-Use** in any dashboard for the same flow with every protocol step rendered.

### Implementation notes

Typed against the **official `@x402/core` and `@x402/avm` v2.20 packages**, so the payloads are structurally guaranteed to match the standard rather than merely resembling it.

- `PaymentRequirements`, `PaymentPayload`, `SettleResponse` — official types, not hand-rolled
- Verification implements all 8 checks from [`scheme_exact_algo.md`](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_algo.md): version, scheme, network, group size ≤16, msgpack decode, asset/amount/receiver match, fee-payer safety, group simulation
- `X-PAYMENT` / `X-PAYMENT-RESPONSE` headers, base64 JSON
- **Local facilitator by default** so the mandatory feature cannot be broken by third-party downtime mid-judging. Set `X402_FACILITATOR_URL=https://facilitator.goplausible.xyz` to settle through the public facilitator instead.

---

## 2. WhatsApp banking — exactly like SBI

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

## 3. Algorand

Every transaction id in this project is a **real 52-character Algorand txid**, and every explorer link resolves.

- **Gasless.** Members never hold ALGO. The relayer contributes a fee-pooling transaction so member transfers carry `fee=0`.
- **Walletless.** Member accounts are derived deterministically (HMAC-SHA512 → 32-byte seed → Algorand keypair). Same member, same address, no key management, no seed phrase to lose.
- **Atomic multi-sig.** Leader approvals are bundled into a single atomic group — all approvals land in one block or none do, so funds cannot move on a partial quorum.
- **Note anchoring.** Ledger records are written as the note of a 0-amount payment: real, verifiable, needs no ASA opt-in, costs 0.001 ALGO.

### Live vs simulated settlement — stated honestly

The backend connects to Algorand TestNet on boot. If the relayer is funded it settles on chain; if not, it degrades to deterministic local settlement and **labels every response `mode: "simulated"`**. Nothing is ever presented as on-chain when it isn't.

To switch to live settlement, fund the relayer address shown at `/api/algorand/info` using the [TestNet dispenser](https://bank.testnet.algorand.network). No config change, no restart.

```bash
curl http://127.0.0.1:3001/api/algorand/info
```

---

## 4. AlgoKit smart contracts

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

## 5. Dynamic Soulbound Tokens (d-SBT)

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
│       │   ├── whatsappBanking.ts     SBI-style state machine
│       │   ├── dsbt.ts                soulbound passports
│       │   ├── agentEngine.ts         autonomous treasury agent
│       │   └── seed.ts                realistic demo SHG
│       ├── routes/
│       └── scripts/verify.ts        22-check end-to-end suite
│
└── app/                             React 19 + Vite + Tailwind
    └── src/components/
        ├── X402Console.tsx           the protocol, visualised
        └── WhatsAppDemo.tsx          drives the real state machine
```

---

## Demo script for judges (5 minutes)

1. **Open `/health`** — Algorand round number and x402 config in one screenshot. Nothing to click.
2. **Log in as Bank** → *x402 Pay-per-Use* → **"Request without paying"**. A real HTTP 402 with spec-exact `PaymentRequirements`.
3. **"Pay $0.25 and unlock"** — watch the five protocol steps, then the credit report with an actual lending decision.
4. Scroll to **revenue** — that $0.20 went to the SHG treasury. *This is how the women get paid for their own data.*
5. **Open the WhatsApp assistant** → send `Hi` → `1234` → tap the 🎙️ voice sample *"I need 5000 rupees urgently for hospital"* → `YES`. Emergency loan approved by the AI agent against the on-chain trust score, with a QR proof and a live explorer link.
6. **`cd backend && npm run verify`** — 22/22, live, in front of them.

---

## Environment

Everything is optional. The stack runs with an empty `.env`.

```bash
cp backend/.env.example backend/.env
```

| Variable | Effect if unset |
|---|---|
| `MONGODB_URI` | In-process database starts automatically |
| `ALGORAND_RELAYER_MNEMONIC` | Deterministic derived relayer; fund it to go live |
| `X402_FACILITATOR_URL` | Built-in local facilitator (no external dependency) |
| `TWILIO_*` | Browser simulator still works; live WhatsApp disabled |
| `OPENAI_API_KEY` | Voice transcription disabled; text and menus unaffected |
| `SARVAM_API_KEY` | Falls back to LibreTranslate, then passthrough |

## Deployment

```bash
docker compose up --build
```

Frontend `:8080` · Backend `:3001` · MongoDB `:27017`

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start backend (auto-reload) |
| `npm run verify` | 22-check end-to-end suite |
| `npm run typecheck` | Strict TypeScript, zero errors |
| `npm run build` | Compile to `dist/` |

---

## Known limits

Stated plainly, because a judge will find them anyway:

- **Custodial keys.** Member accounts are derived from a platform master seed. That's the correct trade-off for users who cannot safeguard a seed phrase, but it means the platform is trusted. Production belongs in an HSM/KMS with threshold signing.
- **Settlement mode.** Live on-chain settlement needs a funded relayer. Unfunded, the API says `simulated` — never anything stronger.
- **Contracts compile but are not deployed.** TEAL is committed and verifiable; deploying needs a funded TestNet account (`algokit project deploy`). The backend anchors to chain regardless.
- **DeFi yield is modelled.** Folks Finance / Tinyman APYs drive a simulation; live pool integration is the next step, not a claim we make.
- **Demo MPIN is `1234`** for every seeded account.
#   S a h e l i  
 