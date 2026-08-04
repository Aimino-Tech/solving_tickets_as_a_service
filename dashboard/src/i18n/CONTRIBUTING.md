# i18n Contributing Guide

## Adding a new language

1. Create `locales/<lang>.json` with the same keys as `en.json`.
2. Add the language to the `Locale` type and `messages` map in `i18n.ts`.
3. Add a toggle option in the locale switcher (Layout sidebar).

## Adding new translation keys

1. Use `t('namespace.key')` in your component.
2. Run `bash src/i18n/scripts/extract-strings.sh` to verify the key appears in code.
3. Add the key to **all** locale JSON files.

## Key naming convention

- `nav.*` — sidebar navigation labels
- `dashboard.*` — dashboard page strings
- `runs.*` — runs history page
- `common.*` — shared UI strings (loading, error, save, cancel)
- `auth.*` — authentication strings

## Interpolation

Use `{{param}}` placeholders:

```ts
t('dashboard.noRuns', { label: 'syntaro:fix' })
// "No runs yet. Label an issue with syntaro:fix to get started."
```

## Testing

- Switch locales via the sidebar switcher.
- Verify strings render correctly for both `en` and `de`.
- Run the extraction script to catch missing keys.
