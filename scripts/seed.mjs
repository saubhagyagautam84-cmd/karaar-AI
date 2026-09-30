// Seeds 500 synthetic agreements for the governance dashboard (pass --clear to remove them).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { requireVenv, root, venvPython } from "./paths.mjs";

requireVenv();
const res = spawnSync(venvPython, [join(root, "seed", "generate_seed.py"), ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
process.exit(res.status ?? 1);
