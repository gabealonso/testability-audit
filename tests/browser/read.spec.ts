/** LIBS */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { readElements } from "../../src/browser.ts";
import type { ElementSnapshot } from "../../src/types.ts";

/**
 * These tests drive a real browser, because `readElements` runs inside the page and
 * depends on the DOM and on computed styles — there is nothing to stub that would still
 * be telling the truth. They are kept out of `tests/` so `npm test` stays offline; run
 * them with `npm run test:browser`.
 */

/** FIXTURES */
const TEST_ID_ATTRIBUTES = ["data-testid", "data-test", "data-cy"];

let browser: Browser;
let page: Page;

/**
 * Read a fragment of HTML the way the auditor would read a page.
 *
 * @param html - The body markup to load.
 * @returns The elements found, in document order.
 */
const read = async (html: string): Promise<ElementSnapshot[]> => {
    await page.setContent(html);

    return page.evaluate(readElements, TEST_ID_ATTRIBUTES);
};

before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
});

after(async () => {
    await browser?.close();
});

/** TEST SUITE */
describe("browser - accessible name from descendants", () => {
    it("takes an icon link's name from its img alt", async () => {
        // The regression that matters: this used to be reported as unreachable, which is
        // the worst thing an auditor can do — tell a team to fix something that is fine.
        const [element] = await read('<a href="/x"><img src="a.png" alt="VS Code"></a>');

        assert.equal(element?.role, "link");
        assert.equal(element?.name, "VS Code");
    });

    it("takes an icon button's name from an svg title", async () => {
        const [element] = await read(
            '<button><svg width="10" height="10"><title>Close</title></svg></button>'
        );

        assert.equal(element?.name, "Close");
    });

    it("takes a name from a descendant aria-label", async () => {
        const [element] = await read('<button><span aria-label="Menu"></span></button>');

        assert.equal(element?.name, "Menu");
    });

    it("prefers the element's own aria-label over its content", async () => {
        const [element] = await read('<button aria-label="Save changes">OK</button>');

        assert.equal(element?.name, "Save changes");
    });

    it("resolves aria-labelledby", async () => {
        const [element] = await read(
            '<span id="lbl">Delete account</span><button aria-labelledby="lbl"></button>'
        );

        assert.equal(element?.name, "Delete account");
    });
});

describe("browser - roles", () => {
    it("gives implicit roles to the tags that matter", async () => {
        const elements = await read(
            '<a href="/a">A</a><button>B</button><select><option>C</option></select>' +
                "<textarea></textarea>"
        );

        assert.deepEqual(
            elements.map((element) => element.role),
            ["link", "button", "combobox", "textbox"]
        );
    });

    it("maps input types to their roles", async () => {
        const elements = await read(
            '<input type="text"><input type="checkbox"><input type="radio">' +
                '<input type="submit" value="Go">'
        );

        assert.deepEqual(
            elements.map((element) => element.role),
            ["textbox", "checkbox", "radio", "button"]
        );
    });

    it("lets an explicit role win", async () => {
        const [element] = await read('<div role="button" tabindex="0">Click</div>');

        assert.equal(element?.role, "button");
    });
});

describe("browser - fields", () => {
    it("reads a test id from any configured attribute", async () => {
        const elements = await read(
            '<button data-testid="a">A</button><button data-test="b">B</button>' +
                '<button data-cy="c">C</button>'
        );

        assert.deepEqual(
            elements.map((element) => element.testId),
            ["a", "b", "c"]
        );
    });

    it("associates a label by for and by wrapping", async () => {
        const elements = await read(
            `<label for="e">Email</label><input id="e">
             <label>Phone<input id="p"></label>`
        );

        assert.equal(elements[0]?.label, "Email");
        assert.equal(elements[1]?.label, "Phone");
    });

    it("drops text too long to be a locator", async () => {
        const [element] = await read(`<button>${"x".repeat(200)}</button>`);

        assert.equal(element?.text, null);
    });

    it("always produces a css path", async () => {
        const [element] = await read("<div><span><button></button></span></div>");

        assert.match(element?.cssPath ?? "", /button$/);
    });
});

describe("browser - what is skipped", () => {
    it("ignores hidden and zero-size elements", async () => {
        const elements = await read(
            '<button style="display:none">A</button>' +
                '<button style="visibility:hidden">B</button>' +
                '<button aria-hidden="true">C</button>' +
                "<button>D</button>"
        );

        assert.equal(elements.length, 1);
        assert.equal(elements[0]?.name, "D");
    });

    it("ignores non-interactive markup", async () => {
        const elements = await read("<p>Just text</p><div>And a div</div>");

        assert.equal(elements.length, 0);
    });

    it("ignores an anchor with no href", async () => {
        const elements = await read("<a>Not a link</a>");

        assert.equal(elements.length, 0);
    });
});
