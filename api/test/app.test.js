const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { createApp, parseUrl, randomCode } = require("../src/app");
const { MemoryStore } = require("../src/store");

let server;
let base;

async function start(options) {
  server = createApp(new MemoryStore(), options).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(() => start({ rateLimit: 100 }));
afterEach(() => new Promise((resolve) => server.close(resolve)));

const create = (body) => fetch(base + "/api/links", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("creates a link with a random code", async () => {
  const response = await create({ url: "https://example.com/some/long/path" });
  assert.equal(response.status, 201);
  const link = await response.json();
  assert.match(link.code, /^[A-Za-z0-9]{6}$/);
  assert.equal(link.url, "https://example.com/some/long/path");
  assert.equal(link.clicks, 0);
  assert.equal(link.shortUrl, base + "/" + link.code);
});

test("creates a link with a custom alias and rejects a duplicate", async () => {
  assert.equal((await create({ url: "https://example.com", alias: "docs" })).status, 201);
  assert.equal((await create({ url: "https://example.org", alias: "docs" })).status, 409);
});

test("rejects bad urls and bad aliases", async () => {
  assert.equal((await create({ url: "javascript:alert(1)" })).status, 400);
  assert.equal((await create({ url: "not a url" })).status, 400);
  assert.equal((await create({})).status, 400);
  assert.equal((await create({ url: "https://example.com", alias: "a" })).status, 400);
  assert.equal((await create({ url: "https://example.com", alias: "has space" })).status, 400);
  assert.equal((await create({ url: "https://example.com", alias: "api" })).status, 400);
});

test("redirects and counts clicks", async () => {
  await create({ url: "https://example.com/target", alias: "goto" });

  for (let i = 0; i < 3; i++) {
    const response = await fetch(base + "/goto", { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://example.com/target");
  }

  const links = await (await fetch(base + "/api/links")).json();
  assert.equal(links[0].clicks, 3);
});

test("unknown code returns 404", async () => {
  assert.equal((await fetch(base + "/nothere", { redirect: "manual" })).status, 404);
});

test("lists newest first and deletes", async () => {
  await create({ url: "https://example.com/1", alias: "first" });
  await create({ url: "https://example.com/2", alias: "second" });

  let links = await (await fetch(base + "/api/links")).json();
  assert.deepEqual(links.map((l) => l.code), ["second", "first"]);

  assert.equal((await fetch(base + "/api/links/first", { method: "DELETE" })).status, 204);
  assert.equal((await fetch(base + "/api/links/first", { method: "DELETE" })).status, 404);
  links = await (await fetch(base + "/api/links")).json();
  assert.equal(links.length, 1);
});

test("rate limit blocks after the allowed number of links", async () => {
  await new Promise((resolve) => server.close(resolve));
  await start({ rateLimit: 2 });

  assert.equal((await create({ url: "https://example.com/1" })).status, 201);
  assert.equal((await create({ url: "https://example.com/2" })).status, 201);
  assert.equal((await create({ url: "https://example.com/3" })).status, 429);
});

test("parseUrl and randomCode", () => {
  assert.equal(parseUrl("https://example.com"), "https://example.com/");
  assert.equal(parseUrl("ftp://example.com"), null);
  assert.equal(parseUrl(42), null);
  assert.equal(randomCode(8).length, 8);
});
