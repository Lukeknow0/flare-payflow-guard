# Live evidence

`runs/` contains generated, read-only Coston2 evidence and is ignored while a capture is in progress so the spike can prove that its code tree is clean. A successful pair is verified with:

```bash
npm run spike:verify -- evidence/live/runs/<run-1>.json evidence/live/runs/<run-2>.json
```

Only verified bundles may be promoted into a committed evidence snapshot. A network failure is fatal; the live command has no fixture or mock fallback.

The full preflight verifier can retain two fresh captures, two policy decisions,
and its machine summary only after all four artifacts pass validation:

```bash
node scripts/verify-live.mjs \
  --retain-dir evidence/live/<new-unique-directory>
```

Retained JSON and self-digests prove internal consistency, not origin by
themselves. The trusted claim is the reproducible, same-process capture and
validation command from a clean commit. Historical replay always sets
`execution_eligible=false`.
