import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultPlatformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultSourceRoots = ["apps/mobile/src", "apps/api/src", "apps/media-worker/src", "packages/contracts/src"];
const MAX_FILE_LINES = 500;
const defaultExceptions = new Map([
  // Dormant compatibility surface. This ceiling may only move down.
  ["apps/api/src/modules/servers/routes.ts", 692],
]);

export async function inspectArchitecture({
  platformRoot = defaultPlatformRoot,
  sourceRoots = defaultSourceRoots,
  exceptions = defaultExceptions,
} = {}) {
  const failures = [];
  const files = (await Promise.all(sourceRoots.map((root) => walk(path.join(platformRoot, root))))).flat();
  for (const absolute of files) {
    if (!/\.(?:ts|tsx)$/.test(absolute)) continue;
    const relative = portable(path.relative(platformRoot, absolute));
    const source = await readFile(absolute, "utf8");
    const lineCount = source.split(/\r?\n/).length;
    const localizedCopy = relative === "apps/mobile/src/i18n.ts";
    const ceiling = exceptions.get(relative) ?? (localizedCopy ? Number.POSITIVE_INFINITY : MAX_FILE_LINES);
    if (lineCount > ceiling) failures.push(`${relative}: ${lineCount} lines exceeds ${ceiling}`);

    const imports = extractImports(source);
    if (relative.startsWith("apps/mobile/src/domains/")) {
      for (const specifier of imports) {
        if (frameworkImport(specifier) || targetsMobileLayer(absolute, specifier, ["application", "infrastructure", "components", "screens", "hooks", "store", "transfers", "repositories"])) {
          failures.push(`${relative}: domain imports an outer layer (${specifier})`);
        }
      }
    }

    if (relative.startsWith("apps/mobile/src/application/")) {
      for (const specifier of imports) {
        if (frameworkImport(specifier) || targetsMobileLayer(absolute, specifier, ["components", "screens", "hooks"])) {
          failures.push(`${relative}: application use case imports presentation code (${specifier})`);
        }
      }
    }

    if (relative.startsWith("apps/mobile/src/infrastructure/")) {
      for (const specifier of imports) {
        if (targetsMobileLayer(absolute, specifier, ["application", "components", "screens", "hooks"])) {
          failures.push(`${relative}: infrastructure imports an inward consumer (${specifier})`);
        }
      }
    }

    if (/apps\/mobile\/src\/(?:screens|components)\//.test(relative)) {
      if (/\bfetch\s*\(/.test(source)) failures.push(`${relative}: UI calls fetch directly`);
      for (const specifier of imports) {
        if (targetsMobileLayer(absolute, specifier, ["infrastructure"])) {
          failures.push(`${relative}: UI imports infrastructure directly (${specifier})`);
        }
      }
      if (/from\s+["'](?:expo-sqlite|expo-secure-store|socket\.io-client|\.\.\/\.\.\/modules\/snezhok-background-transfer)/.test(source)) {
        failures.push(`${relative}: UI imports persistence/realtime/background-transfer infrastructure directly`);
      }
    }
  }

  const storePath = path.join(platformRoot, "apps/mobile/src/store/appState.ts");
  if (files.includes(storePath)) {
    const storeSource = await readFile(storePath, "utf8");
    if (/\buploadProgress\s*[?:]/.test(storeSource)) failures.push("apps/mobile/src/store/appState.ts: global upload progress is prohibited");
  }
  return { failures, checkedFiles: files.length };
}

export async function verifyArchitecture(options) {
  const result = await inspectArchitecture(options);
  if (result.failures.length) throw new Error("Architecture verification failed:\n" + result.failures.map((failure) => `- ${failure}`).join("\n"));
  return result;
}

function extractImports(source) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) imports.push(match[1] ?? match[2]);
  return imports.filter(Boolean);
}

function frameworkImport(specifier) {
  return /^(?:react(?:-native)?(?:\/|$)|expo(?:-|\/|$)|fastify(?:\/|$)|pg(?:\/|$)|@livekit\/)/.test(specifier);
}

function targetsMobileLayer(importer, specifier, layers) {
  if (!specifier.startsWith(".")) return false;
  const resolved = portable(path.resolve(path.dirname(importer), specifier));
  return layers.some((layer) => resolved.includes(`/apps/mobile/src/${layer}/`));
}

function portable(value) {
  return value.replaceAll(path.sep, "/");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  });
  return (await Promise.all(entries.map((entry) => {
    const child = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  }))).flat();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await verifyArchitecture();
    console.log(`Architecture verification passed (${result.checkedFiles} source files checked).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
