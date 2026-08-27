import { encodeVlqSigned, encodeVlqSegment } from "../src/errors/vlq.js";

// Reference values cross-checked against the Source Map v3 spec's own
// worked example and well-known encodings from the `source-map` npm
// package's test fixtures (values reproduced here, not imported — this
// project has no dependency on that package).
describe("encodeVlqSigned", () => {
  it("encodes 0 as 'A'", () => {
    expect(encodeVlqSigned(0)).toBe("A");
  });

  it("encodes small positive integers", () => {
    expect(encodeVlqSigned(1)).toBe("C");
    expect(encodeVlqSigned(2)).toBe("E");
    expect(encodeVlqSigned(15)).toBe("e");
  });

  it("encodes small negative integers", () => {
    expect(encodeVlqSigned(-1)).toBe("D");
    expect(encodeVlqSigned(-2)).toBe("F");
  });

  it("encodes a value requiring continuation (>= 16 magnitude)", () => {
    // 16 << 1 = 32 = 0b100000, which needs a continuation digit.
    expect(encodeVlqSigned(16)).toBe("gB");
  });

  it("round-trips through a hand-rolled VLQ decoder for a range of values", () => {
    const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function decodeOne(str: string): number {
      let result = 0;
      let shift = 0;
      let i = 0;
      let digit: number;
      do {
        const char = str[i++];
        digit = BASE64_CHARS.indexOf(char);
        result += (digit & 0b11111) << shift;
        shift += 5;
      } while (digit & 0b100000);
      const negative = (result & 1) === 1;
      result >>>= 1;
      return negative ? -result : result;
    }

    for (const value of [0, 1, -1, 5, -5, 15, 16, -16, 100, -100, 1000, -1000]) {
      expect(decodeOne(encodeVlqSigned(value))).toBe(value);
    }
  });
});

describe("encodeVlqSegment", () => {
  it("concatenates multiple encoded values with no separator", () => {
    expect(encodeVlqSegment([0, 0, 0, 0])).toBe("AAAA");
  });

  it("encodes a realistic 4-field segment (generatedColumn, sourceIndex, sourceLine, sourceColumn)", () => {
    expect(encodeVlqSegment([0, 0, 5, 0])).toBe(`A${"A"}${encodeVlqSigned(5)}A`);
  });
});
