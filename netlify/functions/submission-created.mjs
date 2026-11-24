// Runs automatically every time Netlify accepts a form submission (spam already filtered).
// Newsletter signups are copied into Kit (kit.com) and tagged by the lists the reader ticked.
// Needs these Netlify environment variables: KIT_API_KEY, KIT_TAG_MONTHLY, KIT_TAG_REVIEWS.
// Without them it does nothing, and signups stay in Netlify Forms only.
export async function handler(event) {
  let payload;
  try { ({ payload } = JSON.parse(event.body || "{}")); } catch { return { statusCode: 200, body: "bad body" }; }
  if (!payload || payload.form_name !== "newsletter") return { statusCode: 200, body: "not a newsletter signup" };

  const key = process.env.KIT_API_KEY;
  if (!key) { console.log("KIT_API_KEY not set: signup kept in Netlify Forms only"); return { statusCode: 200, body: "no key" }; }

  const d = payload.data || {};
  const email = String(d.email || "").trim().toLowerCase();
  if (!email) return { statusCode: 200, body: "no email" };

  const kit = async (path, body) => {
    const res = await fetch("https://api.kit.com/v4" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kit-Api-Key": key },
      body: JSON.stringify(body)
    });
    if (!res.ok) console.log(`Kit ${path} failed: ${res.status} ${await res.text()}`);
    return res.ok;
  };

  await kit("/subscribers", { email_address: email, state: "active" });
  const tags = [];
  if (d["monthly-roundup"]) tags.push(process.env.KIT_TAG_MONTHLY);
  if (d["new-reviews"]) tags.push(process.env.KIT_TAG_REVIEWS);
  if (process.env.KIT_TAG_ES && d.language === "es") tags.push(process.env.KIT_TAG_ES);
  if (process.env.KIT_TAG_RU && d.language === "ru") tags.push(process.env.KIT_TAG_RU);
  for (const id of tags.filter(Boolean)) await kit(`/tags/${id}/subscribers`, { email_address: email });

  console.log(`Added ${email} to Kit with ${tags.filter(Boolean).length} tag(s)`);
  return { statusCode: 200, body: "ok" };
}
