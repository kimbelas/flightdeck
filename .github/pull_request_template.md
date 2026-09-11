## What

<!-- One paragraph. Which roadmap task(s): [P1-T4] -->

## Why

<!-- The problem, or the phase gate this moves toward. Link DECISIONS.md D-n if a decision was made. -->

## Checklist (CODING-STANDARDS.md §13)

- [ ] Unit tests with fakes; fixtures added for any new external shape (scrubbed, no raw transcripts)
- [ ] `npm run check` green locally
- [ ] No new `any`, `!`, `as`, `export default`, `exec`, `shell: true`
- [ ] Dependency rule respected (domain imports nothing from adapters/http/node)
- [ ] One class, one responsibility; constructor injection; ports for anything external
- [ ] Security: controls satisfied — `SEC-…`; every mutating action writes an audit row
- [ ] Model/user text is never interpolated into a command, path, SQL or HTML
- [ ] Public API has JSDoc explaining the why
- [ ] `ROADMAP.yaml` status updated (and `updated:` date)
- [ ] No TODO without a task id

## How to verify

<!-- Commands or clicks a reviewer runs to see it working. -->
