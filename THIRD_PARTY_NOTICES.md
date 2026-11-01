# Third-party notices and provenance review

The root Apache-2.0 license applies only to material the project has rights to
license. It does not replace third-party licenses, attribution, notices, or
trademark restrictions. This document is a bounded review, not a legal opinion,
complete SBOM, security certification, or permission to publish unresolved work.

## Software represented in the application

Versions below were read from the current `package-lock.json` (lockfile v3).
Installed license texts, not just SPDX labels, were inspected for these entries.

| Component | Locked version | Terms / local evidence |
| --- | --- | --- |
| Marked | 15.0.12 | `node_modules/marked/LICENSE.md`: MIT plus the included Markdown BSD-style notice; both reproduced below |
| React | 19.3.0 | `node_modules/react/LICENSE`: MIT |
| React DOM | 19.3.0 | `node_modules/react-dom/LICENSE`: MIT |
| Scheduler | 0.28.0 | `node_modules/scheduler/LICENSE`: MIT |
| Electron | 45.1.0 | `node_modules/electron/LICENSE` and `node_modules/electron/dist/LICENSE`: MIT; separate Chromium/runtime notices also apply |
| Vite runtime helper, where emitted | 6.4.5 | Core MIT notice from `node_modules/vite/LICENSE.md`, lines 1–24; this is not the full build-tool dependency notice collection |

React, React DOM and Scheduler are marked development dependencies in the
lockfile but contribute renderer runtime code. Do not infer distribution scope
solely from npm's `dev` flag. Marked is the only entry without a development flag.

**Binary redistribution:** ship this document and the root `LICENSE`. Retain the
actual Electron distribution's `LICENSE` (sometimes named `LICENSE.electron.txt`)
and complete `LICENSES.chromium.html`, including in macOS resources as needed.
The installed Chromium credits file was located and its opening inspected, not
reviewed component by component. The Electron MIT notice alone does not cover
Chromium, Node.js and all other embedded software. Verify the final artifact's
notices against its actual runtime; a source-tree inventory is not that check.

## Build-time dependency inventory (not bundled wholesale)

The lockfile package entries carry license metadata and registry
resolution URLs (family counts below are from the pre-2026-10-28 toolchain snapshot;
re-inventory after lockfile changes). Metadata is not independent proof of provenance or permission.
The inventory was: MIT 420; ISC 79; Apache-2.0 12; BlueOak-1.0.0 8;
BSD-2-Clause 6; BSD-3-Clause 6; and one each of 0BSD, CC-BY-4.0,
Python-2.0, WTFPL, `(MIT OR CC0-1.0)`, `(WTFPL OR MIT)`, `WTFPL OR ISC`.
This is a count of lockfile entries, including optional/platform-specific and
nested versions, not a count of installed or redistributed components.

Items requiring care if vendoring build tools/caches or redistributing their code:

- `caniuse-lite` 1.0.30001810: CC-BY-4.0, not MIT. Preserve its license and
  upstream attribution, link and modification information when redistributing
  its data. Installed `LICENSE` opening and package metadata inspected.
- `argparse` 2.0.1: Python-2.0; its installed license includes the historical
  Python license chain. Do not replace that file with a generic MIT notice.
  Only its opening was inspected, not the entire historical chain.
- BlueOak-1.0.0 entries: `jackspeak`, `minimatch`, `minipass-flush`,
  `package-json-from-dist`, `path-scurry`, `sax`, and two nested `minipass`
  entries. These were identified from metadata; full texts were not audited.
- `sanitize-filename` 1.6.4: `WTFPL OR ISC`; `truncate-utf8-bytes` 1.0.2:
  WTFPL metadata, with no installed LICENSE file found in its enumerated folder.
  Do not invent a copyright notice or silently relicense it.
- `utf8-byte-length` 1.0.5 offers WTFPL or MIT; its actual `LICENSE.MIT.txt`
  was inspected. `type-fest` 0.13.1 offers MIT or CC0 in metadata; its installed
  `license` contains MIT text. Preserve the selected upstream terms if vendored.
