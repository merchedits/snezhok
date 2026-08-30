# Snezhok platform engineering contract

This file applies to every file below `platform/`.

Before changing product code, read `docs/DEVELOPMENT_WORKFLOW.md` and
`docs/ENGINEERING_GUIDELINES.md` completely. Follow the workflow's proportional
evidence pass before choosing an implementation: inspect the existing path and
history, consult current authoritative guidance, and evaluate mature reuse or
open-source options when relevant. Do not implement the first plausible fix.

Classify delivery before testing. A request to publish for the owner to try is a
tester candidate by default and receives focused validation plus mandatory
artifact safety checks, not the stable-release suite. Production server/data
changes and explicit stable releases retain their full gates. Report what is
unverified and never turn missing physical-device evidence into a claim that a
candidate is complete.

After each completed owner-requested change round, use the standing delivery
loop unless the owner explicitly asks for local-only work: prepare and push a
versioned revision, deploy any required backend change through the guarded
production path, publish a signed tester APK, and run the Samsung A12 smoke.
Do not pause merely to ask permission to build or publish. Stop only for a real
external blocker such as unavailable credentials, infrastructure, or device;
complete every unblocked step and report the exact missing evidence.

The engineering guideline's MUST and MUST NOT rules are release requirements,
not suggestions. Product, design, reliability, performance, deployment, and
operations documents remain authoritative for their respective domains. When
two rules appear to conflict, preserve user data and security first, then
correctness and recoverability, then performance, and ask the owner before
changing product behavior.

Never modify the dirty legacy repository tree while working on the platform.
Stage explicit `platform/` paths only.
