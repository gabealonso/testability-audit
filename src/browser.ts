/** LIBS */
import { chromium } from "playwright";
import config from "./data/config.json" with { type: "json" };
import type { Config, ElementSnapshot, Snapshot } from "./types.ts";

const settings: Config = config;

/** What `readPage` needs beyond the URL. */
export interface ReadOptions {
    /** Path to a Playwright storageState file, for a page behind a login. */
    storageState?: string;
    /** Milliseconds to wait for the page to settle. */
    timeout?: number;
}

/** FUNCTIONS */

/**
 * Read a page's interactive elements into a snapshot.
 *
 * This is the only module that touches a browser, and its only job is
 * `URL -> Snapshot`. It does not rank, score or render — see `rank.ts` for that. It is
 * also strictly read-only: it navigates and reads, and never clicks, types or submits.
 *
 * @param url - The page to read.
 * @param options - Auth state and timeout.
 * @returns The snapshot, ready to audit.
 */
const readPage = async (url: string, options: ReadOptions = {}): Promise<Snapshot> => {
    const browser = await chromium.launch();

    const context = await browser.newContext(
        options.storageState ? { storageState: options.storageState } : {}
    );

    try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeout ?? 30_000 });

        // Give client-rendered pages a moment to paint; "networkidle" hangs on apps that
        // poll, so settle on the load state and a short pause instead.
        await page.waitForLoadState("load", { timeout: options.timeout ?? 30_000 }).catch(() => {});
        await page.waitForTimeout(500);

        const elements = await page.evaluate(readElements, settings.testIdAttributes);

        return { url: page.url(), readAt: new Date().toISOString(), elements };
    } finally {
        await context.close();
        await browser.close();
    }
};

/**
 * Runs **inside the page**, so it cannot import from this project — everything it needs
 * is inlined. It collects the visible interactive elements with the attributes the
 * ranking cares about.
 *
 * Role and accessible name are computed here with a deliberate subset of the ARIA
 * algorithms: implicit roles for the handful of tags that matter, and the name sources
 * that actually occur in practice (`aria-label`, `aria-labelledby`, a associated label,
 * text content, `title`, `alt`, `placeholder`). It is not the full accname spec, and it
 * does not need to be — it needs to agree with what `getByRole` will find.
 *
 * @param testIdAttributes - Attribute names to treat as a test id, best first.
 * @returns One entry per visible interactive element.
 */
