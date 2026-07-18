#!/usr/bin/env python3
"""Run one explicit offline demo fixture through the real guard CLI.

The guard intentionally returns 10 for REVIEW and 20 for BLOCK.  This wrapper
turns an expected business decision into process exit 0 while preserving the
original business exit code in its JSON summary.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUSINESS_EXIT = {"PASS": 0, "REVIEW": 10, "BLOCK": 20}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run an explicitly labelled fixture demo")
    parser.add_argument("fixture_positional", nargs="?", help="fixture JSON path")
    parser.add_argument("expected_positional", nargs="?", choices=sorted(BUSINESS_EXIT), help="expected decision")
    parser.add_argument("--fixture", dest="fixture_option", help="fixture JSON path")
    parser.add_argument("--expected", dest="expected_option", choices=sorted(BUSINESS_EXIT), help="expected decision")
    return parser


def _json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} is not readable JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def _resolve_project_file(raw: Any, label: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError(f"{label} must be a non-empty project-relative path")
    path = (PROJECT_ROOT / raw).resolve()
    try:
        path.relative_to(PROJECT_ROOT)
    except ValueError as exc:
        raise ValueError(f"{label} escapes the project root") from exc
    return path


def _materialize_request(fixture: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if fixture.get("mode") != "fixture":
        raise ValueError("fixture.mode must be exactly 'fixture'")

    inline = fixture.get("request")
    if inline is not None:
        if not isinstance(inline, dict):
            raise ValueError("fixture.request must be an object")
        intent = inline.get("intent")
        evidence = inline.get("evidence")
        if not isinstance(intent, dict) or not isinstance(evidence, dict):
            raise ValueError("fixture.request must contain intent and evidence objects")
        if evidence.get("mode") != "fixture":
            raise ValueError("inline fixture evidence must be labelled mode=fixture, never live")
        return {"intent": intent, "evidence": evidence, "receipt": inline.get("receipt")}, "inline-fixture"

    intent_path = _resolve_project_file(fixture.get("intent_file"), "fixture.intent_file")
    evidence_path = _resolve_project_file(fixture.get("evidence_file"), "fixture.evidence_file")
    intent = _json_object(intent_path, "referenced intent")
    evidence = _json_object(evidence_path, "referenced evidence")
    if evidence.get("mode") != "live" or evidence.get("artifact_type") != "flare_fassets_evidence":
        raise ValueError("external evidence replay must reference a genuine captured live evidence artifact")
    safety = evidence.get("safety")
    if not isinstance(safety, dict) or safety.get("fixture_fallback") is not False or safety.get("mock_fallback") is not False:
        raise ValueError("external evidence replay declares a fixture or mock fallback")
    return {"intent": intent, "evidence": evidence}, "captured-live-evidence-replay"


def run_fixture(fixture_path: Path, expected: str) -> dict[str, Any]:
    fixture = _json_object(fixture_path, "fixture")
    fixture_expected = fixture.get("expected_decision")
    if fixture_expected is not None and fixture_expected != expected:
        raise ValueError(f"fixture expects {fixture_expected}, command requested {expected}")
    request, source_kind = _materialize_request(fixture)

    env = dict(os.environ)
    existing_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(PROJECT_ROOT / "src"), existing_pythonpath) if part
    )
    with tempfile.TemporaryDirectory(prefix="flare-payflow-fixture-") as directory:
        request_path = Path(directory) / "request.json"
        request_path.write_text(json.dumps(request, sort_keys=True), encoding="utf-8")
        command = [sys.executable, "-m", "flare_guard.cli", "--request", str(request_path), "--compact"]
        if source_kind == "captured-live-evidence-replay":
            command.append("--historical-replay")
        completed = subprocess.run(
            command,
            cwd=PROJECT_ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    expected_exit = BUSINESS_EXIT[expected]
    if completed.returncode != expected_exit:
        detail = completed.stderr.strip() or completed.stdout.strip() or "no CLI output"
        raise RuntimeError(
            f"guard CLI exit mismatch: expected {expected_exit}, observed {completed.returncode}: {detail}"
        )
    try:
        decision = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"guard CLI returned invalid JSON: {exc}") from exc
    if not isinstance(decision, dict) or decision.get("decision") != expected:
        raise RuntimeError(
            f"guard decision mismatch: expected {expected}, observed {decision.get('decision') if isinstance(decision, dict) else type(decision).__name__}"
        )
    if source_kind == "captured-live-evidence-replay" and decision.get("execution_eligible") is not False:
        raise RuntimeError("historical live-evidence replay must never be execution eligible")

    reasons = decision.get("reasons") if isinstance(decision.get("reasons"), list) else []
    return {
        "status": "DEMO_PASS",
        "fixture_id": fixture.get("fixture_id", fixture_path.stem),
        "fixture_mode": "fixture",
        "source_kind": source_kind,
        "expected_decision": expected,
        "observed_decision": decision["decision"],
        "business_exit_code": completed.returncode,
        "runner_exit_code": 0,
        "audit_id": decision.get("audit_id"),
        "reason_codes": [item.get("code") for item in reasons if isinstance(item, dict) and isinstance(item.get("code"), str)],
        "human_gate": decision.get("human_gate", {}).get("status") if isinstance(decision.get("human_gate"), dict) else None,
        "execution_eligible": decision.get("execution_eligible"),
    }


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    fixture_raw = args.fixture_option or args.fixture_positional
    expected = args.expected_option or args.expected_positional
    if not fixture_raw or not expected:
        _parser().error("fixture and expected decision are required")
    try:
        result = run_fixture(Path(fixture_raw).resolve(), expected)
    except (ValueError, RuntimeError) as exc:
        print(json.dumps({"status": "DEMO_FAILED", "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
