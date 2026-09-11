---
name: capture
description: Add or refresh a Flightdeck fixture from a real Claude Code capture. Use when capturing CLI/hook/statusline output, adding a file under fixtures/, or when a fixture needs regenerating. Covers the raw-to-scrubbed pipeline and the scrub rules that keep the public repo free of identity.
---

# Capturing a fixture

Fixtures are **generated, never hand-edited**. Raw captures go in `fixtures/raw/`, which is
git-ignored; the scrubber turns them into the committable files under `fixtures/<source>/`.
Editing a committed fixture by hand makes the next `--check` run fail and quietly reintroduces
whatever the scrubber exists to remove.

## The pipeline

```bash
# 1. capture into fixtures/raw/<source>/<shape>.json  (never into fixtures/<source>/)
# 2. scrub
node scripts/capture-fixtures.mjs
# 3. CI runs this; it fails if any output would change
node scripts/capture-fixtures.mjs --check
```

The scrub is deterministic — the same input always yields the same placeholder — so a re-capture
produces a zero-line diff unless the upstream shape actually changed. That property is the point:
it makes a real shape change visible instead of drowning it in churn.

Only `.json` is scrubbed. A capture that is not JSON must be named in the `DEFERRED` map with the
task that will handle it, or the script fails. That list exists because silently skipping a file
it could not parse once hid a captured shape from the repo for a day (P0-T9). A deferral is
allowed; a silent one is not.

## What the scrub does

| Shape | Becomes | Why the shape survives |
| --- | --- | --- |
| String over 12 chars | `text-<8 hex>` | — |
| UUID | a well-formed v4 UUID | `contracts/` schemas still accept it |
| ISO instant | shifted by a constant | a timeline fixture is about sequence and gaps |
| Windows path | same depth, same extension | parsers navigate by depth and suffix |
| CLI flag, model id | kept verbatim | closed, published, non-sensitive vocabulary |

**Path segments do not use the length rule.** A segment survives only if it is in
`STRUCTURAL_SEGMENTS` — the Windows and Claude directory names a parser navigates by (`Users`,
`AppData`, `projects`, `.claude-isg`, …). Everything else is scrubbed however short it is. This
was a real leak: the old rule kept any segment of 12 characters or fewer, and the machine account
name, every client project folder and a ticket id are all shorter than that, so they went into
every committed fixture (RESEARCH.md F.7.8, D23). Length was never a safety property.

**Session names are free text.** `scrubSessionName` replaces the `name` on any record carrying a
`pid` or `sessionId`, regardless of length, because a session named after a ticket identifies an
employer in nine characters. Vocabulary names like `output_style.name` stay readable.

Relationships a parser depends on are restored after scrubbing, not left broken:
`keepShortIdDerivable` keeps `id` the first segment of `sessionId`, and `rekeyByShortId` does the
same for the `workers` map, whose **keys** are data. A fixture that asserts a relationship it no
longer has is worse than an unscrubbed one — a parser built against it is built against a lie.

## Before committing

```bash
node scripts/capture-fixtures.mjs --check     # must be silent
git grep -nI -e 'Users.<youraccount>' -- fixtures/
```

Then read the diff. If a name, a path or a ticket id survived, fix `capture-fixtures.mjs` and
regenerate — do not edit the fixture. The rule is the thing that has to be right; the file is
just its output.

## Adding a new key

- A short, fixed, non-sensitive enum the fixture exists to assert on → `VOCABULARY_KEYS`.
- Something this script writes as documentation (`note`, `claude_version`) → `AUTHORED_KEYS`.
- Free text a person or the model wrote → `FREE_TEXT_KEYS`, which ignores the length rule.
- An object whose **keys** are data rather than field names → `DATA_KEYED_OBJECTS`.

Each of those has a test in `tests/capture-fixtures.test.ts`. Add one with the key.
