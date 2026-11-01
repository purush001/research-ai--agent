# AI Content Agents

A Vite + vanilla JS app with a team of three agents that research the latest AI news and turn it into LinkedIn posts and X threads.

```
Research Agent ──► you pick the top 3 ──► LinkedIn Agent ┐
 (SerpAPI + LLM)      (human approval)                    ├─ run in parallel
                                          X/Twitter Agent ┘
```

1. **Research Agent** — runs several Google News searches through SerpAPI (plus an optional focus topic and time window), then asks the model for 10 ranked content ideas. Each idea links back to its source articles (sources are mapped by article number, so URLs are never invented).
2. **Human checkpoint** — you choose exactly 3 ideas.
3. **LinkedIn Agent** — one post per idea for senior technologists (10–20 yrs experience) who are new to agentic AI: plain-language, analogy-driven, approachable. If you enter a **CTA link**, a CTA line with that link is added below each post; leave it blank and no CTA is added.
4. **X/Twitter Agent** — one thread per idea for startup developers in the Bay Area. You choose **tweets per thread** (2–20). Every tweet is checked against the 280-character limit; if the model gets the count or length wrong it is asked to fix it (up to 3 attempts). Drafts are editable, with live character counters.

Steps 3 and 4 start at the same moment and each idea is its own request, so one failure never blocks the others. Every card has **Regenerate** (it re-reads the current CTA link / thread length) and copy buttons.

## Run

```bash
npm install
npm run dev
```

Open the **Settings** dialog (it opens automatically on first load) and enter:

- **OpenAI API key**
- **SerpAPI key**
- **Model** — defaults to `gpt-6.1-sol`; change it to any chat-completions model you have access to.
  Or set a build-time default with `VITE_OPENAI_MODEL` in `.env`.

Keys are kept in `sessionStorage` (cleared when the tab closes) unless you tick *Remember on this device* (`localStorage`).

## Notes

- **Keys live in the browser.** OpenAI is called directly from the page, so anyone with access to your browser profile can read the key. Fine for local/personal use; for a shared deployment move the calls behind a server.
- **SerpAPI proxy.** SerpAPI isn't reliably callable from browsers (CORS), so `vite.config.js` forwards `/serpapi/*` to `https://serpapi.com` for both `npm run dev` and `npm run preview`. If you deploy the built `dist/` as static files, host an equivalent proxy and set `VITE_SERPAPI_BASE` to its URL.
- The OpenAI call uses Chat Completions in JSON mode (`src/llm.js`); swap that one file if you want to use a different API surface.

## Layout

- `src/agents/research.js`, `linkedin.js`, `twitter.js` — one file per agent (prompts live here); `shared.js` has the common grounding rule.
- `src/llm.js`, `src/search.js` — OpenAI and SerpAPI clients.
- `src/main.js` — UI and the research → approve → parallel-generate workflow.
