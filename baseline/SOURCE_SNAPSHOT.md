# Pharos PayFlow Guard source snapshot

- Recorded: `2026-07-17 10:46:24 CST (+0800)`
- Source directory: `<redacted-local-pharos-source>`
- Source HEAD: `5af5c651bb60240cfa2c4183e258e438ed2caba0`
- Source worktree: **dirty; contains both tracked modifications and untracked work**
- Tracked binary diff SHA-256: `d36a31e2cd6f75cb5ded3aedf876719237bb5bcecba624d4995bf4700ae55545`
- Porcelain status SHA-256: `a1b630a962e3801006400971d80448d7c14dfcb37788ac19e7cdaf7958844d22`

HEAD is recorded only as repository ancestry. It is not claimed to represent every reused file because some selected helpers are untracked and some tracked files have post-HEAD changes. Every imported file must therefore be identified by its snapshot hash below.

## Candidate reusable files at snapshot time

| Source file | Source state | SHA-256 | Candidate responsibility |
|---|---|---|---|
| `scripts/pharos_common.py` | untracked | `bfb7c1e0e04f8876476bf07d0527e716723b7990a1cd9ef4a3dac1009eca9255` | JSON-RPC, address/hash validation, network helpers |
| `scripts/payflow_guard.py` | tracked, modified | `dc6739e20a6d11baa35184fc722eec82b77baa850e3a7fe81d36e1e67f046021` | deterministic reason and risk-score patterns |
| `scripts/rpc_probe.py` | tracked, modified | `84ea46e2e3efabdb69796b417dc657aff035affd0402575ac1ebf403f1b35656` | read-only EVM preflight patterns |
| `scripts/tx_receipt_summary.py` | tracked, modified | `b177625e5974df3b6f52b6e5fa9b122a45e058bc42cce3e105c918850a197b97` | receipt normalization patterns |
| `tests/test_payflow_agent.py` | untracked | `0e6bc81da4a2fca68f2c6b5c0983acbd6eebeb40eebe2348230df9c7adf860a1` | pre-existing behavior examples only |
| `README.md` | tracked, modified | `f81e00f460f9540d6a37384f741ac17f1e73f15e17d8f051340895a82728d725` | product provenance/context only |

No file has been imported merely by listing it here. The final import manifest will contain the destination hash and an explicit `reused`, `adapted`, or `reference-only` classification.

## Exclusions

Never count these as reusable product work or Flare new work: `.DS_Store`, `__pycache__/`, `*.pyc`, generated images, packaged ZIPs, growth/marketing material, and other generated artifacts. The original Pharos directory remains untouched.
