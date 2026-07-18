"""Deterministic, standard-library-only validation helpers.

The generic validation shape (secret rejection, Decimal parsing, canonical JSON)
is intentionally derived from the disclosed Pharos baseline.  Nothing in this
module performs network access, signing, or transaction submission.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping


class InputError(ValueError):
    """The intent/request cannot be parsed as structured input."""


class EvidenceError(ValueError):
    """The evidence artifact cannot be parsed as structured evidence."""


EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
TX_HASH_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
SECRET_FIELD_NAMES = {
    "privatekey",
    "seed",
    "seedphrase",
    "mnemonic",
    "walletpassword",
    "password",
    "cookie",
    "session",
    "sessiontoken",
    "apikey",
    "secret",
    "keystore",
    "bearertoken",
    "rpccredentials",
    "signingrequest",
    "authorization",
    "accesstoken",
    "refreshtoken",
    "xrpseed",
    "xrplseed",
}
SECRET_VALUE_RE = re.compile(
    r"\b(?:private[ _-]?key|seed(?:[ _-]?phrase)?|mnemonic|wallet[ _-]?password|"
    r"bearer[ _-]?token|rpc[ _-]?credentials?|signing[ _-]?request|keystore)"
    r"\s*(?:is|=|:)\s*\S+",
    re.IGNORECASE,
)

# These fields describe when/how an observation was captured.  They must never
# make a semantic policy/receipt digest change by themselves.
DYNAMIC_OBSERVATION_FIELDS = {
    "run_id",
    "observed_at",
    "observed_at_utc",
    "completed_at",
    "completed_at_utc",
    "latest_block_number_at_start",
    "block_number",
    "block_tag",
    "block_hash",
    "block_timestamp",
    "block_timestamp_utc",
    "confirmations_observed",
    "latency_ms",
    "provenance",
    "calls",
    "integrity",
}


def canonical_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def find_secret_material(value: Any, path: str = "intent") -> list[str]:
    findings: list[str] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if canonical_key(key) in SECRET_FIELD_NAMES:
                findings.append(child_path)
            findings.extend(find_secret_material(child, child_path))
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            findings.extend(find_secret_material(child, f"{path}[{index}]"))
    elif isinstance(value, str) and SECRET_VALUE_RE.search(value):
        findings.append(path)
    return sorted(set(findings))


def parse_decimal(value: Any) -> Decimal | None:
    """Parse exact JSON-safe numeric input; floats are rejected as lossy."""

    if isinstance(value, (bool, float)) or value is None:
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not parsed.is_finite() or (parsed and abs(parsed.adjusted()) > 1000):
        return None
    return parsed


def parse_int(value: Any) -> int | None:
    """Parse a base-10 or 0x integer without passing through float."""

    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if re.fullmatch(r"-?[0-9]+", text):
        return int(text, 10)
    if re.fullmatch(r"0x[0-9a-fA-F]+", text):
        return int(text, 16)
    return None


def amount_to_units(amount: Decimal, decimals: int) -> int | None:
    if decimals < 0 or decimals > 255 or not amount.is_finite():
        return None
    scaled = amount * (Decimal(10) ** decimals)
    if scaled != scaled.to_integral_value() or scaled < 0 or scaled > Decimal(2**256 - 1):
        return None
    try:
        return int(scaled)
    except (OverflowError, ValueError):
        return None


def is_evm_address(value: Any, *, allow_zero: bool = False) -> bool:
    if not isinstance(value, str) or not EVM_ADDRESS_RE.fullmatch(value):
        return False
    return allow_zero or int(value[2:], 16) != 0


def is_tx_hash(value: Any) -> bool:
    return isinstance(value, str) and bool(TX_HASH_RE.fullmatch(value))


def same_address(left: Any, right: Any) -> bool:
    return is_evm_address(left, allow_zero=True) and is_evm_address(right, allow_zero=True) and str(left).lower() == str(right).lower()


def canonicalize(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, Mapping):
        return {str(key): canonicalize(value[key]) for key in sorted(value, key=lambda item: str(item))}
    if isinstance(value, (list, tuple)):
        return [canonicalize(item) for item in value]
    return value


def without_dynamic_observations(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): without_dynamic_observations(child)
            for key, child in sorted(value.items(), key=lambda item: str(item[0]))
            if str(key) not in DYNAMIC_OBSERVATION_FIELDS
        }
    if isinstance(value, (list, tuple)):
        return [without_dynamic_observations(item) for item in value]
    return canonicalize(value)


def canonical_json(value: Any, *, exclude_dynamic: bool = False) -> str:
    normalized = without_dynamic_observations(value) if exclude_dynamic else canonicalize(value)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_digest(value: Any, *, exclude_dynamic: bool = True) -> str:
    return hashlib.sha256(canonical_json(value, exclude_dynamic=exclude_dynamic).encode("utf-8")).hexdigest()


def parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, Decimal)) or (isinstance(value, str) and re.fullmatch(r"[0-9]+", value.strip())):
        try:
            return datetime.fromtimestamp(int(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_json_object(path: str, *, evidence: bool = False) -> dict[str, Any]:
    error_type = EvidenceError if evidence else InputError
    try:
        if path == "-":
            import sys

            value = json.load(sys.stdin)
        else:
            with Path(path).open("r", encoding="utf-8") as handle:
                value = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise error_type(str(exc)) from exc
    if not isinstance(value, dict):
        raise error_type("JSON root must be an object")
    return value
