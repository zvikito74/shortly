const crypto = require("node:crypto");
const express = require("express");

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/l/I/o
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const RESERVED = new Set(["api", "health", "static", "admin"]);

function randomCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

// Only plain web links are accepted, so the service cannot be used to hide
// javascript: or data: URLs behind a short link.
function parseUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function createApp(store, options = {}) {
  const rateLimit = options.rateLimit ?? 20; // new links per client per minute
  const baseUrl = options.baseUrl;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // one proxy (Nginx) in front, so req.ip is the real client
  app.use(express.json({ limit: "10kb" }));

  const handle = (fn) => (req, res, next) => fn(req, res).catch(next);
  const present = (req, link) => ({
    ...link,
    createdAt: new Date(link.createdAt).toISOString(),
    shortUrl: (baseUrl || `${req.protocol}://${req.get("host")}`) + "/" + link.code,
  });

  app.get("/api/health", handle(async (req, res) => {
    await store.ping();
    res.json({ status: "ok" });
  }));

  app.post("/api/links", handle(async (req, res) => {
    const minute = Math.floor(Date.now() / 60000);
    if ((await store.hit(`${req.ip}:${minute}`, 60)) > rateLimit) {
      return res.status(429).json({ error: "too many links created, try again in a minute" });
    }

    const body = req.body || {};
    const url = parseUrl(body.url);
    if (!url) return res.status(400).json({ error: "url must be a valid http or https address" });

    const alias = body.alias ? String(body.alias).trim() : "";
    if (alias) {
      if (!CODE_PATTERN.test(alias) || RESERVED.has(alias.toLowerCase())) {
        return res.status(400).json({ error: "alias must be 3-32 characters: letters, digits, dash, underscore" });
      }
      if (!(await store.create(alias, url))) {
        return res.status(409).json({ error: "that alias is already taken" });
      }
      return res.status(201).json(present(req, await store.get(alias)));
    }

    // Random codes can collide, so try a few times
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      if (await store.create(code, url)) {
        return res.status(201).json(present(req, await store.get(code)));
      }
    }
    res.status(503).json({ error: "could not generate a free code, try again" });
  }));

  app.get("/api/links", handle(async (req, res) => {
    const links = await store.list(100);
    res.json(links.map((link) => present(req, link)));
  }));

  app.delete("/api/links/:code", handle(async (req, res) => {
    if (!(await store.remove(req.params.code))) return res.status(404).json({ error: "link not found" });
    res.status(204).end();
  }));

  // The short link itself
  app.get("/:code", handle(async (req, res) => {
    const link = CODE_PATTERN.test(req.params.code) ? await store.get(req.params.code) : null;
    if (!link) return res.status(404).type("text/plain").send("Short link not found");
    await store.recordClick(link.code);
    res.redirect(302, link.url);
  }));

  app.use((req, res) => res.status(404).json({ error: "not found" }));

  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid JSON" });
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

module.exports = { createApp, parseUrl, randomCode };
