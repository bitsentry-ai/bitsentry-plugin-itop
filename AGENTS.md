# iTop plugin

`@bitsentry/plugin-itop` is a BitSentry code plugin for CRUD and lifecycle actions on iTop tickets, requests and CMDB objects over the iTop REST/JSON API. BitSentry loads it through `@bitsentry/plugin-sdk`, so its descriptor and action results are a public contract. The [README](README.md) documents every action and the debug CLI.

## What we never compromise on

- **Writes are labeled honestly.** `list_operations`, `get_object`, `list_objects` and `get_related` are `read`. `create_object`, `update_object`, `apply_stimulus` and `delete_object` are `write`. The build fails if a `create_`, `update_`, `delete_` or `apply_` action is not marked `write`.
- **No surprise mutations.** Deletion targets one numeric id, defaults to `simulate: true`, and needs `simulate: false` plus `confirmDelete: true` to delete. Lifecycle changes go through `apply_stimulus`, not arbitrary status updates. Mutations are never retried automatically, because a timeout can follow a successful write.
- **Public logs reach customers.** Writing to `fields.public_log` can notify the ticket's customer. Treat it as sending a message.
- **Only allowed destinations.** Requests go only to an exact HTTPS installation URL listed in `ITOP_ALLOWED_BASE_URLS`. Redirects are rejected.
- **Credentials and content stay private.** The auth token or username and password come from auth. Never log them or ticket contents.

## The ways to hurt yourself

1. **Writing to a real iTop.** Never run the debug CLI or any action against a real iTop instance unless the developer asks. The debug CLI requires `--confirm-write` for writes on top of action confirmations; never pass it on your own.
2. **Committing credentials.** The debug CLI reads auth from the file named by `BITSENTRY_PLUGIN_AUTH_FILE`. `*.local.json` and `.env*` are gitignored. Never commit an auth file or put credentials in command-line arguments.
3. **Assuming one data model.** iTop installations are customized. Class names, required fields and stimuli vary. Do not hard-code a model beyond the `UserRequest` default.
4. **Breaking the contract.** Renaming an action id, field key or result field breaks saved runbooks and hosts. Add, do not rename.

## Verifying

This repository owns its own dependencies and lockfile, even when checked out inside another workspace. CI runs these on Node 22.12.0 and the latest Node 22:

```sh
pnpm --ignore-workspace install --frozen-lockfile
pnpm --ignore-workspace run build
pnpm --ignore-workspace run typecheck
pnpm --ignore-workspace run lint
pnpm --ignore-workspace run test
pnpm --ignore-workspace run knip
```

- `build` validates the plugin against the SDK schema (unique action and field ids, CRUD coverage, write labels, matching versions) and writes the artifact, `index.yaml`, `descriptor.json` and checksums to `build/`.
- `test` rebuilds, then runs `node --test test/*.test.mjs`. Behavior changes ship with a focused test there. Bug fixes get a failing test first.
- `pnpm --ignore-workspace run debug` lists actions and fields without connecting.

## Pull requests

- Never open a PR unless the developer asks. Branch from the latest `origin/main`.
- Titles and commit subjects are lowercase conventional commits: `fix: require a complete credential set`.
- Body: `## Problem`, `## Change`, `## Tests`.
- Keep `version` in `package.json` and the plugin descriptor equal. The build fails when they differ.
- Do not add `Co-Authored-By` lines or AI attribution footers.

## Where code lives

- `src/plugin.ts`: descriptor, auth, persistence contract, actions and the iTop REST client.
- `scripts/build-artifact.mjs`: SDK validation and artifact build.
- `scripts/debug.mjs`: the standalone debug CLI.
- `test/`: Node test runner tests.

## Taste

- Honor `operation.signal` and `operation.deadlineAt`; requests time out after at most 30 seconds.
- Fail loudly and specifically. API and object failures return `ok: false` with iTop's error code, and a missing object returns 404.
- Comments say why. Plain language in summaries. No em-dashes.
