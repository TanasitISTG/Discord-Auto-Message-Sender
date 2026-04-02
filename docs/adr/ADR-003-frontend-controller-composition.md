# ADR-003: Frontend Controller Composition

## Status
Accepted

## Context
The desktop controller hook had accumulated bootstrap, event handling, confirmation flow, notices, session commands, support commands, and diagnostics utilities in a single file. That made screen-level work depend on a god-hook.

## Decision
Frontend orchestration moves into `app/src/controllers/desktop/` and is composed from smaller hooks:

- bootstrap and refresh
- desktop event subscription
- surface notices
- confirmation flow
- config actions
- session actions
- support actions

`use-desktop-controller.ts` becomes a composition root only.

## Consequences
Behavior remains stable while the controller becomes easier to test and reason about in slices. The trade-off is more explicit state plumbing between hooks.
