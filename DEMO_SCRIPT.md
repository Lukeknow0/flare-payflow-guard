# Three-minute demo script

> Local recording is authorized. Upload, hosted release and final submission still require the user's explicit confirmation. Run from a clean final commit.

## 0:00–0:20 — The failure boundary

“A direct-mint payment can use the wrong chain or FAsset, fall below Core Vault fees, hit Flare's hourly/daily delay logic, or show a receipt whose status is mistaken for settlement. Flare PayFlow Guard turns the live protocol state into a deterministic decision before a human opens a wallet.”

Show the flow at the top of `ARCHITECTURE.md`: intent -> Flare Registry/FAssets -> policy -> human confirmation.

## 0:20–1:00 — Fresh live Flare proof

Run from a clean worktree with network access:

```bash
make verify-live
```

Point to:

- `mode=live` and `status=VERIFY_LIVE_PASS`;
- two independently captured Coston2 block/hash anchors (they may coincide if both processes select the same tip-relative block);
- Registry -> `AssetManagerFXRP` -> FAsset addresses;
- settings/evidence digests;
- two Python `PASS` results with `execution_eligible=false`, plus verifier-owned
  `verified_live_pass=true` and `HUMAN_CONFIRMATION_REQUIRED`;
- safety fields showing read-only, no wallet, no signing, no broadcast, no fixture or mock fallback.

Say: “These are two independent child-process captures from the same clean commit. A network or validation failure stops the command; it cannot switch to a fixture.”

## 1:00–1:25 — Inspect the captured real decision

Replay the committed block `32943632` artifact:

```bash
PYTHONPATH=src python3 -m flare_guard.cli \
  --intent examples/intents/direct-mint-10-xrp.json \
  --evidence evidence/live/runs/preflight-live-2.json \
  --historical-replay \
  --compact
```

Show `PASS`, audit ID `FLARE-DEB2AA04A4EBB912`,
`execution_eligible=false`, and the human gate. Point to the 10 XRP net / 10.2
XRP gross quote and 32-byte memo, then open `evidence/PREFLIGHT_LIVE.md` for the
Core Vault, fees and limiter facts.

Say: “This is an offline historical verdict about a genuinely captured block,
not a current execution approval. Historical replay is always non-executable.”

## 1:25–1:55 — Deterministic REVIEW and BLOCK

Run the explicitly fixture-labelled regression demos:

```bash
make demo-review
make demo-block
```

For `REVIEW`, show `fixture_mode=fixture`, business exit code `10`, reason `DIRECT_MINT_DELAY`, and the human gate. For `BLOCK`, show business exit code `20`, reason `CHAIN_MISMATCH`, and the blocked gate.

Say: “These two are fixtures used to make failure paths repeatable; they are not described as live. The business exit codes stay machine-readable even though the demo wrapper exits zero after matching the expected result.”

## 1:55–2:15 — Receipt claim boundary

Open `src/flare_guard/receipt.py` and the `ReceiptTests` section of `tests/python/test_core.py`.

Say: “Status 1 alone is REVIEW. EXECUTED requires complete preflight
expectations plus matching caller-supplied live-verified AssetManager
`DirectMintingExecuted` facts bound to block, emitter, underlying transaction,
asset, target, amount and fees. Missing bindings, mismatches and delayed events
remain non-executed. The module does not independently fetch RPC or FDC evidence.”

## 2:15–2:40 — Machine acceptance and new-work proof

Run:

```bash
make verify-offline
git diff --stat origin/pre-flare-import..HEAD
```

Point to 32 Node tests, 101 Python tests, `T1_PASS`, all three demo decisions,
and `VERIFY_OFFLINE_PASS`. Then open `NEW_WORK_EVIDENCE.md` and show that generic
Pharos patterns are baseline while Registry/FAssets/direct-mint code and tests
are mapped to post-boundary commits.

## 2:40–3:00 — Close

“Remove Flare and the Registry identity, FXRP contract chain, Core Vault fees and protocol limiter evidence disappear, so the verifier cannot emit `VERIFY_LIVE_PASS`. The result is narrow, honest and independently rerunnable: live Flare reads, deterministic human-only decisions, no custody and no automatic transaction.”

## Recording checklist

- Start by showing the full clean submission commit.
- Keep command, `mode`, block number/hash, contract addresses, decision and human gate visible.
- Never show environment variables, wallet UI, API keys, account history or unrelated files.
- Call `make verify-live` output live; call `demo-review` and `demo-block` fixture regressions.
- Explain that a retained artifact self-digest proves consistency; the same-process fresh capture and validation establish the live claim.
- Do not claim a deployment, transaction, FDC proof, receipt fetch or settlement.
- Preserve failed commands only when they demonstrate an intentional fail-closed path.
