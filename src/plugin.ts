import type {
  DesktopCodePlugin as SdkCodePlugin,
  DesktopCodePluginAction,
  DesktopPluginCodeActionContext as SdkActionContext,
  DesktopPluginFieldDefinition,
} from "@bitsentry/plugin-sdk";

// Additive persistence contract while the new SDK release is pending. New hosts
// validate this descriptor and handlers against their canonical SDK schemas.
type DesktopCodePlugin = Omit<SdkCodePlugin, "metadata"> & {
  metadata: SdkCodePlugin["metadata"] & { persistence: {
    configVersion: number; destinationField: string;
    configFields: DesktopPluginFieldDefinition[];
    resources: Array<{ type: string; stateVersion: number; readActionId: string }>;
    eventChannels: string[];
  } };
  persistence: {
    validateConfig(config: Record<string, unknown>): Record<string, unknown>;
    validateResourceState(input: { resourceType: string; version: number; state: unknown }): unknown;
  };
};

// SDK 0.1.0 predates the optional operation context supplied by newer hosts.
// Keep the standalone package compatible with both host generations.
type DesktopPluginCodeActionContext = SdkActionContext & {
  config?: Record<string, unknown>;
  operation?: {
    signal?: AbortSignal;
    deadlineAt?: number;
    executionId?: string;
  };
};

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer between 1 and ${String(max)}`);
  return value;
}

function normalizeBase(value: unknown): string {
  const url = new URL(text(value, "baseUrl"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("baseUrl must be HTTPS without credentials, query, or fragment");
  let base = url.href;
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

function endpoint(value: unknown): string {
  const base = normalizeBase(value);
  const allowed = (process.env.ITOP_ALLOWED_BASE_URLS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean).map(normalizeBase);
  if (!allowed.includes(base)) throw new Error("Add the exact iTop baseUrl to ITOP_ALLOWED_BASE_URLS on the host");
  return `${base}/webservices/rest.php`;
}

function parameters(input: Record<string, unknown>, operation: string): Record<string, unknown> {
  if (operation === "list_operations") return { operation };
  const className = text(input.class ?? "UserRequest", "class");
  if (!/^[A-Za-z]\w*$/.test(className)) throw new Error("class must be one iTop class name");
  const body: Record<string, unknown> = { operation, class: className };
  if (operation === "core/get") {
    body.key = input.id === undefined ? text(input.query ?? `SELECT ${className}`, "query") : integer(input.id, "id");
    body.limit = integer(input.limit ?? 25, "limit", 100);
    body.page = integer(input.page ?? 1, "page");
  } else if (operation !== "core/create") {
    // Mutations always target one numeric ID, never an OQL expression or bulk key.
    body.key = integer(input.id, "id");
  }
  if (operation !== "core/get" && operation !== "core/get_related") {
    Object.assign(body, mutationParameters(input, operation));
  } else {
    body.output_fields = text(input.outputFields ?? "*", "outputFields");
  }
  if (operation === "core/get_related") {
    body.relation = text(input.relation ?? "impacts", "relation");
    body.depth = integer(input.depth ?? 1, "depth", 10);
    const direction = input.direction ?? "down";
    if (direction !== "up" && direction !== "down") throw new Error("direction must be up or down");
    body.direction = direction;
  }
  return body;
}

function mutationParameters(input: Record<string, unknown>, operation: string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (operation === "core/delete") {
    if (input.simulate !== undefined && typeof input.simulate !== "boolean") throw new Error("simulate must be a boolean");
    body.simulate = input.simulate ?? true;
    if (body.simulate === false && input.confirmDelete !== true) throw new Error("confirmDelete must be true for actual deletion");
  } else {
    body.output_fields = text(input.outputFields ?? "*", "outputFields");
  }
  if (operation === "core/create" || operation === "core/update" || operation === "core/apply_stimulus") {
    const fields = record(input.fields ?? {}, "fields");
    if (operation !== "core/apply_stimulus" && Object.keys(fields).length === 0) throw new Error("fields cannot be empty");
    body.fields = fields;
  }
  body.comment = text(input.comment ?? "BitSentry runbook action", "comment");
  if (operation === "core/apply_stimulus") body.stimulus = text(input.stimulus, "stimulus");
  return body;
}

async function execute(context: DesktopPluginCodeActionContext, operation: string) {
  const url = endpoint(context.config?.endpoint ?? context.auth.baseUrl);
  if (context.actionId === "get_object") integer(context.input.id, "id");
  const body = parameters(context.input, operation);
  const form = new URLSearchParams({ version: "1.4", json_data: JSON.stringify(body) });
  if (context.auth.authToken !== undefined) {
    form.set("auth_token", text(context.auth.authToken, "authToken"));
  } else {
    form.set("auth_user", text(context.auth.username, "username"));
    // Passwords can contain leading/trailing spaces.
    const password = context.auth.password;
    if (typeof password !== "string" || password.length === 0) throw new Error("password is required");
    form.set("auth_pwd", password);
  }
  const remaining = Math.min(30_000, (context.operation?.deadlineAt ?? Date.now() + 30_000) - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("iTop operation deadline exceeded");
  const signals = [AbortSignal.timeout(Math.ceil(remaining))];
  if (context.operation?.signal) signals.push(context.operation.signal);
  const response = await fetch(url, {
    method: "POST", body: form, redirect: "error", signal: AbortSignal.any(signals),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  });
  if (!response.ok) return { ok: false, status: response.status, summary: `iTop failed (HTTP ${String(response.status)})` };
  const payload = record(await response.json(), "iTop response");
  if (payload.code !== 0) return { ok: false, status: 502, summary: "iTop reported an API error", data: { code: payload.code } };
  const objects = payload.objects == null ? {} : record(payload.objects, "iTop objects");
  if (context.actionId === "get_object" && Object.keys(objects).length === 0) {
    return { ok: false, status: 404, summary: "iTop object was not found" };
  }
  for (const value of Object.values(objects)) {
    const object = record(value, "iTop object");
    if (object.code !== 0) return { ok: false, status: 502, summary: "iTop reported an object error", data: { code: object.code } };
  }
  if ((operation === "core/create" || operation === "core/update" || operation === "core/apply_stimulus") && Object.keys(objects).length !== 1) {
    throw new Error("iTop did not confirm exactly one modified object");
  }
  return { ok: true, status: response.status, summary: `iTop ${operation} succeeded`, data: payload };
}

function field(key: string, label: string, required = false): DesktopPluginFieldDefinition {
  return { key, label, type: "string", required };
}
const classField = { ...field("class", "iTop class (UserRequest, Incident, or another installed class)"), defaultValue: "UserRequest" };
const idField: DesktopPluginFieldDefinition = { key: "id", label: "Object ID", type: "number", required: true };
const fieldsField: DesktopPluginFieldDefinition = { key: "fields", label: "iTop attributes (JSON)", type: "json", required: true };
const outputField = { ...field("outputFields", "Returned attributes"), defaultValue: "*" };
const commentField = field("comment", "Audit comment");

function action(id: string, title: string, operation: string, fields: DesktopPluginFieldDefinition[], riskLevel: "read" | "write"): DesktopCodePluginAction {
  return { id, title, description: title, riskLevel, fields, execute: (context) => execute(context, operation) };
}

export const plugin: DesktopCodePlugin = {
  metadata: { persistence: {
    configVersion: 1,
    destinationField: "endpoint",
    configFields: [
      { key: "endpoint", label: "Instance URL", type: "string", required: true },
      { key: "ticketMapping", label: "Ticket fields and lifecycle mapping", type: "json", required: false },
    ],
    resources: [{ type: "ticket", stateVersion: 1, readActionId: "get_object" }],
    eventChannels: [],
  } },
  persistence: {
    validateConfig(config) {
      return { ...config, endpoint: normalizeBase(config.endpoint) };
    },
    validateResourceState({ state }) {
      if (state === null || typeof state !== "object" || Array.isArray(state)) throw new Error("Resource state must be an object");
      return state;
    },
  },
  id: "itop", name: "iTop", version: "0.2.1", type: "data_source",
  description: "CRUD for iTop tickets, requests, and CMDB objects, with lifecycle transitions and related-object lookup.",
  auth: { fields: [
    field("baseUrl", "Legacy runbook instance URL (named connections use configuration)"),
    { ...field("authToken", "iTop application/personal token"), secret: true },
    field("username", "Username (when not using a token)"),
    { ...field("password", "Password (when not using a token)"), secret: true },
  ] },
  actions: [
    action("list_operations", "Discover supported iTop operations", "list_operations", [], "read"),
    action("create_object", "Create iTop ticket, request, or object", "core/create", [classField, fieldsField, outputField, commentField], "write"),
    action("get_object", "Read iTop ticket, request, or object", "core/get", [classField, idField, outputField], "read"),
    action("list_objects", "Search iTop tickets, requests, or objects", "core/get", [classField, field("query", "OQL query"), outputField,
      { key: "limit", label: "Page size (1–100)", type: "number", required: false, defaultValue: 25 },
      { key: "page", label: "Page (starts at 1)", type: "number", required: false, defaultValue: 1 },
    ], "read"),
    action("update_object", "Update iTop ticket, request, or object", "core/update", [classField, idField, fieldsField, outputField, commentField], "write"),
    action("delete_object", "Delete iTop ticket, request, or object", "core/delete", [classField, idField, commentField,
      { key: "simulate", label: "Preview deletion and dependent objects", type: "boolean", required: false, defaultValue: true },
      { key: "confirmDelete", label: "Confirm actual deletion", type: "boolean", required: false, defaultValue: false },
    ], "write"),
    action("apply_stimulus", "Transition an iTop ticket or object", "core/apply_stimulus", [classField, idField, field("stimulus", "Lifecycle stimulus (for example ev_assign)", true), { ...fieldsField, required: false }, outputField, commentField], "write"),
    action("get_related", "Read related iTop objects", "core/get_related", [classField, idField, field("relation", "Relation (default impacts)"),
      { key: "depth", label: "Relation depth (1–10)", type: "number", required: false, defaultValue: 1 },
      { ...field("direction", "Direction"), enumValues: ["up", "down"], defaultValue: "down" },
    ], "read"),
  ],
};

export default plugin;
