// Sends new Daily Forge Learning issues to Kit subscribers as a broadcast.
// Runs in GitHub Actions. Needs the repository secret KIT_API_KEY (a Kit v4 API key).
// Usage: node scripts/send-to-kit.mjs <previous-issues.js-or-empty> <current-issues.js> [mode]
//   mode: "send" (default; schedules for a few minutes from now) or "draft" (saves a draft in Kit only)
//   If FORCE_ISSUE is set (an issue number), that issue is used instead of the diff.
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const load = (path) => {
  if (!path || !existsSync(path)) return [];
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(path, "utf8"), ctx);
  return ctx.window.ISSUES || [];
};

const [, , prevPath, curPath, modeArg] = process.argv;
const mode = (process.env.MODE || modeArg || "send").toLowerCase();
const prev = load(prevPath);
const cur = load(curPath);
const prevNums = new Set(prev.map((i) => i.n));

let toSend;
if (process.env.FORCE_ISSUE) {
  toSend = cur.filter((i) => String(i.n) === String(process.env.FORCE_ISSUE));
} else {
  toSend = cur.filter((i) => !prevNums.has(i.n));
}
if (!toSend.length) { console.log(process.env.FORCE_ISSUE ? `::error::Issue #${process.env.FORCE_ISSUE} was not found in issues.js.` : "::notice::No new issues to send."); process.exit(process.env.FORCE_ISSUE ? 1 : 0); }
if (toSend.length > 1 && !process.env.FORCE_ISSUE) {
  // Safety: only ever send the newest one automatically.
  toSend = [toSend.sort((a, b) => b.n - a.n)[0]];
}

const key = process.env.KIT_API_KEY;
if (!key) { console.log("::error::The KIT_API_KEY secret is missing or empty. Add it under Settings > Secrets and variables > Actions, named exactly KIT_API_KEY."); process.exit(1); }

const CAT = { leadership: "Leadership Lesson", psychology: "Psychology", theology: "Reformed Theology in 5 Minutes", history: "History Study", growth: "Personal Development", business: "Business", philosophy: "Philosophy" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SKY = "#365A72", META = "#8A7566", TINT = "#F1ECE8", FROST = "#6991AA";
const label = (t) => `<p style="margin:24px 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:${SKY}">${t}</p>`;
const para = (t) => `<p style="margin:0;font-size:16px;line-height:1.6;color:#2B2B2B">${esc(t)}</p>`;
const callout = (t, body, border) => `<div style="margin:24px 0 0;padding:16px 18px;background:${TINT};${border ? `border-left:4px solid ${FROST};` : ""}border-radius:4px">${label(t).replace("margin:24px 0 6px", "margin:0 0 6px")}${para(body)}</div>`;

function html(i) {
  const url = `https://daily.simondaood.com/#issue-${i.n}`;
  return `
<p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;color:${META}">${esc((CAT[i.cat] || i.cat).toUpperCase())} · Issue #${i.n} · ${esc(i.date)} · 2-min read</p>
<h1 style="margin:0 0 8px;font-size:26px;line-height:1.25;color:${SKY}">${esc(i.title)}</h1>
${label("The Idea")}${para(i.idea)}
${label("The Evidence")}${para(i.evidence)}
${label("Did It Hold Up?")}${para(i.held)}
${label("The Gap")}${para(i.gap)}
${label("The Forge — " + esc(i.forge[0]))}${para(i.forge[1])}
${callout("Today's Rep", i.rep, true)}
${callout("Sit With This", i.sit, false)}
<p style="margin:24px 0 0;font-size:16px;font-weight:600;color:#2B2B2B">— Simon · @simondaood.coach</p>
<p style="margin:20px 0 0;font-size:15px"><a href="${url}" style="color:${SKY}">Read this issue and every past issue at daily.simondaood.com</a></p>
<p style="margin:24px 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:${META}">Sources</p>
<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:${META}">${i.sources.map((s) => `<li style="margin:0 0 4px"><a href="${esc(s[1])}" style="color:${SKY}">${esc(s[0])}</a></li>`).join("")}</ul>`;
}

for (const i of toSend) {
  const now = new Date();
  const sendAt = mode === "draft" ? null : new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const body = {
    subject: `The Daily Forge Learning #${i.n} — ${i.title}`,
    preview_text: i.idea,
    description: `Daily Forge Learning #${i.n} (auto from website)`,
    content: html(i),
    public: false,
    published_at: now.toISOString(),
    send_at: sendAt,
    subscriber_filter: [],
  };
  const r = await fetch("https://api.kit.com/v4/broadcasts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Kit-Api-Key": key },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) { console.log(`::error::Kit rejected the request (HTTP ${r.status}): ${text.slice(0, 500).replace(/\n/g, " ")}`); process.exit(1); }
  const b = JSON.parse(text).broadcast || {};
  console.log(`::notice::Issue #${i.n}: Kit broadcast ${b.id} created (${mode === "draft" ? "draft only" : "scheduled for " + sendAt}).`);
}
