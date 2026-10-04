const { createClient } = require("redis");
const { createApp } = require("./app");
const { RedisStore } = require("./store");

const PORT = process.env.PORT || 3000;

async function main() {
  const client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
  client.on("error", (err) => console.error("redis error:", err.message));
  await client.connect(); // the client keeps reconnecting on its own if Redis restarts

  const app = createApp(new RedisStore(client), {
    baseUrl: process.env.BASE_URL,
    rateLimit: Number(process.env.RATE_LIMIT || 20),
  });

  const server = app.listen(PORT, () => console.log(`shortly API listening on port ${PORT}`));

  const shutdown = () => {
    console.log("shutting down");
    server.close(() => client.quit().then(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
