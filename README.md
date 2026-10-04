# shortly

A URL shortener. Paste a long link, get a short one, and see how many times it has been
followed. Links are stored in Redis, and the number of links one client can create per
minute is limited.

## Stack

| Part | Technology |
| --- | --- |
| API | Node.js, Express |
| Storage | Redis 7 (with append-only persistence) |
| Frontend | HTML, CSS, JavaScript |
| Web server | Nginx (serves the frontend, proxies the API and the short links) |
| CI | GitHub Actions |

## Run it

```bash
docker compose up -d --build
```

Open <http://localhost:8092>.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/links` | Create a link: `{"url": "https://...", "alias": "optional-name"}` |
| GET | `/api/links` | The newest 100 links with click counts |
| DELETE | `/api/links/<code>` | Delete a link |
| GET | `/<code>` | Redirect to the long address and count the click |
| GET | `/api/health` | Checks the API and its Redis connection |

## How it works

- **Storage.** Each link is a Redis hash, `link:<code>`, holding the address, creation
  time and click count. A sorted set, `links`, keeps the codes ordered by creation time
  so the list can be read newest first.
- **No duplicate codes.** A link is created with `HSETNX`, which only writes if the key
  does not exist yet. Two requests for the same alias cannot both succeed.
- **Click counting.** Every redirect runs `HINCRBY`, which is atomic, so no clicks are
  lost when many people follow a link at the same time.
- **Rate limiting.** Creating a link increments a counter named after the client's IP
  and the current minute; the key expires after 60 seconds. Above the limit the API
  answers `429`.
- **Real client IP.** The API sits behind Nginx, so Nginx passes the client address in
  `X-Forwarded-For`, overwriting anything the client sent, and Express is told to trust
  exactly one proxy.
- **Routing.** Nginx serves the static files itself and sends `/api/` and anything that
  looks like a short code to the API. Codes cannot contain a dot, so they never clash
  with `index.html` or `app.js`.
- **Only web links.** Addresses must be `http` or `https`. `javascript:` and `data:`
  URLs are rejected.
- **Persistence.** Redis runs with `--appendonly yes` and a volume, so links survive
  `docker compose restart`.

## Tests

```bash
cd api
npm install
npm test
```

The tests run the real Express app against an in-memory store, so they need no Redis.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `RATE_LIMIT` | `20` | Links one client may create per minute |
| `BASE_URL` | taken from the request | Address used when building short links |
