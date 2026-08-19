# testability-audit

Audits a web page's testability: ranks every interactive element by locator stability
and reports **what automation can't reach**.

Most tools try to write your tests for you. This one answers the question that comes
first — *can this page be tested at all, and what has to change?* — and gives you a list
you can hand to the team.

```bash
npm run demo
```

```
# Testability audit

- URL: https://www.saucedemo.com/
- Elements: 6
- Stable: 3 · Fragile: 1 · Unreachable: 2
- Score: 50% stable

      ELEMENT               STRATEGY   LOCATOR
FAIL  button                css        locator('div.MuiBox-root > div:nth-child(2) > button')
FAIL  div                   css        locator('#root > div > div:nth-child(4) > div > div')
warn  a "Forgot password?"  text       getByText('Forgot password?')
ok    input "Password"      role-name  getByRole('textbox', { name: 'Password' })
ok    button "Login"        role-name  getByRole('button', { name: 'Login' })
ok    input "Username"      test-id    getByTestId('username')

## 2 elements automation cannot reach

Each of these needs a test id, an accessible name, or a label before a test
can address it without depending on the DOM shape:

- button — Only a generated id (mui-4821) — nothing durable to hold on to.
- div — No test id, no accessible name, no label, no text.
```

---

## Status

Early, but it works end to end against real pages.

| Piece | State |
| --- | --- |
| Stability ranking | done, fully tested |
| Report (readable + JSON) | done |
| CI gate (`--max-unreachable`) | done |
| Reading a live page | done (Chromium, read-only) |
| Crawling beyond one page | not planned yet |

## Requirements

**Node >= 23** (native TypeScript execution). Check with `node -v`.

```bash
npm install
npx playwright install chromium
```

One runtime dependency, `playwright` — you cannot read a live page without a browser.
`typescript` and `@types/node` are dev-only.

## Usage

```bash
node src/cli.ts https://example.com/login
node src/cli.ts snapshot.json          # re-audit a saved read, no browser needed
```

| Option | Meaning |
| --- | --- |
| `--json` | Print the JSON report instead of the readable one |
| `--max-unreachable N` | Exit 1 when more than N elements cannot be reached |
| `--save-snapshot <path>` | Save what was read, so it can be re-audited offline |
| `--storage-state <path>` | Playwright `storageState` file, for a page behind a login |
| `-h`, `--help` | Show usage |

Reading a page is **strictly read-only**: it navigates and reads, and never clicks,
types or submits. Auditing a page is exactly as invasive as visiting it.

Exit code is `0` when the audit ran, `1` when the limit was exceeded or the snapshot
could not be read — so a CI step can gate on testability:

```bash
node src/cli.ts snapshot.json --max-unreachable 0
```

## The ladder

The ranking is the tool's whole opinion. Best first:

| Tier | Strategy | Locator | Verdict |
| --- | --- | --- | --- |
| 1 | test id | `getByTestId('pay')` | stable |
| 2 | role + accessible name | `getByRole('button', { name: 'Pay' })` | stable |
| 3 | label | `getByLabel('Password')` | stable |
| 4 | hand-written id | `locator('#pay')` | fragile |
| 5 | visible text | `getByText('Pay')` | fragile |
| 6 | CSS path | `locator('div > button')` | **unreachable** |

Why that order:

- A **test id** is the only locator a team owns on purpose. Nothing else survives a
  redesign as reliably.
- **Role + accessible name** addresses the element the way a user perceives it. A
  locator that breaks when the accessible name changes *should* break — the behaviour
  changed.
- A **hand-written id** is reliable, but it is markup rather than intent, and nobody
  thinks twice about renaming one because it is not test-owned.
- **Text** matches what happens to be written today. It breaks on copy edits and on
  every translation.
- A **CSS path** is not a locator, it is a coordinate. It breaks when someone adds a
  wrapper div, so an element with nothing better is effectively unreachable.

**Generated ids are rejected**, not counted as tier 4. `mui-4821`, `:r1:` from React's
`useId`, `ember1234`, hashed class names — those change between builds, so a locator
built on one passes locally and fails in CI. That is worse than having no locator,
because it looks fine.

The score is the share of elements that are **stable**. Counting "has some locator"
would score every page 100% — every element has a CSS path — and measure nothing.

## Snapshots

A **snapshot** is the list of interactive elements read from a page — what the browser
layer produces and the audit consumes. Saving one (`--save-snapshot`) lets a CI job
re-audit the same page later with no browser at all, and makes a score change reviewable
as a diff.

### Format

```json
{
    "url": "https://example.com/login",
    "readAt": "2026-08-14T19:00:00.000Z",
    "elements": [
        {
            "tag": "input",
            "role": "textbox",
            "name": "Username",
            "testId": "username",
            "label": "Username",
            "text": null,
            "id": "user-name",
            "cssPath": "#user-name"
        }
    ]
}
```

`tag` and `cssPath` are required on every element; everything else may be `null`. See
`fixtures/example-snapshot.json`.

`role` and `name` are computed in the page from a deliberate **subset** of the ARIA
rules — implicit roles for the tags that matter, and the name sources that actually
occur: `aria-label`, `aria-labelledby`, an associated `<label>`, text content, a
descendant `img[alt]` or `<svg><title>`, then `title` / `alt` / `placeholder`. It is not
the full accname specification. The bar it has to clear is agreeing with what
`getByRole` will find, and that is what `npm run test:browser` checks.

Which attributes count as a test id is configurable in `src/data/config.json`
(`data-testid`, `data-test`, `data-cy`, `data-qa`, …).

## Layout

```
src/
  cli.ts        # argument parsing and dispatch
  browser.ts    # URL -> snapshot (Chromium, read-only). The only impure module.
  audit.ts      # snapshot -> counts, score, ordering. Pure.
  rank.ts       # the ladder: one element -> strategy, verdict, locator. Pure.
  report.ts     # readable and JSON rendering. Pure.
  types.ts      # every domain type
  data/config.json
fixtures/
  example-snapshot.json
tests/
  rank.spec.ts · audit.spec.ts · report.spec.ts    # npm test — offline
  browser/read.spec.ts                             # npm run test:browser — real Chromium
```

Two suites on purpose. `npm test` covers the ranking, scoring and rendering with plain
fixtures and runs offline in under a second. `npm run test:browser` drives real Chromium,
because the element reader runs *inside* the page and depends on the DOM and computed
styles — there is nothing to stub there that would still be telling the truth.

## Safe against the page it reads

A page you audit is a page you do not control, and its text ends up in two places: your
terminal, and a locator you paste into a test file. Both are handled:

- **Locators cannot be escaped out of.** An element named `a'); doSomething(); //` comes
  out as a quoted string, never as code.
- **Control characters are stripped.** A newline in an accessible name would make the
  pasted locator an unterminated string; an ANSI escape in one could drive your terminal
  and even set its window title. Neither reaches the report.

Both are covered by tests, in `tests/rank.spec.ts`.

## Scope

This tool **does not generate tests or page objects**. Generated tests are brittle and
end up deleted; the durable artefact is the map and the verdict. Keeping that line is
what keeps this finishable.

It is also **read-only**: it never clicks, submits, or otherwise touches the page. Point
it at your own application or at a public demo site built for testing. Auditing someone
else's site without permission is on you.

## License

MIT