- Vite's full license also contains a bundled-dependency notice collection.
  Electron-builder and packaging utilities may include separately licensed
  binaries. Excluding `node_modules/` and build caches from a source export
  avoids shipping them, but does not waive obligations for anything actually
  included in an installer or compiled output.

No complete dependency advisory lookup or source-to-registry integrity audit was
performed. The MIT metadata of a wrapper package does not establish the license
of every binary it carries. Re-inventory when the lockfile or packaging changes.

## Bundled content provenance (owner-confirmed 2026-10-31)

The owner has confirmed the origin of the items below. These are owner-reported
statements, not an independent chain-of-title audit; no original third-party
notices were removed, and if any of this ever turns out to incorporate someone
else's material, that material's own attribution obligations would still apply.

- **Bundled skills** (`bundled-skills/`: `completion-review`, `project-orientation`,
  `skill-builder`, `systematic-debugging`, `test-first-development`,
  `wiki-maintenance`) — authored specifically for this project by its maintainer
  working with an AI coding assistant during the v5 sprint. No upstream source,
  no copied or adapted third-party text; dedicated to the project under the root
  Apache-2.0 license.
- **Plugins** (`plugins/` manifests, `server.mjs` files) and the two `md.mjs`
  helpers — first-party implementations written for this project (Node built-ins
  plus local helpers only); the identical `md.mjs` pair is one intentional shared
  implementation copied between the two plugins, not third-party code.
- **Brand and icon assets** (`build/logo-src.png`, `build/logo-sq.png`,
  `web/public/logo.png`, `build/icon.png`, `build/icon.icns`, `build/icon.ico`) —
  owned by Xtracsys LLC as the company's own brand material; the app icon set is
  generated from that material by the dependency-free `scripts/icon.js`.
- **AI-assisted authorship**: portions of this codebase (including the skills
  above) were written with AI coding assistance at the maintainer's direction.
  The maintainer considers the output original work owned by Xtracsys LLC under
  Apache-2.0; no third-party license texts or attributions were removed.

No original upstream notices were removed in this review. Copying, adaptation or
originality of first-party-named material is not established by naming it
first-party: keep private originals while deciding whether to document, replace
with verified-original work, or omit a component.

## Snapshot audit limits

A bounded snapshot of the current text files (source, configuration, tests,
documentation, wiki outputs) was pattern-checked for secret classes: private-key
headers, GitHub token families, AWS access IDs, provider-style tokens, quoted
credential assignments, operator home/volume paths, private IPv4 examples, and
explicit provenance markers. No secret-pattern candidate was found in that
snapshot. `node scripts/release-audit.mjs` reproduces this scan; it reports only
paths, pattern classes and counts, never matched values, and its `review-required`
status is a human sign-off posture, not a finding.

Pattern matching is not a high-entropy or comprehensive secret scanner, cannot
prove absence of secrets or establish ownership, and is not a security
certification. `.gitignore` is neither an inclusion manifest nor a security
boundary: it does not remove tracked files or historical content. Re-run the
audit after any change that adds files, history or dependencies.

## License texts retained from installed upstream packages

### Marked 15.0.12 — complete installed license (including Markdown notice)

Source: `node_modules/marked/LICENSE.md`.

```text
# License information

## Contribution License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license. You are also implicitly verifying that
all code is your original work. `</legalese>`

## Marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Markdown

Copyright © 2004, John Gruber
http://daringfireball.net/
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name “Markdown” nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

This software is provided by the copyright holders and contributors “as is” and any express or implied warranties, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose are disclaimed. In no event shall the copyright owner or contributors be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including, but not limited to, procurement of substitute goods or services; loss of use, data, or profits; or business interruption) however caused and on any theory of liability, whether in contract, strict liability, or tort (including negligence or otherwise) arising in any way out of the use of this software, even if advised of the possibility of such damage.
```

### React 19.3.0 / React DOM 19.3.0 / Scheduler 0.28.0 — identical MIT license

Source: `node_modules/react/LICENSE`.

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Electron 45.1.0 — Electron MIT notice only

Source: `node_modules/electron/LICENSE`.

```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Vite 6.4.5 — core MIT license only

Source: `node_modules/vite/LICENSE.md`.

```text
# Vite core license
Vite is released under the MIT license:

MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

