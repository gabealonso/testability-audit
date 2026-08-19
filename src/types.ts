/** TYPES */

/** Static configuration read from `data/config.json`. */
export interface Config {
    /** Attributes treated as a test id, best first. */
    testIdAttributes: string[];
}

/**
 * One interactive element as read from a page. This is the only thing the audit
 * consumes, which is what keeps the ranking pure and testable: a browser produces
 * snapshots, and the audit judges them. A saved snapshot can be re-audited in CI
 * with no browser at all.
 */
export interface ElementSnapshot {
    /** Tag name, lowercase (`button`, `input`, `a`). */
    tag: string;
    /** ARIA role, from the accessibility tree. */
    role: string | null;
    /** Accessible name, from the accessibility tree. */
    name: string | null;
    /** Value of the first matching test-id attribute, if any. */
    testId: string | null;
    /** Text of an associated `<label>`, if any. */
    label: string | null;
    /** Visible text content, trimmed. */
    text: string | null;
    /** `id` attribute, whether hand-written or framework-generated. */
    id: string | null;
    /** Last-resort CSS path, always present so an element is never unaddressable. */
    cssPath: string;
}

/** A page's worth of snapshots, plus where they came from. */
export interface Snapshot {
    url: string;
    /** When the page was read, ISO 8601. */
    readAt: string;
    elements: ElementSnapshot[];
}

/**
 * How an element should be located, in order of preference. The ladder is the whole
 * opinion of this tool: prefer what a user perceives (role and accessible name) and
 * what a team owns on purpose (a test id) over what happens to be in the markup.
 */
export type Strategy = "test-id" | "role-name" | "label" | "id" | "text" | "css";

/** How much trust a strategy earns. */
export type Verdict = "stable" | "fragile" | "unreachable";

/** The ranking of one element: how to locate it, and how worried to be. */
export interface Ranked {
    element: ElementSnapshot;
    /** 1 (best) to 6 (worst), matching the strategy ladder. */
    tier: number;
    strategy: Strategy;
    verdict: Verdict;
    /** The Playwright expression a test would use. */
    locator: string;
    /** Why this strategy and not a better one, in one line. */
    reason: string;
}

/** The audit of a whole snapshot. */
export interface Audit {
    url: string;
    readAt: string;
    ranked: Ranked[];
    counts: Record<Verdict, number>;
    /** Share of elements that are stable, 0-100, rounded. */
    score: number;
}
