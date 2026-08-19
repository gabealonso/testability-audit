/** LIBS */
import type { Audit, Ranked, Verdict } from "./types.ts";

/** How each verdict reads in the report. */
const MARK: Record<Verdict, string> = {
    stable: "ok",
    fragile: "warn",
    unreachable: "FAIL",
};

/** FUNCTIONS */

/**
 * Render a matrix of cells as a left-aligned text table. The last column is not padded
 * so lines never carry trailing spaces.
 *
 * @param rows - The rows to render, each one a list of cells.
 * @returns The table as a multi-line string.
 */
const table = (rows: string[][]): string => {
    const widths = rows.reduce<number[]>(
        (acc, row) => row.map((cell, index) => Math.max(acc[index] ?? 0, cell.length)),
        []
    );

    return rows
        .map((row) =>
            row
                .map((cell, index) =>
                    index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)
                )
                .join("  ")
                .trimEnd()
        )
        .join("\n");
};

/**
 * Describe an element briefly enough to find it on the page.
 *
 * @param item - The ranked element.
 * @returns A short human label.
 */
const label = (item: Ranked): string => {
    const { element } = item;
    const name = element.name ?? element.label ?? element.text;

    return name ? `${element.tag} "${name}"` : element.tag;
};

/**
 * Render the audit as a terminal/markdown report, worst first.
 *
 * The summary leads with what cannot be reached, because that is the actionable part:
 * a list a QA can hand to the team as "these need a test id".
 *
 * @param audit - The audit to render.
 * @returns The report as a printable string.
 */
const renderReport = (audit: Audit): string => {
    const { counts } = audit;
    const total = audit.ranked.length;

    const header = [
        "",
        `# Testability audit`,
        "",
        `- URL: ${audit.url}`,
        `- Elements: ${total}`,
        `- Stable: ${counts.stable} · Fragile: ${counts.fragile} · Unreachable: ${counts.unreachable}`,
        `- Score: ${audit.score}% stable`,
        "",
    ].join("\n");

    if (total === 0) {
        return `${header}No interactive elements were found on this page.\n`;
    }

    const rows = [
        ["", "ELEMENT", "STRATEGY", "LOCATOR"],
        ...audit.ranked.map((item) => [
            MARK[item.verdict],
            label(item),
            item.strategy,
            item.locator,
        ]),
    ];

    const unreachable = audit.ranked.filter((item) => item.verdict === "unreachable");

    const advice =
        unreachable.length === 0
            ? "Every element has a locator that does not depend on the DOM shape.\n"
            : [
                  `## ${unreachable.length} element${unreachable.length === 1 ? "" : "s"} automation cannot reach`,
                  "",
                  "Each of these needs a test id, an accessible name, or a label before a test",
                  "can address it without depending on the DOM shape:",
                  "",
                  ...unreachable.map((item) => `- ${label(item)} — ${item.reason}`),
                  "",
              ].join("\n");

    return `${header}\n${table(rows)}\n\n${advice}`;
};

/**
 * Render the audit as JSON, for a CI step to read.
 *
 * @param audit - The audit to render.
 * @returns Pretty-printed JSON.
 */
const renderJson = (audit: Audit): string => {
    return JSON.stringify(
        {
            url: audit.url,
            readAt: audit.readAt,
            score: audit.score,
            counts: audit.counts,
            elements: audit.ranked.map((item) => ({
                tag: item.element.tag,
                name: item.element.name,
                tier: item.tier,
                strategy: item.strategy,
                verdict: item.verdict,
                locator: item.locator,
                reason: item.reason,
                cssPath: item.element.cssPath,
            })),
        },
        null,
        2
    );
};

/** EXPORTS */
export { table, renderReport, renderJson };
