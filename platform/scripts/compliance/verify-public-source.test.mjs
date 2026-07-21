import assert from "node:assert/strict";
import test from "node:test";
import { githubCommitApiUrl, parseArguments, verifyPublicRevision } from "./verify-public-source.mjs";

test("constructs a GitHub commit API URL without accepting alternate hosts", () => {
  assert.equal(
    githubCommitApiUrl("https://github.com/merchedits/snezhok", "abcdef0"),
    "https://api.github.com/repos/merchedits/snezhok/commits/abcdef0",
  );
  assert.throws(() => githubCommitApiUrl("https://example.com/merchedits/snezhok", "abcdef0"), /public/);
});

test("verifies the response is the requested complete revision", async () => {
  const fullRevision = `abcdef0${"1".repeat(33)}`;
  const result = await verifyPublicRevision({
    repository: "https://github.com/merchedits/snezhok",
    revision: "abcdef0",
    fetchImplementation: async () => ({ ok: true, json: async () => ({ sha: fullRevision }) }),
  });
  assert.equal(result, fullRevision);
});

test("fails closed for missing commits and mismatched responses", async () => {
  await assert.rejects(
    verifyPublicRevision({ repository: "https://github.com/merchedits/snezhok", revision: "abcdef0", fetchImplementation: async () => ({ ok: false, status: 404 }) }),
    /not publicly reachable/,
  );
  await assert.rejects(
    verifyPublicRevision({ repository: "https://github.com/merchedits/snezhok", revision: "abcdef0", fetchImplementation: async () => ({ ok: true, json: async () => ({ sha: "1234567890123456789012345678901234567890" }) }) }),
    /does not match/,
  );
});

test("parses one manifest or revision source", () => {
  assert.deepEqual(parseArguments(["--manifest", "release.json", "--repository", "https://github.com/a/b"]), {
    manifest: "release.json",
    repository: "https://github.com/a/b",
  });
});
