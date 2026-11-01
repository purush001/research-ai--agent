import './style.css';
import { loadSettings, saveSettings, hasKeys, DEFAULT_MODEL } from './settings.js';
import { runResearch } from './agents/research.js';
import { writeLinkedInPost } from './agents/linkedin.js';
import { writeThread, MAX_TWEET } from './agents/twitter.js';
import { h, copyText, autosize } from './ui.js';

const $ = (id) => document.getElementById(id);
const state = { ideas: [], selected: new Set(), running: false };

/* ---------- settings dialog ---------- */
const dialog = $('settings-dialog');

function refreshKeyDot() {
  $('key-dot').classList.toggle('ok', hasKeys(loadSettings()));
}
function openSettings() {
  const s = loadSettings();
  $('openai-key').value = s.openaiKey;
  $('serp-key').value = s.serpKey;
  $('model').value = s.model;
  $('remember').checked = s.remember;
  dialog.showModal();
}
$('settings-btn').addEventListener('click', openSettings);
$('settings-cancel').addEventListener('click', () => dialog.close());
$('settings-form').addEventListener('submit', () => {
  saveSettings({
    openaiKey: $('openai-key').value.trim(),
    serpKey: $('serp-key').value.trim(),
    model: $('model').value.trim() || DEFAULT_MODEL,
    remember: $('remember').checked,
  });
  refreshKeyDot();
});

/* ---------- stepper + activity feed ---------- */
function setStep(n) {
  document.querySelectorAll('#steps li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
  });
}
function log(msg, kind = '') {
  const feed = $('feed');
  feed.hidden = false;
  feed.append(h('li', { class: kind }, msg));
  feed.lastElementChild.scrollIntoView({ block: 'nearest' });
}

function requireKeys() {
  const s = loadSettings();
  if (hasKeys(s)) return s;
  openSettings();
  return null;
}

/* ---------- step 1: Research Agent ---------- */
$('research-btn').addEventListener('click', async () => {
  const settings = requireKeys();
  if (!settings || state.running) return;

  state.running = true;
  state.ideas = [];
  state.selected.clear();
  $('feed').replaceChildren();
  $('select-card').hidden = true;
  $('output').hidden = true;
  setStep(1);
  const btn = $('research-btn');
  btn.disabled = true;
  btn.textContent = 'Researching…';

  try {
    state.ideas = await runResearch({
      settings,
      focus: $('focus').value.trim(),
      period: $('period').value,
      log,
    });
    renderIdeas();
    $('select-card').hidden = false;
    setStep(2);
    $('select-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    log(`Research failed — ${e.message}`, 'error');
  } finally {
    state.running = false;
    btn.disabled = false;
    btn.textContent = 'Run Research Agent again';
  }
});

/* ---------- step 2: human picks top 3 ---------- */
function renderIdeas() {
  $('ideas').replaceChildren(
    ...state.ideas.map((idea, i) => {
      const input = h('input', { type: 'checkbox', 'aria-label': `Select idea ${i + 1}` });
      input.addEventListener('change', () => {
        if (input.checked && state.selected.size >= 3) {
          input.checked = false; // cap at 3
          return;
        }
        input.checked ? state.selected.add(idea.id) : state.selected.delete(idea.id);
        label.classList.toggle('selected', input.checked);
        updateSelection();
      });
      const label = h(
        'label',
        { class: 'idea' },
        input,
        h(
          'div',
          {},
          h('div', { class: 'idea-title' }, h('span', { class: 'num' }, i + 1), idea.title),
          h('p', {}, idea.angle),
          h('p', { class: 'muted small' }, `Why now: ${idea.whyNow}`),
          h(
            'div',
            { class: 'src small' },
            idea.sources.map((s) => h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.source || 'source')),
          ),
        ),
      );
      return label;
    }),
  );
  updateSelection();
}

function updateSelection() {
  const n = state.selected.size;
  $('sel-count').textContent = `${n} / 3`;
  $('generate-btn').disabled = n !== 3 || state.running;
  document.querySelectorAll('.idea').forEach((el) => {
    const cb = el.querySelector('input');
    el.classList.toggle('locked', n >= 3 && !cb.checked);
  });
}

/* ---------- step 3: LinkedIn + X agents, in parallel ---------- */
function normaliseLink(raw) {
  const v = raw.trim();
  if (!v) return '';
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}

