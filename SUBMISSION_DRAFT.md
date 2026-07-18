# Flare Summer Signal submission copy

> Final English copy for DoraHacks. The public repository and video URL are
> resolved. Do not check the agreements or click
> `Submit for Review` without the user's explicit confirmation.

## DoraHacks profile fields

- **Project name:** Flare PayFlow Guard
- **Bounty / track:** Bounty 1 — Interoperable Asset Products
- **Tagline:** Deterministic FXRP direct-mint preflight anchored to real Flare state.
- **Vision:** Deterministic preflight for FXRP direct-mint and cross-chain payment intent execution, anchored to real Flare state.
- **Category:** Crypto / Web3
- **AI agent:** No
- **Repository:** https://github.com/Lukeknow0/flare-payflow-guard
- **Submission ref:** https://github.com/Lukeknow0/flare-payflow-guard/tree/submission-final
- **Demo video:** https://youtu.be/_hGEM3U8jU8
- **Project website:** leave blank; no hosted browser application is claimed.
- **Social link:** https://github.com/Lukeknow0
- **Team:** Solo builder
- **Need teammates:** No

The exact commit SHA behind the immutable `submission-final` tag is recorded in
the final handoff and verification screenshots. A Git commit cannot contain its
own SHA, so the public document uses the immutable tag rather than a recursive
placeholder.

## Short description

Flare PayFlow Guard is a read-only CLI that checks an FXRP direct-mint intent
against real, block-anchored Coston2 FAssets state before a human opens a
wallet. It deterministically returns `PASS`, `REVIEW`, or `BLOCK`, binds the
result to an audit digest, and always stops at `HUMAN_CONFIRMATION_REQUIRED`.

## DoraHacks Details field — paste from here

# Flare PayFlow Guard

Flare PayFlow Guard is a deterministic preflight and receipt guard for FXRP
direct minting. It turns a structured payment intent plus real Coston2 FAssets
state into `PASS`, `REVIEW`, or `BLOCK` before a human opens a wallet. It is
read-only: there is no signer, private-key input, transaction broadcast, token
transfer, or custom deployment.

## Problem

A cross-chain payment can be structurally valid but unsafe to execute. The
intent may target the wrong network or FAsset, use stale or inconsistent
contract evidence, omit Core Vault fees, exceed immediate hourly or daily
direct-mint capacity, or treat an EVM success status as proof of the claimed
FXRP/XRPL movement. Generic EVM validation does not contain the Flare
Registry/FAssets facts needed to distinguish those cases.

## Solution

The guard:

1. Strictly parses a structured intent and rejects secret-bearing input.
2. Connects to Coston2 and requires chain ID `114`.
3. Selects one block, resolves `AssetManagerFXRP` through Flare's on-chain
   Contract Registry, and proves Registry, AssetManager, and FAsset bytecode.
4. Reads `getSettings`, FTestXRP identity, Core Vault address, minimum and
   executor fees, fee BIPS, hourly/daily limiter state, and large-mint delay
   parameters at that same block.
5. Rechecks the block hash and emits canonical evidence with clean Git,
   dependency-lock, read-only, and no-fallback provenance.
6. Applies fail-closed policy `2.0.0`, including a fixed evaluator-owned
   900-second freshness limit, raw/normalized equality, the net-to-gross quote,
   the official 32-byte direct-mint memo, and evidence-bound decision digests.
7. Optionally evaluates caller-supplied decoded receipt facts. Status alone is
   not settlement: an `EXECUTED` claim requires complete matching
   `DirectMintingExecuted` facts bound to the preflight expectation.

Every policy decision remains non-executable. A live verifier can establish
that the reads and decisions passed, but its next action is still
`HUMAN_CONFIRMATION_REQUIRED`.

## Why Flare is essential

Flare is in the critical path, not a renamed network profile. The guard obtains
the AssetManager dynamically from Flare's Contract Registry; binds it to the
FAsset and deployed bytecode; derives the gross XRPL payment from Core Vault
fees; and uses Flare's direct-mint limiter state to determine whether an intent
can proceed immediately or requires review. Removing or corrupting that Flare
evidence makes `VERIFY_LIVE_PASS` impossible.

## Live proof

The committed evidence includes two independent T1 Coston2 reads and a retained
two-capture policy-2 verification bundle. The retained verification resolved:

