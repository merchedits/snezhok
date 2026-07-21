#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(["", ".cjs", ".conf", ".css", ".env", ".example", ".gradle", ".html", ".java", ".js", ".json", ".kt", ".kts", ".md", ".mjs", ".properties", ".py", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"]);

const rules = [
  { id: "private-key", expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { id: "aws-access-key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "github-token", expression: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{40,255})\b/g },
  { id: "slack-token", expression: /\bxox[baprs]-[A-Za-z0-9-]{20,250}\b/g },
  { id: "google-api-key", expression: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "stripe-live-key", expression: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,128}\b/g },
  { id: "authenticated-url", expression: /\b[a-z][a-z0-9+.-]{2,20}:\/\/[^\s:/@]+:[^\s/@]{8,}@/gi },
];

export function scanText(content) {
  const findings = [];
  for (const rule of rules) {
    rule.expression.lastIndex = 0;
    for (const match of content.matchAll(rule.expression)) {
      const value = match[0];
      if (value.includes("${") || /(?:example|placeholder|not-a-production-secret|ci-only|change-me|replace-me|opaque-password|user:password)/i.test(value)) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({ rule: rule.id, line });
    }
  }
  return findings;
}

export function trackedFiles(root = repositoryRoot) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "platform", ".github/workflows/platform-ci.yml", ".github/dependabot.yml"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("git ls-files failed while enumerating the scan scope");
  return result.stdout.split("\0").filter(Boolean);
}

async function main() {
  const failures = [];
  for (const relativeFile of trackedFiles()) {
    const extension = path.extname(relativeFile).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const file = path.join(repositoryRoot, relativeFile);
    const content = await readFile(file);
    if (content.byteLength > MAX_TEXT_BYTES || content.includes(0)) continue;
    for (const finding of scanText(content.toString("utf8"))) failures.push({ file: relativeFile.replaceAll("\\", "/"), ...finding });
  }
  if (failures.length) {
    const summary = failures.map(({ file, line, rule }) => `${file}:${line} [${rule}]`).join("\n");
    throw new Error(`potential committed secrets detected; matched values are intentionally redacted:\n${summary}`);
  }
  process.stdout.write("high-confidence committed-secret scan passed\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
