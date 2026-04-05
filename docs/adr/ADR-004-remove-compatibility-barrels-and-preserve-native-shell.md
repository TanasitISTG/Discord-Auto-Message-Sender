# ADR-004: Remove Compatibility Barrels and Preserve the Native Shell Boundary

## Status

Accepted

## Context

The repository previously kept `src/services/*` and `src/core/*` as temporary compatibility barrels while the modular monolith was taking shape. Those files no longer add value, and they obscure the owning layer for application, domain, infrastructure, and desktop runtime code.

The repository also uses a Tauri shell plus a TypeScript sidecar runtime. Some responsibilities are inherently native or security-sensitive and should remain in Rust.

## Decision

- Remove the `src/services/*` and `src/core/*` compatibility barrels.
- Import directly from the owning module in `src/domain`, `src/application`, `src/infrastructure`, or `src/desktop`.
- Keep `src-tauri/src` focused on native desktop concerns only: secure token storage, runtime path resolution, notifications, support bundle export, file-manager integration, command routing, and sidecar lifecycle management.
- Do not add new Rust modules for logic that can live safely in the shared TypeScript runtime. New Rust code requires a native, security-sensitive, or Tauri-specific justification.

## Consequences

The codebase becomes easier to navigate because module ownership is explicit at the import site. Tests can also mirror the same architecture directly.

The trade-off is that imports become slightly more specific, and any future layer migrations must be performed directly instead of being hidden behind long-lived aliases.
