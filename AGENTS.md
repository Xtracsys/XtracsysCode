# XtracsysCode — agent working notes

## Wiki maintenance (required)

The project wiki under `wiki/` is generated from `wiki/content/content_*.py` by
`wiki/generate_wiki.py`. **At the end of every turn that changes source files, update the wiki:**

1. Update the relevant article(s) in `wiki/content/*.py` (slug, `lines=` count, lead/sections for
   behavior changes). Files are grouped into articles — see the coverage map at the bottom of
   `wiki/INDEX.md`. A new source file needs a new article or a folder-article update.
2. Regenerate: `python3 wiki/generate_wiki.py --source . --out wiki wiki/content`
3. Delete stale artifacts the generator does not remove (renamed/deleted articles leave orphan
   `wiki/docs/<slug>.html` and `wiki/data/<slug>.json` behind).
4. Re-append the "File coverage map" section to `wiki/INDEX.md` (the generator overwrites it).
5. Validate: every `wiki/data/*.json` parses, every `wiki/docs/*.html` has a parseable
   `script#leet-doc` payload, no broken internal links, home/INDEX reference no deleted slugs.
   This repo lives on exFAT: `find . -name '._*' -not -path './node_modules/*' -delete` before
   finishing, and keep `._*` in .gitignore.

## Environment notes

- exFAT volume: git runs with `core.fileMode false` (everything appears mode 755). Don't re-enable.
- Packaging on exFAT: macOS writes an AppleDouble shadow `._app.asar` next to every freshly
  written asar. This is handled in-repo now (do NOT patch node_modules): `electron-builder.yml`
  sets `disableAsarIntegrity: true` (builder 26 hashes every `*.asar` incl. junk shadows), and
  `scripts/afterPack.js` strips `._*`/`.DS_Store` junk, flips the Electron fuses, then re-seals
  the bundle's ad-hoc signature (Apple Silicon SIGKILLs an executable whose signature no longer
  matches). Delete fresh `._*` files before finishing any turn.
- Line-count stats for articles come from `wc -l` — measure, never recall.
