#!/usr/bin/env python3
"""Build The Ticket Stub Diaries into public/ (what Netlify serves).

    python3 build.py            # build and pre-render (needs Playwright + Chromium)
    python3 build.py --fast     # build without pre-rendering (for quick checks only)

Sources:
  src/template.html      the whole site (styles, all sections, data lists, translations, scripts)
  content/reviews/*.md   one file per review (see content/reviews/_example.md); files starting with _ are skipped
  static/                copied as-is (icons, og-image, manifest)

Every page is written as its own file with its own title, description, canonical URL and
structured data, and then pre-rendered in a headless browser so Google gets the full English
text in the HTML. Commit public/ after building; Netlify publishes it (see netlify.toml).
"""
import datetime, html, json, re, shutil, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

import markdown

ROOT = Path(__file__).parent
OUT = ROOT / "public"
SITE = "https://theticketstubdiaries.com"
BRAND = "The Ticket Stub Diaries"
TODAY = datetime.date.today()
MONTH = TODAY.strftime("%B %Y")
AUTHOR = {"@type": "Person", "name": "Emiliya", "url": SITE + "/about/"}

# key (matches <section data-view>), path, <title>, meta description
PAGES = [
    ("home", "/",
     "The Ticket Stub Diaries | Honest London Theatre and Musical Reviews",
     "Honest reviews of West End musicals and plays from someone who's seen over 100 shows. What's on in London, shows closing soon, and a quiz to find your first musical."),
    ("reviews", "/reviews/",
     "West End Musical and Theatre Reviews | The Ticket Stub Diaries",
     "Honest reviews of West End musicals and London plays, with star ratings, the best seats and who each show is (and isn't) for."),
    ("whats-on", "/whats-on/",
     f"What's On in London Theatre ({MONTH}): Closing Soon and New Shows",
     f"What's on in the West End in {MONTH}: London musicals and plays closing soon, open-run favourites, star castings and new shows opening next."),
    ("start", "/where-to-start/",
     "Which Musical Should I See in London? First-Timer's Quiz",
     "New to musicals? Answer five quick questions and get three West End shows to try first, including family-friendly picks for kids and the best shows for sceptics."),
    ("log", "/log/",
     "Every Musical and Play I've Seen: 100+ Performances | The Ticket Stub Diaries",
     "The Log: every musical and play I've seen since I was about 10, in London's West End, Madrid, Moscow and New York, and how many times."),
    ("about", "/about/",
     "About Emiliya | The Ticket Stub Diaries",
     "I'm Emiliya: a trained dancer and actor who has seen over 100 theatre performances, writing honest reviews of London musicals and plays in English, Spanish and Russian."),
    ("contact", "/contact/",
     "Contact and Press Invitations | The Ticket Stub Diaries",
     "Get in touch with The Ticket Stub Diaries: questions, show recommendations, and press night and PR invitations for London theatre."),
    ("review-template", "/reviews/template/",
     "Review template | The Ticket Stub Diaries",
     "How reviews on The Ticket Stub Diaries are laid out."),
]
NOINDEX = {"review-template", "notfound"}
CRUMB = {"reviews": "Reviews", "whats-on": "What's on", "start": "Where do I start?", "log": "The Log",
         "about": "About", "contact": "Contact", "review-template": "Review template"}

NOT_FOUND = """  <section data-view="notfound">
    <div class="page-head">
      <div class="eyebrow">Error 404</div>
      <h1 class="page-title">This seat doesn't exist</h1>
      <p class="lede">The page you were looking for has closed, moved, or never opened. Try <a href="/">the home page</a>, <a href="/reviews/">the reviews</a> or <a href="/whats-on/">what's on in London</a>.</p>
    </div>
  </section>"""

esc = lambda s: html.escape(str(s), quote=True)


def stars_html(n):
    full, half = int(n), (n % 1) >= 0.5
    empty = 5 - full - (1 if half else 0)
    return (f'<span class="stars" aria-label="{n} out of 5">{"★" * full}'
            + ('<span class="half">★</span>' if half else "")
            + f'<span class="off">{"★" * empty}</span></span>')


