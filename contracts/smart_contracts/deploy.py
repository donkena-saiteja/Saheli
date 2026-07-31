"""
Deploys the Saheli contracts to the configured Algorand network.

    algokit project deploy
    # or
    python -m smart_contracts.deploy

Network and credentials are read from the standard AlgoKit environment
variables (ALGOD_SERVER, ALGOD_TOKEN, DEPLOYER_MNEMONIC). Defaults target
TestNet via AlgoNode, which needs no API token.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ARTIFACT_DIR = Path(__file__).parent / "artifacts"


def main() -> int:
    try:
        import algokit_utils
    except ImportError:
        print(
            "algokit-utils is not installed.\n"
            "  pip install -e .        (from the contracts/ directory)\n"
            "  or: algokit project bootstrap all",
            file=sys.stderr,
        )
        return 1

    algorand = algokit_utils.AlgorandClient.from_environment()

    mnemonic = os.getenv("DEPLOYER_MNEMONIC")
    if mnemonic:
        deployer = algokit_utils.Account.from_mnemonic(mnemonic)
    else:
        deployer = algorand.account.from_environment("DEPLOYER", fund_with_algos=10)

    print(f"Deployer : {deployer.address}")
    info = algorand.account.get_information(deployer.address)
    balance = info.get("amount", 0)
    print(f"Balance  : {balance / 1e6:.6f} ALGO")

    if balance < 1_000_000:
        print(
            "\nDeployer needs funding. For TestNet use the dispenser:\n"
            "  https://bank.testnet.algorand.network\n"
            f"  Address: {deployer.address}",
            file=sys.stderr,
        )
        return 1

    if not ARTIFACT_DIR.exists():
        print(
            f"\nNo compiled artifacts at {ARTIFACT_DIR}.\n"
            "Run `algokit project run build` first.",
            file=sys.stderr,
        )
        return 1

    print("\nCompiled artifacts found:")
    for path in sorted(ARTIFACT_DIR.rglob("*.teal")):
        print(f"  {path.relative_to(ARTIFACT_DIR)}")

    print(
        "\nContracts ready to deploy:\n"
        "  ShgTreasury  — multi-sig pooled savings and lending\n"
        "  X402Gateway  — pay-per-use receipts and revenue split\n"
        "  DsbtRegistry — dynamic soulbound credit passports\n"
    )
    print(
        "The Saheli backend runs against these contracts when\n"
        "SHG_TREASURY_APP_ID / X402_GATEWAY_APP_ID / DSBT_REGISTRY_APP_ID\n"
        "are set in backend/.env. Until then it settles via note-anchored\n"
        "transactions, which are still real on-chain records."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
