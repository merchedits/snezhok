# Evidence-first development and fast tester delivery

Snezhok development has two equally important goals:

1. choose strong implementations before spending time on them; and
2. put useful candidates in the owner's hands quickly enough to learn from a
   real Android device.

The first plausible implementation is not an acceptable default. Neither is a
one-hour verification ritual for every ten-minute tester change. Research and
validation are proportional to uncertainty and risk.

## 1. Start from the outcome

Before editing, establish a compact task contract:

- the user-visible outcome and the annoyance or failure being removed;
- observable acceptance scenarios, including the relevant failure paths;
- surfaces and durable data that could be affected;
- whether the requested delivery is local-only, a tester candidate, or stable;
- which claims require a real device and therefore cannot be made locally.

Inspect the current code, adjacent tests, Git history, documentation, and live
revision when relevant. Preserve unrelated work. A new implementation must fit
the existing ownership and synchronization boundaries rather than create a
second source of truth.

Do not pause for a design ceremony when the safe answer is discoverable. Raise
a question only when different answers materially change product behavior,
data safety, external cost, or scope.

## 2. Run a proportional evidence pass

Every behavior, architecture, dependency, performance, media, gesture, or
platform change gets an evidence pass before implementation. Keep it bounded:
roughly five minutes for a narrow familiar change and longer only when the
decision is consequential or genuinely uncertain.

The pass must cover what is relevant:

1. **Existing system:** trace the current implementation and root cause. Read
   prior decisions and history so a rejected path is not accidentally rebuilt.
2. **Current authoritative guidance:** search and open official Android, React
   Native, Expo, Skia, Reanimated, LiveKit, PostgreSQL, browser, protocol, or
   library documentation for the exact problem. Use current sources rather than
   memory when behavior or APIs can have changed.
3. **Established product precedent:** for interaction design, inspect the
   proven Telegram/Instagram/Discord/native Android behavior that most closely
   matches the request. Copy the interaction principle, not another brand's
   visual identity.
4. **Reuse landscape:** search for maintained native or open-source libraries
   and reference implementations. Include the option of extending an existing
   Snezhok dependency. If reuse is not relevant, state that briefly rather than
   manufacturing candidates.
5. **Evidence quality:** open the actual documentation, source repository,
   issue, release notes, or implementation. Search snippets and popularity
   alone are not evidence.

If internet access is unavailable, continue from pinned documentation and
source already present in the repository, then disclose the research gap. A
pure copy edit or mechanical rename may mark technical and reuse research as
not applicable.

## 3. Compare before choosing

For non-trivial work, compare at least these paths when they exist:

- extend or correct the current architecture;
- adopt a mature native/open-source implementation;
- build a bounded custom implementation.

Judge each viable option on:

- correctness under retries, stale state, process death, and malformed input;
- expected interaction quality and accessibility;
- Android version, screen, font-scale, and device-performance compatibility;
- thread, rendering, memory, network, storage, and battery behavior;
- integration fit and migration/rollback cost;
- maintenance activity, issue quality, release cadence, and bus factor;
- direct and transitive dependency weight;
- license compatibility, security history, and supply-chain evidence;
- testability and the ability to diagnose failures on a real device.

Prefer mature, actively maintained foundations for hard commodity problems such
as physics, media decoding, networking, cryptography, databases, gestures, and
protocols. Custom code is appropriate for Snezhok-specific product behavior or
when available libraries fail the comparison. “Already started” is not enough
reason to keep a weak approach.

State the chosen direction and the decisive reason in the task update. Record a
decision under `docs/decisions/` when it changes a durable contract, core
dependency, state owner, persistence model, renderer/physics engine, upload or
call pipeline, security boundary, or release process.

## 4. Prove the riskiest assumption early

When feasibility or performance is uncertain, make the smallest production-like
spike that answers the hardest question before building the full UI. Examples:

- measure a release build on the slower target Android device before committing
  to an animation architecture;
- exercise maximum-power and multi-collision cases before polishing a physics
  board;
- test corrupt, rotated, very large, interrupted, and resumed media before
  styling attachment chrome;
- prove keyboard anchoring under gesture and three-button navigation before
  refining composer decoration.

Profile first when the complaint is latency, jank, memory, or battery. Identify
whether the bottleneck is JavaScript, UI/render, native, serialization, network,
database, or decoder work. Do not rewrite a subsystem based only on visual
symptoms.

## 5. Implement one coherent vertical slice

- Solve the ownership or lifecycle cause, not one visible symptom.
- Reuse established domain boundaries and typed state machines.
- Keep optimistic UI, durable work, server state, realtime echoes, and cache
  reconciliation convergent.
- Avoid combining unrelated architecture, redesign, schema, and cleanup work.
- Add the smallest regression test that protects the failure being fixed.
- Keep diagnostics sufficient to distinguish likely physical-device causes.

## 6. Choose one validation and delivery lane

### A. Local iteration

Use while shaping the change:

- changed-workspace typecheck;
- focused unit or component tests for touched behavior;
- one direct smoke or render check when it adds information.

Do not repeatedly run full suites between small edits.

### B. Signed tester candidate

This is the default when the owner asks to deploy or publish a feature so they
can test it. The target is a useful, honestly labelled roughly-90% candidate,
not a claim of final completeness.

Run only:

- the changed-workspace typecheck and focused behavioral tests;
- any targeted integration check required by the touched risk boundary;
- mobile-only revision classification when the server remains unchanged;
- one clean, signed, production-like APK build;
- mandatory configuration, signing, package identity, version, provenance,
  legal-evidence, byte-count, hash, and updater/artifact checks;
