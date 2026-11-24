// Runs automatically every time Netlify accepts a form submission (spam already filtered).
// For newsletter signups it:
//   1. copies the reader into Kit (kit.com) and tags them by the lists they ticked and their language;
//   2. sends a welcome email straight away through Resend (resend.com), unless they were already subscribed.
// Netlify environment variables:
//   KIT_API_KEY, KIT_TAG_MONTHLY, KIT_TAG_REVIEWS, KIT_TAG_ES, KIT_TAG_RU   (Kit)
//   RESEND_API_KEY                                                          (welcome email)
// Anything missing is skipped; signups are always kept in Netlify Forms as well.

const SITE = "https://theticketstubdiaries.com";
const FROM = "Emiliya at The Ticket Stub Diaries <hello@theticketstubdiaries.com>";
const REPLY_TO = "em.sivankova@gmail.com";

export async function handler(event) {
  let payload;
  try { ({ payload } = JSON.parse(event.body || "{}")); } catch { return ok("bad body"); }
  if (!payload || payload.form_name !== "newsletter") return ok("not a newsletter signup");

  const d = payload.data || {};
  const email = String(d.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return ok("no email");
  const lists = { monthly: !!d["monthly-roundup"], reviews: !!d["new-reviews"] };

  const alreadySubscribed = await addToKit(email, lists, d.language);
  if (!alreadySubscribed) await sendWelcome(email, lists);
  return ok("done");
}

const ok = body => ({ statusCode: 200, body });

async function addToKit(email, lists, language) {
  const key = process.env.KIT_API_KEY;
  if (!key) { console.log("KIT_API_KEY not set: Kit skipped"); return false; }
  const headers = { "Content-Type": "application/json", "X-Kit-Api-Key": key };
  const kit = async (path, body) => {
    const res = await fetch("https://api.kit.com/v4" + path, body
      ? { method: "POST", headers, body: JSON.stringify(body) }
      : { headers });
    if (!res.ok) console.log(`Kit ${path} failed: ${res.status} ${await res.text()}`);
    return res.ok ? res.json().catch(() => ({})) : null;
  };

  // Were they already an active subscriber? (Then they've had a welcome before.)
  const existing = await kit(`/subscribers?email_address=${encodeURIComponent(email)}&status=active`);
  const already = !!(existing && existing.subscribers && existing.subscribers.length);

  await kit("/subscribers", { email_address: email, state: "active" });
  const tags = [];
  if (lists.monthly) tags.push(process.env.KIT_TAG_MONTHLY);
  if (lists.reviews) tags.push(process.env.KIT_TAG_REVIEWS);
  if (language === "es") tags.push(process.env.KIT_TAG_ES);
  if (language === "ru") tags.push(process.env.KIT_TAG_RU);
  for (const id of tags.filter(Boolean)) await kit(`/tags/${id}/subscribers`, { email_address: email });
  console.log(`Kit: ${email} ${already ? "updated" : "added"} with ${tags.filter(Boolean).length} tag(s)`);
  return already;
}

async function sendWelcome(email, lists) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log("RESEND_API_KEY not set: welcome email skipped"); return; }
  const { html, text } = welcomeEmail(lists);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: FROM, to: [email], reply_to: REPLY_TO, subject: "Welcome to The Ticket Stub Diaries 🎟️", html, text })
  });
  console.log(res.ok ? `Welcome sent to ${email}` : `Resend failed: ${res.status} ${await res.text()}`);
}

// ---------- The welcome email (Emiliya's approved wording, 24 Nov 2026; styled like the site) ----------
// Email apps ignore most modern CSS, so this uses tables and inline styles. The header, signature and
// footer edge are PNGs in static/email/ so the site's doodles and fonts show everywhere (Gmail included).
const C = { cream: "#FFF7E6", paper: "#FFFDF8", blush: "#F7C8D3", rose: "#B46A72", roseInk: "#8E4752", sage: "#A8B58A", sageSoft: "#E7ECD9", butter: "#F6E3A1", ink: "#2D3A47", soft: "#5B6876" };
const HEAD = "'Yeseva One', Georgia, 'Times New Roman', serif";
const BODY = "Nunito, 'Helvetica Neue', Helvetica, Arial, sans-serif";

