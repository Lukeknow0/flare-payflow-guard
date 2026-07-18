"""CLI for deterministic intent + Flare evidence evaluation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from .policy import evaluate
from .validation import EvidenceError, InputError, load_json_object

EXIT = {"PASS": 0, "REVIEW": 10, "BLOCK": 20}
EXIT_INPUT = 64
EXIT_EVIDENCE = 70


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Flare FXRP preflight and receipt guard")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--request", help="JSON object containing intent, evidence, and optional receipt")
    source.add_argument("--intent", help="intent JSON path (or - for stdin)")
    parser.add_argument("--evidence", help="Flare evidence JSON path")
    parser.add_argument("--receipt", help="optional receipt JSON path")
    parser.add_argument("--require-receipt", action="store_true")
    parser.add_argument(
        "--historical-replay",
        action="store_true",
        help="evaluate at the evidence observation time and force execution_eligible=false",
    )
    parser.add_argument("--output", help="write decision JSON to this local path")
    parser.add_argument("--compact", action="store_true")
    return parser


def _emit_error(kind: str, message: str, code: int) -> int:
    print(json.dumps({"status": "ERROR", "error_type": kind, "error": message}, sort_keys=True), file=sys.stderr)
    return code


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        if args.request:
            request = load_json_object(args.request)
            intent = request.get("intent")
            evidence = request.get("evidence")
            receipt = request.get("receipt")
            if not isinstance(intent, dict):
                raise InputError("request.intent must be an object")
            if not isinstance(evidence, dict):
                raise EvidenceError("request.evidence must be an object")
            if receipt is not None and not isinstance(receipt, dict):
                raise EvidenceError("request.receipt must be an object")
        else:
            if not args.evidence:
                raise EvidenceError("--evidence is required with --intent")
            intent = load_json_object(args.intent)
            evidence = load_json_object(args.evidence, evidence=True)
            receipt = load_json_object(args.receipt, evidence=True) if args.receipt else None
        result = evaluate(
            intent,
            evidence,
            receipt,
            require_receipt=args.require_receipt,
            historical_replay=args.historical_replay,
        )
        body = json.dumps(result, sort_keys=args.compact, separators=(",", ":") if args.compact else None, indent=None if args.compact else 2) + "\n"
        if args.output:
            Path(args.output).write_text(body, encoding="utf-8")
        else:
            sys.stdout.write(body)
        return EXIT[result["decision"]]
    except InputError as exc:
        return _emit_error("INPUT", str(exc), EXIT_INPUT)
    except EvidenceError as exc:
        return _emit_error("EVIDENCE", str(exc), EXIT_EVIDENCE)
    except Exception as exc:  # malformed nested evidence must remain machine-readable
        return _emit_error("EVALUATION", str(exc), EXIT_EVIDENCE)


if __name__ == "__main__":
    raise SystemExit(main())
