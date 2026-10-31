import { describe, expect, it } from "vitest";
import { canonicalJson, hashCanonical } from "../src/index.ts";

describe("canonicalJson", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("is insensitive to key insertion order", () => {
    expect(hashCanonical({ x: 1, y: 2 })).toBe(hashCanonical({ y: 2, x: 1 }));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson([Infinity])).toThrow();
  });
});
