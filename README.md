# test

A Suwatte source list for testing Toonkotsu.

## Add it to Suwatte

Open **Settings → Sources → Manage Sources** and add:

```
https://poppingmangosources.github.io/test/
```

## Develop

```bash
pnpm install
pnpm build    # bundles src/sources into dist/
pnpm serve    # serves the list on your local network
pnpm test     # offline checks, then a live catalogue request
```

Raise `version` in `src/sources/toonkotsu/info.ts` on every push that changes the source.