- atomic publication plus manifest and byte-range smoke verification.

For an ordinary client UI or mini-game presentation change, pre-build validation
should normally fit inside 10–15 minutes. Build, signing, upload, and network
time are separate, but they are not a reason to add unrelated suites.

Do **not** run the monorepo test matrix, unrelated workspace typechecks, every
media/call journey, Expo export, full physical-device matrix, or stable-release
performance suite merely because a tester APK is being published. Escalate only
for the touched risk described below.

The handoff must name the version, commit, link, checks run, checks skipped, and
exact physical-device journeys still awaiting the owner. A tester candidate is
not “done,” “flawless,” or “confirmed” until that evidence exists.

### Standing owner delivery loop

After each coherent round of owner-requested changes, continue autonomously
through these steps unless the owner explicitly requests local-only work:

1. prepare a monotonic version, commit the exact source revision, and push it;
2. deploy server, database, or contract changes with the guarded production
   procedure and verify live revision and health;
3. build, verify, and atomically publish the signed tester APK and manifest;
4. run the focused Samsung A12 release-build smoke and capture diagnostics for
   any failure.

Building and publishing do not require a separate approval pause. A genuinely
unavailable credential, host, or physical device blocks only the dependent
step: finish the other safe steps and name the blocker and missing evidence
precisely. Never substitute emulator, static, or server evidence for the A12
smoke.

### C. Stable client or production deployment

Use the complete release gates in `DEPLOYMENT.md`, `RELEASE_ENGINEERING.md`, and
the subsystem reliability documents when the owner explicitly requests a stable
promotion or when production server/data state changes.

Production API, worker, database, migration, storage, authentication,
authorization, infrastructure, signing, or updater-channel changes never use a
reduced server gate. A small code diff can still have a large blast radius.

## 7. Risk-based escalation for tester candidates

Add targeted evidence, not the entire repository, when a candidate touches:

- **Messaging state:** duplicate/reordered send, optimistic reconciliation,
  reconnect, offline queue, and cache behavior for the changed path.
- **Attachments or voice:** one representative real file plus the specific
  interruption, metadata, decoder, playback, or background condition changed.
- **Keyboard, gestures, rendering, games, or animation:** a release-build smoke
  on the relevant screen and explicit real-device follow-up; profile if the
  change claims better performance.
- **Calls:** signaling tests do not prove audio/video. Exercise the exact
  publication, route, or track path changed and leave two-device claims pending.
- **Deletion, authentication, authorization, migrations, storage, updater,
  signing, or recovery:** use the full applicable safety gate even for testers.

Do not use “testing build” to excuse data loss, secret exposure, an unsigned or
un-upgradeable APK, a broken updater, or an incompatible server contract.

## 8. Close the feedback loop

Real-device feedback is an input to engineering, not an informal final step.
For every candidate:

1. list a short scenario checklist for the owner;
2. distinguish reproduced, locally verified, and physically confirmed states;
3. capture device model, Android version, display/font scale, network, and a
   screen recording or diagnostics when behavior is visual or performance-based;
4. update the regression test, decision record, or subsystem document when a
   repeated failure reveals a missing assumption;
5. do not stack polish on top of an unresolved architectural failure.

## 9. Getting the best results from GPT-5.6 Sol in Codex

Repository instructions should be compact, authoritative, and non-duplicated.
`AGENTS.md` points here; this document owns the workflow. Product and subsystem
documents own their specific contracts.

For project work:

- start Codex with `platform/` as the project/current directory so its
  `AGENTS.md` is discovered automatically; if a task starts from the legacy
  parent root, explicitly direct Codex to read `platform/AGENTS.md` first;
- use `gpt-5.6-sol` for complex implementation and architecture;
- use `high` reasoning as the normal quality-first setting, `xhigh` for hard
  architectural choices or stubborn cross-layer failures, and `max` selectively
  when the expected quality gain justifies materially more time;
- give Codex the outcome, exact reproduction, constraints, acceptance
  scenarios, authority boundaries, and required evidence;
- avoid prescribing a guessed implementation unless it is a hard requirement;
- attach screenshots, recordings, logs, device details, and the last known-good
  version for visual, media, keyboard, and performance failures;
- keep one coherent outcome per task; use a fresh task plus a concise handoff
  when accumulated history is mostly obsolete;
- ask for a tester candidate explicitly when speed matters, and a stable release
  explicitly when full evidence is required;
- evaluate the workflow against representative recurring Snezhok tasks rather
  than assuming that more prompt text or maximum reasoning always improves it.

A strong request can be short:

```text
Outcome: [what must feel or behave differently]
Reproduction: [exact current failure, device, and conditions]
Acceptance: [observable happy path and important edge cases]
Constraints: [data, UX, compatibility, or scope boundaries]
Delivery: signed tester candidate | stable release | local only
Evidence: [screenshots, logs, recordings, related files]
```

Codex should perform the evidence pass and option comparison autonomously; the
owner should not need to invent the implementation recipe.

## References

- [OpenAI GPT-5.6 model and prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)
- [OpenAI Codex custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Android architecture recommendations](https://developer.android.com/topic/architecture/recommendations)
- [React Native performance overview](https://reactnative.dev/docs/performance.html)
- [AWS architectural decision record process](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)
- [GitHub open-source license compliance](https://docs.github.com/en/code-security/concepts/supply-chain-security/open-source-license-compliance)
