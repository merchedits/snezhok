import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("static web shell serves SPA routes without swallowing API or missing assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "snezhok-web-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), "<!doctype html><title>Snezhok</title>");
  await writeFile(path.join(root, "assets", "app.js"), "console.log('ok')");
  process.env.WEB_DIST_PATH = root;
  const { buildApp } = await import("./app.js");
  const app = await buildApp();
  try {
    assert.equal((await app.inject({ url: "/" })).statusCode, 200);
    assert.equal((await app.inject({ url: "/settings/profile" })).statusCode, 200);
    assert.equal((await app.inject({ url: "/assets/app.js" })).statusCode, 200);
    assert.equal((await app.inject({ url: "/assets/missing.js" })).statusCode, 404);
    assert.equal((await app.inject({ url: "/api/v1/missing" })).statusCode, 404);
  } finally {
    await app.close(); await rm(root, { recursive: true, force: true });
  }
});
