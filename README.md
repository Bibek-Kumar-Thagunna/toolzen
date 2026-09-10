# Toolzen

Twenty-four browser-based utilities for images, PDFs, text, code and everyday
maths. Almost everything runs entirely in the visitor's tab: files are read,
transformed and written by their own browser and are never uploaded.

That is a property of the code rather than a policy. There is no upload
endpoint in this repository, and `scripts/check-integrity.mjs` refuses to build
a tool marked `processing: 'browser'` whose engine references `fetch`,
`XMLHttpRequest` or `WebSocket`.

---

## Getting started

```bash
npm install          # also copies the pdf.js worker into public/
npm run assets       # generates icons and the 31 social cards
npm run dev          # http://localhost:3000
```

`npm run verify` is the gate before any deploy. It runs, in order:

```
check      import graph, client boundaries, tool coverage, icon geometry
test       637 unit tests over the engines  (node --test, no browser)
typecheck  tsc --noEmit
lint       next lint
build      next build
```

## How it is put together

```
src/lib/registry/     one array is the site: nav, sitemap, SEO, search, pages
src/lib/tools/**      the engines. Pure, tested, no DOM except image/codec.ts
src/lib/seo.ts        metadata and JSON-LD, built from the registry
src/components/tools/ one client component per tool
src/app/              8 route files, all statically generated
```

**Adding a tool** is two files and nothing else: an object in
`src/lib/registry/tools/<category>.ts` and a component in
`src/components/tools/`, registered in `ToolMount.tsx`. The page, the metadata,
the sitemap entry, the breadcrumbs, the structured data, the search index and
the cross-links all follow from the registry entry. `npm run check` fails if
you add one and forget the other.

**The engines are separate from the components** on purpose. Everything that
can be decided without a DOM — which formats a browser can write, where a crop
rectangle lands, what a resize target should be, how to parse `1-3, 7` — lives
in `src/lib/tools` as a pure function with a `.test.ts` beside it. What is left
in a component is layout and state.

**Nothing renders on demand.** All 42 pages are written to disk at build time.
Tool pages carry ~114 kB of first-load JavaScript, and each tool's own code is
a separate chunk loaded only by its own page — see the header of
`ToolMount.tsx` for why that indirection is not optional.

## Advertising

Off by default in every environment, including production. Three separate
environment variables must all be set before a single ad script loads; see
`.env.example`.

The constraints are in the code, not in anyone's intentions:

- **Never among the controls.** `ToolWorkspace` wraps its children in
  `AdFreeZone`, so an `AdSlot` rendered anywhere inside the interactive area
  renders `null`. There is no prop that opts back in.
- **Two per page, maximum**, and none at all on `/`, `/privacy` and `/terms`.
- **Zero layout shift.** Every placement reserves its exact height per
  breakpoint before the unit arrives.
- **Held while working.** `ToolActivity` flips a `busy` flag during a run and no
  new unit initialises until it clears, so nothing moves under the cursor while
  someone waits for a result.
- **Skipped entirely** for visitors with `prefers-reduced-data`.

`NEXT_PUBLIC_ADS_DEBUG=true` draws the reserved boxes with their dimensions. It
is not a mock advertisement — it is unclickable, says "reserved", and has no
headline or call to action.

## Deploying to Vercel

1. Push the repository to GitHub and import it at vercel.com.
2. Set **`NEXT_PUBLIC_SITE_URL`** to the real origin (e.g.
   `https://thetoolzen.com`) for the Production environment.
3. Set **`NEXT_PUBLIC_NOINDEX=true`** for the Preview and Development
   environments. Without it, preview deployments compete with production for
   the same queries — duplicate content is the one SEO problem that is
   expensive to undo.
4. Add the domain under Settings → Domains and point DNS at Vercel.
5. Deploy. `vercel.json` carries HSTS and a Content-Security-Policy whose
   allowances match exactly what AdSense needs and nothing else.

These variables are inlined at build time, so changing one requires a redeploy.

`output: 'standalone'` in `next.config.mjs` is for the Docker path; Vercel
handles it correctly and it can stay.

## Before applying to AdSense

The application is judged on the live site, so the order matters:

1. Deploy with ads **off** and the real domain live.
2. Verify the domain in Google Search Console and submit
   `https://<domain>/sitemap.xml`.
3. Let it be indexed and gather some genuine traffic. Applying with a brand-new
   site and no visitors is the usual reason for rejection, and the prose on
   these pages is only an asset once a reviewer can see people reading it.
4. Apply. Once approved, set the four slot ids and flip
   `NEXT_PUBLIC_ADS_PROVIDER=adsense` and `NEXT_PUBLIC_ADS_ENABLED=true`.

The privacy policy already carries the disclosures the programme requires:
third-party cookies, Google's use of them, and the two opt-out links.

## Rebranding

Change `src/lib/brand.ts` — name, legal name, domain, tagline, contact address —
and, if you want a different accent, the `--c-accent*` values in
`src/app/globals.css`. Then:

```bash
npm run assets
```

which rereads both files and rewrites every icon and social card. Nothing else
in the codebase hardcodes the name.

## Licence

Unlicensed / all rights reserved. Set this to whatever you actually intend
before publishing the repository.
