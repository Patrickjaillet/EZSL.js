import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, watch as fsWatch } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname, resolve, sep } from "node:path";
import { compileEzsl, compileEzslVertex } from "../compiler/index.js";
import { formatCliError, isEzslPipelineError } from "./formatCliError.js";
import type { CliOptions } from "./commands.js";

/**
 * The compiled `Program`/`VertexProgram` a `.ezsl` file produces is plain
 * JSON-serializable data (`glsl` strings + `EzslType` strings + numbers —
 * see `src/codegen/types.ts`; confirmed by round-tripping a real compile
 * through `JSON.stringify`/`JSON.parse` while building this). That's what
 * makes SSE-pushing a compiled program to the browser as simple as it is
 * here: no separate serialization format, no extra client-side compiler —
 * the server does the one `compileEzsl`/`compileEzslVertex` call already
 * used by `build`/`check`/`watch`, and the client's `mount()`/`swapProgram()`
 * take that exact object shape directly. See docs/architecture/dev-server.md.
 */
interface DevServerMessage {
  ok: boolean;
  /** Present when `ok` is true: the compiled Program/VertexProgram, JSON round-tripped as-is. */
  program?: unknown;
  /** The original .ezsl source, always sent alongside `program` so the client's mount() can pass `ezslSource` for translated compile errors on a later real WebGL2 link failure. */
  source?: string;
  /**
   * The watched file's real, network-resolvable URL on this dev server
   * (`/shader.ezsl` — see the route in `createRequestListener` below),
   * passed alongside `source` so the client's `mount()`/`swapProgram()`
   * can supply `ezslUrl` too — v0.7 DevTools source-map support (see
   * `MountOptions.ezslUrl` in `src/runtime/bootstrap.ts` and
   * docs/architecture/devtools-source-maps.md). A later real WebGL2
   * compile/link failure then throws with a stack frame DevTools can
   * open directly at `http://localhost:<port>/shader.ezsl:<line>`,
   * instead of only a plain-text translated message.
   */
  ezslUrl?: string;
  vertex?: boolean;
  /** Present when `ok` is false: the pretty-printed LexError/ParseError/CompileError block. */
  errorText?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/cli/devServer.js -> dist/ is one level up; the served library files
// (dist/index.js and everything it imports) live there. Serving the whole
// dist/ tree (not just index.js) is required because dist/index.js itself
// has relative ESM imports into dist/codegen/, dist/compiler/, etc. — the
// browser resolves those against the page's own URL space, so they all need
// to be reachable under the same static root, not just the one entry file.
const DIST_ROOT = join(HERE, "..");

const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".map": "application/json",
  ".html": "text/html",
};

/**
 * Resolves `url` against `root` and confirms the result is still inside
 * `root` — rejecting any path-traversal attempt (`/../package.json`,
 * `/..%2f..%2fetc/passwd`, etc.) before ever touching the filesystem.
 *
 * A real, exploitable path-traversal bug was found here during the v1.0.x
 * security review (see docs/architecture/security-review.md): the
 * previous code passed `req.url` straight into `path.join(DIST_ROOT,
 * url)` with only a comment claiming safety ("no path-traversal guard
 * beyond Node's own URL parsing is added here... bound to localhost") —
 * neither half of that claim held up. `path.join` does **not** sandbox
 * `..` segments (confirmed directly: `join(DIST_ROOT, "/../package.json")`
 * resolves to a real file one directory above `DIST_ROOT`), and
 * `server.listen(port, callback)` with no host argument binds to `::`
 * (all interfaces), not localhost-only, despite the comment's claim —
 * confirmed directly via `server.address()`. Combined, a live `ezsl dev`
 * session was confirmed, with a real HTTP client, to serve arbitrary
 * files outside `dist/` (its own `package.json` was read back verbatim
 * via `GET /../package.json`) to anyone who could reach the port,
 * including — because of the binding issue — other devices on the same
 * network, not just the developer's own machine. Returns `null` if `url`
 * would escape `root`; the caller must treat that as a 404, not attempt
 * to serve anything.
 */
function resolveWithinRoot(root: string, url: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url; // malformed percent-encoding — fall through to the containment check below on the raw string
    }
  })();
  const resolved = resolve(root, `.${decoded}`);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

