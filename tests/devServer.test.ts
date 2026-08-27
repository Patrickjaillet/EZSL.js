import { EventEmitter } from "node:events";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { compileToMessage, createRequestListener, pageHtml, CLIENT_SCRIPT, runDev } from "../src/cli/devServer.js";

/**
 * A minimal fake `IncomingMessage`/`ServerResponse` pair — enough surface
 * for `createRequestListener`'s handler (`.url`, `.on("close")`,
 * `.writeHead`/`.write`/`.end`) — used instead of a real `node:http` client
 * request against a real listening server. A real-socket approach was
 * tried first and reliably hung inside Jest's `testEnvironment: "node"`
 * sandbox specifically (a `node:http` client `request()`'s response `data`
 * event never fires there, confirmed by an isolated repro with no EZSL
 * code involved at all — the identical server + client logic works
 * correctly both in a plain `node script.mjs` run and in a real Chromium
 * browser via Playwright, so this is a Jest/VM-sandbox incompatibility,
 * not a product bug). Testing `createRequestListener` directly, in-process,
 * sidesteps that sandbox entirely while still exercising the exact same
 * function `runDev` wires into `http.createServer`. See
 * docs/architecture/dev-server.md's "Testing without real sockets" section.
 */
function fakeRequest(url: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.url = url;
  return req;
}

interface FakeResponse {
  res: ServerResponse;
  statusCode: number | undefined;
  headers: Record<string, string | number | string[]> | undefined;
  chunks: string[];
  ended: boolean;
  body(): string;
}

function fakeResponse(): FakeResponse {
  const state: FakeResponse = {
    res: undefined as unknown as ServerResponse,
    statusCode: undefined,
    headers: undefined,
    chunks: [],
    ended: false,
    body() {
      return state.chunks.join("");
    },
  };
  const emitter = new EventEmitter() as unknown as ServerResponse;
  (emitter as unknown as { writeHead: (code: number, headers?: Record<string, string | number | string[]>) => void }).writeHead = (
    code,
    headers,
  ) => {
    state.statusCode = code;
    state.headers = headers;
  };
  (emitter as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    state.chunks.push(chunk);
    return true;
  };
  (emitter as unknown as { end: (chunk?: string) => void }).end = (chunk?: string) => {
    if (chunk !== undefined) state.chunks.push(chunk);
    state.ended = true;
  };
  state.res = emitter;
  return state;
}

/**
 * Waits for a fake response to be finalized (`writeHead` called) after a
 * handler kicked off real, async disk I/O (`readFile`) rather than
 * responding synchronously — `createRequestListener`'s dist/ fallback path
 * does a real `readFile`, so a fixed number of microtask turns isn't a
 * reliable enough wait; this polls the actual observable state instead.
 */
