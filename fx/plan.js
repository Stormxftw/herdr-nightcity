// Plan tracking for Claude Code sessions: extracts steps from an approved plan
// (ExitPlanMode) and estimates progress from the conversation.
'use strict';

const fs = require('fs');

// Only numbered steps are trackable: Claude refers to them as "Phase 2" or "step 3".
const NUMBERED_HEADING = /^#{2,3}\s+(?:phase|step|stage|part|milestone)\s*(\d+)\b[\s:.\-—–]*(.*)$/i;
const NUMBERED_ITEM = /^(\d+)\.\s+(.+)$/;
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;

const clean = (s) => s.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

// Returns [{ n, title }] or [] when the plan has no numbered steps.
function parseSteps(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.map((l) => l.match(NUMBERED_HEADING)).filter(Boolean)
    .map((m) => ({ n: Number(m[1]), title: clean(m[2]) || `Step ${m[1]}` }));
  if (headings.length >= 2) return headings;
  const items = lines.map((l) => l.match(NUMBERED_ITEM)).filter(Boolean)
    .map((m) => ({ n: Number(m[1]), title: clean(m[2]) }));
  return items.length >= 2 ? items : [];
}

// Exact progress when the plan file uses checkboxes: { done, total, current } or null.
function checkboxProgress(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const boxes = text.split(/\r?\n/).map((l) => l.match(CHECKBOX)).filter(Boolean);
  if (boxes.length < 2) return null;
  const done = boxes.filter((b) => b[1] !== ' ').length;
  const next = boxes.find((b) => b[1] === ' ');
  return { done, total: boxes.length, current: next ? clean(next[2]) : null };
}

// Tracks one session's plan. Feed it transcript entries in order.
class PlanTracker {
  constructor() {
    this.steps = [];
    this.file = null;
    this.reached = -1;  // highest step index Claude has started
    this.finished = -1; // highest step index Claude has said is done
  }

  onEntry(e, line) {
    const m = e.message;
    if (e.type === 'assistant' && m && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === 'tool_use' && b.name === 'ExitPlanMode' && b.input && b.input.plan) {
          this.steps = parseSteps(b.input.plan);
          this.reached = this.steps.length ? 0 : -1;
          this.finished = -1;
          this.file = null;
        } else if (b.type === 'text' && this.steps.length) {
          this.scan(b.text);
        }
      }
    }
    if (this.steps.length && !this.file && line.includes('"planFilePath"')) {
      const p = line.match(/"planFilePath":"((?:[^"\\]|\\.)+)"/);
      if (p) this.file = JSON.parse(`"${p[1]}"`);
    }
  }

  // "Phase 2 is done", "Starting step 3", ...
  scan(text) {
    const index = (n) => this.steps.findIndex((s) => s.n === Number(n));
    for (const m of text.matchAll(/\b(?:phase|step|stage|part|milestone)\s+(\d+)\b/gi)) {
      const i = index(m[1]);
      if (i > this.reached) this.reached = i;
    }
    const doneRe = /\b(?:phase|step|stage|part|milestone)\s+(\d+)\b[^.\n]{0,40}?\b(?:is |are )?(?:done|complete|completed|finished)\b/gi;
    for (const m of text.matchAll(doneRe)) {
      const i = index(m[1]);
      if (i > this.finished) this.finished = i;
    }
  }

  // { done, total, current } or null when there's no plan.
  progress() {
    if (!this.steps.length) return null;
    const exact = this.file && checkboxProgress(this.file);
    if (exact) return exact;
    const total = this.steps.length;
    const done = Math.min(total, this.finished + 1);
    const at = Math.max(done, this.reached);
    return { done, total, current: at < total ? this.steps[at].title : null };
  }
}

module.exports = { parseSteps, PlanTracker };

if (require.main === module) {
  for (const f of process.argv.slice(2)) {
    console.log(`== ${f}`);
    for (const s of parseSteps(fs.readFileSync(f, 'utf8'))) console.log(`  ${s.n}. ${s.title}`);
  }
}
