# ADR-001: Modular Monolith Boundaries

## Status

Accepted

## Context

The repository has grown around a small number of orchestration-heavy files. UI state, desktop transport, domain logic, persistence, and native-shell concerns are currently concentrated in a few hotspots, which increases change risk and makes tests harder to localize.

## Decision

The application remains a modular monolith. The codebase is organized into explicit layers:

- `src/domain`: pure business models and logic
- `src/application`: workflow orchestration over domain primitives
- `src/infrastructure`: filesystem, HTTP, logging sinks, persistence, and external integrations
- `src/desktop`: TypeScript desktop adapter and sidecar transport
- `src-tauri/src`: native desktop shell, command registration, and platform-specific integration
- `app/src/controllers`: frontend orchestration hooks
- `app/src/app-shell`: UI shell composition

Compatibility barrels may exist during migration, but new logic should land in the target layers.

## Consequences

The module boundaries become clearer and large files can be split without changing external behavior. The trade-off is additional module count and more explicit mapping code between domain models and desktop/native DTOs.