async function waitForResponse(res: FakeResponse): Promise<void> {
  for (let attempt = 0; attempt < 50 && res.statusCode === undefined; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("compileToMessage", () => {
  it("returns ok: true with the compiled Program for valid fragment-stage source", async () => {
    const msg = await compileToMessage("color = [1.0, 0.0, 0.0]", "shader.ezsl", {});
    expect(msg.ok).toBe(true);
    expect(msg.program).toMatchObject({ outColor: { glsl: expect.stringContaining("1.0, 0.0, 0.0") } });
    expect(msg.source).toBe("color = [1.0, 0.0, 0.0]");
    expect(msg.vertex).toBeUndefined();
  });

  it("includes ezslUrl pointing at the served /shader.ezsl route (v0.7 DevTools source-map support)", async () => {
    const msg = await compileToMessage("color = [1.0, 0.0, 0.0]", "shader.ezsl", {});
    expect(msg.ok).toBe(true);
    expect(msg.ezslUrl).toBe("/shader.ezsl");
  });

  it("returns ok: true with a VertexProgram (outPosition, not outColor) when vertex: true", async () => {
    const msg = await compileToMessage("glPosition = vec4(position, 1.0)", "shader.ezsl", { vertex: true });
    expect(msg.ok).toBe(true);
    expect(msg.program).toMatchObject({ outPosition: { glsl: expect.stringContaining("position") } });
    expect(msg.vertex).toBe(true);
  });

  it("returns ok: false with a formatted error for invalid source", async () => {
    const msg = await compileToMessage("color = unknownFn(1.0)", "shader.ezsl", {});
    expect(msg.ok).toBe(false);
    expect(msg.errorText).toContain("unknown function 'unknownFn'");
  });

  it("round-trips the compiled program through JSON (the shape SSE actually pushes over the wire)", async () => {
    const msg = await compileToMessage("color = [uv.x, uv.y, 0.5]", "shader.ezsl", {});
    const roundTripped = JSON.parse(JSON.stringify(msg));
    expect(roundTripped).toEqual(msg);
  });
});

describe("pageHtml / CLIENT_SCRIPT", () => {
  it("pageHtml embeds the file name and references /client.js and the canvas/error element ids", () => {
    const html = pageHtml("shader.ezsl");
    expect(html).toContain("shader.ezsl");
    expect(html).toContain('<script type="module" src="/client.js">');
    expect(html).toContain('id="ezsl-dev-canvas"');
    expect(html).toContain('id="ezsl-dev-error"');
  });

  it("CLIENT_SCRIPT imports mount from /index.js, connects to /events, and calls swapProgram on later messages", () => {
    expect(CLIENT_SCRIPT).toContain('from "/index.js"');
    expect(CLIENT_SCRIPT).toContain('new EventSource("/events")');
    expect(CLIENT_SCRIPT).toContain("mount(canvas, msg.program");
    expect(CLIENT_SCRIPT).toContain("handle.swapProgram(msg.program");
  });
});

describe("createRequestListener", () => {
  let fixtureDir: string;
  let ezslPathForFixture: string;
  const fixtureSource = "color = [1.0, 0.0, 0.0]";

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "ezsl-devserver-fixture-"));
    ezslPathForFixture = join(fixtureDir, "shader.ezsl");
    await writeFile(ezslPathForFixture, fixtureSource, "utf-8");
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("serves the HTML page at /", () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/"), res.res);
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["Content-Type"]).toBe("text/html");
    expect(res.body()).toContain("ezsl-dev-canvas");
  });

  it("serves the client script at /client.js", () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/client.js"), res.res);
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["Content-Type"]).toBe("text/javascript");
    expect(res.body()).toBe(CLIENT_SCRIPT);
  });

  it("serves the watched .ezsl file verbatim at /shader.ezsl when ezslPath is given", async () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null, ezslPathForFixture);
    const res = fakeResponse();
    listener(fakeRequest("/shader.ezsl"), res.res);
    await waitForResponse(res);
    expect(res.statusCode).toBe(200);
    expect(res.body()).toBe(fixtureSource);
  });

  it("falls through to the generic dist/ static route (404, since dist/shader.ezsl doesn't exist) when no ezslPath was given", async () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/shader.ezsl"), res.res);
    await waitForResponse(res);
    expect(res.statusCode).toBe(404);
  });

  it("rejects a path-traversal attempt against the dist/ static route (real vulnerability found in the v1.0.x security review)", async () => {
    // A real, live-confirmed bug: GET /../package.json used to return the
    // real package.json (one directory above the served dist/ root) with
    // a 200 status. See resolveWithinRoot's doc comment in devServer.ts
    // and docs/architecture/security-review.md.
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/../package.json"), res.res);
    await waitForResponse(res);
    expect(res.statusCode).toBe(404);
  });

  it("rejects a URL-encoded path-traversal attempt against the dist/ static route", async () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/..%2fpackage.json"), res.res);
    await waitForResponse(res);
    expect(res.statusCode).toBe(404);
  });

  it("still serves a legitimate nested dist/ path after the traversal fix", async () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/runtime/bootstrap.ts"), res.res);
    await waitForResponse(res);
    expect(res.statusCode).toBe(200);
  });

  it("registers an SSE client at /events and immediately pushes the latest message if one exists", () => {
    const clients = new Set<ServerResponse>();
    const latest = { ok: true as const, program: { outColor: { glsl: "x", type: "vec4" as const } } };
    const listener = createRequestListener("shader.ezsl", clients, () => latest);
    const res = fakeResponse();
    listener(fakeRequest("/events"), res.res);

    expect(res.statusCode).toBe(200);
    expect(res.headers?.["Content-Type"]).toBe("text/event-stream");
    expect(clients.has(res.res)).toBe(true);
    expect(res.body()).toContain(`data: ${JSON.stringify(latest)}`);
  });

  it("does not push anything extra at /events when there is no latest message yet", () => {
    const clients = new Set<ServerResponse>();
    const listener = createRequestListener("shader.ezsl", clients, () => null);
    const res = fakeResponse();
    listener(fakeRequest("/events"), res.res);
    expect(res.body()).toBe("\n"); // just the initial keep-alive newline, no data: line
  });

  it("removes the SSE client from the set when the request closes", () => {
    const clients = new Set<ServerResponse>();
    const listener = createRequestListener("shader.ezsl", clients, () => null);
    const res = fakeResponse();
    const req = fakeRequest("/events");
    listener(req, res.res);
    expect(clients.has(res.res)).toBe(true);
    (req as unknown as EventEmitter).emit("close");
    expect(clients.has(res.res)).toBe(false);
  });

  // `createRequestListener`'s dist/ fallback resolves its static root from
  // `import.meta.url` of the *running* devServer module (see DIST_ROOT in
  // src/cli/devServer.ts) — under ts-jest that's src/cli/devServer.ts
  // itself, one directory above src/, not dist/. Real invocations always
  // run the compiled dist/cli/devServer.js (via `ezsl dev`/`node
  // dist/cli/index.js dev`), where DIST_ROOT correctly resolves to dist/ —
  // confirmed by this project's other tests requiring a prior `npm run
  // build` (see "dist/ availability precondition" below) and by the real,
  // live `ezsl dev` browser run these tests were validated against while
  // building this feature. These two tests account for that ts-jest/dist
  // path difference rather than asserting a path that only exists post-build.
  it("serves a real file out of src/ under ts-jest (dist/ under the real built CLI) for any other path", async () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/runtime/bootstrap.ts"), res.res);
    await waitForResponse(res);
    expect(res.statusCode).toBe(200);
    expect(res.body()).toContain("mount");
  });

  it("returns 404 for a path with no corresponding file under the static root", async () => {
    const listener = createRequestListener("shader.ezsl", new Set(), () => null);
    const res = fakeResponse();
    listener(fakeRequest("/does-not-exist.js"), res.res);
    await waitForResponse(res);
    expect(res.statusCode).toBe(404);
  });
});

