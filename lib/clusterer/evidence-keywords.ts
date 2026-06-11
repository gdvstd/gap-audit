const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "and", "or", "is", "was", "that", "this",
  "with", "for", "on", "at", "by", "from", "as", "it", "be", "not", "but", "if",
  "no", "yes", "are", "has", "have", "had", "were", "will", "can", "did", "does",
]);

export function extractEvidenceKeywords(evidence: string[]): string[] {
  const concatenated = evidence.join(" ");
  const tokens = concatenated.toLowerCase().split(/[^a-z0-9]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}
