/**
 * Base64-VLQ encoding, as used by the Source Map v3 spec's `mappings`
 * field (https://sourcemaps.info/spec.html) — a small, self-contained
 * implementation (no dependency) since EZSL only ever needs to *encode*
 * mappings, never decode arbitrary third-party ones. See
 * docs/architecture/devtools-source-maps.md.
 */

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encodes a single signed integer as Base64-VLQ (sign in the low bit, 5 data bits per digit, continuation bit in the 6th). */
export function encodeVlqSigned(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let result = "";
  do {
    let digit = vlq & 0b11111;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0b100000;
    result += BASE64_CHARS[digit];
  } while (vlq > 0);
  return result;
}

/** Encodes a sequence of signed integers (a single "segment" in a `mappings` field) as concatenated Base64-VLQ. */
export function encodeVlqSegment(values: number[]): string {
  return values.map(encodeVlqSigned).join("");
}
