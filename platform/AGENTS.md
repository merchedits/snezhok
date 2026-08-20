# Snezhok platform engineering contract

This file applies to every file below `platform/`.

Before changing product code, read `docs/ENGINEERING_GUIDELINES.md` completely.
Its MUST and MUST NOT rules are release requirements, not suggestions. Product,
design, reliability, performance, deployment, and operations documents remain
authoritative for their respective domains. When two rules appear to conflict,
preserve user data and security first, then correctness and recoverability,
then performance, and ask the owner before changing product behavior.

Never modify the dirty legacy repository tree while working on the platform.
Stage explicit `platform/` paths only.
