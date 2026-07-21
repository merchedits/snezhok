#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { isSpdxLicenseId, parseSpdxExpression } from "./spdx-expression.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(scriptDirectory, "../..");

export function parseArguments(values) {
  const result = { omitDev: false, check: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--omit-dev") result.omitDev = true;
    else if (value === "--check") result.check = true;
    else if (["--lockfile", "--overrides", "--output-directory", "--revision"].includes(value)) {
      const next = values[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`missing value for ${value}`);
      result[value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next;
      index += 1;
    } else throw new Error(`unexpected argument: ${value}`);
  }
  return result;
}

function packageNameFromPath(packagePath) {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  return index < 0 ? null : packagePath.slice(index + marker.length);
}

function normalizeLicense(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function purl(name, version) {
  const encodedName = name.startsWith("@")
    ? `%40${encodeURIComponent(name.slice(1).split("/")[0])}/${encodeURIComponent(name.split("/")[1])}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function integrityHash(integrity) {
  if (typeof integrity !== "string") return undefined;
  const [algorithm, content] = integrity.split("-", 2);
  if (!content || !["sha256", "sha384", "sha512"].includes(algorithm)) return undefined;
  return { alg: algorithm.toUpperCase().replace("SHA", "SHA-"), content: Buffer.from(content, "base64").toString("hex") };
}

export function buildArtifacts(lockfile, overrides = {}, options = {}) {
  if (lockfile?.lockfileVersion !== 3 || !lockfile.packages || typeof lockfile.packages !== "object") {
    throw new Error("package-lock.json must use npm lockfileVersion 3");
  }

  const byCoordinate = new Map();
  const failures = [];
  for (const [packagePath, entry] of Object.entries(lockfile.packages)) {
    if (!packagePath.includes("node_modules/") || entry?.link) continue;
    if (options.omitDev && entry.dev === true) continue;
    const name = packageNameFromPath(packagePath);
    const version = entry.version;
    if (!name || typeof version !== "string") continue;
    const coordinate = `${name}@${version}`;
    const override = overrides[coordinate];
    const license = normalizeLicense(override?.license) ?? normalizeLicense(entry.license);
    const current = byCoordinate.get(coordinate);
    const development = entry.dev === true;
    if (!current) {
      byCoordinate.set(coordinate, {
        name,
        version,
        license,
        development,
        integrity: entry.integrity,
        override: override ?? undefined,
      });
    } else if (!development) {
      current.development = false;
    }
    if (current && license && !current.license) current.license = license;
    if (current && license && current.license && license !== current.license) failures.push(`${coordinate}: conflicting license metadata '${current.license}' and '${license}'`);
  }

  const packages = [...byCoordinate.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version, undefined, { numeric: true }),
  );
  for (const coordinate of Object.keys(overrides)) {
    if (!byCoordinate.has(coordinate)) failures.push(`${coordinate}: license override does not match a locked dependency`);
  }
  for (const dependency of packages) {
    const coordinate = `${dependency.name}@${dependency.version}`;
    if (!dependency.license) failures.push(`${coordinate}: license metadata is missing`);
    else if (/^(?:UNLICENSED|PROPRIETARY|COMMERCIAL|SEE LICENSE)/i.test(dependency.license)) {
      failures.push(`${coordinate}: non-redistributable or unverifiable license '${dependency.license}'`);
    } else {
      try {
        parseSpdxExpression(dependency.license);
      } catch (error) {
        failures.push(`${coordinate}: invalid SPDX expression '${dependency.license}' (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    if (dependency.override) {
      if (typeof dependency.override.source !== "string" || !/^https:\/\//.test(dependency.override.source)) failures.push(`${coordinate}: license override needs an HTTPS evidence URL`);
      if (typeof dependency.override.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dependency.override.reviewedAt)) failures.push(`${coordinate}: license override needs reviewedAt YYYY-MM-DD`);
      if (typeof dependency.override.reason !== "string" || dependency.override.reason.trim().length < 10) failures.push(`${coordinate}: license override needs a review reason`);
    }
  }

  const inventory = {
    schemaVersion: 1,
    generatedFrom: "package-lock.json",
    lockfileVersion: lockfile.lockfileVersion,
    productionOnly: Boolean(options.omitDev),
    packages: packages.map(({ name, version, license, development, integrity, override }) => ({
      name,
      version,
      license,
      development,
      integrity: integrity ?? null,
      licenseMetadataSource: override ? "reviewed-override" : "package-lock",
      ...(override ? { licenseEvidence: { source: override.source, reviewedAt: override.reviewedAt, reason: override.reason } } : {}),
    })),
  };

  const rootName = lockfile.name ?? "snezhok-platform";
  const rootVersion = lockfile.version ?? "0.0.0";
  const revision = options.revision ?? "unknown";
  const components = packages.map((dependency) => {
    const ref = purl(dependency.name, dependency.version);
    const hash = integrityHash(dependency.integrity);
    const license = dependency.license && isSpdxLicenseId(dependency.license)
      ? { license: { id: dependency.license } }
      : { expression: dependency.license ?? "NOASSERTION" };
    return {
      type: "library",
      "bom-ref": ref,
      name: dependency.name,
      version: dependency.version,
      purl: ref,
      scope: dependency.development ? "optional" : "required",
      licenses: [license],
      ...(hash ? { hashes: [hash] } : {}),
    };
  });
  const digest = createHash("sha256").update(`${rootName}\0${rootVersion}\0${revision}\0${components.map((item) => item["bom-ref"]).join("\0")}`).digest("hex");
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((parseInt(digest[16], 16) & 3) | 8).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
    version: 1,
    metadata: {
      tools: { components: [{ type: "application", name: "Snezhok supply-chain generator", version: "1" }] },
      component: {
        type: "application",
        "bom-ref": `pkg:npm/${rootName}@${rootVersion}`,
        name: rootName,
        version: rootVersion,
        licenses: [{ license: { id: "GPL-3.0-or-later" } }],
        properties: [{ name: "snezhok:source-revision", value: revision }],
      },
      properties: [{ name: "snezhok:production-only", value: String(Boolean(options.omitDev)) }],
    },
    components,
  };
  return { inventory, sbom, failures };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const lockfilePath = path.resolve(args.lockfile ?? path.join(platformRoot, "package-lock.json"));
  const overridesPath = path.resolve(args.overrides ?? path.join(platformRoot, "compliance/license-overrides.json"));
  const outputDirectory = path.resolve(args.outputDirectory ?? path.join(platformRoot, "build/compliance"));
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
  const overrides = JSON.parse(await readFile(overridesPath, "utf8"));
  const artifacts = buildArtifacts(lockfile, overrides, { omitDev: args.omitDev, revision: args.revision });
  if (artifacts.failures.length) throw new Error(`dependency license check failed:\n- ${artifacts.failures.join("\n- ")}`);
  if (!args.check) {
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(outputDirectory, "dependency-licenses.json"), `${JSON.stringify(artifacts.inventory, null, 2)}\n`, { mode: 0o644 }),
      writeFile(path.join(outputDirectory, "snezhok.cdx.json"), `${JSON.stringify(artifacts.sbom, null, 2)}\n`, { mode: 0o644 }),
    ]);
  }
  process.stdout.write(`verified ${artifacts.inventory.packages.length} dependency licenses${args.omitDev ? " (production only)" : ""}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
