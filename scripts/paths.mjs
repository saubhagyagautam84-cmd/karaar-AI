import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const backendDir = join(root, "backend");
export const frontendDir = join(root, "frontend");
export const isWin = process.platform === "win32";
export const venvPython = join(backendDir, ".venv", isWin ? "Scripts/python.exe" : "bin/python");

export function requireVenv() {
  if (!existsSync(venvPython)) {
    console.error("Backend not set up yet. Run: npm run setup");
    process.exit(1);
  }
}
