// Mock OpenAI + SerpAPI servers that follow the real wire formats. Used by the
// tests and by `npm run dev:mock` so the whole app can be exercised offline.
// Keys: any value works, except those containing "bad" (-> 401) or "ratelimit" (-> 429).

import { createServer } from 'node:http';

const H = 3_600_000;
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * H).toISOString();
const relative = (hoursAgo) => (hoursAgo < 24 ? `${hoursAgo} hours ago` : `${Math.round(hoursAgo / 24)} days ago`);

// Hours-ago values below 24 are inside the default window.
const POOL = [
  { tags: ['oracle', 'database'], title: 'Oracle adds agent tooling to its AI Database release', source: 'Oracle Blogs', link: 'https://blogs.oracle.com/database/agent-tooling', snippet: 'Oracle describes in-database agent tooling with row-level security applied to agent queries.', h: 3 },
  { tags: ['oracle', 'oci'], title: 'OCI Generative AI service adds agent runtime with audit logging', source: 'Oracle', link: 'https://www.oracle.com/news/oci-agent-runtime', snippet: 'The OCI service logs every tool call an agent makes to OCI Audit.', h: 8 },
  { tags: ['oracle', 'operations'], title: 'Oracle ships AI-assisted SQL tuning advisor in Autonomous Database', source: 'The Register', link: 'https://www.theregister.com/oracle-sql-tuning-ai', snippet: 'Advisor proposes index and plan changes and lets DBAs approve them.', h: 14 },
  { tags: ['peoplesoft'], title: 'PeopleSoft PeopleTools 8.62 adds REST-based hooks for AI services', source: 'Oracle PeopleSoft Blog', link: 'https://blogs.oracle.com/peoplesoft/peopletools-ai-hooks', snippet: 'New Integration Broker REST targets simplify calling external AI services from PeopleCode.', h: 5 },
  { tags: ['peoplesoft'], title: 'PeopleSoft HCM image adds natural-language search for self service', source: 'Oracle PeopleSoft Blog', link: 'https://blogs.oracle.com/peoplesoft/hcm-nl-search', snippet: 'HCM self service gains natural-language search backed by an LLM.', h: 80 },
  { tags: ['peoplesoft'], title: 'ERP modernization: PeopleSoft FSCM customers pilot AI invoice matching', source: 'CIO Dive', link: 'https://www.ciodive.com/peoplesoft-fscm-ai-invoices', snippet: 'Two customers describe pilots of AI invoice matching on FSCM.', h: 100 },
  { tags: ['agentic', 'agents'], title: 'OpenAI releases open-source agents SDK update with tracing', source: 'OpenAI', link: 'https://openai.com/index/agents-sdk-update', snippet: 'The SDK update adds built-in tracing and guardrail hooks.', h: 2 },
  { tags: ['agentic', 'agents'], title: 'Anthropic publishes guidance on building reliable multi-agent systems', source: 'Anthropic', link: 'https://www.anthropic.com/engineering/multi-agent-reliability', snippet: 'Engineering post covers failure modes of orchestrator-worker setups.', h: 6 },
  { tags: ['coding', 'developer', 'tools'], title: 'GitHub Copilot coding agent can now run repository-level evals', source: 'GitHub Blog', link: 'https://github.blog/copilot-agent-evals', snippet: 'Teams can gate agent changes on their own eval suites.', h: 9 },
  { tags: ['model', 'release', 'language'], title: 'Google DeepMind releases a new Gemini model with longer tool-use horizons', source: 'Google DeepMind', link: 'https://deepmind.google/discover/blog/new-gemini-tool-use', snippet: 'The model sustains multi-step tool use over longer tasks.', h: 11 },
  { tags: ['research', 'paper'], title: 'New paper shows small models can match large ones on routing tasks', source: 'arXiv', link: 'https://arxiv.org/abs/2611.00001', snippet: 'Authors report parity on routing benchmarks at a tenth of the cost.', h: 13 },
  { tags: ['mcp', 'protocol', 'framework'], title: 'Model Context Protocol adds authorization improvements', source: 'modelcontextprotocol.io', link: 'https://modelcontextprotocol.io/blog/auth-improvements', snippet: 'The spec revision tightens OAuth handling for remote MCP servers.', h: 16 },
  { tags: ['enterprise', 'applied', 'deployment'], title: 'Survey finds enterprises deploying agents mostly for internal IT workflows', source: 'IBM', link: 'https://www.ibm.com/think/agent-survey', snippet: 'A survey of 800 IT leaders ranks internal IT workflows first.', h: 20 },
  { tags: ['agentic'], title: 'Old coverage of agent frameworks from last month', source: 'Blog', link: 'https://example.com/old-agents', snippet: 'Out of window.', h: 24 * 20 },
];

function deepWalk(obj, fn) {
  fn(obj);
  if (obj && typeof obj === 'object') for (const v of Object.values(obj)) deepWalk(v, fn);
}

