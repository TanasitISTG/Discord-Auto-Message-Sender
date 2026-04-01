# Repository Guidelines

## Project Structure & Module Organization
This repository is a local-first desktop app built from three main areas:
- `src/` contains the TypeScript sidecar/runtime logic. Core sending lives in `src/core/`, persisted state and support services live in `src/services/`, config parsing lives in `src/config/`, and desktop RPC contracts/runtime live in `src/desktop/`.
- `app/src/` contains the React/Tauri frontend.
- `src-tauri/` contains the Rust desktop shell and native command handlers.

Tests live under `test/` and generally mirror the source areas, for example `test/core/sender.test.ts`, `test/services/session-service.test.ts`, and `test/ui/*.test.tsx`.

## Build, Test, and Development Commands
- `bun run test:core`: run the Node-based sidecar/core test suite.
- `bun run test:ui`: run the Vitest UI suite.
- `bun run test`: run both TypeScript test suites.
- `bun run typecheck`: run TypeScript checks for the sidecar and frontend.
- `bun run build`: build the TypeScript sidecar and the Vite frontend bundle.
- `bun run desktop:dev`: launch the Tauri desktop app in development mode.
- `bun run desktop:build`: build the packaged Tauri desktop app.
- `cargo test --manifest-path src-tauri/Cargo.toml`: run the Rust-side tests.

Run commands from the repository root.

## Coding Style & Naming Conventions
Use TypeScript with `strict` mode, 4-space indentation, semicolons, and single quotes. Keep modules focused and prefer explicit types for persisted state and RPC contracts. Use `camelCase` for values/functions, `PascalCase` for types/interfaces, and descriptive uppercase constants for shared limits and defaults.

Rust code in `src-tauri/` should follow the existing style in the file: small helper functions, explicit error messages, and serde structs that mirror the desktop payloads.

## Testing Guidelines
Core and service tests use Node's built-in `node:test` with `assert/strict`. UI tests use Vitest and Testing Library. When changing sender/session/inbox-monitor logic, add or update tests for resume behavior, rate-limit handling, and lifecycle edge cases. When changing desktop RPC or Rust commands, cover the sidecar or Tauri path that consumes the change.

Before opening a PR, run the narrowest relevant test commands first, then the broader suite that covers your change.

## Commit & Pull Request Guidelines
Keep commits focused and use short imperative subjects that describe the behavior change. For pull requests, include:
- a concise summary of the user-visible or operational impact
- any config, runtime-state, or desktop workflow changes
- the validation commands you ran

Include screenshots only for meaningful frontend or desktop UX changes.

## Security & Configuration Tips
Do not commit real tokens, `.env`, app-data exports, or generated support bundles. Runtime data is stored outside the repo by the desktop app, but local development may still produce `config.json` or state files in temp directories during tests. If you change how tokens, logs, or support bundles are handled, preserve the current behavior that avoids exporting secure token files and document any operator-facing changes in `README.md`.
