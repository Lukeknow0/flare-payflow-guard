# Public history disclosure

This project was developed from an existing Pharos PayFlow Guard codebase. Before public release, private planning/terms records, local absolute paths and author email metadata that were not part of the product were removed. Runtime code, tests and committed Flare evidence were retained.

The connector-backed public release represents the review boundary with two named branches/refs:

- `pre-flare-import`: the conservatively attributed Pharos-derived baseline and provenance record;
- `submission-v1`: the complete Flare Summer Signal candidate.

Review the exact added-work surface with:

```bash
git fetch origin pre-flare-import submission-v1
git diff --stat origin/pre-flare-import..origin/submission-v1
git diff --name-status origin/pre-flare-import..origin/submission-v1
```

Some immutable JSON evidence bundles were captured before publication and therefore embed their original clean commit hash. Those provenance fields were not edited after capture. They identify these milestones:

| Pre-public evidence hash | Result |
|---|---|
| `3c8489704adc560f47923e7d88c2ff7d44fb588c` | pre-Flare baseline boundary |
| `86dda437889856900a9aa6dda46bc2795b395ff4` | official Coston2 Registry/FAssets live spike |
| `8f8ff08442900cd071e858b6b7a3ccfa4163ea35` | retained two-run T1 evidence |
| `642623c27c89ee15a6fa2c678bd02d95965afaa9` | full direct-mint capture code |
| `1be14cdd6f22c378302565b94355288ad22c97a4` | retained historical direct-mint evidence |
| `ecf45375c238679756fe45b57acb1f2e801781fb` | final policy/runtime hardening |
| `c665bab4c82d0d0595879b687d103adcc76a1a73` | candidate that passed full verification |

The disclosure does not turn a saved JSON self-digest into proof of RPC origin. The live authenticity path remains `make verify`, which captures and validates fresh Coston2 state in one fail-closed process.
