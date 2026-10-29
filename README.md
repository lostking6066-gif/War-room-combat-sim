# WAR-ROOM — 1v1 Death Battles

WAR-ROOM is a single-file HTML game. Pick two fighters, examine their
abilities, analyze the matchup, simulate the fight, then read a narrated
death-battle episode in six chapters plus a separate numeric combat
breakdown.

## Play it

Open `index.html` in a browser — no install, no build step. This is now
WAR-ROOM v9, the 1v1 Death Battle game, and the main game on GitHub Pages.

For the connected version, open it over https (for example GitHub Pages),
not as a local `file://` page, so Wikipedia / Fandom research fetches work
reliably.

## The episode (narrator style C)

1. Chapter I — The Contenders
2. Chapter II — The Comparison / Analysis
3. Chapter III — The First Exchange
4. Chapter IV — The Turning Point
5. Chapter V — The Final Clash
6. Chapter VI — The Verdict

First the analytical breakdown, then the cinematic battle story built only
from the recorded simulation, then a verdict explaining who won and why.

## Death rules

Victory is by death (HP 0), by incapacitation lasting the rest of the
fight, or by battlefield removal with no way back. Regeneration heals a
living fighter but does not revive after HP 0. If the round cap is hit
with both fighters alive and neither able to kill or incapacitate the
other, the episode ends as a stalemate / no-death verdict — no invented
killing blow.

## Modes

- **Original Death Battle (default):** pick two fighters and play.
- **Video-Inspired Battle:** paste a transcript or notes. That text is
  context only, shown as video-inspired notes, and does not grant powers.
  Narration is always original — never a copy of another creator's script.
  A YouTube link alone does not guarantee transcript access without a
  YouTube Data API key.

## Versions in this repo

- `index.html` — latest, WAR-ROOM v9 (1v1 Death Battles)
- `war-room-v9.html` — same as `index.html`
- `war-room-v8.html` — previous 5v5 version, kept as an archive (not the
  main game anymore)
- `war-room-v7.html` — five-brain 5v5 architecture
- `war-room-v6.html` — Wikipedia + Fandom canon research (5v5)
- `war-room-v5.html` — canonical powersets, novel story engine (5v5)
- `war-room-v4.html` — YouTube battle research (5v5)
- `war-room-v3.html` — 24 fighters, variants, 5-chapter story, history (5v5)
- `war-room-online.html` — first internet version (Wikipedia research)
- `war-room.html` — original offline version

## Honest limits

- Story dialogue is written in-character for the battle, not quoted canon.
- Research extracts (Wikipedia / Fandom) are context, not automatic new powers.
- A browser file cannot automatically read YouTube transcripts without a
  YouTube Data API key, and full LLM novel generation needs a language-model
  endpoint. The game works fully without either, with an optional AI story
  draft when a free service or your own key is available.
- Battle history is saved on the player's device only (localStorage), not
  synced across devices.
- Roster target is 100 fighters per category long-term. This build ships
  26 playable fighters; the target is not a claim that 600 are implemented.

## GitHub Pages

Live at `https://lostking6066-gif.github.io/War-room-combat-sim/` —
GitHub repo Settings → Pages → Deploy from a branch → `main` / root,
and `index.html` loads by default.
