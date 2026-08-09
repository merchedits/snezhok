#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exactRevision = /^[0-9a-f]{40}$/;
const verifierBootstrapFiles = new Set([
  "platform/package.json",
  "platform/scripts/android/verify-mobile-only-revision.mjs",
  "platform/scripts/android/verify-mobile-only-revision.test.mjs",
]);

export function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("usage: verify-mobile-only-revision.mjs --base SHA --revision SHA");
    result[key.slice(2)] = value;
  }
  return result;
}

export function isMobileOnlyPath(file) {
  return file.startsWith("platform/apps/mobile/")
    || file.startsWith("platform/docs/")
    || file === "platform/package-lock.json"
    || verifierBootstrapFiles.has(file);
}

export function lockfileDiffIsMobileVersionOnly(beforeText, afterText) {
  const before = JSON.parse(beforeText);
  const after = JSON.parse(afterText);
  if (before.packages?.["apps/mobile"]) delete before.packages["apps/mobile"].version;
  if (after.packages?.["apps/mobile"]) delete after.packages["apps/mobile"].version;
  return JSON.stringify(before) === JSON.stringify(after);
}

export function packageManifestDiffIsVerifierOnly(beforeText, afterText) {
  const before = JSON.parse(beforeText);
  const after = JSON.parse(afterText);
  if (before.scripts) delete before.scripts["release:verify-mobile-only"];
  if (after.scripts) delete after.scripts["release:verify-mobile-only"];
  return JSON.stringify(before) === JSON.stringify(after);
}

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: platformRoot, encoding: "utf8", ...options });
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const base = args.base;
  const revision = args.revision;
  if (!exactRevision.test(base ?? "") || !exactRevision.test(revision ?? "")) throw new Error("base and revision must be exact 40-character lowercase Git commits");
  git(["cat-file", "-e", `${base}^{commit}`]);
  git(["cat-file", "-e", `${revision}^{commit}`]);
  try {
    git(["merge-base", "--is-ancestor", base, revision]);
  } catch {
    throw new Error("base must be an ancestor of the Android release revision");
  }
  const output = git(["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", `${base}..${revision}`, "--", "."], { encoding: "buffer" });
  const files = output.toString("utf8").split("\0").filter(Boolean);
  if (!files.some((file) => file.startsWith("platform/apps/mobile/"))) throw new Error("revision contains no Android client changes");
  const forbidden = files.filter((file) => !isMobileOnlyPath(file));
  if (forbidden.length) throw new Error(`full coordinated deployment required; non-mobile paths changed:\n- ${forbidden.join("\n- ")}`);
  if (files.includes("platform/package-lock.json")) {
    const before = git(["show", `${base}:platform/package-lock.json`]);
    const after = git(["show", `${revision}:platform/package-lock.json`]);
    if (!lockfileDiffIsMobileVersionOnly(before, after)) throw new Error("full coordinated deployment required; package-lock changes exceed the mobile version field");
  }
  if (files.includes("platform/package.json")) {
    const before = git(["show", `${base}:platform/package.json`]);
    const after = git(["show", `${revision}:platform/package.json`]);
    if (!packageManifestDiffIsVerifierOnly(before, after)) throw new Error("full coordinated deployment required; root package changes exceed the mobile-only verifier entrypoint");
  }
  process.stdout.write(`verified mobile-only release ${revision} against running server ${base}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
