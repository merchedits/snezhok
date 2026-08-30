# Snezhok decision records

Use a decision record for a durable, costly-to-reverse choice: a core library,
protocol, state owner, database or cache model, rendering/physics engine,
attachment/upload/call pipeline, security boundary, or release-process change.
Small styling and mechanical changes do not need one.

Accepted records are historical evidence. Do not rewrite them when the decision
changes; add a new record that supersedes the old one. Name records
`YYYY-MM-DD-short-decision.md`.

## Template

```markdown
# [Decision title]

- Status: Proposed | Accepted | Rejected | Superseded
- Date: YYYY-MM-DD
- Owner: [name or role]
- Supersedes: [record or none]

## Context and outcome

[User problem, current failure, constraints, and observable acceptance cases.]

## Evidence

- Existing implementation/history: [findings]
- Authoritative guidance: [opened source links and relevant conclusions]
- Product precedent: [interaction precedent, if applicable]
- Open-source/native candidates: [repositories/libraries considered]

## Options

| Option | Correctness and UX | Performance and compatibility | Maintenance, license, and risk |
| --- | --- | --- | --- |
| Extend current path | | | |
| Reuse candidate | | | |
| Custom implementation | | | |

## Decision

[Choice and decisive reasons.]

## Consequences and rollback

[Benefits, costs, migration, observability, rollback, and removal gates.]

## Validation

- Focused local checks: [list]
- Tester-candidate scenarios: [list]
- Stable-release evidence: [list]
- Physical-device evidence still required: [list]
```
