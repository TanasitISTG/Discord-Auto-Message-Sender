# Repository Guidelines

## Project Structure & Module Organization

This repository is a local-first desktop app organized as a modular monolith:

- `app/src/app-shell/`, `app/src/controllers/`, and `app/src/features/` contain the React/Tauri shell, desktop controller hooks, and screen-level UI modules.
- `src/domain/` contains pure business logic and types.
- `src/application/` contains orchestration flows such as session, preflight, dry-run, and inbox-monitor services.
- `src/infrastructure/` contains persistence, logging sinks, HTTP transport, templates, and other external integrations.
- `src/desktop/` contains the TypeScript desktop transport/runtime layer plus generated desktop contracts.
- `src-tauri/src/commands/` and sibling Rust modules contain the native desktop shell, runtime paths, secure token storage, support bundle export, sidecar lifecycle, and command wiring.
- `contracts/desktop/*.schema.json` are the source of truth for desktop payloads and generate `src/desktop/contracts.ts` and `src-tauri/src/contracts.rs`.

`src/services/*` and `src/core/*` remain as compatibility barrels for migrated modules. Do not add new logic there unless the task is explicitly about maintaining a compatibility surface.

Tests live under `test/` and mirror the current layers and flows, for example `test/desktop/runtime-session.test.ts`, `test/scripts/desktop-contracts.test.ts`, `test/services/session-service.test.ts`, and `test/ui/session-flow.test.tsx`.

## Build, Test, and Development Commands

- `bun run lint`: run ESLint plus the repo architecture checks.
- `bun run lint:eslint`: run ESLint across the repo-owned JS/TS files.
- `bun run lint:architecture`: run the boundary and file-size checks.
- `bun run format`: run Prettier for web/config/docs files and `cargo fmt` for Rust.
- `bun run format:check`: check formatting without rewriting files.
- `bun run contracts:generate`: regenerate TypeScript and Rust desktop contracts from `contracts/desktop/*.schema.json`.
- `bun run contracts:check`: verify generated desktop contracts are up to date.
- `bun run test:core`: run the Node-based sidecar/core test suite.
- `bun run test:ui`: run the Vitest UI suite.
- `bun run test`: run both TypeScript test suites.
- `bun run typecheck`: run TypeScript checks for the sidecar and frontend.
- `bun run build`: build the TypeScript sidecar and the Vite frontend bundle.
- `bun run build:sidecar`: build the packaged desktop sidecar binary resource.
- `bun run desktop:dev`: launch the Tauri desktop app in development mode.
- `bun run desktop:build`: build the packaged Tauri desktop app.
- `bun run smoke:desktop`: boot the packaged app in an isolated profile and verify the release smoke path.
- `bun run release:check`: run the full release-quality chain, including lint, formatting, contracts, tests, Rust tests, packaging, smoke, and version alignment.
- `cargo test --manifest-path src-tauri/Cargo.toml`: run the Rust-side tests.

Run commands from the repository root.

## Coding Style & Naming Conventions

Use TypeScript with `strict` mode, 4-space indentation, semicolons, and single quotes. Keep modules focused and prefer explicit types for persisted state and RPC contracts. Use `camelCase` for values/functions, `PascalCase` for types/interfaces, and descriptive uppercase constants for shared limits and defaults.

JS/TS formatting is enforced with Prettier 3 and linting is enforced with ESLint 9 flat config. Architecture boundaries and file-size budgets are enforced by `bun run lint:architecture`.

Generated desktop TypeScript contracts in `src/desktop/contracts.ts` are excluded from formatter/linter rewrites and stay generator-owned. If you change `contracts/desktop/*.schema.json`, regenerate contracts instead of editing the generated outputs manually.

Rust code in `src-tauri/` should follow the existing style in the file: small helper functions, explicit error messages, and serde structs that mirror the desktop payloads.

Rust formatting is enforced with `cargo fmt --manifest-path src-tauri/Cargo.toml --all`. Generated Rust contracts in `src-tauri/src/contracts.rs` stay generator-owned but must remain `rustfmt`-stable.

## Testing Guidelines

Core and service tests use Node's built-in `node:test` with `assert/strict`. UI tests use Vitest and Testing Library. When changing sender/session/inbox-monitor logic, add or update tests for resume behavior, rate-limit handling, and lifecycle edge cases. When changing desktop RPC, schema files, or Rust commands, cover the sidecar or Tauri path that consumes the change and keep `test/scripts/desktop-contracts.test.ts` green.

Before opening a PR, run the narrowest relevant test commands first, then the broader suite that covers your change.

For broad repo changes or release-sensitive work, prefer `bun run release:check` before handoff.

## Commit & Pull Request Guidelines

Keep commits focused and use short imperative subjects that describe the behavior change. For pull requests, include:

- a concise summary of the user-visible or operational impact
- any config, runtime-state, or desktop workflow changes
- the validation commands you ran

Include screenshots only for meaningful frontend or desktop UX changes.

## Security & Configuration Tips

Do not commit real tokens, `.env`, app-data exports, or generated support bundles. Runtime data is stored outside the repo by the desktop app, but local development may still produce `config.json` or state files in temp directories during tests. If you change how tokens, logs, or support bundles are handled, preserve the current behavior that avoids exporting secure token files and document any operator-facing changes in `README.md`.
