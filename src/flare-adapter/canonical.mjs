import { createHash } from "node:crypto";

function canonicalizeInternal(value, ancestors) {
  if (typeof value === "bigint") return value.toString(10);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON does not support non-finite numbers");
    }
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value !== "object") {
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError("canonical JSON does not support cyclic values");
  }
  ancestors.add(value);
  try {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new TypeError("canonical JSON does not support invalid dates");
      }
      return value.toISOString();
    }
    if (value instanceof Uint8Array) {
      return `0x${Buffer.from(value).toString("hex")}`;
    }
    if (Array.isArray(value)) {
      return value.map((item) => {
        const normalized = canonicalizeInternal(item, ancestors);
        return normalized === undefined ? null : normalized;
      });
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `canonical JSON only supports plain objects, received ${value.constructor?.name ?? "unknown"}`,
      );
    }

    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const item = canonicalizeInternal(value[key], ancestors);
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Convert a value into a deterministic JSON-safe structure.
 * BigInts become base-10 strings, object keys are sorted, and undefined object
 * properties are omitted. Arrays keep their order.
 */
export function canonicalize(value) {
  return canonicalizeInternal(value, new Set());
}

export function canonicalJson(value) {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) {
    throw new TypeError("canonical JSON requires a JSON-serializable root value");
  }
  return encoded;
}

export function sha256Text(value) {
  if (typeof value !== "string") throw new TypeError("sha256Text requires a string");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Canonical(value) {
  return sha256Text(canonicalJson(value));
}
