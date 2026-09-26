import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desktopCodePluginSchema, desktopPluginExecutionResultSchema } from "@bitsentry/plugin-sdk";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readObject(filename, label) {
  try {
    const value = JSON.parse(await readFile(filename, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`${label} must be a readable JSON object file`);
  }
}

function validateFields(fields, values) {
  const result = { ...values };
  for (const field of fields) {
    if (result[field.key] === undefined) result[field.key] = field.defaultValue;
    const value = result[field.key];
    if (value === undefined) {
      if (field.required) throw new Error(`Missing required field: ${field.key}`);
      continue;
    }
    const valid = field.type === "json" ||
      (field.type === "string_array" ? Array.isArray(value) && value.every((item) => typeof item === "string") :
        typeof value === field.type && (field.type !== "number" || Number.isFinite(value)));
    if (!valid || (field.enumValues !== undefined && !field.enumValues.includes(value))) {
      throw new Error(`Invalid value for field: ${field.key}`);
    }
  }
  return result;
}

async function main() {
  const { values } = parseArgs({ options: {
    action: { type: "string" }, input: { type: "string" },
    "confirm-write": { type: "boolean", default: false },
    "show-data": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  } });
  if (values.help) {
    process.stdout.write("pnpm run debug [--action ID --input input.local.json] [--confirm-write] [--show-data]\nSet BITSENTRY_PLUGIN_AUTH_FILE to a credentials JSON file. No action lists available operations without connecting.\n");
    return;
  }
  const plugin = desktopCodePluginSchema.parse(require("../dist/plugin.js").plugin);
  if (values.action === undefined) {
    process.stdout.write(JSON.stringify({ pluginId: plugin.id, actions: plugin.actions.map(({ execute: _execute, ...action }) => action) }, null, 2) + "\n");
    return;
  }
  const action = plugin.actions.find((candidate) => candidate.id === values.action);
  if (action === undefined) throw new Error("Unknown action; run without --action to list actions");
  if (action.riskLevel === "write" && !values["confirm-write"]) {
    throw new Error("This action modifies remote data. Review the input and pass --confirm-write to execute it.");
  }
  const authFile = process.env.BITSENTRY_PLUGIN_AUTH_FILE;
  if (!authFile) throw new Error("Set BITSENTRY_PLUGIN_AUTH_FILE to a credentials JSON file");
  const auth = validateFields(plugin.auth.fields, await readObject(authFile, "Auth"));
  const input = validateFields(action.fields, values.input === undefined ? {} : await readObject(values.input, "Input"));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    const result = desktopPluginExecutionResultSchema.parse({
      pluginId: plugin.id, actionId: action.id,
      ...await action.execute({
        pluginId: plugin.id, actionId: action.id, auth, input,
        host: { pluginRoot: root, entryPath: path.join(root, "dist/plugin.js"), localPluginDirectories: [root], reloadPlugins: () => Promise.resolve() },
        operation: { signal: controller.signal, deadlineAt: Date.now() + 30_000 },
      }),
    });
    const { data: _data, ...summary } = result;
    process.stdout.write(JSON.stringify(values["show-data"] ? result : summary, null, 2) + "\n");
    if (!result.ok) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}

try {
  await main();
} catch (error) {
  // Never print credentials or the request/response body on errors.
  process.stderr.write(`${error instanceof Error ? error.message : "Plugin action failed"}\n`);
  process.exitCode = 1;
}
