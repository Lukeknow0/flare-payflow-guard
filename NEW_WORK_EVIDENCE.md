# New Work Evidence

Audit date: `2026-07-18`

Latest runtime/harness implementation commit at this documentation cut: pre-public evidence hash `ecf45375c238679756fe45b57acb1f2e801781fb`

Public pre-Flare boundary: branch/ref `pre-flare-import`

Original Pharos repository HEAD: `5af5c651bb60240cfa2c4183e258e438ed2caba0`

## 1. Conservative attribution rule

The original Pharos PayFlow Guard worktree was dirty before Flare development. Therefore both behavior in Pharos HEAD and behavior found only in its pre-existing local worktree are treated as baseline. Copying, adapting, renaming or moving that behavior does not make it Flare-new.

Only implementation created after local tag `pre-flare-import` may be presented as Summer Signal new work. The tag commit contains planning, terms, track-decision and provenance controls; it establishes the boundary and is not counted as new core runtime.

The authoritative source snapshot is `provenance/pharos-source.json`; its companion is `baseline/SOURCE_SNAPSHOT.md`. The source repository itself was not edited. `PUBLIC_HISTORY.md` records the privacy-preserving publication representation and explains the evidence-embedded pre-public hashes.

## 2. Adapted Pharos baseline

| Baseline source and pre-Flare class | Adapted destination | Reused behavior, not counted as Flare-new | Destination hash recorded at |
|---|---|---|---|
| `scripts/payflow_guard.py` — `HEAD_COMMITTED_AND_MODIFIED_PRE_FLARE` | `src/flare_guard/validation.py`, `src/flare_guard/models.py` | canonical key/secret scan/Decimal parsing; reason aggregation; `PASS/REVIEW/BLOCK` priority; human confirmation pattern | reviewed pre-public snapshot `c006890` |
| `scripts/pharos_common.py` — `PRE_FLARE_LOCAL_UNCOMMITTED` | `src/flare_guard/validation.py` | EVM address and transaction-hash validation patterns | reviewed pre-public snapshot `c006890` |
| `scripts/rpc_probe.py` — `HEAD_COMMITTED_AND_MODIFIED_PRE_FLARE` | `src/flare_guard/validation.py` | exact decimal-to-base-unit conversion pattern | reviewed pre-public snapshot `c006890` |
| `scripts/tx_receipt_summary.py` — `HEAD_COMMITTED_AND_MODIFIED_PRE_FLARE` | `src/flare_guard/receipt.py` | generic receipt-status normalization and canonical summary pattern | reviewed pre-public snapshot `c006890` |
| `tests/test_payflow_agent.py` — `PRE_FLARE_LOCAL_UNCOMMITTED` | none | reference only; no test imported | n/a |

The provenance record stores each source Git blob or worktree SHA-256, every destination SHA-256, adapted symbols and explicit non-reuse. In particular, the Pharos Python RPC transport, Pharos network configuration, generic mock/live probe and ERC-20 call encoding were not reused.

## 3. Flare-new implementation

The following behavior did not exist in the recorded Pharos baseline:

- Node/viem Coston2 adapter using pinned Flare-published ABI package versions.
- Dynamic Contract Registry lookup for `AssetManagerFXRP`, bytecode proof and FAsset identity chain.
- One-block anchoring and post-read block-hash recheck.
- FAssets `getSettings`, Core Vault payment address, direct-mint minimum/executor fees, fee BIPS, hourly/daily limiter state, large-mint threshold and delay calculation.
- Canonical, self-digesting `flare_fassets_evidence` artifacts with clean Git provenance, exact manifest/lock/runtime dependency records, safety flags and no fixture fallback.
- Fail-closed policy `2.0.0`: fixed evaluator-controlled freshness, strict intent schema, evidence/anchor/provenance/safety validation, raw/normalized state equality, and evidence-bound decision digests.
- Official direct-mint quote semantics (`net + minting fee + executor fee`) and 32-byte recipient memo generation.
- Coston2/FXRP-specific receipt rules: `status=1` is insufficient, delayed events are not settlement, and an executed claim requires expected EVM/underlying transaction IDs plus block/emitter/AssetManager/event/amount/fee/target bindings.
- Stable Flare audit IDs, canonical decision/receipt digests, CLI exit codes,
  human-only policy output, and verifier-owned `VERIFY_LIVE_PASS` authenticity boundary.
