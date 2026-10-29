# WAR-ROOM — 5v5 Multiverse Combat & Story Game

WAR-ROOM is a single-file HTML game. Pick 5 fighters, face an AI team of 5,
watch a recorded combat simulation, then read a 5-chapter cinematic story
(Arrival, First Contact, Escalation and Reversals, Decisive Clash, Aftermath)
plus a separate numeric combat breakdown.

## Play it

Open `index.html` in a browser — no install, no build step.

For the connected version, open it over https (for example GitHub Pages),
not as a local `file://` page, so Wikipedia / Fandom research fetches work
reliably.

## Versions in this repo

- `index.html` — latest, WAR-ROOM v8 (connected version: Wikipedia + Fandom
  canon research, YouTube research links, five AI brains, optional AI story
  via Pollinations or your own free Gemini key)
- `war-room.html` — original offline version
- `war-room-online.html` — first internet version (Wikipedia research)
- `war-room-v3.html` — 24 fighters, variants, 5-chapter story, history
- `war-room-v4.html` — YouTube battle research
- `war-room-v5.html` — canonical powersets, novel story engine
- `war-room-v6.html` — Wikipedia + Fandom canon research
- `war-room-v7.html` — five-brain architecture
- `war-room-v8.html` — same as `index.html`

## Honest limits

- Story dialogue is written in-character for the battle, not quoted canon.
- Research extracts (Wikipedia / Fandom) are context, not automatic new powers.
- A browser file cannot automatically read YouTube transcripts without a
  YouTube Data API key, and full LLM novel generation needs a language-model
  endpoint. The game works fully without either, with an optional AI story
  draft when a free service or your own key is available.
- Battle history is saved on the player's device only (localStorage), not
  synced across devices.

## GitHub Pages

To host this as a website: GitHub repo Settings → Pages → Deploy from a
branch → `main` / root. The site will then be at
`https://<username>.github.io/<repo>/` and `index.html` will load by default.
