# iTop code plugin

Desktop CE/Pro and Dashboard share this artifact's action contract, not credentials
or storage. Actions run on the invoking host and contact only the configured iTop
instance. Dashboard's separate ticket-provider package handles persisted tickets
and incoming webhooks.

## Standalone development

Requires Node.js 22.12+ and pnpm 10.32.1.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run lint
```

The build emits `dist/plugin.js` and TypeScript declarations. The SDK is a
build-time dependency; credentials are supplied by the invoking BitSentry host.
Source publication does not publish a plugin artifact or update the plugin index.

## BitSentry workspace installation

When integrated into the BitSentry monorepo, from its root, `pnpm run build` builds both plugins and produces
`apps/desktop-ce/build/plugins/itop.plugin.js`, `outline.plugin.js`, and `index.yaml`.
Install into Desktop using the actual absolute path:

```sh
bitsentry plugin install itop --index-url /absolute/path/to/apps/desktop-ce/build/plugins/index.yaml
bitsentry plugin install outline --index-url /absolute/path/to/apps/desktop-ce/build/plugins/index.yaml
```

Dashboard uses the same index via `BITSENTRY_PLUGIN_INDEX_URL`; deploy the entire
artifact directory together. The default cloud allowlist includes both plugins.
If `BITSENTRY_CLOUD_PLUGIN_ALLOWLIST` is explicitly set, include `itop,outline`
alongside existing names. Public publication has not been performed.

## Credentials

Set the host environment's `ITOP_ALLOWED_BASE_URLS` to the exact HTTPS installation
URL, for example `https://itop.example.com/itop` (comma-separated for multiple
instances). Provide that URL in `auth.baseUrl`, and either `auth.authToken` or
`auth.username` plus `auth.password`. Token authentication takes precedence.
Keep credentials in Desktop's secret store or Dashboard's encrypted plugin auth.
No credentials are embedded in the artifact. Redirects are rejected; requests
honor cancellation/deadlines and time out after at most 30 seconds.

## Actions

| Action | Inputs | Purpose |
| --- | --- | --- |
| `list_operations` | none | Discover operations on the installed server |
| `create_object` | `class`, `fields` | Create a ticket, request, or other object |
| `get_object` | `class`, numeric `id` | Read one object |
| `list_objects` | `class`, optional OQL `query`, `limit`, `page` | Search/read a page |
| `update_object` | `class`, numeric `id`, `fields` | Modify attributes |
| `delete_object` | `class`, numeric `id`, `simulate`, `confirmDelete` | Preview or execute deletion |
| `apply_stimulus` | `class`, numeric `id`, `stimulus`, optional `fields` | Change lifecycle state |
| `get_related` | `class`, numeric `id`, `relation`, `depth`, `direction` | Read related CMDB objects |

`class` defaults to `UserRequest`. Use `Incident` for incidents or another installed
class (for example `Organization`, `Person`, `Server`, `DocumentFile`, `Attachment`).
The generic `fields` JSON supports custom mandatory attributes, case logs, links,
and API blob structures. There is no hard-coded client data model. Class rights
and field validation remain enforced by iTop. Unsupported extensions and custom
operations are not invented by this plugin.

Read/create/update actions accept `outputFields` (default `*`); narrow it to avoid
large attachments or linked sets. Mutations accept an audit `comment`. Search
defaults to 25 objects, page 1; maximum page size is 100. Read pagination requires
iTop 2.6.1+. API and per-object errors produce failed action results, even on HTTP
200. Success returns the iTop envelope under `data`.

Deletion always addresses a single numeric ID. It defaults to `simulate: true`.
Actual deletion requires both `simulate: false` and `confirmDelete: true`; inspect
the preview for dependent objects first. All mutations are marked `write` for
the host. The plugin itself never retries mutations. Disable runbook-level
automatic retries for creation unless your workflow reconciles prior attempts;
an HTTP timeout can occur after iTop has already created the object. The Dashboard
creation webhook supplies its own durable event-ID duplicate protection.

Example request creation (`create_object` input):

```json
{
  "class": "UserRequest",
  "fields": {
    "org_id": 12,
    "caller_id": 34,
    "title": "Investigate repeated service failures",
    "description": "<p>Investigation context from the incident.</p>"
  },
  "outputFields": "id,ref,title,status"
}
```

To assign the request, use `apply_stimulus` with its returned numeric ID,
`stimulus: "ev_assign"`, and the client model's required `team_id`/`agent_id` fields.
Do not treat arbitrary `status` assignments as lifecycle transitions. To append
notes, pass the documented case-log structure in `fields.public_log` or
`fields.private_log` to `update_object`.

The service account needs REST access and appropriate class permissions. Field
names, lifecycle stimuli, and installed classes depend on the client's modules.
See the [official REST API](https://www.itophub.io/wiki/page?id=latest:advancedtopics:rest_json).
No live client instance has been exercised by this change.
