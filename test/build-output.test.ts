/**
 * build-output.test.ts — the `tsc` build loads as plain JavaScript.
 *
 * Source files import each other by their `.ts` names so pi's jiti loader finds
 * them without probing (see `perf/extension-load.perf.test.ts`). Node cannot
 * resolve those names in emitted JavaScript, so the build relies on
 * `rewriteRelativeImportExtensions` to turn them back into `.js`. This compiles
 * with the repo's own tsconfig and imports the result in a plain Node process,
 * which fails on any relative specifier that does not name an emitted file.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

let outRoot: string | undefined;

afterEach(() => {
  if (outRoot) rmSync(outRoot, { recursive: true, force: true });
  outRoot = undefined;
});

describe("npm run build output", () => {
  it("loads in Node without a TypeScript loader", { timeout: 60_000 }, () => {
    outRoot = mkdtempSync(join(tmpdir(), "pi-subagents-build-"));
    const outDir = join(outRoot, "dist");
    execFileSync(process.execPath, [TSC, "-p", join(REPO_ROOT, "tsconfig.json"), "--outDir", outDir], {
      stdio: "pipe",
    });
    // Resolve the extension's dependencies from this checkout, and mark the
    // output as ESM, which is what tsc emits for `module: ES2022`.
    symlinkSync(join(REPO_ROOT, "node_modules"), join(outRoot, "node_modules"), "junction");
    writeFileSync(join(outRoot, "package.json"), '{ "type": "module" }\n');
    writeFileSync(join(outRoot, "probe.js"), 'import ext from "./dist/index.js";\nconsole.log(typeof ext);\n');

    const out = execFileSync(process.execPath, [join(outRoot, "probe.js")], { cwd: outRoot, encoding: "utf8" });

    expect(out.trim()).toBe("function");
  });
});
