import { describe, expect, test } from "bun:test";
import { dot, fromBlob, toBlob, vectorLength } from "../src/local/rag/vectors.js";

describe("vector codec", () => {
  test("round-trips an aligned blob", () => {
    const source = new Float32Array([1.5, -2.25, 0.5]);
    const blob = toBlob(source);
    expect(blob.byteLength).toBe(12);

    const decoded = fromBlob(blob);
    expect(decoded.byteOffset % 4).toBe(0);
    expect(Array.from(decoded)).toEqual([1.5, -2.25, 0.5]);
  });

  test("round-trips at an unaligned offset", () => {
    const raw = new Uint8Array(13);
    raw.set(toBlob(new Float32Array([1.5, -2.25, 0.5])), 1);
    const slice = raw.subarray(1);
    expect(slice.byteOffset).toBe(1);

    // A shared buffer can hand out an odd offset; that path copies instead.
    expect(Array.from(fromBlob(slice))).toEqual([1.5, -2.25, 0.5]);
  });

  test("derives the length from the byte count", () => {
    expect(vectorLength(new Uint8Array(12))).toBe(3);
    // A trailing partial float is ignored rather than read as garbage.
    expect(vectorLength(new Uint8Array(13))).toBe(3);
    expect(vectorLength(new Uint8Array(0))).toBe(0);
  });

  test("dot of a normalized vector with itself is one", () => {
    const raw = new Float32Array([0.6, 0.8, 0]);
    expect(dot(raw, raw)).toBeCloseTo(1, 6);
  });

  test("decoding does not alias the source vector", () => {
    const source = new Float32Array([1.5, -2.25, 0.5]);
    const blob = toBlob(source);
    const decoded = fromBlob(blob);

    decoded[0] = 99;
    expect(source[0]).toBe(1.5);

    source[1] = 42;
    expect(blob[4]).not.toBe(42);
  });

  test("toBlob copies out of a subarray view", () => {
    const backing = new Float32Array([0, 1, 2, 3]);
    const blob = toBlob(backing.subarray(1, 3));
    expect(blob.byteLength).toBe(8);
    expect(Array.from(fromBlob(blob))).toEqual([1, 2]);
  });
});
