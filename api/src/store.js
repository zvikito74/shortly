// Two storage backends with the same methods:
//   RedisStore  - used when the app runs for real
//   MemoryStore - a Map, used by the tests
//
// Redis layout:
//   link:<code>   hash   { url, createdAt, clicks }
//   links         zset   codes scored by creation time, for listing newest first
//   rate:<key>    string counter that expires after the rate-limit window

class RedisStore {
  constructor(client) {
    this.client = client;
  }

  async ping() {
    await this.client.ping();
  }

  // Returns false if the code is already taken
  async create(code, url) {
    const key = "link:" + code;
    const created = await this.client.hSetNX(key, "url", url);
    if (!created) return false;
    const now = Date.now();
    await this.client.hSet(key, { createdAt: String(now), clicks: "0" });
    await this.client.zAdd("links", { score: now, value: code });
    return true;
  }

  async get(code) {
    const data = await this.client.hGetAll("link:" + code);
    if (!data.url) return null;
    return { code, url: data.url, clicks: Number(data.clicks || 0), createdAt: Number(data.createdAt) };
  }

  async recordClick(code) {
    await this.client.hIncrBy("link:" + code, "clicks", 1);
  }

  async list(limit) {
    const codes = await this.client.zRange("links", 0, limit - 1, { REV: true });
    const links = await Promise.all(codes.map((code) => this.get(code)));
    return links.filter(Boolean);
  }

  async remove(code) {
    const removed = await this.client.del("link:" + code);
    await this.client.zRem("links", code);
    return removed > 0;
  }

  // Counts a hit and returns the total within the current window
  async hit(key, windowSeconds) {
    const name = "rate:" + key;
    const count = await this.client.incr(name);
    if (count === 1) await this.client.expire(name, windowSeconds);
    return count;
  }
}

class MemoryStore {
  constructor() {
    this.links = new Map();
    this.hits = new Map();
  }

  async ping() {}

  async create(code, url) {
    if (this.links.has(code)) return false;
    this.links.set(code, { code, url, clicks: 0, createdAt: Date.now() + this.links.size });
    return true;
  }

  async get(code) {
    const link = this.links.get(code);
    return link ? { ...link } : null;
  }

  async recordClick(code) {
    const link = this.links.get(code);
    if (link) link.clicks += 1;
  }

  async list(limit) {
    return [...this.links.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((link) => ({ ...link }));
  }

  async remove(code) {
    return this.links.delete(code);
  }

  async hit(key) {
    const count = (this.hits.get(key) || 0) + 1;
    this.hits.set(key, count);
    return count;
  }
}

module.exports = { RedisStore, MemoryStore };
