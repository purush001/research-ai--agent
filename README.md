# AI News Research & Social Content

A Vite + React (JavaScript) app with three agents that research recent AI news and draft content for LinkedIn and X.

```
Research Agent ──► you approve exactly 3 ideas ──► LinkedIn Agent ┐ run simultaneously,
 (SerpAPI + model)                                  X/Twitter Agent ┘ retried independently
```

All three agents use OpenAI **`gpt-6.1-sol`** (`OPENAI_MODEL` on the server overrides it). Web search is SerpAPI (Google News).

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173, paste your **OpenAI** and **SerpAPI** keys into the masked fields, and press *Verify & save keys*. Each key is checked against its provider (neither check generates text or spends a search credit).

Production-style run (serves the built UI and the API from one process):

```bash
npm run build
npm start        # http://127.0.0.1:8787
```

Offline demo with mock providers (no keys or network needed; enter any key, e.g. `sk-demo` and `demo`):

```bash
npm run dev:mock
```

Tests: `npm test` (unit + API integration tests against mock providers).

## How credentials are handled

- The browser sends each key once, to the local backend. It is verified, then held **in the server process's memory** and tied to a random session id in an `HttpOnly`, `SameSite=Strict` cookie. The page never receives a key back.
- Keys are never written to disk, `localStorage`/`sessionStorage`, the Vite build (there are no `VITE_*` credentials), or logs. The server logs only method, path, status and duration; provider error text is passed through a redactor before it can reach the UI or console.
- The only thing the browser persists is the end timestamp of the last successful research run.
- The server binds to `127.0.0.1` and rejects cross-origin writes. Keys disappear when the server restarts or you press *Clear keys*. This is a single-user local tool; don't expose it on a shared host without adding real authentication.

## Research Agent

- **Window:** *Past 24 hours* or *Since last successful run* (24 hours on the first run, or if no earlier run is stored). The window is displayed; its end timestamp is saved only after a successful run, so a failed run keeps the previous one. Windows are capped at 30 days.
- **Search:** about 15 Google News searches across Oracle, PeopleSoft and general AI queries (≈15 SerpAPI credits per run; widening searches only the short categories). Results are filtered locally by parsed publication date; articles with no verifiable date are ignored. Date-only results count when their calendar day overlaps the window.
- **Ideas:** 2 Oracle + 2 PeopleSoft + 6 general. The server enforces quotas, maps source ids to real search results (the model never writes URLs), removes repeated stories (shared sources or headlines), and requires at least one dated, in-window source per idea. Primary sources (vendor/lab domains) are preferred and flagged. Each idea separates **Confirmed by sources** from **Proposed application (our inference)**.
- **Shortfall:** if a category has fewer ideas than its quota, a banner shows how many are missing and lets you widen the window (48 h – 30 days) for just those categories while keeping the ideas you have.

## Approval and drafting

You add editorial notes per idea and approve exactly three (any categories). Nothing is drafted until you press **Approve these 3 ideas & start drafting**. Before that you set an optional **CTA URL per LinkedIn post** and the **tweet count per X thread**.

Both agents then start at once, each with its own progress, error state and retry controls. Completed drafts survive the other agent failing; you can retry a failed agent, or regenerate any single draft. Drafts are editable and have copy buttons.

- **Hook standard:** both agents are given the six-second-hook standard, and a separate review call re-checks every opening (stands alone, reason to keep reading, body supports the claim, not interchangeable with other stories) and rewrites it if it fails. Rewrites and unresolved concerns are shown as warnings on the draft.
- **LinkedIn:** one post per idea for technical professionals with 10–20 years of experience. Source links are appended by the server so they can't be dropped or invented. With a CTA URL the post ends with a CTA line and the URL on its own line; with a blank field the CTA is omitted. 3,000-character limit is validated.
- **X:** exactly the configured tweet count per thread. Each tweet is validated with twitter-text v3 weighting (280 limit, every URL = 23, emoji/CJK = 2; `shared/xlength.js`); source links must appear inside the thread, and invalid threads are sent back to the model to repair (up to 4 attempts). Anything still invalid is shown with a red counter rather than hidden.

## Errors

Invalid keys, missing model access, rate limits (with retry-after), exhausted OpenAI/SerpAPI quota, timeouts, network and search failures each produce a specific message and hint in the UI.

## Layout

- `server/` — API (`api.js`), provider clients (`providers/`), agents and prompts (`agents/`), session store, standalone server (`index.js`).
- `shared/xlength.js` — X length rules, used by the server and the live counters.
- `src/` — React UI. `test/` — tests and the mock provider servers.

## Caveats

- The OpenAI calls use Chat Completions with Structured Outputs. I could not verify that `gpt-6.1-sol` exists or supports that API surface from the build environment; if your account sees it differently, set `OPENAI_MODEL`. The app was tested end-to-end only against mock providers that follow the real wire formats, not live OpenAI/SerpAPI.
- Ideas and drafts live in page memory; reloading the page discards them.
- Source dates come from SerpAPI's Google News fields and are only as precise as those fields; for date-only results the window check is day-level.
