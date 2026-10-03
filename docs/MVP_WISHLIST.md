# Post-MVP wishlist

These are optional follow-ups, not MVP acceptance criteria. They must not delay or replace any unchecked requirement in [`MVP_REQUIREMENTS.md`](./MVP_REQUIREMENTS.md).

1. **Remove or rotate a saved provider key.** Settings allows entering a new key to replace the stored one, but has no explicit removal action or guided rotation/check of the old credential. Add a clear revoke-from-local-vault flow and confirmation so users can retire credentials without guessing whether a blank field clears them.
2. **External file-change conflict handling.** When files are edited outside the app while open, detect the changed paths and offer a deliberate reload/compare/keep choice. This would reduce accidental overwrites in a local-file workflow.
3. **Recoverable deletion for project files.** Add an optional app-managed trash/restore window for deleted project files and folders, preserving path and contents. This is useful recovery beyond the MVP’s required confirmation and destructive-edit protection.
4. **Multiple ChatGPT sign-in profiles.** The current OAuth integration stores one active registration; connecting another account removes the current one. If keeping several accounts available matters, add separately stored registrations and an explicit account picker.

No implementation, external market claim, or new MVP acceptance obligation is implied by this list.
