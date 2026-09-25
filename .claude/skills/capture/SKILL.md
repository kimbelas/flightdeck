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

`.json` and `.jsonl` are scrubbed; JSONL goes through per line and comes back compact, because in
that format the newline is the record separator and a pretty-printed transcript is a document no
line-oriented reader could get back (P1-T7). **`.txt` is a TERMINAL FRAME** and takes a different
path entirely — see below. A capture that is none of the three must be named in the
`DEFERRED` map with the task that will handle it, or the script fails. That list exists because silently skipping a file
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

**Keys are data too, and twice now they have not been treated that way.** `scrub` rewrites values
and passes keys through as field names, which is right for `sessionId` and wrong for the two objects
whose keys are content: `workers` (keyed by short session id, P0-T9) and `trackedFileBackups` (keyed
by file path — it put a client's whole project tree and the account name into a fixture, P1-T7 /
RESEARCH.md G.16). Both are classified, in `DATA_KEYED_OBJECTS` and `PATH_KEYED_OBJECTS`, and
`assertNoDataKeys` now **fails the capture** on any unclassified key containing a separator, a drive
letter or whitespace. If it fires, classify the parent — do not reach for the fixture.

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

## Terminal frames (`.txt`) — the rules are the INVERSE of the ones above

`claude logs` answers with a 200x50 terminal FRAME: 330 046 bytes and 10 483 escape sequences for
one short session, replaying 105 full-screen redraws (RESEARCH.md F.2.5, G.34). Its consumer is an
emulator, not a field reader, so what has to survive is not shape — it is **length** (D42).

| What | What happens | Why |
| --- | --- | --- |
| Escape sequences, CR, LF | kept **byte for byte** | 39 distinct ones carry the whole layout |
| ASCII letters and digits | replaced **in place**, same case, same letter-vs-digit | every glyph advances the cursor one cell, and the frame relies on autowrap — one character longer reflows every row below it |
| Spaces, punctuation, box drawing, spinners | kept | none of it is identity, and it is what makes the flattened screen recognisable as one |
| A non-ASCII letter or digit | **fails the capture**, naming the offset | leaving it is a leak; swapping it for ASCII changes the cell width of a wide glyph |
| A `.txt` with no escape sequence | **fails the capture** | it is not a terminal frame, and guessing is what `DEFERRED` exists to prevent |

**The filler is keyed on POSITION and LENGTH, never on the word**, unlike every JSON rule above. A
per-word hash of a four-thousand-word screen is a substitution cipher a dictionary undoes with one
`sha256` per guess. Keying on the slot means the output is a function of the punctuation, the
escapes and the lengths — it never reads the letters — and re-scrubbing the same capture still
yields the same bytes, which is all `--check` needs.

**`fixtures/**/*.txt` is `-text` in `.gitattributes`, and that line is load-bearing.** The repo's
`* text=auto eol=lf` would rewrite the frame's 4 723 CRLFs to LF, and an emulator reads the two as
different instructions — the screen steps right on every line and still looks like a screen. The
working tree keeps its endings, so only a fresh checkout sees the damage (G.35).

**A `*.screen.txt` beside a frame is a GOLDEN, not a capture.** It is the screen the frame flattens
to, committed so a reviewer can read twenty-five lines instead of 330 KB, and compared by
`tests/fixtures/logs.test.ts`. `capture-fixtures.mjs` does not write it — a golden regenerated by
the code it checks proves nothing. Regenerate it by hand, deliberately, and read the diff.

## Line logs (`.log`) — a grammar, and anything outside it fails

`daemon.log` is neither JSON nor a frame, and both of those rules are wrong for it: there are no
keys to classify, and D42's "replace every letter, never read the words" would destroy the words
the parser reads — `retire`, `idle-prompt`, `empty-idle`, `settled`, `killed` (D60, P7-T4).

| What | What happens | Why |
| --- | --- | --- |
| `[instant] [channel]` prefix | instant shifted by the JSON rule's constant | sequence and gaps survive |
| Template words | kept | they are Claude Code's vocabulary, and the parser's input |
| Short session id slot | a digest of itself, 8 hex | a retire and its settle still name ONE session |
| Path slot | the JSON rule's `fakePath` | only `binary at <path> changed` carries one |
| Pids, versions, counts, durations | kept | not identity; the supervisor pid is the join to `roster.json` (F.2.16) |
| A line matching no template | **fails the capture**, naming the line number | the day a prompt or a folder appears in the log, it stops here |

The templates are `LOG_TEMPLATES` in `scripts/capture-log.mjs`. Add one only after reading the
line, and only if every variable part is a number, a version, a vocabulary word, a short id or a
path. `*.log` is ignored repo-wide, so `.gitignore` re-includes `fixtures/daemon/*.log` by name.

## Adding a new key

- A short, fixed, non-sensitive enum the fixture exists to assert on → `VOCABULARY_KEYS`.
- Something this script writes as documentation (`note`, `claude_version`) → `AUTHORED_KEYS`.
- Free text a person or the model wrote → `FREE_TEXT_KEYS`, which ignores the length rule.
- An object whose **keys** are data rather than field names → `DATA_KEYED_OBJECTS` (keys derived
  from another field) or `PATH_KEYED_OBJECTS` (keys that are file paths).

Each of those has a test in `tests/capture-fixtures.test.ts`. Add one with the key.
