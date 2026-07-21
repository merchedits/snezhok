#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseSpdxExpression } from "./spdx-expression.mjs";

export function validateAndroidEvidence(inventory, cdx, notices, packagedFiles, expectedRevision) {
  const failures = [];
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return ["Android dependency inventory must be an object"];
  if (inventory.schemaVersion !== 1) failures.push("Android dependency inventory schemaVersion is unsupported");
  if (inventory.configuration !== "releaseRuntimeClasspath") failures.push("Android dependency inventory is not for releaseRuntimeClasspath");
  if (expectedRevision && inventory.sourceRevision !== expectedRevision) failures.push(`Android dependency inventory sourceRevision is ${inventory.sourceRevision}, expected ${expectedRevision}`);
  if (!Array.isArray(inventory.components) || inventory.components.length < 1) failures.push("Android dependency inventory has no components");
  const components = Array.isArray(inventory.components) ? inventory.components : [];
  if (inventory.componentCount !== components.length) failures.push("Android dependency componentCount does not match its components");
  if (inventory.unresolvedLicenseCount !== 0) failures.push("Android dependency inventory has unresolved licenses");
  const coordinates = new Set();
  const purls = new Set(components.map((component) => component?.purl).filter((value) => typeof value === "string"));
  const legalTextHashes = new Set();
  for (const component of components) {
    if (typeof component?.coordinate !== "string" || !/^[^:]+:[^:]+:[^:]+$/.test(component.coordinate)) failures.push("Android dependency has an invalid Maven coordinate");
    else if (coordinates.has(component.coordinate)) failures.push(`duplicate Android dependency coordinate ${component.coordinate}`);
    else coordinates.add(component.coordinate);
    if (typeof component?.purl !== "string" || !component.purl.startsWith("pkg:maven/")) failures.push(`${component?.coordinate ?? "dependency"}: Maven purl is invalid`);
    try {
      parseSpdxExpression(component?.license);
    } catch (error) {
      failures.push(`${component?.coordinate ?? "dependency"}: invalid SPDX expression (${error instanceof Error ? error.message : String(error)})`);
    }
    if (component?.licenseMetadataSource === "reviewed-override") {
      const evidence = component.licenseEvidence;
      if (!evidence || typeof evidence.source !== "string" || !/^https:\/\//.test(evidence.source) ||
          typeof evidence.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.reviewedAt) ||
          typeof evidence.reason !== "string" || evidence.reason.trim().length < 10) {
        failures.push(`${component.coordinate}: reviewed Android license override lacks evidence`);
      }
    }
    if (!Array.isArray(component?.artifacts) || component.artifacts.length < 1) failures.push(`${component?.coordinate ?? "dependency"}: no resolved artifact evidence`);
    for (const artifact of component?.artifacts ?? []) {
      if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "")) failures.push(`${component.coordinate}: invalid resolved artifact hash evidence`);
    }
    for (const legalText of component?.embeddedLegalTexts ?? []) {
      if (!/^[0-9a-f]{64}$/.test(legalText?.sha256 ?? "")) failures.push(`${component.coordinate}: invalid embedded legal-text hash`);
      else {
        legalTextHashes.add(legalText.sha256);
        const textPath = `texts/${legalText.sha256}.txt`;
        if (!packagedFiles.has(textPath)) failures.push(`${component.coordinate}: referenced legal text ${legalText.sha256} is not packaged`);
        else if (packagedFiles instanceof Map) {
          const normalized = String(packagedFiles.get(textPath)).replaceAll("\r\n", "\n").trim();
          const actualHash = createHash("sha256").update(normalized, "utf8").digest("hex");
          if (actualHash !== legalText.sha256) failures.push(`${component.coordinate}: packaged legal text ${legalText.sha256} does not match its digest`);
        }
      }
    }
    if (!Array.isArray(component?.dependsOn)) failures.push(`${component?.coordinate ?? "dependency"}: dependency edges are missing`);
    else for (const target of component.dependsOn) if (!purls.has(target)) failures.push(`${component.coordinate}: dependency edge points outside the resolved component set (${target})`);
    if (typeof notices !== "string" || !notices.includes(component.coordinate)) failures.push(`${component.coordinate}: component is absent from generated notices`);
  }
  if (inventory.legalTextCount !== legalTextHashes.size) failures.push("Android legalTextCount does not match referenced legal texts");
  if (cdx?.bomFormat !== "CycloneDX" || cdx?.specVersion !== "1.6" || !Array.isArray(cdx?.components)) failures.push("Android CycloneDX document is invalid");
  else {
    const cdxPurls = new Set(cdx.components.map((component) => component.purl));
    for (const component of components) if (!cdxPurls.has(component.purl)) failures.push(`${component.coordinate}: component is absent from Android CycloneDX document`);
    if (cdx.components.length !== components.length) failures.push("Android CycloneDX component count does not match the inventory");
    const cdxEdges = new Map((Array.isArray(cdx.dependencies) ? cdx.dependencies : []).map((edge) => [edge.ref, edge.dependsOn]));
    for (const component of components) {
      if (!cdxEdges.has(component.purl)) failures.push(`${component.coordinate}: dependency edges are absent from Android CycloneDX document`);
      else if (JSON.stringify(cdxEdges.get(component.purl)) !== JSON.stringify(component.dependsOn)) failures.push(`${component.coordinate}: CycloneDX dependency edges do not match the inventory`);
    }
  }
  return failures;
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`invalid argument near ${key ?? "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.directory) throw new Error("usage: validate-android-evidence.mjs --directory DIRECTORY [--revision COMMIT]");
  const directory = path.resolve(args.directory);
  const [inventory, cdx, notices, textNames] = await Promise.all([
    readFile(path.join(directory, "android-dependencies.json"), "utf8").then(JSON.parse),
    readFile(path.join(directory, "snezhok-android.cdx.json"), "utf8").then(JSON.parse),
    readFile(path.join(directory, "ANDROID_THIRD_PARTY_NOTICES.txt"), "utf8"),
    readdir(path.join(directory, "texts")).catch(() => []),
  ]);
  const packagedFiles = new Map(await Promise.all(textNames.map(async (name) => {
    const relative = `texts/${name}`;
    return [relative, await readFile(path.join(directory, relative), "utf8")];
  })));
  const failures = validateAndroidEvidence(inventory, cdx, notices, packagedFiles, args.revision);
  if (failures.length) throw new Error(`Android dependency evidence verification failed:\n- ${failures.join("\n- ")}`);
  process.stdout.write(`verified ${inventory.componentCount} resolved Android runtime dependencies and ${inventory.legalTextCount} legal texts\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
