#!/usr/bin/env node
/** LIBS */
import { readFile, writeFile } from "node:fs/promises";
import { auditSnapshot, parseSnapshot } from "./audit.ts";
import { readPage } from "./browser.ts";
import { renderJson, renderReport } from "./report.ts";

const HELP = `
testability-audit — rank a page's interactive elements by locator stability.

Usage
  testability-audit <url>            read the page and audit it
  testability-audit <snapshot.json>  audit a saved snapshot (no browser needed)

Options
      --json                 Print the JSON report instead of the readable one
      --max-unreachable N    Exit 1 when more than N elements cannot be reached
      --save-snapshot <path> Save what was read, so it can be re-audited offline
      --storage-state <path> Playwright storageState file, for a page behind a login
  -h, --help                 Show this help

Reading a page is strictly read-only: it navigates and reads, never clicks or submits.

Exit codes
  0  audit ran (and stayed within --max-unreachable, when given)
  1  the limit was exceeded, or the page/snapshot could not be read
`;

/** FUNCTIONS */

/**
 * Read the value that follows a flag, failing when it is missing.
 *
 * @param argv - The full argument list.
 * @param index - Index of the value to read.
 * @param flag - The flag being read, used in the error message.
 * @returns The flag value.
 */
const readValue = (argv: string[], index: number, flag: string): string => {
    const value = argv[index];

    if (value === undefined || value.startsWith("-")) {
        throw new Error(`The option ${flag} needs a value.`);
    }

    return value;
};

/**
 * Parse the command-line arguments.
 *
 * @param argv - Arguments as received from `process.argv.slice(2)`.
 * @returns The snapshot path and the options.
 */
const parseArgs = (
    argv: string[]
): {
    target: string;
    json: boolean;
    help: boolean;
    maxUnreachable: number | null;
    saveSnapshot: string | null;
    storageState: string | null;
} => {
    let target = "";
    let json = false;
    let help = false;
    let maxUnreachable: number | null = null;
    let saveSnapshot: string | null = null;
    let storageState: string | null = null;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === undefined) {
            continue;
        }

        switch (arg) {
            case "-h":
            case "--help":
                help = true;
                break;
            case "--json":
                json = true;
                break;
            case "--max-unreachable": {
                index += 1;
                const raw = readValue(argv, index, arg);
                const parsed = Number(raw);

                if (!Number.isInteger(parsed) || parsed < 0) {
                    throw new Error(`--max-unreachable needs a whole number, got "${raw}".`);
                }

                maxUnreachable = parsed;
                break;
            }
            case "--save-snapshot":
                index += 1;
                saveSnapshot = readValue(argv, index, arg);
                break;
            case "--storage-state":
                index += 1;
                storageState = readValue(argv, index, arg);
                break;
            default:
                if (arg.startsWith("-")) {
                    throw new Error(`Unknown option "${arg}". Run with --help.`);
                }

                target = arg;
        }
    }

    return { target, json, help, maxUnreachable, saveSnapshot, storageState };
};

/**
 * Entry point: read a snapshot, audit it, print the report, and set the exit code.
 */
const main = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || args.target === "") {
        console.log(HELP);
        return;
    }

    const isUrl = /^https?:\/\//i.test(args.target);

    const snapshot = isUrl
        ? await readPage(args.target, {
              ...(args.storageState ? { storageState: args.storageState } : {}),
          })
        : parseSnapshot(JSON.parse(await readFile(args.target, "utf8")));

    if (args.saveSnapshot) {
        await writeFile(args.saveSnapshot, `${JSON.stringify(snapshot, null, 4)}\n`);
        console.log(`Snapshot saved to ${args.saveSnapshot}`);
    }

    const audit = auditSnapshot(snapshot);

    console.log(args.json ? renderJson(audit) : renderReport(audit));

    if (args.maxUnreachable !== null && audit.counts.unreachable > args.maxUnreachable) {
        console.error(
            `${audit.counts.unreachable} unreachable elements exceeds the limit of ` +
                `${args.maxUnreachable}.`
        );
        process.exitCode = 1;
    }
};

await main().catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
