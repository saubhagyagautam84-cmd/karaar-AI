// Lets node:test import the app's TypeScript: resolves "@/..." and extensionless relative imports to .ts/.tsx.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

function candidate(base) {
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    if (existsSync(base + ext) && (ext || /\.[cm]?[jt]sx?$/.test(base))) return base + ext;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) base = join(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  const hit = base && candidate(base);
  return hit ? next(pathToFileURL(hit).href, context) : next(specifier, context);
}
