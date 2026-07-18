import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalJson,
  canonicalize,
  sha256Canonical,
  sha256Text,
} from "../../src/flare-adapter/canonical.mjs";

test("canonicalize sorts object keys, stringifies bigint, and omits undefined fields", () => {
  const input = {
    z: undefined,
    b: 2,
    a: 1n,
    nested: { y: undefined, x: 3n },
    array: [undefined, 4n, { b: 2, a: 1 }],
  };

  assert.deepEqual(canonicalize(input), {
    a: "1",
    array: [null, "4", { a: 1, b: 2 }],
    b: 2,
    nested: { x: "3" },
  });
  assert.equal(
    canonicalJson(input),
    '{"a":"1","array":[null,"4",{"a":1,"b":2}],"b":2,"nested":{"x":"3"}}',
  );
});

test("canonical helpers normalize dates and bytes deterministically", () => {
  assert.equal(
    canonicalJson({ when: new Date("2026-07-17T00:00:00.000Z"), bytes: new Uint8Array([0, 15, 255]) }),
    '{"bytes":"0x000fff","when":"2026-07-17T00:00:00.000Z"}',
  );
});

test("canonical digest is invariant to insertion order", () => {
  const left = { z: 9n, a: { c: true, b: "x" } };
  const right = { a: { b: "x", c: true }, z: 9n };
  assert.equal(sha256Canonical(left), sha256Canonical(right));

  const body = canonicalJson(left);
  assert.equal(
    sha256Text(body),
    createHash("sha256").update(body, "utf8").digest("hex"),
  );
});

test("canonical helpers reject ambiguous or cyclic values", () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalJson(new Map()), /plain objects/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cyclic/);
  assert.throws(() => canonicalJson(undefined), /serializable root/);
});