- Coston2 chain ID: `114`
- Contract Registry: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`
- `AssetManagerFXRP`: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FAsset: `0x0b6A3645c240605887a5532109323A3E12273dc7`
  (`FTestXRP`, 6 decimals)
- Retained block: `32945674`
- Block hash:
  `0xfd1eae47e1452755a6df32a77ee133ce30d168e0a6429aab2f20b2b9be1145ab`
- Core Vault: `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`
- 10 XRP net quote: `10,200,000 UBA` gross, including the observed minting
  and executor fees
- Result: two `PASS` decisions, verifier-owned `verified_live_pass=true`,
  policy output `execution_eligible=false`, and
  `HUMAN_CONFIRMATION_REQUIRED`

The same-process verifier captures twice, validates both artifacts and both
decisions, and fails non-zero on RPC, chain, ABI, bytecode, block-anchor,
provenance, dependency, evidence-binding, policy, or safety errors. It never
falls back to a fixture or mock. Saved JSON self-digests prove internal
consistency; the fresh same-process verifier is the live authenticity path.

## Reproduce

```bash
npm ci
make verify-offline
make verify
```

The deterministic suites contain 32 Node tests and 101 Python tests: **133
tests total**. Offline verification also checks committed live bundles and
explicitly fixture-labelled `PASS`, `REVIEW`, and `BLOCK` regressions. Full
verification adds two fresh read-only Coston2 captures.

## New work during Flare Summer Signal

The original Pharos project contributed generic patterns only: secret
rejection, exact decimal conversion, reason priority, a human confirmation
gate, and generic receipt normalization. The pre-event boundary is published as
`pre-flare-import`.

New work for Flare includes the Coston2/Registry/FAssets adapter; one-block and
hash-recheck invariant; Core Vault fee and direct-mint limiter reads; policy-2
evidence, provenance, freshness, raw-state, quote, memo, and receipt bindings;
the two-process live verifier; 133 tests; and machine-readable evidence. The
repository's `NEW_WORK_EVIDENCE.md` maps these claims to files, hashes, and
commits.

## Honest limitations

- Live proof is read-only Coston2 state; no custom contract deployment or
  transaction is claimed.
- Receipt checks consume caller-supplied decoded facts and a verification
  marker; they do not independently retrieve an RPC receipt or FDC proof.
- FDC AddressValidity and FDC Payment retrieval are not implemented or claimed.
- An EVM success status is not described as XRPL/FXRP settlement proof.
- There is no wallet connection, private-key custody, automatic signing, token
  movement, or transaction broadcast.
- The product is a reproducible CLI, not a hosted browser application.

## Roadmap

1. Add FDC AddressValidity for the underlying XRPL destination.
2. Add independently verifiable FDC Payment evidence to the receipt boundary.
3. Package the guard as an SDK for wallets and payment-flow developers.
4. Only after separate wallet/test-fund approval, capture one minimal
   explorer-backed Coston2 transaction without adding custody or auto-signing.

## Judging highlights

- **Product usefulness:** catches wrong-chain, wrong-asset, fee, capacity,
  freshness, and receipt-proof failures before wallet execution.
- **Flare integration quality:** Registry, AssetManager, FAsset, Core Vault,
  fees, and limiter state directly determine the result.
- **Technical execution:** one-command offline/live acceptance, 133 tests,
  canonical evidence, and fail-closed error paths.
- **Evidence of new work:** conservative Pharos baseline plus a reviewable
  post-boundary Flare diff and claim-to-commit map.
- **Clarity and future potential:** narrow trust boundaries today, with a direct
  SDK/FDC path for wallets and interoperable payment products.

## End of DoraHacks Details field

## Actual form audit (2026-07-18, UTC+8)

The authenticated DoraHacks flow was opened and inspected without clicking the
final button. Current fields are:

- Profile: name, logo, vision, category, AI-agent choice, at least one social
  link; repository, project website, and demo video are individually labelled
  optional.
- Details: required rich-text project description.
- Team: required team information; inviting another member is optional.
- Contact: required Telegram plus one backup contact.
- Submission: required track, teammate preference, agreement checkbox, and
  `Submit for Review`.

The event's official requirement says “Demo link, video, or working app link.”
The actual form labels the project website optional, and the official event API
reports `mandatory_git_repo_link=false` and `mandatory_video_link=false`.
Therefore a hosted browser application is not mandatory; the public runnable
repository plus a public demo video satisfies the documented artifact shape.

## Final manual gate

- [x] Project name, logo, vision, category, repository, social link, team
  information, Telegram, Discord, Bounty 1, and “Need teammates: No” are known.
- [x] The 6,437-character Details copy above is entered in the DoraHacks form;
  SHA-256
  `cd254c8b735b2c7a50696e6275fdcb1546c10773e0262b8735271b98baf295a3`.
- [x] Public repository and three-minute recording exist.
- [x] The user-approved Unlisted YouTube upload is available at
  `https://youtu.be/_hGEM3U8jU8`; YouTube's unauthenticated oEmbed endpoint
  resolves it, and the URL is entered in the DoraHacks form.
- [ ] User reviews and accepts the DoraHacks Terms of Use and Participant
  Agreement.
- [ ] User explicitly authorizes the final `Submit for Review` click.
