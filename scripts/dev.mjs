// Runs the FastAPI backend (:8000) and Next.js frontend (:3000) together.
import { spawn } from "node:child_process";
import { backendDir, frontendDir, isWin, requireVenv, venvPython } from "./paths.mjs";

requireVenv();

const procs = [
  {
    name: "api",
    color: "\x1b[32m",
    cmd: venvPython,
    // --reload is opt-in (KARAAR_RELOAD=1): on Windows its StatReload can leave the old
    // worker serving stale code, which is the last thing a live demo needs.
    args: [
      "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000",
      // Outlive the Next proxy's pooled connections, or a reused socket gets ECONNRESET.
      "--timeout-keep-alive", "75",
      ...(process.env.KARAAR_RELOAD === "1" ? ["--reload"] : []),
    ],
    cwd: backendDir,
  },
  { name: "web", color: "\x1b[33m", cmd: "npm", args: ["run", "dev"], cwd: frontendDir },
];

const children = procs.map(({ name, color, cmd, args, cwd }) => {
  const viaShell = isWin && cmd === "npm";
  const child = viaShell
    ? spawn([cmd, ...args].join(" "), { cwd, shell: true, env: process.env })
    : spawn(cmd, args, { cwd, env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on("data", (buf) =>
      buf.toString().split(/\r?\n/).filter(Boolean).forEach((line) => out.write(prefix + line + "\n")),
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}exited (${code})`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // npm on Windows runs through cmd.exe; kill the whole tree.
    if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGINT");
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
console.log("Karaar AI: web http://localhost:3000   api http://localhost:8000/docs");
