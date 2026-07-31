# Saheli Smart Contracts

Algorand smart contracts for the SHG Chain, written in **Algorand Python (algopy)** and compiled with **AlgoKit / puyapy**.

Compiled TEAL and ARC-56 specs are committed under [`artifacts/`](artifacts/) so they can be inspected without installing a Python toolchain.

## Contracts

| Contract | Purpose | ABI methods |
|---|---|---|
| [`ShgTreasury`](smart_contracts/shg_treasury/contract.py) | Pooled group savings with quorum-gated withdrawals and agentic emergency lending | 10 |
| [`X402Gateway`](smart_contracts/x402_gateway/contract.py) | On-chain receipts for x402 pay-per-use payments, with an enforced revenue split to the SHG | 5 |
| [`DsbtRegistry`](smart_contracts/dsbt_registry/contract.py) | Dynamic Soulbound Tokens — non-transferable, continuously-updated credit passports | 10 |

### ShgTreasury

Emulates the joint bank account an SHG would otherwise hold at a branch.

- Withdrawals at or above `quorum_threshold` require a leader quorum.
- `_group_carries_approvals` asserts `Global.group_size >= approvals + 1`, so a caller cannot simply *claim* three approvals — three real leader-signed transactions must be present in the same atomic group.
- `request_emergency_loan` lets the AI agent disburse small loans instantly to members whose d-SBT score clears the threshold, bypassing the quorum only within `emergency_limit`.
- Every payout sets `fee=0`; the relayer pools fees so members never hold ALGO.

### X402Gateway

An x402 payment is just an ASA transfer. This contract rides in the same atomic group and adds what the transfer alone cannot provide:

- a durable receipt proving *what* was purchased, not merely that value moved;
- a revenue split enforced by the chain rather than by backend goodwill — the SHG's share leaves in the same transaction that recorded it.

It rejects transfers that try to close the asset holding or rekey the sender, matching the safety checks in the x402 `exact` scheme spec.

### DsbtRegistry

Soulbound is enforced structurally, not by convention:

- the ASA is minted with `total=1`, `default_frozen=True`, and freeze/clawback retained by the application;
- **no transfer method exists** anywhere in the ABI.

Reputation therefore cannot be bought, sold, or lent. Each repayment, streak, or default rewrites the score and stamps `updated_round`, giving a bank the full trajectory rather than one self-reported number.

## Build

Prerequisite: [AlgoKit](https://github.com/algorandfoundation/algokit-cli) (a hackathon requirement) or plain `puyapy`.

```bash
cd contracts
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install puyapy algorand-python
python -m puyapy smart_contracts/shg_treasury/contract.py
```

Or via AlgoKit:

```bash
algokit project run build
```

## Deploy

```bash
algokit project deploy
```

Set `DEPLOYER_MNEMONIC` in `.env`, and fund the address at the [TestNet dispenser](https://bank.testnet.algorand.network).

After deploying, set the returned app ids in `backend/.env`:

```
SHG_TREASURY_APP_ID=...
X402_GATEWAY_APP_ID=...
DSBT_REGISTRY_APP_ID=...
```

Until those are set, the backend settles through note-anchored transactions — still real, verifiable on-chain records, just without the application-call layer.

## Note on the Windows build

`puyapy` shells out to `python3`, which on Windows resolves to the Microsoft Store stub. If you hit `Python was not found`, copy the venv interpreter:

```bash
cp .venv/Scripts/python.exe .venv/Scripts/python3.exe
```