function welcomeEmail(lists) {
  const parts = [];
  if (lists.monthly) parts.push({ bg: C.butter, cls: "bg-butter", h: "The monthly roundup", b: "once a month, which London shows are closing soon (so you can catch them in time), what's opening, and any big cast news." });
  if (lists.reviews) parts.push({ bg: C.blush, cls: "bg-blush", h: "New reviews", b: "an email whenever I post a new review. Some months there'll be a few, some months none. Theatre isn't my day job, so my show-going is a bit all over the place!" });
  const links = [
    ["Not sure what to see? Try the ", "quiz", "/where-to-start/", " and you'll get three picks in under a minute."],
    ["See ", "what's on in London", "/whats-on/", " right now, including what's closing soon."],
    ["Nosy? Here's ", "every show I've ever seen", "/log/", "."]
  ];
  const intro = parts.length === 1 ? "Here's what you've signed up for:" : "Here's what you'll get:";

  const text = [
    "Hi there,", "",
    "Thank you for signing up to The Ticket Stub Diaries!", "",
    intro, "",
    ...parts.map(x => `${x.h}: ${x.b}\n`),
    "In the meantime:",
    ...links.map(([a, l, p, b]) => `- ${a}${l}${b} ${SITE}${p}`), "",
    "And if you ever want a recommendation, just hit reply. I read everything.", "",
    "xo, Emiliya", "",
    `The Ticket Stub Diaries · ${SITE}`,
    "You're getting this because you signed up on the website."
  ].join("\n");

  const para = s => `<p class="t-main" style="margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:1.6;color:${C.ink}">${s}</p>`;
  const stub = x => `
      <tr><td style="padding:0 0 12px">
        <table class="${x.cls}" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${x.bg};border-radius:16px">
          <tr><td style="padding:16px 20px;border-left:3px dashed ${C.paper}">
            <p class="t-ink" style="margin:0 0 4px;font-family:${HEAD};font-size:18px;color:${C.ink}">${x.h}</p>
            <p class="t-ink" style="margin:0;font-family:${BODY};font-size:15px;line-height:1.55;color:${C.ink}">${x.b.charAt(0).toUpperCase() + x.b.slice(1)}</p>
          </td></tr>
        </table>
      </td></tr>`;
  const link = ([a, l, path, b]) => `
          <tr><td class="t-ink" style="padding:0 0 10px;font-family:${BODY};font-size:15px;line-height:1.55;color:${C.ink}">
            <span class="t-link" style="color:${C.roseInk}">&#9733;</span>&nbsp; ${a}<a class="t-link" href="${SITE}${path}" style="color:${C.roseInk};font-weight:700;text-decoration:underline">${l}</a>${b}
          </td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
  /* Our own dark mode, so apps that support it use these colours instead of auto-darkening the email */
  @media (prefers-color-scheme: dark) {
    .bg-outer { background:#1F2731 !important; }
    .bg-card { background:#2D3A47 !important; }
    .t-main { color:#FFF7E6 !important; }
    .t-eyebrow { color:#F7C8D3 !important; }
    .bg-butter { background:#F6E3A1 !important; }
    .bg-blush { background:#F7C8D3 !important; }
    .bg-sage { background:#A8B58A !important; }
    .t-ink { color:#2D3A47 !important; }
    .t-link { color:#6E2F3A !important; }
    .btn { background:#F7C8D3 !important; color:#2D3A47 !important; }
  }
  /* Outlook.com and Outlook apps */
  [data-ogsb] .bg-outer { background:#1F2731 !important; }
  [data-ogsb] .bg-card { background:#2D3A47 !important; }
  [data-ogsc] .t-main { color:#FFF7E6 !important; }
  [data-ogsc] .t-eyebrow { color:#F7C8D3 !important; }
  [data-ogsb] .bg-butter { background:#F6E3A1 !important; }
  [data-ogsb] .bg-blush { background:#F7C8D3 !important; }
  [data-ogsb] .bg-sage { background:#A8B58A !important; }
  [data-ogsc] .t-ink { color:#2D3A47 !important; }
  [data-ogsc] .t-link { color:#6E2F3A !important; }
  [data-ogsb] .btn { background:#F7C8D3 !important; }
  [data-ogsc] .btn { color:#2D3A47 !important; }
</style>
<title>Welcome to The Ticket Stub Diaries</title>
<link href="https://fonts.googleapis.com/css2?family=Yeseva+One&family=Nunito:wght@400;700;800&display=swap" rel="stylesheet">
</head>
<body class="bg-outer" style="margin:0;padding:0;background:${C.cream}">
<div style="display:none;max-height:0;overflow:hidden">Here's what's coming your way, plus a few things to explore in the meantime.</div>
<table class="bg-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream}">
<tr><td align="center" style="padding:0">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
    <tr><td><a href="${SITE}"><img src="${SITE}/email/header.png" width="600" alt="The Ticket Stub Diaries" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>
    <tr><td style="padding:0 16px 24px">
      <table class="bg-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};border-radius:22px">
        <tr><td style="padding:32px 28px 12px">
          <p class="t-eyebrow" style="margin:0 0 6px;font-family:${BODY};font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${C.rose}">You're in!</p>
          <h1 class="t-main" style="margin:0 0 20px;font-family:${HEAD};font-weight:400;font-size:28px;line-height:1.2;color:${C.ink}">Welcome to The Ticket Stub Diaries</h1>
          ${para("Hi there,")}
          ${para("Thank you for signing up to The Ticket Stub Diaries!")}
          ${para(intro)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${parts.map(stub).join("")}
          </table>
        </td></tr>
        <tr><td style="padding:8px 28px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-sage" style="background:${C.sageSoft};border-radius:16px">
            <tr><td style="padding:18px 20px 8px">
              <p class="t-ink" style="margin:0 0 12px;font-family:${HEAD};font-size:18px;color:${C.ink}">In the meantime:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${links.map(link).join("")}
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:22px 28px 6px">
          <a class="btn" href="${SITE}/where-to-start/" style="display:inline-block;background:${C.ink};color:${C.paper};font-family:${BODY};font-weight:800;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;padding:14px 26px;border-radius:999px">Find your first musical</a>
        </td></tr>
        <tr><td style="padding:20px 28px 4px">${para("And if you ever want a recommendation, just hit reply. I read everything.")}</td></tr>
        <tr><td style="padding:0 28px 30px"><img src="${SITE}/email/sig.png" width="155" alt="xo, Emiliya" style="display:block;width:155px;height:auto;border:0"></td></tr>
      </table>
    </td></tr>
    <tr><td><img src="${SITE}/email/scallops-sage.png" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
    <tr><td class="bg-sage t-ink" style="background:${C.sage};padding:18px 24px 26px;text-align:center;font-family:${BODY};font-size:13px;line-height:1.6;color:${C.ink}">
      <a class="t-ink" href="${SITE}" style="color:${C.ink};font-weight:800;text-decoration:none">theticketstubdiaries.com</a><br>
      You're getting this because you signed up on the website.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
  return { html, text };
}
