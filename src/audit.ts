/** LIBS */
import config from "./data/config.json" with { type: "json" };
import { rankElement } from "./rank.ts";
import type { Audit, Config, Snapshot, Verdict } from "./types.ts";

const settings: Config = config;

/** FUNCTIONS */

/**
 * Audit a snapshot: rank every element, then count and score the result.
 *
 * The score is the share of elements that are **stable**, which is the number worth
 * tracking over time. Counting "has some locator" would score every page 100% — every
 * element has a CSS path — and measure nothing.
 *
 * @param snapshot - The page as read by a browser, or loaded from a saved file.
 * @returns The audit, with the ranked elements ordered worst-first.
 */
const auditSnapshot = (snapshot: Snapshot): Audit => {
    const testIdAttribute = settings.testIdAttributes[0] ?? "data-testid";

    const ranked = snapshot.elements
        .map((element) => rankElement(element, testIdAttribute))
        // Worst first: the point of the report is what needs fixing, not what is fine.
        .sort((a, b) => b.tier - a.tier);

    const counts: Record<Verdict, number> = { stable: 0, fragile: 0, unreachable: 0 };

    for (const item of ranked) {
        counts[item.verdict] += 1;
    }

    return {
        url: snapshot.url,
        readAt: snapshot.readAt,
        ranked,
        counts,
        score: ranked.length === 0 ? 100 : Math.round((counts.stable / ranked.length) * 100),
    };
};

/**
 * Validate an unknown value as a snapshot, so a hand-edited or truncated file fails
 * with a clear message instead of a `TypeError` deep in the ranking.
 *
 * @param value - The parsed JSON.
 * @returns The value as a snapshot.
 */
const parseSnapshot = (value: unknown): Snapshot => {
    const shape = value as Partial<Snapshot> | null;

    if (!shape || typeof shape.url !== "string" || !Array.isArray(shape.elements)) {
        throw new Error(
            "That is not a snapshot. Expected an object with `url`, `readAt` and an " +
                "`elements` array."
        );
    }

    shape.elements.forEach((element, index) => {
        if (typeof element?.cssPath !== "string" || typeof element?.tag !== "string") {
            throw new Error(
                `Element ${index} is missing \`tag\` or \`cssPath\`; every element needs both.`
            );
        }
    });

    return {
        url: shape.url,
        readAt: typeof shape.readAt === "string" ? shape.readAt : "",
        elements: shape.elements,
    };
};

/** EXPORTS */
export { auditSnapshot, parseSnapshot };
