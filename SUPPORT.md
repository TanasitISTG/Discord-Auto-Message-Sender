# Support

## Before You Report A Bug

Collect the support bundle from the packaged app:

1. Open `Support`.
2. Reproduce the issue if you can do so safely.
3. Click `Export Support Bundle`.
4. Attach the exported ZIP to the bug report.

## What To Include In A Bug Report

- What screen you were on
- What you clicked or changed
- What you expected to happen
- What actually happened
- Whether the problem happened once or repeatedly
- The exported support ZIP

## What The Support Bundle Includes

When available, the support export contains:

- `diagnostics.json`
- `setup.json`
- `config.json`
- `.sender-state.json`
- the latest 5 session log files

## What The Support Bundle Excludes

The support export does not include:

- `discord-token.secure`
- `.env`
- plaintext Discord tokens
- process environment dumps

## Reset Runtime State Safely

Use `Support -> Reset Runtime State` if local summaries, checkpoints, or logs need to be cleared.

This removes:

- `.sender-state.json`
- `logs/*.jsonl`

This keeps:

- `config.json`
- `discord-token.secure`
- `.env`
- support bundle ZIP files

The reset action is blocked while a session is active. Stop the session first.

## Public Beta Boundaries

- Windows only
- Unsigned build
- Manual MSI updates only
- No auto-update
- No cloud support backend or remote telemetry
