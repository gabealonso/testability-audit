# CLAUDE.md

Guide for working in this repository. `testability-audit` is a **CLI that judges whether
a web page can be automated**: it ranks every interactive element by locator stability
and reports what nothing durable can address. Written in **TypeScript**, run **directly
by Node** (native type stripping, no build step).

> **Philosophy:** one runtime dependency, and it has to earn its place. `playwright` is
> the only one, because you cannot read a live page without a browser — **keep it at
> one**. Everything else is native: TypeScript runs directly on Node, tests use
> `node:test`, and `typescript` / `@types/node` are dev-only for `npm run typecheck`.
> Look for a native Node API before reaching for a package.

---

## What this tool is, and is not

**It is** an auditor. Input: a snapshot of a page's interactive elements. Output: a
verdict per element, a score, and a list of what automation cannot reach.

**It is not** a test generator or a page-object scaffolder. That line is deliberate:
generated tests are brittle and get deleted, while the map and the verdict stay useful.
If asked to add test generation, push back once and suggest keeping it in a separate
tool.

**It is read-only.** The auditor never clicks, submits, hovers, or navigates beyond the
page it was pointed at. That is not a limitation to fix — it is what makes the tool safe
to run against anything the user is allowed to see, and it removes the whole class of
"the crawler submitted a form and sent 300 emails" problems. **Do not add interaction.**

---

## Stack and commands

- **TypeScript** (ESM, `"type": "module"`), executed by Node with no transpiler.
- **`node:test`** + **`node:assert/strict`** for the unit tests.
- **Node >= 23** — required for native type stripping.

Commands:

- `npm run audit -- <url|snapshot.json>` — audit a live page, or a saved snapshot
- `npm run demo` — audit the bundled fixture
- `npm test` — the offline suite (ranking, scoring, rendering)
- `npm run test:browser` — the Chromium suite (the in-page reader)
- `npm run typecheck`

> There is no build step. Node runs the `.ts` files directly, which is why local imports
> use the **`.ts` extension**.

---

## The snapshot boundary (the load-bearing decision)

The audit consumes a `Snapshot` — a `url`, a `readAt`, and a list of `ElementSnapshot`.
It never touches a browser. This split is load-bearing for three reasons:

1. **The ranking stays pure**, so it is tested exhaustively with plain fixtures.
2. **A CI job can re-audit a saved snapshot with no browser at all.**
3. The browser layer becomes a small, replaceable adapter rather than the whole program.

`src/browser.ts` is that adapter, and its only job is `URL -> Snapshot`. It must not
rank, score, or render.

---

## Project structure

```
src/
  cli.ts        # argument parsing + dispatch; the only file that prints
  browser.ts    # URL -> Snapshot (Chromium, read-only). The only impure module.
  audit.ts      # snapshot -> counts, score, worst-first ordering. Pure.
  rank.ts       # the ladder: one element -> strategy, verdict, locator. Pure.
  report.ts     # readable + JSON rendering (returns strings, never prints). Pure.
  types.ts      # every domain type
  data/config.json   # which attributes count as a test id
fixtures/
  example-snapshot.json
tests/
  rank.spec.ts · audit.spec.ts · report.spec.ts   # npm test — offline
  browser/read.spec.ts                            # npm run test:browser — real Chromium
```

### Responsibility of each layer

1. **`data/*.json`** — Static data. Never hardcode a configurable value in the code.
2. **Pure modules** (`rank.ts`, `audit.ts`, `report.ts`) — No I/O, no `console`.
   **This is where the logic lives, and what the offline tests cover.**
3. **`browser.ts`** — The only impure module. Launches Chromium, navigates, reads. Never
   ranks, scores or renders, and **never interacts** with the page.
4. **`cli.ts`** — Reads argv, reads the page or the file, prints, sets the exit code. The
   only file allowed to `console.log`.

Keeping `report.ts` returning strings instead of printing is what makes the output
testable; keep it that way.

---

## The ladder is the product

`rank.ts` holds the whole opinion of this tool, and the *reasoning* in its comments
matters as much as the code — it is what a reviewer will argue with. Order, best first:
test id → role + accessible name → label → hand-written id → visible text → CSS path.

Two decisions to preserve:

- **Generated ids are rejected outright, not ranked as tier 4.** `mui-4821`, `:r1:`,
  `ember1234`, hashed class names — a locator on one of those passes locally and fails in
  CI, which is worse than no locator because it looks fine. `looksGenerated` is
  deliberately conservative; if it produces a false positive on a real hand-written id,
  tighten the specific pattern rather than loosening the whole check.
- **The score counts only `stable` elements.** Counting "has some locator" would score
  every page 100%, because every element has a CSS path. If someone asks why their score
  is low, the answer is the report, not the formula.

Changing the ladder's order or verdicts changes every user's score. Do not do it as a
side effect of another change.

---

## Code conventions (MANDATORY)

### General
- **Everything in TypeScript.** No `.js` files. Prefer `unknown` over `any`.
- **Local imports use the real `.ts` extension**: `import { rankElement } from "./rank.ts";`
  Required by Node's native type stripping, which does not rewrite extensions.
- JSON imports use import attributes:
  `import config from "./data/config.json" with { type: "json" };`.
- 4-space indentation, double quotes, trailing semicolons.
- Arrow functions assigned with `const`.
- **No `enum`, `namespace`, or constructor parameter properties.** Node's type stripping
  cannot erase them; `erasableSyntaxOnly` enforces this at typecheck time.
