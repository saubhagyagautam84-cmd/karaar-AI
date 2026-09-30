// Runs the backend (pytest) and frontend (node:test) suites. Extra args go to pytest.
import { spawnSync } from "node:child_process";
import { backendDir, frontendDir, requireVenv, venvPython } from "./paths.mjs";

requireVenv();
const py = spawnSync(venvPython, ["-m", "pytest", "-q", ...process.argv.slice(2)], { cwd: backendDir, stdio: "inherit" });
const fe = spawnSync(
  process.execPath,
  ["--import", "./tests/register.mjs", "--test", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "tests/*.test.ts"],
  { cwd: frontendDir, stdio: "inherit" },
);
process.exit(py.status || fe.status || 0);
