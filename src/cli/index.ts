#!/usr/bin/env node
import { runBuild, runCheck, runWatch } from "./commands.js";
import { runDev } from "./devServer.js";

const USAGE = `Usage: ezsl <command> <file.ezsl> [options]

Commands:
  build <file.ezsl>   Compile a file and write <name>.glsl next to it
  check <file.ezsl>   Compile a file and report success/failure (no output file)
  watch <file.ezsl>   Re-run build every time the file changes, until interrupted
  dev <file.ezsl>     Serve the file in a browser with live-reload hot shader
                       swapping (no full page reload) on every change

Options:
  --vertex             Compile as a vertex-stage program (v0.6 Three.js authoring)
                        instead of the default fragment stage
  --port <n>            Port for 'dev' to listen on (default: 4321)
  -h, --help            Show this help text
`;

function parseArgs(argv: string[]): {
  command: string | undefined;
  file: string | undefined;
  vertex: boolean;
  port: number | undefined;
  help: boolean;
} {
  let command: string | undefined;
  let file: string | undefined;
  let vertex = false;
  let port: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--vertex") {
      vertex = true;
    } else if (arg === "--port") {
      port = Number(argv[++i]);
    } else if (command === undefined) {
      command = arg;
    } else if (file === undefined) {
      file = arg;
    }
  }

  return { command, file, vertex, port, help };
}

async function main(): Promise<void> {
  const { command, file, vertex, port, help } = parseArgs(process.argv.slice(2));

  if (help || command === undefined) {
    process.stdout.write(USAGE);
    process.exitCode = help ? 0 : 1;
    return;
  }

  if (file === undefined) {
    process.stderr.write(`ezsl ${command}: missing <file.ezsl> argument\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "build":
      process.exitCode = await runBuild(file, { vertex });
      return;
    case "check":
      process.exitCode = await runCheck(file, { vertex });
      return;
    case "watch":
      await runWatch(file, { vertex });
      return;
    case "dev":
      await runDev(file, { vertex, port });
      // Intentionally never resolves on its own — the dev server runs until
      // the process is interrupted (Ctrl+C), same lifecycle as `watch`.
      await new Promise<void>(() => {});
      return;
    default:
      process.stderr.write(`ezsl: unknown command '${command}'\n\n${USAGE}`);
      process.exitCode = 1;
      return;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`ezsl: unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
