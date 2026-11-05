# Reusable Prompt — Multi-Agent Research → Social Content App

Paste everything below the line into a fresh Claude Code session. Edit the **Parameters** block first; the rest is written to be reused as-is. It encodes your original spec plus the decisions, tests and pitfalls learned while building and reviewing the first version.

---

## Role and goal

Build, test, review and deliver a runnable **Vite + React (JavaScript)** application with a lightweight Node backend and three agents. A Research Agent finds recent news; I approve exactly three ideas; a LinkedIn Agent and an X/Twitter Agent then draft content for them at the same time. Work on the branch the session assigns, commit, and push. **Do not open a pull request until I ask.**

## Parameters (edit these)

- **Model for all three agents:** `gpt-6.1-sol` (server-side env override `OPENAI_MODEL`)
- **Search provider:** SerpAPI (Google News)
- **Topic categories and quotas (total 10):** Oracle = 2, PeopleSoft = 2, General AI news = 6
  - Oracle: AI developments relevant to Oracle Database, OCI, integrations, or production operations
  - PeopleSoft: HCM, FSCM, PeopleTools, Integration Broker, or ERP modernization
  - General: agentic AI, developer tooling, models, research, applied AI
- **LinkedIn audience:** technical professionals with 10–20 years of experience who may be new to agentic AI
- **X audience:** developers at tech startups in San Francisco and the Bay Area
- **Approvals required:** exactly 3 ideas, from any category
- **Search windows:** "Past 24 hours" or "Since last successful run" (24 hours on the first run)

## 1. Architecture and credentials

- Vite + React app. One backend handler serves the API; mount it as Vite dev/preview middleware **and** as a standalone `npm start` server that serves `dist/`. One command (`npm run dev`) must run everything.
- Masked (`type="password"`, autocomplete off) fields for the OpenAI and SerpAPI keys. The browser sends each key once to the backend, which **verifies it with a call that costs nothing** (OpenAI `GET /models/{model}`, SerpAPI `/account`), then holds it **only in server memory** behind a random session id in an `HttpOnly; SameSite=Strict` cookie. The server never returns a key; the UI clears typed keys after saving.
- Keys must never appear in logs, browser storage, the Vite bundle (no `VITE_*` credentials), error messages, or test output. Log only method, path, status and duration. Pass every outgoing error message through a redactor (anchor the `sk-` pattern so words like "Risk-based" are not mangled).
- Bind to `127.0.0.1`; reject cross-origin writes; require `application/json`; cap body size. Static server: handle malformed paths (`decodeURIComponent` can throw) and wrap the whole request handler so nothing thrown can kill the process.
- Browser storage may hold only non-secret state: the end timestamp of the last successful run.
- Map provider failures to stable error codes with clear messages and hints: invalid key, missing model access, rate limit (with retry-after), exhausted quota, timeout, network, search failure. Each must display clearly in the UI; key errors get an **Edit API keys** action that opens the key panel.
- Put limits and definitions used by both sides (categories, quotas, LinkedIn limit, tweet min/max, URL validation, X length rules) in a `shared/` module. Do not duplicate them.

## 2. Research Agent

- Offer the two window modes; always display the search window (local time); first run or missing marker falls back to 24 hours and says so. Cap windows at 30 days and say when clamped.
- **Advance the "last successful run" marker only after a complete run** (ideas found and no search failed). Failed or incomplete runs keep the previous marker and explain why.
- Search Oracle, PeopleSoft and general topics explicitly (about 15 queries, concurrency-limited, partial failures tolerated, fatal on bad key/quota). Use the provider's recency filter coarsely, then **filter locally by parsed publication date** (ISO, absolute and relative forms; be strict — do not let lenient `Date.parse` accept garbage). Ignore undated articles. Date-only values count if their calendar day overlaps the window; document this.
- Tag each candidate with the categories whose queries found it, and **cap the candidate list round-robin per category** (primary sources first, then newest) so one category cannot crowd out another.
- Prefer primary sources (vendor/lab/paper domains) and flag them. The model references candidates **by id only and never writes URLs**; the server maps ids to real results.
- Return 10 distinct ideas. Server-side validation: category quotas, ≥1 dated in-window source per idea, remove repeated stories (shared source URL or headline), assign overlaps to one category. Each idea has a headline, summary, proposed angle, **"Confirmed by sources"** and **"Proposed application (our inference)"** shown separately, and source links with publication dates.
- If a category falls short, show exactly how many ideas are missing and let me **widen the window for only the missing categories** (48 h – 30 days) while keeping existing ideas and keeping the original window end.
- UI: editorial notes per idea; approve exactly three (disable more); show settings (below) and an explicit **"Approve these 3 ideas & start drafting"** button. Draft nothing before that.

## 3. Writing standard for both platforms (put verbatim in both agents' prompts)

