# Changelog

## 1.0.0-beta

- Added a new `Support` screen with release diagnostics, data-path visibility, and public-beta guidance.
- Added safe support-bundle export that excludes the secure token store, `.env`, and plaintext tokens.
- Added `Reset Runtime State` to clear local state and session logs without deleting config or the secure token.
- Added direct `Open Logs Folder` and `Open Data Folder` actions from the desktop UI.
- Surfaced the packaged app version in the shell and added release diagnostics as a first-class support feature.
- Added version-alignment and release-check scripts so Windows beta builds can be verified before shipping.
