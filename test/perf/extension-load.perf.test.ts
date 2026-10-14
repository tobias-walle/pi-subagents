/**
 * extension-load.perf.test.ts — how much filesystem probing pi's extension
 * loader does to import `src/index.ts`.
 *
 * pi loads this extension from TypeScript source through jiti. jiti resolves a
 * relative import literally first, so a `./foo.js` specifier that only exists
 * as `foo.ts` costs a stat for `foo.js`, `foo.js.js`, `foo.js.mjs`, ...,
 * `foo.js/index.ts` before the fallback finds the file, and it repeats that per
 * importing module. With `.js` specifiers this was ~18k failed `statSync` calls
 * and over a second of startup on slow filesystems. Source imports name the
 * `.ts` file instead, and `tsc` rewrites them to `.js` on build.
 *
 * Counted, not timed, for the reasons in `render-invariants.perf.test.ts`.
 */
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC_DIR = join(REPO_ROOT, "src") + sep;
const NODE_MODULES_IN_SRC = join(SRC_DIR, "node_modules") + sep;
const ENTRY = join(REPO_ROOT, "src", "index.ts");

let agentDir: string | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  if (agentDir) rmSync(agentDir, { recursive: true, force: true });
  agentDir = undefined;
});

/** A missing source-file candidate, not Node's `src/node_modules` lookup for bare packages. */
function isMissingSourceFile(path: string, exists: (path: string) => boolean): boolean {
  return path.startsWith(SRC_DIR) && !path.startsWith(NODE_MODULES_IN_SRC) && !exists(path);
}

/**
 * Source-file paths that the loader `statSync`s but that do not exist, with
 * how often each was probed. jiti reads `fs` through `require("node:fs")`, the
 * same object this spy patches.
 */
function spyMissingSourceProbes(): Map<string, number> {
  const probes = new Map<string, number>();
  const exists = fs.existsSync;
  const statSync = fs.statSync;
  vi.spyOn(fs, "statSync").mockImplementation(((path: fs.PathLike, options?: fs.StatSyncOptions) => {
    // jiti passes forward-slash paths, also on Windows: normalize before comparing.
    const p = resolve(String(path));
    if (isMissingSourceFile(p, exists)) probes.set(p, (probes.get(p) ?? 0) + 1);
    return statSync(path, options);
  }) as typeof fs.statSync);
  return probes;
}

describe("pi's extension loader imports src/index.ts", () => {
  it("loads the extension without probing missing source files", async () => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-load-"));
    const probes = spyMissingSourceProbes();

    // Temp cwd too, so this checkout's .pi/extensions cannot join discovery.
    const result = await discoverAndLoadExtensions([ENTRY], agentDir, agentDir);

    expect(result.errors).toEqual([]);
    expect(result.extensions.map((e) => e.path)).toEqual([ENTRY]);
    expect([...result.extensions[0].tools.keys()]).toContain("Agent");
    // Upper bound 0: every relative import names a file that exists. The
    // sample keeps a failure readable instead of dumping thousands of paths.
    const total = [...probes.values()].reduce((a, b) => a + b, 0);
    expect({ total, sample: [...probes.keys()].slice(0, 5) }).toEqual({ total: 0, sample: [] });
  });
});