function pageHtml(ezslFileName: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ezsl dev — ${ezslFileName}</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; }
  #ezsl-dev-error {
    position: fixed; inset: 0; margin: 0; padding: 24px;
    background: rgba(20, 0, 0, 0.92); color: #ff8080;
    font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap;
    overflow: auto; display: none;
  }
</style>
</head>
<body>
<canvas id="ezsl-dev-canvas"></canvas>
<pre id="ezsl-dev-error"></pre>
<script type="module" src="/client.js"></script>
</body>
</html>
`;
}

/**
 * The browser-side counterpart of `devServer.ts` — connects to `/events`
 * (SSE), and on every message either `mount()`s (first message) or
 * `swapProgram()`s (every later one) the pushed compiled program onto the
 * page's fullscreen canvas, or shows the formatted compile error overlay
 * instead of touching the canvas — see `EzslRuntimeHandle.swapProgram`'s
 * doc comment (src/runtime/bootstrap.ts) for why a failed swap leaves the
 * previous frame rendering rather than blanking the canvas.
 */
const CLIENT_SCRIPT = `import { mount } from "/index.js";

const canvas = document.getElementById("ezsl-dev-canvas");
const errorEl = document.getElementById("ezsl-dev-error");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

function showError(text) {
  errorEl.textContent = text;
  errorEl.style.display = "block";
}
function hideError() {
  errorEl.style.display = "none";
}

let handle = null;

