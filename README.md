# Farcaster Mention Graph (Next.js)

Interactive social graph app with directed mention links:

- Edge semantics: `B -> A` means user **B mentioned user A**.
- UI library: [`react-force-graph-2d`](https://github.com/vasturiano/react-force-graph)

## Setup

```bash
cd /Users/ramit/Desktop/socialagent/web
npm install
cp .env.local.example .env.local
```

Set your key in `.env.local`:

```bash
NEYNAR_API_KEY=your_neynar_key_here
```

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How it works

- Client sends request to `POST /api/mention-graph`.
- Server fetches casts from Neynar and builds a directed mention graph.
- Client renders it with force layout, zoom, drag, arrows, and path highlighting.

## API request

`POST /api/mention-graph`

```json
{
  "source": "dwr",
  "target": "vitalik",
  "depth": 2,
  "castsPerUser": 50
}
```

You can optionally pass `apiKey` in the request body, otherwise server env var is used.