const readElements = (testIdAttributes: string[]): ElementSnapshot[] => {
    const SELECTOR = [
        "a[href]",
        "button",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "summary",
        "[contenteditable=true]",
        "[role=button]",
        "[role=link]",
        "[role=checkbox]",
        "[role=radio]",
        "[role=tab]",
        "[role=switch]",
        "[role=menuitem]",
        "[role=combobox]",
        "[role=textbox]",
        '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const IMPLICIT_ROLE: Record<string, string> = {
        a: "link",
        button: "button",
        select: "combobox",
        textarea: "textbox",
        summary: "button",
    };

    const INPUT_ROLE: Record<string, string> = {
        button: "button",
        submit: "button",
        reset: "button",
        image: "button",
        checkbox: "checkbox",
        radio: "radio",
        range: "slider",
        number: "spinbutton",
        search: "searchbox",
        email: "textbox",
        tel: "textbox",
        text: "textbox",
        url: "textbox",
        password: "textbox",
    };

    /**
     * Normalize a string that came out of the page.
     *
     * Page content is untrusted: a name can carry newlines, tabs, or ANSI escapes that
     * would corrupt the report's table, break a locator that gets pasted into a test
     * file, or drive the operator's terminal. Control characters are dropped and runs of
     * whitespace collapse to one space.
     *
     * This also makes the locator *more* correct, not less: Playwright normalizes
     * whitespace when it matches an accessible name, so collapsing here agrees with what
     * `getByRole` will actually do.
     *
     * @param value - The raw string, or null.
     * @returns The cleaned string, or null when nothing is left.
     */
    const clean = (value: string | null | undefined): string | null => {
        if (!value) {
            return null;
        }

        const stripped = value
            .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        return stripped === "" ? null : stripped;
    };

    /** Whether the element takes up space and is not hidden. */
    const isVisible = (el: Element): boolean => {
        const box = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        return (
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            el.getAttribute("aria-hidden") !== "true"
        );
    };

    /** The element's ARIA role: explicit if given, otherwise the implicit one. */
    const roleOf = (el: Element): string | null => {
        const explicit = el.getAttribute("role");

        if (explicit) {
            return explicit.trim().split(/\s+/)[0] ?? null;
        }

        const tag = el.tagName.toLowerCase();

        if (tag === "input") {
            const type = (el.getAttribute("type") ?? "text").toLowerCase();

            return INPUT_ROLE[type] ?? "textbox";
        }

        return IMPLICIT_ROLE[tag] ?? null;
    };

    /** The text of the `<label>` associated with a form control, if any. */
    const labelOf = (el: Element): string | null => {
        const id = el.getAttribute("id");

        if (id) {
            const escaped = typeof CSS !== "undefined" ? CSS.escape(id) : id;
            const forLabel = document.querySelector(`label[for="${escaped}"]`);

            if (forLabel?.textContent?.trim()) {
                return forLabel.textContent.trim();
            }
        }

        const wrapping = el.closest("label");

        return wrapping?.textContent?.trim() || null;
    };

    /**
     * The name an element gets from its own content. Text wins, but when there is none
     * the name still comes from *descendants*: an icon link is `<a><img alt="VS Code">`
     * and its accessible name is "VS Code".
     *
     * Missing this is how an auditor invents false positives — it would flag a
     * perfectly reachable icon link as unreachable — so descendant `alt`,
     * `<svg><title>` and `aria-label` all count.
     */
    const contentName = (el: Element): string | null => {
        const text = el.textContent?.trim();

        if (text) {
            return text;
        }

        const parts: string[] = [];

        el.querySelectorAll("img[alt], svg > title, [aria-label]").forEach((child) => {
            const value =
                child.tagName.toLowerCase() === "title"
                    ? child.textContent?.trim()
                    : (child.getAttribute("alt")?.trim() ?? child.getAttribute("aria-label")?.trim());

            if (value) {
                parts.push(value);
            }
        });

        return parts.join(" ") || null;
    };

    /** The accessible name, from the sources that occur in practice. */
    const nameOf = (el: Element, label: string | null): string | null => {
        const aria = el.getAttribute("aria-label")?.trim();

        if (aria) {
            return aria;
        }

        const labelledBy = el.getAttribute("aria-labelledby");

        if (labelledBy) {
            const named = labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                .filter((text) => text !== "")
                .join(" ");

            if (named) {
                return named;
            }
        }

        if (label) {
            return label;
        }

        const content = contentName(el);

        if (content) {
            return content;
        }

        return (
            el.getAttribute("title")?.trim() ||
            el.getAttribute("alt")?.trim() ||
            el.getAttribute("placeholder")?.trim() ||
            el.getAttribute("value")?.trim() ||
            null
        );
    };

    /** A short CSS path, so a human can find the element even when nothing else works. */
    const pathOf = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;

        while (node && parts.length < 4 && node.tagName.toLowerCase() !== "html") {
            const tag = node.tagName.toLowerCase();
            const parent: Element | null = node.parentElement;

            if (!parent) {
                parts.unshift(tag);
                break;
            }

            const siblings = [...parent.children].filter((c) => c.tagName === node?.tagName);
            const index = siblings.indexOf(node) + 1;

            parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
            node = parent;
        }

        return parts.join(" > ");
    };

    return [...document.querySelectorAll(SELECTOR)].filter(isVisible).map((el) => {
        const label = clean(labelOf(el));
        let testId: string | null = null;

        for (const attribute of testIdAttributes) {
            const value = clean(el.getAttribute(attribute));

            if (value) {
                testId = value;
                break;
            }
        }

        const text = clean(el.textContent);

        // Every string below goes through `clean`, because all of them come from the
        // page and all of them end up either in a locator or in the report.
        return {
            tag: el.tagName.toLowerCase(),
            role: clean(roleOf(el)),
            name: clean(nameOf(el, label)),
            testId,
            label,
            // Long blocks of text are not a locator; keep the field honest.
            text: text && text.length <= 80 ? text : null,
            id: clean(el.getAttribute("id")),
            cssPath: pathOf(el),
        };
    });
};

/** EXPORTS */
export { readPage, readElements };