Every LinkedIn post and X thread opens with a convincing **six-second hook**: in the first one or two LinkedIn lines, or the first X post, the reader grasps what changed and why it matters to their work. Lead with a specific, source-backed consequence (an integration change, a deployment decision, an operational workflow). The rest must earn the hook: a verified detail explaining the change, a decision the reader might face, something concrete to evaluate or try. Label inference as inference ("My read:", "Inference:"). Flowing prose; every paragraph or tweet advances the same argument. Only facts from the provided sources — no invented statistics, quotes, versions, dates or features. Before showing a draft, the opening must stand alone, give the audience a reason to keep reading, and make a claim the body supports; rewrite any opening that could fit several unrelated stories.

Implement this as **two layers**: the standard in the generation prompt, **plus an independent review call** that checks every opening (stands alone / reason to keep reading / body supports claim / not interchangeable) and supplies a rewrite when it fails. Accept a rewrite only if it introduces **no validation issue the draft did not already have**; otherwise keep the original with a visible warning.

## 4. LinkedIn Agent

One standalone post per approved idea. Explain unfamiliar terms as they arise; name the affected Oracle/PeopleSoft workflow and practical implication when the sources support it (label inferences; never overstate). The **server appends the supporting source links** so they cannot be dropped or invented; the model writes no URLs. Optional **CTA URL per post**: if entered, end with a relevant CTA line and the URL alone on the last line; if blank, no CTA and keep the source links. Validate hook length/lines, body length, no URLs in prose, assembled length ≤ 3,000.

## 5. X/Twitter Agent

One thread per approved idea, building from the hook toward something developers can build, test or learn. **Tweet count is set independently per thread (1–25)** and generated exactly. Validate every tweet with twitter-text v3 weighting: limit 280; every URL counts 23; characters in U+0000–10FF, 2000–200D, 2010–201F, 2032–2037 count 1; everything else (CJK, emoji, ZWJ sequences as one) counts 2; **scheme-less domains with a known TLD also count 23** (but `Node.js`, `v8.62` and emails do not). Source links must appear inside the configured count; use only provided URLs written as full `https://` links. Failed validation is sent back for repair (up to 4 attempts); anything still invalid is shown with a red counter, not hidden. Show live counters on editable tweets.

## 6. Parallel delivery

After approval, start both agents at the same moment with the approved ideas, sources, notes and platform settings. Show separate progress, preserve completed drafts if one agent fails, and offer independent retry (retry failed, regenerate all, regenerate one draft). Show three LinkedIn posts and three X threads in separate sections with copy controls (post, tweet, whole thread). Discarding drafts while a run is in flight must be safe: tag runs with a generation id and ignore stale responses; state updates must tolerate cleared state.

## 7. Shared drafting runner

Implement generate → validate → repair → review → per-idea results **once**, with per-platform adapters. Validators return structured issues `{ code, message }`; compare codes, never regex message text. Retry transient errors (malformed/empty output, 5xx, timeout, network) up to twice without consuming a repair attempt. If a repair call fails, **keep the last usable draft** with a warning. If nothing at all could be drafted because of a provider error, throw that error so the API returns its real status.

## 8. Testing (required before claiming done)

- Write **mock OpenAI and SerpAPI servers** that follow the real wire formats (keys containing "bad" → 401, "ratelimit" → 429) and add `npm run dev:mock` for an offline demo. State plainly that live providers were not exercised if keys or network are unavailable.
- Unit tests: X length rules (URLs, emoji, CJK, bare domains, 280 boundary), date parsing and window checks, URL normalization, idea assembly (quotas, dedupe, unknown ids), balanced candidate cap, LinkedIn/X validators and issue codes, redaction.
- API integration tests with a real HTTP server: invalid keys (no key echoed), cookie flags, cross-origin refusal, research with shortfall then widening, CTA only where given, independent tweet counts, repair of an over-long tweet, hook rewrite and its rejection, one agent failing while the other succeeds, transient retry, repair-failure keeps draft, rate-limit and quota errors, session clearing, and **no secret in logs**.
- A spawned-server test that malformed paths (`/%`) return 400 and the process survives.
- Browser verification with Playwright (Chromium is pre-installed; do not reinstall): full flow, discard-mid-run with delayed responses, reload with saved keys, key-error action, no page errors, no horizontal scroll at 390 px, light and dark themes.
- Confirm the built bundle contains no credentials and that localStorage holds only the last-run timestamp.

## 9. Process

1. Inspect the repo first; replace anything that conflicts with this spec (e.g. keys in browser storage, direct browser-to-provider calls).
2. Build, test, commit and push to the assigned branch. Write a README (local setup, credential handling, behavior, caveats).
3. Run a high-effort code review of the diff. Report findings with the structured reporting tool, fix them, add a regression test for each, re-run everything, then re-report each finding with an outcome (`fixed` / `no_change_needed` / `skipped`).
4. Open a PR only when asked; use the repo's PR template if one exists; end the body with the session's attribution lines. Ask whether to watch the PR afterwards.
5. Be candid about what was and was not verified, including that the model name and API surface could not be confirmed offline.

## Definition of done

`npm test` passes; `npm run dev` and `npm run build && npm start` both work; the full flow runs in a browser against the mocks without errors; no secret appears in logs, storage, bundle or tests; the README explains setup; all work is pushed to the assigned branch; the final message lists what was verified, what was not, and any caveats.
