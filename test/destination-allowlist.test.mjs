import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import pluginModule from "../dist/plugin.js";

const { plugin } = pluginModule;
const TOKEN = "secret-token-value";
const ITOP_OK = JSON.stringify({ code: 0, objects: { "UserRequest::1": { code: 0, key: "1", class: "UserRequest", fields: {} } } });

let requests;
let originalFetch;
let originalAllowlist;

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
  originalAllowlist = process.env.ITOP_ALLOWED_BASE_URLS;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(ITOP_OK, { status: 200, headers: { "Content-Type": "application/json" } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllowlist === undefined) delete process.env.ITOP_ALLOWED_BASE_URLS;
  else process.env.ITOP_ALLOWED_BASE_URLS = originalAllowlist;
});

function readObject(baseUrl) {
  const action = plugin.actions.find((candidate) => candidate.id === "get_object");
  return action.execute({ actionId: "get_object", input: { id: 1 }, auth: { baseUrl, authToken: TOKEN } });
}

async function assertRefused(baseUrl) {
  await assert.rejects(readObject(baseUrl), (error) => !String(error.message).includes(TOKEN));
  assert.deepEqual(requests, [], "a refused destination must not be contacted and must not receive the token");
}

describe("iTop destination allowlist", () => {
  it("refuses a base URL that is not listed", async () => {
    process.env.ITOP_ALLOWED_BASE_URLS = "https://itop.example.com/itop";
    await assert.rejects(readObject("https://other.example.com/itop"), /ITOP_ALLOWED_BASE_URLS/);
    assert.deepEqual(requests, []);
  });

  it("refuses every base URL when the allowlist is empty or unset", async () => {
    delete process.env.ITOP_ALLOWED_BASE_URLS;
    await assertRefused("https://itop.example.com/itop");
    process.env.ITOP_ALLOWED_BASE_URLS = " , ";
    await assertRefused("https://itop.example.com/itop");
  });

  it("refuses another path on a listed host", async () => {
    process.env.ITOP_ALLOWED_BASE_URLS = "https://itop.example.com/itop";
    await assertRefused("https://itop.example.com/other");
  });

  it("reads a listed base URL once at the exact REST endpoint without following redirects", async () => {
    process.env.ITOP_ALLOWED_BASE_URLS = "https://first.example.com, https://itop.example.com/itop/";
    const result = await readObject("https://itop.example.com/itop/");
    assert.equal(result.ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://itop.example.com/itop/webservices/rest.php");
    assert.equal(requests[0].init.redirect, "error");
    assert.equal(requests[0].init.method, "POST");
  });

  for (const [label, baseUrl] of [
    ["plain http", "http://itop.example.com/itop"],
    ["embedded credentials", "https://user:pass@itop.example.com/itop"],
    ["a query string", "https://itop.example.com/itop?debug=1"],
    ["a fragment", "https://itop.example.com/itop#top"],
  ]) {
    it(`refuses a listed host when the base URL uses ${label}`, async () => {
      process.env.ITOP_ALLOWED_BASE_URLS = "https://itop.example.com/itop";
      await assertRefused(baseUrl);
    });
  }

  it("refuses an allowlist entry that is not a safe HTTPS URL", async () => {
    process.env.ITOP_ALLOWED_BASE_URLS = "http://itop.example.com/itop";
    await assertRefused("https://itop.example.com/itop");
  });
});
