# WAR-ROOM — 1v1 Death Battles

WAR-ROOM is a single-file HTML game. Pick two fighters, examine their
abilities, analyze the matchup, simulate the fight, then read a narrated
death-battle episode in six chapters plus a separate numeric combat
breakdown.

## Play it

Open `index.html` in a browser — no install, no build step. This is now
WAR-ROOM v14, the 1v1 Death Battle game, and the main game on GitHub Pages.

For the connected version, open it over https (for example GitHub Pages),
not as a local `file://` page, so Wikipedia / Fandom research fetches work
reliably.

## The episode

1. Chapter I — The Contenders
2. Chapter II — The Comparison / Analysis
3. Chapter III — The First Exchange
4. Chapter IV — The Turning Point
5. Chapter V — The Final Clash
6. Chapter VI — The Verdict

The episode is narrative fiction based on the canon winner: a start,
middle, climax, and end, written as scenes — not a battle-event log and
not Wikipedia descriptions. Wikipedia/Fandom research runs automatically
in a separate Research panel outside the episode. Numbers live in the
separate Combat Breakdown.

Winners are picked from power scaling: power, speed, dexterity, durability,
stamina, and tactics, plus counters, transformations, and weaknesses.
Every fighter profile now shows personality, fighting style, power usage,
scaling numbers, and a key weakness.

## Online storytelling pipeline

1. Choose fighters and their Continuity / Version.
2. Research Dossier — cached per fighter + continuity, with source type,
   found/not-found status, link, and date. Fan sources are discussion,
   not established fact, and never auto-grant powers.
3. Matchup Analysis — powers, advantages, limitations, win conditions,
   and stated assumptions where feats are not directly comparable.
4. Combat Simulation — WAR-ROOM's own engine determines the battle.
5. Episode — rule-based cinematic narrator, analytical / cinematic /
   reflective voices, chapter length following the battle itself.
6. Consistency Check — winner, powers, continuity, transforms, injuries,
   knowledge, and verdict checked against the battle record.
7. Saved Episode — matchup, versions, outcome, research references,
   consistency + quality results, and full episode, saved on the player's device,
   with Export/Backup. Victory modes: Death (default) and Incapacitation/Knockout,
   distinguished in the verdict — a knockout is never labelled a death.

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
  context only, shown in Chapters I and II, and does not grant powers.
  Narration is always original — never a copy of another creator's script.
  A YouTube link alone does not guarantee transcript access without a
  YouTube Data API key. Per-fighter and matchup-specific YouTube search
  links are included.

## Roster

v14 ships 194 playable fighters: Anime 17, Comics 17, Video Games 16,
Movies & TV 16, Animation 16, Fantasy & Sci-Fi 16. The long-term target
is 100 per category; that target is NOT a claim that 600 are implemented.
New batches will be added with full, accurate profiles.

## Versions in this repo

- `index.html` — latest, WAR-ROOM v14 (1v1 Death Battles, dedicated combat resolution + 3 validation systems)
- `war-room-v14.html` — same as `index.html`
- `war-room-v13.1.html` — previous 1v1 version, kept as an archive
- `war-room-v13.html` — previous 1v1 version, kept as an archive
- `war-room-v12.1.html` — previous 1v1 version, kept as an archive
- `war-room-v12.html` — previous 1v1 version, kept as an archive
- `war-room-v11.html` — previous 1v1 version, kept as an archive
- `war-room-v10.html` — previous 1v1 version, kept as an archive
- `war-room-v9.html` — previous 1v1 version, kept as an archive
- `war-room-v8.html` — previous 5v5 version, kept as an archive
- Earlier 5v5 versions: `war-room-v7.html` down to `war-room.html`

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

Live at `https://lostking6066-gif.github.io/War-room-combat-sim/` —
GitHub repo Settings → Pages → Deploy from a branch → `main` / root,
and `index.html` loads by default.
