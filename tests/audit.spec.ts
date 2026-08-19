/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditSnapshot, parseSnapshot } from "../src/audit.ts";
import type { ElementSnapshot, Snapshot } from "../src/types.ts";

/** FIXTURES */
const element = (over: Partial<ElementSnapshot> = {}): ElementSnapshot => ({
    tag: "button",
    role: null,
    name: null,
    testId: null,
    label: null,
    text: null,
    id: null,
    cssPath: "div > button",
    ...over,
});

const snapshot = (elements: ElementSnapshot[]): Snapshot => ({
    url: "https://example.com/checkout",
    readAt: "2026-08-14T19:00:00.000Z",
    elements,
});

/** TEST SUITE */
describe("audit - counting", () => {
    const result = auditSnapshot(
        snapshot([
            element({ testId: "pay" }),
            element({ role: "button", name: "Cancel" }),
            element({ text: "Terms" }),
            element({ cssPath: "#root > div > span" }),
        ])
    );

    it("counts each verdict", () => {
        assert.deepEqual(result.counts, { stable: 2, fragile: 1, unreachable: 1 });
    });

    it("scores the share that is stable, not the share that has any locator", () => {
        assert.equal(result.score, 50);
    });

    it("orders worst first, because that is what needs fixing", () => {
        assert.deepEqual(
            result.ranked.map((item) => item.verdict),
            ["unreachable", "fragile", "stable", "stable"]
        );
    });

    it("carries the page identity through", () => {
        assert.equal(result.url, "https://example.com/checkout");
        assert.equal(result.readAt, "2026-08-14T19:00:00.000Z");
    });
});

describe("audit - edge cases", () => {
    it("scores an empty page 100 rather than dividing by zero", () => {
        const result = auditSnapshot(snapshot([]));

        assert.equal(result.score, 100);
        assert.deepEqual(result.counts, { stable: 0, fragile: 0, unreachable: 0 });
    });

    it("rounds the score", () => {
        const result = auditSnapshot(
            snapshot([element({ testId: "a" }), element({ text: "b" }), element({ text: "c" })])
        );

        assert.equal(result.score, 33);
    });
});

describe("audit - snapshot validation", () => {
    it("accepts a well-formed snapshot", () => {
        const parsed = parseSnapshot({
            url: "https://example.com",
            readAt: "2026-08-14T19:00:00.000Z",
            elements: [element()],
        });

        assert.equal(parsed.elements.length, 1);
    });

    it("defaults a missing readAt rather than failing on it", () => {
        const parsed = parseSnapshot({ url: "https://example.com", elements: [] });

        assert.equal(parsed.readAt, "");
    });

    it("rejects anything that is not a snapshot", () => {
        assert.throws(() => parseSnapshot(null), /not a snapshot/);
        assert.throws(() => parseSnapshot({ elements: [] }), /not a snapshot/);
        assert.throws(() => parseSnapshot({ url: "https://x" }), /not a snapshot/);
    });

    it("names the element that is missing a required field", () => {
        assert.throws(
            () =>
                parseSnapshot({
                    url: "https://example.com",
                    elements: [element(), { tag: "button" }],
                }),
            /Element 1 is missing/
        );
    });
});
