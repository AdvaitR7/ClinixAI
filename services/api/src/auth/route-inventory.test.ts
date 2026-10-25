import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

/** Lists API route modules so a new unguarded module cannot be missed silently. */
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name.endsWith("routes.ts") ? [path] : [];
  });
}

describe("API route authentication inventory", () => {
  it("registers every domain route after the global auth hook", () => {
    const index = readFileSync(join(sourceRoot, "index.ts"), "utf8");
    const authRegistration = index.indexOf("await instance.register(authPlugin)");
    expect(authRegistration).toBeGreaterThanOrEqual(0);

    for (const path of routeFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8");
      const routeFunction = source.match(/export async function (\w+)/)?.[1];
      expect(routeFunction, `${path} exports a registered route module`).toBeTruthy();
      const routeRegistration = index.indexOf(`await instance.register(${routeFunction})`);
      expect(routeRegistration, `${routeFunction} is registered in the API`).toBeGreaterThan(authRegistration);

      const publicRoutes = source.match(/config:\s*publicRoute\(\)/g)?.length ?? 0;
      const verifiedSessions = source.match(/verifiedBearer\(request, reply\)/g)?.length ?? 0;
      expect(verifiedSessions, `${path} verifies every public auth route`).toBe(publicRoutes);
    }
  });
});
