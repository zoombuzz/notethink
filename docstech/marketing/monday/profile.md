# notethink marketing profile

Read and updated by `/marketing-monday` (lightenna-iac/docstech/skills/marketing-monday/SKILL.md); every fact is dated and marked measured or inferred.

## Product

NoteThink is a VS Code extension (published as `NoteThink.notethink`) that renders markdown files as interactive visualisations - a custom editor plus Document, Kanban and Line views.

- value proposition, measured - `package.nls.json:3`: `"description": "Notes in markdown, visualised as anything"` (`displayName` "NoteThink", `package.nls.json:2`)
- restated, measured - `README.md:3`: "A VS Code extension that renders markdown files as interactive visualizations."
- status, measured - `README.md:5`: "Status: Preview / Beta - this is an early release. Expect rough edges."
- source of truth for product claims: `README.md` and the published Marketplace listing (https://marketplace.visualstudio.com/items?itemName=NoteThink.notethink), never older marketing copy.

## Where people land

| Surface | URL | GA4 property | Notes |
|---|---|---|---|
| VS Code Marketplace | https://marketplace.visualstudio.com/items?itemName=NoteThink.notethink | none | primary install surface; 5 installs, 0 reviews, v0.3.69, measured via WebFetch 2026-09-22; cannot carry UTM parameters GA4 would see |
| Open VSX | not published | none | measured 2026-09-22 - `curl https://open-vsx.org/api/NoteThink/notethink` returns `{"error":"Extension not found: NoteThink.notethink"}` |
| notethink.com | https://www.notethink.com | none | served by notegit's `dulcet` Next.js app, selected off the request's Host header, not a page in this repo (`notegit/nodejs/dulcet/src/lib/sites.ts:56-73`, `hostPatterns: ['notethink.com']` at `sites.ts:64`, matched by `getSiteForHost()` at `sites.ts:78-91`); no GA4 tag anywhere in that app (grep of `notegit/nodejs/dulcet/src` for `gtag`, `G-`, `GA4`, `analytics` returns zero hits) |
| GitHub repo | https://github.com/zoombuzz/notethink | none | public, no login required to view; 0 stars, 0 open issues, 161 commits on `main`, measured via WebFetch 2026-09-22 |

## Measurement

- GA4 properties created 2026-09-29 (operator's signed-in browser, per the `ga4-notethink-com` story's recorded decision to keep the two sites on separate properties):
  - notethink.com: `properties/556474696` ("notethink.com - GA4"), web stream "notethink.com - Web" (stream id 15866382830, `https://www.notethink.com`), measurement id `G-K3285X28QT`
  - notegit.com: `properties/556502893` ("notegit.com - GA4"), web stream "notegit.com - Web" (stream id 15866287745, `https://www.notegit.com`), measurement id `G-R528DT102F`
  - both Europe/London, GBP; no Measurement Protocol API secret exists yet (create one only if server-side event sends are needed, and reference it by env var name, never its value)
  - wired prod-only into `notegit/terraform/prod/do-app-dulcet/main.tf` (`NEXT_PUBLIC_GA_MEASUREMENT_ID_NOTEGIT` / `_NOTETHINK`), read by `notegit/nodejs/dulcet/src/lib/sites.ts`'s per-site `SiteConfig`, and loaded client-side (Consent Mode v2, default-denied) by `notegit/nodejs/dulcet/src/lib/analyticsops.ts`; not deployed yet - staging never carries these vars, matching calfam's precedent
  - the Marketplace listing cannot carry GA4 or UTM parameters GA4 would see: it is a third-party site with its own install/rating counters only, and nothing on our side captures a `?utm_source=` appended to the listing URL even if VS Code's install click-through preserved it
  - the outbound Marketplace install link on the notethink.com landing page fires a `click_install_marketplace` GA4 event as a proxy for installs the Marketplace itself does not report back to us
  - link posts to the notethink.com landing page so the visit lands in the owned property
  - notethink.com's GA4 code lives in the `notegit` repo (served by its `dulcet` app) - this remains `notegit` work, not `notethink` work
  - until the code above is deployed and verified against a real UTM-tagged visit, the outcome proxy stays the Marketplace install count, read weekly by WebFetch of the public listing, plus GitHub stars on `zoombuzz/notethink`, both public counters with no MCP or API access here
  - plainly: until notethink.com's GA4 is deployed and confirmed live, posts are measured on platform metrics (impressions, reactions, comments, link clicks reported by the publisher) and install/star deltas only, never sessions, new users or conversions

## Audiences

### Developers who keep notes and plans in markdown in their repos

- who: a developer already writing project notes and story boards in markdown inside a repo, working in VS Code
- job: when I am trying to see the shape of my project's stories at a glance, I want a visual read of the markdown I already write, so I can track status without leaving my editor or maintaining a second tool
- where they spend attention: r/vscode (223,160 members per the growth playbook), dev.to, the extension's own GitHub repo
- evidence, measured - `AUTHORING_GUIDE.md:1-10` frames the audience as a "document author" writing markdown against a specific grammar (headings, `?status=` linetags); `package.json:246-258` ships a Kanban `columnOrder` defaulting to `["untagged","doing","code-review","testing","done"]`, the same story-tracking convention this workspace's own `todo.md`/`done.md` files use
- evidence, measured - `docstech/users/alex.stanhope/done.md:257-265` records the operator installing a dev build to use day to day, explicitly to learn "how useful is it" before any external launch

### PKM/Obsidian users who also code

**Inferred persona** - named in the growth playbook (`lightenna-iac/docstech/reports/marketing-monday/playbook.md` section 1, notethink), not evidenced by anything inside this repo.

- who: an Obsidian/Logseq/Notion-adjacent PKM user who also codes and wants their markdown notes visualised without switching tools
- job: when I am trying to think through a project without leaving my code editor, I want the same visual note-taking I get in my PKM tool, so I can stay in one place
- where they spend attention: r/ObsidianMD (roughly 344k-360k members), r/PKMS (77,860 members), PKM Weekly, DeveloPassion's Newsletter
- evidence, inferred from `categories: ["Visualization", "Other"]` (`package.json:19-22`) and the growth playbook's named audience; no in-repo evidence yet that an actual PKM user has installed it

## What we know about current users

- 2026-09-22, measured (WebFetch of the public Marketplace listing): 5 installs, 0 reviews/ratings, version 0.3.69
- 2026-09-22, measured (WebFetch of https://github.com/zoombuzz/notethink): 0 stars, 0 open issues, 161 commits on `main`, public with no login wall to view
- 2026-09-22, measured (`curl https://open-vsx.org/api/NoteThink/notethink`): not published on Open VSX
- no usage telemetry exists in the extension: the only network call anywhere in the codebase is a build-time-gated `POST /api/client-error` stub (`client/extension/src/lib/errorops.ts:215`) whose enabling flag nothing sets; beyond the two public counters above there is no way to see who installed it, how often it opens, or which views are used
- the only confirmed user to date is the operator, dogfooding a dev build (`docstech/users/alex.stanhope/done.md:257-265`) to establish which features earn their keep before any external user sees it

## Channels

| Platform | Account | Connected in publisher | Allowed | Notes |
|---|---|---|---|---|
| Bluesky | not created | not connected | publish (app password, never the account password) | low-friction API, no per-post fee unlike X, and the indie-dev/PKM crossover audience is active there |
| LinkedIn company page | not created | not connected | publish | starter: reaches developers and technical leads where "how I organise my repo's notes" workflow posts travel; replaces Mastodon and dev.to, which the publisher (Zernio) does not reach |
| Mastodon (pkm.social or a dev-focused instance) | not created | not connected | not reachable: the publisher does not support it (skill Channel rules) | the playbook names pkm.social directly; would need its own API client |
| dev.to | not created | not connected | not reachable: the publisher does not support it (skill Channel rules) | 7.62M monthly visits and cross-posting is normalised there; its own API is simple, the strongest candidate to add |
| YouTube Shorts | not created | not connected | publish (9:16, at most 60s, synthetic-media disclosure if any AI imagery is used) | a pure screen recording of a markdown file becoming an interactive board is the natural, no-talking-head asset for this product |

**Out of scope for automated posting** (per the skill's Channel rules table - no sanctioned posting API, or community norms that punish promotional automation): r/vscode, r/ObsidianMD, r/PKMS, Show HN, Product Hunt. These are drafted only; a human posts them.

**Highest-leverage non-post levers** (growth playbook, section 1, notethink; pointers only, not this run's job to execute):

- VS Code Marketplace listing optimisation (keywords, description, screenshots)
- a README GIF or screenshot - `README.md` currently has none, only an ASCII architecture diagram
- direct pitches to PKM Weekly and DeveloPassion's Newsletter

## Brand

- icon and SVG sources: `docstech/design/logos/notethink-icon.svg` (the approved mark, status "final shipped" per `brief.md:3`), `notethink-wordmark.svg` (horizontal lockup for README/docs, not currently embedded anywhere), `variants/` (rejected exploration drafts)
- the one shipped raster asset is `media/icon.png` (256x256 PNG, `package.json:9`)
- two unreconciled palettes, both measured:
  - extension icon (`notethink-icon.svg`, grepped for hex colours): `#5B5BF0`, `#7146F2`, `#8B3DEF`, `#5454F4`, plus black and white - an indigo-to-violet range consistent with `brief.md:41`'s stated `#5B5BF0` to `#8B3DEF` tile gradient; the brief's mint accent `#34E0C8` was not found by that grep
  - notethink.com web theme (`notegit/nodejs/dulcet/src/lib/sites.ts:60-63`): `splashBackground: '#fafaf5'`, `splashAccent: '#aa3731'`, `splashText: '#525252'` - a warmer cream/rust/grey palette, produced independently of the icon
- these two palettes are not reconciled; flag it to the operator before producing a lot of visual collateral that has to sit beside both

## Constraints

- never fabricate installs, ratings or users beyond what a run measures
- only describe features in the currently published version (0.3.69); the Document, Kanban and Line views are shipped (`package.json:65-72` commands) and fair to claim, an unreleased feature is not
- read-only viewer: never claim it edits notes - `README.md:190` "No editing support yet - NoteThink is a viewer, not an editor"
- preview/beta status (`README.md:5`): claims should not overstate polish or maturity
- no social account exists yet: never publish as though an established brand presence already exists

## Existing collateral

- `docstech/design/logos/notethink-icon.svg`, `notethink-wordmark.svg` (unused in the README), `variants/` (rejected drafts)
- `media/icon.png` - the shipped Marketplace icon
- `templates/getting-started.md` - the in-product onboarding welcome document served to notegit/dulcet's virtual filesystem, not a marketing asset, but its copy ("NoteThink renders your markdown in real time") is reusable
- `README.md` has no embedded screenshot or GIF, only an ASCII architecture diagram

## Open marketing stories

None. `docstech/users/alex.stanhope/todo.md` has no marketing, marketplace-listing, SEO, website, analytics, growth, launch or social story; its only marketplace-adjacent hits are packaging/build technicalities, not marketing tasks.