// Reads the CTA link / thread length from the form at the moment an agent runs,
// so "Regenerate" picks up edits made after the first generation.
function readOptions() {
  const ctaLink = normaliseLink($('cta-link').value);
  if (ctaLink === null) throw new Error('That CTA link doesn’t look like a valid URL.');
  const count = Math.round(Number($('tweet-count').value));
  if (!(count >= 2 && count <= 20)) throw new Error('Tweets per thread must be between 2 and 20.');
  return { ctaLink, count };
}

$('generate-btn').addEventListener('click', async () => {
  const settings = requireKeys();
  if (!settings || state.running) return;

  const err = $('options-error');
  err.hidden = true;
  try {
    readOptions();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    return;
  }

  const chosen = state.ideas.filter((i) => state.selected.has(i.id));
  state.running = true;
  const btn = $('generate-btn');
  btn.disabled = true;
  btn.textContent = 'Agents are writing…';
  setStep(3);
  $('output').hidden = false;

  const liCards = chosen.map((idea) => linkedinCard(idea, () => writeLinkedInPost({ settings, idea, ctaLink: readOptions().ctaLink })));
  const twCards = chosen.map((idea) => threadCard(idea, () => writeThread({ settings, idea, count: readOptions().count })));
  $('li-out').replaceChildren(...liCards.map((c) => c.el));
  $('tw-out').replaceChildren(...twCards.map((c) => c.el));
  $('output').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Both agents work at the same time; each idea is its own request so one failure never blocks the rest.
  await Promise.all([...liCards, ...twCards].map((c) => c.run()));

  state.running = false;
  btn.textContent = 'Approve & generate LinkedIn + X content';
  updateSelection();
});

/* ---------- result cards ---------- */
function cardShell(kicker, idea, run, renderBody) {
  const body = h('div', { class: 'card-body' });
  const regen = h('button', { class: 'btn ghost small-btn', type: 'button' }, '↻ Regenerate');
  const el = h(
    'article',
    { class: 'card result' },
    h('div', { class: 'result-head' }, h('div', {}, h('div', { class: 'kicker' }, kicker), h('h3', {}, idea.title)), regen),
    body,
  );

  const api = {
    el,
    async run() {
      regen.disabled = true;
      body.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Writing…'));
      try {
        body.replaceChildren(...renderBody(await run()).filter(Boolean));
      } catch (e) {
        body.replaceChildren(h('p', { class: 'error' }, e.message));
      }
      regen.disabled = false;
    },
  };
  regen.addEventListener('click', () => api.run());
  return api;
}

function linkedinCard(idea, run) {
  return cardShell('LinkedIn post', idea, run, ({ text }) => {
    const ta = h('textarea', { class: 'draft', 'aria-label': 'LinkedIn post' });
    ta.value = text;
    const count = h('span', { class: 'muted small' });
    const update = () => {
      count.textContent = `${ta.value.length} / 3000 characters`;
      autosize(ta);
    };
    ta.addEventListener('input', update);
    const copy = h('button', { class: 'btn small-btn', type: 'button', onClick: () => copyText(ta.value, copy) }, 'Copy post');
    queueMicrotask(update);
    return [ta, h('div', { class: 'foot' }, count, copy)];
  });
}

function threadCard(idea, run) {
  return cardShell('X thread', idea, run, ({ tweets, warnings }) => {
    const areas = tweets.map((t) => {
      const ta = h('textarea', { class: 'draft tweet', rows: '2', 'aria-label': 'Tweet' });
      ta.value = t;
      const counter = h('span', { class: 'small' });
      const update = () => {
        const n = ta.value.length;
        counter.textContent = `${n} / ${MAX_TWEET}`;
        counter.className = `small ${n > MAX_TWEET ? 'error-text' : 'muted'}`;
        autosize(ta);
      };
      ta.addEventListener('input', update);
      queueMicrotask(update);
      const copy = h('button', { class: 'btn ghost small-btn', type: 'button', onClick: () => copyText(ta.value, copy) }, 'Copy');
      return { ta, node: h('div', { class: 'tweet-wrap' }, ta, h('div', { class: 'foot' }, counter, copy)) };
    });
    const copyAll = h(
      'button',
      {
        class: 'btn small-btn',
        type: 'button',
        onClick: () => copyText(areas.map((a) => a.ta.value).join('\n\n'), copyAll),
      },
      'Copy whole thread',
    );
    return [
      warnings?.length ? h('p', { class: 'warn' }, `Heads up: ${warnings.join(' ')} Edit below or regenerate.`) : null,
      ...areas.map((a) => a.node),
      h('div', { class: 'foot end' }, copyAll),
    ];
  });
}

/* ---------- boot ---------- */
refreshKeyDot();
if (!hasKeys(loadSettings())) openSettings();
