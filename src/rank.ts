/** LIBS */
import type { ElementSnapshot, Ranked, Strategy, Verdict } from "./types.ts";

/**
 * The ladder, best first. Each rung is a strategy plus how much trust it earns.
 *
 * The ordering is this tool's whole opinion, and it is deliberate:
 *
 * - A **test id** is the only locator a team owns on purpose. Nothing else survives a
 *   redesign as reliably.
 * - **Role + accessible name** comes next because it addresses the element the way a
 *   user perceives it. A locator that breaks when the accessible name changes *should*
 *   break — the behaviour changed.
 * - A **label** is the same argument, for form fields.
 * - A hand-written **id** is reliable, but it is markup rather than intent, and nobody
 *   thinks twice about renaming one because it is not test-owned.
 * - **Text** matches what happens to be written today. It breaks on copy edits and on
 *   every translation: fragile rather than wrong.
 * - A **CSS path** is not a locator, it is a coordinate. It breaks when someone adds a
 *   wrapper div. An element with nothing better is effectively unreachable.
 */
const LADDER: { tier: number; strategy: Strategy; verdict: Verdict }[] = [
    { tier: 1, strategy: "test-id", verdict: "stable" },
    { tier: 2, strategy: "role-name", verdict: "stable" },
    { tier: 3, strategy: "label", verdict: "stable" },
    { tier: 4, strategy: "id", verdict: "fragile" },
    { tier: 5, strategy: "text", verdict: "fragile" },
    { tier: 6, strategy: "css", verdict: "unreachable" },
];

/** FUNCTIONS */

/**
 * Look up a rung of the ladder by tier.
 *
 * @param tier - The 1-based tier.
 * @returns That rung's strategy and verdict.
 */
const rung = (tier: number): { tier: number; strategy: Strategy; verdict: Verdict } => {
    const found = LADDER[tier - 1];

    if (!found) {
        throw new Error(`No rung at tier ${tier}.`);
    }

    return found;
};

/**
 * Whether an `id` looks machine-generated rather than written by a person.
 *
 * Frameworks mint ids at render time — `mui-3421`, `:r1:` from React's `useId`,
 * `ember1234`, hashed CSS-module names. Those change between builds or even between
 * renders, so a locator built on one is worse than no locator: it passes locally and
 * fails in CI. Anything carrying a colon, a long digit run or a long hex chunk is
 * treated as generated.
 *
 * @param id - The raw `id` attribute value.
 * @returns True when the id must not be used as a locator.
 */
const looksGenerated = (id: string): boolean => {
    return (
        id.includes(":") ||
        /\d{4,}/.test(id) ||
        /[0-9a-f]{8,}/i.test(id) ||
        /^\d/.test(id) ||
        /(^|[-_])\d{3,}([-_]|$)/.test(id)
    );
};

/**
 * Quote a value for use inside a single-quoted Playwright string.
 *
 * Escaping the backslash and the quote is what stops a hostile page from breaking out of
 * the string it is printed into — an element named `'); doSomething(); //` must come out
 * as text, not as code, because these locators get pasted into real test files.
 *
 * Control characters are dropped for the same reason the reader drops them: a raw newline
 * would make the pasted locator a syntax error, and an ANSI escape would drive the
 * reader's terminal. The reader already cleans them, so this is the second layer, for a
 * snapshot that arrived from somewhere else.
 *
 * @param value - The raw text.
 * @returns The text wrapped in single quotes, safe to paste.
 */
const quote = (value: string): string => {
    const safe = value
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");

    return `'${safe}'`;
};

/**
 * Rank one element: pick the best strategy its attributes allow, and record why
 * nothing better was available.
 *
 * @param element - The element as read from the page.
 * @param testIdAttribute - Which attribute the test id came from, for the message.
 * @returns The ranking, including the Playwright expression a test would use.
 */
const rankElement = (element: ElementSnapshot, testIdAttribute = "data-testid"): Ranked => {
    if (element.testId) {
        return {
            element,
            ...rung(1),
            locator: `getByTestId(${quote(element.testId)})`,
            reason: `Owned test id (${testIdAttribute}).`,
        };
    }

    if (element.role && element.name) {
        return {
            element,
            ...rung(2),
            locator: `getByRole(${quote(element.role)}, { name: ${quote(element.name)} })`,
            reason: "Addressed the way a user perceives it.",
        };
    }

    if (element.label) {
        return {
            element,
            ...rung(3),
            locator: `getByLabel(${quote(element.label)})`,
            reason: "Associated label.",
        };
    }

    if (element.id && !looksGenerated(element.id)) {
        return {
            element,
            ...rung(4),
            // Quoted like every other value: an id may legally contain an apostrophe,
            // and this string gets pasted into real code.
            locator: `locator(${quote(`#${element.id}`)})`,
            reason: "Hand-written id — reliable, but markup rather than intent, and not test-owned.",
        };
    }

    if (element.text) {
        return {
            element,
            ...rung(5),
            locator: `getByText(${quote(element.text)})`,
            reason: "Only visible text — breaks on copy edits and on every translation.",
        };
    }

    return {
        element,
        ...rung(6),
        locator: `locator(${quote(element.cssPath)})`,
        reason: element.id
            ? `Only a generated id (${element.id}) — nothing durable to hold on to.`
            : "No test id, no accessible name, no label, no text.",
    };
};

/** EXPORTS */
export { looksGenerated, quote, rankElement };
