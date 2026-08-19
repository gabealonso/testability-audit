#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit) hook.
# When a TypeScript file is edited, run the project's typecheck so type errors
# surface immediately. On failure it exits with code 2, feeding the errors back
# to Claude.
set -uo pipefail

input=$(cat)

if command -v jq >/dev/null 2>&1; then
    file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // ""')
else
    file=$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
fi

# Only act on TypeScript files; ignore everything else.
case "$file" in
    *.ts) ;;
    *) exit 0 ;;
esac

out=$(npm --silent run typecheck 2>&1) || {
    echo "TypeScript typecheck failed after editing $file:" >&2
    echo "$out" >&2
    exit 2
}

exit 0
