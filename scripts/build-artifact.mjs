import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { desktopCodePluginSchema, desktopPluginDescriptorSchema } from "@bitsentry/plugin-sdk";

const require = createRequire(import.meta.url);
const rawPlugin = require("../dist/plugin.js").plugin;
const plugin = desktopCodePluginSchema.parse(rawPlugin);
const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (plugin.version !== metadata.version) throw new Error("Plugin and package versions differ");
const seen = new Set();
for (const action of plugin.actions) {
  if (seen.has(action.id)) throw new Error(`Duplicate action ID: ${action.id}`);
  seen.add(action.id);
  const keys = action.fields.map((field) => field.key);
  if (new Set(keys).size !== keys.length) throw new Error(`Duplicate fields: ${action.id}`);
  if (/^(create|update|delete|apply)_/.test(action.id) && action.riskLevel !== "write") {
    throw new Error(`Mutation must be marked write: ${action.id}`);
  }
}
for (const verb of ["create", "get", "update", "delete"]) {
  if (!plugin.actions.some((action) => action.id.startsWith(`${verb}_`))) {
    throw new Error(`Missing CRUD action: ${verb}`);
  }
}
const descriptor = desktopPluginDescriptorSchema.parse({
  ...plugin,
  actions: plugin.actions.map(({ execute: _execute, ...action }) => action),
});
const artifact = await readFile(new URL("../dist/plugin.js", import.meta.url));
const artifactName = `${plugin.id}.plugin.js`;
await mkdir(new URL("../build/", import.meta.url), { recursive: true });
await writeFile(new URL(`../build/${artifactName}`, import.meta.url), artifact);
await writeFile(new URL("../build/descriptor.json", import.meta.url), JSON.stringify({ ...descriptor, metadata: rawPlugin.metadata }, null, 2) + "\n");
await writeFile(new URL("../build/index.yaml", import.meta.url),
  `plugins:\n  ${plugin.id}:\n    description: ${JSON.stringify(plugin.description)}\n    artifactUrl: "./${artifactName}"\n`);
await writeFile(new URL("../build/checksums.sha256", import.meta.url),
  `${createHash("sha256").update(artifact).digest("hex")}  ${artifactName}\n`);
process.stdout.write(`Validated SDK contract and built build/${artifactName}\n`);
