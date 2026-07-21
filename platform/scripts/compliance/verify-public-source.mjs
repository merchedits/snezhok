#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const DEFAULT_REPOSITORY = "https://github.com/merchedits/snezhok";

export function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!["--manifest", "--revision", "--repository"].includes(key)) throw new Error(`unexpected argument: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

export function githubCommitApiUrl(repository, revision) {
  const parsed = new URL(repository);
  const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(parsed.pathname);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || !match) throw new Error("source repository must be a public https://github.com/OWNER/REPOSITORY URL");
  if (!/^[0-9a-f]{7,40}$/i.test(revision)) throw new Error("source revision must be a 7-40 character Git commit ID");
  return `https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/commits/${revision}`;
}

export async function verifyPublicRevision({ repository, revision, fetchImplementation = fetch }) {
  const url = githubCommitApiUrl(repository, revision);
  const response = await fetchImplementation(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "snezhok-release-source-verifier/1",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`source revision is not publicly reachable (GitHub returned ${response.status})`);
  const body = await response.json();
  if (typeof body?.sha !== "string" || !body.sha.toLowerCase().startsWith(revision.toLowerCase())) {
    throw new Error("public source response does not match the requested revision");
  }
  if (body.sha.length !== 40) throw new Error("public source response did not contain a complete Git commit ID");
  return body.sha.toLowerCase();
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  let revision = args.revision;
  if (args.manifest) {
    const manifest = JSON.parse(await readFile(path.resolve(args.manifest), "utf8"));
    if (revision && revision.toLowerCase() !== String(manifest.sourceRevision).toLowerCase()) throw new Error("--revision differs from manifest sourceRevision");
    revision = manifest.sourceRevision;
  }
  if (!revision) throw new Error("usage: verify-public-source.mjs --manifest FILE [--repository URL], or --revision SHA");
  const repository = args.repository ?? DEFAULT_REPOSITORY;
  const completeRevision = await verifyPublicRevision({ repository, revision });
  process.stdout.write(`verified public GPL corresponding source ${repository}/commit/${completeRevision}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