const source = new EventSource("/events");
source.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.ok) {
    showError(msg.errorText);
    return;
  }
  const mountOptions = { ezslSource: msg.source, ezslUrl: msg.ezslUrl ? new URL(msg.ezslUrl, window.location.href).href : undefined };
  try {
    if (handle === null) {
      handle = mount(canvas, msg.program, mountOptions);
    } else {
      handle.swapProgram(msg.program, mountOptions);
    }
    hideError();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
};
`;

function sseWrite(res: ServerResponse, message: DevServerMessage): void {
  res.write(`data: ${JSON.stringify(message)}\n\n`);
}

/**
 * Compiles `source` (the already-read contents of the watched `.ezsl` file)
 * into the message shape pushed to the browser over SSE — exported
 * separately from `runDev` (which wires it into a real listening HTTP
 * server + file watcher) specifically so it's unit-testable as plain,
 * synchronous-shaped logic without opening a socket. See
 * docs/architecture/dev-server.md's "Testing without real sockets" section
 * for why `tests/devServer.test.ts` never makes a real HTTP client request
 * against a `runDev`-started server.
 */
export async function compileToMessage(source: string, fileLabel: string, options: CliOptions): Promise<DevServerMessage> {
  try {
    const program = options.vertex ? compileEzslVertex(source) : compileEzsl(source);
    return { ok: true, program, source, ezslUrl: "/shader.ezsl", vertex: options.vertex };
  } catch (error) {
    if (isEzslPipelineError(error)) {
      return { ok: false, errorText: formatCliError(error, source, fileLabel) };
    }
    throw error;
  }
}

export { pageHtml, CLIENT_SCRIPT };

export interface DevServerHandle {
  port: number;
  /** Stops the HTTP server and the underlying file watch loop. */
  close(): Promise<void>;
}

/**
 * Builds the `(req, res) => void` request listener `runDev` hands to
 * `http.createServer` — factored out on its own (taking the same
 * `sseClients`/`latestMessage` state `runDev` would otherwise close over
 * inline) so `tests/devServer.test.ts` can invoke it directly against
 * fake, in-process `req`/`res` objects, never a real socket. See
 * docs/architecture/dev-server.md.
 */
export function createRequestListener(
  fileName: string,
  sseClients: Set<ServerResponse>,
  getLatestMessage: () => DevServerMessage | null,
  ezslPath?: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";

    if (url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(pageHtml(fileName));
      return;
    }

    if (url === "/client.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(CLIENT_SCRIPT);
      return;
    }

    // Serves the watched .ezsl file itself, verbatim, at a real
    // network-resolvable URL — v0.7 DevTools source-map support (see
    // DevServerMessage.ezslUrl above). Without this route, `ezslUrl`
    // would point nowhere DevTools could actually open/fetch.
    if (url === "/shader.ezsl" && ezslPath !== undefined) {
      readFile(ezslPath, "utf-8")
        .then((contents) => {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(contents);
        })
        .catch(() => {
          res.writeHead(404);
          res.end("not found");
        });
      return;
    }

    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      sseClients.add(res);
      const latestMessage = getLatestMessage();
      if (latestMessage !== null) sseWrite(res, latestMessage);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // Every other path is served straight out of dist/ (the built library
    // the client script imports "/index.js" from — see DIST_ROOT above).
    // resolveWithinRoot rejects any path-traversal attempt before this
    // ever touches the filesystem — see its own doc comment for the real
    // vulnerability this closes (a live GET /../package.json request was
    // confirmed, during the v1.0.x security review, to read a real file
    // outside dist/).
    const filePath = resolveWithinRoot(DIST_ROOT, url);
    if (filePath === null) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    readFile(filePath, "utf-8")
      .then((contents) => {
        const contentType = MIME_TYPES[extname(filePath)] ?? "text/plain";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(contents);
      })
      .catch(() => {
        res.writeHead(404);
        res.end("not found");
      });
  };
}

/**
 * `ezsl dev <file.ezsl>`: serves a minimal auto-generated HTML page with a
 * fullscreen canvas, and live-reloads it via SSE every time `ezslPath`
 * changes on disk — "hot shader swapping" in the roadmap's own wording,
 * implemented as `swapProgram()`-ing a newly compiled program into the
 * *same* WebGL2 context (see `src/runtime/bootstrap.ts`) rather than
 * reloading the page, which is what actually avoids the full-reload flash
 * and preserves GPU/canvas state across edits. See
 * docs/architecture/dev-server.md for the full design (why SSE over
 * WebSocket, why a bundled page instead of a Vite plugin, what a failed
 * compile does to the already-running canvas).
 */
export async function runDev(ezslPath: string, options: CliOptions & { port?: number } = {}): Promise<DevServerHandle> {
  const port = options.port ?? 4321;
  const fileName = ezslPath.split(/[\\/]/).pop() ?? ezslPath;

  const sseClients = new Set<ServerResponse>();
  let latestMessage: DevServerMessage | null = null;

  const server = createServer(createRequestListener(fileName, sseClients, () => latestMessage, ezslPath));

  async function recompileAndBroadcast(): Promise<void> {
    const source = await readFile(ezslPath, "utf-8");
    const message = await compileToMessage(source, ezslPath, options);
    latestMessage = message;
    for (const client of sseClients) sseWrite(client, message);
    if (message.ok) {
      process.stdout.write(`[ezsl dev] recompiled ${relative(process.cwd(), ezslPath)}\n`);
    } else {
      process.stderr.write(`${message.errorText}\n`);
    }
  }

  // "127.0.0.1" explicitly — a real bug found during the v1.0.x security
  // review: `server.listen(port, callback)` with no host argument binds
  // to `::` (all network interfaces), not localhost-only, contrary to
  // this file's own prior claim that it was "bound to localhost." A dev
  // server with an unauthenticated path-traversal-vulnerable static route
  // (see resolveWithinRoot's doc comment) being reachable from anywhere
  // on the local network, not just the developer's own machine, was a
  // real, confirmed-live security gap — see docs/architecture/security-review.md.
  await new Promise<void>((res) => server.listen(port, "127.0.0.1", res));
  // `server.listen(0, ...)` (used by tests to get an OS-assigned free port)
  // means `port` above is still 0 after listen resolves — the real bound
  // port is only available via server.address() once listening.
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  await recompileAndBroadcast();
  process.stdout.write(`[ezsl dev] serving ${relative(process.cwd(), ezslPath)} at http://localhost:${actualPort}\n`);

  const watcher = fsWatch(ezslPath);
  const watchLoop = (async () => {
    for await (const event of watcher) {
      if (event.eventType === "change") await recompileAndBroadcast();
    }
  })();
  watchLoop.catch(() => {
    // The watcher is torn down (AbortError) by close() below; nothing to report.
  });

  return {
    port: actualPort,
    async close() {
      for (const client of sseClients) client.end();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
