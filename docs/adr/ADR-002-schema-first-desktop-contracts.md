# ADR-002: Schema-First Desktop Contracts

## Status

Accepted

## Context

Desktop request/response/event payloads were previously handwritten in multiple places and partially coupled to the domain type barrel. That duplication creates drift risk across the frontend, TypeScript sidecar, and Rust shell.

## Decision

Desktop contracts are defined under `contracts/desktop/*.schema.json` and generated into `src/desktop/contracts.ts`.

Rust contract structs live in `src-tauri/src/contracts.rs` and must map directly to the schema-owned TypeScript contracts. The TypeScript desktop contract file no longer re-exports raw domain types from `src/types.ts`.

## Consequences

Contract changes now start from explicit schema files, making drift easier to detect and review. The trade-off is a generation step and some intentional duplication between DTOs and domain models.