export function startMockProviders({ port = 0 } = {}) {
  const state = { requests: [], xOverlongOnFirstAttempt: false, xOverlongRemaining: 0, failOpenAI: null };

  const sendJson = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const keyOf = (req, url) => (req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('api_key') || '';

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const key = keyOf(req, url);
    state.requests.push({ method: req.method, path: url.pathname, key });
    let body = '';
    for await (const c of req) body += c;

    /* ----------------------------- SerpAPI ----------------------------- */
    if (url.pathname === '/account') {
      if (key.includes('bad')) return sendJson(res, 401, { error: 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key' });
      return sendJson(res, 200, { total_searches_left: 241 });
    }
    if (url.pathname === '/search.json') {
      if (key.includes('bad')) return sendJson(res, 401, { error: 'Invalid API key.' });
      if (key.includes('ratelimit')) return sendJson(res, 429, { error: 'Your account has run out of searches.' });
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const hits = POOL.filter((p) => p.tags.some((t) => q.includes(t)));
      if (!hits.length) return sendJson(res, 200, { error: "Google hasn't returned any results for this query." });
      return sendJson(res, 200, {
        news_results: hits.map((p) => ({ title: p.title, link: p.link, source: { name: p.source }, snippet: p.snippet, date: relative(p.h), iso_date: p.h < 24 * 3 ? iso(p.h) : undefined })),
      });
    }

    /* ----------------------------- OpenAI ------------------------------ */
    if (url.pathname.startsWith('/v1/models/')) {
      if (key.includes('bad')) return sendJson(res, 401, { error: { message: `Incorrect API key provided: ${key}.`, code: 'invalid_api_key' } });
      if (url.pathname.endsWith('/nomodel')) return sendJson(res, 404, { error: { message: 'The model does not exist', code: 'model_not_found' } });
      return sendJson(res, 200, { id: decodeURIComponent(url.pathname.split('/').pop()), object: 'model' });
    }
    if (url.pathname === '/v1/chat/completions') {
      if (key.includes('bad')) return sendJson(res, 401, { error: { message: `Incorrect API key provided: ${key}.`, code: 'invalid_api_key' } });
      if (key.includes('ratelimit')) return sendJson(res, 429, { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }, { 'retry-after': '12' });
      if (state.failOpenAI && state.failOpenAI(JSON.parse(body))) return sendJson(res, 500, { error: { message: 'boom' } });
      const req_ = JSON.parse(body);
      const schemaName = req_.response_format?.json_schema?.name;
      const user = JSON.parse(req_.messages[1].content);
      const content = respond(schemaName, user, state);
      await new Promise((r) => setTimeout(r, 150));
      return sendJson(res, 200, { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
    }
    sendJson(res, 404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ url: `http://127.0.0.1:${p}`, port: p, state, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function respond(schemaName, user, state) {
  if (schemaName === 'research_ideas') {
    const left = { ...user.ideasWanted };
    const ideas = [];
    for (const c of user.candidates) {
      const cat = /peoplesoft/i.test(c.title) ? 'peoplesoft' : /oracle|oci/i.test(c.title) ? 'oracle' : 'general';
      if (!left[cat]) continue;
      left[cat]--;
      ideas.push({
        category: cat,
        headline: c.title,
        summary: `${c.snippet} Reported by ${c.publisher}.`,
        angle: cat === 'general' ? 'What this changes for teams shipping agents this quarter.' : `What this means for ${cat === 'oracle' ? 'Oracle Database and OCI operators' : 'PeopleSoft administrators'}.`,
        confirmedDevelopment: c.snippet,
        proposedApplication: 'Could be evaluated in a sandbox environment before any production rollout (proposal, not a confirmed capability).',
        sourceIds: [c.id],
      });
    }
    return { ideas };
  }
  if (schemaName === 'linkedin_posts') {
    return {
      posts: user.ideas.map((i) => ({
        ideaNumber: i.ideaNumber,
        hook: `${i.headline.slice(0, 120)} — and it changes how you plan your next release.`,
        body: `${i.confirmedDevelopment}\n\nIn plain terms, an "agent" is software that decides which tool to call next instead of following a fixed script, much like a batch scheduler that rewrites its own job chain.\n\nMy read: the decision this forces is where approvals live. ${i.proposedApplication}\n\n${i.editorialNotes ? `Editor's note applied: ${i.editorialNotes}\n\n` : ''}What would you check first before letting an agent near a production integration? Start with a read-only pilot and review the audit trail after a week of real traffic.\n\n`.repeat(1).padEnd(520, ' '),
        ctaLine: i.ctaUrl ? 'If you want the checklist I use for these pilots, it is here:' : '',
      })),
    };
  }
  if (schemaName === 'x_threads') {
    return {
      threads: user.ideas.map((i) => {
        const tweets = [`${i.headline.slice(0, 140)}: the part that matters if you ship agents.`];
        for (let n = 2; n <= i.tweetCount; n++) tweets.push(`Step ${n}: ${i.confirmedDevelopment.slice(0, 120)} Try it in a sandbox and compare traces before and after.`);
        const links = i.requiredLinks.join(' ');
        const last = tweets.length - 1;
        tweets[last] = i.tweetCount === 1 ? `${tweets[0].slice(0, 120)} ${links}`.slice(0, 600) : `${tweets[last].slice(0, 100)} ${links}`;
        if (state.xOverlongRemaining > 0 && i.ideaNumber === 1 && !i.problemsToFix) {
          tweets[0] = 'x'.repeat(300);
        }
        return { ideaNumber: i.ideaNumber, tweets };
      }),
    };
  }
  if (schemaName === 'opening_review') {
    return {
      reviews: user.items.map((i) => ({
        ideaNumber: i.ideaNumber,
        standsAlone: !state.reviewFail,
        givesAudienceReasonToKeepReading: true,
        bodySupportsClaim: true,
        couldFitUnrelatedStories: false,
        problem: state.reviewFail ? 'Opening is vague.' : '',
        revisedOpening: state.reviewFail ? (state.reviewRevisedText ?? `Revised: ${i.storyHeadline.slice(0, 120)}`) : i.opening,
      })),
    };
  }
  return {};
}