def read_reviews():
    reviews = []
    for f in sorted((ROOT / "content/reviews").glob("*.md")):
        if f.name.startswith("_"):
            continue
        text = f.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
        if not m:
            sys.exit(f"{f.name}: missing --- front matter ---")
        meta = {}
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        for req in ("show", "verdict", "rating", "venue", "published"):
            if not meta.get(req):
                sys.exit(f"{f.name}: '{req}' is required")
        meta["slug"] = meta.get("slug") or f.stem
        meta["rating"] = float(meta["rating"])
        meta["tags"] = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
        meta["archive"] = meta.get("archive", "no").lower() in ("yes", "true")
        meta["body"] = markdown.markdown(m.group(2), extensions=["extra", "smarty"])
        reviews.append(meta)
    reviews.sort(key=lambda r: r["published"], reverse=True)
    return reviews


def review_section(r):
    kind = "From the archive" if r["archive"] else "Review"
    facts = [("Venue", ", ".join(x for x in (r["venue"], r.get("city", "London")) if x)),
             ("Seen", r.get("seen")), ("Seat", r.get("seat")), ("Times seen", r.get("times_seen"))]
    facts_html = "".join(f'<div><span>{k}</span>{esc(v)}</div>' for k, v in facts if v)
    chips = " ".join(f'<span class="chip">{esc(t)}</span>' for t in r["tags"])
    return f"""  <section data-view="review" class="on">
    <article class="review" lang="en">
      <p><a href="/reviews/">&larr; All reviews</a></p>
      <div class="eyebrow">{kind}</div>
      <h1>{esc(r["show"])} review</h1>
      <p class="verdict">{esc(r["verdict"])}</p>
      {stars_html(r["rating"])}
      <div class="review-facts">{facts_html}</div>
      {r["body"]}
      {f'<p style="margin-top:20px">{chips}</p>' if chips else ""}
      <p class="sign">xo, Emiliya</p>
    </article>
  </section>"""


def breadcrumbs(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + p} for i, (n, p) in enumerate(items)]}


def jsonld(graph):
    return ('<script type="application/ld+json">'
            + json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False)
            + "</script>")


def render(tpl, *, page, path, title, desc, section_html=None, og_type="website", ld=None, reviews_js="[]"):
    s = tpl
    if section_html is not None:  # replace all sections with this one
        s = re.sub(r'\s*<section data-view="[^"]+".*?</section>', "", s, flags=re.S)
        s = s.replace("</main>", section_html + "\n</main>", 1)
    else:  # keep only this page's section
        def keep(m):
            return m.group(0).replace(f'data-view="{page}"', f'data-view="{page}" class="on"') if m.group(1) == page else ""
        s = re.sub(r'\s*<section data-view="([^"]+)"[^>]*>.*?</section>', keep, s, flags=re.S)
        s = s.replace(f'data-view="{page}" class="on" class="on"', f'data-view="{page}" class="on"')
    url = SITE + path
    rep = {"{{TITLE}}": esc(title), "{{OGTITLE}}": esc(title), "{{DESC}}": esc(desc), "{{URL}}": url,
           "{{OGTYPE}}": og_type, "{{PAGE}}": page,
           "{{ROBOTS}}": "noindex, follow" if page in NOINDEX else "index, follow, max-image-preview:large",
           "{{JSONLD}}": jsonld(ld) if ld else ""}
    for k, v in rep.items():
        s = s.replace(k, v)
    s = s.replace("/*REVIEWS*/[]/*END_REVIEWS*/", reviews_js)
    assert "{{" not in s, re.findall(r"\{\{\w+\}\}", s)
    return s


def write(path, content):
    f = OUT / (path.strip("/") + "/index.html" if path.endswith("/") else path.strip("/"))
    if path == "/":
        f = OUT / "index.html"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content, encoding="utf-8")
    return f


