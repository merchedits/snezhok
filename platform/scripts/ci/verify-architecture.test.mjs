import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectArchitecture } from "./verify-architecture.mjs";

test("architecture gate rejects inverted mobile dependencies and direct UI transport", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "snezhok-architecture-"));
  try {
    await files(root, {
      "apps/mobile/src/domains/chat.ts": 'import { client } from "../infrastructure/http/client";\nexport const chat = client;\n',
      "apps/mobile/src/application/send.ts": 'import React from "react";\nexport const send = React;\n',
      "apps/mobile/src/infrastructure/http/client.ts": 'import { Screen } from "../../screens/Screen";\nexport const client = Screen;\n',
      "apps/mobile/src/screens/Screen.tsx": 'import { client } from "../infrastructure/http/client";\nexport function Screen() { return fetch(client.url); }\n',
      "apps/mobile/src/store/appState.ts": "export interface AppState { uploadProgress?: number }\n",
    });
    const result = await inspectArchitecture({ platformRoot: root, sourceRoots: ["apps/mobile/src"], exceptions: new Map() });
    assert.equal(result.failures.length, 6);
    assert(result.failures.some((failure) => failure.includes("domain imports an outer layer")));
    assert(result.failures.some((failure) => failure.includes("application use case imports presentation code")));
    assert(result.failures.some((failure) => failure.includes("infrastructure imports an inward consumer")));
    assert(result.failures.some((failure) => failure.includes("UI calls fetch directly")));
    assert(result.failures.some((failure) => failure.includes("UI imports infrastructure directly")));
    assert(result.failures.some((failure) => failure.includes("global upload progress")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("architecture gate accepts the intended dependency direction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "snezhok-architecture-"));
  try {
    await files(root, {
      "apps/mobile/src/domains/chat.ts": "export const chat = Object.freeze({});\n",
      "apps/mobile/src/application/send.ts": 'import { chat } from "../domains/chat";\nexport const send = () => chat;\n',
      "apps/mobile/src/infrastructure/http/client.ts": "export const client = Object.freeze({});\n",
      "apps/mobile/src/screens/Screen.tsx": 'import { send } from "../application/send";\nexport const Screen = send;\n',
      "apps/mobile/src/store/appState.ts": "export interface AppState { phase: string }\n",
    });
    const result = await inspectArchitecture({ platformRoot: root, sourceRoots: ["apps/mobile/src"], exceptions: new Map() });
    assert.deepEqual(result.failures, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function files(root, entries) {
  for (const [relative, source] of Object.entries(entries)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source, "utf8");
  }
}