- Node and Python tests for the Flare adapter, canonicalization, capture, policy, failure paths, receipt boundaries and CLI.
- T1 and full direct-mint live evidence bundles plus machine/human summaries.

### Commit-to-claim map

| Pre-public evidence commit | Reviewable Flare-new result |
|---|---|
| `c3aad80c` | official Coston2 Contract Registry/FAssets T1 reader and two-run verifier |
| `f0c5e55f` | two independent T1 live bundles and verification summaries |
| `efbcb755` | locked architecture and initial submission/evidence plan |
| `90912921` | canonical helpers, direct-mint limiter algorithms, anchored FAssets adapter and Node tests |
| `08018775` | deterministic Python Flare policy, CLI, receipt checks and Python tests |
| `37418533` | clean-tree, write-once full FAssets preflight capture and tests |
| `b3924baa` | Core Vault address, minimum/executor fee and limiter guardrails |
| `642623c2` | 10 XRP intent connected to live FAssets evidence and deterministic policy |
| `1be14cdd` | committed full live direct-mint evidence and `PASS` decision |
| `57038df0` | symbol-level adapted-baseline mapping with destination hashes |
| `50878a4` | policy-2 fail-closed evidence, freshness, gross-payment, receipt and digest fixes plus P0 regressions |
| `42c59d4`, `f27f295`, `fe2e357`, `c006890` | receipt block/emitter/native-field bindings, raw/normalized equality and malformed-input hardening |
| `9e7eba9` | repository-root Git provenance plus exact manifest/lock/SRI/runtime dependency evidence |
| `ff96fbf` | one-command offline/live verification, fixtures and two-process live harness |
| `8386b32` | strict decision/evidence binding and optional five-artifact retained live bundle |
| `ecf45375` | evaluator-owned freshness, pinned manifest/lock/SRI/runtime provenance, human-only decision authenticity boundary, fully bound receipt execution, and P0 regressions |

The working-tree documentation is not assigned an invented commit. Reviewers
should use `git rev-parse HEAD` and the commands below for the exact candidate.

## 4. Machine evidence

### T1: repeatable live read

Both T1 artifacts were captured from clean pre-public commit `86dda437...` in separate processes. They resolve the same Registry -> AssetManager -> FAsset path and the same 60-field settings digest.

| Run | Coston2 anchor | Canonical payload SHA-256 |
|---|---|---|
| `t1-run-1.json` | block `32942996`, `0x84b8d3be327919c69d172e3f4f2312c6c523ab09ed3f7f39d5ed83de9aea3558` | `892dcf5447c3091cf0969b1f7c00ffa14b938d9b8eef0b229863b01f8792d687` |
| `t1-run-2.json` | block `32943001`, `0x42c7e37547799ea482b897fb2a2a932a786574d85e2037df3997c83b09390e1a` | `5231543b09d71fdc0f7461eb18b31f0b0b13a4ccb40026aab4c720034d556c71` |

### Historical full live direct-mint capture

The committed full artifact was captured from clean pre-public code commit `642623c...` at block `32943632`, hash `0xfbc34cc81e7bc92d28db7ccba4e754addb4ea1c598bba787ee26f4dcb687f384`.

- Registry: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`.
- Dynamic `AssetManagerFXRP`: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`.
- FAsset: `0x0b6A3645c240605887a5532109323A3E12273dc7`, `FTestXRP`, 6 decimals.
- Core Vault: `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`.
- Minimum fee / executor fee: `100,000 / 100,000 UBA`; fee rate: `25 BIPS`.
- Hourly / daily remaining: `100,000,000,000 / 499,867,400,000 UBA`.
- Proposed net amount: `10,000,000 UBA`; computed delay: zero.
- Evidence digest: `12258b73dce67daf013a90903ccf862c690fd9dd32663e255f3b613ad3e9192a`.
- The old policy-1 decision `FLARE-E566...` is superseded because it did not
  model gross payment correctly. It is retained only as development history.
- Current policy-2 explicit historical replay: `PASS`, audit
  `FLARE-DEB2AA04A4EBB912`, `execution_eligible=false`.
