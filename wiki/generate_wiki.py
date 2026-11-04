#!/usr/bin/env python3
"""Code wiki generator — renders tabbed-HTML articles with embedded JSON payloads,
standalone JSON data files, and Markdown indexes from content modules.

Usage:
    python3 generate_wiki.py --source /path/to/repo --out /path/to/wiki /path/to/content_dir

Content dir holds content_*.py files, each defining ARTICLES = [dict(...)] (schema in the
skill's SKILL.md). Styling: dark dossier/terminal preset (edit THEME / CATEGORY_ORDER).
"""
import argparse
import hashlib
import html
import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from glob import glob

THEME = {
    "bg": "#0A0A0A", "panel": "#131313", "panel2": "#1A1A1A",
    "border": "#262626", "border2": "#333333",
    "text": "#E6E6E6", "muted": "#8B8B8B", "faint": "#5C5C5C",
    "accent": "#E0784F", "red": "#FF5252", "amber": "#FFB000", "code": "#101010",
    "brand": "XTRACSYSCODE GUIDE", "node_label": "XTRACSYSCODE / APACHE-2.0",
}
FONT_MONO = 'ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace'
FONT_SANS = '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif'

# (key, section label, subtitle) — adjust per project
CATEGORY_ORDER = [
    ("docs", "Documents", "// requirements and goals"),
    ("agent", "Agent Core", "// the loop and its tools"),
    ("host", "Electron Host", "// main process"),
    ("renderer", "Renderer", "// React UI"),
    ("config", "Config & Meta", "// repo plumbing"),
]

GENERATION_TIME = datetime.now(timezone.utc)
GENERATED = GENERATION_TIME.strftime("%Y-%m-%d %H:%M UTC")


