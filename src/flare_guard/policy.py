"""Fail-closed Flare FXRP direct-mint preflight policy.

Secret/Decimal/reason patterns are disclosed Pharos baseline patterns. Every
Coston2, Registry, FAssets, Core Vault, memo, freshness and receipt rule is new
Flare Summer Signal work.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Mapping

from .models import LEVEL_RANK, Reason, decision_from_reasons, human_gate
from .receipt import evaluate_receipt
from .validation import (
    amount_to_units,
    canonical_digest,
    find_secret_material,
    is_evm_address,
    is_tx_hash,
    parse_decimal,
    parse_int,
    parse_timestamp,
    same_address,
)


POLICY_VERSION = "2.0.0"
MAX_EVIDENCE_AGE_SECONDS = 900
CHAIN_ID = 114
REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"
REGISTRY_NAME = "AssetManagerFXRP"
ZERO_ADDRESS = "0x" + "0" * 40
DIRECT_MINTING_PREFIX = "4642505266410018"
PINNED_DEPENDENCIES = {
    "@flarenetwork/flare-wagmi-periphery-package": "3.1.0",
    "viem": "2.48.4",
}
PINNED_DEPENDENCY_FILES = {
    "package_json_sha256": "961a602212d1af019e8df24d7c911a8d2ed25400db3077f124ad0f6144d88a29",
    "package_lock_sha256": "3e9aabb3336f123d871d5a1f59c1eeaa84392cc191770ef23488f2b1ce38fd24",
}
PINNED_LOCKFILE_INTEGRITY = {
    "@flarenetwork/flare-wagmi-periphery-package": "sha512-+7v2m3iXPdWVSntHd4ZA0H/u/A+7gb4n5lHzaB4j2nlXjTsm6ZPxrkA0cFQtcZLiKuIrX+EsS6gtFHy6oY2D5w==",
    "viem": "sha512-mReP/rgY2P+WeeRSG4sUvccCLKfyAW1C73Y3KkobAqgzYmVna9qyUMNE44xIUkDtfvRuC33r24UhF4baBYovsg==",
}

SHA256_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)
GIT_OID_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$", re.IGNORECASE)
BLOCK_HASH_RE = re.compile(r"^0x[0-9a-f]{64}$", re.IGNORECASE)
XRPL_CLASSIC_RE = re.compile(r"^r[1-9A-HJ-NP-Za-km-z]{24,34}$")

ALLOWED_INTENT_FIELDS = {
    "schema_version",
    "operation",
    "amount",
    "spend_limit",
    "expected_chain_id",
    "asset",
    "recipient",
    "underlying_sender_address",
    "underlying_transaction_id",
    "transaction_hash",
}
ALLOWED_ASSET_FIELDS = {"symbol", "address", "decimals"}

REASON_ORDER = [
    "SECRET_MATERIAL", "UNSUPPORTED_INTENT_FIELDS", "MISSING_REQUIRED_FIELDS", "INVALID_OPERATION",
    "INVALID_AMOUNT", "AMOUNT_PRECISION_EXCEEDED", "INVALID_RECIPIENT", "INVALID_CHAIN_ID", "CHAIN_MISMATCH",
    "EVIDENCE_SCHEMA_INVALID", "EVIDENCE_NOT_LIVE", "PROVENANCE_INVALID", "UNSAFE_EVIDENCE",
    "FIXTURE_FALLBACK_DETECTED", "EVIDENCE_INTEGRITY_MISSING", "EVIDENCE_INTEGRITY_MISMATCH",
    "REQUEST_EVIDENCE_MISMATCH", "ANCHOR_INVALID", "ANCHOR_NOT_RECHECKED", "REGISTRY_IDENTITY_MISMATCH",
    "REGISTRY_RESOLUTION_FAILED", "REGISTRY_CODE_MISSING", "ASSET_MANAGER_MISMATCH",
    "ASSET_MANAGER_CODE_MISSING", "ASSET_IDENTITY_MISMATCH", "ASSET_CODE_MISSING",
    "FASSETS_SETTINGS_MISSING", "FASSETS_SETTINGS_DIGEST_MISMATCH", "ADAPTER_STATE_MISMATCH",
    "DIRECT_MINT_EVIDENCE_MISSING", "DIRECT_MINT_AMOUNT_MISMATCH", "DIRECT_MINT_FEE_EVIDENCE_MISSING",
    "DIRECT_MINT_LIMIT_EVIDENCE_MISSING", "DIRECT_MINT_LIMIT_EVIDENCE_INVALID", "DIRECT_MINT_CORE_VAULT_MISSING",
    "GROSS_SPEND_LIMIT_EXCEEDED", "DIRECT_MINT_HOURLY_LIMIT", "DIRECT_MINT_DAILY_LIMIT", "DIRECT_MINT_DELAY",
    "EVIDENCE_FRESHNESS_UNKNOWN", "EVIDENCE_CLOCK_SKEW", "EVIDENCE_STALE",
    "RECEIPT_FAILED", "RECEIPT_CHAIN_MISMATCH", "RECEIPT_TX_HASH_MISMATCH",
    "RECEIPT_UNDERLYING_TX_MISMATCH", "RECEIPT_ASSET_MISMATCH", "RECEIPT_AMOUNT_MISMATCH",
    "RECEIPT_EMITTER_MISMATCH", "RECEIPT_FEE_MISMATCH", "RECEIPT_RECIPIENT_MISMATCH", "RECEIPT_SENDER_MISMATCH",
    "RECEIPT_DIRECT_MINT_DELAYED", "RECEIPT_PREFLIGHT_BINDING_MISSING", "RECEIPT_EFFECT_UNVERIFIED", "RECEIPT_SETTLEMENT_UNVERIFIED",
    "RECEIPT_PENDING", "RECEIPT_STATUS_UNKNOWN", "RECEIPT_MISSING",
]

MESSAGES = {
    "SECRET_MATERIAL": "Secret material is present; remove it before continuing.",
    "UNSUPPORTED_INTENT_FIELDS": "Intent contains fields outside the versioned direct-mint schema.",
    "MISSING_REQUIRED_FIELDS": "Required intent fields are missing.",
    "INVALID_OPERATION": "This MVP only supports the direct_mint operation.",
    "INVALID_AMOUNT": "Net mint amount and gross spend limit must be exact positive values.",
    "AMOUNT_PRECISION_EXCEEDED": "Amount has more fractional precision than the asset supports.",
    "INVALID_RECIPIENT": "Direct mint requires a valid nonzero Flare EVM recipient.",
    "INVALID_CHAIN_ID": "Intent chain ID must be the integer 114.",
    "CHAIN_MISMATCH": "Flare evidence does not prove Coston2 chain 114.",
    "EVIDENCE_SCHEMA_INVALID": "Live evidence does not match the versioned Flare evidence envelope.",
    "EVIDENCE_NOT_LIVE": "Evidence is explicitly a fixture or historical non-live input.",
    "PROVENANCE_INVALID": "Live evidence lacks clean Git and exact dependency provenance.",
    "UNSAFE_EVIDENCE": "Evidence does not prove a read-only, wallet-free, no-signing capture.",
    "FIXTURE_FALLBACK_DETECTED": "Evidence declares a fixture or mock fallback.",
    "EVIDENCE_INTEGRITY_MISSING": "Live evidence lacks its canonical SHA-256 payload digest.",
    "EVIDENCE_INTEGRITY_MISMATCH": "Evidence canonical integrity digest does not match its payload.",
    "REQUEST_EVIDENCE_MISMATCH": "Capture request amount or selected block differs from normalized evidence.",
    "ANCHOR_INVALID": "Evidence lacks a valid positive block number, timestamp, hash, or hash recheck.",
    "ANCHOR_NOT_RECHECKED": "The evidence block hash was not rechecked.",
    "REGISTRY_IDENTITY_MISMATCH": "Evidence does not identify the official Coston2 Contract Registry lookup.",
    "REGISTRY_RESOLUTION_FAILED": "Contract Registry did not resolve a nonzero AssetManagerFXRP address.",
    "REGISTRY_CODE_MISSING": "Contract Registry has no proven bytecode at the evidence anchor.",
    "ASSET_MANAGER_MISMATCH": "Resolved AssetManagerFXRP and queried AssetManager addresses differ.",
    "ASSET_MANAGER_CODE_MISSING": "AssetManagerFXRP has no proven bytecode at the evidence anchor.",
    "ASSET_IDENTITY_MISMATCH": "FXRP address, symbol, decimals, or FAssets settings identity is inconsistent.",
    "ASSET_CODE_MISSING": "FXRP token has no proven bytecode at the evidence anchor.",
    "FASSETS_SETTINGS_MISSING": "FAssets getSettings evidence is incomplete.",
    "FASSETS_SETTINGS_DIGEST_MISMATCH": "FAssets settings do not match their canonical SHA-256 digest.",
    "ADAPTER_STATE_MISMATCH": "Normalized evidence and the raw anchored adapter state disagree.",
    "DIRECT_MINT_EVIDENCE_MISSING": "Direct-mint Core Vault state is missing.",
    "DIRECT_MINT_AMOUNT_MISMATCH": "Evidence was not captured for the requested net mint amount.",
    "DIRECT_MINT_FEE_EVIDENCE_MISSING": "Direct-mint minimum, executor, or BIPS fee state is incomplete.",
    "DIRECT_MINT_LIMIT_EVIDENCE_MISSING": "Direct-mint limiter state is incomplete.",
    "DIRECT_MINT_LIMIT_EVIDENCE_INVALID": "Direct-mint limiter fields are internally inconsistent.",
    "DIRECT_MINT_CORE_VAULT_MISSING": "A valid Core Vault XRPL payment address is missing.",
    "GROSS_SPEND_LIMIT_EXCEEDED": "Net mint amount plus protocol fees exceeds the declared gross spend limit.",
    "DIRECT_MINT_HOURLY_LIMIT": "Intent exceeds the observed hourly immediate headroom.",
    "DIRECT_MINT_DAILY_LIMIT": "Intent exceeds the observed daily immediate headroom.",
    "DIRECT_MINT_DELAY": "Direct mint is delayed; rate limits delay rather than reject the mint.",
    "EVIDENCE_FRESHNESS_UNKNOWN": "Evidence freshness cannot be determined.",
    "EVIDENCE_CLOCK_SKEW": "Policy evaluation precedes the anchored block timestamp.",
    "EVIDENCE_STALE": "The anchored Flare state is older than the policy's fixed freshness limit.",
    "RECEIPT_MISSING": "A receipt was required but not supplied.",
}


def _reason(level: str, code: str, **details: Any) -> Reason:
    from .receipt import MESSAGES as receipt_messages

    return Reason(level, code, MESSAGES.get(code, receipt_messages.get(code, code)), details)


def _format_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _valid_sha(value: Any) -> bool:
    return isinstance(value, str) and bool(SHA256_RE.fullmatch(value))


def _valid_code(section: Mapping[str, Any]) -> bool:
    return (parse_int(section.get("code_bytes")) or 0) > 0 and _valid_sha(section.get("code_sha256"))


def _asset(intent: Mapping[str, Any]) -> dict[str, Any]:
    raw = intent.get("asset")
    if not isinstance(raw, Mapping):
        return {"symbol": None, "address": None, "decimals": None}
    return {"symbol": raw.get("symbol"), "address": raw.get("address"), "decimals": raw.get("decimals")}


def _normalized_intent(intent: Mapping[str, Any]) -> tuple[dict[str, Any], list[Reason]]:
    reasons: list[Reason] = []
    unknown = sorted(str(key) for key in intent if key not in ALLOWED_INTENT_FIELDS)
    asset_raw = intent.get("asset")
    if isinstance(asset_raw, Mapping):
        unknown.extend(f"asset.{key}" for key in sorted(asset_raw) if key not in ALLOWED_ASSET_FIELDS)
    if unknown:
        reasons.append(_reason("BLOCK", "UNSUPPORTED_INTENT_FIELDS", fields=unknown))

    operation = str(intent.get("operation") or "").lower()
    asset = _asset(intent)
    chain_id = parse_int(intent.get("expected_chain_id"))
    amount = parse_decimal(intent.get("amount"))
    spend = parse_decimal(intent.get("spend_limit"))
    missing = [
        name
        for name, value in (
            ("operation", operation),
            ("amount", intent.get("amount")),
            ("spend_limit", intent.get("spend_limit")),
            ("expected_chain_id", intent.get("expected_chain_id")),
            ("asset.symbol", asset["symbol"]),
            ("asset.address", asset["address"]),
            ("asset.decimals", asset["decimals"]),
            ("recipient", intent.get("recipient")),
        )
        if value in (None, "")
    ]
    if missing:
        reasons.append(_reason("BLOCK", "MISSING_REQUIRED_FIELDS", fields=missing))

    secrets = find_secret_material(intent)
    if secrets:
        reasons.append(_reason("BLOCK", "SECRET_MATERIAL", paths=secrets))
    if operation and operation != "direct_mint":
        reasons.append(_reason("BLOCK", "INVALID_OPERATION", observed=operation))
    if intent.get("amount") is not None and (amount is None or amount <= 0):
        reasons.append(_reason("BLOCK", "INVALID_AMOUNT", field="amount"))
    if intent.get("spend_limit") is not None and (spend is None or spend <= 0):
        reasons.append(_reason("BLOCK", "INVALID_AMOUNT", field="spend_limit"))
    if not is_evm_address(intent.get("recipient")):
        reasons.append(_reason("BLOCK", "INVALID_RECIPIENT"))
    if intent.get("expected_chain_id") is not None and chain_id is None:
        reasons.append(_reason("BLOCK", "INVALID_CHAIN_ID"))
    elif chain_id is not None and chain_id != CHAIN_ID:
        reasons.append(_reason("BLOCK", "CHAIN_MISMATCH", observed=chain_id, expected=CHAIN_ID))

    decimals = parse_int(asset["decimals"])
    amount_uba = amount_to_units(amount, decimals) if amount is not None and decimals is not None else None
    spend_uba = amount_to_units(spend, decimals) if spend is not None and decimals is not None else None
    if amount is not None and decimals is not None and amount_uba is None:
        reasons.append(_reason("BLOCK", "AMOUNT_PRECISION_EXCEEDED", field="amount", decimals=decimals))
    if spend is not None and decimals is not None and spend_uba is None:
        reasons.append(_reason("BLOCK", "AMOUNT_PRECISION_EXCEEDED", field="spend_limit", decimals=decimals))

    return {
        "operation": operation,
        "amount": format(amount, "f") if amount is not None else None,
        "amount_semantics": "net_fxrp_to_mint",
        "amount_uba": str(amount_uba) if amount_uba is not None else None,
        "spend_limit": format(spend, "f") if spend is not None else None,
        "spend_limit_semantics": "maximum_gross_xrpl_payment",
        "spend_limit_uba": str(spend_uba) if spend_uba is not None else None,
        "chain_id": chain_id,
        "asset": {**asset, "decimals": decimals},
        "recipient": intent.get("recipient"),
        "underlying_sender_address": intent.get("underlying_sender_address"),
        "underlying_transaction_id": intent.get("underlying_transaction_id"),
        "transaction_hash": intent.get("transaction_hash"),
    }, reasons


def _validate_live_envelope(
    evidence: Mapping[str, Any],
    reasons: list[Reason],
    *,
    require_release_provenance: bool,
) -> str | None:
    if evidence.get("schema_version") != "1.0.0" or evidence.get("artifact_type") != "flare_fassets_evidence":
        reasons.append(_reason("BLOCK", "EVIDENCE_SCHEMA_INVALID"))

    provenance = evidence.get("provenance") if isinstance(evidence.get("provenance"), Mapping) else {}
    dependencies = provenance.get("dependencies") if isinstance(provenance.get("dependencies"), Mapping) else {}
    invalid_provenance: list[str] = []
    if (
        not isinstance(provenance.get("commit"), str)
        or not GIT_OID_RE.fullmatch(str(provenance.get("commit")))
        or not isinstance(provenance.get("tree"), str)
        or not GIT_OID_RE.fullmatch(str(provenance.get("tree")))
        or provenance.get("dirty") is not False
        or dict(dependencies) != PINNED_DEPENDENCIES
    ):
        invalid_provenance.append("git_or_declared_dependencies")

    if require_release_provenance:
        dependency_files = (
            provenance.get("dependency_files")
            if isinstance(provenance.get("dependency_files"), Mapping)
            else {}
        )
        lockfile_dependencies = (
            provenance.get("lockfile_dependencies")
            if isinstance(provenance.get("lockfile_dependencies"), Mapping)
            else {}
        )
        runtime_dependencies = (
            provenance.get("runtime_dependencies")
            if isinstance(provenance.get("runtime_dependencies"), Mapping)
            else {}
        )
        if dict(dependency_files) != PINNED_DEPENDENCY_FILES:
            invalid_provenance.append("dependency_files")
        if set(lockfile_dependencies) != set(PINNED_DEPENDENCIES):
            invalid_provenance.append("lockfile_dependencies")
        else:
            for name, version in PINNED_DEPENDENCIES.items():
                locked = lockfile_dependencies.get(name)
                if not isinstance(locked, Mapping) or dict(locked) != {
                    "version": version,
                    "integrity": PINNED_LOCKFILE_INTEGRITY[name],
                }:
                    invalid_provenance.append(f"lockfile_dependencies.{name}")
        if set(runtime_dependencies) != set(PINNED_DEPENDENCIES):
            invalid_provenance.append("runtime_dependencies")
        else:
            for name, version in PINNED_DEPENDENCIES.items():
                runtime = runtime_dependencies.get(name)
                if not isinstance(runtime, Mapping) or dict(runtime) != {"version": version}:
                    invalid_provenance.append(f"runtime_dependencies.{name}")

    if invalid_provenance:
        reasons.append(_reason("BLOCK", "PROVENANCE_INVALID", fields=invalid_provenance))

    safety = evidence.get("safety") if isinstance(evidence.get("safety"), Mapping) else {}
    expected_safety = {
        "read_only": True,
        "wallet_used": False,
        "private_key_required": False,
        "signing_performed": False,
        "chain_write_performed": False,
        "transaction_broadcast": False,
        "fixture_fallback": False,
        "mock_fallback": False,
    }
    unsafe = [key for key, expected in expected_safety.items() if safety.get(key) is not expected]
    if unsafe:
        reasons.append(_reason("BLOCK", "UNSAFE_EVIDENCE", fields=unsafe))

    integrity = evidence.get("integrity") if isinstance(evidence.get("integrity"), Mapping) else {}
    evidence_digest = integrity.get("canonical_payload_sha256")
    if (
        integrity.get("algorithm") != "sha256"
        or integrity.get("canonicalization") != "sorted-keys-bigint-decimal-v1"
        or integrity.get("payload_scope") != "artifact excluding integrity"
        or not _valid_sha(evidence_digest)
    ):
        reasons.append(_reason("BLOCK", "EVIDENCE_INTEGRITY_MISSING"))
        return None
    payload = {key: value for key, value in evidence.items() if key != "integrity"}
    if canonical_digest(payload, exclude_dynamic=False) != evidence_digest:
        reasons.append(_reason("BLOCK", "EVIDENCE_INTEGRITY_MISMATCH"))
    return str(evidence_digest)


def _adapter_mismatches(
    evidence: Mapping[str, Any],
    settings: Mapping[str, Any],
    direct: Mapping[str, Any],
) -> list[str]:
    adapter = evidence.get("adapter_state")
    if not isinstance(adapter, Mapping):
        return ["adapter_state"]
    mismatches: list[str] = []
    anchor = evidence.get("anchor") if isinstance(evidence.get("anchor"), Mapping) else {}
    registry = evidence.get("registry") if isinstance(evidence.get("registry"), Mapping) else {}
    manager = evidence.get("asset_manager") if isinstance(evidence.get("asset_manager"), Mapping) else {}
    asset = evidence.get("asset") if isinstance(evidence.get("asset"), Mapping) else {}
    a_anchor = adapter.get("anchor") if isinstance(adapter.get("anchor"), Mapping) else {}
    a_registry = adapter.get("registry") if isinstance(adapter.get("registry"), Mapping) else {}
    a_manager = adapter.get("assetManager") if isinstance(adapter.get("assetManager"), Mapping) else {}
    a_asset = adapter.get("fAsset") if isinstance(adapter.get("fAsset"), Mapping) else {}
    a_direct = adapter.get("directMinting") if isinstance(adapter.get("directMinting"), Mapping) else {}
    a_network = adapter.get("network") if isinstance(adapter.get("network"), Mapping) else {}
    if adapter.get("mode") != "live" or adapter.get("readOnly") is not True:
        mismatches.append("mode/readOnly")
    if parse_int(a_network.get("expectedChainId")) != CHAIN_ID or parse_int(a_network.get("observedChainId")) != CHAIN_ID:
        mismatches.append("network")
    for label, left, right in (
        ("anchor.blockNumber", a_anchor.get("blockNumber"), anchor.get("block_number")),
        ("anchor.blockHash", a_anchor.get("blockHash"), anchor.get("block_hash")),
        ("anchor.blockTimestamp", a_anchor.get("blockTimestamp"), anchor.get("block_timestamp")),
        ("registry.codeBytes", a_registry.get("codeBytes"), registry.get("code_bytes")),
        ("registry.codeSha256", a_registry.get("codeSha256"), registry.get("code_sha256")),
        ("assetManager.codeBytes", a_manager.get("codeBytes"), manager.get("code_bytes")),
        ("assetManager.codeSha256", a_manager.get("codeSha256"), manager.get("code_sha256")),
        ("fAsset.codeBytes", a_asset.get("codeBytes"), asset.get("code_bytes")),
        ("fAsset.codeSha256", a_asset.get("codeSha256"), asset.get("code_sha256")),
        ("direct.proposedAmountUBA", a_direct.get("proposedAmountUBA"), direct.get("proposed_amount_uba")),
        ("direct.paymentAddress", a_direct.get("paymentAddress"), direct.get("payment_address")),
        ("direct.minimumFeeUBA", a_direct.get("minimumFeeUBA"), direct.get("minimum_fee_uba")),
        ("direct.executorFeeUBA", a_direct.get("executorFeeUBA"), direct.get("executor_fee_uba")),
        ("direct.feeBIPS", a_direct.get("feeBIPS"), direct.get("fee_bips")),
        ("direct.hourly.limitUBA", a_direct.get("hourly", {}).get("limitUBA") if isinstance(a_direct.get("hourly"), Mapping) else None, direct.get("hourly_limit_uba")),
        ("direct.hourly.remainingUBA", a_direct.get("hourly", {}).get("remainingUBA") if isinstance(a_direct.get("hourly"), Mapping) else None, direct.get("hourly_remaining_uba")),
        ("direct.daily.limitUBA", a_direct.get("daily", {}).get("limitUBA") if isinstance(a_direct.get("daily"), Mapping) else None, direct.get("daily_limit_uba")),
        ("direct.daily.remainingUBA", a_direct.get("daily", {}).get("remainingUBA") if isinstance(a_direct.get("daily"), Mapping) else None, direct.get("daily_remaining_uba")),
        ("direct.largeThresholdUBA", a_direct.get("largeThresholdUBA"), direct.get("large_threshold_uba")),
        ("direct.largeDelaySeconds", a_direct.get("largeDelaySeconds"), direct.get("large_delay_seconds")),
        ("direct.executionAllowedAt", a_direct.get("preflight", {}).get("executionAllowedAt") if isinstance(a_direct.get("preflight"), Mapping) else None, direct.get("execution_allowed_at")),
    ):
        if str(left) != str(right):
            mismatches.append(label)
    for label, left, right in (
        ("registry.address", a_registry.get("address"), registry.get("address")),
        ("assetManager.address", a_manager.get("address"), manager.get("address")),
        ("fAsset.address", a_asset.get("address"), asset.get("address")),
    ):
        if not same_address(left, right):
            mismatches.append(label)
    if a_registry.get("lookupName") != registry.get("lookup_name"):
        mismatches.append("registry.lookupName")
    if a_asset.get("symbol") != asset.get("symbol") or parse_int(a_asset.get("decimals")) != parse_int(asset.get("decimals")):
        mismatches.append("fAsset.identity")
    if a_anchor.get("hashRechecked") is not True:
        mismatches.append("anchor.hashRechecked")
    a_preflight = a_direct.get("preflight") if isinstance(a_direct.get("preflight"), Mapping) else {}
    if a_direct.get("limiterDisabled") is not direct.get("limiter_disabled"):
        mismatches.append("direct.limiterDisabled")
    if a_preflight.get("delayed") is not direct.get("delayed"):
        mismatches.append("direct.preflight.delayed")
    if a_preflight.get("delayReasons") != direct.get("delay_reasons"):
        mismatches.append("direct.preflight.delayReasons")
    adapter_settings = a_manager.get("settings") if isinstance(a_manager.get("settings"), Mapping) else {}
    if canonical_digest(adapter_settings, exclude_dynamic=False) != canonical_digest(settings, exclude_dynamic=False):
        mismatches.append("assetManager.settings")
    return mismatches


def evaluate(
    intent: Mapping[str, Any],
    evidence: Mapping[str, Any],
    receipt: Mapping[str, Any] | None = None,
    *,
    require_receipt: bool = False,
    historical_replay: bool = False,
) -> dict[str, Any]:
    normalized, reasons = _normalized_intent(intent)
    is_live = evidence.get("mode") == "live"
    if not is_live:
        reasons.append(_reason("REVIEW", "EVIDENCE_NOT_LIVE"))

    safety = evidence.get("safety") if isinstance(evidence.get("safety"), Mapping) else {}
    if safety.get("fixture_fallback") is True or safety.get("mock_fallback") is True:
        reasons.append(_reason("BLOCK", "FIXTURE_FALLBACK_DETECTED"))
    evidence_digest = (
        _validate_live_envelope(
            evidence,
            reasons,
            require_release_provenance=not historical_replay,
        )
        if is_live
        else None
    )

    network = evidence.get("network") if isinstance(evidence.get("network"), Mapping) else {}
    if parse_int(network.get("expected_chain_id")) != CHAIN_ID or parse_int(network.get("observed_chain_id")) != CHAIN_ID:
        reasons.append(_reason("BLOCK", "CHAIN_MISMATCH"))

    anchor = evidence.get("anchor") if isinstance(evidence.get("anchor"), Mapping) else {}
    block_number = parse_int(anchor.get("block_number"))
    block_timestamp = parse_timestamp(anchor.get("block_timestamp") or anchor.get("block_timestamp_utc"))
    block_hash = anchor.get("block_hash")
    if (
        block_number is None
        or block_number <= 0
        or block_timestamp is None
        or not isinstance(block_hash, str)
        or not BLOCK_HASH_RE.fullmatch(block_hash)
    ):
        reasons.append(_reason("BLOCK", "ANCHOR_INVALID"))
    if anchor.get("hash_rechecked") is not True:
        reasons.append(_reason("REVIEW" if not is_live else "BLOCK", "ANCHOR_NOT_RECHECKED"))

    registry = evidence.get("registry") if isinstance(evidence.get("registry"), Mapping) else {}
    if not same_address(registry.get("address"), REGISTRY) or registry.get("lookup_name") != REGISTRY_NAME:
        reasons.append(_reason("BLOCK", "REGISTRY_IDENTITY_MISMATCH"))
    resolved = registry.get("resolved_address")
    if not is_evm_address(resolved) or str(resolved).lower() == ZERO_ADDRESS.lower():
        reasons.append(_reason("BLOCK", "REGISTRY_RESOLUTION_FAILED"))
    if not _valid_code(registry):
        reasons.append(_reason("BLOCK", "REGISTRY_CODE_MISSING"))

    manager = evidence.get("asset_manager") if isinstance(evidence.get("asset_manager"), Mapping) else {}
    if not same_address(resolved, manager.get("address")):
        reasons.append(_reason("BLOCK", "ASSET_MANAGER_MISMATCH"))
    if not _valid_code(manager):
        reasons.append(_reason("BLOCK", "ASSET_MANAGER_CODE_MISSING"))

    observed_asset = evidence.get("asset") if isinstance(evidence.get("asset"), Mapping) else {}
    settings_root = evidence.get("fassets") if isinstance(evidence.get("fassets"), Mapping) else {}
    settings = settings_root.get("settings") if isinstance(settings_root.get("settings"), Mapping) else {}
    expected_asset = normalized["asset"]
    symbol_ok = str(expected_asset.get("symbol") or "").upper() == str(observed_asset.get("symbol") or "").upper()
    links_ok = same_address(expected_asset.get("address"), observed_asset.get("address")) and same_address(settings.get("fAsset"), observed_asset.get("address"))
    decimals_ok = expected_asset.get("decimals") == parse_int(observed_asset.get("decimals")) == parse_int(settings.get("assetDecimals"))
    if not (symbol_ok and links_ok and decimals_ok):
        reasons.append(_reason("BLOCK", "ASSET_IDENTITY_MISMATCH"))
    if not _valid_code(observed_asset):
        reasons.append(_reason("BLOCK", "ASSET_CODE_MISSING"))
    if not settings:
        reasons.append(_reason("BLOCK" if is_live else "REVIEW", "FASSETS_SETTINGS_MISSING"))
    settings_digest = settings_root.get("settings_sha256")
    if is_live and (not _valid_sha(settings_digest) or canonical_digest(settings, exclude_dynamic=False) != settings_digest):
        reasons.append(_reason("BLOCK", "FASSETS_SETTINGS_DIGEST_MISMATCH"))

    direct = settings_root.get("direct_mint") if isinstance(settings_root.get("direct_mint"), Mapping) else {}
    payment_plan: dict[str, Any] | None = None
    amount_uba = parse_int(normalized.get("amount_uba"))
    spend_limit_uba = parse_int(normalized.get("spend_limit_uba"))
    if not direct:
        reasons.append(_reason("BLOCK" if is_live else "REVIEW", "DIRECT_MINT_EVIDENCE_MISSING"))
    else:
        payment_address = direct.get("payment_address")
        if not isinstance(payment_address, str) or not payment_address.strip() or (is_live and not XRPL_CLASSIC_RE.fullmatch(payment_address)):
            reasons.append(_reason("BLOCK", "DIRECT_MINT_CORE_VAULT_MISSING"))

        proposed = parse_int(direct.get("proposed_amount_uba"))
        if proposed is None or amount_uba is None or proposed != amount_uba:
            reasons.append(_reason("BLOCK", "DIRECT_MINT_AMOUNT_MISMATCH", observed=proposed, expected=amount_uba))

        minimum_fee = parse_int(direct.get("minimum_fee_uba"))
        executor_fee = parse_int(direct.get("executor_fee_uba"))
        fee_bips = parse_int(direct.get("fee_bips"))
        if minimum_fee is None or minimum_fee < 0 or executor_fee is None or executor_fee < 0 or fee_bips is None or not 0 <= fee_bips <= 10_000:
            reasons.append(_reason("BLOCK", "DIRECT_MINT_FEE_EVIDENCE_MISSING"))
        elif amount_uba is not None:
            minting_fee = max(minimum_fee, amount_uba * fee_bips // 10_000)
            gross_payment = amount_uba + minting_fee + executor_fee
            normalized["expected_minting_fee_uba"] = str(minting_fee)
            normalized["expected_executor_fee_uba"] = str(executor_fee)
            if spend_limit_uba is not None and gross_payment > spend_limit_uba:
                reasons.append(
                    _reason(
                        "BLOCK",
                        "GROSS_SPEND_LIMIT_EXCEEDED",
                        net_mint_uba=str(amount_uba),
                        minting_fee_uba=str(minting_fee),
                        executor_fee_uba=str(executor_fee),
                        gross_payment_uba=str(gross_payment),
                        spend_limit_uba=str(spend_limit_uba),
                    )
                )
            recipient = normalized.get("recipient")
            memo = DIRECT_MINTING_PREFIX + "00000000" + (str(recipient)[2:].lower() if is_evm_address(recipient) else "")
            payment_plan = {
                "destination_xrpl_address": payment_address,
                "destination_source": "AssetManagerFXRP.directMintingPaymentAddress",
                "recipient_evm_address": recipient,
                "memo_format": "DIRECT_MINTING_32_BYTE",
                "memo_data_hex": memo if len(memo) == 64 else None,
                "memo_bytes": 32 if len(memo) == 64 else None,
                "preferred_executor": None,
                "net_mint_uba": str(amount_uba),
                "minting_fee_uba": str(minting_fee),
                "executor_fee_uba": str(executor_fee),
                "gross_payment_uba": str(gross_payment),
                "asset_decimals": normalized["asset"].get("decimals"),
            }

        limit_fields = {
            name: parse_int(direct.get(name))
            for name in (
                "hourly_limit_uba", "hourly_remaining_uba", "daily_limit_uba", "daily_remaining_uba",
                "large_threshold_uba", "large_delay_seconds", "execution_allowed_at", "delay_seconds",
            )
        }
        if any(value is None or value < 0 for value in limit_fields.values()) or not isinstance(direct.get("limiter_disabled"), bool) or not isinstance(direct.get("delayed"), bool) or not isinstance(direct.get("delay_reasons"), list):
            reasons.append(_reason("BLOCK", "DIRECT_MINT_LIMIT_EVIDENCE_MISSING"))
        else:
            invalid_limits: list[str] = []
            if limit_fields["hourly_remaining_uba"] > limit_fields["hourly_limit_uba"]:
                invalid_limits.append("hourly_remaining_uba")
            if limit_fields["daily_remaining_uba"] > limit_fields["daily_limit_uba"]:
                invalid_limits.append("daily_remaining_uba")
            anchor_seconds = parse_int(anchor.get("block_timestamp"))
            expected_delay = max(0, limit_fields["execution_allowed_at"] - anchor_seconds) if anchor_seconds is not None else None
            if expected_delay is None or expected_delay != limit_fields["delay_seconds"]:
                invalid_limits.append("delay_seconds")
            if expected_delay is not None and direct.get("delayed") is not (expected_delay > 0):
                invalid_limits.append("delayed")
            if not all(isinstance(item, str) for item in direct.get("delay_reasons", [])):
                invalid_limits.append("delay_reasons")
            allowed_delay_reasons = {"hourly_window", "daily_window", "large_mint_threshold"}
            if any(item not in allowed_delay_reasons for item in direct.get("delay_reasons", [])):
                invalid_limits.append("delay_reasons")
            if expected_delay == 0 and direct.get("delay_reasons"):
                invalid_limits.append("delay_reasons")
            if expected_delay is not None and expected_delay > 0 and not direct.get("delay_reasons"):
                invalid_limits.append("delay_reasons")
            limiter_disabled = direct.get("limiter_disabled") is True
            if (
                not limiter_disabled
                and amount_uba is not None
                and (
                    (limit_fields["hourly_limit_uba"] > 0 and amount_uba > limit_fields["hourly_remaining_uba"])
                    or (limit_fields["daily_limit_uba"] > 0 and amount_uba > limit_fields["daily_remaining_uba"])
                )
                and expected_delay == 0
            ):
                invalid_limits.append("rate_limit_delay")
            if (
                amount_uba is not None
                and limit_fields["large_threshold_uba"] > 0
                and amount_uba > limit_fields["large_threshold_uba"]
                and limit_fields["large_delay_seconds"] > 0
                and (expected_delay is None or expected_delay < limit_fields["large_delay_seconds"])
            ):
                invalid_limits.append("large_mint_delay")
            if invalid_limits:
                reasons.append(_reason("BLOCK", "DIRECT_MINT_LIMIT_EVIDENCE_INVALID", fields=invalid_limits))
            if direct.get("limiter_disabled") is not True and amount_uba is not None:
                if limit_fields["hourly_limit_uba"] > 0 and amount_uba > limit_fields["hourly_remaining_uba"]:
                    reasons.append(_reason("REVIEW", "DIRECT_MINT_HOURLY_LIMIT"))
                if limit_fields["daily_limit_uba"] > 0 and amount_uba > limit_fields["daily_remaining_uba"]:
                    reasons.append(_reason("REVIEW", "DIRECT_MINT_DAILY_LIMIT"))
            if expected_delay is not None and expected_delay > 0:
                reasons.append(_reason("REVIEW", "DIRECT_MINT_DELAY", execution_allowed_at=str(limit_fields["execution_allowed_at"])))

    if is_live:
        request = evidence.get("request") if isinstance(evidence.get("request"), Mapping) else {}
        if parse_int(request.get("proposed_amount_uba")) != amount_uba or parse_int(request.get("selected_block_number")) != block_number:
            reasons.append(_reason("BLOCK", "REQUEST_EVIDENCE_MISMATCH"))
        mismatches = _adapter_mismatches(evidence, settings, direct)
        if mismatches:
            reasons.append(_reason("BLOCK", "ADAPTER_STATE_MISMATCH", fields=mismatches))

    captured = parse_timestamp(evidence.get("completed_at_utc") or evidence.get("observed_at_utc") or evidence.get("captured_at_utc"))
    replay_context = historical_replay or not is_live
    evaluation_time = captured if replay_context else datetime.now(timezone.utc)
    if block_timestamp is None or evaluation_time is None:
        reasons.append(_reason("REVIEW", "EVIDENCE_FRESHNESS_UNKNOWN"))
    else:
        age = int((evaluation_time - block_timestamp).total_seconds())
        if age < -30:
            reasons.append(_reason("REVIEW", "EVIDENCE_CLOCK_SKEW", age_seconds=age))
        elif age > MAX_EVIDENCE_AGE_SECONDS:
            reasons.append(_reason("REVIEW", "EVIDENCE_STALE", age_seconds=age, maximum_seconds=MAX_EVIDENCE_AGE_SECONDS))

    receipt_summary = None
    if receipt is not None:
        normalized["expected_asset_manager"] = manager.get("address")
        receipt_summary, receipt_reasons = evaluate_receipt(normalized, receipt)
        reasons.extend(receipt_reasons)
    elif require_receipt:
        reasons.append(_reason("REVIEW", "RECEIPT_MISSING"))

    unique = {item.code: item for item in reasons}
    order = {code: index for index, code in enumerate(REASON_ORDER)}
    ordered = sorted(unique.values(), key=lambda item: (LEVEL_RANK.get(item.level, 9), order.get(item.code, 999), item.code))
    decision = decision_from_reasons(ordered)
    provenance = evidence.get("provenance") if isinstance(evidence.get("provenance"), Mapping) else {}
    evaluation_summary = {
        "evaluated_at_utc": _format_utc(evaluation_time) if evaluation_time else None,
        "maximum_evidence_age_seconds": MAX_EVIDENCE_AGE_SECONDS,
        "historical_replay": replay_context,
    }
    evidence_anchor = {
        "block_number": anchor.get("block_number"),
        "block_hash": anchor.get("block_hash"),
        "block_timestamp": anchor.get("block_timestamp") or anchor.get("block_timestamp_utc"),
        "settings_sha256": settings_digest,
        "capture_commit": provenance.get("commit"),
        "capture_tree": provenance.get("tree"),
        "canonical_evidence_sha256": evidence_digest,
    }
    public_intent = {key: value for key, value in normalized.items() if not key.startswith("expected_")}
    digest_payload = {
        "policy_version": POLICY_VERSION,
        "policy_constants": {"chain_id": CHAIN_ID, "maximum_evidence_age_seconds": MAX_EVIDENCE_AGE_SECONDS},
        "intent": public_intent,
        "evidence_anchor": evidence_anchor,
        "evaluation": evaluation_summary,
        "payment_plan": payment_plan,
        "decision": decision,
        "reason_codes": [item.code for item in ordered],
        "receipt": receipt_summary,
    }
    digest = canonical_digest(digest_payload, exclude_dynamic=False)
    # A self-digesting JSON artifact cannot authenticate its own RPC origin.
    # Only the same-process live harness may attest a verified live PASS, and
    # even that stops at human review. Pure policy output never authorizes execution.
    execution_eligible = False
    return {
        "schema_version": "1.1.0",
        "artifact_type": "flare_guard_decision",
        "policy_version": POLICY_VERSION,
        "decision": decision,
        "execution_eligible": execution_eligible,
        "audit_id": f"FLARE-{digest[:16].upper()}",
        "canonical_digest": digest,
        "flare_evidence_sha256": evidence_digest,
        "evidence_anchor": evidence_anchor,
        "evaluation": evaluation_summary,
        "normalized_intent": public_intent,
        "payment_plan": payment_plan,
        "reasons": [item.to_dict() for item in ordered],
        "human_gate": human_gate(decision),
        "receipt": receipt_summary,
        "capability_origin": {
            "baseline_reused": ["secret rejection pattern", "Decimal amount pattern", "PASS/REVIEW/BLOCK priority", "human confirmation gate"],
            "flare_new": [
                "Coston2 chain and Contract Registry identity",
                "anchored FAssets settings, Core Vault, fee and limiter evidence",
                "official 32-byte direct-mint memo and gross payment quote",
                "fixed live freshness and evidence-bound audit digest",
                "DirectMintingExecuted versus delayed receipt semantics",
            ],
        },
    }