- Corrected quote: `10,000,000 UBA` net + `100,000` minting fee + `100,000`
  executor fee = `10,200,000 UBA` gross, plus the official 32-byte recipient memo.

### Retained policy-2 candidate verification

Clean pre-public candidate `c665bab4c82d0d0595879b687d103adcc76a1a73` passed
`make verify-offline`, full `make verify`, and a separate retained verifier run.
The retained bundle is `evidence/live/final-policy2-c665bab-20260717/`.

Both independent capture processes selected Coston2 block `32945674`, hash
`0xfd1eae47e1452755a6df32a77ee133ce30d168e0a6429aab2f20b2b9be1145ab`.
They agree on Registry, AssetManager, FAsset and settings identity while producing
different capture/evidence and decision digests:

| Run | Evidence digest | Audit / decision digest |
|---|---|---|
| 1 | `f2a7b873e6ce9baef3a7d6ef4a9d822414cfff0f0802f474a864b1c076941254` | `FLARE-F7C8F944588F365D` / `f7c8f944588f365dfa28479641025e90690790587755b1c14268cfc1dc45cd4c` |
| 2 | `1428b8134f86b9b8ffdbc9eb07905b0e134f907ecb48f02eb00975fdc576da4a` | `FLARE-E702DAB1AF174779` / `e702dab1af174779b237a9ae86279a09994d1ab3c2ab9919754648f7b86d6b4f` |

Each run reports policy `PASS`, verifier-owned `verified_live_pass=true`,
`execution_eligible=false`, gross payment `10,200,000 UBA`, the official memo,
and `HUMAN_CONFIRMATION_REQUIRED`. The summary records read-only operation with
no wallet, private key, signing, chain write, broadcast, fixture or mock fallback.
The five file SHA-256 values are recorded in `EVIDENCE_CHECKLIST.md`.

The older T1 bundles explicitly state `mode=live`, clean provenance, read-only operation, no wallet/signature/transaction, and no fixture fallback. The full-preflight/current capture schema additionally records no private-key requirement, chain write, broadcast, or mock fallback plus manifest/lock/runtime dependency provenance. These self-assertions and digests prove consistency, not origin by themselves; the trusted path is the same-process fresh verifier.

## 5. Tests

At this audit cut:

- Node: 32 passing tests including subtests, covering canonicalization, write-once capture, repository/dependency provenance, anchored reads, limiter boundaries and live-verifier orchestration.
- Python: 101 passing tests covering pathological input, strict schema, evaluator-owned freshness, manifest/lock/SRI/runtime provenance, safety/raw bindings, gross fees/memo, `PASS/REVIEW/BLOCK`, executed-versus-delayed/mismatched/unbound receipts and CLI exits.
- Total: **133 passing tests**.

## 6. Reviewer commands

Run from the repository root:

```bash
# Prove the public boundary and inspect the complete added-work diff.
git fetch origin pre-flare-import submission-v1
git rev-parse origin/pre-flare-import
git rev-parse origin/submission-v1
git diff --stat origin/pre-flare-import..origin/submission-v1
git diff --name-status origin/pre-flare-import..origin/submission-v1

# Inspect source attribution.
jq . provenance/pharos-source.json

# Run the deterministic suites and committed evidence checks.
npm ci
make verify-offline

# Replay the committed historical live capture without a network call.
PYTHONPATH=src python3 -m flare_guard.cli \
  --intent examples/intents/direct-mint-10-xrp.json \
  --evidence evidence/live/runs/preflight-live-2.json \
  --historical-replay

# Add a fresh read-only Coston2 verification; never falls back to a fixture.
make verify

# Retain a verified pair only after both captures and decisions pass.
node scripts/verify-live.mjs \
  --retain-dir evidence/live/<new-unique-directory>
```

## 7. Explicit non-claims

This repository does **not** currently prove or claim:

- FDC AddressValidity or Payment attestation/verification;
- an XRPL settlement inferred from an EVM receipt;
- wallet connection, private-key custody, signature or transaction broadcast;
- test-token movement, transaction hash or custom contract deployment;
- hosted browser application, publicly hosted video, post or DoraHacks submission;
- event-specific eligibility, KYC path, payment asset/network or payout SLA.

Those items remain separate future work or external-action gates. None is needed to rerun the current read-only Flare core and deterministic decision evidence.
