# iTop plugin

CRUD and lifecycle actions for iTop tickets, requests, and CMDB objects. Runs
through the BitSentry SDK in Desktop or Dashboard, or the standalone debug CLI.

## Build and SDK contract

Requires Node.js 22.12+ and pnpm 10.32.1. This repository owns its dependencies
and `pnpm-lock.yaml`, including when checked out under Desktop CE.

```sh
pnpm --ignore-workspace install --frozen-lockfile
pnpm --ignore-workspace run build
pnpm --ignore-workspace run typecheck
pnpm --ignore-workspace run lint
```

The build validates the plugin against the published SDK schema, checks unique
action/field IDs, CRUD coverage, write labels, and matching versions. It produces
`build/itop.plugin.js`, `build/index.yaml`, `build/descriptor.json`, and
`build/checksums.sha256`. CI uploads that directory as the `plugin` artifact.

The SDK contract is `actions[]` with declared fields, `riskLevel`, and `execute`.
Both plugins use `create_*`, `get_*`, `update_*`, and `delete_*` action IDs
for CRUD, plus list/search and provider-specific actions. The SDK does not
require every integration to expose CRUD methods. Host results use
`pluginId`, `actionId`, `ok`, `status`, `summary`, and optional `data`. Provider
payloads stay inside `data`. No SDK change is required. A type-only compatibility
declaration accepts optional cancellation/deadlines from newer hosts while
remaining compatible with the published SDK 0.1.0.

## Install in BitSentry

```sh
bitsentry plugin install itop --index-url /absolute/path/to/this-repository/build/index.yaml
bitsentry plugin info itop --json
```

Desktop CE's build orchestrates an isolated frozen install/build for this
submodule; it does not add these dependencies to CE's lockfile. The combined
Desktop artifact index remains at `apps/desktop-ce/build/plugins/index.yaml`.
Dashboard can use that index via `BITSENTRY_PLUGIN_INDEX_URL`; include `itop`
in an explicitly configured `BITSENTRY_CLOUD_PLUGIN_ALLOWLIST`.
Desktop and Dashboard resolve their own credentials. No Prisma migration is
needed to install or execute this plugin. Dashboard webhook receivers are a
separate backend feature. Building does not update the public plugin catalog.

## Debug without the Desktop app

After building, list action IDs, fields, and defaults without connecting:

```sh
pnpm --ignore-workspace run debug
```

Create a credentials file named `auth.local.json`, restrict its permissions, and
set `BITSENTRY_PLUGIN_AUTH_FILE` to its absolute path. `*.local.json` and `.env*`
are ignored by Git. Never commit real credentials. The debug command reads auth
from the file; it does not put credentials in command-line arguments.

Auth file shape:

```json
{"baseUrl":"https://itop.example.com/itop","authToken":"YOUR_TOKEN"}
```

Alternatively use `username` and `password`; a supplied token takes precedence.
Set `ITOP_ALLOWED_BASE_URLS` on the invoking host to the exact HTTPS installation
URL (comma-separated for multiple allowed instances). Redirects are rejected.

```sh
export ITOP_ALLOWED_BASE_URLS=https://itop.example.com/itop
export BITSENTRY_PLUGIN_AUTH_FILE=/absolute/path/to/auth.local.json
pnpm --ignore-workspace run debug --action list_operations --show-data
pnpm --ignore-workspace run debug --action get_object --input read.local.json --show-data
```

Example `read.local.json`: `{"class":"UserRequest","id":123,"outputFields":"id,ref,title,status"}`.
Use `--show-data` to include provider results; otherwise output contains only the
SDK summary/status. Results may contain internal ticket content. Writes require
`--confirm-write` in this debug CLI, in addition to action-specific confirmations.

## Actions

| Action | Main inputs | Risk |
| --- | --- | --- |
| `list_operations` | none | read |
| `get_object` | `class`, numeric `id`, optional `outputFields` | read |
| `list_objects` | `class`, optional OQL `query`, `limit`, `page`, `outputFields` | read |
| `get_related` | `class`, numeric `id`, optional `relation`, `depth`, `direction` | read |
| `create_object` | `class`, `fields`, optional `outputFields`, `comment` | write |
| `update_object` | `class`, numeric `id`, `fields`, optional `outputFields`, `comment` | write |
| `apply_stimulus` | `class`, numeric `id`, `stimulus`, optional `fields`, `comment` | write |
| `delete_object` | `class`, numeric `id`, `simulate`, `confirmDelete` | write |

`class` defaults to `UserRequest`; use any class installed in the target model.
`fields` is a JSON object supporting custom attributes and case-log structures.
Create example: `{"class":"UserRequest","fields":{"org_id":12,"caller_id":34,"title":"Investigate service failures","description":"<p>Reported symptoms</p>"}}`.
Supply real IDs and all fields required by the installed model.

Assignment/closing use `apply_stimulus` with the model's stimulus and required
fields, rather than arbitrary status updates. Private/public notes use the
case-log structures in `fields.private_log` / `fields.public_log`; public logs
can notify customers. Custom stopwatch APIs are not implemented by generic CRUD.

Deletion targets one numeric ID. It defaults to `simulate: true`; actual deletion
requires `simulate: false` and `confirmDelete: true`. Inspect the preview first.
Pagination defaults to 25 objects, page 1, and allows at most 100 per request.
The plugin requests REST API 1.4 so pagination is supported; use an installation
that supports it. Narrow `outputFields` (default `*`) to limit retrieved data.

Requests honor cancellation/deadlines and time out after at most 30 seconds.
Mutations are never automatically retried: a timeout can follow a successful
remote write. API/object failures return `ok: false` with their numeric error code;
a missing `get_object` returns status 404. Check REST access, bulk permissions,
required fields, and server logs when debugging failures.

See the [official iTop REST documentation](https://www.itophub.io/wiki/page?id=latest:advancedtopics:rest_json).
Build validation confirms the SDK contract, not connectivity or compatibility
with a particular customized iTop instance.
