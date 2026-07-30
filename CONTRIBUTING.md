# Contributing

Thank you for helping improve Onyx Launcher.

## Before opening a pull request

1. Create a focused branch from the current default branch.
2. Install locked dependencies with `npm ci`.
3. Keep source code, UI copy, tests, documentation, and screenshots in English.
4. Run the full verification suite:

```bash
npm run check
```

5. Regenerate screenshots with `npm run capture:screenshots` when a visible interface change affects the README gallery.

## Pull requests

Describe the problem, the implementation, and how the change was verified. Include before-and-after screenshots for visual changes. Keep unrelated refactors out of the same pull request.

Do not edit the package version for a normal contribution. A successful push to `main` or `master` automatically increments the patch version, creates a tag, builds packages, and publishes a GitHub Release.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow the private reporting guidance in [SECURITY.md](SECURITY.md).