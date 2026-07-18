"""Small JSON-facing models for Flare PayFlow Guard."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


LEVEL_RANK = {"BLOCK": 0, "REVIEW": 1}


@dataclass(frozen=True)
class Reason:
    level: str
    code: str
    message: str
    details: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"level": self.level, "code": self.code, "message": self.message}
        if self.details:
            result["details"] = dict(self.details)
        return result


def decision_from_reasons(reasons: list[Reason]) -> str:
    if any(item.level == "BLOCK" for item in reasons):
        return "BLOCK"
    if any(item.level == "REVIEW" for item in reasons):
        return "REVIEW"
    return "PASS"


def human_gate(decision: str) -> dict[str, Any]:
    if decision == "PASS":
        status = "HUMAN_CONFIRMATION_REQUIRED"
        next_action = "human_wallet_review_only"
    elif decision == "REVIEW":
        status = "REVIEW_REQUIRED"
        next_action = "resolve_reasons_and_recheck"
    else:
        status = "BLOCKED"
        next_action = "correct_and_recheck"
    return {
        "status": status,
        "automatic_signing": False,
        "transaction_submission": False,
        "private_key_custody": False,
        "allowed_next_action": next_action,
    }
