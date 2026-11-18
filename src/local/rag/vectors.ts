/**
 * Embedding vectors travel as BLOBs. Decoding used to copy every scanned row
 * into a fresh buffer; a view is valid whenever the blob is 4-byte aligned,
 * which is what `bun:sqlite` returns for a column value.
 */

export function vectorLength(bytes: Uint8Array): number {
  return Math.floor(bytes.byteLength / 4);
}

export function toBlob(vector: Float32Array): Uint8Array {
  const copy = new Uint8Array(vector.byteLength);
  copy.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
  return copy;
}

export function fromBlob(bytes: Uint8Array): Float32Array {
  if (bytes.byteOffset % 4 === 0) {
    return new Float32Array(bytes.buffer, bytes.byteOffset, vectorLength(bytes));
  }
  // A shared buffer can hand out a view at an odd offset; Float32Array rejects
  // that, so those rare blobs keep the copy path.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, vectorLength(copy));
}

/** Dot product; embeddings are normalized, so this is also cosine similarity. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}
