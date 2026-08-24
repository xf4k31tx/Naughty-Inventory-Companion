# Contributing to Naughty Inventory Companion

Thanks for helping improve a local, privacy-conscious Torn inventory companion for Tampermonkey and TornPDA.

## Before you start

- Search existing issues before opening a new one.
- Use the bug or feature issue form so maintainers can reproduce and evaluate the change.
- Keep a contribution focused on one user-facing problem. Discuss broad redesigns or new API use in an issue before writing code.

## Security and privacy

Never commit or post Torn API keys, request URLs containing keys, real backups, inventory exports, private account data, or screenshots that expose them. Use redacted examples and synthetic data in issues, pull requests, and tests. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Development workflow

1. Fork the repository and create a focused branch.
2. Make the smallest practical change. Preserve the userscript's local-only data handling and TornPDA/Tampermonkey compatibility.
3. Run the checks from the repository root:

   ```powershell
   node --check "Naughty Inventory Companion.user.js"
   node --test inventory-regression.test.js
   node --test storage-adapter.test.js
   ```

4. If the change affects layout, verify a normal desktop viewport and a narrow/portrait viewport. If it affects native behavior, also verify TornPDA where available.
5. Update the README when installation, data handling, compatibility, or visible behavior changes.

## Pull requests

Describe the user problem, the solution, and the checks you ran. Include redacted screenshots for UI changes. Avoid unrelated formatting churn, generated files, and API-key-bearing fixtures. Contributions must follow the [Code of Conduct](CODE_OF_CONDUCT.md) and are licensed under the repository's [MIT License](LICENSE).