def build():
    tpl = (ROOT / "src/template.html").read_text(encoding="utf-8")
    reviews = read_reviews()
    cards = [{"id": r["slug"], "title": r["show"], "meta": r.get("meta") or r["verdict"], "rating": r["rating"]} for r in reviews]
    cards.append({"id": "template", "title": "Review template", "meta": "How every review will look", "rating": 4, "example": True})
    reviews_js = json.dumps(cards, ensure_ascii=False)

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for f in (ROOT / "static").iterdir():
        shutil.copy(f, OUT / f.name)

    website = {"@type": "WebSite", "@id": SITE + "/#website", "name": BRAND, "url": SITE + "/",
               "inLanguage": "en-GB", "description": PAGES[0][3], "publisher": AUTHOR}
    sitemap, written = [], []
    for page, path, title, desc in PAGES:
        ld = [website] if page == "home" else [breadcrumbs([("Home", "/")] + ([("Reviews", "/reviews/")] if page == "review-template" else []) + [(CRUMB[page], path)])]
        if page == "about":
            ld.append({"@type": "ProfilePage", "url": SITE + path, "mainEntity": {**AUTHOR, "jobTitle": "Theatre reviewer", "knowsLanguage": ["en", "es", "ru"]}})
        written.append((path, write(path, render(tpl, page=page, path=path, title=title, desc=desc, ld=ld, reviews_js=reviews_js))))
        if page not in NOINDEX:
            sitemap.append((path, TODAY.isoformat()))

    for r in reviews:
        path = f"/reviews/{r['slug']}/"
        title = f"{r['show']} review: {r['verdict']}"
        if len(title) > 70:
            title = f"{r['show']} review ({r.get('city', 'London')}) | {BRAND}"
        desc = r.get("description") or f"{r['show']} at {r['venue']} reviewed: {r['verdict']} Rated {r['rating']:g}/5, with the best seats and who it's for."
        review_ld = {"@type": "Review", "name": f"{r['show']} review", "headline": title, "author": AUTHOR,
                     "publisher": AUTHOR, "datePublished": r["published"], "url": SITE + path,
                     "reviewBody": r["verdict"],
                     "reviewRating": {"@type": "Rating", "ratingValue": r["rating"], "bestRating": 5, "worstRating": 0.5},
                     "itemReviewed": {"@type": "CreativeWork", "name": r["show"],
                                      "genre": "Musical theatre" if r.get("type", "musical") == "musical" else "Play"}}
        ld = [review_ld, breadcrumbs([("Home", "/"), ("Reviews", "/reviews/"), (r["show"], path)])]
        written.append((path, write(path, render(tpl, page="review", path=path, title=title, desc=desc,
                                                section_html=review_section(r), og_type="article", ld=ld, reviews_js=reviews_js))))
        sitemap.append((path, r.get("updated") or r["published"]))

    written.append(("/404.html", write("/404.html", render(tpl, page="notfound", path="/404.html", title=f"Page not found | {BRAND}",
                                                          desc="This page doesn't exist.", section_html=NOT_FOUND, reviews_js=reviews_js))))

    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{SITE}{p}</loc><lastmod>{d}</lastmod></url>\n" for p, d in sitemap)
        + "</urlset>\n", encoding="utf-8")
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8")
    return written


def prerender(written):
    """Open every page in headless Chromium and save the fully rendered English HTML."""
    from playwright.sync_api import sync_playwright
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(OUT))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()
        ctx.route(re.compile(r"^https?://(?!127\.0\.0\.1)"), lambda route: route.abort())  # no fonts/stats while rendering
        for path, f in written:
            pg = ctx.new_page()
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(f"http://127.0.0.1:{port}{path}", wait_until="load")
            pg.wait_for_timeout(150)
            if errors:
                sys.exit(f"JS error on {path}: {errors}")
            f.write_text("<!DOCTYPE html>\n" + pg.evaluate("document.documentElement.outerHTML"), encoding="utf-8")
            pg.close()
        b.close()
    srv.shutdown()


if __name__ == "__main__":
    written = build()
    if "--fast" not in sys.argv:
        prerender(written)
    print(f"Built {len(written)} pages into public/")
