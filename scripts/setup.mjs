// One-time setup: Python 3.11 venv + backend deps, frontend npm install.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { backendDir, frontendDir, isWin, venvPython } from "./paths.mjs";

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  // Executables run directly; npm/py need a shell on Windows, so they get one command string.
  const direct = !isWin || cmd.endsWith(".exe");
  const res = direct
    ? spawnSync(cmd, args, { cwd, stdio: "inherit" })
    : spawnSync([cmd, ...args].join(" "), { cwd, stdio: "inherit", shell: true });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!existsSync(venvPython)) {
  // Prefer the Windows launcher's 3.11; fall back to python3.11 / python.
  const candidates = isWin ? [["py", ["-3.11"]], ["python", []]] : [["python3.11", []], ["python3", []]];
  const found = candidates.find(([cmd, pre]) =>
    spawnSync([cmd, ...pre, "--version"].join(" "), { shell: true }).status === 0,
  );
  if (!found) {
    console.error("Python 3.11 not found. Install it from python.org, then rerun npm run setup.");
    process.exit(1);
  }
  run(found[0], [...found[1], "-m", "venv", ".venv"], backendDir);
}

run(venvPython, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], backendDir);
run("npm", ["install"], frontendDir);

// Live mode: the frontend talks to the FastAPI backend through its /backend proxy.
const envLocal = join(frontendDir, ".env.local");
if (!existsSync(envLocal)) {
  copyFileSync(join(frontendDir, ".env.example"), envLocal);
  console.log("\nCreated frontend/.env.local (live mode: NEXT_PUBLIC_API_URL=/backend).");
}
console.log("\nSetup done. Start everything with: npm run dev");
