import { compilePasses, topologicalOrder, PipelineError } from "../src/runtime/pipeline.js";
import type { PassSource } from "../src/runtime/pipeline.js";

function pass(source: string): PassSource {
  return { source };
}

describe("compilePasses", () => {
  it("throws PipelineError when no pass is named 'Image'", () => {
    expect(() => compilePasses({ BufferA: pass("color = [1, 1, 1]") })).toThrow(PipelineError);
  });

  it("compiles a single Image-only pipeline with no dependencies", () => {
    const passes = compilePasses({ Image: pass("color = [1, 1, 1]") });
    expect(passes).toHaveLength(1);
    expect(passes[0].dependsOn).toEqual([]);
    expect(passes[0].isFeedback).toBe(false);
  });

  it("discovers a buffer dependency via .sample(uv)", () => {
    const passes = compilePasses({
      BufferA: pass("color = [1, 0, 0]"),
      Image: pass("x = BufferA.sample(uv)\ncolor = x"),
    });
    const image = passes.find((p) => p.name === "Image")!;
    expect(image.dependsOn).toEqual(["BufferA"]);
  });

  it("marks a self-sampling pass as isFeedback", () => {
    const passes = compilePasses({
      BufferA: pass("prev = BufferA.sample(uv)\ncolor = prev"),
      Image: pass("color = BufferA.sample(uv)"),
    });
    const bufferA = passes.find((p) => p.name === "BufferA")!;
    expect(bufferA.isFeedback).toBe(true);
  });

  it("defaults an unset format to RGBA8", () => {
    const passes = compilePasses({ Image: pass("color = [1, 1, 1]") });
    expect(passes[0].format).toBe("RGBA8");
  });

  it("respects an explicitly requested format", () => {
    const passes = compilePasses({ Image: { source: "color = [1, 1, 1]", format: "RGBA16F" } });
    expect(passes[0].format).toBe("RGBA16F");
  });

  it("wraps a per-pass CompileError in a PipelineError naming the pass", () => {
    expect(() => compilePasses({ Image: pass("x = 1") })).toThrow(PipelineError);
    try {
      compilePasses({ Image: pass("x = 1") });
    } catch (err) {
      expect((err as Error).message).toContain("'Image'");
    }
  });

  it("a pass referencing an undeclared buffer name is rejected at compile time, not silently ignored", () => {
    expect(() =>
      compilePasses({ Image: pass("x = NotDeclared.sample(uv)\ncolor = x") }),
    ).toThrow(PipelineError);
  });
});

describe("topologicalOrder", () => {
  it("orders a dependency before its dependent", () => {
    const passes = compilePasses({
      BufferA: pass("color = [1, 0, 0]"),
      Image: pass("x = BufferA.sample(uv)\ncolor = x"),
    });
    const order = topologicalOrder(passes).map((p) => p.name);
    expect(order.indexOf("BufferA")).toBeLessThan(order.indexOf("Image"));
  });

  it("handles a diamond dependency graph correctly", () => {
    const passes = compilePasses({
      BufferA: pass("color = [1, 0, 0]"),
      BufferB: pass("x = BufferA.sample(uv)\ncolor = x"),
      BufferC: pass("x = BufferA.sample(uv)\ncolor = x"),
      Image: pass("b = BufferB.sample(uv)\nc = BufferC.sample(uv)\ncolor = b + c"),
    });
    const order = topologicalOrder(passes).map((p) => p.name);
    expect(order.indexOf("BufferA")).toBeLessThan(order.indexOf("BufferB"));
    expect(order.indexOf("BufferA")).toBeLessThan(order.indexOf("BufferC"));
    expect(order.indexOf("BufferB")).toBeLessThan(order.indexOf("Image"));
    expect(order.indexOf("BufferC")).toBeLessThan(order.indexOf("Image"));
  });

  it("allows a self-referencing feedback buffer without treating it as a cycle", () => {
    const passes = compilePasses({
      BufferA: pass("prev = BufferA.sample(uv)\ncolor = prev"),
      Image: pass("color = BufferA.sample(uv)"),
    });
    expect(() => topologicalOrder(passes)).not.toThrow();
  });

  it("detects a genuine two-pass cycle (A depends on B, B depends on A) at compile time", () => {
    const passes = compilePasses({
      BufferA: pass("x = BufferB.sample(uv)\ncolor = x"),
      BufferB: pass("x = BufferA.sample(uv)\ncolor = x"),
      Image: pass("color = BufferA.sample(uv)"),
    });
    expect(() => topologicalOrder(passes)).toThrow(PipelineError);
  });

  it("detects a three-pass cycle (A -> B -> C -> A)", () => {
    const passes = compilePasses({
      BufferA: pass("x = BufferC.sample(uv)\ncolor = x"),
      BufferB: pass("x = BufferA.sample(uv)\ncolor = x"),
      BufferC: pass("x = BufferB.sample(uv)\ncolor = x"),
      Image: pass("color = BufferA.sample(uv)"),
    });
    expect(() => topologicalOrder(passes)).toThrow(PipelineError);
  });

  it("a linear chain with no cycle orders correctly", () => {
    const passes = compilePasses({
      BufferA: pass("color = [1, 0, 0]"),
      BufferB: pass("x = BufferA.sample(uv)\ncolor = x"),
      Image: pass("x = BufferB.sample(uv)\ncolor = x"),
    });
    const order = topologicalOrder(passes).map((p) => p.name);
    expect(order).toEqual(["BufferA", "BufferB", "Image"]);
  });
});