- `noUncheckedIndexedAccess` is on: indexing yields `T | undefined`. Handle it
  (`?? fallback`, or a guard) rather than casting.

### Comments
- Keep the section banners: `/** LIBS */`, `/** FUNCTIONS */`, `/** EXPORTS */`,
  `/** TEST SUITE */`, `/** FIXTURES */`, `/** TYPES */`.
- Document every function with **JSDoc**: a description, a blank line, then
  `@param name - description.` and `@returns`. **Types go in the TypeScript signature,
  never in the JSDoc.**
- Comment the *why*. In `rank.ts` the why **is** the product — keep those paragraphs.

### Types (`types.ts`)
- Every domain structure is an `interface`/`type` in `src/types.ts`. Do not declare
  domain types inline in other modules.
- Prefer string-literal unions (`Strategy`, `Verdict`) over booleans or magic numbers, so
  a new rung of the ladder is a compile error everywhere it must be handled.

### Specs (`tests/*.spec.ts`)
- File name: `{module}.spec.ts`, one per pure module.
- `describe("{module} - {area}", ...)` with `it("{behavior in plain English}", ...)`.
- **`npm test` must stay offline and deterministic.** No network, no browser, no HTTP
  mocking library. Build `ElementSnapshot` fixtures with a small local factory.
- **Browser-backed tests live in `tests/browser/`** and run via `npm run test:browser`.
  They use `page.setContent` with fixture HTML — real DOM, no network. Put a test there
  only when it genuinely needs a browser (anything touching `readElements` does).
- Cover the failure paths: a malformed snapshot, an element missing `cssPath`, an empty
  page, a name containing a quote.
- When adding a rung or changing `looksGenerated`, add both a positive and a negative
  case. A stability heuristic with no negative test is how false positives ship.

---

## Working on `readElements` (the in-page reader)

`readElements` is passed to `page.evaluate`, so **it runs inside the browser and cannot
import anything from this project** — every helper it needs is inlined in its body. That
is a constraint, not an oversight; do not try to factor it out into a shared module.

It computes `role` and `name` from a deliberate subset of the ARIA rules. The bar is
agreeing with what `getByRole` will find, not implementing accname in full.

**The lesson that cost a real bug:** the first version read the accessible name only from
the element's own attributes and text, so `<a><img alt="VS Code"></a>` came out nameless
and was reported as **unreachable**. Nine of those on `playwright.dev` turned a clean page
into a 82% score. A false positive is the worst thing an auditor can produce — it sends a
team to fix markup that was already fine, and it burns the tool's credibility on first
contact. The name must therefore also come from descendants (`img[alt]`, `<svg><title>`,
`[aria-label]`).

When you touch this function: run `npm run test:browser`, then audit a real page with
good markup (`https://playwright.dev` scores 100%) and confirm it still does. A rise in
"unreachable" after a change to the reader is a bug in the reader until proven otherwise.

## Page content is untrusted

Everything that comes out of a page — an accessible name, a label, text, an `id` — was
written by whoever controls that page, and it lands in two places that matter: the
operator's terminal, and a locator string the user will **paste into a real test file**.
Two guarantees protect that, and both have tests:

**1. Nothing can escape the locator string.** `quote()` escapes backslashes and single
quotes, so an element named `a'); process.exit(1); //` renders as a string literal and
never as code. Every value that reaches a locator goes through `quote()` — including the
`id` in tier 4, which was interpolated raw in the first version. That is exactly the kind
of one-line inconsistency to watch for when adding a rung.

**2. Control characters are dropped, in two layers.** `clean()` inside `readElements`
strips them and collapses whitespace runs; `quote()` strips them again, for a snapshot
that arrived from somewhere else. Without this, a raw newline in a name makes the pasted
locator an unterminated string, and an ANSI escape drives the reader's terminal — a page
can set the operator's window title through a report. Collapsing whitespace also makes the
locator *more* correct, because Playwright normalizes whitespace when it matches an
accessible name.

**Write control characters as escapes in source**, never as literal bytes — invisible
characters in a public repo are their own problem. Verify before committing:

```bash
grep -rlP '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' src/ tests/
```

## Not planned

- **Crawling** to other pages. One page per run.
- **Interaction** of any kind — clicking, typing, submitting, hovering.
- **Test or page-object generation.**

Each of those is a decision, not a gap. Push back once before adding any of them.

## Keeping the README in sync (MANDATORY)

Whenever you make a **structural change**, update `README.md` in the same change: new or
changed commands and flags, the ladder, the snapshot format, dependencies, or the
`.claude/` tooling. The README's **Status table** must reflect what actually works —
this repo is public and early, and an inaccurate status table is worse than none.

## Rules for the agent

- Respect the layer separation: `data` → pure modules → `cli`. Only `cli.ts` prints.
- Do not add dependencies without justification; look for a native Node API first.
- **Do not add page interaction, test generation, or page-object output.** Those are out
  of scope by decision, not by omission.
- Do not change the ladder's order or the score formula as a side effect of another task.
- **Treat every string from a page as hostile.** Route it through `quote()` before it
  reaches a locator, and never write literal control characters into source.
- Run `npm run typecheck` **and** `npm test` before calling a change done.
- After any structural change, update `README.md` in the same change.
