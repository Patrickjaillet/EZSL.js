/**
 * "Did you mean?" identifier-similarity suggestions — ROADMAP.md v0.4
 * deliverable: `"Did you mean?" suggestions for common type errors`. Shared
 * by both the EZSL-side compiler (`compile.ts`, for e.g. `unknown function
 * 'sni'`) and the GLSL-side error dictionary (`errors/dictionary.ts`, for
 * driver-level `undeclared identifier` diagnostics) — see
 * docs/architecture/error-translation.md.
 */

/**
 * Levenshtein edit distance (insertions/deletions/substitutions), the
 * standard metric for "how close is this typo" — small, well-understood,
 * and cheap enough to run against every candidate name for a single typo
 * without any indexing structure. Case-sensitive: EZSL identifiers are
 * case-sensitive, and `Sin` vs `sin` is exactly the kind of near-miss this
 * is meant to catch, not treat as identical.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(Math.min(previousRow[j] + 1, currentRow[j - 1] + 1, previousRow[j - 1] + cost));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

/**
 * Finds the closest match to `name` among `candidates`, or `null` if
 * nothing is close enough to be a plausible typo (rather than an
 * unrelated name). The threshold scales with the shorter of the two
 * names' length, tiered rather than a single linear ratio — tuned by hand
 * against realistic typos (`sni`->`sin`, `smoothstp`->`smoothstep`,
 * `lenght`->`length`, `nomalize`->`normalize`, `mx`->`mix`) while
 * rejecting genuinely unrelated short names (`bogus`, `cosine`, `xyz`
 * against the builtin list all correctly yield no suggestion) — see the
 * regression table in `tests/didYouMean.test.ts`. A flat ratio either
 * over-suggested on short names or missed common short-word typos; this
 * is deliberately a lookup table, not a formula, because there's no
 * principled closed-form that fit both ends without one.
 */
export function didYouMean(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    if (candidate === name) continue; // exact match isn't a typo of itself
    const distance = levenshteinDistance(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (best === null) return null;
  const shorter = Math.min(name.length, best.length);
  const maxAllowedDistance = shorter <= 2 ? 1 : shorter <= 5 ? 2 : Math.floor(shorter / 3) + 1;
  return bestDistance <= maxAllowedDistance ? best : null;
}
