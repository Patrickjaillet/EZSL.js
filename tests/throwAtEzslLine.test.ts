import { throwAtEzslLine } from "../src/errors/throwAtEzslLine.js";

describe("throwAtEzslLine", () => {
  it("throws an Error carrying the given message", () => {
    expect(() => throwAtEzslLine("unknown function 'smoothstp'", "http://localhost/shader.ezsl", 3)).toThrow(
      "unknown function 'smoothstp'",
    );
  });

  it("the thrown error's stack references the given URL", () => {
    try {
      throwAtEzslLine("boom", "http://localhost:5173/examples/gradient/shader.ezsl", 5);
      fail("expected throwAtEzslLine to throw");
    } catch (e) {
      const stack = (e as Error).stack ?? "";
      expect(stack).toContain("http://localhost:5173/examples/gradient/shader.ezsl");
    }
  });

  it("the thrown error's stack references the given line number", () => {
    try {
      throwAtEzslLine("boom", "http://localhost/shader.ezsl", 7);
      fail("expected throwAtEzslLine to throw");
    } catch (e) {
      const stack = (e as Error).stack ?? "";
      expect(stack).toContain("shader.ezsl:7:");
    }
  });

  it("line 1 (no padding needed) still resolves to the right line", () => {
    try {
      throwAtEzslLine("boom", "http://localhost/shader.ezsl", 1);
      fail("expected throwAtEzslLine to throw");
    } catch (e) {
      const stack = (e as Error).stack ?? "";
      expect(stack).toContain("shader.ezsl:1:");
    }
  });

  it("escapes backticks and template-literal interpolation syntax in the message safely", () => {
    // A message containing `${...}` or backticks must not be interpreted
    // as template-literal syntax inside the synthesized function body, and
    // must not allow arbitrary code execution via the message text.
    expect(() => throwAtEzslLine("weird `${1+1}` message", "http://localhost/shader.ezsl", 1)).toThrow(
      "weird `${1+1}` message",
    );
  });

  it("does not execute injected code via a maliciously crafted message", () => {
    let sideEffect = false;
    const evilMessage = "`); (globalThis).__sideEffect = true; throw new Error(`";
    try {
      throwAtEzslLine(evilMessage, "http://localhost/shader.ezsl", 1);
    } catch {
      // expected to throw *some* error either way
    }
    sideEffect = Boolean((globalThis as unknown as { __sideEffect?: boolean }).__sideEffect);
    expect(sideEffect).toBe(false);
    delete (globalThis as unknown as { __sideEffect?: boolean }).__sideEffect;
  });
});