def load_articles(content_dir):
    articles = []
    for path in sorted(glob(os.path.join(content_dir, "content_*.py"))):
        spec = importlib.util.spec_from_file_location(os.path.basename(path)[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        articles.extend(mod.ARTICLES)
    return articles


def esc(s):
    return html.escape(str(s), quote=True)


def hid(slug, i):
    return "blk_" + hashlib.sha1(f"{slug}:{i}".encode()).hexdigest()[:10]


def doc_id(slug):
    return hashlib.sha256(slug.encode()).hexdigest()[:32]


def article_payload(a, head):
    blocks = []
    def add(kind, content, **kw):
        b = {"id": hid(a["slug"], len(blocks)), "type": kind, "content": content}
        b.update(kw)
        blocks.append(b)
    add("heading", a["title"], level=1)
    for p in a["lead"]:
        add("paragraph", p)
    for heading, paras in a.get("sections", []):
        add("heading", heading, level=2)
        for p in paras:
            add("paragraph", p)
    if a.get("key_items"):
        add("heading", "Key items", level=2)
        for name, desc in a["key_items"]:
            add("field", desc, meta={"name": name})
    props = {k: a.get(k, "") if not isinstance(a.get(k), list) else a.get(k, [])
             for k in ("category", "path", "lines", "lang", "phase", "status", "spec_refs", "related")}
    if a.get("tested_by"):
        props["tested_by"] = a["tested_by"]
    return {
        "$schema": "https://code-wiki.local/schema/article.json",
        "id": doc_id(a["slug"]), "type": "doc", "slug": a["slug"], "title": a["title"],
        "version": 1, "updated": GENERATION_TIME.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tags": [a["category"], a.get("status", "DOC"), a.get("lang", "")],
        "blocks": blocks, "properties": props,
        "audit": {"last_editor": "human:wiki-generator", "last_commit": head},
    }


def build_css():
    c = THEME
    return f"""
:root{{--bg:{c['bg']};--panel:{c['panel']};--panel2:{c['panel2']};--bd:{c['border']};
--bd2:{c['border2']};--tx:{c['text']};--mut:{c['muted']};--fnt:{c['faint']};
--ac:{c['accent']};--red:{c['red']};--amb:{c['amber']};--code:{c['code']};--mono:{FONT_MONO};--sans:{FONT_SANS}}}
*{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth}}
body{{background:var(--bg);color:var(--tx);font-family:var(--sans);font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}}
a{{color:var(--ac);text-decoration:none}} a:hover{{text-decoration:underline}}
code{{font-family:var(--mono);font-size:.86em;background:var(--code);border:1px solid var(--bd);padding:.08em .35em;border-radius:3px;color:#d7f7e4}}
pre{{font-family:var(--mono);font-size:.8rem;background:var(--code);border:1px solid var(--bd);border-radius:4px;padding:.9rem 1rem;overflow-x:auto;line-height:1.5;color:#cfe9d8}}
.wrap{{max-width:1080px;margin:0 auto;padding:0 1.25rem}}
header.top{{position:sticky;top:0;z-index:50;background:rgba(10,10,10,.93);backdrop-filter:blur(6px);border-bottom:1px solid var(--bd)}}
.topbar{{display:flex;align-items:center;gap:1.4rem;height:56px}}
.brand{{font-family:var(--mono);font-weight:700;letter-spacing:.12em;color:var(--tx);font-size:.95rem}}
.brand b{{color:var(--ac)}}
.topbar nav{{display:flex;gap:1.1rem;font-family:var(--mono);font-size:.72rem;letter-spacing:.08em}}
.topbar nav a{{color:var(--mut)}} .topbar nav a:hover{{color:var(--ac);text-decoration:none}}
.status{{margin-left:auto;font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;color:var(--mut)}}
.status .dot{{color:var(--ac)}}
.eyebrow{{font-family:var(--mono);font-size:.68rem;letter-spacing:.16em;color:var(--mut);text-transform:uppercase;margin-bottom:.6rem}}
h1{{font-size:1.9rem;font-weight:700;letter-spacing:-.01em;line-height:1.2}}
h2.sec{{font-family:var(--mono);font-size:.8rem;letter-spacing:.14em;color:var(--mut);text-transform:uppercase;margin:2.6rem 0 1rem;border-bottom:1px solid var(--bd);padding-bottom:.5rem}}
.hero{{padding:3.4rem 0 2.6rem}}
.hero p.sub{{color:var(--mut);max-width:62ch;margin-top:.9rem}}
.btn{{display:inline-block;font-family:var(--mono);font-size:.74rem;letter-spacing:.1em;padding:.6rem 1.1rem;border:1px solid var(--ac);border-radius:3px;color:var(--ac);text-transform:uppercase}}
.btn.solid{{background:var(--ac);color:#06130b;font-weight:700}}
.btn:hover{{text-decoration:none;filter:brightness(1.1)}}
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--bd);border:1px solid var(--bd);border-radius:6px;overflow:hidden;margin:2rem 0}}
.stat{{background:var(--panel);padding:1rem 1.1rem}}
.stat .n{{font-family:var(--mono);font-size:1.5rem;font-weight:700;color:var(--ac)}}
.stat .l{{font-family:var(--mono);font-size:.64rem;letter-spacing:.14em;color:var(--mut);text-transform:uppercase}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1px;background:var(--bd);border:1px solid var(--bd);border-radius:6px;overflow:hidden}}
.card{{background:var(--panel);padding:1rem 1.1rem;display:block;color:var(--tx)}}
.card:hover{{background:var(--panel2);text-decoration:none}}
.card .f{{font-family:var(--mono);font-size:.64rem;letter-spacing:.14em;color:var(--fnt);text-transform:uppercase}}
.card .t{{font-weight:600;font-size:.92rem;margin:.3rem 0 .25rem}}
.card .d{{color:var(--mut);font-size:.8rem;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}}
footer.bottom{{border-top:1px solid var(--bd);margin-top:4rem;padding:1.6rem 0 2.4rem}}
footer .foot{{font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;color:var(--faint);display:flex;gap:1.6rem;flex-wrap:wrap}}
footer .foot b{{color:var(--mut);font-weight:500}}
.artgrid{{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:2.4rem;padding:2.2rem 0}}
@media(max-width:880px){{.artgrid{{grid-template-columns:1fr}}.infobox{{order:-1}}}}
.article h1{{font-size:1.75rem}}
.lede{{font-size:1.05rem}}
.article p{{margin:.8rem 0;color:#cfcfcf}}
.article h3{{font-size:1.05rem;margin:1.6rem 0 .2rem}}
.infobox{{background:var(--panel);border:1px solid var(--bd);border-radius:6px;font-family:var(--mono);font-size:.72rem;align-self:start;position:sticky;top:76px}}
.infobox .ih{{padding:.7rem .9rem;border-bottom:1px solid var(--bd);letter-spacing:.16em;color:var(--ac);text-transform:uppercase;font-size:.64rem}}
.infobox .ir{{display:flex;justify-content:space-between;gap:1rem;padding:.42rem .9rem;border-bottom:1px solid var(--bd)}}
.infobox .ir:last-child{{border-bottom:0}}
.infobox .k{{color:var(--fnt);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}}
.infobox .v{{color:var(--tx);text-align:right;word-break:break-all}}
.infobox .v a{{display:block}}
table.ki{{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.84rem}}
table.ki th{{font-family:var(--mono);font-size:.64rem;letter-spacing:.14em;color:var(--mut);text-transform:uppercase;text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--bd2)}}
table.ki td{{padding:.5rem .6rem;border-bottom:1px solid var(--bd);vertical-align:top;color:#cfcfcf}}
table.ki td:first-child{{font-family:var(--mono);font-size:.76rem;color:var(--ac);white-space:nowrap}}
.badge{{display:inline-block;font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--bd2);border-radius:3px;padding:.14rem .45rem;color:var(--mut)}}
.badge.core{{border-color:var(--ac);color:var(--ac)}}
.badge.test{{border-color:var(--amb);color:var(--amb)}}
.badge.spec{{border-color:#6da9ff;color:#6da9ff}}
.tabs{{display:flex;gap:0;border-bottom:1px solid var(--bd2);margin:1.8rem 0 1.4rem}}
.tab{{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);padding:.6rem 1.1rem;cursor:pointer;border:1px solid transparent;border-bottom:0;position:relative;top:1px;user-select:none}}
.tab.on{{color:var(--ac);border-color:var(--bd2);background:var(--panel);border-top:2px solid var(--ac)}}
.panel{{display:none}} .panel.on{{display:block}}
.master-index h4{{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;color:var(--mut);text-transform:uppercase;margin:1.2rem 0 .4rem}}
.master-index ul{{list-style:none}}
.master-index li{{padding:.22rem 0;border-bottom:1px dashed var(--bd)}}
.master-index li a{{font-size:.86rem}}
.master-index li span{{font-family:var(--mono);font-size:.68rem;color:var(--fnt)}}
"""

TAB_JS = """
document.querySelectorAll('.tab').forEach(function(t){t.addEventListener('click',function(){
 document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('on',x===t)});
 document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('on',p.id==='p-'+t.dataset.tab)});
 window.scrollTo({top:0});
});});
"""


def chrome(title, body, head, prefix=""):
    c = THEME
    navlinks = ""
    for key, label, _ in CATEGORY_ORDER[:6]:
        navlinks += f'<a href="{prefix}index.html#cat-{key}">{esc(label.split(" ")[0].upper())}</a>'
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<style>{build_css()}</style></head>
<body>
<header class="top"><div class="wrap topbar">
<div class="brand">{esc(c['brand'].split()[0])}<b>{' '.join(c['brand'].split()[1:]) or ''}</b></div>
<nav>{navlinks}</nav>
<div class="status"><span class="dot">&#9679;</span> SOURCE {head}</div>
</div></header>
{body}
<footer class="bottom"><div class="wrap foot">
<span><b>{esc(c['node_label'])}</b></span>
<span>GENERATED {GENERATED}</span>
</div></footer>
<script>{TAB_JS}</script>
</body></html>"""


def badge(status):
    cls = {"CORE": "core", "TEST": "test", "SPEC": "spec"}.get(status, "")
    return f'<span class="badge {cls}">{esc(status)}</span>'


def render_home(articles, head):
    total_loc = sum(a.get("lines", 0) for a in articles if a.get("lang") not in ("", "Markdown", "Text", None))
    n_go = sum(1 for a in articles if a.get("lang"))
    body = [f"""<section class="hero"><div class="wrap">
<div class="eyebrow">FILE / 00 &nbsp;·&nbsp; PROJECT GUIDE &nbsp;·&nbsp; {len(articles)} ARTICLES</div>
<h1>XtracsysCode — guide and reference</h1>
<p class="sub">Set up a local model, organize projects, control tool permissions, and explore how
the desktop app works. Start with the user guide, then browse the source references.</p>
<p style="margin-top:1.2rem"><a class="btn solid" href="docs/usage-and-safety.html">START HERE</a>
<a class="btn" href="INDEX.md" style="margin-left:.6rem">SOURCE INDEX</a></p>
<div class="stats">
<div class="stat"><div class="n">{len(articles)}</div><div class="l">articles</div></div>
<div class="stat"><div class="n">{total_loc:,}</div><div class="l">source lines covered</div></div>
</div></div></section>"""]
    for key, label, sub in CATEGORY_ORDER:
        arts = [a for a in articles if a["category"] == key]
        if not arts:
            continue
        cards = []
        for i, a in enumerate(arts, 1):
            cards.append(f"""<a class="card" href="docs/{a['slug']}.html">
<div class="f">FILE / {i:02d} · {esc(a.get('path') or a['slug'])} · {a.get('lines') or '—'} LN</div>
<div class="t">{esc(a['title'])} {badge(a.get('status', 'DOC'))}</div>
<div class="d">{esc(a['lead'][0][:160])}</div></a>""")
        body.append(f"""<section id="cat-{key}" class="wrap" style="padding-bottom:2rem">
<h2 class="sec">{esc(label)} <span style="color:var(--fnt);text-transform:none;letter-spacing:.04em">&nbsp;{esc(sub)} · {len(arts)} articles</span></h2>
<div class="cards">{''.join(cards)}</div></section>""")
    return chrome("Home", "".join(body), head)


def render_article(a, articles, head):
    payload = article_payload(a, head)
    raw_json = json.dumps(payload, indent=2)
    byid = {x["slug"]: x for x in articles}
    rows = [("Path", f"<code>{esc(a.get('path') or '—')}</code>"),
            ("Lines", str(a.get("lines") or "—")),
            ("Language", a.get("lang") or "—"),
            ("Package", esc(a.get("pkg") or "—")),
            ("Phase", a.get("phase") or "—")]
    if a.get("spec_refs"):
        rows.append(("Implements", ", ".join(esc(r) for r in a["spec_refs"])))
    if a.get("tested_by"):
        tb = a["tested_by"]
        link = f'<a href="{byid[tb]["slug"]}.html">{esc(tb)}</a>' if tb in byid else esc(tb)
        rows.append(("Verified by", link))
    rel = [f'<a href="{byid[r]["slug"]}.html">{esc(byid[r]["title"])}</a>'
           for r in a.get("related", []) if r in byid]
    if rel:
        rows.append(("See also", "<br>".join(rel)))
    rows.append(("Canonical data", f'<a href="../data/{a["slug"]}.json">{a["slug"]}.json</a>'))
    infobox = ('<aside class="infobox"><div class="ih">&#9635; DOSSIER — '
               + esc(a.get("status", "DOC")) + '</div>'
               + "".join(f'<div class="ir"><span class="k">{k}</span><span class="v">{v}</span></div>'
                         for k, v in rows) + "</aside>")
    arts = [f'<p class="lede">{esc(p)}</p>' for p in a["lead"]]
    for heading, paras in a.get("sections", []):
        arts.append(f"<h3>{esc(heading)}</h3>")
        arts += [f"<p>{esc(p)}</p>" for p in paras]
    if a.get("key_items"):
        arts.append("<h3>Key items</h3><table class='ki'><tr><th>item</th><th>what it does</th></tr>")
        for name, desc in a["key_items"]:
            arts.append(f"<tr><td>{esc(name)}</td><td>{esc(desc)}</td></tr>")
        arts.append("</table>")
    mi = ['<div class="master-index">']
    for key, label, _ in CATEGORY_ORDER:
        arts_in = [x for x in articles if x["category"] == key]
        if not arts_in:
            continue
        mi.append(f"<h4>// {esc(label)}</h4><ul>")
        for x in arts_in:
            mark = ' <span>&#9656; CURRENT</span>' if x["slug"] == a["slug"] else ""
            mi.append(f'<li><a href="{x["slug"]}.html">{esc(x["title"])}</a>'
                      f'<span> {esc(x.get("path") or "")}{mark}</span></li>')
        mi.append("</ul>")
    mi.append('</div><p style="margin-top:1rem"><a class="btn" href="../index.html">&#8592; WIKI HOME</a></p>')
    body = f"""<div class="wrap artgrid">
<article class="article panel on" id="p-article">
<div class="eyebrow">FILE / {esc(a.get('fno','--'))} &nbsp;·&nbsp; {esc(a.get('path') or a['slug'])} &nbsp;·&nbsp; {a.get('lines') or '—'} LINES</div>
<h1>{esc(a['title'])}</h1>
{''.join(arts)}
</article>
<aside class="panel" id="p-data"><div style="width:100%">
<div class="eyebrow">// CANONICAL PAYLOAD — EMBEDDED JSON</div>
<pre>{esc(raw_json)}</pre></div></aside>
<aside class="panel master-index" id="p-index">{''.join(mi)}</aside>
{infobox}
</div>
<div class="wrap"><div class="tabs">
<div class="tab on" data-tab="article">&#9635; ARTICLE</div>
<div class="tab" data-tab="data">&#123;&#125; DATA / JSON</div>
<div class="tab" data-tab="index">&#9776; MASTER INDEX</div>
</div><p style="font-family:var(--mono);font-size:.66rem;color:var(--faint);padding-bottom:2rem">
THE EMBEDDED PAYLOAD IN THIS FILE'S SOURCE IS MACHINE-READABLE (script#leet-doc).</p></div>"""
    page = chrome(a["title"], body, head, prefix="../")
    # "</" escaped as "<\/" (no-op JSON escape) so article prose can never break
    # out of the script element — the classic embedded-JSON pitfall.
    safe_json = raw_json.replace("</", "<\\/")
    return page.replace("</body>", f'<script type="application/json" id="leet-doc">{safe_json}</script>\n</body>')


def write_indexes(articles, out, head):
    lines = ["# Code Wiki — Master Index\n",
             f"> Generated {GENERATED} · {len(articles)} articles\n"]
    for key, label, sub in CATEGORY_ORDER:
        arts = [a for a in articles if a["category"] == key]
        if not arts:
            continue
        lines.append(f"\n## {label}\n*{sub.strip('/ ')}*\n")
        lines.append("| # | article | file | path | lines | status |")
        lines.append("|---|---------|------|------|-------|--------|")
        for i, a in enumerate(arts, 1):
            lines.append(f"| {i:02d} | [{a['title']}](docs/{a['slug']}.html) | "
                         f"[json](data/{a['slug']}.json) | `{a.get('path') or '—'}` | "
                         f"{a.get('lines') or '—'} | {a.get('status', '')} |")
        with open(os.path.join(out, "indexes", f"{key}.md"), "w") as f:
            f.write(f"# {label}\n*{sub.strip('/ ')}*\n\n")
            for a in arts:
                f.write(f"- **[{a['title']}](../docs/{a['slug']}.html)** — `{a.get('path') or '—'}`"
                        f" ({a.get('lines') or '—'} lines): {a['lead'][0][:180].rstrip()}\n")
    lines.append("\n## File coverage map\n")
    lines.append("Article paths below are the declared coverage map; folder/group articles cover multiple files. Direct-file line counts are measured at generation; grouped metrics are historical, not a source inventory guarantee.\n")
    for article in articles:
        lines.append(f"- `{article.get('path', '—')}` → [ {article['slug']} ](docs/{article['slug']}.html)")
    with open(os.path.join(out, "INDEX.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="the codebase being documented (for HEAD sha)")
    ap.add_argument("--out", required=True)
    ap.add_argument("content_dir", help="directory holding content_*.py modules")
    args = ap.parse_args()
    articles = load_articles(args.content_dir)
    # Refresh direct-file metrics and repair legacy short-name related links.
    aliases = {"runner": "host-runner", "store": "host-store", "storage": "host-storage",
               "preload": "host-preload", "useXtrac": "use-xtrac", "web-api": "web-support"}
    slugs = {a["slug"] for a in articles}
    for article in articles:
        source = os.path.join(args.source, article.get("path", ""))
        if os.path.isfile(source) and not os.path.islink(source):
            with open(source, encoding="utf-8") as stream:
                article["lines"] = len(stream.read().splitlines())
        article["related"] = [aliases.get(s, s) for s in article.get("related", [])]
        unknown = set(article["related"]) - slugs
        if unknown:
            sys.exit(f"unknown related articles for {article['slug']}: {sorted(unknown)}")
    if not articles:
        sys.exit("no articles loaded — check content_*.py in " + args.content_dir)
    try:
        head = subprocess.check_output(["git", "-C", args.source, "rev-parse", "HEAD"],
                                       text=True).strip()[:12]
    except Exception:
        head = "unknown"
    for d in ("docs", "data", "indexes"):
        os.makedirs(os.path.join(args.out, d), exist_ok=True)
    with open(os.path.join(args.out, "index.html"), "w") as f:
        f.write(render_home(articles, head))
    counters = {}
    for a in articles:
        counters[a["category"]] = counters.get(a["category"], 0) + 1
        a["fno"] = f"{counters[a['category']]:02d}"
        with open(os.path.join(args.out, "docs", a["slug"] + ".html"), "w") as f:
            f.write(render_article(a, articles, head))
        with open(os.path.join(args.out, "data", a["slug"] + ".json"), "w") as f:
            json.dump(article_payload(a, head), f, indent=2)
            f.write("\n")
    write_indexes(articles, args.out, head)
    print(f"wrote {len(articles)} articles to {args.out}")


if __name__ == "__main__":
    main()
