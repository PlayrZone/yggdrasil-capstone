/**
 * Embeddings power retrieval relevance only — never learning (miners work
 * on structured fields). Local ONNX (bge-small class) lands at Y2; the
 * Fireworks embeddings API is the alternative behind this same interface.
 */
export interface IEmbedder {
  embed(text: string): Promise<Float32Array>;
}

/** Y0/Y1 default: no embeddings; retrieval scores recency × importance. */
export class NullEmbedder implements IEmbedder {
  embed(): Promise<Float32Array> {
    return Promise.resolve(new Float32Array(0));
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