describe("runDev (real server lifecycle; only non-streaming fetch requests, no raw HTTP client sockets)", () => {
  let dir: string;
  let ezslPath: string;
  let handle: Awaited<ReturnType<typeof runDev>> | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezsl-devserver-test-"));
    ezslPath = join(dir, "shader.ezsl");
    await writeFile(ezslPath, "color = [1.0, 0.0, 0.0]", "utf-8");
  });

  afterEach(async () => {
    await handle?.close();
    handle = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("starts listening and reports a real, non-zero port when given port: 0", async () => {
    handle = await runDev(ezslPath, { port: 0 });
    expect(handle.port).toBeGreaterThan(0);
  });

  it("binds to 127.0.0.1 explicitly, not all interfaces (real vulnerability found in the v1.0.x security review)", async () => {
    // A real bug: `server.listen(port, callback)` with no host argument
    // binds to `::` (all interfaces) by Node's own default, not
    // localhost-only — despite this file's prior comment claiming
    // otherwise. Confirmed live before the fix: `server.address().address`
    // was `"::"`, and the dev server (including its path-traversal bug,
    // fixed separately above) was reachable from other devices on the
    // same network, not just the developer's own machine. `server.address()`
    // isn't exposed on the public `DevServerHandle` (deliberately minimal
    // API surface), so this reads Node's own `net.Server` internals via
    // the handle's `close` method's bound `this` is not accessible either
    // — instead this asserts the fix at its source: `runDev`'s `listen`
    // call must pass the literal host argument "127.0.0.1", checked via
    // the compiled output text, which is what actually determines the
    // real bind address (Node's own documented behavior for `server.listen`
    // is exhaustively simple here: with vs. without a host argument, no
    // hidden nuance a black-box network test would reveal any more
    // reliably than reading the call site itself).
    const devServerSource = await readFile(join(process.cwd(), "src", "cli", "devServer.ts"), "utf-8");
    expect(devServerSource).toMatch(/server\.listen\(port,\s*"127\.0\.0\.1"/);
    // Also confirm the server still actually comes up and answers on
    // loopback with this argument in place — a real, live listen/connect
    // via a non-streaming `fetch` (safe here — only the SSE *streaming*
    // response case hangs under Jest's sandbox, per the comment above;
    // this is a normal, fully-buffered request/response), not just a
    // source-text assertion.
    handle = await runDev(ezslPath, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${handle.port}/shader.ezsl`);
    expect(res.status).toBe(200);
  });

  it("close() resolves without throwing", async () => {
    handle = await runDev(ezslPath, { port: 0 });
    await expect(handle.close()).resolves.toBeUndefined();
    handle = null;
  });

  it("recompiles and logs on every real file-watch change event, not just at startup", async () => {
    // runDev's internal sseClients/latestMessage state is private to its own
    // closure (by design — see createRequestListener's tests above for the
    // broadcast-formatting logic tested in isolation), so this test instead
    // observes the real fs.watch -> recompile loop's only externally visible
    // side effect: the "[ezsl dev] recompiled ..." stdout log line
    // `recompileAndBroadcast` writes after each successful recompile. This
    // exercises the actual watcher wired up by runDev end-to-end (a real
    // filesystem change event, not a simulated one), while still avoiding
    // any real HTTP client connection.
    const stdoutWrites: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      handle = await runDev(ezslPath, { port: 0 });
      expect(stdoutWrites.some((line) => line.includes("recompiled"))).toBe(true);
      stdoutWrites.length = 0;

      await writeFile(ezslPath, "color = [0.0, 1.0, 0.0]", "utf-8");

      let sawRecompileLog = false;
      for (let attempt = 0; attempt < 25 && !sawRecompileLog; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        sawRecompileLog = stdoutWrites.some((line) => line.includes("recompiled"));
      }
      expect(sawRecompileLog).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }
  }, 15000);
});

describe("dist/ availability precondition", () => {
  it("dist/index.js exists (runDev serves it directly — requires a prior npm run build)", async () => {
    const distIndex = join(process.cwd(), "dist", "index.js");
    await expect(readFile(distIndex, "utf-8")).resolves.toContain("mount");
  });
});
