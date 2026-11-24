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

// ---------- The welcome email (Emiliya's approved wording, 24 Nov 2026) ----------
function welcomeEmail(lists) {
  const parts = [];
  if (lists.monthly) parts.push(["The monthly roundup", "once a month, which London shows are closing soon (so you can catch them in time), what's opening, and any big cast news."]);
  if (lists.reviews) parts.push(["New reviews", "an email whenever I post a new review. Some months there'll be a few, some months none. Theatre isn't my day job, so my show-going is a bit all over the place!"]);
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
    ...parts.map(([h, b]) => `${h}: ${b}\n`),
    "In the meantime:",
    ...links.map(([a, l, p, b]) => `- ${a}${l}${b} ${SITE}${p}`), "",
    "And if you ever want a recommendation, just hit reply. I read everything.", "",
    "xo, Emiliya", "",
    `The Ticket Stub Diaries · ${SITE}`
  ].join("\n");

  const p = s => `<p style="margin:0 0 16px">${s}</p>`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FFF7E6">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2D3A47">
<p style="margin:0 0 24px;font-family:Georgia,serif;font-size:22px;color:#2D3A47">The Ticket Stub <span style="color:#B46A72;font-style:italic">Diaries</span></p>
${p("Hi there,")}
${p("Thank you for signing up to The Ticket Stub Diaries!")}
${p(intro)}
${parts.map(([h, b]) => p(`<strong>${h}:</strong> ${b}`)).join("\n")}
${p("In the meantime:")}
<ul style="margin:0 0 16px;padding-left:20px">
${links.map(([a, l, path, b]) => `<li style="margin-bottom:6px">${a}<a href="${SITE}${path}" style="color:#8E4752">${l}</a>${b}</li>`).join("\n")}
</ul>
${p("And if you ever want a recommendation, just hit reply. I read everything.")}
<p style="margin:0 0 32px;font-family:'Caveat',cursive,Georgia,serif;font-size:22px;color:#8E4752">xo, Emiliya</p>
<p style="margin:0;font-size:12px;color:#8a8f96"><a href="${SITE}" style="color:#8a8f96">theticketstubdiaries.com</a></p>
</div></body></html>`;
  return { html, text };
}
