# Screenshot and transaction evidence checklist

## Captured machine evidence

### T1 read-only Coston2 proof

- [x] Clean pre-public capture code commit `86dda437889856900a9aa6dda46bc2795b395ff4`.
- [x] Two independent JSON bundles in `evidence/live/runs/t1-run-{1,2}.json`.
- [x] Run 1: block `32942996`, hash `0x84b8d3be327919c69d172e3f4f2312c6c523ab09ed3f7f39d5ed83de9aea3558`.
- [x] Run 2: block `32943001`, hash `0x42c7e37547799ea482b897fb2a2a932a786574d85e2037df3997c83b09390e1a`.
- [x] Contract Registry `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` plus bytecode digest.
- [x] Dynamically resolved AssetManager `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` plus bytecode digest.
- [x] Dynamically read FAsset `0x0b6A3645c240605887a5532109323A3E12273dc7`, symbol `FTestXRP`, decimals `6`.
- [x] 60-field settings digest `217250ae5ee1ed0883f2612415ec632acbe6d3f7e91ab4bf32db61d0304f5579`.
- [x] Machine summary `evidence/live/t1-verification.json` and human summary `evidence/T1_VERIFICATION.md`.

### Historical 10 XRP live-state capture

- [x] Clean pre-public capture code commit `642623c27c89ee15a6fa2c678bd02d95965afaa9`.
- [x] Evidence artifact `evidence/live/runs/preflight-live-2.json`.
- [x] Superseded policy-1 decision retained only as development history.
- [x] Block `32943632`, hash `0xfbc34cc81e7bc92d28db7ccba4e754addb4ea1c598bba787ee26f4dcb687f384`.
- [x] Core Vault `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`.
- [x] Minimum/executor fees `100,000 / 100,000 UBA`; fee rate `25 BIPS`.
- [x] Hourly/daily remaining `100,000,000,000 / 499,867,400,000 UBA`; computed delay zero.
- [x] Evidence digest `12258b73dce67daf013a90903ccf862c690fd9dd32663e255f3b613ad3e9192a`.
- [x] Current policy-2 historical replay: `PASS`, audit
  `FLARE-DEB2AA04A4EBB912`, `execution_eligible=false`.
- [x] Corrected payment plan: `10,000,000 UBA` net, `10,200,000 UBA` gross,
  and official 32-byte recipient memo.
- [x] No wallet, key, signing, write, broadcast, fixture fallback or mock fallback.

### Final policy-2 fresh evidence

- [x] Clean pre-public capture commit `c665bab4c82d0d0595879b687d103adcc76a1a73`
  plus retained `VERIFY_LIVE_PASS` directory
  `evidence/live/final-policy2-c665bab-20260717/`.
- [x] Two captures and two decisions share the clean commit/tree and stable
  Registry/AssetManager/FAsset identities.
- [x] Both independent captures selected block `32945674`, hash
  `0xfd1eae47e1452755a6df32a77ee133ce30d168e0a6429aab2f20b2b9be1145ab`;
  distinct artifact digests prove they are separate capture outputs.
- [x] Each decision binds its evidence SHA, block hash, settings digest,
  gross quote, memo, policy version and human gate, with
  `execution_eligible=false`; the verifier summary records `verified_live_pass=true`.
- [x] Run 1: evidence `f2a7b873e6ce9baef3a7d6ef4a9d822414cfff0f0802f474a864b1c076941254`,
  audit `FLARE-F7C8F944588F365D`, decision digest
  `f7c8f944588f365dfa28479641025e90690790587755b1c14268cfc1dc45cd4c`.
- [x] Run 2: evidence `1428b8134f86b9b8ffdbc9eb07905b0e134f907ecb48f02eb00975fdc576da4a`,
  audit `FLARE-E702DAB1AF174779`, decision digest
  `e702dab1af174779b237a9ae86279a09994d1ab3c2ab9919754648f7b86d6b4f`.
- [x] File SHA-256 values:
  `capture-1=992890e1ecc1b26d5f634ad38e0043cf8ed2f7f38940565a88caecf3864ce780`,
  `capture-2=e8db192c44cb11175d68e2a11ef272b729d0a53692cb2490272b075b1fce64fc`,
  `decision-1=9b3f99233d33722ee2b46972b172cd0afaecda31af3793587f052d81e663e788`,
  `decision-2=defbe57ddcf0604f50da1729a4edef33a4ecd424667fbe3dd8e0318dfac24d5f`,
  `summary=72f262dc579764b418982c0ad830fd22cf0627ee29234a0d10f7e1eec3ac2e80`.

## Required screenshots before submission

- [ ] Final clean commit plus `make verify` result `VERIFY_PASS`.
- [ ] `make verify-live` summary with both fresh blocks/hashes, Registry/AssetManager/FAsset, evidence digests, two `PASS` results and safety flags.
- [ ] Historical replay showing `PASS`, `FLARE-DEB2AA04A4EBB912`,
  `execution_eligible=false` and `HUMAN_CONFIRMATION_REQUIRED`.
- [ ] `demo-review` showing `fixture_mode=fixture`, `DIRECT_MINT_DELAY` and business exit `10`.
- [ ] `demo-block` showing `fixture_mode=fixture`, `CHAIN_MISMATCH` and business exit `20`.
- [ ] Test summary showing 32 Node tests plus 101 Python tests (133 total).
- [ ] Receipt frame showing empty success -> REVIEW, delayed -> REVIEW, and
  fully bound `DirectMintingExecuted` -> EXECUTED.
- [ ] `git diff --stat origin/pre-flare-import..origin/submission-v1` and adapted-baseline mapping.

Every screenshot must preserve the full command, mode label, relevant address/hash and result. Do not crop the distinction between fresh live output, saved-live replay and fixture regression. Final PNG files and SHA-256 values are stored outside Git in the handoff directory so generating them does not dirty or change the verified commit. The repository checklist records what each image must prove; the local `SCREENSHOT_MANIFEST.md` records the exact final files and hashes.

A saved JSON self-digest proves consistency, not source authenticity. The live
claim must show the same-process `make verify` or retained `verify-live.mjs`
capture-to-validation path.

## Transaction/deployment evidence: not authorized and not present

No wallet, test-token transaction, transaction hash or custom deployment exists. Do not create one until the user separately confirms wallet, test-token, signing and deployment actions.

If authorized later, capture all of the following:

- [ ] Exact user authorization and timestamp.
- [ ] Network and chain ID `114`.
- [ ] Sender, target, selector/value and decoded arguments.
- [ ] Transaction hash and Coston2 explorer link.
- [ ] Block number/hash/timestamp and receipt status.
- [ ] Gas used, effective gas price and calculated fee.
- [ ] Trusted event emitter, topic, ABI source hash and decoded fields.
- [ ] Matching intent/evidence/decision/receipt digests.
- [ ] If claiming XRPL settlement, the matching independently verified FDC Payment proof.
- [ ] Explicit evidence statement that no private key or seed was captured.

## Public artifact gate

- [x] User approves a public GitHub repository and exact commit/tag.
- [x] Hosted browser application is not required by the official event wording
  or actual form; no hosted app is claimed.
- [x] User approves local recording.
- [ ] User approves video upload/provider.
- [ ] User approves any community/X/Telegram post.
- [x] DoraHacks hacker registration completed.
- [x] Non-final BUIDL form preparation is authorized; `Submit for Review` was
  not clicked.
- [ ] User reviews/accepts the DoraHacks agreements and authorizes final
  submission.
