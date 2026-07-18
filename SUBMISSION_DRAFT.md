# Flare Summer Signal submission draft

> Draft only. The public repository and local recording are authorized. Video upload, hosted deployment and DoraHacks final submission still require the user's explicit confirmation.

## Project

- **Name:** Flare PayFlow Guard
- **Bounty:** Bounty 1 — Interoperable Asset Products
- **Tagline:** Deterministic FXRP direct-mint preflight anchored to live Flare state.
- **Repository:** `https://github.com/Lukeknow0/flare-payflow-guard`
- **Demo/video:** `[PENDING PUBLIC DEMO OR VIDEO URL]`
- **Submission commit:** public branch/ref `submission-v1` (resolve with `git rev-parse origin/submission-v1` after fetch)

## Short description

Flare PayFlow Guard checks an FXRP/XRPL direct-mint intent before a human opens a wallet. It resolves `AssetManagerFXRP` through Flare's on-chain Contract Registry, proves AssetManager and FAsset bytecode, reads FAssets settings, Core Vault fees and direct-mint limiter state at one Coston2 block, constructs the official gross quote and 32-byte recipient memo, then returns deterministic `PASS`, `REVIEW`, or `BLOCK` with an evidence-bound audit digest.

A `PASS` never signs or sends. It only returns `HUMAN_CONFIRMATION_REQUIRED`. The project contains no signer and uses no private key.

## Problem

A cross-chain payment can be structurally valid but unsafe to execute: wrong network, wrong FAsset, stale or inconsistent contract evidence, payment below Core Vault fees, hourly/daily capacity delay, or a receipt whose status is mistaken for proof of the claimed asset movement. Generic EVM validation does not contain the Flare Registry/FAssets facts needed to resolve these risks.

## Implemented solution

1. Strictly parse a structured intent and reject secret-bearing input.
2. Connect to official Coston2 and require chain ID `114`.
3. Select one block, resolve `AssetManagerFXRP` through the Contract Registry, and prove Registry/manager/FAsset bytecode.
4. Read `getSettings`, FTestXRP identity, Core Vault address, minimum/executor fees, fee BIPS, hourly/daily limiter state and large-mint delay parameters at that same block.
5. Re-read the block hash and emit canonical evidence with clean Git, dependency-lock and no-wallet/no-fallback provenance.
6. Apply policy `2.0.0`: strict schema, a non-overridable 900-second policy-process clock, raw/normalized equality, net-to-gross fee quote, official 32-byte memo, and evidence/anchor-bound digest.
7. Optionally check caller-supplied decoded receipt facts. `EXECUTED` requires complete preflight expectations and matching live-verified `DirectMintingExecuted` facts; status-only, unbound, mismatched, or delayed evidence cannot execute. This module does not fetch RPC/FDC evidence.

## Why Flare is essential

The core result depends on Flare state, not a renamed network profile:

- the AssetManager is dynamically resolved through Flare's Contract Registry;
- the decision binds the resolved AssetManager to its FAsset and non-empty bytecode;
- Core Vault address and fees determine the gross XRPL payment from the requested net FXRP amount;
- Flare direct-mint hourly/daily/large-mint state changes immediate execution into `REVIEW` when delayed;
- chain, contract, settings and limiter evidence is block-anchored and hash-rechecked.

Deleting or corrupting that Flare evidence triggers a fail-closed result. A fixture or self-edited JSON cannot become a same-process `VERIFY_LIVE_PASS`.

## Live proof

### T1 repeatability

Two independent clean-process reads at pre-public evidence commit `86dda437889856900a9aa6dda46bc2795b395ff4` passed the T1 verifier:

- blocks `32942996` and `32943001`, each with a rechecked block hash;
- Coston2 chain ID `114`;
- Registry `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`;
- dynamic AssetManager `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`;
- dynamic FAsset `0x0b6A3645c240605887a5532109323A3E12273dc7` (`FTestXRP`, 6 decimals);
- 60 decoded `getSettings` fields with digest `217250ae5ee1ed0883f2612415ec632acbe6d3f7e91ab4bf32db61d0304f5579`.

### Historical full direct-mint capture

Clean pre-public code commit `642623c27c89ee15a6fa2c678bd02d95965afaa9` captured live state for a 10 XRP net direct-mint intent at block `32943632`, hash `0xfbc34cc81e7bc92d28db7ccba4e754addb4ea1c598bba787ee26f4dcb687f384`.

The live state included Core Vault `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`, minimum fee `100,000 UBA`, executor fee `100,000 UBA`, fee rate `25 BIPS`, hourly remaining `100,000,000,000 UBA`, daily remaining `499,867,400,000 UBA`, and zero computed delay. Its policy-1 decision is superseded. Current policy-2 historical replay produces:

