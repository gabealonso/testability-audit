/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditSnapshot } from "../src/audit.ts";
import { renderJson, renderReport } from "../src/report.ts";
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

const audit = auditSnapshot(
    snapshot([
        element({ testId: "pay", role: "button", name: "Pay now" }),
        element({ text: "Terms", tag: "a" }),
        element({ cssPath: "#root > div > span", tag: "div" }),
    ])
);

/** TEST SUITE */
describe("report - readable output", () => {
    const output = renderReport(audit);

    it("leads with the page and the score", () => {
        assert.match(output, /https:\/\/example\.com\/checkout/);
        assert.match(output, /Score: 33% stable/);
    });

    it("shows the counts", () => {
        assert.match(output, /Stable: 1 · Fragile: 1 · Unreachable: 1/);
    });

    it("lists what automation cannot reach, with the reason", () => {
        assert.match(output, /1 element automation cannot reach/);
        assert.match(output, /No test id, no accessible name, no label, no text/);
    });

    it("shows the locator a test would actually use", () => {
        assert.match(output, /getByTestId\('pay'\)/);
    });

    it("says so when nothing is unreachable", () => {
        const clean = renderReport(auditSnapshot(snapshot([element({ testId: "ok" })])));

        assert.match(clean, /Every element has a locator/);
        assert.doesNotMatch(clean, /cannot reach/);
    });

    it("handles a page with no interactive elements", () => {
        const empty = renderReport(auditSnapshot(snapshot([])));

        assert.match(empty, /No interactive elements were found/);
    });
});

describe("report - JSON output", () => {
    const parsed = JSON.parse(renderJson(audit));

    it("is valid JSON carrying the score and counts", () => {
        assert.equal(parsed.score, 33);
        assert.deepEqual(parsed.counts, { stable: 1, fragile: 1, unreachable: 1 });
    });

    it("keeps one entry per element, worst first", () => {
        assert.equal(parsed.elements.length, 3);
        assert.equal(parsed.elements[0].verdict, "unreachable");
    });

    it("includes the CSS path so a human can find the element on the page", () => {
        assert.equal(parsed.elements[0].cssPath, "#root > div > span");
    });
});
