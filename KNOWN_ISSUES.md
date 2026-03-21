# Known Issues

## Public Beta Limits

- Windows only. Other platforms are not packaged or supported in this beta.
- The installer is unsigned, so Windows may show trust or reputation warnings during install or first launch.
- Updates are manual. Install the newer MSI over the existing version.
- Downgrades are not supported.

## Operational Limitations

- Discord account automation can trigger rate limits, access restrictions, or account termination.
- Secure token storage is implemented for packaged Windows builds. Development flows can still rely on environment fallback.
- If the desktop runtime restarts during a session, the app surfaces the interruption and may offer resume/discard checkpoint recovery instead of silently continuing.
- Support exports intentionally exclude secrets, so they may not contain every environment-specific detail needed for debugging token issues.

## Support Expectations

- Use the in-app `Support` screen before reporting a bug.
- Attach the exported support ZIP instead of copying files manually from app-data.
