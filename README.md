# Flare PayFlow Guard

Flare PayFlow Guard is a deterministic cross-chain asset preflight and receipt guard for FXRP/XRPL. It is being built for Flare Summer Signal, Bounty 1 — Interoperable Asset Products.

The core promise is intentionally narrow: given a structured asset/payment intent and verifiable Flare evidence, return `PASS`, `REVIEW`, or `BLOCK`, cite stable reason codes, require human-controlled execution, and produce an auditable receipt summary. It never signs or submits a transaction.

Development status and evidence gates are tracked in [`STATUS.md`](./STATUS.md). The pre-Flare Pharos provenance boundary is frozen in [`baseline/SOURCE_SNAPSHOT.md`](./baseline/SOURCE_SNAPSHOT.md) and [`provenance/pharos-source.json`](./provenance/pharos-source.json).