```json
{
  "decision": "PASS",
  "execution_eligible": false,
  "audit_id": "FLARE-DEB2AA04A4EBB912",
  "payment_plan": {
    "net_mint_uba": "10000000",
    "gross_payment_uba": "10200000",
    "memo_bytes": 32
  },
  "human_gate": {
    "status": "HUMAN_CONFIRMATION_REQUIRED",
    "automatic_signing": false,
    "transaction_submission": false
  }
}
```

The evidence is read-only and explicitly records no wallet, private key, signing, write, broadcast, fixture fallback or mock fallback. No decision JSON can authorize execution. A self-digest proves consistency rather than origin; the fresh same-process verifier is the authenticity path and still stops at human review.

### Fresh policy-2 candidate proof

Clean pre-public candidate `c665bab4c82d0d0595879b687d103adcc76a1a73` passed full
`make verify`. A separate same-process run retained five artifacts under
`evidence/live/final-policy2-c665bab-20260717/` only after both captures and
decisions passed.

Both independent captures selected block `32945674`, hash
`0xfd1eae47e1452755a6df32a77ee133ce30d168e0a6429aab2f20b2b9be1145ab`.
Run 1 produced evidence digest `f2a7b873...1254` and audit
`FLARE-F7C8F944588F365D`; run 2 produced `1428b813...da4a` and
`FLARE-E702DAB1AF174779`. Both returned `PASS`,
`verified_live_pass=true`, `execution_eligible=false`, gross payment
`10,200,000 UBA`, the official memo and `HUMAN_CONFIRMATION_REQUIRED`.

## Reproducibility

```bash
npm ci
make verify-offline
make verify
```

The current deterministic suites contain **32 Node tests and 101 Python tests (133 total)**. Offline verification checks both committed T1 bundles, pathological/tampered inputs, human-only decision output, and fixture-labelled `PASS`, `REVIEW`, and `BLOCK` paths. Full verification adds two independent fresh Coston2 captures and two strictly bound policy decisions; it emits `VERIFY_LIVE_PASS` or fails non-zero without substituting a fixture.

## New-work disclosure

The public pre-event boundary is branch/ref `pre-flare-import`; the candidate is branch/ref `submission-v1`. The original Pharos worktree contained both committed and pre-existing local changes; all of that generic behavior is conservatively treated as baseline. `PUBLIC_HISTORY.md` explains the publication-only history representation and evidence-embedded hashes.

Baseline patterns adapted with attribution: secret rejection, exact Decimal amounts, generic address/hash checks, reason priority, human confirmation and generic receipt normalization.

Flare-new work: Coston2/Registry/FAssets adapter, one-block/hash-recheck invariant, direct-mint limiter and Core Vault reads, policy-2 fail-closed bindings, gross quote and official memo, executed-versus-delayed/mismatched/unbound receipt semantics, 133 tests, verification harness and live artifacts. `NEW_WORK_EVIDENCE.md` maps each claim to source files, hashes and commits.

## Honest limitation

- Current live proof is read-only Coston2 state; no custom deployment or transaction is claimed.
- Receipt checks operate on caller-supplied decoded facts and a verification marker; they do not independently fetch/decode a chain receipt or verify the marker's origin.
- Saved JSON self-digests prove internal consistency, not source authenticity; use the same-process fresh verifier for the live claim.
- FDC AddressValidity and Payment are not implemented or claimed.
- EVM success alone is not described as XRPL/FXRP settlement proof.
- Wallet/test-token/signing/deployment, video upload, hosted deployment, posting and final submission require explicit user approval. Public repository creation and local recording are authorized.

## Next extension after separate approval

1. Add FDC AddressValidity for the underlying XRPL destination.
2. Add independently verifiable FDC Payment evidence to the receipt claim boundary.
3. If wallet/test-fund use is approved, capture one minimal Coston2 transaction and explorer-backed receipt.
4. Package the guard as an SDK for wallet and payment-flow developers.

## Final submission checklist

- [ ] `make verify` passes from the final clean commit and the output is retained outside Git for the demo.
- [x] Public repository branch/ref `submission-v1` points to the published candidate.
- [x] Local text-led demo shows retained live Flare state, `PASS/REVIEW/BLOCK`, human gate and provenance diff.
- [ ] Screenshots retain full mode, block/address/hash and contain no secret material.
- [ ] Any future transaction/deployment claim has a matching explorer artifact; otherwise state “no custom deployment.”
- [x] User explicitly approves public repository and local recording.
- [ ] User explicitly approves video upload, hosted deployment, post and DoraHacks final submission.
