/** LIBS */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksGenerated, quote, rankElement } from "../src/rank.ts";
import type { ElementSnapshot } from "../src/types.ts";

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

/** TEST SUITE */
describe("rank - the ladder", () => {
    it("prefers a test id above everything else", () => {
        const ranked = rankElement(
            element({ testId: "submit", role: "button", name: "Send", label: "Send", id: "send" })
        );

        assert.equal(ranked.tier, 1);
        assert.equal(ranked.strategy, "test-id");
        assert.equal(ranked.verdict, "stable");
        assert.equal(ranked.locator, "getByTestId('submit')");
    });

    it("falls to role plus accessible name", () => {
        const ranked = rankElement(element({ role: "button", name: "Sign in", id: "signin" }));

        assert.equal(ranked.tier, 2);
        assert.equal(ranked.locator, "getByRole('button', { name: 'Sign in' })");
        assert.equal(ranked.verdict, "stable");
    });

    it("needs both role and name to use them", () => {
        assert.equal(rankElement(element({ role: "button", text: "Go" })).strategy, "text");
        assert.equal(rankElement(element({ name: "Go", text: "Go" })).strategy, "text");
    });

    it("falls to a label", () => {
        const ranked = rankElement(element({ tag: "input", label: "Password" }));

        assert.equal(ranked.tier, 3);
        assert.equal(ranked.locator, "getByLabel('Password')");
        assert.equal(ranked.verdict, "stable");
    });

    it("accepts a hand-written id, but calls it fragile", () => {
        const ranked = rankElement(element({ id: "login-button" }));

        assert.equal(ranked.tier, 4);
        assert.equal(ranked.locator, "locator('#login-button')");
        assert.equal(ranked.verdict, "fragile");
    });

    it("falls to text, and warns about translations", () => {
        const ranked = rankElement(element({ text: "Forgot password?" }));

        assert.equal(ranked.tier, 5);
        assert.equal(ranked.locator, "getByText('Forgot password?')");
        assert.equal(ranked.verdict, "fragile");
        assert.match(ranked.reason, /translation/);
    });

    it("calls an element with nothing but a CSS path unreachable", () => {
        const ranked = rankElement(element({ cssPath: "#root > div > div:nth-child(4)" }));

        assert.equal(ranked.tier, 6);
        assert.equal(ranked.strategy, "css");
        assert.equal(ranked.verdict, "unreachable");
        assert.equal(ranked.locator, "locator('#root > div > div:nth-child(4)')");
    });

    it("says so when the only id was generated", () => {
        const ranked = rankElement(element({ id: "mui-4821" }));

        assert.equal(ranked.verdict, "unreachable");
        assert.match(ranked.reason, /generated id \(mui-4821\)/);
    });
});

describe("rank - generated ids", () => {
    it("rejects framework-minted ids", () => {
        assert.ok(looksGenerated("mui-4821"));
        assert.ok(looksGenerated(":r1:"));
        assert.ok(looksGenerated("ember1234"));
        assert.ok(looksGenerated("a3f9c1e8b7d2"));
        assert.ok(looksGenerated("123"));
        assert.ok(looksGenerated("field_456_input"));
    });

    it("accepts ids a person would write", () => {
        assert.equal(looksGenerated("login-button"), false);
        assert.equal(looksGenerated("user-name"), false);
        assert.equal(looksGenerated("checkout_form"), false);
        assert.equal(looksGenerated("step2"), false);
    });
});

describe("rank - quoting", () => {
    it("escapes quotes and backslashes so the locator stays valid", () => {
        assert.equal(quote("O'Brien"), "'O\\'Brien'");
        assert.equal(quote("back\\slash"), "'back\\\\slash'");
    });

    it("quotes a name containing an apostrophe inside a role locator", () => {
        const ranked = rankElement(element({ role: "link", name: "Gabe's profile" }));

        assert.equal(ranked.locator, "getByRole('link', { name: 'Gabe\\'s profile' })");
    });

    it("quotes an id too — these locators get pasted into real code", () => {
        const ranked = rankElement(element({ id: "user's-field" }));

        assert.equal(ranked.locator, "locator('#user\\'s-field')");
    });

    it("drops control characters that would break a pasted locator", () => {
        assert.equal(quote("line1\nline2"), "'line1 line2'");
        assert.equal(quote("tab\there"), "'tab here'");
    });

    it("leaves no escape sequence able to reach the terminal", () => {
        const quoted = quote("\u001b[31mred\u001b[0m");

        assert.doesNotMatch(quoted, /[\u0000-\u001f\u007f-\u009f]/);
    });

    it("cannot be escaped out of by a hostile name", () => {
        const ranked = rankElement(element({ role: "button", name: "a'); process.exit(1); //" }));

        // The apostrophe is escaped, so the payload stays a string literal.
        assert.match(ranked.locator, /name: 'a\\'\); process\.exit\(1\); \/\/'/);
        // And nothing after the payload can start a new expression.
        assert.ok(ranked.locator.endsWith("' })"));
    });
});
