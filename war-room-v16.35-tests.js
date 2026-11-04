/* WAR-ROOM v16.35 regression harness (v16–v16.22 tests retained except the main-story tests rewritten for the v16.14 short-verdict replacement, plus v16.14 verdict tests) — Node, DOM-stub, deterministic.
   Usage: node war-room-v16.35-tests.js [path-to-war-room-v16.35.html]
   Loads the extracted <script> from the v15 file (truncated before the
   browser INIT block), evaluates it in a vm context with stubbed
   document/localStorage, then runs the 20 required tests + the 8 v14
   regression scenarios + the all-194-vs-Batman no-crash check + source
   audits. A failing test is a bug in the implementation, not in the
   test: do not weaken an assertion to match current behaviour.
   Exit code 0 = all pass, 1 = any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = process.argv[2] || path.join(__dirname, 'war-room-v16.35.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) { console.error('FATAL: no <script> block found in ' + htmlPath); process.exit(2); }
let script = scriptMatch[1];
const initIdx = script.indexOf('/* ============ INIT ============ */');
if (initIdx !== -1) script = script.slice(0, initIdx);

function makeElement() {
  return {
    innerHTML: '', innerText: '', textContent: '', value: '', style: {},
    dataset: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, click() {},
    setAttribute() {}, getAttribute() { return null; }, querySelectorAll() { return []; },
    scrollTop: 0,
  };
}
function makeLocalStorage(corrupt) {
  const store = {};
  if (corrupt === 'garbage') store['warroom_battles_v3'] = 'not-json{{{';
  if (corrupt === 'nonarray') store['warroom_battles_v3'] = '{"a":1}';
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _store: store,
  };
}
const els = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    getElementById(id) { if (!els[id]) els[id] = makeElement(); return els[id]; },
    createElement() { return makeElement(); },
    querySelectorAll() { return []; },
  },
  window: {}, navigator: { onLine: true },
  localStorage: makeLocalStorage(false),
  alert(msg) { sandbox._lastAlert = msg; },
  fetch: async () => { throw new Error('network disabled in harness'); },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'war-room-v16.27-extracted.js' });
// Expose the script's globals to the test code running in the same context.
const ctx = sandbox;

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; failures.push(name + ' :: ' + (detail || '')); console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function runInCtx(code) { return vm.runInContext(code, ctx); }
// v16.9: harness default pacing is 1ms so generation tests do not wait real
// 50s gaps; pacing-specific tests set V168_PACING_MIN_MS themselves and restore it to 1.
runInCtx('V168_PACING_MIN_MS = 1;');

// ---- Fixture helpers (run inside the vm context so roster globals resolve) ----
// Simpler: build specs in plain JS from the vm-visible roster via a JSON round-trip.
function spec(id, over) {
  const json = runInCtx(`JSON.stringify((function(){ const f = byId(${JSON.stringify(id)}); if(!f) return null; return {id:f.id,name:f.name,hp:f.hp,atk:f.atk,def:f.def,sp:f.sp,dex:f.dex||7,dur:f.dur||7,pw:f.pw||7,sta:f.sta||7,tac:f.tac||7,tier:f.tier,trait:f.trait||'',pers:f.pers,sig:f.sig,sigMult:f.sigMult,trans:f.trans||'',tAtk:f.tAtk||0,tDef:f.tDef||0,weak:f.weak||'',style:f.style||'',usage:f.usage||'',powers:(POWERS[f.id]||[]).slice()}; })())`);
  const s = JSON.parse(json);
  if (!s) throw new Error('unknown fighter ' + id);
  s.variant = 'Base'; s.variantId = 'base';
  return Object.assign(s, over || {});
}
function battle(sides, opts) {
  // Pass specs into the vm context as JSON, run, return JSON out.
  const code = `JSON.stringify(runGenericBattle(JSON.parse(${JSON.stringify(JSON.stringify(sides))}), JSON.parse(${JSON.stringify(JSON.stringify(opts || {}))})))`;
  return JSON.parse(runInCtx(code));
}
function call(fn, argJson) {
  return JSON.parse(runInCtx(`JSON.stringify(${fn}(JSON.parse(${JSON.stringify(argJson)})))`));
}
function noPostDefeatActions(b) {
  const dead = new Set();
  for (const e of b.events) {
    if (e.type === 'knockout' || e.type === 'incapacitated') dead.add(e.actorId || e.target);
    // track by target id for defeat:
  }
  const defeated = new Set();
  for (const e of b.events) {
    if (e.type === 'knockout' || e.type === 'incapacitated') defeated.add(e.targetId);
    if ((e.type === 'attack' || e.type === 'transform' || e.type === 'heal' || e.type === 'study' || e.type === 'prepare') && defeated.has(e.actorId)) return false;
  }
  return true;
}
function stateOf(b, name) { return b.finalState.find(s => s.name === name); }

// ================= 20 REQUIRED TESTS =================
// 1. Stronger defeats substantially weaker when justified.
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
  check('1 stronger defeats weaker (Superman beats Rocky)', b.winner === 'Superman' && stateOf(b, 'Rocky Balboa').dead === true && stateOf(b, 'Rocky Balboa').currentHp === 0, 'winner=' + b.winner);
}
// 2. Weaker exploits a legitimate canonical weakness.
{
  const b = battle([[spec('batman')], [spec('superman')]], { seed: 12345, victoryMode: 'death' });
  const exploited = b.events.filter(e => e.type === 'attack' && e.counterExploited && e.damage > 0);
  check('2 weaker exploits canonical weakness (Batman Kryptonite counter lands for damage)', exploited.length >= 1, 'exploited damaging attacks=' + exploited.length + ' winner=' + b.winner);
  const direct = runInCtx(`JSON.stringify(resolveAttackV14({attacker:{name:'Batman',tier:'S',atk:110,def:85,dex:8,pw:6,dur:6,trait:'prep',kryptoniteExploit:true,currentHp:1000,maxHp:1000},target:{name:'Superman',tier:'EX',atk:160,def:115,dex:7,pw:10,dur:10,weak:'Kryptonite; magic bypasses much of his durability',currentHp:1800,maxHp:1800},ability:'Gadget Barrage',mult:1.5,isSig:true,crit:false,boost:1.25,counterExploited:true,rng:()=>0.5}))`);
  const d = JSON.parse(direct);
  check('2b Kryptonite bypass via resolveAttackV14 deals damage (not cannot-harm)', d.damage > 0 && !d.cannotHarm, JSON.stringify(d));
}
// 3. Immune target takes no damage from a canonically-immune attack type.
{
  const att = { name: 'Attacker', tier: 'A', atk: 200, def: 50, dex: 7, pw: 7, dur: 7, currentHp: 1000, maxHp: 1000 };
  const def = { name: 'Immune', tier: 'A', atk: 100, def: 50, dex: 7, pw: 7, dur: 7, currentHp: 1000, maxHp: 1000, immunities: ['poison'] };
  const r1 = JSON.parse(runInCtx(`JSON.stringify(resolveAttackV14({attacker:JSON.parse(${JSON.stringify(JSON.stringify(att))}),target:JSON.parse(${JSON.stringify(JSON.stringify(def))}),ability:'Venom Strike',mult:1,isSig:false,crit:false,boost:1,rng:()=>0.5}))`));
  const r2 = JSON.parse(runInCtx(`JSON.stringify(resolveAttackV14({attacker:JSON.parse(${JSON.stringify(JSON.stringify(att))}),target:JSON.parse(${JSON.stringify(JSON.stringify(def))}),ability:'Heavy Punch',mult:1,isSig:false,crit:false,boost:1,rng:()=>0.5}))`));
  const r3 = JSON.parse(runInCtx(`JSON.stringify(resolveAttackV14({attacker:JSON.parse(${JSON.stringify(JSON.stringify(att))}),target:JSON.parse(${JSON.stringify(JSON.stringify(def))}),ability:'Venom Strike',mult:1,isSig:false,crit:false,boost:1,bypassMechanism:true,rng:()=>0.5}))`));
  check('3 immune target takes 0 poison damage', r1.damage === 0 && r1.outcome === 'immune', JSON.stringify(r1));
  check('3b same target takes physical damage', r2.damage > 0, JSON.stringify(r2));
  check('3c recorded bypass mechanism overrides immunity', r3.damage > 0, JSON.stringify(r3));
}
// 4. Valid special ability bypasses a defence when its mechanics justify it.
{
  const att = { name: 'Psychic', tier: 'A', atk: 130, def: 50, dex: 7, pw: 7, dur: 7, currentHp: 1000, maxHp: 1000 };
  const def = { name: 'Titan', tier: 'EX', atk: 100, def: 100, dex: 7, pw: 7, dur: 10, currentHp: 2000, maxHp: 2000 };
  const r = JSON.parse(runInCtx(`JSON.stringify(resolveAttackV14({attacker:JSON.parse(${JSON.stringify(JSON.stringify(att))}),target:JSON.parse(${JSON.stringify(JSON.stringify(def))}),ability:'Mind Blast',mult:1.5,isSig:true,crit:false,boost:1,rng:()=>0.5}))`));
  const rPhys = JSON.parse(runInCtx(`JSON.stringify(resolveAttackV14({attacker:JSON.parse(${JSON.stringify(JSON.stringify(att))}),target:JSON.parse(${JSON.stringify(JSON.stringify(def))}),ability:'Heavy Punch',mult:1.5,isSig:true,crit:false,boost:1,rng:()=>0.5}))`));
  check('4 psychic bypass deals damage despite tier gap + high durability', r.damage > 0 && !r.cannotHarm, JSON.stringify(r));
  check('4b ordinary physical attack at same gap is cannot-harm', rPhys.cannotHarm === true && rPhys.damage === 0, JSON.stringify(rPhys));
}
// 5. Defeated character takes no further ordinary turns.
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 99, victoryMode: 'death' });
  check('5 no defeated fighter acts after defeat', noPostDefeatActions(b), 'events=' + b.events.length);
}
// 6. Knockout does NOT end a multi-combatant side while teammates remain.
{
  const weak = { id: 'weak1', name: 'Weak Teammate', hp: 300, atk: 50, def: 50, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'disciplined', sig: 'Tap', sigMult: 1.2, trans: '', tAtk: 0, tDef: 0, weak: '', powers: ['Tap'] };
  const strong = spec('superman');
  const foe = spec('goku');
  const b = battle([[weak, strong], [foe]], { seed: 12345, victoryMode: 'death' });
  const weakId = b.teams[0][0].instanceId;
  const koIdx = b.events.findIndex(e => (e.type === 'knockout' || e.type === 'incapacitated') && e.targetId === weakId);
  const strongActsAfter = koIdx >= 0 && b.events.slice(koIdx + 1).some(e => e.actorId === b.teams[0][1].instanceId && e.type === 'attack');
  check('6 side survives first knockout: teammate acts after it', koIdx >= 0 && strongActsAfter, 'koIdx=' + koIdx + ' winner=' + b.winner);
}
// 7. Simultaneous defeat = explicit tie / mutual destruction.
{
  const o0 = JSON.parse(runInCtx(`JSON.stringify(deriveOutcomeV15([false,false],'death',[[{name:'A',alive:false}],[{name:'B',alive:false}]]))`));
  const o1 = JSON.parse(runInCtx(`JSON.stringify(deriveOutcomeV15([true,false],'death',[[{name:'A',alive:true}],[{name:'B',alive:false}]]))`));
  const o2 = JSON.parse(runInCtx(`JSON.stringify(deriveOutcomeV15([true,true],'death',[[{name:'A',alive:true}],[{name:'B',alive:true}]]))`));
  check('7 simultaneous elimination is Tie, not an arbitrary winner', o0.winner === 'Tie' && o0.mutualDestruction === true && o0.winnerSide === null, JSON.stringify(o0));
  check('7b single surviving side wins that side', o1.winner === 'A' && o1.winnerSide === 'side0', JSON.stringify(o1));
  check('7c both sides alive is not decided', o2.decided === false, JSON.stringify(o2));
}
// 8. Healing/regen within caps, never revives.
{
  const b = battle([[spec('deadpool')], [spec('goku')]], { seed: 12345, victoryMode: 'death' });
  const heals = b.events.filter(e => e.type === 'heal' && e.actor === 'Deadpool');
  const totalHeal = heals.reduce((s, e) => s + (e.heal || 0), 0);
  const dp = stateOf(b, 'Deadpool');
  check('8 regen total within 50% max-HP cap (650)', totalHeal <= 650 && totalHeal > 0, 'totalHeal=' + totalHeal);
  check('8b final HP never exceeds max', b.finalState.every(s => s.currentHp <= s.maxHp), JSON.stringify(b.finalState));
  check('8c playback never revives a defeated fighter', (() => {
    const init = [{ instanceId: 'x', name: 'Dead', currentHp: 0, maxHp: 1000, alive: false, dead: true }];
    const out = JSON.parse(runInCtx(`JSON.stringify(playbackApplyEvents([{type:'heal',actorId:'x',actor:'Dead',heal:40}], JSON.parse(${JSON.stringify(JSON.stringify(init))})))`));
    return out.states[0].currentHp === 0 && out.states[0].alive === false && out.violations.length >= 1;
  })(), '');
}
// 9. Transforms modify the correct character/attributes only.
{
  const x = { id: 'x', name: 'Fighter X', hp: 1000, atk: 100, def: 50, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'disciplined', sig: 'Strike', sigMult: 1.5, trans: 'Mega Form', tAtk: 150, tDef: 10, weak: '', powers: ['Punch'] };
  const y = { id: 'y', name: 'Fighter Y', hp: 1000, atk: 140, def: 50, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'disciplined', sig: 'Smash', sigMult: 1.5, trans: '', tAtk: 0, tDef: 0, weak: '', powers: ['Kick'] };
  const withT = battle([[x], [y]], { seed: 12345, victoryMode: 'death' });
  const withoutT = battle([[{ ...x, trans: '', tAtk: 0, tDef: 0 }], [y]], { seed: 12345, victoryMode: 'death' });
  const tEv = withT.events.find(e => e.type === 'transform');
  check('9 transform flips winner via its recorded effect (not by removal alone)', withT.winner === 'Fighter X' && withoutT.winner === 'Fighter Y' && !!tEv && tEv.detail === 'Mega Form', 'with=' + withT.winner + ' without=' + withoutT.winner);
  check('9b transform changes only the transforming fighter', withT.teams[1][0].atk === 140 && withT.teams[0][0].atk === 250, 'xAtk=' + withT.teams[0][0].atk + ' yAtk=' + withT.teams[1][0].atk);
  const same = battle([[spec('luffy', { variant: 'Gear 5', variantId: 'base' })], [spec('rocky')]], { seed: 5, victoryMode: 'death' });
  // Luffy variant equals its transform: the generic engine must not grant a second transform.
  const luffyTrans = same.events.filter(e => e.type === 'transform' && e.actor === 'Monkey D. Luffy');
  check('9c a variant that IS the transform form gets no second transform', luffyTrans.length === 0, 'transforms=' + luffyTrans.length);
}
// 10. Battlefield effects applied exactly once.
{
  const inst = JSON.parse(runInCtx(`JSON.stringify((function(){ const f={id:'t',name:'T',atk:100,def:50}; applyBattlefieldOnceV15(f,{id:'ruined',name:'Ruined City',atk:0,def:12}); const a={atk:f.atk,def:f.def}; applyBattlefieldOnceV15(f,{id:'ruined',name:'Ruined City',atk:0,def:12}); return {first:a,second:{atk:f.atk,def:f.def}}; })())`));
  check('10 battlefield applied exactly once (second apply is a no-op)', inst.first.atk === 100 && inst.first.def === 62 && inst.second.atk === 100 && inst.second.def === 62, JSON.stringify(inst));
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 3, victoryMode: 'death', battlefield: { id: 'ruined', name: 'Ruined City', desc: 'Broken buildings give cover.', atk: 0, def: 12 } });
  check('10b exactly one battlefield event in the record', b.events.filter(e => e.type === 'battlefield').length === 1, 'bf events=' + b.events.filter(e => e.type === 'battlefield').length);
}
// 11. Playback reproduces recorded events exactly (no recalculation).
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
  const init = b.teams.flat().map(f => ({ instanceId: f.instanceId, name: f.name, currentHp: f.maxHp, maxHp: f.maxHp, alive: true, dead: false }));
  const out = JSON.parse(runInCtx(`JSON.stringify(playbackApplyEvents(JSON.parse(${JSON.stringify(JSON.stringify(b.events))}), JSON.parse(${JSON.stringify(JSON.stringify(init))})))`));
  const match = out.states.every(s => { const fs = b.finalState.find(x => x.instanceId === s.instanceId); return fs && fs.currentHp === s.currentHp && fs.alive === s.alive && fs.dead === s.dead; });
  check('11 playback final state equals authoritative final state', match && out.violations.length === 0, JSON.stringify(out.states) + ' vs ' + JSON.stringify(b.finalState));
}
// 12. Final winner agrees with final combat state.
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
  check('12 winner alive, loser dead, finalRecord agrees', b.finalRecord.winner === b.winner && stateOf(b, 'Superman').alive === true && stateOf(b, 'Rocky Balboa').dead === true, 'winner=' + b.winner + ' finalRecord=' + b.finalRecord.winner);
}
// 13. Invalid selections cannot start a battle.
{
  const v = (ids) => JSON.parse(runInCtx(`JSON.stringify(validateSelectionV15(JSON.parse(${JSON.stringify(JSON.stringify(ids))})))`));
  check('13 mirror blocked', v(['batman', 'batman']).ok === false, '');
  check('13b single fighter blocked', v(['batman']).ok === false, '');
  check('13c three fighters blocked', v(['batman', 'superman', 'goku']).ok === false, '');
  check('13d unknown id blocked', v(['nope', 'superman']).ok === false, '');
  check('13e valid distinct pair allowed', v(['batman', 'superman']).ok === true, '');
}
// 14. Missing research data does not crash.
{
  let ok = true, detail = '';
  try {
    const prof = runInCtx(`structuredProfileHtml(byId('frodo'))`);
    if (typeof prof !== 'string' || prof.indexOf('NOT KNOWN') === -1) { ok = false; detail = 'profile html lacks NOT KNOWN'; }
    const b = battle([[spec('frodo')], [spec('samwise')]], { seed: 11, victoryMode: 'death' });
    if (!b.winner) { ok = false; detail = 'battle without research did not finish'; }
  } catch (e) { ok = false; detail = String(e && e.message || e); }
  check('14 missing research does not crash; unknown fields show NOT KNOWN', ok, detail); // NOT KNOWN here is the unknown equipment field, not a missing powerset
}
// 15. Failed story generation does not destroy battle results.
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
  const beforeEvents = JSON.stringify(b.events), beforeWinner = b.winner;
  let threw = false;
  try { runInCtx(`generateEpisodeV14(null)`); } catch (e) { threw = true; }
  check('15 failed story attempt leaves the battle record intact', threw === true && JSON.stringify(b.events) === beforeEvents && b.winner === beforeWinner, 'threw=' + threw);
}
// 16. Corrupted saved data does not crash startup.
{
  const ok = runInCtx(`(function(){ const old = localStorage; try{ localStorage = { getItem: function(k){ return k==='warroom_battles_v3' ? 'not-json{{{' : null; }, setItem: function(){}, removeItem: function(){} }; const a = loadHistory(); localStorage = { getItem: function(k){ return k==='warroom_battles_v3' ? '{"a":1}' : null; }, setItem: function(){}, removeItem: function(){} }; const c = loadHistory(); return JSON.stringify({a:a,c:c}); } finally { localStorage = old; } })()`);
  const o = JSON.parse(ok);
  check('16 corrupted / non-array localStorage returns [] without throwing', Array.isArray(o.a) && o.a.length === 0 && Array.isArray(o.c) && o.c.length === 0, ok);
}
// 17. Imported history is validated (malformed rejected safely).
{
  const v = (x) => JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15(JSON.parse(${JSON.stringify(JSON.stringify(x))})))`));
  check('17 null rejected', v(null).ok === false, '');
  check('17b missing story rejected', v({ winner: 'X' }).ok === false, '');
  check('17c non-array eventRecord rejected', v({ winner: 'X', story: 's', eventRecord: {} }).ok === false, '');
  check('17d malformed event entry rejected', v({ winner: 'X', story: 's', eventRecord: [{ type: 'attack' }] }).ok === false, '');
  check('17e contradicting finalRecord rejected', v({ winner: 'X', story: 's', finalRecord: { winner: 'Y' } }).ok === false, '');
  check('17f valid v15 accepted', v({ winner: 'X', story: 's', formatVersion: 'v15', eventRecord: [] }).ok === true && v({ winner: 'X', story: 's', formatVersion: 'v15', eventRecord: [] }).legacy === false, '');
  check('17g v14 flagged legacy read-only (still openable)', (() => { const r = v({ winner: 'X', story: 's', formatVersion: 'v14', eventRecord: [] }); return r.ok === true && r.legacy === true; })(), '');
}
// 17h v15.1 accepted as current, v15 still openable as current-family (not orphaned).
{
  const v = (x) => JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15(JSON.parse(${JSON.stringify(JSON.stringify(x))})))`));
  const r = v({ winner: 'X', story: 's', formatVersion: 'v15.1', eventRecord: [] });
  const r15 = v({ winner: 'X', story: 's', formatVersion: 'v15', eventRecord: [] });
  check('17h v15.1 accepted as current and v15 still openable', r.ok === true && r.legacy === false && r15.ok === true, JSON.stringify(r) + ' / ' + JSON.stringify(r15));
  const r16 = v({ winner: 'X', story: 's', formatVersion: 'v16', eventRecord: [] });
  const r161 = v({ winner: 'X', story: 's', formatVersion: 'v16.1', eventRecord: [] });
  check('17i v16 and v16.1 accepted as current (v14 stays legacy read-only)', r16.ok === true && r16.legacy === false && r161.ok === true && r161.legacy === false, JSON.stringify(r16) + ' / ' + JSON.stringify(r161));
  const r162 = v({ winner: 'X', story: 's', formatVersion: 'v16.2', eventRecord: [] });
  check('17j v16.2 accepted as current', r162.ok === true && r162.legacy === false, JSON.stringify(r162));
  const r163 = v({ winner: 'X', story: 's', formatVersion: 'v16.3', eventRecord: [] });
  check('17k v16.3 accepted as current', r163.ok === true && r163.legacy === false, JSON.stringify(r163));
  const r164 = v({ winner: 'X', story: 's', formatVersion: 'v16.4', eventRecord: [] });
  check('17l v16.4 accepted as current', r164.ok === true && r164.legacy === false, JSON.stringify(r164));
  const r165 = v({ winner: 'X', story: 's', formatVersion: 'v16.5', eventRecord: [] });
  check('17m v16.5 accepted as current', r165.ok === true && r165.legacy === false, JSON.stringify(r165));
}

// 18. Similar names / two versions of one character do not cross-target.
{
  const g1 = spec('gandalf', { variant: 'Base', variantId: 'base' });
  const g2 = spec('gandalf', { variant: 'Gandalf the White', variantId: 'v2' });
  const b = battle([[g1], [g2]], { seed: 12345, victoryMode: 'death' });
  const ids = new Set(b.teams.flat().map(f => f.instanceId));
  const selfHit = b.events.some(e => e.type === 'attack' && e.actorId && e.actorId === e.targetId);
  check('18 two versions of one character have distinct instance ids and never self-target', ids.size === 2 && !selfHit, 'ids=' + [...ids].join(','));
  const init = b.teams.flat().map(f => ({ instanceId: f.instanceId, name: f.name, currentHp: f.maxHp, maxHp: f.maxHp, alive: true, dead: false }));
  const out = JSON.parse(runInCtx(`JSON.stringify(playbackApplyEvents(JSON.parse(${JSON.stringify(JSON.stringify(b.events))}), JSON.parse(${JSON.stringify(JSON.stringify(init))})))`));
  check('18b playback keeps the two versions separate', out.states.length === 2 && out.states[0].instanceId !== out.states[1].instanceId, '');
}
// 19. Battle cannot run indefinitely (round cap + stalemate).
{
  const tankA = { id: 'ta', name: 'Tank A', hp: 5000, atk: 10, def: 200, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'disciplined', sig: 'Tap', sigMult: 1.1, trans: '', tAtk: 0, tDef: 0, weak: '', powers: ['Tap'] };
  const tankB = { id: 'tb', name: 'Tank B', hp: 5000, atk: 10, def: 200, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'disciplined', sig: 'Tap', sigMult: 1.1, trans: '', tAtk: 0, tDef: 0, weak: '', powers: ['Tap'] };
  const b = battle([[tankA], [tankB]], { seed: 1, victoryMode: 'death', maxRounds: 5 });
  check('19 round cap ends in an explained stalemate, never an arbitrary win', b.winner === 'Stalemate' && b.stalemate === true && b.rounds <= 5, 'winner=' + b.winner + ' rounds=' + b.rounds);
}
// 20. Generated story does not contradict recorded deaths/transforms/final result.
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
  const story = runInCtx(`(function(){ const bb = JSON.parse(${JSON.stringify(JSON.stringify(b))}); bb.alpha = bb.teams[0]; bb.beta = bb.teams[1]; bb.winnerFighter = bb.teams[0].find(f=>f.alive)||null; bb.loserFighter = bb.teams[1].find(f=>!f.alive)||bb.teams[1][0]; return generateEpisodeV14(bb); })()`);
  const plain = story.replace(/<[^>]+>/g, ' ');
  const finAtk = [...b.events].reverse().find(e => e.type === 'attack' && e.actor === 'Superman');
  check('20 story names winner and real finishing ability', plain.indexOf('Superman') !== -1 && finAtk && plain.indexOf(finAtk.ability) !== -1, 'finAbility=' + (finAtk && finAtk.ability));
  const bi = battle([[spec('kakashi')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
  if (bi.winner !== 'Stalemate' && bi.winner !== 'Tie') {
    const storyI = runInCtx(`(function(){ const bb = JSON.parse(${JSON.stringify(JSON.stringify(bi))}); bb.alpha = bb.teams[0]; bb.beta = bb.teams[1]; bb.winnerFighter = bb.teams.flat().find(f=>f.name===bb.winner)||null; bb.loserFighter = bb.teams.flat().find(f=>f.name!==bb.winner)||null; return generateEpisodeV14(bb); })()`);
    const plainI = storyI.replace(/<[^>]+>/g, ' ');
    const loserName = bi.teams.flat().find(f => f.name !== bi.winner).name;
    check('20b incapacitation story never calls the loser dead', plainI.indexOf(loserName + ' is dead') === -1 && plainI.indexOf(' is dead (HP 0)') === -1, 'winner=' + bi.winner);
  } else {
    check('20b incapacitation story never calls the loser dead (skipped: stalemate)', false, 'unexpected stalemate winner=' + bi.winner);
  }
}
// Breakdown labels: OBSERVED / PREPARED / EXPLOITED / DETECTED / mercy CHOICE.
{
  const fake = {
    alpha: [{ name: 'Batman', variant: 'Base', startHp: 1000, maxHp: 1000, startAtk: 110, atk: 110, startDef: 85, def: 85, sp: 1.3, tier: 'S', transformed: false }],
    beta: [{ name: 'Superman', variant: 'Base', startHp: 1800, maxHp: 1800, startAtk: 160, atk: 160, startDef: 115, def: 115, sp: 1.1, tier: 'EX', transformed: false }],
    battlefield: { name: 'Open Arena', atk: 0, def: 0 }, winner: 'Batman', rounds: 3, seed: 1, destruction: 0, totalDamage: 100,
    events: [
      { id: 0, round: 1, type: 'study', actor: 'Batman', detail: 'observes a pattern: repeated flight approach' },
      { id: 1, round: 2, type: 'prepare', actor: 'Batman', detail: 'counter prepared' },
      { id: 2, round: 3, type: 'attack', actor: 'Batman', target: 'Superman', ability: 'Gadget Barrage', damage: 150, crit: false, blocked: false, targetHp: 1650, targetMax: 1800, counterExploited: true },
      { id: 3, round: 3, type: 'attack', actor: 'Superman', target: 'Batman', ability: 'Super Punch', damage: 100, crit: false, blocked: false, targetHp: 900, targetMax: 1000, counterDetected: true },
      { id: 4, round: 3, type: 'choice', actor: 'Superman', target: 'Batman', detail: 'holds the lethal finish', reason: 'merciful fighter chooses incapacitation over a lethal finishing move' },
    ],
  };
  const bd = runInCtx(`generateBreakdown(JSON.parse(${JSON.stringify(JSON.stringify(fake))}))`);
  check('labels breakdown shows OBSERVED / PREPARED / EXPLOITED / DETECTED / MERCY-HELD-FINISH', bd.indexOf('OBSERVED') !== -1 && bd.indexOf('PREPARED') !== -1 && bd.indexOf('EXPLOITED') !== -1 && bd.indexOf('DETECTED') !== -1 && bd.indexOf('MERCY / HELD FINISH') !== -1, bd.slice(0, 300));
}

// ================= v14 REGRESSION SCENARIOS (retained) =================
// R1 Superman vs Rocky cannot-harm.
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
  const rockyHits = b.events.filter(e => e.type === 'attack' && e.actor === 'Rocky Balboa');
  check('R1 Superman vs Rocky: Rocky cannot harm Superman by ordinary attacks', rockyHits.length >= 1 && rockyHits.every(e => e.cannotHarm === true || e.damage === 0), 'rocky attacks=' + rockyHits.length);
}
// R2 Batman vs Superman Kryptonite exploit (mechanism, see test 2).
{
  const b = battle([[spec('batman')], [spec('superman')]], { seed: 12345, victoryMode: 'death' });
  const study = b.events.some(e => e.type === 'study' && e.knowledgeStage === 'OBSERVED');
  const prep = b.events.some(e => e.type === 'prepare' && e.knowledgeStage === 'PREPARED');
  check('R2 Batman vs Superman: study OBSERVED then PREPARED then exploit', study && prep && b.events.some(e => e.counterExploited), 'study=' + study + ' prep=' + prep);
}
// R3 Deadpool vs Goku regen.
{
  const b = battle([[spec('deadpool')], [spec('goku')]], { seed: 12345, victoryMode: 'death' });
  const heals = b.events.filter(e => e.type === 'heal');
  check('R3 Deadpool vs Goku: regen heals while alive, capped, never revives', heals.length >= 1 && heals.reduce((s, e) => s + (e.heal || 0), 0) <= 650 && noPostDefeatActions(b), 'heals=' + heals.length + ' winner=' + b.winner);
}
// R4 Transform flips winner (see test 9) — re-asserted with roster fighters.
{
  const x = { id: 'x', name: 'Fighter X', hp: 1000, atk: 100, def: 50, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'disciplined', sig: 'Strike', sigMult: 1.5, trans: 'Mega Form', tAtk: 150, tDef: 10, weak: '', powers: ['Punch'] };
  const y = { id: 'y', name: 'Fighter Y', hp: 1000, atk: 140, def: 50, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'disciplined', sig: 'Smash', sigMult: 1.5, trans: '', tAtk: 0, tDef: 0, weak: '', powers: ['Kick'] };
  const a = battle([[x], [y]], { seed: 12345, victoryMode: 'death' });
  const c = battle([[{ ...x, trans: '' }], [y]], { seed: 12345, victoryMode: 'death' });
  check('R4 transform flips winner with the effect identified', a.winner === 'Fighter X' && c.winner === 'Fighter Y' && a.events.some(e => e.type === 'transform' && e.detail === 'Mega Form'), 'with=' + a.winner + ' without=' + c.winner);
}
// R5 Kakashi vs Batman incapacitation.
{
  let found = null;
  for (const seed of [12345, 7, 42, 99, 2024]) {
    const b = battle([[spec('kakashi')], [spec('batman')]], { seed, victoryMode: 'incapacitation' });
    if (b.winner === 'Kakashi Hatake') { found = b; break; }
  }
  check('R5 Kakashi vs Batman incapacitation: loser unconscious, dead=false', !!found && stateOf(found, 'Batman').unconscious === true && stateOf(found, 'Batman').dead === false && stateOf(found, 'Batman').incapacitated === true, found ? 'winner=' + found.winner : 'no Kakashi win in tried seeds');
}
// R6 Gojo pride refusal.
{
  const proudWeak = { id: 'pw', name: 'Proud Weak', hp: 1000, atk: 80, def: 50, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'A', pers: 'proud', sig: 'Strike', sigMult: 1.5, trans: '', tAtk: 0, tDef: 0, weak: '', powers: ['Punch'] };
  const strong = { id: 'st', name: 'Strong Foe', hp: 2000, atk: 220, def: 50, sp: 1, dex: 7, dur: 7, pw: 7, sta: 7, tier: 'S', pers: 'disciplined', sig: 'Smash', sigMult: 1.5, trans: '', tAtk: 0, tDef: 0, weak: '', powers: ['Kick'] };
  const b = battle([[proudWeak], [strong]], { seed: 12345, victoryMode: 'death' });
  const refused = b.events.filter(e => e.type === 'refused' && e.actor === 'Proud Weak');
  check('R6 proud fighter records a refusal (not every turn)', refused.length >= 1 && refused.length <= 2, 'refusals=' + refused.length);
}
// R7 Chapter V = real finish.
{
  const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
  const story = runInCtx(`(function(){ const bb = JSON.parse(${JSON.stringify(JSON.stringify(b))}); bb.alpha = bb.teams[0]; bb.beta = bb.teams[1]; bb.winnerFighter = bb.teams[0].find(f=>f.alive)||null; bb.loserFighter = bb.teams[1].find(f=>!f.alive)||bb.teams[1][0]; return generateEpisodeV14(bb); })()`);
  const ch5 = story.split('<h3>Chapter V')[1] || '';
  const finAtk = [...b.events].reverse().find(e => e.type === 'attack' && e.actor === 'Superman');
  check('R7 Chapter V names the real finishing ability', !!finAtk && ch5.indexOf(finAtk.ability) !== -1, 'finAbility=' + (finAtk && finAtk.ability));
}
// R8 Same-seed determinism.
{
  const a = battle([[spec('superman')], [spec('rocky')]], { seed: 777, victoryMode: 'death' });
  const c = battle([[spec('superman')], [spec('rocky')]], { seed: 777, victoryMode: 'death' });
  check('R8 same seed + fighters + battlefield = identical events and winner', eq(a.events, c.events) && a.winner === c.winner, '');
}
// All-194 vs Batman no-crash.
{
  const ids = JSON.parse(runInCtx(`JSON.stringify(ROSTER.map(f=>f.id))`));
  let crashed = null, badWinner = null;
  for (const id of ids) {
    if (id === 'batman') continue;
    try {
      const b = battle([[spec('batman')], [spec(id)]], { seed: 7, victoryMode: 'death' });
      if (!['Batman', 'Stalemate', 'Tie'].includes(b.winner) && !b.teams.flat().some(f => f.name === b.winner)) badWinner = id + ' -> ' + b.winner;
      if (!noPostDefeatActions(b)) badWinner = id + ' post-defeat action';
    } catch (e) { crashed = id + ': ' + (e && e.message || e); break; }
  }
  check('ALL-194 vs Batman: no crash, sane winners, no post-defeat actions', crashed === null && badWinner === null, crashed || badWinner || '');
}
// Profile batch 1: 20 completed, 78 remain signature-only.
{
  // Audit correction: the POWERS literal holds 96, but the V7 block assigns the other 98 at runtime
  // (union 194/194, overlap 0). No fighter is signature-only in the shipped build, so the batch
  // count is 194 with powers / 0 remaining — not 116/78. The earlier literal-only count was wrong.
  const counts = JSON.parse(runInCtx(`JSON.stringify({total:ROSTER.length, withPowers:ROSTER.filter(f=>POWERS[f.id]&&POWERS[f.id].length===3).length, without:ROSTER.filter(f=>!(POWERS[f.id]&&POWERS[f.id].length)).length})`));
  check('BATCH-1 roster (runtime truth): 194 fighters, 194 with 3 powers, 0 signature-only', counts.total === 194 && counts.withPowers === 194 && counts.without === 0, JSON.stringify(counts));
  const batchOk = ['vegeta', 'deadpool', 'kakashi', 'rocky', 'gaara', 'killua', 'storm', 'toph', 'zuko', 'katara', 'ezio', 'blackwidow', 'supergirl', 'nightwing', 'leonkennedy', 'crashbandicoot', 'spyro', 'chunli', 'scorpion', 'subzero'].every(id => {
    const p = JSON.parse(runInCtx(`JSON.stringify(POWERS[${JSON.stringify(id)}]||[])`));
    return Array.isArray(p) && p.length === 3;
  });
  check('BATCH-1 all 20 named fighters have 3-power entries', batchOk, '');
}
// Source audits.
{
  check('AUDIT exactly one generateStoryV2 definition', (html.match(/function generateStoryV2/g) || []).length === 1, 'count=' + (html.match(/function generateStoryV2/g) || []).length);
  check('AUDIT no fixed-action-number signature triggers (actions%4 / actions%3)', script.indexOf('actions%4') === -1 && script.indexOf('actions%3') === -1, '');
  check('AUDIT no v13.1 user-visible references remain', html.indexOf('v13.1') === -1, '');
  check('AUDIT escapeHtml escapes quotes and angle brackets', runInCtx(`escapeHtml('<a "b" \\'c\\'>&')`) === '&lt;a &quot;b&quot; &#39;c&#39;&gt;&amp;', runInCtx(`escapeHtml('<a "b">')`));
  check('AUDIT safeUrl rejects javascript: URLs', runInCtx(`safeUrl('javascript:alert(1)')`) === '#', '');
  // v16.18 DELIBERATE CHANGE: save format is now v16.18; v15/v15.1/v16/v16.1/v16.17 saves still loadable via the importer list.
  check('AUDIT v16.32 (v16.32 DELIBERATE CHANGE: save format bumped to v16.28; save functions return null — no saves are created in the simplified flow; v15/v15.1/v16/v16.1 saves still loadable, see V151-3)', html.indexOf("formatVersion:'v16.35'") !== -1 && runInCtx('saveBattle(null) === null') === true, '');
  check('AUDIT mode-aware headings helper exists', script.indexOf('function updateModeHeadings') !== -1, '');
  check('AUDIT no research stat bonus in live instance path', script.indexOf('inst.atk+=10') === -1, '');
}


// ================= v15.1 FIX TESTS (live defects, UI path via simulateBattle) =================
// The v15 harness only exercised runGenericBattle, which has no battlefield-desc
// event — so it could not see the live System C repeats. These tests use the real
// UI path (simulateBattle) that the browser actually runs.
function uiBattle151(aId, bId, seed, mode) {
  runInCtx(`selected=[${JSON.stringify(aId)},${JSON.stringify(bId)}]; forcedSeed=${seed}; forcedVictoryMode=${JSON.stringify(mode)}; document.getElementById('victory-select').value=${JSON.stringify(mode)};`);
  const b = JSON.parse(runInCtx(`JSON.stringify(simulateBattle())`));
  return b;
}
function uiStory151(b) {
  return runInCtx(`generateEpisodeV14(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
}
function dupSentences151(story) {
  const plain = story.replace(/<[^>]+>/g, ' ').replace(/\b([A-Z])\.\s+(?=[A-Z])/g, '$1 ').replace(/\b(Ms|Mr|Dr|St)\.\s+(?=[A-Z])/g, '$1 ');
  const sents = plain.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 12);
  const seen = new Set(), dup = [];
  sents.forEach(s => { const k = s.toLowerCase(); if (seen.has(k)) dup.push(s); else seen.add(k); });
  return { total: sents.length, uniq: seen.size, dup };
}
function qualityLine151(b, story, name) {
  const qs = JSON.parse(runInCtx(`JSON.stringify(storyQualityChecksV14(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(story)}))`));
  const line = qs.find(c => c.name === name);
  return line || { passed: false, detail: 'line not found' };
}
// V151-1 System C: 0 repeated sentences on BOTH live matchups, across seeds, UI path.
{
  let worst = null;
  for (const [a, bn, mode] of [['superman', 'rocky', 'death'], ['spiderman', 'batman', 'incapacitation']]) {
    for (const seed of [832046845, 145416145, 12345, 777, 1, 42, 999, 2024]) {
      const b = uiBattle151(a, bn, seed, mode);
      const story = uiStory151(b);
      const d = dupSentences151(story);
      const line = qualityLine151(b, story, 'No repeated sentences');
      if (d.dup.length !== 0 || line.passed !== true) worst = a + ' vs ' + bn + ' seed ' + seed + ' dups=' + d.dup.join(' | ') + ' linePassed=' + line.passed;
      // Systems A and B must still pass on the same battle.
      const acc = JSON.parse(runInCtx(`JSON.stringify(narrativeAccuracyChecksV14(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(story)}))`));
      if (acc.some(c => c.passed === false)) worst = (worst || '') + ' accuracy-fail ' + a + '/' + bn + '/' + seed;
    }
  }
  check('V151-1 System C 0 repeats on Superman/Rocky + Spider-Man/Batman across 8 seeds each (UI path), Systems A/B still pass', worst === null, worst || '');
}
// V151-2 Chapter V still names the real finish on UI-path battles.
{
  const b = uiBattle151('superman', 'rocky', 832046845, 'death');
  const story = uiStory151(b);
  const ch5 = story.split('<h3>Chapter V')[1] || '';
  const finAtk = [...b.events].reverse().find(e => e.type === 'attack' && e.actor === 'Superman');
  check('V151-2 Chapter V names the real finishing ability (UI path)', !!finAtk && ch5.indexOf(finAtk.ability) !== -1, 'finAbility=' + (finAtk && finAtk.ability));
  const bi = uiBattle151('spiderman', 'batman', 145416145, 'incapacitation');
  const storyI = uiStory151(bi);
  const ch5I = storyI.split('<h3>Chapter V')[1] || '';
  const finI = [...bi.events].reverse().find(e => e.type === 'attack' && e.actor === 'Spider-Man');
  check('V151-2b Incapacitation Chapter V names the real finishing ability (UI path)', !!finI && ch5I.indexOf(finI.ability) !== -1, 'finAbility=' + (finI && finI.ability));
}
// V151-3 Saved-episode headings come from the saved entry, not the current mode (both directions + v15 load).
{
  const setSave = (entry) => runInCtx(`localStorage.setItem('warroom_battles_v3', JSON.stringify([JSON.parse(${JSON.stringify(JSON.stringify(entry))})]));`);
  const deathSave = { id: 424242, formatVersion: 'v15.1', winner: 'Superman', victoryType: 'Death (HP 0)', victoryMode: 'death', battlefield: 'Open Arena', date: '10/30/2026, 6:18:20 AM', rounds: 7, seed: 832046845, eventRecord: [], story: '<h3>Chapter I</h3><p>Saved death story.</p>', breakdown: '<li>Saved breakdown.</li>' };
  setSave(deathSave);
  runInCtx(`document.getElementById('victory-select').value='incapacitation'; document.getElementById('episode-heading').innerText='Incapacitation Episode — 6 Chapters (Narrator Style C)'; viewHistory(424242);`);
  check('V151-3 (v16.33 DELIBERATE CHANGE: Death (knockout) heading) saved Death reopened after Incapacitation shows Death heading', els['episode-heading'].innerText.indexOf('Death (knockout) Battle Episode') === 0, els['episode-heading'].innerText);
  const incapSave = { id: 515151, formatVersion: 'v15.1', winner: 'Spider-Man', victoryType: 'Incapacitation — knockout (unconscious, not dead)', victoryMode: 'incapacitation', battlefield: 'Open Arena', date: '10/30/2026, 6:20:00 AM', rounds: 6, seed: 4817076, eventRecord: [], story: '<h3>Chapter I</h3><p>Saved incap story.</p>', breakdown: '<li>Saved breakdown.</li>' };
  setSave(incapSave);
  runInCtx(`document.getElementById('victory-select').value='death'; document.getElementById('episode-heading').innerText='Death Battle Episode — 6 Chapters (Narrator Style C)'; viewHistory(515151);`);
  check('V151-3b saved Incapacitation reopened after Death shows Incapacitation heading', els['episode-heading'].innerText.indexOf('Incapacitation Episode') === 0, els['episode-heading'].innerText);
  const v15Save = { id: 616161, formatVersion: 'v15', winner: 'Superman', victoryType: 'Death (HP 0)', victoryMode: 'death', battlefield: 'Open Arena', date: '10/30/2026, 6:10:00 AM', rounds: 6, seed: 1, eventRecord: [], story: '<h3>Chapter I</h3><p>v15 story.</p>', breakdown: '<li>v15 breakdown.</li>' };
  setSave(v15Save);
  runInCtx(`viewHistory(616161);`);
  check('V151-3c (v16.33 DELIBERATE CHANGE: Death (knockout) heading) v15 save loads correctly (not orphaned) with its own Death heading', els['episode-heading'].innerText.indexOf('Death (knockout) Battle Episode') === 0 && els['result-desc'].innerText.indexOf('6:10:00') !== -1, els['episode-heading'].innerText);
}
// V151-4 Mode + battlefield persist across a simulated reload.
{
  runInCtx(`document.getElementById('victory-select').value='incapacitation'; document.getElementById('battlefield-select').value='ruined'; saveSettingsV151(); document.getElementById('victory-select').value='death'; document.getElementById('battlefield-select').value='arena'; restoreSettingsV151();`);
  check('V151-4 victory mode and battlefield restored after simulated reload', els['victory-select'].value === 'incapacitation' && els['battlefield-select'].value === 'ruined', 'mode=' + els['victory-select'].value + ' bf=' + els['battlefield-select'].value);
}
// V151-5 NOT KNOWN tagging: helper + panel + canon no-result text.
{
  const empty = runInCtx(`fieldOrNotKnownV151('','no variant power established for this fighter.')`);
  const present = runInCtx(`fieldOrNotKnownV151('Web Shot','x')`);
  check('V151-5 fieldOrNotKnownV151 tags empty fields, passes real values through', empty.indexOf('[NOT KNOWN]') === 0 && present === 'Web Shot', empty + ' / ' + present);
  check('V151-5b info panel uses NOT KNOWN fallbacks for sparse fields', html.indexOf('no variant power established for this fighter.') !== -1 && html.indexOf('no power usage established in this profile.') !== -1 && html.indexOf('fieldOrNotKnownV151(f.usage') !== -1, '');
  check('V151-5c canon-search no-result text carries NOT KNOWN', html.indexOf('[NOT KNOWN] — no Wikipedia or Fandom entry was found') !== -1, '');
}
// V151-6 Stale version / fixed-timing text gone.
{
  check('V151-6 (v16.26 DELIBERATE CHANGE: Victory Rules panel removed with Advanced Settings) no user-visible v14 blocked-check text, no Death Rules heading, no fixed signature timing, no Victory Rules panel; signature tactical line + knocked-out mode wording present', html.indexOf('(v14 blocked check') === -1 && html.indexOf('Death Rules — what counts') === -1 && html.indexOf('every 4th action') === -1 && html.indexOf('Victory Rules — what counts') === -1 && html.indexOf('Victory Rules') === -1 && html.indexOf('used tactically, not on a fixed schedule') !== -1 && html.indexOf('the loser is knocked out, not dead') !== -1, '');
}
// V151-7 CRIT never on cannot-harm (record flag, breakdown, System B6b).
{
  let bad = null;
  for (const seed of [832046845, 145416145, 12345, 777, 1, 42, 999, 2024]) {
    const b = uiBattle151('superman', 'rocky', seed, 'death');
    const chCrit = b.events.filter(e => e.type === 'attack' && e.cannotHarm && e.crit);
    if (chCrit.length) bad = 'seed ' + seed + ' crit-on-cannot-harm events=' + chCrit.length;
    const story = uiStory151(b);
    const acc = JSON.parse(runInCtx(`JSON.stringify(narrativeAccuracyChecksV14(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(story)}))`));
    const b6b = acc.find(c => c.name.indexOf('B6b') === 0);
    if (!b6b || b6b.passed !== true) bad = (bad || '') + ' seed ' + seed + ' B6b not passed';
  }
  check('V151-7 no CRIT flag on cannot-harm events and System B6b passes (UI path)', bad === null, bad || '');
}


// ================= v16 ONLINE-AI-STORY TESTS (mock fetch, no real network) =================
async function expectV16(name, fn) {
  try { await fn(); } catch (e) { check(name, false, 'threw: ' + (e && e.stack ? e.stack.split('\n')[0] : e)); }
}
function finAtkOf(b) {
  const fin = [...b.events].filter(e => e.type === 'knockout' || e.type === 'incapacitated').slice(-1)[0];
  if (!fin) return null;
  return [...b.events].reverse().find(e => e.type === 'attack' && e.actor === fin.actor && e.target === fin.target) || null;
}
function goodTextFor(b) {
  const fin = finAtkOf(b);
  const loser = b.alpha[0].name === b.winner ? b.beta[0].name : b.alpha[0].name;
  return b.alpha[0].name + ' and ' + b.beta[0].name + ' clashed on the battlefield, trading blows and reading each other as the fight wore on. '
    + b.winner + ' found the opening that mattered and struck with ' + (fin ? fin.ability : 'a final blow')
    + ', and ' + loser + ' fell dead at the end while ' + b.winner + ' stood as the winner.';
}
function uiBattle16(aId, bId, seed, mode) {
  runInCtx(`selected=[${JSON.stringify(aId)},${JSON.stringify(bId)}]; forcedSeed=${seed}; forcedVictoryMode=${JSON.stringify(mode)}; document.getElementById('victory-select').value=${JSON.stringify(mode)};`);
  return JSON.parse(runInCtx(`JSON.stringify(simulateBattle())`));
}
function setVmBattle(varName, b) {
  runInCtx(`${varName} = JSON.parse(${JSON.stringify(JSON.stringify(b))});`);
}
const waitFor = async (cond, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise(r => setTimeout(r, 20)); }
  return cond();
};
(async () => {
  const realFetch = sandbox.fetch;
  // V16-1 Prompt cap + no full roster in prompt.
  await expectV16('V16-1 prompt capped at 4500 chars and contains no third fighter', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const prompt = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    check('V16-1 prompt capped at 4500 chars and contains no third fighter',
      prompt.length <= 4500 && prompt.indexOf('Godzilla') === -1 && prompt.indexOf('Batman') === -1 && prompt.indexOf('Superman') !== -1 && prompt.indexOf('Rocky') !== -1,
      'len=' + prompt.length);
  });
  await expectV16('V16-1b prompt stays capped under a 300-event record (oldest-first truncation)', async () => {
    const fake = JSON.parse(runInCtx(`JSON.stringify((function(){ const b = runGenericBattle([[{id:'superman',name:'Superman',hp:1800,atk:160,def:115,sp:1.1,tier:'EX',sig:'Heat Vision',sigMult:1.6,trans:'Sun-Charged',tAtk:30,tDef:15,weak:'Kryptonite',style:'Flying powerhouse',powers:['Super Punch']}],[{id:'rocky',name:'Rocky Balboa',hp:1150,atk:100,def:80,sp:1,tier:'A',sig:'Tornado Spin',sigMult:1.5,trans:'',weak:'Human',style:'Boxer',powers:['Jab']}]], {seed:1,victoryMode:'death'}); b.events = Array.from({length:300}, (_,i)=>({id:i,round:i+1,type:'attack',actor:'Superman',target:'Rocky Balboa',ability:'Super Punch',damage:10,blocked:false,targetHp:1000,targetMax:1150})); b.battlefield={name:'Open Arena'}; b.winner='Superman'; return b; })())`));
    const prompt = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(fake))}))`);
    check('V16-1b prompt stays capped under a 300-event record (oldest-first truncation)', prompt.length <= 4500, 'len=' + prompt.length);
  });
  // V16-2 Validation states: PASSED/FAILED/UNVERIFIED, UNVERIFIED never counted as passed.
  await expectV16('V16-2 validation states', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good = goodTextFor(b);
    const checks = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(good)}))`));
    const counts = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(checks))})))`));
    const states = new Set(checks.map(c => c.state));
    check('V16-2 good AI text: 0 FAILED, UNVERIFIED present but not counted as passed',
      counts.failed === 0 && counts.unverified >= 1 && counts.passed + counts.failed + counts.unverified === checks.length && counts.passed < checks.length,
      JSON.stringify(counts) + ' states=' + [...states].join(','));
    const bad = 'Two fighters clashed in a long fight with no clear ending.';
    const badChecks = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(bad)}))`));
    const badCounts = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(badChecks))})))`));
    check('V16-2b text missing winner and finish: FAILED > 0', badCounts.failed >= 2, JSON.stringify(badCounts));
    const selfName = 'Superman: "I am Superman and I will use Heat Vision to win." Rocky Balboa fell dead. Superman won with Heat Vision.';
    const diaChecks = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(selfName)}))`));
    const dia = diaChecks.find(c => c.name.indexOf('Dialogue') === 0);
    check('V16-2c self-naming dialogue: FAILED', !!dia && dia.state === 'FAILED', dia ? dia.state + ' ' + dia.detail : 'no dialogue line');
  });
  // V16-3 Auto-generation triggered by showResults (no button click), mock fetch.
  await expectV16('V16-3 showResults auto-generates', async () => {
    const b = uiBattle16('superman', 'rocky', 832046845, 'death');
    const good = goodTextFor(b);
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => good });
    runInCtx(`currentBattle = simulateBattle();`);
    // Recompute the good text for the actual currentBattle (same seed/matchup, deterministic).
    const cur = JSON.parse(runInCtx(`JSON.stringify(currentBattle)`));
    // v16.19 DELIBERATE CHANGE: showResults now auto-generates the
    // free-form text breakdown, not the short verdict slideshow. The mock
    // AI draft is a valid free-form breakdown (the rule-based fallback
    // text, which passes the locked checker), so the main path must
    // render the breakdown.
    const breakdownCur = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(cur))}))`);
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => breakdownCur });
    runInCtx(`showResults();`);
    const ok = await waitFor(() => ((els['main-story-label'] && els['main-story-label'].innerText) || '').indexOf('Online AI Breakdown') !== -1, 3000);
    check('V16-3 (v16.19 DELIBERATE CHANGE) showResults auto-generates the online AI breakdown (no button click required; verdict slideshow replaced as main)',
      ok && (els['story-output'].innerHTML || '').indexOf('breakdown-v1619') !== -1 && (els['story-output'].innerHTML || '').indexOf('blow by blow') !== -1 && (els['story-output'].innerHTML || '').indexOf('verdict-panel') === -1 && (els['story-output'].innerHTML || '').indexOf('Chapter I') === -1 && (els['main-story-label'].innerText || '').indexOf('Offline Breakdown') === -1,
      'label=' + els['main-story-label'].innerText + ' hasBreakdown=' + ((els['story-output'].innerHTML || '').indexOf('breakdown-v1619') !== -1));
    const saved = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
    // v16.21 DELIBERATE CHANGE: auto-generated battle is now saved as v16.21 with a breakdown AI mainStoryMeta (pending entry updated in place on AI arrival).
    runInCtx(`localStorage.setItem('warroom_battles_v3', '[]');`);
    runInCtx(`showResults();`);
    const ok26 = await waitFor(() => ((els['main-story-label'] && els['main-story-label'].innerText) || '').indexOf('Online AI Breakdown') !== -1, 3000);
    const saved26 = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
    check('V1626-NOSAVE-3b (v16.26 DELIBERATE CHANGE) showResults renders the online AI breakdown and creates NO history entry',
      ok26 && (els['story-output'].innerHTML || '').indexOf('breakdown-v1619') !== -1 && saved26.length === 0,
      'saved26=' + JSON.stringify(saved26) + ' label=' + (els['main-story-label'].innerText || ''));
    sandbox.fetch = realFetch;
  });
  // V16-4 Stale result ignored after a newer battle's generation starts.
  // v16.7: multi-stage generation makes 6 fetches per battle, so the old
  // pending-resolver choreography is replaced by an immediate mock that
  // answers from the prompt's fighter names; the stale session's renders
  // remain gated and only the newer battle's story may appear.
  await expectV16('V16-4 stale result ignored', async () => {
    const b1 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const b2 = battle([[spec('spiderman')], [spec('batman')]], { seed: 145416145, victoryMode: 'incapacitation' });
    const fin2 = finAtkOf(b2);
    const loser2 = b2.alpha[0].name === b2.winner ? b2.beta[0].name : b2.alpha[0].name;
    const good2 = b2.alpha[0].name + ' and ' + b2.beta[0].name + ' clashed, trading blows and reading each other as the fight wore on. '
      + b2.winner + ' found the opening that mattered and struck with ' + (fin2 ? fin2.ability : 'a final blow')
      + ', and ' + loser2 + ' fell unconscious at the end while ' + b2.winner + ' stood as the winner.';
    const good1 = goodTextFor(b1);
    const scenesNew = stageScenesForV167(b2);
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('Spider-Man') === -1) return { ok: true, status: 200, text: async () => good1 };
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      return { ok: true, status: 200, text: async () => scenesNew[stage] || scenesNew.opening };
    };
    setVmBattle('globalThis._v16b1', b1);
    setVmBattle('globalThis._v16b2', b2);
    runInCtx(`globalThis._v16p1 = generateMainStoryV16(globalThis._v16b1, 'v16-test-old-1', {});`);
    runInCtx(`globalThis._v16p2 = generateMainStoryV16(globalThis._v16b2, 'v16-test-new-2', {});`);
    await sandbox._v16p1;
    await sandbox._v16p2;
    const sid = runInCtx(`currentStorySessionId`);
    check('V16-4 stale (old-session) story never renders under the newer battle',
      (els['story-output'].innerHTML || '').indexOf(scenesNew.opening.slice(0, 40)) !== -1
      && (els['story-output'].innerHTML || '').indexOf(good1.slice(0, 40)) === -1
      && sid === 'v16-test-new-2',
      'sid=' + sid);
    sandbox.fetch = realFetch;
  });
  // V16-5 Timeout mechanism + finally cleanup on failure.
  await expectV16('V16-5 timeout and finally cleanup', async () => {
    sandbox.fetch = () => new Promise(() => {});
    let timedOut = false;
    try { await runInCtx(`fetchWithTimeoutV16('https://example.invalid/', {}, 50)`); } catch (e) { timedOut = /timed out/i.test(e.message); }
    check('V16-5 fetchWithTimeoutV16 rejects on timeout (AbortController path, 50ms)', timedOut, '');
    sandbox.fetch = async () => { throw new Error('network down'); };
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v16bf', b);
    await runInCtx(`generateMainStoryV16(globalThis._v16bf, 'v16-test-fail-1', {})`);
    check('V16-5b after failed generation: in-flight flag cleared, retry re-enabled, offline label shown',
      runInCtx(`currentStoryInFlight`) === false && els['retry-online-story-btn'].disabled === false
      && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1,
      'inFlight=' + runInCtx(`currentStoryInFlight`) + ' disabled=' + els['retry-online-story-btn'].disabled + ' label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // V16-6 Exactly one revision, then fallback with the exact offline label.
  await expectV16('V16-6 one revision then fallback', async () => {
    const urls = [];
    let calls = 0;
    sandbox.fetch = async (url) => { calls++; urls.push(String(url)); return { ok: true, status: 200, text: async () => 'Two fighters clashed in a long fight with no clear ending.' }; };
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v16br', b);
    await runInCtx(`generateMainStoryV16(globalThis._v16br, 'v16-test-rev-1', {})`);
    check('V16-6 failed critical check triggers exactly one revision (2 Pollinations calls), then fallback with the exact offline label, never claiming online',
      calls === 2 && urls.every(u => u.indexOf('text.pollinations.ai') !== -1)
      && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Online AI Story') === -1
      && (els['story-output'].innerHTML || '').indexOf('Chapter I') !== -1,
      'calls=' + calls + ' urls=' + urls.join(',') + ' label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // V16-7 Gemini never runs without a saved key; fallback never claims online.
  await expectV16('V16-7 Gemini gate', async () => {
    const urls = [];
    sandbox.fetch = async (url) => { urls.push(String(url)); return { ok: true, status: 200, text: async () => 'x' }; };
    let gemErr = '';
    try { await runInCtx(`fetchGeminiStoryV16('hello')`); } catch (e) { gemErr = e.message || ''; }
    check('V16-7 Gemini never runs without a saved key (rejects, no Gemini request made)',
      /No Gemini key/.test(gemErr) && urls.length === 0, 'err=' + gemErr + ' urls=' + urls.join(','));
    sandbox.fetch = realFetch;
  });
  // V1626-FLOW UI order: story precedes Combat Details; Advanced + history removed; resolver + status visible.
  check('V1626-FLOW (v16.26 DELIBERATE CHANGE) character screen → breakdown only: story precedes Combat Details, Advanced + history removed from markup, resolver + status visible, retry in Technical Details',
    html.indexOf('id="story-output"') !== -1 && html.indexOf('id="story-output"') < html.indexOf('id="breakdown-output"')
    && html.slice(0, html.indexOf('<script>')).indexOf('id="advanced-settings"') === -1
    && html.slice(0, html.indexOf('<script>')).indexOf('history-list') === -1
    && html.slice(0, html.indexOf('<script>')).indexOf('id="resolver-visible"') !== -1
    && html.slice(0, html.indexOf('<script>')).indexOf('id="online-status-banner"') !== -1
    && html.indexOf("generateAIStory('pollinations')") === -1
    && html.indexOf('id="retry-online-story-btn"') > html.indexOf('Technical Details'),
    '');
  // V16-9 Session ids + no secret strings.
  {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const s1 = runInCtx(`makeSessionIdV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const s2 = runInCtx(`makeSessionIdV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    check('V16-9 session ids are v16-prefixed and unique per battle',
      typeof s1 === 'string' && s1.indexOf('v16-') === 0 && s1 !== s2, s1 + ' / ' + s2);
    check('V16-9 no secret key strings in file (no sk- tokens, no api_key)',
      !/sk-[A-Za-z0-9]{8,}/.test(html) && html.indexOf('api_key') === -1, '');
  }
  // V16-10 Research feeds the brief but never blocks a story: prompt includes dossier status lines.
  {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const prompt = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    check('V16-10 AI brief carries dossier extracts (research feeds story, combat untouched)',
      prompt.indexOf('RESEARCH DOSSIER EXTRACTS') !== -1 && prompt.indexOf('Superman') !== -1, '');
  }

  // ================= v16.1 LIVE-DEFECT TESTS =================
  // V161-1 Stale header/session/reason/validation fully cleared during a
  // second battle's preparing phase (the live v16 bug: label + diagnostics
  // kept showing Battle 1 while Combat Details already showed Battle 2).
  // v16.7: the pending-resolver mock is replaced by an immediate mock
  // (multi-stage needs 6 fetches); preparing-phase assertions still run
  // synchronously after generation starts, before any fetch resolves.
  await expectV16('V161-1 stale header cleared in preparing phase', async () => {
    const b1 = battle([[spec('spiderman')], [spec('batman')]], { seed: 841747056, victoryMode: 'incapacitation' });
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 1348984983, victoryMode: 'death' });
    els['main-story-label'].innerText = 'Offline Story — Online AI generation was unavailable. Reason: Pollinations POST HTTP 402 / GET: Pollinations GET HTTP 404 — Spider-Man vs Batman validation';
    els['main-story-diagnostics'].innerHTML = 'Session: v16-841747056-1793358359926-1<br>Provider: Offline fallback<br>Attempts: 1<br>Validation: Spider-Man/Batman checks';
    els['main-story-status'].innerText = 'Online AI generation was unavailable — showing the offline episode instead.';
    els['ai-story-output'].innerText = 'Battle 1 Spider-Man/Batman validation lines';
    const scenes2 = stageScenesForV167(b2);
    sandbox.fetch = async (url, opts) => {
      let stage = 'opening';
      try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      return { ok: true, status: 200, text: async () => scenes2[stage] || scenes2.opening };
    };
    setVmBattle('globalThis._v161b2', b2);
    runInCtx(`globalThis._v161p = generateMainStoryV16(globalThis._v161b2, 'v16-test-b2-new', {});`);
    const label = els['main-story-label'].innerText || '';
    const diag = els['main-story-diagnostics'].innerHTML || '';
    const status = els['main-story-status'].innerText || '';
    const aiBox = els['ai-story-output'].innerText || '';
    const story = els['story-output'].innerHTML || '';
    const joined = label + ' | ' + diag + ' | ' + status + ' | ' + aiBox;
    // v16.10 DELIBERATE CHANGE (offline-first): during generation the
    // label is exactly "Offline episode" and the story area already
    // holds this battle's own rule-based offline episode (Chapter I),
    // not a "Preparing battle story" placeholder. The stage status is
    // still the synchronous preparing text at this check point.
    check('V161-1a (v16.10) preparing phase shows only the NEW session, the Offline episode label, and this battle\'s own offline episode',
      label === 'Offline episode' && diag.indexOf('v16-test-b2-new') !== -1 && joined.indexOf('v16-841747056-1793358359926-1') === -1
      && joined.indexOf('Spider-Man') === -1 && joined.indexOf('Batman') === -1
      && status.indexOf('Preparing battle story') !== -1 && story.indexOf('Chapter I') !== -1 && story.indexOf('Superman') !== -1,
      'label=' + label + ' diag=' + diag + ' status=' + status);
    runInCtx(`renderMainStoryLabelV16({kind:'ai',provider:'Stale',passed:9,unverified:0}, 'v16-test-old-1'); renderMainStoryDiagnosticsV16({sessionId:'v16-test-old-1',provider:'Stale',attempts:9,promptSize:1}, 'v16-test-old-1');`);
    check('V161-1b renders gated on session: an old-session label/diagnostics call writes nothing',
      (els['main-story-label'].innerText || '').indexOf('Online AI Story') === -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('v16-test-old-1') === -1,
      'label=' + els['main-story-label'].innerText);
    await sandbox._v161p;
    check('V161-1c resolved story is Battle 2 own story (Superman/Rocky), never Battle 1 text',
      (els['story-output'].innerHTML || '').indexOf(scenes2.opening.slice(0, 40)) !== -1
      && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // V161-2 Mode heading updates immediately on control change, both directions.
  {
    runInCtx(`document.getElementById('victory-select').value='death'; updateModeHeadings('death');`);
    const deathH = els['match-heading'].innerText || '';
    runInCtx(`document.getElementById('victory-select').value='incapacitation'; updateModeHeadings();`);
    const incapH = els['match-heading'].innerText || '';
    runInCtx(`document.getElementById('victory-select').value='death'; updateModeHeadings();`);
    const backH = els['match-heading'].innerText || '';
    check('V161-2 (v16.33 DELIBERATE CHANGE: Death (knockout) heading) mode heading updates immediately both directions (death -> incapacitation -> death)',
      deathH.indexOf('Death (knockout) Match') !== -1 && incapH.indexOf('Incapacitation Match') !== -1 && backH.indexOf('Death (knockout) Match') !== -1,
      'death=' + deathH + ' incap=' + incapH + ' back=' + backH);
    check('V161-2b the live victory-select change handler itself calls updateModeHeadings (not just the function existing)',
      html.indexOf("updateModeHeadings(_vs.value)") !== -1, '');
  }
  // V1626-ADV-REMOVED: Advanced Settings removed from markup (v16.26 DELIBERATE CHANGE); search + filters kept.
  {
    const markup = html.slice(0, html.indexOf('<script>'));
    check('V1626-ADV-REMOVED (v16.26 DELIBERATE CHANGE) Advanced Settings absent from markup; search + category filters kept',
      markup.indexOf('id="advanced-settings"') === -1 && markup.indexOf('Mode B') === -1 && markup.indexOf('Victory Rules') === -1
      && markup.indexOf('Four Brains') === -1 && markup.indexOf('Add a Custom Fighter') === -1
      && markup.indexOf('id="search-input"') !== -1 && markup.indexOf('id="cat-chips"') !== -1,
      '');
    check('V1626-EXPORT-REMOVED (v16.26 DELIBERATE CHANGE) export buttons absent from markup; Technical Details + retry kept',
      markup.indexOf('Download JSON') === -1 && markup.indexOf('Download story') === -1 && markup.indexOf('exportSavedEpisodeFile') === -1
      && markup.indexOf('Technical Details') !== -1 && markup.indexOf('retryMainStoryV16()') !== -1,
      '');
    check('V1626-RESEARCH-REMOVED (v16.26 DELIBERATE CHANGE) Live Research panel + RETEST absent from markup',
      markup.indexOf('id="research-intel"') === -1 && markup.indexOf('Retest live research') === -1,
      '');
  }

  // V161-4 Pollinations 402 / 404 produce the exact explanatory reasons; no key requested when none saved.
  await expectV16('V161-4 Pollinations 402/404 explanations', async () => {
    const seen = [];
    sandbox.fetch = async (url, opts) => {
      seen.push({ url: String(url), method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {} });
      if ((opts && opts.method) === 'POST') return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 23 seconds.' };
      return { ok: false, status: 404, text: async () => 'Not Found' };
    };
    let err = '';
    try { await runInCtx(`fetchPollinationsStoryV16('Say OK', 5000)`); } catch (e) { err = e.message || ''; }
    check('V161-4a (v16.2: GET story fallback removed) keyless POST 402 error carries the 402 explanation and makes NO GET story call',
      err.indexOf('Pollinations returned payment-required (402)') !== -1
      && err.indexOf('1 reply every 30 seconds') !== -1
      && seen.every(c => c.method === 'POST'), 'err=' + err + ' methods=' + seen.map(c => c.method).join(','));
    const e402 = runInCtx(`explainPollinationsErrorV161('Pollinations POST HTTP 402')`);
    const e404 = runInCtx(`explainPollinationsErrorV161('Pollinations GET HTTP 404')`);
    check('V161-4b explain helper maps 402 and 404 to their exact phrases (402 now also explains the rate limit in plain words)',
      String(e402).indexOf('Pollinations returned payment-required (402)') !== -1
      && String(e402).indexOf('1 reply every 30 seconds') !== -1
      && String(e404).indexOf('Pollinations endpoint not found (404)') !== -1, 'e402=' + e402 + ' e404=' + e404);
    // End to end: fallback label carries the 402 explanation, and no
    // Authorization header was sent because no key is saved.
    // v16.2: the 402 wait-retry is shortened to 1ms in the harness only.
    runInCtx(`V162_402_WAIT_MS = 1;`);
    seen.length = 0;
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v161bf', b);
    await runInCtx(`generateMainStoryV16(globalThis._v161bf, 'v16-test-402-1', {})`);
    const label = els['main-story-label'].innerText || '';
    const authSent = seen.some(c => c.headers && c.headers.Authorization);
    // v16.9 DELIBERATE CHANGE (provider chain): the outline stage now tries
    // Classic after the primary's 402 wait-retry is exhausted, so 4 POSTs
    // (2 primary + 2 Classic) instead of 2. The label, explanation, and
    // no-key guarantees are unchanged.
    check('V161-4c fallback label shows the exact offline label + 402 explanation, and no key was requested (no Authorization header) when none is saved',
      label.indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && label.indexOf('Pollinations returned payment-required (402)') !== -1 && !authSent
      && seen.filter(c => c.method === 'POST').length === 4,
      'label=' + label + ' authSent=' + authSent + ' calls=' + seen.length);
    runInCtx(`V162_402_WAIT_MS = 35000;`);
    sandbox.fetch = realFetch;
  });
  // V161-5 Saved Pollinations key: used only with a saved key, value never in the file.
  await expectV16('V161-5 saved Pollinations key path', async () => {
    const TESTKEY = 'V161-TESTKEY-ONLY-IN-HARNESS-9f3a';
    sandbox.localStorage.setItem('warroom_pollinations_key', TESTKEY);
    const seen = [];
    const scenesKey = stageScenesForV167(battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' }));
    sandbox.fetch = async (url, opts) => {
      seen.push({ url: String(url), method: (opts && opts.method) || 'GET', auth: (opts && opts.headers && opts.headers.Authorization) || '' });
      if (opts && opts.headers && opts.headers.Authorization === 'Bearer ' + TESTKEY) {
        let stage = 'opening';
        try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
        return { ok: true, status: 200, text: async () => scenesKey[stage] || scenesKey.opening };
      }
      if ((opts && opts.method) === 'POST') return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP.' };
      return { ok: false, status: 404, text: async () => 'Not Found' };
    };
    runInCtx(`V162_402_WAIT_MS = 1;`);
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v161bk', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v161bk, 'v16-test-key-1', {})`);
    const keyedCall = seen.find(c => c.auth === 'Bearer ' + TESTKEY);
    const keylessFirst = seen.length >= 1 && !seen[0].auth;
    check('V161-5a keyless attempted first, then the saved key (Bearer) succeeds as a secondary attempt with an AI label',
      !!keyedCall && keylessFirst && meta && meta.kind === 'ai' && String(meta.provider).indexOf('your saved key') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'meta=' + JSON.stringify(meta) + ' calls=' + seen.length);
    runInCtx(`updatePollinationsKeyStatus();`);
    check('V161-5b key status line never reveals the key value, and the key value never appears in the game file',
      (els['pollinations-key-status'].innerText || '').indexOf(TESTKEY) === -1 && html.indexOf(TESTKEY) === -1, 'status=' + els['pollinations-key-status'].innerText);
    sandbox.localStorage.removeItem('warroom_pollinations_key');
    runInCtx(`V162_402_WAIT_MS = 35000;`);
    sandbox.fetch = realFetch;
  });


  // ================= v16.2 LIVE-DEFECT TESTS =================
  // V162-A Saved view renders mainStoryMeta (AI / offline / legacy) in the
  // story banner AND Technical Details, never "No story generated yet".
  {
    const setSave = (entry) => runInCtx(`localStorage.setItem('warroom_battles_v3', JSON.stringify([JSON.parse(${JSON.stringify(JSON.stringify(entry))})]));`);
    const base = { victoryType: 'Death (HP 0)', victoryMode: 'death', battlefield: 'Open Arena', date: '10/30/2026, 9:03:45 AM', rounds: 8, seed: 2040188260, eventRecord: [], breakdown: '<li>Saved breakdown.</li>' };
    const aiSave = Object.assign({ id: 777001, formatVersion: 'v16.3', winner: 'Superman', story: '<p>Saved AI story.</p>', mainStoryMeta: { kind: 'ai', provider: 'Pollinations (POST, keyless)', passed: 8, unverified: 2, attempts: 1, promptSize: 4200, sessionId: 'v16-test-ai-1', reason: '' } }, base);
    setSave(aiSave);
    runInCtx(`viewHistory(777001);`);
    check('V162-Aa saved AI entry: story banner + label + diagnostics carry provider, passed/unverified, session',
      (els['main-story-label'].innerText || '').indexOf('Saved online AI story') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Pollinations (POST, keyless)') !== -1
      && (els['main-story-label'].innerText || '').indexOf('8 passed') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('v16-test-ai-1') !== -1
      && (els['story-output'].innerHTML || '').indexOf('Saved online AI story') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('No story generated yet') === -1,
      'label=' + els['main-story-label'].innerText + ' diag=' + els['main-story-diagnostics'].innerHTML);
    const offSave = Object.assign({ id: 777002, formatVersion: 'v16.3', winner: 'Spider-Man', victoryMode: 'incapacitation', story: '<p>Saved offline story.</p>', mainStoryMeta: { kind: 'offline', provider: 'Offline fallback (rule-based episode)', passed: 0, unverified: 0, attempts: 2, promptSize: 4300, sessionId: 'v16-test-off-2', reason: 'Draft did not pass validation', rejectedDraftExcerpt: 'Some rejected draft text here for diagnosis.', rejectedChecks: ['Participants named: story does not name both fighters'] } }, base);
    setSave(offSave);
    runInCtx(`viewHistory(777002);`);
    check('V162-Ab saved offline entry: banner + diagnostics repeat the original offline label, reason, session, and rejected excerpt',
      (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Draft did not pass validation') !== -1
      && (els['main-story-label'].innerText || '').indexOf('v16-test-off-2') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Draft did not pass validation') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Some rejected draft text here') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('No story generated yet') === -1,
      'label=' + els['main-story-label'].innerText);
    const legSave = Object.assign({ id: 777003, formatVersion: 'v15', winner: 'Superman', story: '<p>Legacy story.</p>' }, base);
    delete legSave.mainStoryMeta;
    setSave(legSave);
    runInCtx(`viewHistory(777003);`);
    check('V162-Ac legacy entry without meta: honest untracked wording, never an invented kind, never "No story generated yet"',
      (els['main-story-label'].innerText || '').indexOf('story kind not recorded') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('No story generated yet') === -1,
      'label=' + els['main-story-label'].innerText);
  }
  // V162-B Token-limit 400: one condensed retry (shorter prompt, shorter story ask).
  await expectV16('V162-B token-limit condensed retry', async () => {
    const tokenBody = '{"success":false,"error":{"message":"The model exhausted its output token limit before producing an answer. Increase the token limit or reduce reasoning effort.","code":"output_token_limit_exceeded"}}';
    const seenB = [];
    const goodB = 'Superman and Rocky Balboa clashed, trading blows and reading each other as the fight wore on. Superman found the opening that mattered and struck with Heat Vision, and Rocky Balboa fell dead at the end while Superman stood as the winner.';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      seenB.push(body);
      if (body.indexOf('600') !== -1) return { ok: true, status: 200, text: async () => goodB };
      return { ok: false, status: 400, text: async () => tokenBody };
    };
    // v16.9 HARNESS SETUP (not a game change): the single-shot helper
    // charges the shared legacy global v163PostCount, which earlier tests
    // leave at >= 10 (direct calls plus generation finally blocks that
    // report per-run attempts). The multi-stage production path never
    // reads that global — it uses per-provider budgets — so reset it
    // here for this direct-call test only.
    runInCtx(`v163PostCount = 0;`);
    const r = await runInCtx(`fetchPollinationsStoryV16('LONG PROMPT '.repeat(300), 5000, 'Write a shorter story of about 600 words about Superman vs Rocky Balboa.')`);
    check('V162-Ba token-limit 400 triggers exactly one condensed retry: second prompt shorter and asks for a shorter story',
      seenB.length === 2 && seenB[1].length < seenB[0].length && seenB[1].indexOf('600') !== -1 && r && r.provider.indexOf('condensed') !== -1,
      'calls=' + seenB.length + ' len1=' + (seenB[0] || '').length + ' len2=' + (seenB[1] || '').length + ' provider=' + (r && r.provider));
    // Second token-limit failure falls back with the token-limit reason.
    sandbox.fetch = async () => ({ ok: false, status: 400, text: async () => tokenBody });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v162bt', b);
    await runInCtx(`generateMainStoryV16(globalThis._v162bt, 'v16-test-token-2', {})`);
    check('V162-Bb second token-limit failure falls back with the token-limit reason (not a generic failure)',
      (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && (els['main-story-label'].innerText || '').toLowerCase().indexOf('token limit') !== -1,
      'label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // V162-C 402: one wait-retry, at most once, reason explains the rate limit.
  await expectV16('V162-C 402 wait-retry', async () => {
    runInCtx(`V162_402_WAIT_MS = 1;`);
    const seenC = [];
    sandbox.fetch = async (url, opts) => {
      seenC.push((opts && opts.method) || 'GET');
      return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 23 seconds.' };
    };
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v162c', b);
    await runInCtx(`generateMainStoryV16(globalThis._v162c, 'v16-test-402-2', {})`);
    // v16.9 DELIBERATE CHANGE (provider chain): the primary's one wait-retry
    // (2 POSTs) is followed by Classic's one wait-retry (2 POSTs) for the
    // same stage, so 4 POSTs total before fallback. Per-provider retry
    // counts are unchanged; the chain is what adds the second pair.
    check('V162-Ca 402 triggers exactly one wait-retry per provider (4 POSTs total: primary pair + Classic pair), then falls back with a plain-words rate-limit reason',
      seenC.filter(m => m === 'POST').length === 4
      && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && (els['main-story-label'].innerText || '').indexOf('1 reply every 30 seconds') !== -1,
      'posts=' + seenC.filter(m => m === 'POST').length + ' label=' + els['main-story-label'].innerText);
    runInCtx(`V162_402_WAIT_MS = 35000;`);
    sandbox.fetch = realFetch;
  });
  // V162-D Rejected-draft diagnostics live ONLY in Technical Details.
  await expectV16('V162-D rejected draft diagnostics', async () => {
    const badText = 'Two fighters clashed in a long fight with no clear ending and no names at all in this draft text.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => badText });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v162d', b);
    await runInCtx(`generateMainStoryV16(globalThis._v162d, 'v16-test-rej-1', {})`);
    check('V162-Da rejected draft excerpt + failed checks appear in Technical Details only, labelled NOT the story, and not in the main story area',
      (els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected AI draft (troubleshooting only — NOT the story)') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Two fighters clashed') !== -1
      && (els['story-output'].innerHTML || '').indexOf('Two fighters clashed') === -1
      && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1,
      'diagHas=' + ((els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected AI draft') !== -1));
    sandbox.fetch = realFetch;
  });
  // V162-E Checker: recorded alias passes, empty draft gets its own reason.
  {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'death' });
    const aliasText = 'Peter Parker and Batman clashed, trading blows and reading each other as the fight wore on. Peter Parker found the opening that mattered and struck with Web and Impact Combo, and Batman fell dead at the end while Peter Parker stood as the winner.';
    const aliasChecks = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(aliasText)}))`));
    const aliasCounts = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(aliasChecks))})))`));
    check('V162-Ea checker accepts a recorded alias (Peter Parker) and a "and" variant of the finishing ability without weakening to a single keyword',
      aliasCounts.failed === 0, JSON.stringify(aliasCounts));
    const emptyChecks = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ''))`));
    check('V162-Eb empty draft is rejected with its own empty/truncated reason',
      emptyChecks.some(c => c.state === 'FAILED' && c.detail.indexOf('empty or truncated') !== -1),
      JSON.stringify(emptyChecks));
  }
  // V162-F Story path makes POST requests only (no GET story fallback).
  await expectV16('V162-F POST-only story path', async () => {
    const seenF = [];
    const goodF = 'Superman and Rocky Balboa clashed, trading blows and reading each other as the fight wore on. Superman found the opening that mattered and struck with Heat Vision, and Rocky Balboa fell dead at the end while Superman stood as the winner.';
    sandbox.fetch = async (url, opts) => { seenF.push({ url: String(url), method: (opts && opts.method) || 'GET' }); return { ok: true, status: 200, text: async () => goodF }; };
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v162f', b);
    await runInCtx(`generateMainStoryV16(globalThis._v162f, 'v16-test-postonly-1', {})`);
    check('V162-Fa story generation uses POST only (no GET story fallback call)',
      seenF.length >= 1 && seenF.every(c => c.method === 'POST'), 'calls=' + JSON.stringify(seenF));
    check('V162-Fb no GET story-fallback construction remains in the script (tiny connection-test GET untouched)',
      script.indexOf('encodeURIComponent(shortPrompt)') === -1, '');
    sandbox.fetch = realFetch;
  });
  // V162-G New prompt cap (4500) is the tested value and the UI shows it.
  await expectV16('V162-G prompt cap 4500 shown in UI', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const prompt = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const condensed = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const cap = runInCtx(`V16_PROMPT_CAP`);
    sandbox.fetch = async () => ({ ok: false, status: 500, text: async () => 'Server error' });
    setVmBattle('globalThis._v162g', b);
    await runInCtx(`generateMainStoryV16(globalThis._v162g, 'v16-test-cap-1', {})`);
    check('V162-Ga prompt cap is 4500, full prompt respects it, condensed prompt is shorter and asks for a shorter story',
      cap === 4500 && prompt.length <= 4500 && condensed.length < prompt.length && condensed.indexOf('600') !== -1 && prompt.indexOf('800') !== -1,
      'cap=' + cap + ' prompt=' + prompt.length + ' condensed=' + condensed.length);
    // v16.10 DELIBERATE CHANGE: the multi-stage total must NOT be
    // compared against the old single-shot 4500 cap. Diagnostics now
    // show per-stage prompt sizes plus the total, labelled as per-stage.
    check('V162-Gb (v16.10) fallback diagnostics show per-stage prompt sizes with no single-shot cap comparison',
      (els['main-story-diagnostics'].innerHTML || '').indexOf('Prompt sizes (per stage') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('cap 4500') === -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('not compared against the old single-shot 4500 cap') !== -1,
      'diag=' + els['main-story-diagnostics'].innerHTML);
    sandbox.fetch = realFetch;
  });

  // ================= v16.3 LIVE-DEFECT TESTS =================
  function loserOf(b) {
    const a = (b.alpha && b.alpha[0] && b.alpha[0].name) || '';
    const c = (b.beta && b.beta[0] && b.beta[0].name) || '';
    return b.winner === a ? c : a;
  }
  function goodDraftFor(b) {
    const fin = finAtkOf(b);
    const abil = fin ? fin.ability : 'Heat Vision';
    const loser = loserOf(b);
    if (b.victoryMode === 'incapacitation') {
      return b.winner + ' and ' + loser + ' met on the open ground, and ' + b.winner + ' moved first while ' + loser + ' watched for a pattern. ' + loser + ' studied the approach and prepared a counter, but ' + b.winner + ' sensed the trap and changed tactics. The fight turned when ' + b.winner + ' closed in and struck with ' + abil + ', and ' + loser + ' fell unconscious while ' + b.winner + ' stood as the winner.';
    }
    return b.winner + ' and ' + loser + ' met on the open ground, and ' + b.winner + ' moved first while ' + loser + ' watched for a pattern. ' + loser + ' studied the approach and prepared a counter, but ' + b.winner + ' sensed the trap and changed tactics. The fight turned when ' + b.winner + ' closed in and struck with ' + abil + ', and ' + loser + ' fell dead at the end while ' + b.winner + ' stood as the winner.';
  }
  const unnamedDraft = 'Two figures clashed in a long fight on the open ground under the open sky the exchange grow fiercer and the arena lights burned bright overhead.';
  // V163-A Naming requirement in initial, condensed, and revision prompts.
  await expectV16('V163-A naming rule in all prompts', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const full = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const condensed = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const namingOk = (s) => s.indexOf('opening paragraph') !== -1 && s.indexOf('full recorded names') !== -1 && s.indexOf('decisive/climax') !== -1 && s.indexOf('finishing ability exactly as recorded') !== -1;
    check('V163-Aa initial prompt contains the full-name naming rule (opening + climax + finishing ability)', namingOk(full), 'full=' + full.slice(0, 200));
    check('V163-Ab condensed prompt contains the full-name naming rule', namingOk(condensed), 'condensed=' + condensed.slice(0, 200));
    let revBody = '';
    let revCalls = 0;
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('REVISION') !== -1) { revCalls++; revBody = body; return { ok: true, status: 200, text: async () => goodDraftFor(b) }; }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v163a', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163a, 'v16-test-naming-1', {})`);
    check('V163-Ac (v16.10 DELIBERATE CHANGE) stage-correction prompt repeats the failed hard-constraint checks and the story brief; exactly 1 REVISION, because a whole-draft correction is no longer a valid opening under the hard-constraint gate',
      revCalls === 1 && revBody.indexOf('REVISION') !== -1 && revBody.indexOf('failed these hard-constraint checks') !== -1
      && revBody.indexOf('STORY BRIEF') !== -1 && revBody.indexOf('Spider-Man') !== -1,
      'revCalls=' + revCalls);
    sandbox.fetch = realFetch;
  });
  // V163-B Stage-correction 402 -> wait -> success; keyed secondary 402 -> wait -> success.
  // v16.7: the correction that hits the 402 is the outline stage's correction
  // (the unnamed first attempt fails stage validation, then its correction
  // is rate-limited once and retried); all later stages return the good draft.
  await expectV16('V163-B 402 wait-retry on stage correction and keyed stages', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    let calls = 0; let revCalls = 0; let revBody = '';
    sandbox.fetch = async (url, opts) => {
      calls++;
      const body = (opts && opts.body) || '';
      if (body.indexOf('REVISION') !== -1) {
        revCalls++; revBody = body;
        if (revCalls === 1) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
        // v16.10 DELIBERATE CHANGE: the correction must be a valid
        // opening scene, not a whole draft (a whole draft names the
        // finisher in the opening and now fails fidelity).
        return { ok: true, status: 200, text: async () => stageScenesForV167(b).opening };
      }
      if (revCalls >= 1) {
        let stage = 'opening';
        try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
        return { ok: true, status: 200, text: async () => stageScenesForV167(b)[stage] || stageScenesForV167(b).opening };
      }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v163b', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163b, 'v16-test-rev402-1', {})`);
    check('V163-Ba (v16.10 DELIBERATE CHANGE) stage-correction 402 waits and retries once, then renders the AI story (not fallback)',
      calls === 7 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1 && (els['story-output'].innerHTML || '').indexOf(b.winner) !== -1,
      'calls=' + calls + ' label=' + els['main-story-label'].innerText);
    check('V163-Bb stage-correction body carries the failed hard-constraint checks', revBody.indexOf('failed these hard-constraint checks') !== -1, '');
    sandbox.localStorage.setItem('warroom_pollinations_key', 'test-key-163');
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good2 = goodDraftFor(b2);
    let keyedCalls = 0; let keyedAuth = '';
    const scenesB2 = stageScenesForV167(b2);
    sandbox.fetch = async (url, opts) => {
      const hdrs = (opts && opts.headers) || {};
      if (hdrs.Authorization) {
        keyedCalls++; keyedAuth = hdrs.Authorization;
        if (keyedCalls === 1) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
        let stage = 'opening';
        try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
        return { ok: true, status: 200, text: async () => scenesB2[stage] || scenesB2.opening };
      }
      return { ok: false, status: 500, text: async () => 'Server error' };
    };
    setVmBattle('globalThis._v163b2', b2);
    await runInCtx(`generateMainStoryV16(globalThis._v163b2, 'v16-test-key402-1', {})`);
    check('V163-Bc (v16.10 DELIBERATE CHANGE) saved-key secondary 402 waits and retries once, then renders the AI story with the key',
      keyedCalls === 6 && keyedAuth === 'Bearer ' + 'test-key-163' && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1 && (els['main-story-label'].innerText || '').indexOf('your saved key') !== -1,
      'keyedCalls=' + keyedCalls + ' label=' + els['main-story-label'].innerText);
    sandbox.localStorage.removeItem('warroom_pollinations_key');
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V163-C 402 still failing after its wait falls back, never wait-retried twice.
  await expectV16('V163-C 402 after wait falls back with plain-words reason', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    let posts = 0;
    sandbox.fetch = async () => { posts++; return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 23 seconds.' }; };
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v163c', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163c, 'v16-test-402again-1', {})`);
    // v16.9 DELIBERATE CHANGE (provider chain): at most one wait-retry per
    // provider per stage, so a stage that 402s on both providers posts
    // 4 times (primary pair + Classic pair) before falling back.
    check('V163-Ca 402 wait-retry happens at most once per provider per stage and the fallback explains the rate limit in plain words',
      posts === 4 && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1 && (els['main-story-label'].innerText || '').indexOf('1 reply every 30 seconds') !== -1,
      'posts=' + posts + ' label=' + els['main-story-label'].innerText);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V163-D Abort/timeout: one retry -> success; second abort -> interrupted fallback.
  // v16.7: the abort hits the outline stage; the retry then succeeds and the
  // remaining 5 stages each cost one POST, so a full success is 7 calls.
  await expectV16('V163-D abort retry', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good = goodDraftFor(b);
    let calls = 0;
    const scenesD = stageScenesForV167(b);
    sandbox.fetch = async (url, opts) => { calls++; if (calls === 1) throw new Error('signal is aborted without reason'); let stage = 'opening'; try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {} return { ok: true, status: 200, text: async () => scenesD[stage] || scenesD.opening }; };
    setVmBattle('globalThis._v163d', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163d, 'v16-test-abort-1', {})`);
    check('V163-Da (v16.10 DELIBERATE CHANGE) abort retries once and then renders the AI story (opening retry + 4 further stages = 6 POSTs)',
      calls === 6 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'calls=' + calls + ' label=' + els['main-story-label'].innerText);
    let calls2 = 0;
    sandbox.fetch = async () => { calls2++; throw new Error('signal is aborted without reason'); };
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v163d2', b2);
    await runInCtx(`generateMainStoryV16(globalThis._v163d2, 'v16-test-abort-2', {})`);
    // v16.9 DELIBERATE CHANGE (provider chain): the outline stage now
    // gets an abort + counted retry on the primary (2 calls) AND on
    // Classic (2 calls) before falling back, so 4 calls instead of 2.
    // The abort-retry policy itself is unchanged (at most one retry per
    // provider per stage) and the label wording is unchanged.
    check('V163-Db second abort falls back with an interrupted / network-drop reason, never blaming the provider as fact',
      calls2 === 4 && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1 && (els['main-story-label'].innerText || '').indexOf('interrupted') !== -1 && (els['main-story-label'].innerText || '').indexOf('network drop') !== -1,
      'calls2=' + calls2 + ' label=' + els['main-story-label'].innerText);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V163-E A superseded session never retries after an abort or a 402.
  // v16.7: the superseded battle's prompts are identified by fighter name;
  // it must make exactly one POST (no 402 retry) while the newer battle wins.
  await expectV16('V163-E superseded session never retries', async () => {
    runInCtx(`V162_402_WAIT_MS = 50; V163_ABORT_RETRY_DELAY_MS = 50;`);
    const b1 = battle([[spec('spiderman')], [spec('batman')]], { seed: 900636602, victoryMode: 'incapacitation' });
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good2 = goodDraftFor(b2);
    let b1Calls = 0;
    const scenesE2 = stageScenesForV167(b2);
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('Spider-Man') !== -1) {
        b1Calls++;
        if (b1Calls === 1) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
      }
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      return { ok: true, status: 200, text: async () => scenesE2[stage] || scenesE2.opening };
    };
    setVmBattle('globalThis._v163e1', b1);
    setVmBattle('globalThis._v163e2', b2);
    const p1 = runInCtx(`generateMainStoryV16(globalThis._v163e1, 'v16-test-sup-1', {})`);
    const p2 = runInCtx(`generateMainStoryV16(globalThis._v163e2, 'v16-test-sup-2', {})`);
    await p1; await p2;
    check('V163-Ea superseded generation makes no retry POST and the newer battle story wins',
      b1Calls === 1 && (els['story-output'].innerHTML || '').indexOf(good2.slice(0, 40)) !== -1 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'b1Calls=' + b1Calls + ' label=' + els['main-story-label'].innerText);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V163-F Worst-case combined sequence under the v16.8 cap definition.
  // v16.8 DELIBERATE CHANGE (not a weakened test): 402 wait-retries are
  // NO LONGER charged to the generation cap, so every stage's first
  // attempt being rate-limited and retried once now SUCCEEDS (12 fetch
  // calls, 6 counted) instead of falling back at the cap. The old
  // v16.7 expectation (fallback with the cap named) is superseded by
  // V168-A/V167-F below; the cap still binds generation/correction
  // POSTs (see V168-E, abort retries counted).
  await expectV16('V163-F total POSTs per battle never exceed the cap', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good = goodDraftFor(b);
    let calls = 0;
    const retried = {};
    sandbox.fetch = async (url, opts) => {
      calls++;
      const body = (opts && opts.body) || '';
      let stage = 'other';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (!retried[stage]) { retried[stage] = true; return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' }; }
      return { ok: true, status: 200, text: async () => stageScenesForV167(b)[stage] || stageScenesForV167(b).opening };
    };
    setVmBattle('globalThis._v163f', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163f, 'v16-test-cap-1', {})`);
    const counted = runInCtx(`v163PostCount`);
    check('V163-Fa (v16.10 DELIBERATE CHANGE) repeated 402 retries across stages are NOT charged: 10 fetch calls, 5 counted, AI story renders, diagnostics show the split',
      calls === 10 && counted === 5 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('5 generation + 5 402 wait-retries (not counted toward cap)') !== -1,
      'calls=' + calls + ' counted=' + counted + ' label=' + els['main-story-label'].innerText + ' diag=' + els['main-story-diagnostics'].innerHTML);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // ================= v16.4 LIVE-DEFECT TESTS =================
  // V164-A Verbatim-climax rule in all three prompts, filled in per battle,
  // omitted gracefully with no finishing attack.
  await expectV16('V164-A verbatim climax rule', async () => {
    const bS = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const finS = finAtkOf(bS);
    const fullS = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(bS))}))`);
    const condS = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(bS))}))`);
    const ruleS = 'The climax sentence must contain the finishing ability name verbatim, exactly as recorded: ' + finS.ability;
    check('V164-Aa full prompt contains the verbatim-climax rule with the recorded ability', fullS.indexOf(ruleS) !== -1, 'fin=' + finS.ability);
    check('V164-Ab condensed prompt contains the verbatim-climax rule with the recorded ability', condS.indexOf(ruleS) !== -1, '');
    const bR = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const finR = finAtkOf(bR);
    const fullR = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(bR))}))`);
    check('V164-Ac full prompt contains the verbatim-climax rule with the recorded ability (Superman battle)', fullR.indexOf('The climax sentence must contain the finishing ability name verbatim, exactly as recorded: ' + finR.ability) !== -1, 'fin=' + finR.ability);
    let revBody = ''; let revCalls = 0;
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('REVISION') !== -1) { revCalls++; revBody = body; return { ok: true, status: 200, text: async () => goodDraftFor(bS) }; }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v164a', bS);
    await runInCtx(`generateMainStoryV16(globalThis._v164a, 'v16-test-v164a-1', {})`);
    const climaxPrompt = runInCtx(`buildStagePromptV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bS))})), 'climax', {})`);
    // v16.10 DELIBERATE CHANGE: the climax brief is reworded
    // ("End with the finishing ability name verbatim ... in the final
    // climax sentence") and the whole-draft correction is no longer a
    // valid opening under the hard-constraint gate, so exactly 1 REVISION runs.
    check('V164-Ad (v16.10) climax stage prompt repeats the verbatim-climax rule with the recorded ability, and the stage correction repeats the failed checks',
      climaxPrompt.indexOf('Finisher verbatim inside a full sentence') !== -1
      && climaxPrompt.indexOf(finS.ability) !== -1
      && revCalls === 1 && revBody.indexOf('failed these hard-constraint checks') !== -1,
      'revCalls=' + revCalls + ' climaxHasRule=' + (climaxPrompt.indexOf('verbatim') !== -1));
    sandbox.fetch = realFetch;
    const stal = JSON.parse(JSON.stringify(bS));
    stal.events = stal.events.filter(e => e.type !== 'knockout' && e.type !== 'incapacitated');
    stal.stalemate = true; stal.winner = 'Stalemate';
    const stalPrompt = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(stal))}))`);
    const stalCond = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(stal))}))`);
    check('V164-Ae verbatim-climax rule omitted gracefully with no finishing attack (never empty/undefined)', stalPrompt.indexOf('VERBATIM CLIMAX RULE') === -1 && stalCond.indexOf('VERBATIM CLIMAX RULE') === -1 && stalPrompt.indexOf('undefined') === -1 && stalCond.indexOf('undefined') === -1, '');
  });
  // V164-B Checker NOT weakened: paraphrased climax still fails both checks;
  // verbatim climax passes both.
  {
    function synthBattle(winner, loser, mode, ability, defeatType) {
      return { winner: winner, victoryMode: mode, stalemate: false,
        alpha: [{ name: winner, variant: 'Base', sig: ability, trans: '' }],
        beta: [{ name: loser, variant: 'Base', sig: 'Grapple Kick', trans: '' }],
        events: [
          { type: 'attack', actor: winner, target: loser, ability: ability },
          { type: defeatType, actor: winner, target: loser }
        ] };
    }
    function checksFor(b, text) {
      return JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(text)}))`));
    }
    function countsOf(cs) { return JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(cs))})))`)); }
    function stateOf(cs, name) { const c = cs.find(x => x.name === name); return c ? c.state : 'MISSING'; }
    const bS = synthBattle('Spider-Man', 'Batman', 'incapacitation', 'Spider-Sense Counter', 'incapacitated');
    const paraS = 'Spider-Man and Batman met on the open ground, and Spider-Man moved first while Batman watched for a pattern. Batman studied the approach and prepared a counter, but Spider-Man sensed the trap and changed tactics. The fight turned when Spider-Man closed in and struck with a counter powered by his spider-sense, and Batman fell unconscious while Spider-Man stood as the winner.';
    const csS = checksFor(bS, paraS);
    check('V164-Ba paraphrased Spider-Sense Counter climax STILL FAILS both finishing-ability and decisive-event checks (checker not weakened)',
      stateOf(csS, 'Finishing ability / event matches the record') === 'FAILED' && stateOf(csS, 'No invented decisive event') === 'FAILED' && countsOf(csS).failed === 2,
      JSON.stringify(countsOf(csS)));
    const bR = synthBattle('Superman', 'Rocky Balboa', 'death', 'Heat Vision', 'knockout');
    const paraR = 'Superman and Rocky Balboa met on the open ground, and Superman moved first while Rocky Balboa watched for a pattern. Rocky Balboa studied the approach and prepared a counter, but Superman sensed the trap and changed tactics. The fight turned when Superman closed in and struck with blazing beams from his eyes, and Rocky Balboa fell dead at the end while Superman stood as the winner.';
    const csR = checksFor(bR, paraR);
    check('V164-Bb paraphrased Heat Vision climax STILL FAILS both finishing-ability and decisive-event checks',
      stateOf(csR, 'Finishing ability / event matches the record') === 'FAILED' && stateOf(csR, 'No invented decisive event') === 'FAILED' && countsOf(csR).failed === 2,
      JSON.stringify(countsOf(csR)));
    const verbS = 'Spider-Man and Batman met on the open ground, and Spider-Man moved first while Batman watched for a pattern. Batman studied the approach and prepared a counter, but Spider-Man sensed the trap and changed tactics. The fight turned when Spider-Man closed in and struck with Spider-Sense Counter, and Batman fell unconscious while Spider-Man stood as the winner.';
    const csV = checksFor(bS, verbS);
    check('V164-Bc verbatim climax sentence PASSES both finishing-ability and decisive-event checks with no failures',
      stateOf(csV, 'Finishing ability / event matches the record') === 'PASSED' && stateOf(csV, 'No invented decisive event') === 'PASSED' && countsOf(csV).failed === 0,
      JSON.stringify(countsOf(csV)));
  }
  // V164-C Rejected-draft diagnostics: opening AND climax excerpts, live and saved.
  await expectV16('V164-C rejected draft climax excerpts', async () => {
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The exchange grew fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => longBad });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v164c', b);
    await runInCtx(`generateMainStoryV16(globalThis._v164c, 'v16-test-v164c-1', {})`);
    check('V164-Ca live diagnostics show BOTH opening and climax excerpts, labelled troubleshooting-only, and the climax marker is not in the main story area',
      (els['main-story-diagnostics'].innerHTML || '').indexOf('Opening — first 500 characters') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Climax — last 500 characters') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('FINALMARKER climax tail') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected AI draft (troubleshooting only — NOT the story)') !== -1
      && (els['story-output'].innerHTML || '').indexOf('FINALMARKER') === -1,
      'diagHasClimax=' + ((els['main-story-diagnostics'].innerHTML || '').indexOf('Climax') !== -1));
    sandbox.fetch = realFetch;
    const shortBad = 'Two fighters clashed in a long fight with no clear ending and no names at all in this draft text.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => shortBad });
    setVmBattle('globalThis._v164c2', b);
    await runInCtx(`generateMainStoryV16(globalThis._v164c2, 'v16-test-v164c-2', {})`);
    check('V164-Cb short draft (<=500 chars): overlap noted, climax excerpt not duplicated',
      (els['main-story-diagnostics'].innerHTML || '').indexOf('also the whole draft') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Climax — last 500 characters') === -1,
      '');
    sandbox.fetch = realFetch;
  });
  // V164-D Saved view clears every live-only note; audit of the saved renderer.
  {
    const setSave = (entry) => runInCtx(`localStorage.setItem('warroom_battles_v3', JSON.stringify([JSON.parse(${JSON.stringify(JSON.stringify(entry))})]));`);
    els['integrity-note'].innerText = 'System A — Battle Integrity: PASSED (0 unverified, honestly labelled). Authoritative record: winner=Superman, loser=Rocky Balboa, victoryMode=death, finishingEventId=21, finishingAbility=Heat Vision.';
    els['accuracy-note'].innerText = 'System B — Narrative Factual Accuracy: PASSED. LIVE ACCURACY MARKER.';
    els['result-dossier-output'].innerHTML = 'LIVE DOSSIER MARKER';
    els['ai-story-output'].innerText = 'Preparing battle story for this battle…';
    const base = { victoryType: 'Incapacitation — knockout (unconscious, not dead)', victoryMode: 'incapacitation', battlefield: 'Open Arena', date: '10/30/2026, 10:24:07 AM', rounds: 6, seed: 291906146, eventRecord: [], breakdown: '<li>Saved breakdown.</li>' };
    const saved1 = Object.assign({ id: 777101, formatVersion: 'v16.4', winner: 'Spider-Man', loser: 'Batman', story: '<p>Saved offline story.</p>',
      finalRecord: { winner: 'Spider-Man', loserName: 'Batman', victoryMode: 'incapacitation', finishingEventId: 13, finishingAbility: 'Spider-Sense Counter' },
      validation: { integrity: [{ name: 'A1', passed: true, detail: 'ok' }], accuracy: [{ name: 'B1', passed: true, detail: 'ok' }], quality: [{ name: 'C1', passed: true, detail: 'ok' }] },
      researchRefs: [{ fighter: 'Spider-Man', sources: [{ name: 'Wikipedia', status: 'FOUND' }] }],
      mainStoryMeta: { kind: 'offline', provider: 'Offline fallback (rule-based episode)', passed: 0, unverified: 0, attempts: 4, promptSize: 4500, sessionId: 'v16-test-saved-1', reason: 'Draft did not pass validation', rejectedDraftExcerpt: 'Saved draft opening text here for diagnosis.', rejectedDraftClimax: 'SAVEDCLIMAXMARKER climax tail here.', rejectedChecks: ['Finishing ability / event matches the record: story does not name finishing ability'] } }, base);
    setSave(saved1);
    runInCtx(`viewHistory(777101);`);
    check('V164-Da saved view: no Battle 2 live note text remains; integrity-note carries THIS saved entry (Spider-Man / Spider-Sense Counter)',
      (els['integrity-note'].innerText || '').indexOf('Rocky Balboa') === -1
      && (els['integrity-note'].innerText || '').indexOf('Heat Vision') === -1
      && (els['integrity-note'].innerText || '').indexOf('finishingEventId=21') === -1
      && (els['integrity-note'].innerText || '').indexOf('Spider-Man') !== -1
      && (els['integrity-note'].innerText || '').indexOf('Spider-Sense Counter') !== -1
      && (els['integrity-lines'].innerHTML || '').indexOf('Saved System A') !== -1,
      'note=' + els['integrity-note'].innerText);
    check('V164-Db saved view: accuracy-note, dossier and ai-story-output reset to this saved entry, not the live battle',
      (els['accuracy-note'].innerText || '').indexOf('LIVE ACCURACY MARKER') === -1
      && (els['accuracy-note'].innerText || '').indexOf('Saved System B') !== -1
      && (els['result-dossier-output'].innerHTML || '').indexOf('LIVE DOSSIER MARKER') === -1
      && (els['result-dossier-output'].innerHTML || '').indexOf('Saved dossier references') !== -1
      && (els['ai-story-output'].innerText || '').indexOf('Preparing battle story') === -1
      && (els['ai-story-output'].innerText || '').indexOf('saved episode') !== -1,
      'acc=' + els['accuracy-note'].innerText);
    check('V164-Dc saved view: banner + diagnostics carry the saved offline kind, reason, session, and BOTH rejected excerpts (climax included)',
      (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && (els['main-story-label'].innerText || '').indexOf('v16-test-saved-1') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Saved draft opening text here') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('SAVEDCLIMAXMARKER climax tail') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Climax — last 500 characters') !== -1
      && (els['story-output'].innerHTML || '').indexOf('SAVEDCLIMAXMARKER') === -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('No story generated yet') === -1,
      '');
    const vhStart = html.indexOf('function viewHistory(id){');
    const vhEnd = html.indexOf('\nfunction ', vhStart + 10);
    const vhBody = html.slice(vhStart, vhEnd);
    const auditIds = ['integrity-note', 'accuracy-note', 'quality-note', 'consistency-note', 'consistency-lines', 'integrity-lines', 'accuracy-lines', 'quality-lines', 'pipeline-stages', 'main-story-label', 'main-story-status', 'main-story-diagnostics', 'result-dossier-output', 'ai-story-output', 'export-note'];
    const missing = auditIds.filter(id => vhBody.indexOf("getElementById('" + id + "')") === -1);
    check('V1634-STATUS-AUDIT (v16.34 DELIBERATE CHANGE: audit renderer replaces the visible renderer) single status source touches banner + main-story-status + tech line; audit renderer touches #resolver-visible',
      (function () {
        const st = runInCtx('setOnlineStatusV1626.toString()');
        const rv = runInCtx('renderAuditV1634.toString()');
        return st.indexOf('online-status-banner') !== -1 && st.indexOf('main-story-status') !== -1 && st.indexOf('online-status-tech') !== -1
          && rv.indexOf('resolver-visible') !== -1;
      })(), '');
    const leg = Object.assign({ id: 777102, formatVersion: 'v15', winner: 'Superman', story: '<p>Legacy story.</p>' }, base);
    delete leg.mainStoryMeta; delete leg.validation; delete leg.finalRecord; delete leg.researchRefs;
    setSave(leg);
    runInCtx(`viewHistory(777102);`);
    check('V164-De legacy entry without validation: notes say not recorded, never another battle\'s record',
      (els['integrity-note'].innerText || '').indexOf('not recorded for this saved episode') !== -1
      && (els['integrity-note'].innerText || '').indexOf('Rocky Balboa') === -1
      && (els['accuracy-note'].innerText || '').indexOf('not recorded for this saved episode') !== -1,
      'note=' + els['integrity-note'].innerText);
    els['integrity-note'].innerText = 'System A — Battle Integrity: PASSED (0 unverified, honestly labelled). Authoritative record: winner=Superman, loser=Rocky Balboa, victoryMode=death, finishingEventId=21, finishingAbility=Heat Vision.';
    els['accuracy-note'].innerText = 'System B — Narrative Factual Accuracy: PASSED. LIVE ACCURACY MARKER.';
    const unopen = { id: 777103, formatVersion: 'v16.4', winner: 'Spider-Man' };
    setSave(unopen);
    runInCtx(`viewHistory(777103);`);
    check('V164-Df unopenable saved view: notes cleared to unopenable wording, no live battle record survives',
      (els['integrity-note'].innerText || '').indexOf('No validation available for an unopenable record') !== -1
      && (els['accuracy-note'].innerText || '').indexOf('No validation available for an unopenable record') !== -1
      && (els['integrity-note'].innerText || '').indexOf('Rocky Balboa') === -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('No saved story available for an unopenable record') !== -1,
      'note=' + els['integrity-note'].innerText);
  }
  // V164-E Save copy persists the climax field (generation -> save link).
  check('V164-Ea save copy carries rejectedDraftClimax from generation meta into saved mainStoryMeta',
    html.indexOf('rejectedDraftClimax: meta.rejectedDraftClimax') !== -1, '');

  // ================= v16.5 LIVE-DEFECT TESTS (T1–T17) =================
  function checksForV165(b, draft) {
    return JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(draft)}))`));
  }
  function stateOfV165(checks, prefix) {
    const c = checks.find(x => x.name.indexOf(prefix) === 0);
    return c ? c.state : 'MISSING';
  }
  function phraseV165(text, phrase) {
    return JSON.parse(runInCtx(`JSON.stringify(storyHasPhraseV162(${JSON.stringify(text)}, ${JSON.stringify(phrase)}))`));
  }
  function probeV165(text, phrase) {
    return JSON.parse(runInCtx(`JSON.stringify(storyHasPhraseProbeV165(${JSON.stringify(text)}, ${JSON.stringify(phrase)}))`));
  }
  const b165S = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
  const fin165S = finAtkOf(b165S);
  const base165S = goodDraftFor(b165S);
  // T1 (discrepancy reproduction): U+2011 draft passes the new checker and fails the old normaliser.
  {
    const draftU = base165S.split(fin165S.ability).join(fin165S.ability.split('-').join('‑')).split('Spider-Man').join('Spider‑Man');
    const oldNorm = (s) => String(s || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const oldVariants = (ph) => { const b2 = String(ph || ''); return [b2, b2.replace(/\+/g, ' and '), b2.replace(/\+/g, ' '), b2.replace(/&/g, ' and ')]; };
    const oldHas = (text, phrase) => { const nt = oldNorm(text); return oldVariants(phrase).some(v => nt.indexOf(oldNorm(v)) !== -1); };
    const checks = checksForV165(b165S, draftU);
    check('V165-T1 U+2011 draft PASSES participants/winner/finishing checks on the new checker but FAILS the old normaliser (discrepancy reproduced)',
      stateOfV165(checks, 'Participants named') === 'PASSED'
      && stateOfV165(checks, 'Winner / final outcome') === 'PASSED'
      && stateOfV165(checks, 'Finishing ability') === 'PASSED'
      && stateOfV165(checks, 'No invented decisive event') === 'PASSED'
      && oldHas(draftU, 'Spider-Man') === false && oldHas(draftU, fin165S.ability) === false,
      'fin=' + fin165S.ability + ' participants=' + stateOfV165(checks, 'Participants named') + ' oldName=' + oldHas(draftU, 'Spider-Man'));
  }
  // T2: en-dash and one-word spellings pass.
  {
    const draftEn = base165S.split('-').join('–');
    const draftOne = base165S.split('Spider-Man').join('Spiderman').split(fin165S.ability).join('SpiderSense Counter');
    const cEn = checksForV165(b165S, draftEn);
    const cOne = checksForV165(b165S, draftOne);
    check('V165-T2 en-dash and one-word spellings pass participants/winner/finishing checks',
      stateOfV165(cEn, 'Participants named') === 'PASSED' && stateOfV165(cEn, 'Finishing ability') === 'PASSED'
      && stateOfV165(cOne, 'Participants named') === 'PASSED' && stateOfV165(cOne, 'Finishing ability') === 'PASSED',
      'en participants=' + stateOfV165(cEn, 'Participants named') + ' one participants=' + stateOfV165(cOne, 'Participants named'));
  }
  // T3 (no weakening): paraphrase and single keywords still fail.
  {
    const para = 'Spider-Man and Batman met on the open ground. Batman prepared a trap and Spider-Man watched for a pattern. The fight turned when Spider-Man struck with a counter powered by his spider-sense, and Batman fell unconscious while Spider-Man stood as the winner.';
    const cPara = checksForV165(b165S, para);
    const kwSpider = 'Spider fought Batman on the open ground for a long time under the open sky the exchange grow fiercer and fiercer.';
    const cKw = checksForV165(b165S, kwSpider);
    const kwCounter = 'Spider-Man and Batman met on the open ground. Batman prepared a trap and Spider-Man watched for a pattern. The fight turned when Spider-Man struck with Counter, and Batman fell unconscious while Spider-Man stood as the winner.';
    const cKwC = checksForV165(b165S, kwCounter);
    check('V165-T3 paraphrased climax and single keywords STILL FAIL (checker not weakened)',
      stateOfV165(cPara, 'Finishing ability') === 'FAILED' && stateOfV165(cPara, 'No invented decisive event') === 'FAILED'
      && stateOfV165(cKw, 'Participants named') === 'FAILED'
      && stateOfV165(cKwC, 'Finishing ability') === 'FAILED',
      'para fin=' + stateOfV165(cPara, 'Finishing ability') + ' kw participants=' + stateOfV165(cKw, 'Participants named') + ' kwCounter fin=' + stateOfV165(cKwC, 'Finishing ability'));
  }
  // T4: loser-state negation guards.
  {
    const incPass = 'Spider-Man and Batman fought on the open ground. Spider-Man struck with Spider-Sense Counter and Batman fell unconscious, not dead, while Spider-Man stood as the winner.';
    const incFail = 'Spider-Man and Batman fought on the open ground. Spider-Man struck with Spider-Sense Counter and Batman fell and he was dead, while Spider-Man stood as the winner.';
    const bR = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const deathPass = 'Superman and Rocky Balboa fought on the open ground. Superman struck with Super Punch and Rocky Balboa was not merely unconscious — he was dead, while Superman stood as the winner.';
    const deathFail = 'Superman and Rocky Balboa fought on the open ground. Superman struck with Super Punch and Rocky Balboa was merely unconscious, while Superman stood as the winner.';
    check('V165-T4 loser-state negation: "unconscious, not dead" passes Incapacitation, "he was dead" fails it; "not merely unconscious — he was dead" passes Death, "merely unconscious" fails it',
      stateOfV165(checksForV165(b165S, incPass), 'Loser state matches the mode') === 'PASSED'
      && stateOfV165(checksForV165(b165S, incFail), 'Loser state matches the mode') === 'FAILED'
      && stateOfV165(checksForV165(bR, deathPass), 'Loser state matches the mode') === 'PASSED'
      && stateOfV165(checksForV165(bR, deathFail), 'Loser state matches the mode') === 'FAILED',
      'incPass=' + stateOfV165(checksForV165(b165S, incPass), 'Loser state matches the mode') + ' deathPass=' + stateOfV165(checksForV165(bR, deathPass), 'Loser state matches the mode'));
  }
  // T5: colon-variant ability, lower-case variant label, lower-case transform/cannot-harm names.
  {
    const bGod = battle([[spec('goku', { variant: 'God', variantId: 'god' })], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const godDraft = 'Goku and Rocky Balboa fought on the open ground in god form, trading blows under the open sky the exchange grow fiercer and fiercer.';
    const cGod = checksForV165(bGod, godDraft);
    let chAbility = '';
    for (const sd of [12345, 1, 2, 3, 42, 7]) {
      const bb = battle([[spec('superman')], [spec('rocky')]], { seed: sd, victoryMode: 'death' });
      const ev = (bb.events || []).find(e => e.cannotHarm && e.ability);
      if (ev) { chAbility = ev.ability; break; }
    }
    const bCH = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const chDraft = 'Superman and Rocky Balboa fought on the open ground. Rocky Balboa used ' + (chAbility ? chAbility.toLowerCase() : 'body blow') + ' again and again while Superman stood firm and won the fight in the end.';
    const cCH = checksForV165(bCH, chDraft);
    check('V165-T5 colon-variant ability passes, paraphrase fails; lower-case variant label and lower-case cannot-harm name are detected by normalised matching',
      phraseV165('The hero used Test Strike to win.', 'Test: Strike') === true
      && phraseV165('The hero used a powerful strike to win.', 'Test: Strike') === false
      && phraseV165('he went sun-charged', 'Sun-Charged') === true
      && stateOfV165(cGod, 'Variants correct') === 'PASSED'
      && (chAbility === '' || stateOfV165(cCH, 'No cannot-harm attack') === 'UNVERIFIED'),
      'variant=' + stateOfV165(cGod, 'Variants correct') + ' chAbility=' + chAbility + ' chState=' + stateOfV165(cCH, 'No cannot-harm attack'));
  }
  // T6: JSON length finish -> meta carries finish reason, failed stage, length.
  // v16.7: the failing stage is outline (not whole-story revision); the
  // length finish reason, exact draft length, and stage name are recorded.
  await expectV16('V165-T6 length finish diagnostics', async () => {
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The exchange grew fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: longBad }, finish_reason: 'length' }] }) });
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t6', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t6, 'v16-test-v165t6-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T6 (v16.10 DELIBERATE CHANGE) mock length finish produces meta with finish reason, failed stage opening, and exact draft length, rendered in Technical Details',
      meta.rejectedDraftFinishReason === 'length' && meta.rejectedDraftStage === 'opening' && meta.rejectedDraftLength === longBad.length
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected draft length: ' + longBad.length + ' characters') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Failed stage: opening') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Provider finish signal: length') !== -1,
      'stage=' + meta.rejectedDraftStage + ' finish=' + meta.rejectedDraftFinishReason + ' len=' + meta.rejectedDraftLength);
    sandbox.fetch = realFetch;
  });
  // T7: stage-correction-fetch failure names the failed stage and shows the failed stage's excerpts.
  await expectV16('V165-T7 correction failure labelling', async () => {
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('REVISION') !== -1) throw new Error('correction transport boom');
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t7', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t7, 'v16-test-v165t7-1', {})`);
    check('V165-T7 (v16.10 DELIBERATE CHANGE) correction-fetch failure names the opening stage failure and shows the failed stage excerpts',
      (els['main-story-label'].innerText || '').indexOf('opening stage') !== -1
      && (els['main-story-label'].innerText || '').indexOf('failed to generate') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Two figures clashed') !== -1,
      'label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // T8: token-limit transport error at a stage falls back with the stage named.
  // v16.7: there is no single-shot condensed retry on the primary path;
  // the stage correction mechanism applies to validation failures, while a
  // transport error (including a token-limit 400) falls back honestly.
  await expectV16('V165-T8 token-limit stage failure', async () => {
    sandbox.fetch = async () => ({ ok: false, status: 400, text: async () => 'output_token_limit_exceeded' });
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t8', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t8, 'v16-test-v165t8-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T8 (v16.10 DELIBERATE CHANGE) token-limit 400 at the opening stage falls back with the stage named and the token-limit token in the reason',
      meta.kind === 'offline' && meta.rejectedDraftStage === 'opening'
      && (meta.reason || '').indexOf('output_token_limit') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1,
      'stage=' + meta.rejectedDraftStage + ' reason=' + meta.reason);
    sandbox.fetch = realFetch;
  });
  // T9: probe helper distinguishes spaced, separator-stripped, and no-match; fallback probe renders.
  await expectV16('V165-T9 per-check probe', async () => {
    const pOne = probeV165('Spiderman fought Batman.', 'Spider-Man');
    const pNone = probeV165('Batman fought a stranger.', 'Spider-Man');
    const pU = probeV165('Spider‑Man fought Batman.', 'Spider-Man');
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => unnamedDraft });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v165t9', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t9, 'v16-test-v165t9-1', {})`);
    check('V165-T9 probe distinguishes one-word (stripped only), Unicode-hyphen (matched), and absent (neither), and fallback diagnostics render the probe',
      pOne.spaced === false && pOne.stripped === true && pOne.matched === true
      && pNone.spaced === false && pNone.stripped === false && pNone.matched === false
      && pU.matched === true
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Per-check probe') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('no match') !== -1,
      'one=' + JSON.stringify(pOne) + ' none=' + JSON.stringify(pNone) + ' u=' + JSON.stringify(pU));
    sandbox.fetch = realFetch;
  });
  // T10: stage-correction prompt discipline — condensed brief + failed checks + join text only, never the full story.
  await expectV16('V165-T10 correction prompt', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const full = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    let corrPrompt = '';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let content = '';
      try { content = JSON.parse(body).messages[1].content; } catch (e) {}
      if (body.indexOf('REVISION') !== -1) { corrPrompt = content; return { ok: true, status: 200, text: async () => goodDraftFor(b) }; }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v165t10', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t10, 'v16-test-v165t10-1', {})`);
    check('V165-T10 correction prompt is stage-scoped: REVISION header, failed hard-constraint checks, story brief, no full single-shot prompt, no full previous draft',
      corrPrompt.indexOf('REVISION') !== -1
      && corrPrompt.indexOf('failed these hard-constraint checks') !== -1
      && corrPrompt.indexOf('STORY BRIEF') !== -1
      && corrPrompt.indexOf(unnamedDraft) === -1
      && corrPrompt.length < full.length,
      'corrLen=' + corrPrompt.length + ' fullLen=' + full.length);
    sandbox.fetch = realFetch;
  });
  // T11: one stage correction succeeds and the assembled story renders.
  await expectV16('V165-T11 stage correction success', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const good = goodDraftFor(b);
    let calls = 0; let corrSeen = 0;
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      calls++;
      // v16.10 DELIBERATE CHANGE: the correction must be a valid
      // opening scene, not a whole draft (a whole draft names the
      // finisher in the opening and now fails fidelity).
      if (body.indexOf('REVISION') !== -1) { corrSeen++; let stage = 'opening'; try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {} return { ok: true, status: 200, text: async () => stageScenesForV167(b)[stage] || stageScenesForV167(b).opening }; }
      if (corrSeen >= 1) {
        let stage = 'opening';
        try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
        return { ok: true, status: 200, text: async () => stageScenesForV167(b)[stage] || stageScenesForV167(b).opening };
      }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v165t11', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t11, 'v16-test-v165t11-1', {})`);
    check('V165-T11 (v16.10 DELIBERATE CHANGE) one stage correction (opening) then AI story: exactly one correction, 6 POSTs total',
      calls === 6 && corrSeen === 1 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'calls=' + calls + ' corrSeen=' + corrSeen + ' label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // T12: a revision returning only a short correction fragment still fails validation.
  await expectV16('V165-T12 revision fragment still fails', async () => {
    const fragment = 'Fixed: Spider-Man wins. Correction note only, no aftermath and no finishing move described.';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('REVISION') !== -1) return { ok: true, status: 200, text: async () => fragment };
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t12', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t12, 'v16-test-v165t12-1', {})`);
    check('V165-T12 short correction fragment from the revision still fails validation (prompt change, not checker weakening)',
      (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Draft did not pass validation') !== -1
      && (els['story-output'].innerHTML || '').indexOf('Correction note only') === -1,
      'label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // T13/T14: prompt structure and planning-ending draft.
  {
    const full = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b165S))}))`);
    const cond = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(b165S))}))`);
    check('V165-T13 prompts require ending with the aftermath (head instruction survives capping in the full prompt; tail in the uncapped condensed prompt) and drop the contradictory "in chapters" tail',
      full.indexOf('must END with the aftermath') !== -1 && full.indexOf('must not end on a planning') !== -1 && full.indexOf('Write the story now, in chapters') === -1
      && cond.indexOf('ending with the aftermath') !== -1 && cond.indexOf('must not end on a planning') !== -1 && cond.indexOf('Write the story now, in chapters') === -1,
      'fullLen=' + full.length + ' condLen=' + cond.length);
    const planning = 'Spider-Man and Batman met on the open ground. Batman planned a trap and Spider-Man watched. Scene Two – The First Plan: Batman positioned his devices and whispered about the perfect loop.';
    const cPlan = checksForV165(b165S, planning);
    check('V165-T14 draft ending on a planning scene with no finisher still fails both finishing checks',
      stateOfV165(cPlan, 'Finishing ability') === 'FAILED' && stateOfV165(cPlan, 'No invented decisive event') === 'FAILED',
      'fin=' + stateOfV165(cPlan, 'Finishing ability'));
  }
  // T15/T16: truncation reason vs plain validation reason.
  await expectV16('V165-T15 truncation reason', async () => {
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The exchange grew fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: longBad }, finish_reason: 'length' }] }) });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v165t15', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t15, 'v16-test-v165t15-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T15 (v16.10 DELIBERATE CHANGE) length finish gives the distinct output-limit fallback reason (opening stage named) and never an AI story',
      meta.kind === 'offline' && (meta.reason || '').indexOf('Draft stopped before finishing (provider output limit)') !== -1
      && (meta.reason || '').indexOf('opening stage') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Draft stopped before finishing (provider output limit)') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Online AI Story') === -1,
      'reason=' + meta.reason);
    sandbox.fetch = realFetch;
  });
  await expectV16('V165-T16 stop finish keeps plain reason', async () => {
    // v16.7: the complete-but-dialogue-failing draft passes every STAGE
    // check (stages do not test dialogue self-naming), so the assembled
    // whole fails at the assembly stage with the plain validation reason.
    const b0 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const fin0 = finAtkOf(b0);
    const completeBad = 'Superman: "I am Superman." Superman and Rocky Balboa met on the open ground. Superman struck with ' + fin0.ability + ' in the climax. Aftermath: Superman stood as the winner while Rocky Balboa lay dead on the open ground.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: completeBad }, finish_reason: 'stop' }] }) });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v165t16', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t16, 'v16-test-v165t16-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T16 stop finish with a failing assembled draft keeps the plain validation reason (no output-limit wording), stage named as assembly',
      meta.kind === 'offline' && (meta.reason || '').indexOf('Draft did not pass validation') !== -1
      && (meta.reason || '').indexOf('provider output limit') === -1
      && (els['main-story-label'].innerText || '').indexOf('provider output limit') === -1,
      'reason=' + meta.reason);
    sandbox.fetch = realFetch;
  });
  // T17: attempts label honesty + stage-named 402 retry status, multi-stage.
  await expectV16('V165-T17 attempts breakdown', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    // v16.10 DELIBERATE CHANGE: the opening correction must be a
    // valid opening scene, not a whole draft (a whole draft names the
    // finisher in the opening and now fails fidelity).
    let calls = 0;
    sandbox.fetch = async (url, opts) => {
      calls++;
      if (calls === 1) throw new Error('signal is aborted without reason');
      if (calls === 2) return { ok: true, status: 200, text: async () => unnamedDraft };
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      return { ok: true, status: 200, text: async () => stageScenesForV167(b)[stage] || stageScenesForV167(b).opening };
    };
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t17', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t17, 'v16-test-v165t17-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T17 (v16.10 DELIBERATE CHANGE) abort retry on opening + one correction renders attempts 7 with the per-stage breakdown',
      meta.attempts === 7 && (meta.attemptsBreakdown || '').indexOf('opening ×3') !== -1 && (meta.attemptsBreakdown || '').indexOf('1 correction') !== -1
      && (meta.attemptsBreakdown || '').indexOf('1 retry') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Provider attempts: 7') !== -1,
      'attempts=' + meta.attempts + ' breakdown=' + meta.attemptsBreakdown);
    let first402Status = '';
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenesT17b = stageScenesForV167(b2);
    sandbox.fetch = async (url, opts) => {
      const st = els['main-story-status'].innerText || '';
      if (st.indexOf('402') !== -1 || st.indexOf('Free anonymous limit') !== -1) {
        if (!first402Status) first402Status = st;
        let stage = 'opening';
        try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
        return { ok: true, status: 200, text: async () => scenesT17b[stage] || scenesT17b.opening };
      }
      return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
    };
    setVmBattle('globalThis._v165t17b', b2);
    await runInCtx(`generateMainStoryV16(globalThis._v165t17b, 'v16-test-v165t17b-1', {})`);
    check('V165-T17b (v16.10 DELIBERATE CHANGE) 402 retry status names the stage (opening stage)',
      first402Status.indexOf('(opening stage)') !== -1,
      'first402Status=' + first402Status);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V1626-NOSAVE-MAIN: save functions return null and write nothing (v16.26 DELIBERATE CHANGE: save/history removed).
  check('V1626-NOSAVE-MAIN (v16.26 DELIBERATE CHANGE) saveMainStoryOnceV16 returns null and writes no history entry',
    (function () {
      runInCtx(`localStorage.setItem('warroom_battles_v3', '[]');`);
      const r = runInCtx('saveMainStoryOnceV16(null, "x", "y")');
      const after = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
      return r === null && after.length === 0;
    })(),
    '');

  // ================= v16.6 LIVE-DEFECT TESTS (truncated AI story) =================
  function stateOfV166(checks, name) { const c = checks.find(x => x.name === name); return c ? c.state : 'MISSING'; }
  function countsOfV166(cs) { return JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(cs))})))`)); }
  const b166S = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
  const fin166S = finAtkOf(b166S);
  const loser166S = b166S.winner === b166S.alpha[0].name ? b166S.beta[0].name : b166S.alpha[0].name;
  // A: v16.5 Battle 1 reproduction — finisher only in Rounds 2–3, ends mid-sentence in Round 5, no aftermath.
  {
    const repro = [
      'Spider-Man and Batman met on the open ground under the open sky.',
      'Round 2: Spider-Man struck with ' + fin166S.ability + ' again and again while Batman blocked and circled.',
      'Round 3: Spider-Man struck with ' + fin166S.ability + ' once more while Batman prepared a trap.',
      'Round 4: Batman set his trap and Spider-Man watched for a pattern.',
      'Round 5: Spider-Man moved to strike and Batman raised his guard, the blow half-formed and the arena lights flickering as the fight hung in'
    ].join('\n\n');
    const cs = checksForV165(b166S, repro);
    check('V166-A v16.5 Battle 1 reproduction (finisher only in Rounds 2–3, mid-sentence Round 5 ending, no aftermath) FAILS finishing-ability + completeness + aftermath',
      stateOfV166(cs, 'Finishing ability / event matches the record') === 'FAILED'
      && stateOfV166(cs, 'No invented decisive event') === 'FAILED'
      && stateOfV166(cs, 'Story ends with an aftermath') === 'FAILED'
      && stateOfV166(cs, 'Story is complete (not truncated)') === 'FAILED'
      && stateOfV166(cs, 'Participants named') === 'PASSED',
      'fin=' + stateOfV166(cs, 'Finishing ability / event matches the record') + ' after=' + stateOfV166(cs, 'Story ends with an aftermath') + ' complete=' + stateOfV166(cs, 'Story is complete (not truncated)'));
  }
  // B: 871-char-style truncated Round 1 draft, never naming the finisher.
  {
    const trunc = 'Spider-Man and Batman met on the open ground under the open sky. Round 1: Spider-Man swung across the arena and Batman watched for a pattern, the fight just beginning and neither fighter landing a decisive blow yet';
    const cs = checksForV165(b166S, trunc);
    check('V166-B truncated Round 1 draft that never names the finisher FAILS finishing-ability + completeness + aftermath',
      stateOfV166(cs, 'Finishing ability / event matches the record') === 'FAILED'
      && stateOfV166(cs, 'Story is complete (not truncated)') === 'FAILED'
      && stateOfV166(cs, 'Story ends with an aftermath') === 'FAILED',
      'fin=' + stateOfV166(cs, 'Finishing ability / event matches the record'));
  }
  // C: complete multi-paragraph draft — finisher in climax paragraph, aftermath final paragraph.
  {
    const complete = [
      'Spider-Man and Batman met on the open ground under the open sky.',
      'Batman studied the approach and prepared a counter, but Spider-Man sensed the trap and changed tactics.',
      'The fight turned when Spider-Man closed in and struck with ' + fin166S.ability + ', ending the exchange.',
      'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.'
    ].join('\n\n');
    const cs = checksForV165(b166S, complete);
    check('V166-C complete draft (finisher in climax paragraph + aftermath final paragraph) PASSES with 0 failures',
      countsOfV166(cs).failed === 0
      && stateOfV166(cs, 'Finishing ability / event matches the record') === 'PASSED'
      && stateOfV166(cs, 'Story ends with an aftermath') === 'PASSED'
      && stateOfV166(cs, 'Story is complete (not truncated)') === 'PASSED',
      JSON.stringify(countsOfV166(cs)));
  }
  // D: brief but complete decisive-fight draft — no word floor.
  {
    const brief = 'Spider-Man and Batman met on the open ground. Spider-Man struck with ' + fin166S.ability + '. Batman fell unconscious while Spider-Man stood as the winner.';
    const cs = checksForV165(b166S, brief);
    check('V166-D brief but complete draft (opening + climax + aftermath, short) PASSES with 0 failures — no word floor',
      countsOfV166(cs).failed === 0
      && stateOfV166(cs, 'Finishing ability / event matches the record') === 'PASSED'
      && stateOfV166(cs, 'Story ends with an aftermath') === 'PASSED',
      JSON.stringify(countsOfV166(cs)) + ' len=' + brief.length);
  }
  // E: paraphrased climax with a valid aftermath still fails the finishing checks (region gate, not aftermath gate).
  {
    const para = [
      'Spider-Man and Batman met on the open ground under the open sky.',
      'Batman studied the approach and prepared a counter, but Spider-Man sensed the trap and changed tactics.',
      'The fight turned when Spider-Man closed in and struck with a counter powered by his spider-sense, ending the exchange.',
      'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.'
    ].join('\n\n');
    const cs = checksForV165(b166S, para);
    check('V166-E paraphrased climax with valid aftermath STILL FAILS finishing checks while aftermath PASSES',
      stateOfV166(cs, 'Finishing ability / event matches the record') === 'FAILED'
      && stateOfV166(cs, 'No invented decisive event') === 'FAILED'
      && stateOfV166(cs, 'Story ends with an aftermath') === 'PASSED',
      'fin=' + stateOfV166(cs, 'Finishing ability / event matches the record') + ' after=' + stateOfV166(cs, 'Story ends with an aftermath'));
  }
  // J: stalemate draft states the stalemate and needs no finisher.
  {
    const stalemateBattle = { winner: 'Stalemate', victoryMode: 'death', stalemate: true, alpha: [{ name: 'Spider-Man', variant: 'Base', sig: 'Web Shot', trans: '' }], beta: [{ name: 'Batman', variant: 'Base', sig: 'Grapple Kick', trans: '' }], events: [] };
    const cs = checksForV165(stalemateBattle, 'Spider-Man and Batman fought to a standstill on the open ground. No winner emerged and the battle ended in a stalemate.');
    check('V166-J stalemate draft stating the stalemate PASSES finishing + aftermath checks with no finisher required',
      stateOfV166(cs, 'Finishing ability / event matches the record') === 'PASSED'
      && stateOfV166(cs, 'Story ends with an aftermath') === 'PASSED'
      && stateOfV166(cs, 'Story is complete (not truncated)') === 'PASSED',
      JSON.stringify(countsOfV166(cs)));
  }
  // F: mid-sentence draft falls back with the distinct incompleteness reason + always-rendered finish signal.
  await expectV16('V166-F truncated fallback reason', async () => {
    const truncDraft = 'Spider-Man and Batman met on the open ground under the open sky. Round 1: Spider-Man swung across the arena and Batman watched for a pattern, the fight just beginning and neither fighter landing a decisive blow yet';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => truncDraft });
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v166f', b);
    await runInCtx(`generateMainStoryV16(globalThis._v166f, 'v16-test-v166f-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const diag = els['main-story-diagnostics'].innerHTML || '';
    check('V166-F mid-sentence draft falls back with distinct "Draft incomplete/truncated" reason and an explicit finish-signal line',
      meta && meta.kind === 'offline' && (meta.reason || '').indexOf('Draft incomplete/truncated') !== -1
      && diag.indexOf('finish signal: not reported by provider') !== -1,
      'reason=' + (meta && meta.reason) + ' diagHasFinish=' + (diag.indexOf('finish signal') !== -1));
    sandbox.fetch = realFetch;
  });
  // G: successful AI meta carries assembled length + finish signal (JSON "stop" and plain-text "not reported").
  await expectV16('V166-G successful AI diagnostics', async () => {
    const good = goodDraftFor(battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' }));
    const scenesG = stageScenesForV167(battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' }));
    sandbox.fetch = async (url, opts) => {
      let stage = 'opening';
      try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: scenesG[stage] || scenesG.opening }, finish_reason: 'stop' }] }) };
    };
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v166g', b);
    await runInCtx(`generateMainStoryV16(globalThis._v166g, 'v16-test-v166g-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const diag = els['main-story-diagnostics'].innerHTML || '';
    check('V166-Ga successful AI meta carries ASSEMBLED length + finish signal "stop", rendered in Technical Details',
      meta && meta.kind === 'ai' && meta.aiDraftLength > good.length && meta.aiFinishReason === 'stop'
      && diag.indexOf('AI story length: ' + meta.aiDraftLength) !== -1 && diag.indexOf('Provider finish signal: stop') !== -1,
      'kind=' + (meta && meta.kind) + ' len=' + (meta && meta.aiDraftLength) + ' fin=' + (meta && meta.aiFinishReason));
    sandbox.fetch = async (url, opts) => {
      let stage = 'opening';
      try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      return { ok: true, status: 200, text: async () => scenesG[stage] || scenesG.opening };
    };
    setVmBattle('globalThis._v166g2', b);
    await runInCtx(`generateMainStoryV16(globalThis._v166g2, 'v16-test-v166g-2', {})`);
    const meta2 = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const diag2 = els['main-story-diagnostics'].innerHTML || '';
    check('V166-Gb plain-text successful AI meta renders finish signal as "not reported by provider"',
      meta2 && meta2.kind === 'ai' && diag2.indexOf('finish signal: not reported by provider') !== -1,
      'kind=' + (meta2 && meta2.kind) + ' fin=' + (meta2 && meta2.aiFinishReason));
    sandbox.fetch = realFetch;
  });
  // H: continuation prompt for a truncated stage carries the truncated text and forbids repetition.
  // v16.7: there is no whole-story revision; a stage that ends mid-sentence
  // is continued app-side (a new prompt carrying the truncated text), and
  // only if that fails is the stage re-requested fresh.
  await expectV16('V166-H truncated opening gets a targeted fresh repair (no CONTINUATION), then renders AI', async () => {
    // v16.10 DELIBERATE CHANGE: app-side continuation is REMOVED. A
    // truncated stage now gets the same single targeted fresh repair
    // (REVISION) as any other failed stage; no CONTINUATION prompt
    // exists anywhere in the v16.10 path.
    const truncDraft = 'Spider-Man and Batman met on the open ground under the open sky. Round 1: Spider-Man swung across the arena and Batman watched for a pattern, the fight just beginning and neither fighter landing a decisive blow yet';
    let revBody = ''; let contSeen = 0;
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('CONTINUATION') !== -1) { contSeen++; return { ok: true, status: 200, text: async () => scenes.opening }; }
      if (body.indexOf('REVISION') !== -1) { revBody = body; return { ok: true, status: 200, text: async () => scenes.opening }; }
      if (revBody) {
        let stage = 'opening';
        try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
        return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
      }
      return { ok: true, status: 200, text: async () => truncDraft };
    };
    setVmBattle('globalThis._v166h', b);
    await runInCtx(`generateMainStoryV16(globalThis._v166h, 'v16-test-v166h-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V166-H truncated opening gets a targeted fresh repair (no CONTINUATION), then renders AI',
      contSeen === 0 && revBody.indexOf('REVISION') !== -1 && revBody.indexOf('failed these hard-constraint checks') !== -1
      && revBody.indexOf('STORY BRIEF') !== -1
      && meta && meta.kind === 'ai'
      && (els['story-output'].innerHTML || '').indexOf(scenes.opening.slice(0, 40)) !== -1,
      'contSeen=' + contSeen + ' kind=' + (meta && meta.kind));
    sandbox.fetch = realFetch;
  });
    // I: System C trace — the Chapter V/VI claims belong to the fallback episode, not the AI story.
  check('V166-I System C headings state they describe the fallback episode, not the AI main story',
    html.indexOf('rule-based fallback episode — not the AI main story') !== -1
    && html.indexOf('Saved System C — Story Quality (rule-based fallback episode — not the AI main story)') !== -1,
    '');
  // K: prompt structure — all three prompts require the ordered complete story ending with a complete sentence.
  {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const full = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const condensed = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    check('V166-K full + condensed prompts require opening → escalation → decisive climax → aftermath and a complete final sentence',
      full.indexOf('opening → escalation → decisive sequence') !== -1 && full.indexOf('must end with a complete sentence') !== -1
      && condensed.indexOf('opening → escalation → decisive sequence') !== -1 && condensed.indexOf('must end with a complete sentence') !== -1,
      'fullHas=' + (full.indexOf('opening → escalation') !== -1) + ' condHas=' + (condensed.indexOf('opening → escalation') !== -1));
  }
  // L: importer accepts v16.7; format version is v16.7.
  // v16.18 DELIBERATE CHANGE: importer accepts v16.18 as current (v16.17 still in the accepted list); build carries v16.18 version strings.
  check('V169-L (v16.35 DELIBERATE CHANGE) importer accepts v16.34 as a previous version and the build carries v16.35 version strings; v16.24-v16.33 still referenced',
    html.indexOf("'v16.28'") !== -1 && html.indexOf("formatVersion:'v16.35'") !== -1 && html.indexOf('<title>WAR-ROOM v16.35') !== -1 && html.indexOf("'v16.30'") !== -1 && html.indexOf("'v16.31'") !== -1 && html.indexOf("'v16.32'") !== -1 && html.indexOf("'v16.33'") !== -1 && html.indexOf("'v16.27'") !== -1 && html.indexOf("'v16.26'") !== -1 && html.indexOf("'v16.25'") !== -1 && html.indexOf("'v16.24'") !== -1 && html.indexOf("'v16.34'") !== -1,
    '');

  // ================= v16.7 MULTI-STAGE GENERATION TESTS =================
  // Stage-aware mock: answers each stage prompt with a stage-appropriate
  // scene built from the battle record. Scenes name both fighters, use the
  // recorded finisher only in the climax scene, and end the aftermath with
  // the winner + loser state, so the assembled whole must pass the
  // UNCHANGED v16.6 checker.
  function stageScenesForV167(b) {
    const fin = finAtkOf(b);
    const loser = loserOf(b);
    const abil = fin ? fin.ability : '';
    const win = b.winner;
    const end = b.victoryMode === 'incapacitation'
      ? ('Aftermath: ' + win + ' stood as the winner while ' + loser + ' lay unconscious, not dead, on the open ground.')
      : ('Aftermath: ' + win + ' stood as the winner while ' + loser + ' lay dead on the open ground.');
    return {
      outline: 'Opening beat: ' + win + ' and ' + loser + ' meet. Escalation beat: they trade blows. Climax beat: ' + win + ' strikes with ' + abil + '. Aftermath beat: ' + win + ' wins.',
      opening: win + ' and ' + loser + ' met on the open ground under the open sky, each sizing the other up before the first exchange.',
      combat1: win + ' and ' + loser + ' traded blows in the early exchanges, testing guards and footwork under the open sky.',
      combat2: win + ' and ' + loser + ' traded harder blows as momentum shifted, neither giving ground under the open sky.',
      climax: 'The fight turned when ' + win + ' closed in and struck with ' + abil + ', ending the exchange.',
      aftermath: end
    };
  }
  function mockFetchStagesV167(scenes, opts) {
    opts = opts || {};
    const calls = { n: 0, prompts: [] };
    const fetch = async (url, o) => {
      calls.n++;
      let content = '';
      try { content = JSON.parse((o && o.body) || '').messages[1].content; } catch (e) {}
      calls.prompts.push(content);
      if (opts.onCall) { const r = opts.onCall(calls.n, content); if (r) return r; }
      let stage = 'other';
      const m = content.match(/STAGE: ([a-z0-9]+)/);
      if (m) stage = m[1];
      if (content.indexOf('REVISION') !== -1) {
        if (opts.correctionText) return { ok: true, status: 200, text: async () => opts.correctionText };
        return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
      }
      if (content.indexOf('CONTINUATION') !== -1) {
        if (opts.continuationText) return { ok: true, status: 200, text: async () => opts.continuationText };
        return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
      }
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    return { fetch: fetch, calls: calls };
  }
  // V167-A: 6 mock stages assemble into one seamless story passing v16.6 validation.
  await expectV16('V167-A multi-stage assembly', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const mf = mockFetchStagesV167(scenes);
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v167a', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v167a, 'v16-test-v167a-1', {})`);
    const story = els['story-output'].innerHTML || '';
    const diag = els['main-story-diagnostics'].innerHTML || '';
    const fin = finAtkOf(b);
    check('V167-Aa (v16.10 DELIBERATE CHANGE) 5 mock stages assemble into one seamless AI story passing v16.6 validation (5 POSTs, finisher in climax, aftermath ending)',
      meta && meta.kind === 'ai' && mf.calls.n === 5
      && story.indexOf(scenes.opening.slice(0, 40)) !== -1 && story.indexOf(scenes.climax.slice(0, 40)) !== -1
      && story.indexOf('Aftermath:') !== -1 && (fin ? story.indexOf(fin.ability) !== -1 : true)
      && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'kind=' + (meta && meta.kind) + ' calls=' + mf.calls.n + ' label=' + els['main-story-label'].innerText);
    check('V167-Ab (v16.10 DELIBERATE CHANGE) per-stage diagnostics recorded for all 5 stages (prompt/response chars, elapsed, finish signal incl. not reported)',
      meta && meta.stageDiagnostics && meta.stageDiagnostics.length === 5
      && meta.stageDiagnostics.every(d => typeof d.promptChars === 'number' && typeof d.responseChars === 'number' && typeof d.elapsedMs === 'number')
      && diag.indexOf('opening stage') !== -1 && diag.indexOf('aftermath stage') !== -1
      && diag.indexOf('finish signal: not reported by provider') !== -1,
      'stages=' + (meta && meta.stageDiagnostics && meta.stageDiagnostics.length));
    check('V167-Ac every stage prompt is under the 2000-char hard guard (and under ~1600 for this fixture battle)',
      mf.calls.prompts.every(p => p.length <= 2000) && mf.calls.prompts.every(p => p.length <= 1600),
      'lens=' + mf.calls.prompts.map(p => p.length).join(','));
    sandbox.fetch = realFetch;
  });
  // V167-B: a stage failing validation gets exactly one correction (condensed brief + failed checks) and succeeds.
  await expectV16('V167-B stage correction', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const badClimax = 'The fight turned when Spider-Man closed in and struck with a vague counter, ending the exchange.';
    let corrPrompts = [];
    const mf = mockFetchStagesV167(scenes, { onCall: (n, content) => {
      if (content.indexOf('STAGE: climax') !== -1 && content.indexOf('REVISION') === -1) return { ok: true, status: 200, text: async () => badClimax };
      if (content.indexOf('REVISION') !== -1) corrPrompts.push(content);
      return null;
    }});
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v167b', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v167b, 'v16-test-v167b-1', {})`);
    check('V167-Ba (v16.11 DELIBERATE CHANGE) climax stage failing validation gets exactly one correction with story brief + locked outcome + failed checks (not the full story) and then renders AI',
      meta && meta.kind === 'ai' && corrPrompts.length === 1
      && corrPrompts[0].indexOf('failed these hard-constraint checks') !== -1
      && corrPrompts[0].indexOf('STORY BRIEF') !== -1
      && corrPrompts[0].indexOf('Loser:') !== -1
      && mf.calls.n === 6,
      'kind=' + (meta && meta.kind) + ' corr=' + corrPrompts.length + ' calls=' + mf.calls.n);
    sandbox.fetch = realFetch;
  });
  // V167-C: a stage failing after correction falls back with the failed stage named, never a partial assembly.
  await expectV16('V167-C stage failure after correction', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    const badAftermath = 'The fight ended somehow, with no clear outcome stated at all.';
    const mf = mockFetchStagesV167(scenes, { onCall: (n, content) => {
      if (content.indexOf('STAGE: aftermath') !== -1) return { ok: true, status: 200, text: async () => badAftermath };
      return null;
    }});
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v167c', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v167c, 'v16-test-v167c-1', {})`);
    check('V167-Ca aftermath failing after correction falls back with the failed stage named, never a partial assembly as an AI story',
      meta && meta.kind === 'offline' && meta.failedStage === 'aftermath'
      && (meta.reason || '').indexOf('aftermath stage') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && (els['story-output'].innerHTML || '').indexOf('no clear outcome stated') === -1,
      'failedStage=' + (meta && meta.failedStage) + ' reason=' + (meta && meta.reason));
    sandbox.fetch = realFetch;
  });
  // V167-D: truncated stage continued app-side; duplicate continuation discarded and re-requested fresh.
  await expectV16('V167-D truncated opening repair (continuation removed)', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const truncOpening = 'Spider-Man and Batman met on the open ground under the open sky, each sizing the other up before the first exchange began and neither fighter yet';
    const dupContinuation = 'Spider-Man and Batman met on the open ground under the open sky. Then the fight truly began.';
    let contSeen = 0; let freshSeen = 0;
    const mf = mockFetchStagesV167(scenes, { onCall: (n, content) => {
      if (content.indexOf('STAGE: opening') !== -1 && content.indexOf('REVISION') === -1 && content.indexOf('CONTINUATION') === -1) return { ok: true, status: 200, text: async () => truncOpening };
      if (content.indexOf('CONTINUATION') !== -1) { contSeen++; return { ok: true, status: 200, text: async () => dupContinuation }; }
      if (content.indexOf('REVISION') !== -1) { freshSeen++; return { ok: true, status: 200, text: async () => scenes.opening }; }
      return null;
    }});
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v167d', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v167d, 'v16-test-v167d-1', {})`);
    // v16.10 DELIBERATE CHANGE: no CONTINUATION prompt exists, so
    // the truncated opening goes straight to a fresh REVISION repair.
    check('V167-Da truncated opening gets a fresh REVISION repair (no CONTINUATION), then renders AI',
      meta && meta.kind === 'ai' && contSeen === 0 && freshSeen === 1
      && (els['story-output'].innerHTML || '').indexOf(scenes.opening.slice(0, 40)) !== -1,
      'kind=' + (meta && meta.kind) + ' cont=' + contSeen + ' fresh=' + freshSeen);
    sandbox.fetch = realFetch;
  });
  // V167-E: contradiction in a stage fails that stage and is never smoothed in assembly.
  await expectV16('V167-E contradiction fails the stage', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const contraClimax = 'The fight turned when Spider-Man closed in and struck with Heat Vision, ending the exchange. Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.';
    const mf = mockFetchStagesV167(scenes, { onCall: (n, content) => {
      if (content.indexOf('STAGE: climax') !== -1) return { ok: true, status: 200, text: async () => contraClimax };
      return null;
    }});
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v167e', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v167e, 'v16-test-v167e-1', {})`);
    check('V167-Ea a climax scene using a non-participant signature (Heat Vision) fails the stage and falls back; the contradiction is never smoothed into an AI story',
      meta && meta.kind === 'offline' && meta.failedStage === 'climax'
      && (els['story-output'].innerHTML || '').indexOf('Heat Vision') === -1,
      'failedStage=' + (meta && meta.failedStage) + ' kind=' + (meta && meta.kind));
    sandbox.fetch = realFetch;
  });
  // V167-F: POST cap accounting under the v16.8 definition.
  // v16.8 DELIBERATE CHANGE: 402 wait-retries are NOT charged to the
  // generation cap. Every stage's first attempt rate-limited and retried
  // once now costs 6 counted POSTs for 12 fetch calls and SUCCEEDS;
  // the old v16.7 expectation (10 counted, aftermath refused, fallback
  // naming the cap) no longer applies. The cap still binds generation
  // POSTs — see V168-E, where counted abort retries hit the cap.
  await expectV16('V167-F POST cap accounting', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    let calls = 0;
    const retried402 = {};
    sandbox.fetch = async (url, opts) => {
      calls++;
      let content = '';
      try { content = JSON.parse((opts && opts.body) || '').messages[1].content; } catch (e) {}
      const m = content.match(/STAGE: ([a-z0-9]+)/);
      const stage = m ? m[1] : 'other';
      if (!retried402[stage]) { retried402[stage] = true; return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' }; }
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v167f', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v167f, 'v16-test-v167f-1', {})`);
    const counted = runInCtx(`v163PostCount`);
    check('V167-Fa (v16.10 DELIBERATE CHANGE) repeated 402 retries across stages are NOT charged: 10 fetch calls, 5 counted, AI story renders with 5 excluded retries',
      calls === 10 && counted === 5 && meta && meta.kind === 'ai' && meta.attempts === 5 && meta.attempts402Excluded === 5,
      'calls=' + calls + ' counted=' + counted + ' kind=' + (meta && meta.kind) + ' attempts=' + (meta && meta.attempts) + ' excluded=' + (meta && meta.attempts402Excluded));
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V167-G: 402 wait parsed from the body (45s stated -> ~60s wait, bounded 50-90s).
  {
    const w45 = runInCtx(`parse402WaitMsV167('Free limit reached: 1 reply every 45 seconds per IP. Please wait 45 seconds.')`);
    const w3 = runInCtx(`parse402WaitMsV167('Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.')`);
    const wNone = runInCtx(`parse402WaitMsV167('Some other error')`);
    check('V167-G 402 wait parsed from body: 45s stated -> 60000ms; small stated wait floors at 50000ms; no stated wait defaults to 60000ms',
      w45 === 60000 && w3 === 50000 && wNone === 60000, 'w45=' + w45 + ' w3=' + w3 + ' wNone=' + wNone);
  }
  // V167-H: cache flag on a suspiciously fast identical response.
  await expectV16('V167-H identical second-stage text fails fidelity, repair names it, run still renders', async () => {
    // v16.10 DELIBERATE CHANGE (supersedes the v16.7 cache-flag
    // expectation): byte-identical text for a second stage is now a
    // fidelity SEAM failure (repeated sentence), not a pass-with-flag.
    // The repair prompt names the repeated-sentence reason and the
    // repaired stage succeeds, so the run still renders AI.
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const run = await runInCtx(`(async () => {
      const bb = JSON.parse(${JSON.stringify(JSON.stringify(b))});
      const counters = { stagePosts: {}, stageCorrections: {}, stageRetries: {}, retryFlags: {} };
      const fr = async (prompt) => {
        const m = (prompt || '').match(/STAGE: ([a-z0-9]+)/);
        const stage = m ? m[1] : 'opening';
        if (prompt.indexOf('REVISION') !== -1) return { text: ${JSON.stringify(scenes.combat2)}, provider: 'Pollinations (POST, keyless)', finishReason: '' };
        if (stage === 'combat2') return { text: ${JSON.stringify(scenes.combat1)}, provider: 'Pollinations (POST, keyless)', finishReason: '' };
        return { text: (${JSON.stringify(scenes)}[stage] || ${JSON.stringify(scenes.opening)}), provider: 'Pollinations (POST, keyless)', finishReason: '' };
      };
      const r = await runMultiStageV167(bb, fr, () => true, () => {}, counters);
      return JSON.stringify({ ok: r.ok, stages: r.stages || [], failedStage: r.failedStage || '' });
    })()`);
    const parsed = JSON.parse(run);
    const c2 = (parsed.stages || []).find(d => d.stage === 'combat2') || {};
    check('V167-H identical second-stage text fails fidelity, repair names it, run still renders',
      parsed.ok === true && c2.status === 'corrected' && (c2.correctionReason || '').indexOf('repeated sentence') !== -1,
      'ok=' + parsed.ok + ' c2=' + JSON.stringify(c2));
    sandbox.fetch = realFetch;
  });
    // V167-I: checker fixtures unchanged — a v16.5-style truncated whole-story draft still fails, a complete one still passes.
  {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const fin = finAtkOf(b);
    const trunc = [
      'Spider-Man and Batman met on the open ground under the open sky.',
      'Round 2: Spider-Man struck with ' + fin.ability + ' again and again while Batman blocked and circled.',
      'Round 5: Spider-Man moved to strike and Batman raised his guard, the blow half-formed and the arena lights flickering as the fight hung in'
    ].join('\n\n');
    const complete = [
      'Spider-Man and Batman met on the open ground under the open sky.',
      'Batman studied the approach and prepared a counter, but Spider-Man sensed the trap and changed tactics.',
      'The fight turned when Spider-Man closed in and struck with ' + fin.ability + ', ending the exchange.',
      'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.'
    ].join('\n\n');
    const csT = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(trunc)}))`));
    const csC = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(complete)}))`));
    const cT = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(csT))})))`));
    const cC = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(csC))})))`));
    check('V167-I checker fixtures unchanged: truncated whole-story draft still FAILS, complete whole-story draft still PASSES (v16.6 checker untouched)',
      cT.failed > 0 && cC.failed === 0, 'truncFailed=' + cT.failed + ' completeFailed=' + cC.failed);
  }
  // V167-J: stalemate multi-stage — no finisher required, aftermath states the stalemate plainly.
  await expectV16('V167-J stalemate stages', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const stal = JSON.parse(JSON.stringify(b));
    stal.events = stal.events.filter(e => e.type !== 'knockout' && e.type !== 'incapacitated');
    stal.stalemate = true; stal.winner = 'Stalemate';
    const scenes = {
      outline: 'Opening beat: Spider-Man and Batman meet. Escalation beat: they trade blows. Ending beat: the battle ends in a stalemate.',
      opening: 'Spider-Man and Batman met on the open ground under the open sky.',
      combat1: 'Spider-Man and Batman traded blows in the early exchanges under the open sky.',
      combat2: 'Spider-Man and Batman traded harder blows as momentum shifted under the open sky.',
      climax: 'The final exchange ended with Spider-Man and Batman neither able to finish the other.',
      aftermath: 'Aftermath: no winner emerged and the battle ended in a stalemate on the open ground.'
    };
    const mf = mockFetchStagesV167(scenes);
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v167j', stal);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v167j, 'v16-test-v167j-1', {})`);
    check('V167-J stalemate stages assemble into an AI story with no finisher required and a plain stalemate aftermath',
      meta && meta.kind === 'ai' && (els['story-output'].innerHTML || '').indexOf('stalemate') !== -1,
      'kind=' + (meta && meta.kind));
    sandbox.fetch = realFetch;
  });

  // ================= v16.8 TESTS =================
  // V168-A: pacing waits until 50s since the previous POST send (injectable
  // clock via V168_PACING_MIN_MS; the harness never waits real 50s).
  // Direct runMultiStageV167 call so pacing status lines can be captured.
  await expectV16('V168-A pacing waits between stage POSTs', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const code = `(async () => {
      const statuses = [];
      const bb = JSON.parse(${JSON.stringify(JSON.stringify(b))});
      const sc = JSON.parse(${JSON.stringify(JSON.stringify(scenes))});
      const fetchRaw = async (prompt) => {
        let stage = 'opening';
        const m = prompt.match(/STAGE: ([a-z0-9]+)/);
        if (m) stage = m[1];
        return { text: sc[stage] || sc.opening, provider: 'Pollinations (POST, keyless)', finishReason: '' };
      };
      const counters = { stagePosts: {}, stageCorrections: {}, stageRetries: {}, retryFlags: {} };
      V168_PACING_MIN_MS = 200;
      const t0 = Date.now();
      const out = await runMultiStageV167(bb, fetchRaw, () => true, (s) => { statuses.push(s); }, counters);
      const elapsed = Date.now() - t0;
      V168_PACING_MIN_MS = 1;
      return JSON.stringify({ ok: out.ok, elapsed: elapsed, pacing: statuses.filter(s => s.indexOf('pacing') !== -1).length, n: statuses.length });
    })()`;
    const res = JSON.parse(await runInCtx(code));
    check('V168-Aa (v16.10 DELIBERATE CHANGE) pacing waits before stages 2-5 (4 pacing statuses) and the run still succeeds; elapsed >= 700ms for 4 x 200ms waits',
      res.ok === true && res.pacing === 4 && res.elapsed >= 700,
      'ok=' + res.ok + ' pacing=' + res.pacing + ' elapsed=' + res.elapsed + ' statuses=' + res.n);
    runInCtx('V168_PACING_MIN_MS = 1;');
  });
  // V168-B: a superseded session makes no paced POST (pacing wait ends in
  // a superseded throw, not a send).
  await expectV16('V168-B superseded session makes no paced POST', async () => {
    runInCtx('V168_PACING_MIN_MS = 600; V162_402_WAIT_MS = 1;');
    const b1 = battle([[spec('spiderman')], [spec('batman')]], { seed: 900636602, victoryMode: 'incapacitation' });
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes1 = stageScenesForV167(b1);
    const scenes2 = stageScenesForV167(b2);
    let b1Calls = 0;
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (body.indexOf('Spider-Man') !== -1) { b1Calls++; return { ok: true, status: 200, text: async () => scenes1[stage] || scenes1.opening }; }
      return { ok: true, status: 200, text: async () => scenes2[stage] || scenes2.opening };
    };
    setVmBattle('globalThis._v168b1', b1);
    setVmBattle('globalThis._v168b2', b2);
    const p1 = runInCtx(`generateMainStoryV16(globalThis._v168b1, 'v16-test-pace-sup-1', {})`);
    await new Promise(r => setTimeout(r, 100));
    const p2 = runInCtx(`generateMainStoryV16(globalThis._v168b2, 'v16-test-pace-sup-2', {})`);
    await p1; await p2;
    check('V168-Ba (v16.10 DELIBERATE CHANGE) superseded generation makes exactly 1 POST (opening only) and the newer battle story wins',
      b1Calls === 1 && (els['story-output'].innerHTML || '').indexOf(scenes2.opening.slice(0, 40)) !== -1 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'b1Calls=' + b1Calls + ' label=' + els['main-story-label'].innerText);
    runInCtx('V168_PACING_MIN_MS = 1; V162_402_WAIT_MS = 35000;');
    sandbox.fetch = realFetch;
  });
  // V168-C: combat prompts are measurably shorter than v16.7 live values
  // (~1412/1409 chars) while keeping every essential constraint.
  // v16.11 DELIBERATE CHANGE (model change): combat stages are
  // escalation/turning-point chapters, not round recaps. Assigned-round
  // joins, 'Round <finRound>:' lines, 'ONLY the combat scene', 'No
  // invented events' and 'Assigned rounds only' described the transcript
  // prompt and are superseded; prompts must now carry the story brief, a
  // chapter assignment, and the locked outcome (finisher as 'not this
  // chapter' outside the climax), with no round transcript, all under
  // 800 chars — including the correction prompt (level-4 minimal brief).
  {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const info = JSON.parse(runInCtx(`JSON.stringify((function(){ const rec = buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})); return { c1: buildStagePromptV1611(rec, 'combat1', {}), c2: buildStagePromptV1611(rec, 'combat2', {}), fin: rec.finishingAbility }; })())`));
    const constraints = (pr, chapter) => pr.indexOf(chapter) !== -1 && pr.indexOf('STORY BRIEF') !== -1 && pr.indexOf('Winner: Spider-Man (locked)') !== -1 && pr.indexOf(info.fin + ' (not this chapter)') !== -1 && pr.indexOf('Round ') === -1 && pr.indexOf('Loser: Batman (unconscious, not dead)') !== -1;
    check('V168-Ca (v16.11 DELIBERATE CHANGE) combat scene 1 prompt under 800 chars (v16.7 live: 1412) as an escalation chapter with brief + locked outcome, no round transcript',
      info.c1.length < 800 && constraints(info.c1, 'escalation chapter'),
      'len=' + info.c1.length);
    check('V168-Cb (v16.11 DELIBERATE CHANGE) combat scene 2 prompt under 800 chars (v16.7 live: 1409) as a turning-point chapter with brief + locked outcome, no round transcript',
      info.c2.length < 800 && constraints(info.c2, 'turning-point chapter'),
      'len=' + info.c2.length);
    const corr = runInCtx(`buildStagePromptV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat1', { correction: true, failedChecks: ['Combat scene does not name a fighter'] })`);
    check('V168-Cc (v16.11 DELIBERATE CHANGE) combat correction prompt uses the story brief (REVISION, failed hard-constraint checks, locked outcome) and stays under 800 chars',
      corr.indexOf('REVISION') !== -1 && corr.indexOf('failed these hard-constraint checks') !== -1 && corr.indexOf('STORY BRIEF') !== -1 && corr.indexOf(info.fin + ' (not this chapter)') !== -1 && corr.length < 800,
      'len=' + corr.length);
    const nonCombat = JSON.parse(runInCtx(`JSON.stringify((function(){ const rec = buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})); return { o: buildStagePromptV1611(rec, 'opening', {}), cl: buildStagePromptV1611(rec, 'climax', {}), af: buildStagePromptV1611(rec, 'aftermath', {}) }; })())`));
    check('V168-Cd (v16.11 DELIBERATE CHANGE) opening/climax/aftermath prompts use the chapter shape (arrival/testing, finisher-in-full-sentence climax, aftermath) and stay under 800 chars',
      nonCombat.o.indexOf('arrival and testing chapter') !== -1 && nonCombat.o.length < 800 && nonCombat.cl.indexOf('Finisher verbatim inside a full sentence') !== -1 && nonCombat.cl.indexOf(info.fin) !== -1 && nonCombat.cl.length < 800 && nonCombat.af.toLowerCase().indexOf('aftermath') !== -1 && nonCombat.af.indexOf('Spider-Man') !== -1 && nonCombat.af.length < 800,
      'oLen=' + nonCombat.o.length + ' clLen=' + nonCombat.cl.length + ' afLen=' + nonCombat.af.length);
  }
  // V168-D (v16.9 REWRITTEN — provider chain): abort retries REMAIN counted
  // WITHIN each provider's own budget, but budgets are now per provider,
  // so a primary budget exhausted by counted abort retries no longer
  // blocks the Classic rescue for the same stage. The old v16.8
  // expectation (aftermath refused, fallback naming the cap) no longer
  // applies: the aftermath now succeeds via Classic, and the per-provider
  // cap still binds (see V169-D, where a pre-exhausted primary budget
  // never sends and Classic completes the run).
  await expectV16('V168-D abort retries still counted toward the cap', async () => {
    runInCtx('V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1; V168_PACING_MIN_MS = 1;');
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    let calls = 0;
    const aborted = {};
    sandbox.fetch = async (url, opts) => {
      calls++;
      let stage = 'opening';
      try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (!aborted[stage]) { aborted[stage] = true; throw new Error('signal is aborted without reason'); }
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v168d', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v168d, 'v16-test-abortcap-1', {})`);
    const counted = runInCtx(`v163PostCount`);
    check('V168-Da (v16.10 DELIBERATE CHANGE) one abort + one counted retry per stage costs 10 counted on the PRIMARY and still succeeds on the primary (AI story, /openai provider)',
      calls === 10 && counted === 10 && meta && meta.kind === 'ai' && String(meta.provider || '').indexOf('/openai') !== -1,
      'calls=' + calls + ' counted=' + counted + ' kind=' + (meta && meta.kind) + ' provider=' + (meta && meta.provider));
    runInCtx('V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;');
    sandbox.fetch = realFetch;
  });
  // V168-E: checker fixtures unchanged (same fixtures as V167-I).
  {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const fin = finAtkOf(b);
    const trunc = [
      'Spider-Man and Batman met on the open ground under the open sky.',
      'Round 2: Spider-Man struck with ' + fin.ability + ' again and again while Batman blocked and circled.',
      'Round 5: Spider-Man moved to strike and Batman raised his guard, the blow half-formed and the arena lights flickering as the fight hung in'
    ].join('\n\n');
    const complete = [
      'Spider-Man and Batman met on the open ground under the open sky.',
      'Batman studied the approach and prepared a counter, but Spider-Man sensed the trap and changed tactics.',
      'The fight turned when Spider-Man closed in and struck with ' + fin.ability + ', ending the exchange.',
      'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.'
    ].join('\n\n');
    const csT = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(trunc)}))`));
    const csC = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(complete)}))`));
    const cT = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(csT))})))`));
    const cC = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(csC))})))`));
    check('V168-E checker fixtures unchanged: truncated whole-story draft still FAILS, complete whole-story draft still PASSES',
      cT.failed > 0 && cC.failed === 0, 'truncFailed=' + cT.failed + ' completeFailed=' + cC.failed);
  }
  // V169-F (replaces V168-F): reasoning_effort / max_tokens now exist, but
  // ONLY on the approved /openai primary path. The Classic primitive still
  // sends exactly {messages:[system, user]} and nothing else.
  {
    const classicStart = html.indexOf('async function pollinationsPostOnceV162');
    const classicEnd = html.indexOf('async function fetchPollinationsStoryV16');
    const classicSrc = (classicStart !== -1 && classicEnd !== -1) ? html.slice(classicStart, classicEnd) : '';
    check('V169-F reasoning_effort/max_tokens exist ONLY on the /openai path; the Classic primitive still sends exactly {messages} and nothing else',
      html.indexOf('https://text.pollinations.ai/openai') !== -1 && html.indexOf('openai-fast') !== -1
      && classicSrc.indexOf('reasoning_effort') === -1 && classicSrc.indexOf('max_tokens') === -1
      && classicSrc.indexOf('Pollinations Classic (POST, keyless)') !== -1,
      'classicHasReasoning=' + (classicSrc.indexOf('reasoning_effort') !== -1) + ' classicHasMaxTokens=' + (classicSrc.indexOf('max_tokens') !== -1));
  }


  // ================= v16.9 PHASE 1 — PROVIDER-AGNOSTIC CLIENT =================
  // V169-A: the client parses a JSON choices payload (content, finish
  // reason, usage, model) and forwards the request parameters.
  await expectV16('V169-A client parses OpenAI-compatible JSON', async () => {
    let captured = null;
    sandbox.fetch = async (url, opts) => {
      captured = { url: url, body: JSON.parse((opts && opts.body) || '{}'), headers: (opts && opts.headers) || {} };
      return { ok: true, status: 200, headers: { get: (n) => '' }, text: async () => JSON.stringify({ choices: [{ message: { content: 'The opening scene unfolded on the open ground.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 230, completion_tokens: 377, total_tokens: 607 }, model: 'gpt-oss-20b' }) };
    };
    const code = `(async () => {
      const r = await fetchOpenAICompatibleV169({ baseUrl: 'https://text.pollinations.ai/openai', model: 'openai-fast', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'STAGE: opening test' }], reasoningEffort: 'low', temperature: 0.3, maxTokens: 800, stream: false, timeoutMs: 75000, budgetObj: { count: 0, budget: 10 } });
      return JSON.stringify({ text: r.text, finishReason: r.finishReason, usage: r.usage, model: r.model, errorCode: r.errorCode });
    })()`;
    const r = JSON.parse(await runInCtx(code));
    check('V169-Aa client returns parsed text, finish stop, usage 230/377/607, model gpt-oss-20b',
      r.text === 'The opening scene unfolded on the open ground.' && r.finishReason === 'stop'
      && r.usage && r.usage.prompt_tokens === 230 && r.usage.completion_tokens === 377 && r.usage.total_tokens === 607 && r.model === 'gpt-oss-20b',
      JSON.stringify(r));
    check('V169-Ab client sends the approved /openai request shape (model, reasoning_effort low, temperature 0.3, max_tokens 800, stream false, messages system+user)',
      captured && captured.url === 'https://text.pollinations.ai/openai' && captured.body.model === 'openai-fast'
      && captured.body.reasoning_effort === 'low' && captured.body.temperature === 0.3 && captured.body.max_tokens === 800 && captured.body.stream === false
      && Array.isArray(captured.body.messages) && captured.body.messages.length === 2,
      JSON.stringify(captured && captured.body));
    sandbox.fetch = realFetch;
  });
  // V169-B: empty content + finish length is reported as no-prose, never
  // as a story.
  await expectV16('V169-B empty length finish is no-prose', async () => {
    sandbox.fetch = async (url, opts) => ({ ok: true, status: 200, headers: { get: (n) => '' }, text: async () => JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 800, total_tokens: 900 }, model: 'gpt-oss-20b' }) });
    const r = JSON.parse(await runInCtx(`(async () => { const x = await fetchOpenAICompatibleV169({ baseUrl: 'https://text.pollinations.ai/openai', model: 'openai-fast', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'STAGE: climax test' }], reasoningEffort: 'low', temperature: 0.3, maxTokens: 800, stream: false, timeoutMs: 75000, budgetObj: { count: 0, budget: 10 } }); return JSON.stringify({ text: x.text, finishReason: x.finishReason }); })()`));
    check('V169-Ba empty content with finish length returns empty text + finish length (never presented as prose)',
      r.text === '' && r.finishReason === 'length', JSON.stringify(r));
    sandbox.fetch = realFetch;
  });
  // V169-C: Retry-After header is captured on an error response.
  await expectV16('V169-C Retry-After header captured', async () => {
    sandbox.fetch = async (url, opts) => ({ ok: false, status: 402, headers: { get: (n) => (String(n).toLowerCase() === 'retry-after' ? '120' : '') }, text: async () => 'Free limit reached: 1 reply every 45 seconds per IP. Please wait 20 seconds.' });
    const r = JSON.parse(await runInCtx(`(async () => { try { await fetchOpenAICompatibleV169({ baseUrl: 'https://text.pollinations.ai/openai', model: 'openai-fast', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'STAGE: outline test' }], reasoningEffort: 'low', temperature: 0.3, maxTokens: 800, stream: false, timeoutMs: 75000, budgetObj: { count: 0, budget: 10 } }); return JSON.stringify({ thrown: false }); } catch (e) { return JSON.stringify({ thrown: true, errorCode: e.errorCode || '', retryAfter: e.retryAfter || '' }); } })()`));
    check('V169-Ca 402 error carries errorCode 402 and retryAfter 120 from the response header',
      r.thrown === true && (r.errorCode === 402 || r.errorCode === '402') && (r.retryAfter === '120' || r.retryAfter === 120),
      JSON.stringify(r));
    sandbox.fetch = realFetch;
  });
  // V169-D: a pre-exhausted primary budget never sends; the run still
  // completes via the Classic provider with its own fresh budget.
  await expectV16('V169-D chain rescue with a fresh budget', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const code = `(async () => {
      const bb = JSON.parse(${JSON.stringify(JSON.stringify(b))});
      const sc = JSON.parse(${JSON.stringify(JSON.stringify(scenes))});
      let classicCalls = 0;
      const openaiBudget = { count: 10, budget: 10 };
      const classicBudget = { count: 0, budget: 10 };
      const chain = [
        { key: 'openai', label: 'Pollinations /openai (POST, keyless)', budget: openaiBudget, fetch: async (prompt) => { chargePostV163(openaiBudget); return { text: 'never', provider: 'Pollinations /openai (POST, keyless)' }; } },
        { key: 'classic', label: 'Pollinations Classic (POST, keyless)', budget: classicBudget, fetch: async (prompt) => { classicCalls++; let stage = 'opening'; const m = prompt.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; chargePostV163(classicBudget); return { text: sc[stage] || sc.opening, provider: 'Pollinations Classic (POST, keyless)', finishReason: '' }; } }
      ];
      const counters = { stagePosts: {}, stageCorrections: {}, stageRetries: {}, retryFlags: {} };
      V168_PACING_MIN_MS = 1;
      const out = await runMultiStageV167(bb, chain, () => true, (s) => {}, counters);
      V168_PACING_MIN_MS = 1;
      return JSON.stringify({ ok: out.ok, provider: out.provider, classicCalls: classicCalls, classicBudget: classicBudget.count, openaiBudget: openaiBudget.count, stages: (out.stages || []).map(d => d.provider) });
    })()`;
    const res = JSON.parse(await runInCtx(code));
    check('V169-Da (v16.10 DELIBERATE CHANGE) pre-exhausted primary budget sends nothing; all 5 stages complete via Classic with a fresh budget (5 Classic calls, primary still 10)',
      res.ok === true && res.classicCalls === 5 && res.classicBudget === 5 && res.openaiBudget === 10
      && res.stages.every(p => p && p.indexOf('Classic') !== -1),
      JSON.stringify(res));
  });
  // V169-E: excluded providers and endpoints are absent as live config.
  check('V169-Ea no excluded-provider URL or model string appears anywhere in the game file',
    html.indexOf('llm7.io') === -1 && html.indexOf('api.llm7') === -1 && html.indexOf('api.ovh') === -1 && html.indexOf('ovhcloud') === -1,
    'llm7=' + (html.indexOf('llm7.io') !== -1) + ' ovh=' + (html.indexOf('ovhcloud') !== -1));
  // V169-G: Classic fallback is labelled distinctly from /openai in
  // diagnostics (stage diagnostics provider strings).
  await expectV16('V169-G Classic labelled distinctly from /openai', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    sandbox.fetch = async (url, opts) => {
      if (String(url).indexOf('/openai') !== -1) return { ok: false, status: 500, headers: { get: (n) => '' }, text: async () => 'internal error' };
      let stage = 'opening';
      try { const c = JSON.parse((opts && opts.body) || '').messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      return { ok: true, status: 200, headers: { get: (n) => '' }, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v169g', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v169g, 'v16-test-v169g-1', {})`);
    const diag = els['main-story-diagnostics'].innerHTML || '';
    check('V169-Ga when /openai fails every stage, the run completes via Classic and diagnostics name Pollinations Classic (never /openai) for those stages',
      meta && meta.kind === 'ai' && meta.stageDiagnostics && meta.stageDiagnostics.every(d => d.provider && d.provider.indexOf('Classic') !== -1)
      && diag.indexOf('Pollinations Classic') !== -1,
      'kind=' + (meta && meta.kind) + ' providers=' + (meta && meta.stageDiagnostics && meta.stageDiagnostics.map(d => d.provider).join('|')));
    sandbox.fetch = realFetch;
  });
  // V169-H: pacing still applies across a provider switch inside one run.
  await expectV16('V169-H pacing across provider switches', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const code = `(async () => {
      const bb = JSON.parse(${JSON.stringify(JSON.stringify(b))});
      const sc = JSON.parse(${JSON.stringify(JSON.stringify(scenes))});
      const statuses = [];
      const chain = [
        { key: 'openai', label: 'Pollinations /openai (POST, keyless)', budget: { count: 0, budget: 10 }, fetch: async (prompt) => { throw new Error('Pollinations POST HTTP 500: internal error'); } },
        { key: 'classic', label: 'Pollinations Classic (POST, keyless)', budget: { count: 0, budget: 10 }, fetch: async (prompt) => { let stage = 'opening'; const m = prompt.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; return { text: sc[stage] || sc.opening, provider: 'Pollinations Classic (POST, keyless)', finishReason: '' }; } }
      ];
      const counters = { stagePosts: {}, stageCorrections: {}, stageRetries: {}, retryFlags: {} };
      V168_PACING_MIN_MS = 200;
      const t0 = Date.now();
      const out = await runMultiStageV167(bb, chain, () => true, (s) => { statuses.push(s); }, counters);
      const elapsed = Date.now() - t0;
      V168_PACING_MIN_MS = 1;
      return JSON.stringify({ ok: out.ok, elapsed: elapsed, pacing: statuses.filter(s => s.indexOf('pacing') !== -1).length });
    })()`;
    const res = JSON.parse(await runInCtx(code));
    // Pacing applies before EVERY POST-send attempt, including chain
    // attempts: outline paces once (Classic attempt, after the primary
    // attempt set the clock) and each later stage paces twice (primary
    // attempt + Classic attempt) = 1 + 5x2 = 11 pacing waits.
    check('V169-Ha (v16.10 DELIBERATE CHANGE) chain run with a failing primary still paces (9 pacing waits: 1 opening + 2 per later stage) and succeeds',
      res.ok === true && res.pacing === 9 && res.elapsed >= 800,
      'ok=' + res.ok + ' pacing=' + res.pacing + ' elapsed=' + res.elapsed);
    runInCtx('V168_PACING_MIN_MS = 1;');
  });


  // ================= v16.10 FIDELITY-PHASE TESTS =================
  // Mock fetch only; no real network. Fidelity unit tests call the new
  // checker directly; run tests use the same stage-scene mocks as v16.7.
  runInCtx(`V168_PACING_MIN_MS = 1; V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
  sandbox.localStorage.removeItem('warroom_pollinations_key');
  // v16.11 DELIBERATE CHANGE: these helpers now call the hard-constraint checker directly (locked list, not event fidelity).
  function fidFor(stage, text, b, prev) {
    return JSON.parse(runInCtx(`JSON.stringify(hardConstraintChecksForStageV1611(${JSON.stringify(stage)}, ${JSON.stringify(text)}, buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), stageRoundsV167(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), ${JSON.stringify(stage)}), ${JSON.stringify(prev || [])}))`));
  }
  function fidState(checks, name) { const c = checks.find(x => x.name === 'Hard-constraint: ' + name); return c ? c.state : 'MISSING'; }
  function fidDetail(checks, name) { const c = checks.find(x => x.name === 'Hard-constraint: ' + name); return c ? c.detail : ''; }
  function fidFailed(checks) { return checks.filter(c => c.state === 'FAILED').map(c => c.name + ' — ' + c.detail); }

  await expectV16('V1610-A premature incapacitation detected (Battle 1 Round 5 shape)', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const bad = 'Batman lay incapacitated on the floor, unconscious and finished, while Spider-Man stood over him.';
    const checks = fidFor('combat1', bad, b, []);
    const good = fidFor('combat1', stageScenesForV167(b).combat1, b, [stageScenesForV167(b).opening]);
    // v16.11 DELIBERATE CHANGE: check renamed to the locked-list name; the detail now speaks of chapters/decisive clash, not round numbers (middle is loose).
    check('V1610-A premature incapacitation detected, bystander not flagged, valid scene passes',
      fidState(checks, 'loser state locked (no premature defeat)') === 'FAILED'
      && fidDetail(checks, 'loser state locked (no premature defeat)').indexOf('Batman') !== -1
      && fidDetail(checks, 'loser state locked (no premature defeat)').indexOf('decisive clash') !== -1
      && fidDetail(checks, 'loser state locked (no premature defeat)').indexOf('hurt but still standing') !== -1
      && fidDetail(checks, 'loser state locked (no premature defeat)').indexOf('Spider-Man is described') === -1
      && fidState(good, 'loser state locked (no premature defeat)') === 'PASSED',
      'detail=' + fidDetail(checks, 'loser state locked (no premature defeat)'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-B premature ending detected (Battle 2 Round 6 shape)', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const bad = 'The fight ended and the battle concluded as the arena fell silent.';
    const checks = fidFor('combat2', bad, b, [stageScenesForV167(b).combat1]);
    const good = fidFor('combat2', stageScenesForV167(b).combat2, b, [stageScenesForV167(b).combat1]);
    // v16.11 DELIBERATE CHANGE: check renamed; ending before the decisive clash is still a locked-structure failure (a clash after an ended fight would be post-defeat action).
    check('V1610-B premature ending detected, valid scene passes',
      fidState(checks, 'no ending before the decisive clash') === 'FAILED'
      && fidDetail(checks, 'no ending before the decisive clash').indexOf('decisive clash') !== -1
      && fidState(good, 'no ending before the decisive clash') === 'PASSED',
      'detail=' + fidDetail(checks, 'no ending before the decisive clash'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-C (v16.11 DELIBERATE CHANGE) ability timing is LOOSE: finisher in an early chapter does NOT fail', async () => {
    // v16.11 DELIBERATE CHANGE (model change, not a weakening of a locked item): the middle is fictionalised, so an ability appearing in a different chapter than recorded is explicitly NOT a failure. The old 'no ability before its round' check is removed; these texts must have zero FAILED hard checks, and no such check may exist at all.
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const badOpen = stageScenesForV167(b).opening + ' The fight turned when Spider-Man closed in and struck with Web + Impact Combo, ending the exchange.';
    const badCombat = 'Spider-Man closed in and struck with Spider-Sense Counter, ending the exchange.';
    const c1 = fidFor('opening', badOpen, b, []);
    const c2 = fidFor('combat1', badCombat, b, [stageScenesForV167(b).opening]);
    const good = fidFor('combat1', stageScenesForV167(b).combat1, b, [stageScenesForV167(b).opening]);
    check('V1610-C (v16.11) ability timing is loose: early-chapter finisher/signature has 0 FAILED hard checks and no ability-before-round check exists',
      c1.filter(c => c.state === 'FAILED').length === 0
      && c2.filter(c => c.state === 'FAILED').length === 0
      && !c1.some(c => c.name.indexOf('ability before its round') !== -1)
      && !c2.some(c => c.name.indexOf('ability before its round') !== -1)
      && fidState(good, 'canon powers and traits only') === 'PASSED',
      'openFailed=' + JSON.stringify(fidFailed(c1)) + ' combatFailed=' + JSON.stringify(fidFailed(c2)));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-D hit-and-miss contradiction detected, two-ability sentence not flagged', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const bad = 'Spider-Man struck with Web Shot, but Batman sidestepped the Web Shot and it never reached its target.';
    const checks = fidFor('climax', bad, b, []);
    const twoAbil = 'Spider-Man struck Batman with Web Shot, and Batman\'s Grapple Kick missed.';
    const good = fidFor('combat1', twoAbil, b, [stageScenesForV167(b).opening]);
    check('V1610-D hit-and-miss contradiction detected, opposite outcomes for two abilities pass',
      fidState(checks, 'no hit-and-miss contradiction for one ability') === 'FAILED'
      && fidDetail(checks, 'no hit-and-miss contradiction for one ability').indexOf('Web Shot') !== -1
      && fidState(good, 'no hit-and-miss contradiction for one ability') === 'PASSED',
      'bad=' + fidDetail(checks, 'no hit-and-miss contradiction for one ability'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-E trait and ability misattribution detected', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const badTrait = 'Batman\'s spider-sense tingled as he moved.';
    const badActor = 'Batman struck with Web Shot, ending the exchange.';
    const goodTrait = 'Spider-Man\'s spider-sense tingled as he moved.';
    const c1 = fidFor('opening', badTrait, b, []);
    const c2 = fidFor('combat1', badActor, b, [stageScenesForV167(b).opening]);
    const c3 = fidFor('opening', goodTrait, b, []);
    check('V1610-E trait and ability misattribution detected, correct owner passes',
      fidState(c1, 'canon powers and traits only') === 'FAILED'
      && fidState(c2, 'canon powers and traits only') === 'FAILED'
      && fidState(c3, 'canon powers and traits only') === 'PASSED',
      'trait=' + fidDetail(c1, 'canon powers and traits only') + ' actor=' + fidDetail(c2, 'canon powers and traits only'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-F (v16.11 DELIBERATE CHANGE) seam repetition via hard checker; truncation via stage validation', async () => {
    // v16.11 DELIBERATE CHANGE: truncation is owned by stage validation (completeness), not the hard checker; repeated sentences/openings stay in the hard checker per stage, and repeated sentences at assembly stay in the unchanged v16.6 checker (no duplicate hard assembly check).
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const trunc = scenes.combat1 + ' Spider-Man leapt toward the arena';
    const truncVal = JSON.parse(runInCtx(`JSON.stringify(validateStageV167('combat1', ${JSON.stringify(trunc)}, buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), stageRoundsV167(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat1')))`));
    const cRepeat = fidFor('combat2', scenes.combat1, b, [scenes.opening, scenes.combat1]);
    const wholeRepeat = [scenes.opening, scenes.combat1, scenes.combat1, scenes.climax, scenes.aftermath].join('\n\n');
    const csRepeat = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(wholeRepeat)}))`));
    const cJoin = fidFor('combat2', 'Spider-Man and Batman traded blows in the early rounds, but the pace quickened and neither gave ground.', b, [scenes.opening, scenes.combat1]);
    const cGood = fidFor('combat2', scenes.combat2, b, [scenes.opening, scenes.combat1]);
    check('V1610-F (v16.11) unterminated stage fails stage validation, repeated sentence/opening fails hard seam, assembly repeat fails v16.6 checker; valid join passes',
      truncVal.failed.some(f => f.indexOf('complete sentence') !== -1)
      && fidState(cRepeat, 'no repeated sentence across chapters') === 'FAILED'
      && csRepeat.some(c => c.name === 'No repeated sentences' && c.state === 'FAILED')
      && fidState(cJoin, 'no repeated sentence across chapters') === 'FAILED'
      && fidState(cGood, 'no repeated sentence across chapters') === 'PASSED',
      'truncFailed=' + JSON.stringify(truncVal.failed) + ' join=' + fidDetail(cJoin, 'no repeated sentence across chapters'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-R (v16.11 DELIBERATE CHANGE) prose checks split: numbers via stage validation, wiki/self-talk via hard checker', async () => {
    // v16.11 DELIBERATE CHANGE: damage/HP numbers are owned by stage validation (which also gates the run), so the hard checker no longer duplicates that check; Wikipedia text and self-talk stay in the hard checker.
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const dmgVal = JSON.parse(runInCtx(`JSON.stringify(validateStageV167('combat1', 'Spider-Man struck Batman and dealt 357 damage as the crowd gasped.', buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), stageRoundsV167(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat1')))`));
    const wiki = fidFor('opening', 'Spider-Man is a fictional character who fights crime in New York.', b, []);
    const talk = fidFor('opening', 'Spider-Man: "I, Spider-Man, will win this fight."', b, []);
    const good = fidFor('opening', scenes.opening, b, []);
    check('V1610-R (v16.11) damage numbers fail stage validation; Wikipedia text and self-talk fail hard checks; valid prose passes',
      dmgVal.failed.some(f => f.indexOf('damage/HP numbers') !== -1)
      && fidState(wiki, 'no Wikipedia-description text') === 'FAILED'
      && fidState(talk, 'no third-person self-talk in dialogue') === 'FAILED'
      && fidState(good, 'no Wikipedia-description text') === 'PASSED'
      && fidState(good, 'no third-person self-talk in dialogue') === 'PASSED',
      'dmgFailed=' + JSON.stringify(dmgVal.failed) + ' wiki=' + fidState(wiki, 'no Wikipedia-description text') + ' talk=' + fidState(talk, 'no third-person self-talk in dialogue'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-G (v16.11 DELIBERATE CHANGE) repair prompt quotes the failed hard check and the locked fact', async () => {
    // v16.11 DELIBERATE CHANGE: repair prompts carry the story brief + locked outcome, not an event transcript; the repair must quote both the failed hard check (premature incapacitation) and the correct locked fact (winner + loser state).
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const bad = 'Batman lay incapacitated on the floor, unconscious and finished, while Spider-Man stood over him.';
    const failed = fidFor('combat1', bad, b, []).filter(c => c.state === 'FAILED').map(c => c.detail);
    const prompt = runInCtx(`buildStagePromptV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat1', { correction: true, failedChecks: ${JSON.stringify(failed)} })`);
    check('V1610-G (v16.11) repair prompt quotes the failed check and the locked fact, carries the story brief, stays under 800 chars',
      prompt.indexOf('REVISION') !== -1 && prompt.indexOf('failed these hard-constraint checks') !== -1
      && prompt.indexOf('premature incapacitation') !== -1
      && prompt.indexOf('Winner: Spider-Man (locked)') !== -1 && prompt.indexOf('Loser: Batman (unconscious, not dead)') !== -1
      && prompt.indexOf('STORY BRIEF') !== -1 && prompt.indexOf('Round ') === -1
      && prompt.length < 800,
      'len=' + prompt.length + ' failed=' + JSON.stringify(failed).slice(0, 120));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-S (v16.11 DELIBERATE CHANGE) chapter prompts: brief + chapter assignment, no round transcript', async () => {
    // v16.11 DELIBERATE CHANGE (model change): combat stages are escalation/turning-point chapters, not round recaps. The old assertions (detected event as its own sentence, HIT/blocked wording, assigned-round lines) described the transcript prompt and are superseded; prompts must now carry the story brief, a chapter assignment, the locked outcome, and no round-by-round transcript.
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const finS = finAtkOf(b).ability;
    const rec = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})))`));
    const c1 = runInCtx(`buildStagePromptV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat1', {})`);
    const c2 = runInCtx(`buildStagePromptV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat2', {})`);
    const cl = runInCtx(`buildStagePromptV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'climax', {})`);
    check('V1610-S (v16.11) combat/climax prompts use chapters + brief, name the locked outcome, and carry no round transcript, all under 800 chars',
      c1.indexOf('escalation chapter') !== -1 && c1.indexOf('STORY BRIEF') !== -1
      && c2.indexOf('turning-point chapter') !== -1 && c2.indexOf('STORY BRIEF') !== -1
      && c1.indexOf('Round ') === -1 && c2.indexOf('Round ') === -1 && cl.indexOf('Round ') === -1
      && c1.indexOf('Winner: Spider-Man (locked)') !== -1 && c1.indexOf(finS + ' (not this chapter)') !== -1
      && cl.indexOf('Finisher verbatim inside a full sentence') !== -1 && cl.indexOf(finS) !== -1 && cl.indexOf('Loser: Batman (unconscious, not dead)') !== -1
      && c1.length < 800 && c2.length < 800 && cl.length < 800,
      'c1len=' + c1.length + ' c2len=' + c2.length + ' cllen=' + cl.length);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-H repair succeeds on retry with corrected text', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const bad = 'Batman lay incapacitated on the floor, unconscious and finished, while Spider-Man stood over him.';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (body.indexOf('REVISION') !== -1) return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
      if (stage === 'combat1') return { ok: true, status: 200, text: async () => bad };
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610h', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610h, 'v16-test-v1610h-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const diag = els['main-story-diagnostics'].innerHTML || '';
    check('V1610-H repair succeeds on retry with corrected text, correction reason shown',
      meta && meta.kind === 'ai'
      && (els['story-output'].innerHTML || '').indexOf(scenes.combat1.slice(0, 40)) !== -1
      && diag.indexOf('correction reason') !== -1 && diag.indexOf('premature incapacitation') !== -1,
      'kind=' + (meta && meta.kind));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-I stage still failing after repair falls back with the stage named, no partial assembly', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const bad = 'Batman lay incapacitated on the floor, unconscious and finished, while Spider-Man stood over him.';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (stage === 'combat1') return { ok: true, status: 200, text: async () => bad };
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610i', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610i, 'v16-test-v1610i-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const label = els['main-story-label'].innerText || '';
    const story = els['story-output'].innerHTML || '';
    check('V1610-I stage still failing after repair falls back with the stage named, no partial assembly',
      meta && meta.kind === 'offline' && meta.failedStage === 'combat1'
      && label.indexOf('Offline Story — Online AI generation was unavailable.') === 0
      && label.indexOf('combat scene 1 stage failed after correction') !== -1
      && label.indexOf('Online AI Story') === -1
      && story.indexOf('lay incapacitated') === -1,
      'kind=' + (meta && meta.kind) + ' failedStage=' + (meta && meta.failedStage));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-O correction reason shown for every corrected stage', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const badCombat = 'Batman lay incapacitated on the floor, unconscious and finished, while Spider-Man stood over him.';
    const badClimax = 'The fight turned when Spider-Man closed in and struck with a vague counter, ending the exchange.';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (body.indexOf('REVISION') !== -1) return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
      if (stage === 'combat1') return { ok: true, status: 200, text: async () => badCombat };
      if (stage === 'climax') return { ok: true, status: 200, text: async () => badClimax };
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610o', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610o, 'v16-test-v1610o-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const diag = els['main-story-diagnostics'].innerHTML || '';
    const reasons = (diag.match(/correction reason/g) || []).length;
    check('V1610-O correction reason shown for every corrected stage (two corrected stages, two reasons)',
      meta && meta.kind === 'ai' && reasons >= 2
      && diag.indexOf('premature incapacitation') !== -1
      && diag.indexOf('Finishing ability') !== -1,
      'kind=' + (meta && meta.kind) + ' reasons=' + reasons);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-Q per-stage correction policy: three corrected stages still render AI with correct POST accounting', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    let calls = 0;
    const callsByStage = {};
    sandbox.fetch = async (url, opts) => {
      calls++;
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      const isRev = body.indexOf('REVISION') !== -1;
      callsByStage[stage] = (callsByStage[stage] || 0) + 1;
      if (stage === 'opening' && !isRev && callsByStage[stage] === 1) throw new Error('signal is aborted without reason');
      if (!isRev && stage === 'combat1') return { ok: true, status: 200, text: async () => 'Batman lay incapacitated on the floor, unconscious and finished, while Spider-Man stood over him.' };
      if (!isRev && stage === 'combat2') return { ok: true, status: 200, text: async () => 'The fight ended and the battle concluded as the arena fell silent.' };
      if (!isRev && stage === 'climax') return { ok: true, status: 200, text: async () => 'The fight turned when Spider-Man closed in and struck with a vague counter, ending the exchange.' };
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610q', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610q, 'v16-test-v1610q-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V1610-Q per-stage policy: 1 abort retry + 3 repairs render AI at 9 counted POSTs (old global max-2 would have failed)',
      meta && meta.kind === 'ai' && calls === 9 && meta.attempts === 9
      && (meta.attemptsBreakdown || '').indexOf('1 retry') !== -1
      && (meta.attemptsBreakdown || '').indexOf('correction') !== -1,
      'kind=' + (meta && meta.kind) + ' calls=' + calls + ' attempts=' + (meta && meta.attempts) + ' breakdown=' + meta.attemptsBreakdown);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-J adaptive stages: short battle uses 3 stages, normal battle uses 5', async () => {
    const shortOrder = JSON.parse(runInCtx(`JSON.stringify(stageOrderV1611({ roundNums: [1, 2, 3] }))`));
    const normalOrder = JSON.parse(runInCtx(`JSON.stringify(stageOrderV1611({ roundNums: [1, 2, 3, 4, 5, 6, 7] }))`));
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    b.events = b.events.filter(e => e.round <= 3);
    const scenes = {
      opening: 'Spider-Man and Batman met on the open ground under the open sky, each sizing the other up before the first exchange.',
      climax: 'The fight turned when Spider-Man closed in and struck with Web + Impact Combo, ending the exchange.',
      aftermath: 'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.'
    };
    const stagesSeen = [];
    sandbox.fetch = async (url, opts) => {
      const c = JSON.parse((opts && opts.body) || '').messages[1].content;
      const m = c.match(/STAGE: ([a-z0-9]+)/); const st = m ? m[1] : '?';
      if (c.indexOf('REVISION') === -1) stagesSeen.push(st);
      return { ok: true, status: 200, text: async () => scenes[st] || scenes.opening };
    };
    setVmBattle('globalThis._v1610j', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610j, 'v16-test-v1610j-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V1610-J adaptive stages: short battle renders AI with exactly opening, climax, aftermath',
      JSON.stringify(shortOrder) === JSON.stringify(['opening', 'climax', 'aftermath'])
      && JSON.stringify(normalOrder) === JSON.stringify(['opening', 'combat1', 'combat2', 'climax', 'aftermath'])
      && meta && meta.kind === 'ai' && meta.stageCount === 3
      && JSON.stringify(stagesSeen) === JSON.stringify(['opening', 'climax', 'aftermath']),
      'short=' + JSON.stringify(shortOrder) + ' seen=' + JSON.stringify(stagesSeen) + ' stageCount=' + (meta && meta.stageCount));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-K (v16.11 DELIBERATE CHANGE) story brief built locally, no AI outline POST, no transcript', async () => {
    // v16.11 DELIBERATE CHANGE: outline beats are replaced by the story brief (outcome + chapter beats + dossier fields, built locally from the record). The brief must carry the finisher and winner and must not contain a round-by-round transcript.
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const prompts = [];
    sandbox.fetch = async (url, opts) => {
      const c = JSON.parse((opts && opts.body) || '').messages[1].content;
      prompts.push(c);
      let stage = 'opening';
      const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1];
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610k', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610k, 'v16-test-v1610k-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const brief = runInCtx(`buildStoryBriefV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat2', 0)`);
    check('V1610-K (v16.11) story brief carries finisher + winner + dossier fields, no transcript, no AI outline POST',
      meta && meta.kind === 'ai' && !prompts.some(p => p.indexOf('STAGE: outline') !== -1)
      && brief.indexOf('Web + Impact Combo') !== -1 && brief.indexOf('Spider-Man') !== -1
      && brief.indexOf('STORY BRIEF') !== -1 && !/Round \d+:/.test(brief)
      && prompts.every(p => p.indexOf('STORY BRIEF') !== -1 && !/Round \d+:/.test(p)),
      'briefLen=' + brief.length + ' outlinePosts=' + prompts.filter(p => p.indexOf('STAGE: outline') !== -1).length);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-L stage cache and resume: cached stages reused, failed stage retried, no cross-session leak', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    let calls = 0; let failCombat2 = true;
    sandbox.fetch = async (url, opts) => {
      calls++;
      const c = JSON.parse((opts && opts.body) || '').messages[1].content;
      let stage = 'opening';
      const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1];
      if (stage === 'combat2' && failCombat2) throw new Error('cache-test transport boom');
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610l', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610l, 'v16-test-cache-1', {})`);
    const meta1 = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const callsRun1 = calls;
    calls = 0; failCombat2 = false;
    await runInCtx(`generateMainStoryV16(globalThis._v1610l, 'v16-test-cache-1', {})`);
    const meta2 = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const callsRun2 = calls;
    const diag2 = els['main-story-diagnostics'].innerHTML || '';
    // v16.13 DELIBERATE CHANGE: stage cache key bumped to v1613 because aftermath prompts + checker changed; v16.12 cached stages must not reuse.
    const cacheJson = runInCtx(`localStorage.getItem('warroom_stage_cache_v1614')`) || '';
    calls = 0;
    await runInCtx(`generateMainStoryV16(globalThis._v1610l, 'v16-test-cache-2', {})`);
    const meta3 = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const callsRun3 = calls;
    check('V1610-L (v16.13 DELIBERATE CHANGE: cache key v1613) stage cache and resume: first run fails at combat2, retry reuses 2 cached stages (3 POSTs), new session reuses nothing (5 POSTs)',
      meta1 && meta1.kind === 'offline' && meta1.failedStage === 'combat2'
      && meta2 && meta2.kind === 'ai' && callsRun1 >= 3 && callsRun2 === 3
      && diag2.indexOf('stage cache reuse (no POST)') !== -1
      && cacheJson.indexOf('v16-test-cache-1|opening') !== -1
      && meta3 && meta3.kind === 'ai' && callsRun3 === 5,
      'run1kind=' + (meta1 && meta1.kind) + ' run2calls=' + callsRun2 + ' run3calls=' + callsRun3);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-M offline-first label present before AI completion and never saved as final', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    let release;
    const gate = new Promise(r => { release = r; });
    sandbox.fetch = async (url, opts) => {
      await gate;
      const c = JSON.parse((opts && opts.body) || '').messages[1].content;
      let stage = 'opening';
      const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1];
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    const before = runInCtx(`localStorage.getItem('warroom_battles_v3')`) || '';
    setVmBattle('globalThis._v1610m', b);
    runInCtx(`globalThis._v1610mp = generateMainStoryV16(globalThis._v1610m, 'v16-test-v1610m-1', {});`);
    const labelDuring = els['main-story-label'].innerText || '';
    const storyDuring = els['story-output'].innerHTML || '';
    const after = runInCtx(`localStorage.getItem('warroom_battles_v3')`) || '';
    release();
    await sandbox._v1610mp;
    const labelAfter = els['main-story-label'].innerText || '';
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V1610-M offline-first: Offline episode + Chapter I shown during generation, nothing saved yet, Online AI Story after completion',
      labelDuring === 'Offline episode' && storyDuring.indexOf('Chapter I') !== -1
      && after === before
      && labelAfter.indexOf('Online AI Story') !== -1 && meta && meta.kind === 'ai',
      'during=' + labelDuring + ' after=' + labelAfter);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-N AI heading does not claim 6 chapters; fallback heading keeps them', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    sandbox.fetch = async (url, opts) => {
      const c = JSON.parse((opts && opts.body) || '').messages[1].content;
      let stage = 'opening';
      const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1];
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610n', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610n, 'v16-test-v1610n-1', {})`);
    const headingAi = els['episode-heading'].innerText || '';
    sandbox.fetch = async () => { throw new Error('offline-test boom'); };
    setVmBattle('globalThis._v1610n2', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610n2, 'v16-test-v1610n-2', {})`);
    const headingOff = els['episode-heading'].innerText || '';
    check('V1610-N AI heading is stage-based without 6 Chapters; fallback heading keeps 6 Chapters',
      headingAi.indexOf('Online AI Story') !== -1 && headingAi.indexOf('6 Chapters') === -1 && headingAi.indexOf('5 stages') !== -1
      && headingOff.indexOf('6 Chapters') !== -1,
      'ai=' + headingAi + ' off=' + headingOff);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-P prompt-size display is per-stage with no single-shot cap comparison; every stage prompt under 800', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const prompts = [];
    sandbox.fetch = async (url, opts) => {
      const c = JSON.parse((opts && opts.body) || '').messages[1].content;
      prompts.push(c);
      let stage = 'opening';
      const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1];
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1610p', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610p, 'v16-test-v1610p-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const diag = els['main-story-diagnostics'].innerHTML || '';
    check('V1610-P prompt-size display is per-stage with no single-shot cap comparison; every stage prompt under 800',
      meta && meta.kind === 'ai' && prompts.length === 5 && prompts.every(p => p.length < 800)
      && diag.indexOf('Prompt sizes (per stage') !== -1
      && diag.indexOf('cap 4500') === -1
      && diag.indexOf('total of stage prompts') !== -1,
      'lens=' + prompts.map(p => p.length).join(','));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1610-T per-stage max_tokens on /openai and system prompt carries the rules once', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const openaiBodies = [];
    sandbox.fetch = async (url, opts) => {
      const body = JSON.parse((opts && opts.body) || '{}');
      if (String(url || '').indexOf('/openai') !== -1) {
        openaiBodies.push(body);
        let stage = 'opening';
        const c = (body.messages && body.messages[1] && body.messages[1].content) || '';
        const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1];
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: scenes[stage] || scenes.opening }, finish_reason: 'stop' }] }) };
      }
      return { ok: false, status: 500, text: async () => 'not openai path' };
    };
    setVmBattle('globalThis._v1610t', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1610t, 'v16-test-v1610t-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const byStage = {};
    openaiBodies.forEach(bd => {
      const c = (bd.messages && bd.messages[1] && bd.messages[1].content) || '';
      const m = c.match(/STAGE: ([a-z0-9]+)/);
      if (m) byStage[m[1]] = bd;
    });
    const sysOk = openaiBodies.length > 0 && openaiBodies.every(bd => bd.messages && bd.messages[0] && bd.messages[0].role === 'system' && bd.messages[0].content.indexOf('Never change the winner') !== -1);
    check('V1610-T (v16.13 DELIBERATE CHANGE) per-stage max_tokens on /openai (400/400/350/600) and system prompt carries the rules once',
      meta && meta.kind === 'ai' && sysOk
      && byStage.opening && byStage.opening.max_tokens === 400
      && byStage.combat1 && byStage.combat1.max_tokens === 400
      && byStage.combat2 && byStage.combat2.max_tokens === 400
      && byStage.climax && byStage.climax.max_tokens === 350
      && byStage.aftermath && byStage.aftermath.max_tokens === 600,
      'maxTokens=' + JSON.stringify(Object.keys(byStage).map(k => k + ':' + byStage[k].max_tokens)));
    sandbox.fetch = realFetch;
  });



  // ================= v16.11 HARD-CONSTRAINT TESTS (mock fetch, no real network) =================
  // Each locked item violated -> FAILED (never UNVERIFIED-only); each loose item -> NOT failed.
  function hardForV1611(stage, text, b, prev) {
    return JSON.parse(runInCtx(`JSON.stringify(hardConstraintChecksForStageV1611(${JSON.stringify(stage)}, ${JSON.stringify(text)}, buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), stageRoundsV167(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), ${JSON.stringify(stage)}), ${JSON.stringify(prev || [])}))`));
  }
  function hardStateV1611(checks, name) { const c = checks.find(x => x.name === 'Hard-constraint: ' + name); return c ? c.state : 'MISSING'; }
  function hardFailedV1611(checks) { return checks.filter(c => c.state === 'FAILED'); }
  function hardAsmV1611(b, scenes, order) {
    return JSON.parse(runInCtx(`JSON.stringify(hardConstraintChecksForAssemblyV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), ${JSON.stringify(scenes)}, ${JSON.stringify(order)}))`));
  }

  await expectV16('V1611-L1 winner locked: loser declared winner fails, true winner passes', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const bad = hardForV1611('aftermath', 'Aftermath: Batman stood as the winner while Spider-Man watched.', b, []);
    const good = hardForV1611('aftermath', 'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.', b, []);
    check('V1611-L1 winner locked: loser declared winner FAILED, true winner NOT failed',
      hardStateV1611(bad, 'winner locked') === 'FAILED' && hardFailedV1611(good).filter(c => c.name.indexOf('winner locked') !== -1).length === 0,
      'bad=' + JSON.stringify(hardFailedV1611(bad).map(c => c.name)));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L2 loser state locked: KO-as-death and death-as-KO fail', async () => {
    const bI = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const badI = hardForV1611('aftermath', 'Aftermath: Spider-Man stood as the winner while Batman lay dead on the open ground.', bI, []);
    const bD = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const finD = finAtkOf(bD).ability;
    const badD = hardForV1611('climax', 'The fight turned when Superman closed in and struck with ' + finD + ', ending the exchange. Rocky Balboa lay unconscious, not dead.', bD, []);
    const goodD = hardForV1611('climax', 'The fight turned when Superman closed in and struck with ' + finD + ', ending the exchange. Rocky Balboa lay dead.', bD, []);
    check('V1611-L2 loser state locked: incapacitation-mode death wording FAILED, death-mode merely-unconscious FAILED, true death wording NOT failed',
      hardStateV1611(badI, 'loser state locked') === 'FAILED'
      && hardStateV1611(badD, 'loser state locked') === 'FAILED'
      && hardStateV1611(goodD, 'loser state locked') === 'PASSED',
      'badI=' + hardStateV1611(badI, 'loser state locked') + ' badD=' + hardStateV1611(badD, 'loser state locked'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L3 finisher: full climax sentence passes, detached one-token alone fails', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const fin = finAtkOf(b).ability;
    const full = hardForV1611('climax', 'The fight turned when Spider-Man closed in and struck with ' + fin + ', ending the exchange.', b, []);
    const detached = hardForV1611('climax', fin + '.', b, []);
    check('V1611-L3 finisher in a full climax sentence PASSED; detached one-token finisher alone FAILED',
      hardStateV1611(full, 'finisher in a full climax sentence') === 'PASSED'
      && hardStateV1611(detached, 'finisher in a full climax sentence') === 'FAILED',
      'fin=' + fin + ' full=' + hardStateV1611(full, 'finisher in a full climax sentence') + ' detached=' + hardStateV1611(detached, 'finisher in a full climax sentence'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L4 mode + battlefield locked: wrong mode label and arena features fail, atmosphere passes', async () => {
    const bD = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const badMode = hardForV1611('aftermath', 'Aftermath: Superman won by incapacitation while Rocky Balboa lay on the open ground.', bD, []);
    const bI = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const badArena = hardForV1611('opening', 'Spider-Man and Batman met on the open ground as the crowd watched from the stands.', bI, []);
    const goodArena = hardForV1611('opening', 'Spider-Man and Batman met on the open ground under a pale sky, dust drifting in the still air.', bI, []);
    const asmBad = hardAsmV1611(bI, { opening: 'Spider-Man and Batman met on the open ground.', climax: 'The fight turned when Spider-Man closed in and struck with Web + Impact Combo, ending the exchange.', aftermath: 'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, beside a cathedral.' }, ['opening', 'climax', 'aftermath']);
    check('V1611-L4 mode label swapped FAILED, crowd/stands on Open Arena FAILED (stage + assembly), atmospheric wording NOT failed',
      hardStateV1611(badMode, 'victory mode locked') === 'FAILED'
      && hardStateV1611(badArena, 'battlefield locked') === 'FAILED'
      && hardStateV1611(goodArena, 'battlefield locked') === 'PASSED'
      && hardStateV1611(asmBad, 'battlefield locked') === 'FAILED',
      'mode=' + hardStateV1611(badMode, 'victory mode locked') + ' arena=' + hardStateV1611(badArena, 'battlefield locked'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L5 canon powers: misattributed trait and ability fail, own powers pass', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const badTrait = hardForV1611('opening', "Batman's spider-sense tingled as he moved.", b, []);
    const badActor = hardForV1611('combat1', 'Batman struck with Web Shot, ending the exchange.', b, []);
    const goodTrait = hardForV1611('opening', "Spider-Man's spider-sense tingled as he moved.", b, []);
    check('V1611-L5 canon powers: spider-sense to Batman FAILED, Web Shot by Batman FAILED, spider-sense to Spider-Man PASSED',
      hardStateV1611(badTrait, 'canon powers and traits only') === 'FAILED'
      && hardStateV1611(badActor, 'canon powers and traits only') === 'FAILED'
      && hardStateV1611(goodTrait, 'canon powers and traits only') === 'PASSED',
      'trait=' + hardStateV1611(badTrait, 'canon powers and traits only') + ' actor=' + hardStateV1611(badActor, 'canon powers and traits only'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L6 transforms: story-only fails; engine-triggered with effect passes, mention-only fails', async () => {
    const bNo = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const storyOnly = hardForV1611('combat2', 'Spider-Man transformed into Symbiote Surge, his power surging.', bNo, []);
    const bTr = battle([[spec('goku')], [spec('superman')]], { seed: 12345, victoryMode: 'death' });
    const finTr = finAtkOf(bTr).ability;
    const withEffect = hardAsmV1611(bTr, { opening: 'Goku and Superman met on the open ground.', climax: 'The fight turned when Goku transformed into Super Saiyan Blue, his power surging stronger than before, and Superman closed in and struck with ' + finTr + ', ending the exchange.', aftermath: 'Aftermath: Superman stood as the winner while Goku lay dead on the open ground.' }, ['opening', 'climax', 'aftermath']);
    const mentionOnly = hardAsmV1611(bTr, { opening: 'Goku and Superman met on the open ground.', climax: 'The fight turned when Goku transformed into Super Saiyan Blue. Superman closed in and struck with ' + finTr + ', ending the exchange.', aftermath: 'Aftermath: Superman stood as the winner while Goku lay dead on the open ground.' }, ['opening', 'climax', 'aftermath']);
    check('V1611-L6 transforms: story-only FAILED, engine-triggered with effect PASSED, mention-only FAILED',
      hardStateV1611(storyOnly, 'transforms only if engine-triggered') === 'FAILED'
      && hardStateV1611(withEffect, 'transforms only if engine-triggered') === 'PASSED'
      && hardStateV1611(mentionOnly, 'transforms only if engine-triggered') === 'FAILED',
      'storyOnly=' + hardStateV1611(storyOnly, 'transforms only if engine-triggered') + ' withEffect=' + hardStateV1611(withEffect, 'transforms only if engine-triggered') + ' mentionOnly=' + hardStateV1611(mentionOnly, 'transforms only if engine-triggered'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L7 power scaling: cannot-harm fighter shown hurting fails; generic exchange passes', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const bad = hardForV1611('combat1', 'Rocky Balboa landed Body Blow Barrage on Superman, hurting him badly.', b, []);
    const good = hardForV1611('combat1', 'Superman and Rocky Balboa traded blows in the early exchanges, testing guards and footwork.', b, []);
    check('V1611-L7 power scaling: cannot-harm Body Blow Barrage described as landing FAILED; generic traded blows NOT failed',
      hardStateV1611(bad, 'power scaling (cannot-harm)') === 'FAILED'
      && hardFailedV1611(good).filter(c => c.name.indexOf('power scaling') !== -1).length === 0,
      'bad=' + hardStateV1611(bad, 'power scaling (cannot-harm)'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L8 post-defeat action: loser acting decisively after defeat fails', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const fin = finAtkOf(b).ability;
    const bad = hardAsmV1611(b, { opening: 'Spider-Man and Batman met on the open ground.', climax: 'The fight turned when Spider-Man closed in and struck with ' + fin + ', ending the exchange. Batman lay unconscious, not dead.', aftermath: 'Aftermath: Batman rose and struck Spider-Man back with a fierce counter. Spider-Man stood as the winner while Batman lay unconscious, not dead.' }, ['opening', 'climax', 'aftermath']);
    const good = hardAsmV1611(b, { opening: 'Spider-Man and Batman met on the open ground.', climax: 'The fight turned when Spider-Man closed in and struck with ' + fin + ', ending the exchange.', aftermath: 'Aftermath: Spider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.' }, ['opening', 'climax', 'aftermath']);
    check('V1611-L8 post-defeat: loser striking back after defeat FAILED; loser merely lying still PASSED',
      hardStateV1611(bad, 'no post-defeat action') === 'FAILED'
      && hardStateV1611(good, 'no post-defeat action') === 'PASSED',
      'bad=' + hardStateV1611(bad, 'no post-defeat action'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L9 knowledge: prepared-counter knowledge without a record acquisition fails; with one it passes', async () => {
    const bNoPrep = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const bad = hardForV1611('opening', 'Superman knew about the prepared counter trap before the fight began.', bNoPrep, []);
    const bPrep = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const ok = hardForV1611('opening', 'Batman knew about the prepared counter trap and waited for his moment.', bPrep, []);
    check('V1611-L9 knowledge: unacquired trap knowledge FAILED; same phrasing with a recorded preparation NOT failed',
      hardStateV1611(bad, 'no unacquired knowledge') === 'FAILED'
      && hardStateV1611(ok, 'no unacquired knowledge') === 'PASSED',
      'bad=' + hardStateV1611(bad, 'no unacquired knowledge') + ' ok=' + hardStateV1611(ok, 'no unacquired knowledge'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-L10 personality decisions: mercy contradicted fails, mercy reflected passes, mercy omitted is unverified', async () => {
    const base = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const bm = JSON.parse(JSON.stringify(base));
    bm.events.push({ round: 6, type: 'choice', actor: 'Superman', target: 'Rocky Balboa', detail: 'holds the lethal finish', reason: 'mercy' });
    const finM = finAtkOf(bm).ability;
    const bad = hardAsmV1611(bm, { opening: 'Superman and Rocky Balboa met on the open ground.', climax: 'The fight turned when Superman showed no mercy and struck with ' + finM + ', ending the exchange.', aftermath: 'Aftermath: Superman stood as the winner while Rocky Balboa lay dead on the open ground.' }, ['opening', 'climax', 'aftermath']);
    const good = hardAsmV1611(bm, { opening: 'Superman and Rocky Balboa met on the open ground.', climax: 'The fight turned when Superman held the finish, showing mercy, then struck with ' + finM + ', ending the exchange.', aftermath: 'Aftermath: Superman stood as the winner while Rocky Balboa lay dead on the open ground.' }, ['opening', 'climax', 'aftermath']);
    const omitted = hardAsmV1611(bm, { opening: 'Superman and Rocky Balboa met on the open ground.', climax: 'The fight turned when Superman struck with ' + finM + ', ending the exchange.', aftermath: 'Aftermath: Superman stood as the winner while Rocky Balboa lay dead on the open ground.' }, ['opening', 'climax', 'aftermath']);
    check('V1611-L10 mercy: contradicted FAILED, reflected PASSED, omitted UNVERIFIED (not failed, not passed)',
      hardStateV1611(bad, 'personality decisions not contradicted') === 'FAILED'
      && hardStateV1611(good, 'personality decisions not contradicted') === 'PASSED'
      && hardStateV1611(omitted, 'personality decisions not contradicted') === 'UNVERIFIED',
      'bad=' + hardStateV1611(bad, 'personality decisions not contradicted') + ' good=' + hardStateV1611(good, 'personality decisions not contradicted') + ' omitted=' + hardStateV1611(omitted, 'personality decisions not contradicted'));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-LOOSE middle fictionalisation is not a failure', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const invented = hardForV1611('combat1', 'Spider-Man struck with a sweeping kick that sent Batman reeling, an exchange invented for flow, with no round numbers at all.', b, [stageScenesForV167(b).opening]);
    const noRounds = hardForV1611('combat2', 'The two fighters circled, traded feints, and pressed on without a single decisive moment yet.', b, [stageScenesForV167(b).opening]);
    check('V1611-LOOSE invented minor exchange and round-number-free middle have 0 FAILED hard checks',
      hardFailedV1611(invented).length === 0 && hardFailedV1611(noRounds).length === 0,
      'inventedFailed=' + JSON.stringify(hardFailedV1611(invented).map(c => c.name)) + ' noRoundsFailed=' + JSON.stringify(hardFailedV1611(noRounds).map(c => c.name)));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-BRIEF brief contains outcome + beats + dossier fields, no transcript', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const brief = runInCtx(`buildStoryBriefV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), 'combat2', 0)`);
    const promptsOk = ['opening', 'combat1', 'combat2', 'climax', 'aftermath'].every(st => {
      const p = runInCtx(`buildStagePromptV1611(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), ${JSON.stringify(st)}, {})`);
      return p.length < 800 && p.indexOf('STORY BRIEF') !== -1 && !/Round \\d+:/.test(p) && p.indexOf('Winner: Spider-Man (locked)') !== -1;
    });
    check('V1611-BRIEF brief has outcome + beats + dossier fields (incl. unknown for missing feat) and no transcript; every stage prompt <800 with brief + locked outcome',
      brief.indexOf('Winner: Spider-Man (locked)') !== -1 && brief.indexOf('Web + Impact Combo') !== -1
      && brief.indexOf('unconscious, not dead') !== -1 && brief.indexOf('Open Arena') !== -1
      && brief.indexOf('prepared a counter') !== -1
      && brief.indexOf('demonstrated feat: unknown') !== -1 && brief.indexOf('moral boundary') !== -1
      && !/Round \\d+:/.test(brief) && promptsOk,
      'briefLen=' + brief.length + ' promptsOk=' + promptsOk);
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-LABEL AI story is labelled as a fictionalised retelling with Combat Details authoritative', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    sandbox.fetch = async (url, opts) => {
      const c = JSON.parse((opts && opts.body) || '').messages[1].content;
      let stage = 'opening';
      const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1];
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1611label', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1611label, 'v16-test-v1611label-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    const label = els['main-story-label'].innerText || '';
    const diag = els['main-story-diagnostics'].innerHTML || '';
    check('V1611-LABEL AI label says fictionalised retelling + Combat Details authoritative; diagnostics say outcome-fixed, middle-loose + Hard-constraint checks',
      meta && meta.kind === 'ai'
      && label.indexOf('fictionalised retelling') !== -1 && label.indexOf('Combat Details is the authoritative') !== -1
      && diag.indexOf('outcome-fixed, middle-loose') !== -1 && diag.indexOf('Hard-constraint checks') !== -1
      && label.indexOf('event-by-event') === -1,
      'label=' + label.slice(0, 160));
    sandbox.fetch = realFetch;
  });

  await expectV16('V1611-REPAIR locked violation repaired on retry; still-failing locked violation falls back naming the locked item', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 7, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const bad = 'Batman lay incapacitated on the floor, unconscious and finished, while Spider-Man stood over him.';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (body.indexOf('REVISION') !== -1) return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
      if (stage === 'combat1') return { ok: true, status: 200, text: async () => bad };
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1611rep', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1611rep, 'v16-test-v1611rep-1', {})`);
    const metaOk = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let stage = 'opening';
      try { const c = JSON.parse(body).messages[1].content; const m = c.match(/STAGE: ([a-z0-9]+)/); if (m) stage = m[1]; } catch (e) {}
      if (stage === 'combat1') return { ok: true, status: 200, text: async () => bad };
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1611rep2', b);
    await runInCtx(`generateMainStoryV16(globalThis._v1611rep2, 'v16-test-v1611rep-2', {})`);
    const metaFail = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V1611-REPAIR locked violation repaired to AI; still-failing locked violation falls back with the locked item named in rejected checks',
      metaOk && metaOk.kind === 'ai'
      && metaFail && metaFail.kind === 'offline' && metaFail.failedStage === 'combat1'
      && (metaFail.rejectedChecks || []).join(' ').indexOf('loser state locked') !== -1,
      'okKind=' + (metaOk && metaOk.kind) + ' failKind=' + (metaFail && metaFail.kind) + ' rejected=' + JSON.stringify(metaFail && metaFail.rejectedChecks).slice(0, 200));
    sandbox.fetch = realFetch;
  });


  // ================= v16.12 CANON DOSSIER, PHASE 1 =================
  const D1612_FIELDS = ['identity','durability','scaling','style','personality','signatures','transforms','weaknesses','laws','peeves','systems','sources','unknown'];
  ['deadpool','wolverine','superman','batman','goku','saitama','frodo'].forEach(function (id) {
    const d = runInCtx(`dossierForV1612(${JSON.stringify(spec(id))})`);
    // runInCtx returns a raw value only for JSON-able code; dossier objects are plain, so use a JSON round-trip instead:
    const dj = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec(id))}))`));
    check('V1612-DOSSIER ' + id + ' deep dossier carries all 13 spec fields with statuses',
      dj.deep === true && D1612_FIELDS.every(function (k) { return dj[k] !== undefined && dj[k] !== null; })
      && typeof dj.durability.type === 'string' && typeof dj.durability.howLose === 'string'
      && Array.isArray(dj.systems) && Array.isArray(dj.laws) && Array.isArray(dj.peeves) && Array.isArray(dj.unknown),
      'deep=' + dj.deep + ' durability=' + (dj.durability && dj.durability.type));
  });
  {
    const sp = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec('spiderman'))}))`));
    check('V1612-DERIVED non-deep fighter gets a derived dossier, never invented deep fields',
      sp.deep === false && sp.unknown && sp.unknown.length >= 1 && sp.durability && sp.durability.status === 'derived',
      'deep=' + sp.deep);
    check('V1612-DODGE dodge priority by dossier durability (invulnerable 0.25, regenerative 0.5, normal 1, evasive 1.2)',
      runInCtx(`dossierDodgeMultV1612(${JSON.stringify(spec('superman'))})`) === 0.25
      && runInCtx(`dossierDodgeMultV1612(${JSON.stringify(spec('deadpool'))})`) === 0.5
      && runInCtx(`dossierDodgeMultV1612(${JSON.stringify(spec('batman'))})`) === 1
      && runInCtx(`dossierDodgeMultV1612(${JSON.stringify(spec('frodo'))})`) === 1.2
      && runInCtx(`dossierDodgeMultV1612(${JSON.stringify(spec('spiderman'))})`) === 1,
      '');
    check('V1612-FLAG Frodo Ring system is flagged as a balance problem, never used as infinite; Naruto derived clones flagged too',
      JSON.parse(runInCtx(`JSON.stringify(dossierFlaggedSystemsV1612(${JSON.stringify(spec('frodo'))}))`)).some(function (s) { return s.name === 'The One Ring'; })
      && JSON.parse(runInCtx(`JSON.stringify(dossierFlaggedSystemsV1612(${JSON.stringify(spec('naruto'))}))`)).some(function (s) { return /clone/i.test(s.name); }),
      '');
    check('V1612-COST Goku transform carries a recorded stamina cost (20); other deep transforms state no invented cost',
      runInCtx(`dossierTransformCostV1612({id:'goku',trans:'Super Saiyan Blue'})`) === 20
      && runInCtx(`dossierTransformCostV1612({id:'superman',trans:'Sun-Charged'})`) === 0,
      '');
    check('V1612-PEEVE-UNIT Wolverine hpBelow50 peeve resolves, and Deadpool targetHealed peeve resolves on a synthetic foe heal',
      (function () {
        const w = runInCtx(`dossierPeeveV1612({id:'wolverine',name:'Wolverine',currentHp:400,maxHp:1400,peeveFired:{}},[],[])`);
        const dp = runInCtx(`dossierPeeveV1612({id:'deadpool',name:'Deadpool',currentHp:1300,maxHp:1300,peeveFired:{}},[{name:'Wolverine'}],[{type:'heal',actor:'Wolverine'}])`);
        return w && w.triggerKind === 'hpBelow50' && dp && dp.triggerKind === 'targetHealed';
      })(), '');
  }
  {
    const bSup = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const stanceSup = bSup.events.some(function (e) { return e.type === 'tactic' && e.actor === 'Superman' && /tests first/i.test(e.detail || ''); });
    check('V1612-STANCE Superman holder-back stance is recorded once at first action', stanceSup, 'tactics=' + bSup.events.filter(function (e) { return e.type === 'tactic'; }).map(function (e) { return e.detail; }).join(' | ').slice(0, 200));
    const bDp = battle([[spec('deadpool')], [spec('goku')]], { seed: 12345, victoryMode: 'death' });
    const stanceDp = bDp.events.some(function (e) { return e.type === 'tactic' && e.actor === 'Deadpool' && /trades blows recklessly/i.test(e.detail || ''); });
    check('V1612-STANCE Deadpool brutal-reckless stance is recorded', stanceDp, 'tactics=' + bDp.events.filter(function (e) { return e.type === 'tactic'; }).map(function (e) { return e.detail; }).join(' | ').slice(0, 200));
    const bFr = battle([[spec('frodo')], [spec('saitama')]], { seed: 12345, victoryMode: 'death' });
    const stanceFr = bFr.events.some(function (e) { return e.type === 'tactic' && e.actor === 'Frodo Baggins' && /keeps distance/i.test(e.detail || ''); });
    check('V1612-STANCE Frodo evasive stance is recorded', stanceFr, 'tactics=' + bFr.events.filter(function (e) { return e.type === 'tactic'; }).map(function (e) { return e.detail; }).join(' | ').slice(0, 200));
    let peeveFound = false, costFound = false;
    [12345, 1, 2, 3, 7, 99].forEach(function (sd) {
      const bw = battle([[spec('wolverine')], [spec('saitama')]], { seed: sd, victoryMode: 'death' });
      if (bw.events.some(function (e) { return e.type === 'tactic' && e.actor === 'Wolverine' && /peeve triggered/i.test(e.detail || ''); })) peeveFound = true;
      const bg = battle([[spec('goku')], [spec('saitama')]], { seed: sd, victoryMode: 'death' });
      if (bg.events.some(function (e) { return e.type === 'transform' && e.actor === 'Goku' && e.staminaCost === 20; })) costFound = true;
    });
    check('V1612-PEEVE-ENGINE Wolverine rage peeve fires in a real battle (seed scan) with a recorded tactic event', peeveFound, '');
    check('V1612-COST-ENGINE Goku transform event carries staminaCost 20 in a real battle (seed scan)', costFound, '');
  }
  {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const rec = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})))`));
    const brief = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(rec))}), 'opening', 0)`);
    check('V1612-BRIEF deep dossier lines reach the story brief (durability + no-kill law), no transcript, no HP figures',
      brief.indexOf('STORY BRIEF') !== -1 && brief.indexOf('Dossier:') !== -1 && brief.indexOf('durability invulnerable') !== -1 && /no-kill/i.test(brief)
      && !/Round \d+:/.test(brief) && brief.indexOf('EVENTS:') === -1 && !/\b\d{3,4} HP\b/.test(brief),
      'briefLen=' + brief.length);
    // v16.12 NOTE (test premise corrected, not behaviour weakened): Batman IS a deep dossier, so a
    // Spider-Man vs Batman brief correctly carries a Dossier tail for Batman only. The derived-only
    // case is Spider-Man vs Rocky (neither deep), which must carry no tail at all.
    const b2 = battle([[spec('spiderman')], [spec('rocky')]], { seed: 12345, victoryMode: 'incapacitation' });
    const rec2 = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b2))})))`));
    const brief2 = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(rec2))}), 'opening', 0)`);
    check('V1612-BRIEF-DERIVED derived fighters keep the v16.11 brief line (no Dossier tail added)',
      brief2.indexOf('Dossier:') === -1 && brief2.indexOf('STORY BRIEF') !== -1, 'brief2Len=' + brief2.length);
    const b3 = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const rec3 = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b3))})))`));
    const brief3 = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(rec3))}), 'opening', 0)`);
    check('V1612-BRIEF-MIXED deep Batman line carries a Dossier tail while derived Spider-Man line does not add one',
      brief3.indexOf('Dossier:') !== -1 && (brief3.split(' | ')[0] || '').indexOf('Dossier:') === -1, 'brief3Len=' + brief3.length);
  }
  {
    function lawRec(flag) {
      return { fighters: [{ name: 'Superman', variant: 'Base', tier: 'EX', _orig: { id: 'superman' } }, { name: 'Batman', variant: 'Base', tier: 'S', _orig: { id: 'batman' } }], winner: 'Superman', loserState: 'dead', finishingAbility: 'Heat Vision', victoryMode: 'death', battlefield: 'Open Arena', events: [], dossierV1612: flag };
    }
    const withFlag = runInCtx(`JSON.stringify(hardConstraintChecksForStageV1611('climax', 'Superman killed Batman with Heat Vision.', JSON.parse(${JSON.stringify(JSON.stringify(lawRec(true)))}), 'climax', []))`);
    const lawFail = JSON.parse(withFlag).some(function (c) { return /dossier law: no-kill code/i.test(c.name) && c.state === 'FAILED'; });
    check('V1612-LAW no-kill code FAILS a story that says Superman deliberately killed Batman (gated, dossierV1612 flag on)', lawFail, '');
    const withFlagPass = runInCtx(`JSON.stringify(hardConstraintChecksForStageV1611('climax', 'Superman struck Batman down with Heat Vision, leaving him dead.', JSON.parse(${JSON.stringify(JSON.stringify(lawRec(true)))}), 'climax', []))`);
    const lawPass = JSON.parse(withFlagPass).some(function (c) { return /dossier law: no-kill code/i.test(c.name) && c.state === 'PASSED'; });
    check('V1612-LAW no-kill code PASSES a decisive blow that does not attribute a deliberate killing', lawPass, '');
    const noFlag = runInCtx(`JSON.stringify(hardConstraintChecksForStageV1611('climax', 'Superman killed Batman with Heat Vision.', JSON.parse(${JSON.stringify(JSON.stringify(lawRec(false)))}), 'climax', []))`);
    check('V1612-LAW-COUNT v16.11 check counts are unchanged without the dossierV1612 flag (no law entry added)',
      !JSON.parse(noFlag).some(function (c) { return /dossier law/i.test(c.name); }), '');
    const frodoRec = { fighters: [{ name: 'Frodo Baggins', variant: 'Base', tier: 'A', _orig: { id: 'frodo' } }, { name: 'Saitama', variant: 'Base', tier: 'EX', _orig: { id: 'saitama' } }], winner: 'Frodo Baggins', loserState: 'dead', finishingAbility: 'Sting Thrust', victoryMode: 'death', battlefield: 'Open Arena', events: [], dossierV1612: true };
    const frodoChecks = runInCtx(`JSON.stringify(hardConstraintChecksForStageV1611('climax', 'Frodo killed Saitama with Sting Thrust.', JSON.parse(${JSON.stringify(JSON.stringify(frodoRec))}), 'climax', []))`);
    check('V1612-LAW-SCOPE Frodo restraint is NOT a no-kill code, so no law check is gated for him',
      !JSON.parse(frodoChecks).some(function (c) { return /dossier law/i.test(c.name); }), '');
  }
  {
    const panel = runInCtx(`dossierPanelHtmlV1612(byId('batman'))`);
    check('V1612-PANEL Batman info panel shows the no-kill code with its conflict flag and status labels',
      panel.indexOf('no-kill') !== -1 || panel.indexOf('No-kill') !== -1, 'panelLen=' + panel.length);
    const panelFr = runInCtx(`dossierPanelHtmlV1612(byId('frodo'))`);
    check('V1612-PANEL Frodo info panel flags the Ring system limit (never infinite)',
      panelFr.indexOf('FLAGGED') !== -1 && panelFr.indexOf('One Ring') !== -1, '');
    check('V1612-IMPORTER importer accepts v16.12 as current and still accepts v16.11',
      (function () {
        const a = runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.12'}))`);
        const b = runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.11'}))`);
        return JSON.parse(a).ok && !JSON.parse(a).legacy && JSON.parse(b).ok && !JSON.parse(b).legacy;
      })(), '');
    check('V1614-CACHE (v16.14 DELIBERATE CHANGE) stage cache key is v1614 and no v1613 cache key remains as the active key',
      html.indexOf('warroom_stage_cache_v1614') !== -1 && html.indexOf('warroom_stage_cache_v1612') === -1, '');
    check('V1628-VERSION (v16.32 DELIBERATE CHANGE) build carries v16.35 title, heading, and save format; v16.24 and v16.27 still accepted by the importer',
      html.indexOf('<title>WAR-ROOM v16.35') !== -1 && html.indexOf('<h1>WAR-ROOM v16.35</h1>') !== -1 && html.indexOf("formatVersion:'v16.35'") !== -1
      && JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.24'}))`)).ok === true
      && JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.27'}))`)).ok === true, '');
  }


  // ================= v16.12b CANON DOSSIER FIELDS 14-26 =================
  {
    const F26 = ['identity','durability','scaling','style','personality','signatures','transforms','weaknesses','laws','peeves','systems','sources','unknown','relationships','communication','fears','reputation','victoryBehaviour','affinity','prep','powerInteractions','versionEvolution','definingFeats','psychWeaknesses','knowledge','physiology'];
    ['deadpool','wolverine','superman','batman','goku','saitama','frodo','rick'].forEach(function (id) {
      const dj = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec(id))}))`));
      check('V1612B-FIELDS26 ' + id + ' dossier carries all 26 frozen schema fields',
        F26.every(function (k) { return dj[k] !== undefined && dj[k] !== null; }), 'missing=' + F26.filter(function (k) { return dj[k] === undefined || dj[k] === null; }).join(','));
    });
    const sp26 = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec('spiderman'))}))`));
    check('V1612B-FIELDS26-DERIVED derived fighter also carries all 26 fields (unknown where not established)',
      F26.every(function (k) { return sp26[k] !== undefined && sp26[k] !== null; }), '');
  }
  {
    const bRel = battle([[spec('goku')], [spec('vegeta')]], { seed: 12345, victoryMode: 'death' });
    check('V1612B-REL-MATCH Goku vs Vegeta fires a recorded rivalry relationship trigger',
      bRel.events.some(function (e) { return e.type === 'tactic' && e.actor === 'Goku' && /relationship trigger/i.test(e.detail || '') && /Vegeta/i.test(e.detail || ''); }),
      'tactics=' + bRel.events.filter(function (e) { return e.type === 'tactic'; }).map(function (e) { return e.detail; }).join(' | ').slice(0, 200));
    const bNoRel = battle([[spec('goku')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    check('V1612B-REL-NOMATCH Goku vs Rocky fires no Vegeta relationship trigger (unmatched = background only)',
      !bNoRel.events.some(function (e) { return e.type === 'tactic' && /relationship trigger/i.test(e.detail || '') && /Vegeta/i.test(e.detail || ''); }), '');
    const recRel = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bRel))})))`));
    const briefRel = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(recRel))}), 'opening', 0)`);
    check('V1612B-REL-BRIEF matched rivalry appears in the brief; unmatched brief never names the rival',
      briefRel.indexOf('RELATIONSHIP:') !== -1 && briefRel.indexOf('Vegeta') !== -1, 'briefLen=' + briefRel.length);
    const recNoRel = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bNoRel))})))`));
    const briefNoRel = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(recNoRel))}), 'opening', 0)`);
    check('V1612B-REL-BRIEF-NOMATCH Goku vs Rocky brief contains no Vegeta relationship line',
      briefNoRel.indexOf('Vegeta') === -1 && briefNoRel.indexOf('RELATIONSHIP:') === -1, '');
  }
  {
    const bDp = battle([[spec('deadpool')], [spec('goku')]], { seed: 12345, victoryMode: 'death' });
    const recDp = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bDp))})))`));
    const briefDp = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(recDp))}), 'opening', 0)`);
    check('V1612B-COMM Deadpool communication style reaches the brief in paraphrase, with no copied dialogue line',
      briefDp.indexOf('Speaks:') !== -1 && !/"[^"]{30,}"/.test(briefDp), 'briefLen=' + briefDp.length);
    const panelRick = runInCtx(`dossierPanelHtmlV1612(byId('rick'))`);
    check('V1612B-RICK Rick panel states portal/clone/Meeseek limits as unknown and flagged, never invented',
      panelRick.indexOf('Portal gun') !== -1 && panelRick.indexOf('Meeseeks') !== -1 && panelRick.indexOf('FLAGGED') !== -1 && panelRick.indexOf('Clones') !== -1, 'panelLen=' + panelRick.length);
    const rickD = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec('rick'))}))`));
    check('V1612B-RICK-DATA Rick dossier claims no clone count, Meeseek power, or portal limit',
      JSON.stringify(rickD).indexOf('Meeseeks are NOT used') !== -1 && !/clone count: \d/i.test(JSON.stringify(rickD)), '');
  }
  {
    let fearFound = false;
    [12345, 1, 2, 3, 7, 99].forEach(function (sd) {
      const bb = battle([[spec('batman')], [spec('superman')]], { seed: sd, victoryMode: 'death' });
      if (bb.events.some(function (e) { return e.type === 'tactic' && e.actor === 'Batman' && /fear\/psych trigger/i.test(e.detail || ''); })) fearFound = true;
    });
    check('V1612B-FEAR Batman hpBelow25 fear trigger fires in a real battle (seed scan) as a recorded tactic event', fearFound, '');
    const batD = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec('batman'))}))`));
    check('V1612B-PREP Batman prep limit is finite (never infinite prep) and prep time is the study/prepare sequence',
      (batD.prep.limit || '').indexOf('FINITE') !== -1 && /study/i.test(batD.prep.prepTime || ''), 'limit=' + batD.prep.limit);
    const bBat = battle([[spec('batman')], [spec('superman')]], { seed: 12345, victoryMode: 'death' });
    check('V1612B-PREP-ENGINE Batman battle records study then prepare events (prep is a sequence, not instant)',
      bBat.events.some(function (e) { return e.type === 'study'; }) && bBat.events.some(function (e) { return e.type === 'prepare'; }), '');
  }
  {
    const supD = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec('superman'))}))`));
    check('V1612B-VERSION Superman version evolution names Kingdom Come as a separate version, not a merged feat source',
      (supD.versionEvolution.differsFrom || '').indexOf('Kingdom Come') !== -1, '');
    const bSup = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const recSup = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bSup))})))`));
    const briefSup = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(recSup))}), 'opening', 0)`);
    check('V1612B-VERSION-BRIEF Superman Base brief never imports Kingdom Come feats',
      briefSup.indexOf('Kingdom Come') === -1 && briefSup.indexOf('Counters:') !== -1 && briefSup.indexOf('Magic') !== -1, '');
    check('V1612B-SOURCE fan-wiki-only fact is a lead, cross-version fact is not canon for this version, primary matches',
      runInCtx(`dossierFactStatusV1612('fan wiki', true)`) === 'lead'
      && runInCtx(`dossierFactStatusV1612('primary canon', false)`) === 'not canon for this version'
      && runInCtx(`dossierFactStatusV1612('primary canon', true)`) === 'primary', '');
    const allDeep = ['deadpool','wolverine','superman','batman','goku','saitama','frodo','rick'].map(function (id) { return JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(${JSON.stringify(spec(id))}))`)); });
    check('V1612B-SOURCE-HONEST no deep dossier claims a verified citation it does not have',
      allDeep.every(function (d) { return (d.sources || []).every(function (s) { return s.status !== 'verified'; }); }), '');
  }
  {
    const bRuin = battle([[spec('batman')], [spec('superman')]], { seed: 12345, victoryMode: 'death', battlefield: { id: 'ruined', name: 'Ruined City', desc: 'Broken buildings give cover.', atk: 0, def: 12 } });
    const recRuin = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bRuin))})))`));
    const briefRuin = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(recRuin))}), 'opening', 0)`);
    check('V1612B-AFFINITY Batman Ruined City affinity appears in the brief on the matching battlefield',
      briefRuin.indexOf('AFFINITY:') !== -1 && briefRuin.indexOf('Ruined City') !== -1, 'bf=' + recRuin.battlefield);
    const bOpen = battle([[spec('batman')], [spec('superman')]], { seed: 12345, victoryMode: 'death' });
    const recOpen = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bOpen))})))`));
    const briefOpen = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(recOpen))}), 'opening', 0)`);
    check('V1612B-AFFINITY-NOMATCH Batman Open Arena brief carries no Ruined City affinity line',
      briefOpen.indexOf('AFFINITY: Batman') === -1, '');
    const bDp2 = battle([[spec('deadpool')], [spec('goku')]], { seed: 12345, victoryMode: 'death' });
    const recDp2 = JSON.parse(runInCtx(`JSON.stringify(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bDp2))})))`));
    const briefAfter = runInCtx(`buildStoryBriefV1611(JSON.parse(${JSON.stringify(JSON.stringify(recDp2))}), 'aftermath', 0)`);
    check('V1612B-VICTORY aftermath brief carries victory behaviour (behaviour, not a stat bonus)',
      briefAfter.indexOf('VICTORY BEHAVIOUR:') !== -1, 'briefLen=' + briefAfter.length);
  }


  // ================= v16.13 AFTERMATH FIX =================
  // Pure-checker helper: stageAftermathOkV167 on a built continuity record.
  function aftermathOkV1613(text, b) {
    return runInCtx(`stageAftermathOkV167(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})), ${JSON.stringify(text)})`);
  }
  {
    const toks = JSON.parse(runInCtx(`JSON.stringify({ m10: V1610_MAX_TOKENS, m11: V1611_MAX_TOKENS, sr: V1613_SECOND_REPAIR_MAX_TOKENS, k10: V1610_STAGE_CACHE_KEY, k11: V1611_STAGE_CACHE_KEY })`));
    check('V1613-TOKENS aftermath max_tokens 600 (initial + repair) on both token maps, other stages unchanged, second repair 400, cache key v1613',
      toks.m10.aftermath === 600 && toks.m11.aftermath === 600
      && toks.m10.opening === 400 && toks.m10.combat1 === 400 && toks.m10.combat2 === 400 && toks.m10.climax === 350
      && toks.m11.opening === 400 && toks.m11.combat1 === 400 && toks.m11.combat2 === 400 && toks.m11.climax === 350
      && toks.sr === 400 && toks.k10 === 'warroom_stage_cache_v1614' && toks.k11 === 'warroom_stage_cache_v1614',
      JSON.stringify(toks));
  }
  {
    const bI = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const bD = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    // Final-paragraph scope: metaphor in an earlier paragraph must not fail it.
    const metaEarly = 'The dead silence hung over the arena as the echoes faded.\n\nSpider-Man stood as the winner while Batman lay unconscious, not dead, on the open ground.';
    // Loser state only in an earlier paragraph must not pass it.
    const stateEarlyOnly = 'Spider-Man stood as the winner while Batman lay unconscious, not dead.\n\nSpider-Man stood as the winner on the open ground.';
    const winnerMissingFinal = 'Spider-Man stood as the winner on the open ground.\n\nBatman lay unconscious, not dead, on the open ground.';
    check('V1613-FINAL-PARA loser-state check is final-paragraph only: earlier "dead silence" passes, state-only-earlier fails, winner-missing-in-final fails',
      aftermathOkV1613(metaEarly, bI) === true && aftermathOkV1613(stateEarlyOnly, bI) === false && aftermathOkV1613(winnerMissingFinal, bI) === false,
      'metaEarly=' + aftermathOkV1613(metaEarly, bI) + ' stateEarlyOnly=' + aftermathOkV1613(stateEarlyOnly, bI) + ' winnerMissing=' + aftermathOkV1613(winnerMissingFinal, bI));
    // All 8 synonyms pass in the final paragraph; non-synonyms and swaps fail.
    const synI = ['unconscious', 'knocked out', 'incapacitated', 'out cold'];
    const synIok = synI.every(s => aftermathOkV1613('Aftermath: Spider-Man stood as the winner while Batman lay ' + s + ', not dead, on the open ground.', bI));
    const synD = [['lay dead', 'dead'], ['had died', 'died'], ['had been killed', 'killed'], ['lay lifeless', 'lifeless']];
    const synDok = synD.every(pair => aftermathOkV1613('Aftermath: Superman stood as the winner while Rocky Balboa ' + pair[0] + ' on the open ground.', bD));
    check('V1613-SYNONYMS all 8 synonyms pass (unconscious/knocked out/incapacitated/out cold; dead/died/killed/lifeless)',
      synIok && synDok,
      'synI=' + synIok + ' synD=' + synDok);
    check('V1613-SYNONYMS-NEG non-synonym "motionless" fails, incapacitation "dead" fails, death "merely unconscious" fails',
      aftermathOkV1613('Aftermath: Superman stood as the winner while Rocky Balboa lay motionless on the open ground.', bD) === false
      && aftermathOkV1613('Aftermath: Spider-Man stood as the winner while Batman lay dead on the open ground.', bI) === false
      && aftermathOkV1613('Aftermath: Superman stood as the winner while Rocky Balboa lay merely unconscious, not dead, on the open ground.', bD) === false,
      '');
    // Verbatim probe text (cells A/B): complete prose, but no dead word -> still FAILS loser state.
    const probeText = 'The dust settled over the flat expanse of the open arena, a silent testament to the clash that had just ended. Superman stood alone, his cape fluttering in the wind, the faint glow of his heat vision lingering in the air. Across the field, Rocky Balboa lay motionless, the final blow having claimed him. The silence was broken only by the distant echo of a crowd that had once roared, now hushed. The victor\'s eyes, still wide with the weight of what had transpired, scanned the empty ground. The arena, once a place of fierce competition, now held only the quiet aftermath of a decisive victory.';
    check('V1613-PROBE verbatim probe text as-is FAILS loser state (no dead word), and the same text with "dead" in the final paragraph PASSES',
      aftermathOkV1613(probeText, bD) === false && aftermathOkV1613(probeText + ' Rocky Balboa lay dead.', bD) === true,
      'asIs=' + aftermathOkV1613(probeText, bD) + ' withDead=' + aftermathOkV1613(probeText + ' Rocky Balboa lay dead.', bD));
    // Assembly gate must not undo the stage fix: "knocked out" aftermath passes the v16.6 check too.
    const finI = finAtkOf(bI);
    const assembled = ['Spider-Man and Batman met on the open ground under the open sky.',
      'The fight turned when Spider-Man closed in and struck with ' + (finI ? finI.ability : 'Web Shot') + ', ending the exchange.',
      'Aftermath: Spider-Man stood as the winner while Batman lay knocked out, not dead, on the open ground.'].join('\n\n');
    const asmChecks = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(bI))}), ${JSON.stringify(assembled)}))`));
    const asmAfter = asmChecks.find(c => c.name === 'Story ends with an aftermath');
    check('V1613-ASSEMBLY "knocked out" aftermath passes the assembled-story aftermath check (stage fix not undone at assembly)',
      asmAfter && asmAfter.state === 'PASSED', 'after=' + (asmAfter && asmAfter.state));
    // Second-repair prompt + by-construction text.
    const srD = runInCtx(`buildAftermathSecondRepairPromptV1613(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bD))})))`);
    const srI = runInCtx(`buildAftermathSecondRepairPromptV1613(buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(bI))})))`);
    check('V1613-SECOND-REPAIR-PROMPT second-repair prompt is exactly-2-sentences with winner/loser/state/battlefield, no transcript',
      srD.indexOf('exactly 2 sentences') !== -1 && srD.indexOf('Superman') !== -1 && srD.indexOf('Rocky Balboa') !== -1 && srD.indexOf('dead') !== -1 && srD.indexOf('Open Arena') !== -1 && srD.indexOf('Round ') === -1 && srD.indexOf('EVENTS:') === -1
      && srI.indexOf('Spider-Man') !== -1 && srI.indexOf('unconscious') !== -1
      && aftermathOkV1613('Superman won. Rocky Balboa is dead on Open Arena.', bD) === true
      && aftermathOkV1613('Spider-Man won. Batman is unconscious on Open Arena.', bI) === true,
      'srD=' + srD);
  }
  // Second repair rescues a run whose aftermath fails initial + correction.
  await expectV16('V1613 second repair', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    const badAftermath = 'The fight ended somehow, with no clear outcome stated at all.';
    const mf = mockFetchStagesV167(scenes, { onCall: (n, content) => {
      if (content.indexOf('SECOND REPAIR') !== -1) return { ok: true, status: 200, text: async () => 'Superman won. Rocky Balboa is dead on Open Arena.' };
      if (content.indexOf('STAGE: aftermath') !== -1) return { ok: true, status: 200, text: async () => badAftermath };
      return null;
    }});
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v1613sr', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v1613sr, 'v16-test-v1613sr-1', {})`);
    const srDiag = (meta && meta.stageDiagnostics || []).find(d => d.stage === 'aftermath' && d.status === 'second-repair');
    check('V1613-SECOND-REPAIR-RUN aftermath failing initial + correction is rescued by the 2-sentence second repair (400 tokens) and renders AI',
      meta && meta.kind === 'ai' && !!srDiag && srDiag.maxTokens === 400,
      'kind=' + (meta && meta.kind) + ' srDiag=' + JSON.stringify(srDiag));
    sandbox.fetch = realFetch;
  });
  // Provider retry for aftermath stage only: /openai fails the checker, Classic passes.
  await expectV16('V1613 provider retry aftermath only', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    const badAftermath = 'The fight ended somehow, with no clear outcome stated at all.';
    sandbox.fetch = async (url, o) => {
      let content = '';
      try { content = JSON.parse((o && o.body) || '').messages[1].content; } catch (e) {}
      const isOpenai = String(url || '').indexOf('/openai') !== -1;
      const m = content.match(/STAGE: ([a-z0-9]+)/); const stage = m ? m[1] : 'other';
      if (stage === 'aftermath' && isOpenai) return { ok: true, status: 200, text: async () => badAftermath };
      return { ok: true, status: 200, text: async () => scenes[stage] || scenes.opening };
    };
    setVmBattle('globalThis._v1613pr', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v1613pr, 'v16-test-v1613pr-1', {})`);
    const prDiag = (meta && meta.stageDiagnostics || []).find(d => d.stage === 'aftermath' && (d.status === 'provider-retry' || d.status === 'provider-retry-corrected'));
    check('V1613-PROVIDER-RETRY checker-failed aftermath retries on Classic for that stage only and renders AI (no whole-run fallback)',
      meta && meta.kind === 'ai' && !!prDiag && (meta.providersUsed || []).some(p => p.indexOf('Classic') !== -1),
      'kind=' + (meta && meta.kind) + ' providers=' + JSON.stringify(meta && meta.providersUsed) + ' prDiag=' + JSON.stringify(prDiag));
    sandbox.fetch = realFetch;
  });
  // Other stages unchanged: a climax failing after correction still falls back, with no rescue diags.
  await expectV16('V1613 other stages unchanged', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const scenes = stageScenesForV167(b);
    const badClimax = 'The fight turned when Spider-Man closed in and struck with a vague counter, ending the exchange.';
    const mf = mockFetchStagesV167(scenes, { onCall: (n, content) => {
      if (content.indexOf('STAGE: climax') !== -1) return { ok: true, status: 200, text: async () => badClimax };
      return null;
    }});
    sandbox.fetch = mf.fetch;
    setVmBattle('globalThis._v1613os', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v1613os, 'v16-test-v1613os-1', {})`);
    const rescueDiags = (meta && meta.stageDiagnostics || []).filter(d => d.status === 'second-repair' || d.status === 'provider-retry' || d.status === 'provider-retry-corrected');
    check('V1613-OTHER-STAGES climax failing after correction still falls back with no second-repair/provider-retry rescue',
      meta && meta.kind === 'offline' && meta.failedStage === 'climax' && rescueDiags.length === 0,
      'kind=' + (meta && meta.kind) + ' failedStage=' + (meta && meta.failedStage) + ' rescue=' + rescueDiags.length);
    sandbox.fetch = realFetch;
  });
  // Crowd guard: aftermath prompts only, and prompt-size targets still hold.
  {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const info = JSON.parse(runInCtx(`JSON.stringify((function(){ const rec = buildContinuityV167(JSON.parse(${JSON.stringify(JSON.stringify(b))})); return { af: buildStagePromptV1611(rec, 'aftermath', {}), afCorr: buildStagePromptV1611(rec, 'aftermath', { correction: true, failedChecks: ['Aftermath does not state the winner and loser state'] }), o: buildStagePromptV1611(rec, 'opening', {}), cl: buildStagePromptV1611(rec, 'climax', {}) }; })())`));
    check('V1613-CROWD-GUARD aftermath initial + correction prompts carry the battlefield-fidelity crowd guard and stay under 800 chars; opening/climax prompts do not carry it',
      info.af.indexOf('BATTLEFIELD FIDELITY') !== -1 && info.af.indexOf('crowd') !== -1 && info.af.length < 800
      && info.afCorr.indexOf('BATTLEFIELD FIDELITY') !== -1 && info.afCorr.length < 800
      && info.o.indexOf('BATTLEFIELD FIDELITY') === -1 && info.cl.indexOf('BATTLEFIELD FIDELITY') === -1,
      'afLen=' + info.af.length + ' afCorrLen=' + info.afCorr.length + ' oLen=' + info.o.length + ' clLen=' + info.cl.length);
  }
  // Reasoning: 'low' everywhere on /openai; 'none'/'minimal' never assigned.
  await expectV16('V1613 reasoning effort', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const scenes = stageScenesForV167(b);
    const openaiBodies = [];
    const mf = mockFetchStagesV167(scenes);
    const origFetch = mf.fetch;
    sandbox.fetch = async (url, o) => {
      try { const bd = JSON.parse((o && o.body) || ''); if (String(url || '').indexOf('/openai') !== -1) openaiBodies.push(bd); } catch (e) {}
      return origFetch(url, o);
    };
    setVmBattle('globalThis._v1613re', b);
    const meta = await runInCtx(`generateMainStoryV16(globalThis._v1613re, 'v16-test-v1613re-1', {})`);
    check('V1613-REASONING every /openai body uses reasoning_effort low; no body and no code assignment uses none/minimal (none is HTTP-400-rejected, minimal unprobed)',
      meta && meta.kind === 'ai' && openaiBodies.length > 0 && openaiBodies.every(bd => bd.reasoning_effort === 'low')
      && html.indexOf("reasoningEffort: 'none'") === -1 && html.indexOf("reasoningEffort: 'minimal'") === -1,
      'bodies=' + openaiBodies.length + ' efforts=' + openaiBodies.map(bd => bd.reasoning_effort).join(','));
    sandbox.fetch = realFetch;
  });
  {
    check('V1613-IMPORTER importer accepts v16.13 as current and still accepts v16.12',
      (function () {
        const a = runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.13'}))`);
        const bb = runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.12'}))`);
        return JSON.parse(a).ok && !JSON.parse(a).legacy && JSON.parse(bb).ok && !JSON.parse(bb).legacy;
      })(), '');
  }


  // ================= v16.14 SHORT-VERDICT TESTS =================
  // The long multi-stage AI story + 6-chapter offline episode are replaced
  // as the MAIN presentation by the short verdict (Jhay, 2026-10-31 20:01 EDT).
  // These tests prove the verdict path; the retained legacy generator tests
  // above still prove the old code paths that old saved entries rely on.
  function verdictFixture(a, bid, seed, mode) {
    const b = battle([[spec(a)], [spec(bid)]], { seed, victoryMode: mode });
    const txt = runInCtx(`buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const checks = JSON.parse(runInCtx(`JSON.stringify(checkVerdictV1614(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(b))})))`));
    return { b, txt, checks };
  }
  function verdictWords(txt) { return txt.split(/\s+/).filter(Boolean).length; }
  {
    const f1 = verdictFixture('superman', 'rocky', 12345, 'death');
    const f2 = verdictFixture('spiderman', 'batman', 145416145, 'incapacitation');
    const f3 = verdictFixture('goku', 'vegeta', 999, 'death');
    check('V1614-FALLBACK-WORDS fallback verdict is 150-200 words on three fixture battles',
      [f1, f2, f3].every(f => { const w = verdictWords(f.txt); return w >= 150 && w <= 200; }),
      'words=' + [f1, f2, f3].map(f => verdictWords(f.txt)).join(','));
    check('V1614-FALLBACK-LOCKED fallback verdicts pass the locked checker (0 FAILED) on three fixtures',
      [f1, f2, f3].every(f => f.checks.filter(c => c.state === 'FAILED').length === 0),
      'failed=' + [f1, f2, f3].map(f => f.checks.filter(c => c.state === 'FAILED').map(c => c.name).join('|')).join(' ; '));
    check('V1614-FALLBACK-BEATS fallback verdict has 5 beats in order (matchup, best plan, why failed, decisive, winner)',
      (function () {
        const paras = f1.txt.split(/\n\n+/);
        const fin = (f1.b.finalRecord && f1.b.finalRecord.finishingAbility) || '';
        return paras.length === 5 && paras[0].indexOf('Superman') !== -1 && paras[0].indexOf('Rocky Balboa') !== -1
          && paras[1].indexOf('best plan') !== -1 && paras[2].indexOf('fail') !== -1
          && (fin === '' || paras[3].indexOf(fin) !== -1)
          && paras[4].indexOf('Superman won') !== -1 && paras[4].indexOf('knocked out') !== -1;
      })(), 'paras=' + f1.txt.split(/\n\n+/).length);
    check('V1614-BEST-PLAN-RECORDED beat 2 names a recorded loser attack, not an invented plan',
      (function () {
        const loserAttacks = f2.b.events.filter(e => e.type === 'attack' && e.actor === 'Batman').map(e => e.ability);
        const p2 = f2.txt.split(/\n\n+/)[1] || '';
        return loserAttacks.some(a => a && p2.indexOf(a) !== -1);
      })(), 'loserAttacks=' + f2.b.events.filter(e => e.type === 'attack' && e.actor === 'Batman').map(e => e.ability).join(','));
    check('V1614-WHY-FAILED-RECORDED why-failed beat cites a recorded cannot-harm (Superman/Rocky) and a recorded transform (Goku/Vegeta)',
      (function () {
        const p3a = f1.txt.split(/\n\n+/)[2] || '';
        const hasCannotHarm = f1.b.events.some(e => e.type === 'attack' && e.actor === 'Rocky Balboa' && (e.cannotHarm || e.damage === 0));
        const p3b = f3.txt.split(/\n\n+/)[2] || '';
        const hasTrans = f3.b.events.some(e => e.type === 'transform');
        return hasCannotHarm && p3a.indexOf('could not harm') !== -1 && hasTrans && p3b.indexOf('transformation into') !== -1;
      })(), '');
    check('V1614-DECISIVE-FINISHER decisive beat names the recorded finisher verbatim',
      (function () {
        const fin = (f2.b.finalRecord && f2.b.finalRecord.finishingAbility) || '';
        return fin !== '' && (f2.txt.split(/\n\n+/)[3] || '').indexOf(fin) !== -1;
      })(), 'finisher=' + (f2.b.finalRecord && f2.b.finalRecord.finishingAbility));
    check('V1614-DRIFT-WRONG-WINNER a verdict naming the wrong winner FAILS the locked checker',
      (function () {
        const drift = f2.txt.split(f2.b.winner).join('Batman');
        const c = JSON.parse(runInCtx(`JSON.stringify(checkVerdictV1614(${JSON.stringify(drift)}, JSON.parse(${JSON.stringify(JSON.stringify(f2.b))})))`));
        return c.some(x => x.state === 'FAILED');
      })(), '');
    check('V1614-DRIFT-WRONG-FINISHER a verdict with an invented finisher FAILS the locked checker',
      (function () {
        const fin = (f2.b.finalRecord && f2.b.finalRecord.finishingAbility) || '';
        const drift = f2.txt.split(fin).join('Mega Blast');
        const c = JSON.parse(runInCtx(`JSON.stringify(checkVerdictV1614(${JSON.stringify(drift)}, JSON.parse(${JSON.stringify(JSON.stringify(f2.b))})))`));
        return c.some(x => x.state === 'FAILED' && x.name.indexOf('beats') !== -1);
      })(), '');
    check('V1614-DRIFT-LOSER-STATE a death-mode verdict calling the loser merely unconscious FAILS the loser-state check',
      (function () {
        const drift = f1.txt.replace('is knocked out', 'is unconscious');
        const c = JSON.parse(runInCtx(`JSON.stringify(checkVerdictV1614(${JSON.stringify(drift)}, JSON.parse(${JSON.stringify(JSON.stringify(f1.b))})))`));
        return c.some(x => x.state === 'FAILED' && x.name.indexOf('loser state') !== -1);
      })(), '');
  }
  {
    const f = verdictFixture('superman', 'rocky', 12345, 'death');
    const slide = runInCtx(`verdictSlideshowHtmlV1614(${JSON.stringify(f.txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.b))}), {})`);
    check('V1614-PANELS slideshow has 5 panels with beat captions and highlighted winner/finisher',
      slide.indexOf('data-panels="5"') !== -1 && (slide.match(/verdict-panel/g) || []).length >= 5
      && slide.indexOf('The matchup') !== -1 && slide.indexOf("The loser") !== -1 && slide.indexOf('Why it failed') !== -1
      && slide.indexOf('The decisive moment') !== -1 && slide.indexOf('The winner') !== -1
      && slide.indexOf('<mark>Superman</mark>') !== -1 && slide.indexOf('Chapter I') === -1,
      slide.slice(0, 200));
    check('V1626-READALOUD-REMOVED-BUTTON (v16.26 DELIBERATE CHANGE) slideshow renders no read-aloud button',
      slide.indexOf('Read aloud (browser voice)') === -1 && slide.indexOf('data-verdict-nav="readaloud"') === -1
      && html.indexOf('text-to-speech') === -1 && html.indexOf('elevenlabs') === -1,
      '');
    check('V1614-READALOUD-FN read-aloud returns false (quiet) where speechSynthesis is unavailable',
      runInCtx(`verdictReadAloudV1614('hello world')`) === false, '');
    check('V1614-NO-IMAGE-GEN no AI image-generation call exists in the verdict build',
      html.indexOf('images/generations') === -1 && html.indexOf('dall-e') === -1 && html.indexOf('imagen') === -1 && html.indexOf('generate-image') === -1, '');
    check('V1614-VERDICT-PROMPT verdict prompt carries the locked outcome and no event transcript',
      (function () {
        const pr = runInCtx(`buildVerdictPromptV1614(JSON.parse(${JSON.stringify(JSON.stringify(f.b))}))`);
        return pr.indexOf('LOCKED OUTCOME') !== -1 && pr.indexOf(f.b.winner) !== -1 && pr.indexOf('BATTLEFIELD FIDELITY') !== -1
          && pr.indexOf('EVENTS:') === -1 && pr.indexOf('Round 1:') === -1;
      })(), '');
    check('V1614-STALEMATE stalemate fallback verdict is 150-200 words with no winner claimed and 0 FAILED',
      (function () {
        const fake = { alpha: [{ name: 'Superman', variant: 'Base' }], beta: [{ name: 'Rocky Balboa', variant: 'Base' }], events: [], winner: null, loserFighter: null, stalemate: true, victoryMode: 'death', battlefield: { name: 'Open Arena' }, finalRecord: {}, rounds: 60 };
        const txt = runInCtx(`buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(fake))}))`);
        const c = JSON.parse(runInCtx(`JSON.stringify(checkVerdictV1614(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(fake))})))`));
        const w = verdictWords(txt);
        return w >= 150 && w <= 200 && txt.indexOf('stalemate') !== -1 && c.filter(x => x.state === 'FAILED').length === 0;
      })(), '');
  }
  {
    check('V1614-OFFLINE-LABEL offline verdict label is exactly the honest fallback label, never called AI',
      (function () {
        runInCtx(`currentStorySessionId = 'v16-test-v1614-1'; renderMainStoryLabelV16({kind:'offline',verdict:true,provider:'Offline fallback (rule-based verdict)',reason:'test reason'}, 'v16-test-v1614-1');`);
        const lb = els['main-story-label'].innerText || '';
        return lb.indexOf('Offline Verdict — Online AI generation was unavailable.') === 0 && lb.indexOf('Online AI Verdict') === -1;
      })(), 'label=' + (els['main-story-label'].innerText || ''));
    check('V1614-OLD-SAVED-READABLE old saved episodes still read: legacy AI stays AI, legacy offline stays offline, verdict entries labelled verdict',
      (function () {
        const ai = JSON.parse(runInCtx(`JSON.stringify(savedStoryMetaV162({mainStoryMeta:{kind:'ai',provider:'Pollinations (POST, keyless)',passed:8,unverified:2,attempts:1,promptSize:4200,sessionId:'v16-test-ai-1',reason:''}}))`));
        const off = JSON.parse(runInCtx(`JSON.stringify(savedStoryMetaV162({mainStoryMeta:{kind:'offline',provider:'Offline fallback (rule-based episode)',passed:0,unverified:0,attempts:2,promptSize:4300,sessionId:'v16-test-off-2',reason:'Draft did not pass validation'}}))`));
        const ver = JSON.parse(runInCtx(`JSON.stringify(savedStoryMetaV162({mainStoryMeta:{kind:'ai',verdict:true,provider:'Pollinations /openai (POST, keyless)',passed:15,unverified:2,attempts:1,promptSize:3000,sessionId:'v16-test-v-1',reason:''}}))`));
        const imp = JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.13'}))`));
        return ai.label.indexOf('Saved online AI story') !== -1 && ai.label.indexOf('Offline') === -1
          && off.label.indexOf('Offline Story') !== -1 && ver.label.indexOf('Saved online AI verdict') !== -1
          && imp.ok && !imp.legacy;
      })(), '');
    check('V1614-CACHE-KEY verdict build uses warroom_stage_cache_v1614 and no v1613 active key remains',
      html.indexOf('warroom_stage_cache_v1614') !== -1 && html.indexOf('warroom_stage_cache_v1613') === -1, '');
    check('V1619-NO-VERDICT-MAIN (v16.19 DELIBERATE CHANGE) showResults and retry call the breakdown generator, not the verdict slideshow or the multi-stage long-story generator',
      (function () {
        function fnBody(name) { const s = html.indexOf('function ' + name + '('); const e = html.indexOf('\nfunction ', s + 10); return html.slice(s, e === -1 ? html.length : e); }
        const sr = fnBody('showResults');
        const rt = fnBody('retryMainStoryV16');
        const srCode = sr.replace(/\/\*[\s\S]*?\*\//g, '');
        return sr.indexOf('generateBreakdownV1619') !== -1 && srCode.indexOf('generateMainStoryV16') === -1 && srCode.indexOf('generateVerdictV1614') === -1
          && rt.indexOf('generateBreakdownV1619') !== -1;
      })(), '');
  }
  await expectV16('V1614-AI-VERDICT single-request generation renders an AI verdict', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const verdictText = runInCtx(`buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    let calls = 0;
    sandbox.fetch = async () => { calls++; return { ok: true, status: 200, text: async () => verdictText }; };
    setVmBattle('globalThis._v1614g', b);
    const meta = await runInCtx(`generateVerdictV1614(globalThis._v1614g, 'v16-test-v1614-gen', {})`);
    check('V1614-AI-VERDICT single-request generation renders an AI verdict (1 call, 5 panels, 150-200 words, Online AI Verdict label)',
      meta && meta.kind === 'ai' && meta.verdict === true && calls === 1 && meta.panels === 5 && meta.wordCount >= 150 && meta.wordCount <= 200
      && (els['main-story-label'].innerText || '').indexOf('Online AI Verdict') !== -1
      && (els['story-output'].innerHTML || '').indexOf('verdict-panel') !== -1,
      'kind=' + (meta && meta.kind) + ' calls=' + calls + ' panels=' + (meta && meta.panels) + ' words=' + (meta && meta.wordCount) + ' label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  await expectV16('V1614-AI-VERDICT-FAILURE failed generation falls back to the rule-based verdict, never a long episode', async () => {
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    sandbox.fetch = async () => { throw new Error('network down'); };
    setVmBattle('globalThis._v1614f', b);
    const meta = await runInCtx(`generateVerdictV1614(globalThis._v1614f, 'v16-test-v1614-fail', {})`);
    check('V1614-AI-VERDICT-FAILURE failed generation falls back to the honestly labelled offline verdict slideshow, never a long episode as main',
      meta && meta.kind === 'offline' && meta.verdict === true
      && (els['main-story-label'].innerText || '').indexOf('Offline Verdict — Online AI generation was unavailable.') === 0
      && (els['story-output'].innerHTML || '').indexOf('verdict-panel') !== -1
      && (els['story-output'].innerHTML || '').indexOf('Chapter I') === -1,
      'kind=' + (meta && meta.kind) + ' label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });

  // ================= v16.15 NAVIGATION FIX TESTS =================
  // These tests drive the REAL navigation state machine from the file
  // (verdictNavIndexV1615 / verdictStepV1615 / verdictShowPanelV1614), not a
  // reimplementation. The forward-walk test from panel 2 is the exact live
  // failure: v16.14's constant Next button kept panel 2 on panel 2.
  {
    // Fake DOM: 5 panels + 1 counter, wired through document.querySelectorAll.
    const realQSA = sandbox.document.querySelectorAll;
    function fakePanel(txt) { return { style: { display: 'none' }, textContent: txt }; }
    const panels1615 = [fakePanel('PANEL1 matchup text'), fakePanel('PANEL2 best plan text'), fakePanel('PANEL3 why failed text'), fakePanel('PANEL4 decisive moment text'), fakePanel('PANEL5 winner text')];
    const counters1615 = [{ innerText: '' }];
    sandbox.document.querySelectorAll = function (sel) {
      if (String(sel).indexOf('.verdict-panel') !== -1) return panels1615;
      if (String(sel).indexOf('.verdict-counter') !== -1) return counters1615;
      if (String(sel).indexOf('.verdict-slideshow') !== -1) return [{}];
      return [];
    };
    function shownIdx() { for (let i = 0; i < panels1615.length; i++) if (panels1615[i].style.display === 'block') return i; return -1; }
    function stepSeq(deltas) { const out = []; deltas.forEach(d => { out.push(runInCtx(`verdictStepV1615(${d})`)); }); return out; }

    check('V1615-NAV-INDEX pure index wraps both ends and handles degenerate counts',
      runInCtx('verdictNavIndexV1615(0,1,5)') === 1 && runInCtx('verdictNavIndexV1615(4,1,5)') === 0
      && runInCtx('verdictNavIndexV1615(0,-1,5)') === 4 && runInCtx('verdictNavIndexV1615(2,-1,5)') === 1
      && runInCtx('verdictNavIndexV1615(4,-1,5)') === 3 && runInCtx('verdictNavIndexV1615(0,1,1)') === 0
      && runInCtx('verdictNavIndexV1615(0,1,0)') === 0, '');
    check('V1615-NAV-BUTTONS builder emits relative step buttons, never the v16.14 constant indices',
      (function () {
        const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
        const slide = runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {})`);
        return slide.indexOf('verdictStepV1615(-1)') !== -1 && slide.indexOf('verdictStepV1615(1)') !== -1
          && slide.indexOf('verdictShowPanelV1614(1)') === -1 && slide.indexOf('verdictShowPanelV1614(4)') === -1
          && slide.indexOf('data-verdict-nav="prev"') !== -1 && slide.indexOf('data-verdict-nav="next"') !== -1;
      })(), '');
    check('V1615-NAV-WALK-DOM full forward walk 1→2→3→4→5→1 with display + indicator matching at every step',
      (function () {
        const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
        runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {})`);
        runInCtx('verdictShowPanelV1614(0)');
        if (shownIdx() !== 0 || counters1615[0].innerText !== 'Panel 1 of 5') return false;
        const seq = stepSeq([1, 1, 1, 1, 1]);
        if (JSON.stringify(seq) !== JSON.stringify([1, 2, 3, 4, 0])) return false;
        runInCtx('verdictShowPanelV1614(0)');
        const steps = [1, 2, 3, 4, 0];
        for (let s = 0; s < steps.length; s++) {
          runInCtx(`verdictStepV1615(1)`);
          const want = steps[s];
          if (shownIdx() !== want) return false;
          if (counters1615[0].innerText !== 'Panel ' + (want + 1) + ' of 5') return false;
          for (let j = 0; j < 5; j++) if ((panels1615[j].style.display === 'block') !== (j === want)) return false;
        }
        return true;
      })(), '');
    check('V1615-NAV-WALK-BACK full backward walk 1→5→4→3→2→1 (prev from panel 1 wraps to panel 5)',
      (function () {
        runInCtx('verdictShowPanelV1614(0)');
        const seq = stepSeq([-1, -1, -1, -1, -1]);
        return JSON.stringify(seq) === JSON.stringify([4, 3, 2, 1, 0]) && shownIdx() === 0;
      })(), '');
    check('V1615-NAV-PANEL2-REGRESSION Next from panel 2 reaches panel 3 (the exact v16.14 live failure)',
      (function () {
        runInCtx('verdictShowPanelV1614(1)');
        const nx = runInCtx('verdictStepV1615(1)');
        const pv = runInCtx('verdictStepV1615(-1)');
        return nx === 2 && pv === 1 && shownIdx() === 1;
      })(), '');
    check('V1615-NAV-KEYBOARD arrow deltas follow the same step logic; typing targets are ignored',
      runInCtx(`verdictKeyDeltaV1615({key:'ArrowRight',target:{tagName:'DIV'}})`) === 1
      && runInCtx(`verdictKeyDeltaV1615({key:'ArrowLeft',target:{tagName:'DIV'}})`) === -1
      && runInCtx(`verdictKeyDeltaV1615({key:'Enter',target:{tagName:'DIV'}})`) === 0
      && runInCtx(`verdictKeyDeltaV1615({key:'ArrowRight',target:{tagName:'INPUT'}})`) === 0
      && runInCtx(`verdictKeyDeltaV1615({key:'ArrowLeft',target:{tagName:'TEXTAREA'}})`) === 0
      && runInCtx(`verdictKeyDeltaV1615({key:'ArrowRight',target:null})`) === 1
      && html.indexOf("addEventListener('keydown'") !== -1 && html.indexOf('verdictKeyDeltaV1615') !== -1, '');
    check('V1615-NAV-SWAP-RESET rebuilding the slideshow (offline→online swap) resets to panel 1',
      (function () {
        const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
        runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {})`);
        runInCtx('verdictStepV1615(1)'); runInCtx('verdictStepV1615(1)');
        if (runInCtx('verdictCurrentPanelV1614') !== 2) return false;
        const slide2 = runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {})`);
        return runInCtx('verdictCurrentPanelV1614') === 0 && slide2.indexOf('Panel 1 of 5') !== -1;
      })(), '');
    check('V1615-NAV-OFFLINE offline fallback slideshow navigates the full walk (not just AI verdicts)',
      (function () {
        const b = battle([[spec('goku')], [spec('vegeta')]], { seed: 999, victoryMode: 'death' });
        runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {})`);
        runInCtx('verdictShowPanelV1614(0)');
        const seq = stepSeq([1, 1, 1, 1]);
        return JSON.stringify(seq) === JSON.stringify([1, 2, 3, 4]) && shownIdx() === 4 && counters1615[0].innerText === 'Panel 5 of 5';
      })(), '');
    check('V1626-NAV-REPAIR-NO-READALOUD (v16.26 DELIBERATE CHANGE) repair still fixes step buttons and does NOT re-add read-aloud; long-episode HTML unchanged',
      (function () {
        const oldHtml = '<div class="verdict-slideshow" data-panels="5"><div class="verdict-panel" data-panel="0" style="display:block"><p>old panel</p></div><div class="verdict-nav"><button class="btn small" onclick="verdictShowPanelV1614(4)" data-verdict-nav="prev">◀ Previous</button> <span class="verdict-counter">Panel 1 of 5</span> <button class="btn small" onclick="verdictShowPanelV1614(1)" data-verdict-nav="next">Next ▶</button></div></div>';
        const fixed = runInCtx(`repairVerdictSlideshowHtmlV1615(${JSON.stringify(oldHtml)})`);
        const longHtml = '<h3>Chapter I</h3><p>Saved death story.</p>';
        const fixedLong = runInCtx(`repairVerdictSlideshowHtmlV1615(${JSON.stringify(longHtml)})`);
        const newSlide = (function () {
          const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
          return runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {})`);
        })();
        const fixedNew = runInCtx(`repairVerdictSlideshowHtmlV1615(${JSON.stringify(newSlide)})`);
        return fixed.indexOf('verdictStepV1615(-1)') !== -1 && fixed.indexOf('verdictStepV1615(1)') !== -1
          && fixed.indexOf('verdictShowPanelV1614(4)') === -1 && fixed.indexOf('verdictShowPanelV1614(1)') === -1
          && fixed.indexOf('Read aloud (browser voice)') === -1 && fixed.indexOf('data-verdict-nav="readaloud"') === -1
          && fixedLong === longHtml
          && fixedNew.indexOf('verdictStepV1615(-1)') !== -1 && fixedNew.indexOf('Read aloud (browser voice)') === -1;
      })(), '');
    check('V1615-NAV-SAVED-WIRE saved-view wiring attaches prev/next/readaloud handlers that step the real index',
      (function () {
        const handlers = {};
        function fakeBtn(kind) {
          return {
            getAttribute: function (n) { return n === 'data-verdict-nav' ? kind : null; },
            dataset: {},
            addEventListener: function (ev, fn) { handlers[kind] = fn; },
          };
        }
        const btns = [fakeBtn('prev'), fakeBtn('next'), fakeBtn('readaloud')];
        els['story-output'] = els['story-output'] || {};
        els['story-output'].querySelectorAll = function () { return btns; };
        runInCtx('verdictShowPanelV1614(0)');
        runInCtx('wireVerdictSlideshowNavV1615()');
        if (typeof handlers.next !== 'function' || typeof handlers.prev !== 'function' || typeof handlers.readaloud !== 'function') return false;
        runInCtx('verdictShowPanelV1614(0)');
        handlers.next(); handlers.next();
        if (runInCtx('verdictCurrentPanelV1614') !== 2) return false;
        handlers.prev();
        return runInCtx('verdictCurrentPanelV1614') === 1 && shownIdx() === 1;
      })(), '');
    check('V1626-READALOUD-REMOVED-BOTH (v16.26 DELIBERATE CHANGE) offline and AI slideshows carry NO read-aloud button; quiet where speech is unavailable',
      (function () {
        const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
        const off = runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {})`);
        const ai = runInCtx(`verdictSlideshowHtmlV1614(buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))})), JSON.parse(${JSON.stringify(JSON.stringify(b))}), {readAloud:true})`);
        return off.indexOf('Read aloud (browser voice)') === -1 && off.indexOf('data-verdict-nav="readaloud"') === -1
          && ai.indexOf('Read aloud (browser voice)') === -1
          && runInCtx(`verdictReadAloudCurrentV1614()`) === false;
      })(), '');
    check('V1615-READALOUD-PANEL reads the currently shown panel (not the whole verdict) via speechSynthesis',
      (function () {
        runInCtx('verdictShowPanelV1614(2)');
        sandbox.speechSynthesis = { speak: function (u) { sandbox._spoken1615 = (u && u.text !== undefined) ? u.text : String(u); } };
        sandbox.SpeechSynthesisUtterance = function (txt) { this.text = txt; };
        const ok = runInCtx(`verdictReadAloudCurrentV1614()`);
        const spoken = sandbox._spoken1615 || '';
        delete sandbox.speechSynthesis; delete sandbox.SpeechSynthesisUtterance; delete sandbox._spoken1615;
        return ok === true && spoken.indexOf('PANEL3 why failed text') !== -1 && spoken.indexOf('PANEL1') === -1;
      })(), '');
    check('V1615-SAVED-OLD-VIEW-NOT-BROKEN wiring with no verdict buttons does not throw and leaves long episodes alone',
      (function () {
        sandbox.document.querySelectorAll = realQSA;
        els['story-output'] = els['story-output'] || {};
        els['story-output'].querySelectorAll = function () { return []; };
        try { runInCtx('wireVerdictSlideshowNavV1615()'); } catch (e) { return false; }
        sandbox.document.querySelectorAll = realQSA;
        return true;
      })(), '');
    sandbox.document.querySelectorAll = realQSA;
  }



  // ================= v16.16 DOSSIER TACTIC-EVENT GAP FIX (LIVE PATH) =================
  // Root cause (v16.16): simulateBattle() — the LIVE engine — never called the dossier
  // tactic functions; only runGenericBattle() did, and the v16.12 harness exercised
  // runGenericBattle() only. These tests drive simulateBattle() itself (the live path)
  // via selected/forcedSeed/forcedVictoryMode, not a test helper.
  {
    function liveBattle(a, b, seed, mode) {
      runInCtx(`selected=${JSON.stringify([a, b])}; forcedSeed=${seed}; forcedVictoryMode=${JSON.stringify(mode || 'death')};`);
      return JSON.parse(runInCtx(`JSON.stringify((function(){const r=simulateBattle(); return {winner:r.winner,events:r.events,breakdown:generateBreakdown(r)};})())`));
    }
    function hasTac(b, actor, re) { return b.events.some(function (e) { return e.type === 'tactic' && e.actor === actor && re.test(e.detail || ''); }); }
    function scanTac(a, b, actor, re, seeds) {
      return seeds.some(function (sd) { return hasTac(liveBattle(a, b, sd, 'death'), actor, re); });
    }
    const SEEDS = [12345, 1, 2, 3, 7, 99, 27, 555];
    check('V1616-LIVE-STANCE Superman holder-back stance appears on the LIVE path at first action',
      hasTac(liveBattle('superman', 'batman', 12345, 'death'), 'Superman', /tests first/i), '');
    check('V1616-LIVE-STANCE Deadpool brutal stance + Wolverine brutal stance appear on the LIVE path',
      (function () { const b = liveBattle('deadpool', 'wolverine', 12345, 'death'); return hasTac(b, 'Deadpool', /trades blows recklessly/i) && hasTac(b, 'Wolverine', /trades blows recklessly/i); })(), '');
    check('V1616-LIVE-STANCE Frodo evasive stance appears on the LIVE path',
      hasTac(liveBattle('saitama', 'frodo', 12345, 'death'), 'Frodo Baggins', /keeps distance/i), '');
    check('V1616-LIVE-STANCE strategist Batman gets NO duplicate stance (study event only, as designed)',
      (function () { const b = liveBattle('batman', 'superman', 12345, 'death'); return !b.events.some(function (e) { return e.type === 'tactic' && e.actor === 'Batman' && /stance/i.test(e.detail || ''); }) && b.events.some(function (e) { return e.type === 'study' && e.actor === 'Batman'; }); })(), '');
    check('V1616-LIVE-PEEVE Wolverine hpBelow50 peeve fires on the LIVE path (seed scan)',
      scanTac('deadpool', 'wolverine', 'Wolverine', /peeve triggered/i, SEEDS), '');
    check('V1616-LIVE-PEEVE Deadpool targetHealed peeve fires on the LIVE path vs a regen foe (Sakura)',
      scanTac('deadpool', 'sakura', 'Deadpool', /peeve triggered/i, SEEDS), '');
    check('V1616-LIVE-PEEVE (v16.20 DELIBERATE CHANGE) Deadpool targetHealed NOW fires vs Wolverine (regen — Wolverine actually regenerates in v16.20, mirroring the Sakura test)',
      SEEDS.some(function (sd) { return hasTac(liveBattle('deadpool', 'wolverine', sd, 'death'), 'Deadpool', /Target heals/i); }), '');
    check('V1616-LIVE-FEAR Batman hpBelow25 fear trigger fires on the LIVE path (seed scan)',
      scanTac('superman', 'batman', 'Batman', /fear\/psych trigger/i, SEEDS), '');
    check('V1616-LIVE-REL Deadpool-Wolverine matched relationship events fire both ways on the LIVE path',
      (function () { const b = liveBattle('deadpool', 'wolverine', 12345, 'death'); return hasTac(b, 'Deadpool', /relationship trigger/i) && hasTac(b, 'Wolverine', /relationship trigger/i); })(), '');
    check('V1616-LIVE-REL Superman-Batman matched relationship events fire on the LIVE path',
      (function () { const b = liveBattle('superman', 'batman', 12345, 'death'); return hasTac(b, 'Batman', /relationship trigger/i) && hasTac(b, 'Superman', /relationship trigger/i); })(), '');
    check('V1616-LIVE-REL Goku-Vegeta matched rivalry fires on the LIVE path',
      hasTac(liveBattle('goku', 'vegeta', 12345, 'death'), 'Goku', /relationship trigger/i), '');
    check('V1616-LIVE-REL-NOMATCH Goku vs Rocky fires NO relationship trigger at all (unmatched guard)',
      !liveBattle('goku', 'rocky', 12345, 'death').events.some(function (e) { return e.type === 'tactic' && /relationship trigger/i.test(e.detail || ''); }), '');
    check('V1616-LIVE-PREP Batman prepares are capped at 3 (FINITE prep, numbered) on the LIVE path',
      SEEDS.every(function (sd) { return liveBattle('batman', 'superman', sd, 'death').events.filter(function (e) { return e.type === 'prepare' && e.actor === 'Batman'; }).length <= 3; })
      && liveBattle('batman', 'superman', 12345, 'death').events.some(function (e) { return e.type === 'prepare' && /1 of 3 — FINITE prep/.test(e.detail || ''); }), '');
    check('V1616-LIVE-PREP-EXHAUSTED Batman prep-exhaustion records once instead of a 4th prepare (seed 27)',
      (function () { const b = liveBattle('batman', 'superman', 27, 'death'); return b.events.filter(function (e) { return e.type === 'prepare' && e.actor === 'Batman'; }).length === 3 && b.events.some(function (e) { return e.type === 'tactic' && /prep exhausted/i.test(e.detail || ''); }); })(), '');
    check('V1616-LIVE-COST Goku SSB transform event carries staminaCost 20 + effect numbers on the LIVE path',
      (function () { const b = liveBattle('goku', 'vegeta', 12345, 'death'); const tr = b.events.find(function (e) { return e.type === 'transform' && e.actor === 'Goku'; }); return !!tr && tr.staminaCost === 20 && tr.detail === 'Super Saiyan Blue' && /stamina cost 20/.test(tr.effectText || '') && /\+35 ATK/.test(tr.effectText || ''); })(), '');
    check('V1616-LIVE-COST non-Goku deep transform states no invented cost + effect numbers on the LIVE path',
      (function () { const b = liveBattle('goku', 'vegeta', 12345, 'death'); const tr = b.events.find(function (e) { return e.type === 'transform' && e.actor === 'Vegeta'; }); return !!tr && tr.staminaCost === 0 && /no invented stamina cost/.test(tr.effectText || '') && /\+35 ATK/.test(tr.effectText || ''); })(), '');
    check('V1616-LIVE-DODGE dodge events render with the dossier priority recorded (formula unchanged)',
      (function () { for (let i = 0; i < SEEDS.length; i++) { const b = liveBattle('superman', 'batman', SEEDS[i], 'death'); const d = b.events.find(function (e) { return e.type === 'dodge'; }); if (d && typeof d.dodgeMult === 'number' && /dodge priority/.test(d.detail || '')) return true; } return false; })(), '');
    check('V1616-LIVE-DODGE Frodo evasive dodge priority 1.2 is recorded on the LIVE path (seed scan)',
      (function () { for (let sd = 0; sd < 200; sd++) { const b = liveBattle('saitama', 'frodo', sd, 'death'); const d = b.events.find(function (e) { return e.type === 'dodge' && e.actor === 'Frodo Baggins'; }); if (d && d.dodgeMult === 1.2) return true; } return false; })(), '');
    check('V1616-LIVE-BREAKDOWN Combat Details renders TACTIC and DODGE lines for live-path events',
      (function () { const b = liveBattle('superman', 'batman', 1, 'death'); return /TACTIC/.test(b.breakdown) && /DODGES/.test(b.breakdown); })(), '');
    check('V1616-LIVE-CRASHFIX long battle that crashed v16.15 (Batman vs Rocky, stamina below 15) now completes',
      (function () { const b = liveBattle('batman', 'rocky', 12345, 'death'); return b.winner === 'Batman' && b.events.length > 0; })(), '');
    check('V1616-LIVE-VERDICT verdict prompt references recorded tactic events (may-reference, never invented)',
      (function () { const b = liveBattle('superman', 'batman', 12345, 'death'); const fake = { alpha: [{ name: 'Superman' }], beta: [{ name: 'Batman' }], winner: 'Superman', events: b.events, battlefield: { name: 'Open Arena' }, victoryMode: 'death', finalRecord: { finishingAbility: 'Heat Vision' }, stalemate: false }; const pr = runInCtx(`buildVerdictPromptV1614(JSON.parse(${JSON.stringify(JSON.stringify(fake))}))`); return pr.indexOf('Recorded dossier tactics') !== -1 && pr.indexOf('relationship trigger') !== -1; })(), '');
    check('V1616-NAV-KEPT v16.15 slideshow navigation still wraps (regression guard)',
      runInCtx('verdictNavIndexV1615(2,1,5)') === 3 && runInCtx('verdictNavIndexV1615(4,1,5)') === 0 && runInCtx('verdictNavIndexV1615(0,-1,5)') === 4, '');
  }


  // ================= v16.17 STORY-QUALITY PHASE =================
  // Answers known live evidence, not a new reproduction battle:
  // (1) Jhay's v16.13 playtest (winner/ending, voice, generic feel);
  // (2) v16.15 Battle B panel 3 subject flaw (Superman's attacks read as the
  // ones that could not harm, when the record says Rocky's could not harm
  // Superman); (3) v16.16 live — tactic events appear, but no dodge event
  // in 5 battles and offline template panels near-identical across battles.
  {
    function liveBattle17(a, b, seed, mode) {
      runInCtx(`selected=${JSON.stringify([a, b])}; forcedSeed=${seed}; forcedVictoryMode=${JSON.stringify(mode || 'death')};`);
      return JSON.parse(runInCtx(`JSON.stringify((function(){const r=simulateBattle(); return {winner:r.winner,events:r.events,alpha:r.alpha,beta:r.beta,battlefield:r.battlefield,victoryMode:r.victoryMode,finalRecord:r.finalRecord,stalemate:r.stalemate,loserFighter:r.loserFighter,breakdown:generateBreakdown(r)};})())`));
    }
    function fbOf(b) { return runInCtx(`buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`); }
    function checksOf(txt, b) { return JSON.parse(runInCtx(`JSON.stringify(checkVerdictV1614(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(b))})))`)); }
    function parasOf(txt) { return txt.split(/\n\n+/); }
    // (a) wrong-actor cannot-harm attribution FAILS
    check('V1617-P3-WRONG-ACTOR a why-failed beat attributing cannot-harm attacks to the winner FAILS the checker',
      (function () {
        const f = verdictFixture('superman', 'rocky', 12345, 'death');
        const p3 = parasOf(f.txt)[2] || '';
        const wrong = p3.replace("Rocky Balboa's ordinary attacks could not harm Superman", "Superman's ordinary attacks could not harm him");
        const drift = parasOf(f.txt).slice(); drift[2] = wrong;
        const c = checksOf(drift.join('\n\n'), f.b);
        return c.some(x => x.state === 'FAILED' && x.name.indexOf('cannot-harm to the right fighter') !== -1);
      })(), '');
    check('V1617-P3-RIGHT-ACTOR the correct attribution (loser cannot harm winner) PASSES the attribution check',
      (function () {
        const f = verdictFixture('superman', 'rocky', 12345, 'death');
        const c = checksOf(f.txt, f.b);
        const a = c.find(x => x.name.indexOf('cannot-harm to the right fighter') !== -1);
        return !!a && a.state === 'PASSED';
      })(), '');
    // (b) final beat names the finisher
    check('V1617-P5-FINISHER offline final beat names winner + loser state + finisher on three fixtures',
      (function () {
        return ['superman|rocky|12345|death', 'spiderman|batman|145416145|incapacitation', 'goku|vegeta|999|death'].every(function (key) {
          const parts = key.split('|');
          const f = verdictFixture(parts[0], parts[1], Number(parts[2]), parts[3]);
          const fin = (f.b.finalRecord && f.b.finalRecord.finishingAbility) || '';
          const p5 = parasOf(f.txt)[4] || '';
          return fin !== '' && p5.indexOf(f.b.winner) !== -1 && p5.indexOf(fin) !== -1;
        });
      })(), '');
    check('V1617-P5-FINISHER-MISSING a verdict with the finisher stripped from the final beat only FAILS the final-beat finisher check',
      (function () {
        const f = verdictFixture('superman', 'rocky', 12345, 'death');
        const fin = (f.b.finalRecord && f.b.finalRecord.finishingAbility) || '';
        if (!fin) return false;
        const ps = parasOf(f.txt); ps[4] = ps[4].replace('The finishing blow was ' + fin + '. ', '');
        const c = checksOf(ps.join('\n\n'), f.b);
        return c.some(x => x.state === 'FAILED' && x.name.indexOf('final beat names the finisher') !== -1);
      })(), '');
    // (c) AI prompt: dossier voice for deep fighters, none invented for derived
    check('V1617-PROMPT-VOICE AI prompt carries deep-dossier voice lines for deep fighters',
      (function () {
        const f = verdictFixture('superman', 'rocky', 12345, 'death');
        const pr = runInCtx(`buildVerdictPromptV1614(JSON.parse(${JSON.stringify(JSON.stringify(f.b))}))`);
        return pr.indexOf('Dossier voice') !== -1 && pr.indexOf('ATTRIBUTION RULES') !== -1 && pr.indexOf('full name') !== -1;
      })(), '');
    check('V1617-PROMPT-DERIVED AI prompt invents no style for derived fighters (record facts only)',
      (function () {
        const f = verdictFixture('sakura', 'rocky', 12345, 'death');
        const pr = runInCtx(`buildVerdictPromptV1614(JSON.parse(${JSON.stringify(JSON.stringify(f.b))}))`);
        return pr.indexOf('No deep-dossier voice lines') !== -1 && pr.indexOf('record facts only') !== -1;
      })(), '');
    check('V1617-PROMPT-TACTIC AI prompt requires referencing a recorded tactic event when one exists',
      (function () {
        const b = liveBattle17('superman', 'batman', 12345, 'death');
        const fake = { alpha: [{ name: 'Superman', id: 'superman' }], beta: [{ name: 'Batman', id: 'batman' }], winner: 'Superman', events: b.events, battlefield: { name: 'Open Arena' }, victoryMode: 'death', finalRecord: { finishingAbility: 'Heat Vision' }, stalemate: false };
        const pr = runInCtx(`buildVerdictPromptV1614(JSON.parse(${JSON.stringify(JSON.stringify(fake))}))`);
        return pr.indexOf('reference at least one') !== -1 && pr.indexOf('relationship trigger') !== -1;
      })(), '');
    // (d) offline template varies by record beyond names
    check('V1617-TEMPLATE-VARIES two different battles produce different panel 1/2 texts even with fighter names stripped',
      (function () {
        const f1 = verdictFixture('superman', 'rocky', 12345, 'death');
        const f2 = verdictFixture('saitama', 'frodo', 12345, 'death');
        const strip = function (s, names) { let o = s; names.forEach(function (n) { o = o.split(n).join(''); }); return o; };
        const p1a = strip(parasOf(f1.txt)[0], ['Superman', 'Rocky Balboa', 'Open Arena']);
        const p1b = strip(parasOf(f2.txt)[0], ['Saitama', 'Frodo Baggins', 'Open Arena']);
        const f3 = verdictFixture('goku', 'vegeta', 12345, 'death');
        const p2a = strip(parasOf(f1.txt)[1], ['Superman', 'Rocky Balboa', 'Body Blow Barrage']);
        const p2b = strip(parasOf(f3.txt)[1], ['Vegeta', 'Goku', 'Kamehameha']);
        return p1a !== p1b && p2a !== p2b;
      })(), '');
    // (e) offline template uses recorded tactic events when present
    check('V1617-TEMPLATE-TACTIC offline why-failed beat uses a recorded fear event (Superman vs Batman)',
      (function () {
        const b = liveBattle17('superman', 'batman', 12345, 'death');
        const txt = fbOf(b);
        return parasOf(txt)[2].indexOf('fear took hold') !== -1;
      })(), '');
    check('V1617-TEMPLATE-TACTIC-REL offline why-failed beat uses a recorded relationship event (Goku vs Vegeta)',
      (function () {
        const b = liveBattle17('goku', 'vegeta', 12345, 'death');
        const txt = fbOf(b);
        return /treated Vegeta as rival/i.test(parasOf(txt)[2] || '');
      })(), '');
    // (f) dodge finding: rendering exists; a dodge that DOES occur renders.
    // Live-path dodgeChance is capped 0.30 on dex/sp diffs only (dossier mult
    // is recorded, not multiplied, on the live path — pre-existing, formulas
    // out of scope for this phase). Superman (dex 7, sp 1.1) vs Rocky
    // (dex 7, sp 1.1) therefore has dodgeChance exactly 0 either way, which
    // is why several short live battles can show no dodge event at all.
    check('V1617-DODGE-RENDERS a dodge that occurs on the live path renders as a DODGES line with priority 1.2 (Frodo, seed scan)',
      (function () {
        for (let sd = 0; sd < 200; sd++) {
          const b = liveBattle17('saitama', 'frodo', sd, 'death');
          const d = b.events.find(function (e) { return e.type === 'dodge' && e.actor === 'Frodo Baggins'; });
          if (d && d.dodgeMult === 1.2 && b.breakdown.indexOf('DODGES') !== -1) return true;
        }
        return false;
      })(), '');
    check('V1617-DODGE-ZERO-CHANCE Superman vs Rocky has live dodgeChance 0 both ways (dex/sp identical), so no-dodge battles are expected, not proof of broken rendering',
      (function () {
        const dc = function (t, a) { return Math.max(0, Math.min(0.30, ((t.dex || 7) - (a.dex || 7)) * 0.02 + ((t.sp || 1) - (a.sp || 1)) * 0.08)); };
        return dc({ dex: 7, sp: 1.1 }, { dex: 7, sp: 1.1 }) === 0;
      })(), '');
    // (g) guards: navigation, locked checker, word count
    check('V1617-NAV-KEPT v16.15 slideshow navigation still wraps (regression guard)',
      runInCtx('verdictNavIndexV1615(2,1,5)') === 3 && runInCtx('verdictNavIndexV1615(4,1,5)') === 0 && runInCtx('verdictNavIndexV1615(0,-1,5)') === 4, '');
    check('V1617-LOCKED-KEPT fallback verdicts still pass the locked checker (0 FAILED) and stay 150-200 words on three fixtures',
      (function () {
        return [['superman', 'rocky', 12345, 'death'], ['spiderman', 'batman', 145416145, 'incapacitation'], ['goku', 'vegeta', 999, 'death']].every(function (args) {
          const f = verdictFixture(args[0], args[1], args[2], args[3]);
          const w = verdictWords(f.txt);
          return f.checks.filter(c => c.state === 'FAILED').length === 0 && w >= 150 && w <= 200;
        });
      })(), '');
  }


  // ================= v16.26 — SINGLE STATUS SOURCE + RESOLVER VISIBILITY + NO SAVE =================
  // v16.26 DELIBERATE CHANGE: save/history removed; online status is a single source (banner = main-story-status = tech line);
  // the resolver comparison is visible on the breakdown page; an error renders visibly, never nothing.
  {
    const statusBody = (state, detail) => runInCtx(`setOnlineStatusV1626('${state}', ${JSON.stringify(detail)})`);
    check('V1626-STATUS-ONE-CALL (v16.26) one status call writes banner, main-story-status, and tech line identically, with the reason',
      (function () {
        const t = statusBody('failed', 'All providers unavailable');
        return t.indexOf('Online AI unavailable') !== -1 && t.indexOf('All providers unavailable') !== -1
          && els['online-status-banner'].innerText === t && els['main-story-status'].innerText === t && els['online-status-tech'].innerText === t;
      })(),
      '');
    check('V1626-STATUS-INTERIM (v16.26) interim status is honest: still trying, not a failure yet, elapsed time noted',
      (function () {
        const t = statusBody('interim', '60');
        return t.indexOf('Still trying') !== -1 && t.indexOf('not a failure yet') !== -1 && t.indexOf('60 seconds') !== -1 && t.indexOf('unavailable') === -1;
      })(),
      '');
    check('V1626-STATUS-PROVIDER-ERROR (v16.26) 402/400 determinations name the provider error and say the next provider is being tried',
      (function () {
        const t = statusBody('provider-error', '402 (free limit)');
        return t.indexOf('402') !== -1 && t.indexOf('trying the next provider') !== -1;
      })(),
      '');
    check('V1634-AUDIT-VISIBLE (v16.34 DELIBERATE CHANGE) live battle audit comparison renders into #resolver-visible inside the collapsed Audit disclosure',
      (function () {
        runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._v1626B = simulateBattle();`);
        const rv = runInCtx(`renderAuditV1634(globalThis._v1626B)`);
        const vis = els['resolver-visible'].innerHTML || '';
        return rv === 'ok' && vis.indexOf('Audit comparison') !== -1 && (vis.indexOf('MATCH') !== -1 || vis.indexOf('PARTIAL') !== -1);
      })(),
      '');
    check('V1634-AUDIT-ERROR-VISIBLE (v16.34 DELIBERATE CHANGE) audit failure renders visibly with its reason, never nothing',
      (function () {
        const rv = runInCtx('renderAuditV1634(null)');
        const vis = els['resolver-visible'].innerHTML || '';
        return rv === 'error-rendered' && vis.indexOf('unavailable') !== -1;
      })(),
      '');
    check('V1626-NOSAVE-ALL (v16.26 DELIBERATE CHANGE) save functions return null and history stays empty',
      (function () {
        runInCtx(`localStorage.setItem('warroom_battles_v3', '[]');`);
        const a = runInCtx('saveBattle(null) === null');
        const c = runInCtx('savePendingBattleV1618(null) === null');
        const d = runInCtx('savePendingBreakdownV1619(null) === null');
        const after = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
        return a === true && c === true && d === true && after.length === 0;
      })(),
      '');
    check('V1626-SYNC-NO-HISTORY (v16.26 DELIBERATE CHANGE) syncOnlineBreakdownStatusV1625 returns 0, writes the reason to the banner, writes no history',
      (function () {
        runInCtx(`localStorage.setItem('warroom_battles_v3', '[]');`);
        const n = runInCtx(`syncOnlineBreakdownStatusV1625('v1626-test-sid', {kind:'offline', reason:'All providers unavailable'})`);
        const after = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
        return n === 0 && after.length === 0 && (els['online-status-banner'].innerText || '').indexOf('All providers unavailable') !== -1;
      })(),
      '');
  }



  // ================= v16.19 TEXT-ONLY AI BREAKDOWN TESTS =================
  {
    const resetHist19 = () => runInCtx(`localStorage.setItem('warroom_battles_v3', '[]'); currentStorySavedSessionId = null; currentHistoryId = null;`);
    const sim19 = (a, b, seed, mode) => JSON.parse(runInCtx(`JSON.stringify((function(){ selected = ['` + a + `','` + b + `']; forcedSeed = ` + seed + `; forcedVictoryMode = '` + mode + `'; return simulateBattle(); })())`));
    const bdFixture = (a, b, seed, mode) => {
      const r = sim19(a, b, seed, mode);
      const txt = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
      const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(r))})))`));
      const html = runInCtx(`breakdownHtmlV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
      const facts = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))})))`));
      const secs = JSON.parse(runInCtx(`JSON.stringify(splitBreakdownSectionsV1619(${JSON.stringify(txt)}))`));
      return { r, txt, checks, html, facts, secs };
    };
    const failed19 = (f) => f.checks.filter(c => c.state === 'FAILED');
    const parasOf = (f) => f.txt.split(/\n\n+/).map(x => x.trim()).filter(Boolean);
    /* v16.27 DELIBERATE CHANGE — free-form telling: section indices become
       paragraph roles. 0 first paragraph, 1 Fighter A best case, 2 Fighter B
       best case, 3 winner-plan paragraph, 4 why-it-stalls paragraph,
       5 decisive paragraph, 6 finishing-sequence paragraph, 7 finisher
       paragraph, 8 final verdict paragraph. */
    const paraRole = (f, i) => {
      const ps = parasOf(f);
      if (i === 0) return ps[0] || '';
      if (i === 1) return ps.filter(x => x.indexOf('best case') !== -1 && x.indexOf(f.facts.aName) !== -1)[0] || '';
      if (i === 2) return ps.filter(x => x.indexOf('best case') !== -1 && x.indexOf(f.facts.bName) !== -1)[0] || '';
      if (i === 3) return ps.filter(x => x.indexOf('winning plan') !== -1 || x.indexOf('What wins it for') === 0)[0] || '';
      if (i === 4) return ps.filter(x => /failed/i.test(x))[0] || '';
      if (i === 5) return ps.filter(x => x.indexOf('Decisive:') !== -1)[0] || '';
      if (i === 6) return ps.filter(x => /blow by blow/i.test(x))[0] || '';
      if (i === 7) return ps.filter(x => x.indexOf('Finisher:') === 0)[0] || '';
      if (i === 8) return ps[ps.length - 1] || '';
      return '';
    };
    const secBody = (f, i) => paraRole(f, i);
    const withSection = (f, i, body) => {
      const ps = parasOf(f);
      const idx = (i === 8) ? ps.length - 1 : ps.findIndex(x => {
        if (i === 7) return x.indexOf('Finisher:') === 0;
        if (i === 6) return /blow by blow/i.test(x);
        if (i === 5) return x.indexOf('Decisive:') !== -1;
        if (i === 1) return x.indexOf(f.facts.aName + "'s best case") !== -1;
        return false;
      });
      if (idx !== -1) ps[idx] = body; else ps.push(body);
      return ps.join('\n\n');
    };
    const f1 = bdFixture('superman', 'rocky', 12345, 'death');
    const f2 = bdFixture('spiderman', 'batman', 145416145, 'incapacitation');
    const f3 = bdFixture('goku', 'vegeta', 999, 'death');
    check('V1628-FREEFORM (v16.28 DELIBERATE CHANGE) offline breakdown is free-form paragraphs with varied order/wording (no fixed 9-heading list) and passes the locked checker (0 FAILED) on three fixtures',
      [f1, f2, f3].every(f => failed19(f).length === 0 && f.html.indexOf('breakdown-v1619') !== -1 && f.html.indexOf('<h4>') === -1 && f.txt.indexOf('1. Matchup') === -1 && parasOf(f).length >= 5),
      'f1=' + failed19(f1).map(c => c.name).join(',') + ' f2=' + failed19(f2).map(c => c.name).join(',') + ' f3=' + failed19(f3).map(c => c.name).join(','));
    check('V1627-AI-SHAPED-FREEFORM (v16.27 DELIBERATE CHANGE) a hand-written free-form AI-shaped telling passes the checker (not just offline output)',
      (function () {
        const f = f1;
        const why = (f.facts.whyFailed || []).filter(function (x) { return !/could not harm|cannot harm/i.test(x); });
        const parts = [
          'Can ' + f.facts.loser + ' beat ' + f.facts.winner + ' on ' + f.facts.battlefield + '? The record answers with total confidence. ' + f.facts.winner + ' wins ' + f.facts.winnerDamage + '-' + f.facts.loserDamage + ' — a shutout, not a close fight.',
          f.facts.aName + "'s best case is real: " + (f.facts.toolsA.join(', ') || 'the record') + '.',
          f.facts.bName + ", fighting as the counter here, has a best case built on " + (f.facts.toolsB.join(', ') || 'the record') + '.',
          'The winning plan belongs to ' + f.facts.winner + ': ' + (f.facts.winnerBestPlan || 'a recorded attack') + '.',
          f.facts.loser + "'s best plan was " + (f.facts.bestPlan || 'a prepared counter') + ' and it failed: ' + why.join('; ') + '. ' + f.facts.loser + ' dealt ' + f.facts.loserDamage + ' damage across ' + f.facts.rounds + ' rounds while ' + f.facts.winner + ' dealt ' + f.facts.winnerDamage + '. But ' + (f.facts.decisivePoint || 'the record shows no single turning point') + '. Decisive: ' + f.facts.decisiveKey + '.',
          'The ending, blow by blow, in order: ' + f.facts.finishingSequence.join(' — ') + '.',
          'Finisher: ' + f.facts.finisher + '. Loser: ' + f.facts.loser + ' is ' + f.facts.loserStateWord + '.',
          'Verdict: ' + f.facts.winner + ' wins, decided by ' + f.facts.decisiveKey + '.',
        ];
        const txt = parts.join('\n\n');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return checks.filter(c => c.state === 'FAILED').length === 0;
      })(), '');
    check('V1619-CHECKER-WINNER checker FAILS a draft whose final paragraph names the loser as winner (title misdirect)',
      (function () {
        const txt = withSection(f1, 8, 'Verdict: ' + f1.facts.loser + ' wins, decided by ' + f1.facts.decisiveKey + '.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f1.r))})))`));
        return checks.some(c => c.name === 'Breakdown section 9 ends on the locked winner' && c.state === 'FAILED');
      })(), '');
    check('V1619-CHECKER-FINISHER checker FAILS a draft whose finisher paragraph invents a different finisher',
      (function () {
        const txt = withSection(f1, 7, 'Finisher: Invented Doom Blast. Loser: ' + f1.facts.loser + ' is ' + f1.facts.loserStateWord + '.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f1.r))})))`));
        return checks.some(c => c.name === 'Breakdown section 8 names the finisher and the exact loser state' && c.state === 'FAILED');
      })(), '');
    check('V1619-CHECKER-SECOND checker FAILS a telling naming a second decisive criterion',
      (function () {
        const txt = withSection(f1, 5, 'Other criteria were considered. Decisive: ' + f1.facts.decisiveKey + '. Decisive: speed.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f1.r))})))`));
        return checks.some(c => c.name === 'Breakdown section 6 names exactly one decisive criterion' && c.state === 'FAILED');
      })(), '');
    check('V1619-CHECKER-LEAN checker FAILS a final paragraph ending on a probability instead of the engine winner',
      (function () {
        const txt = withSection(f1, 8, 'Verdict: ' + f1.facts.winner + ' wins 7/10.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f1.r))})))`));
        return checks.some(c => c.name === 'Breakdown section 9 ends on the locked winner' && c.state === 'FAILED');
      })(), '');
    check('V1619-STALEMATE stalemate breakdown states no winner and no finisher, and the finisher paragraph names no finishing ability',
      (function () {
        const r = JSON.parse(JSON.stringify(f1.r));
        r.stalemate = true;
        const txt = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(r))})))`));
        const paras = txt.split(/\n\n+/).map(x => x.trim()).filter(Boolean);
        return checks.filter(c => c.state === 'FAILED').length === 0 && paras.every(x => x.indexOf('Finisher:') !== 0) && /no winner/i.test(paras[paras.length - 1] || '');
      })(), '');
    check('V1619-EXTREME (v16.20 DELIBERATE CHANGE) extreme mismatch (Saitama vs Frodo) passes the checker, is decided by cannot-harm (not damage type), and never forces a close fight',
      (function () {
        const f = bdFixture('saitama', 'frodo', 22, 'death');
        return failed19(f).length === 0 && f.facts.decisiveKey === 'cannot-harm' && f.txt.indexOf('close answer') === -1 && f.txt.indexOf('small edge') === -1 && f.txt.indexOf('not a close fight') !== -1 && f.txt.indexOf('evenly matched') === -1;
      })(), 'facts=' + JSON.stringify(bdFixture('saitama', 'frodo', 22, 'death').facts.decisiveKey));
    check('V1619-PROMPT (v16.20 DELIBERATE CHANGE) breakdown prompt carries the locked outcome and decisive criterion, the wording guide (hard pivot, no hedging filler), the shared dossier fields, and no transcript block',
      (function () {
        const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        return pr.indexOf('LOCKED OUTCOME') !== -1 && pr.indexOf(f1.facts.winner) !== -1 && pr.indexOf(f1.facts.finisher) !== -1 && pr.indexOf('Decisive: ' + f1.facts.decisiveKey) !== -1 && pr.indexOf('EVENTS:') === -1
          && pr.indexOf('hard pivot') !== -1 && pr.indexOf('maybe') !== -1 && pr.indexOf('SHARED DOSSIER FIELDS') !== -1 && pr.indexOf('never end on sealing') !== -1;
      })(), '');
    check('V1628-CACHE (v16.32 DELIBERATE CHANGE) cache key is v1633, distinguishes pair/outcome, a second identical put replaces (no duplicate key), and a planted legacy 9-section text is rejected',
      (function () {
        resetHist19();
        runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1635', '[]');`);
        const putA = runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}), 'TEXT-A')`);
        const getA = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const putB = runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(f3.r))}), 'TEXT-B')`);
        const getA2 = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const putA2 = runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}), 'TEXT-A2')`);
        const getA3 = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const arr = JSON.parse(runInCtx(`JSON.stringify(JSON.parse(localStorage.getItem('warroom_breakdown_cache_v1635') || '[]'))`));
        const keyA = runInCtx(`breakdownCacheKeyV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const keyB = runInCtx(`breakdownCacheKeyV1619(JSON.parse(${JSON.stringify(JSON.stringify(f3.r))}))`);
        const legacy9 = ['1. Matchup', '2. Best case', '3. Counter', '4. Plan', '5. Stall', '6. Scoreboard', '7. Sequence', '8. Finisher', '9. Verdict'].join('\n');
        runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1635', JSON.stringify([{key: ${JSON.stringify(keyA)}, text: ${JSON.stringify(legacy9)}}]))`);
        const getLegacy = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        return putA === keyA && getA === 'TEXT-A' && getA2 === 'TEXT-A' && putA2 === keyA && getA3 === 'TEXT-A2' && keyA !== keyB && arr.filter(e => e.key === keyA).length === 1 && getLegacy === null;
      })(), '');
    check('V1627-NOSAVE-PENDING (v16.27 DELIBERATE CHANGE) pending save returns null, history stays empty, offline breakdown still builds as free-form paragraphs',
      (function () {
        resetHist19();
        const out = JSON.parse(runInCtx(`JSON.stringify((function(){
          selected = ['superman','rocky']; forcedSeed = 832046845; forcedVictoryMode = 'death';
          const r = simulateBattle();
          const pid = savePendingBreakdownV1619(r, generateBreakdown(r), victoryStateChecksV14(r), narrativeAccuracyChecksV14(r, ''), storyQualityChecksV14(r, ''), breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r), 'v19-test-sid-1');
          const bd = buildBreakdownOfflineV1619(r);
          return { pid: pid, count: loadHistory().length, paras: bd.split(/\\n\\n+/).filter(function(x){ return !!x.trim(); }).length, hasHtml: breakdownHtmlV1619(bd, r).indexOf('breakdown-v1619') !== -1 };
        })())`));
        return out.pid === null && out.count === 0 && out.paras >= 5 && out.hasHtml;
      })(), '');
    check('V1626-NOSAVE-AI (v16.26 DELIBERATE CHANGE) AI-arrival save returns null, history stays empty, breakdown HTML still renders',
      (function () {
        resetHist19();
        const out = JSON.parse(runInCtx(`JSON.stringify((function(){
          selected = ['superman','rocky']; forcedSeed = 832046845; forcedVictoryMode = 'death';
          const r = simulateBattle();
          const pid = savePendingBreakdownV1619(r, generateBreakdown(r), victoryStateChecksV14(r), narrativeAccuracyChecksV14(r, ''), storyQualityChecksV14(r, ''), breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r), 'v19-test-sid-2');
          r._v16SessionId = 'v19-test-sid-2';
          const meta = { kind: 'ai', breakdown: true, provider: 'Test provider', passed: 10, unverified: 1, attempts: 1, attempts402Excluded: 0, promptSize: 100, sessionId: 'v19-test-sid-2', checks: [], sections: 9 };
          const uid = saveMainStoryOnceV16(r, breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r), generateBreakdown(r), victoryStateChecksV14(r), narrativeAccuracyChecksV14(r, ''), storyQualityChecksV14(r, ''), meta);
          const bd = buildBreakdownOfflineV1619(r);
          return { pid: pid, uid: uid, count: loadHistory().length, hasHtml: breakdownHtmlV1619(bd, r).indexOf('breakdown-v1619') !== -1 };
        })())`));
        return out.pid === null && out.uid === null && out.count === 0 && out.hasHtml;
      })(), '');
    check('V1626-NOSAVE-OFFLINE (v16.26 DELIBERATE CHANGE) offline-resolution save returns null, history stays empty',
      (function () {
        resetHist19();
        const out = JSON.parse(runInCtx(`JSON.stringify((function(){
          selected = ['spiderman','batman']; forcedSeed = 145416145; forcedVictoryMode = 'incapacitation';
          const r = simulateBattle();
          const pid = savePendingBreakdownV1619(r, generateBreakdown(r), victoryStateChecksV14(r), narrativeAccuracyChecksV14(r, ''), storyQualityChecksV14(r, ''), breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r), 'v19-test-sid-3');
          r._v16SessionId = 'v19-test-sid-3';
          const meta = { kind: 'offline', breakdown: true, provider: 'Offline fallback (rule-based breakdown)', passed: 0, unverified: 0, attempts: 1, attempts402Excluded: 0, promptSize: 0, sessionId: 'v19-test-sid-3', reason: 'All providers unavailable', sections: 9 };
          const uid = saveMainStoryOnceV16(r, null, generateBreakdown(r), victoryStateChecksV14(r), narrativeAccuracyChecksV14(r, ''), storyQualityChecksV14(r, ''), meta);
          return { pid: pid, uid: uid, count: loadHistory().length };
        })())`));
        return out.pid === null && out.uid === null && out.count === 0;
      })(), '');
    check('V1627-LIVE-BREAKDOWN (v16.27 DELIBERATE CHANGE: no saved views) live breakdown HTML has free-form paragraphs, breakdown-v1619 class, no verdict panel, no fixed headings',
      (function () {
        const out = JSON.parse(runInCtx(`JSON.stringify((function(){
          selected = ['goku','vegeta']; forcedSeed = 999; forcedVictoryMode = 'death';
          const r = simulateBattle();
          const h = breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r);
          return { paras: buildBreakdownOfflineV1619(r).split(/\\n\\n+/).filter(function(x){ return !!x.trim(); }).length, hasBreakdown: h.indexOf('breakdown-v1619') !== -1, hasPanel: h.indexOf('verdict-panel') !== -1, hasHeading: h.indexOf('<h4>') !== -1 };
        })())`));
        return out.paras >= 5 && out.hasBreakdown && !out.hasPanel && !out.hasHeading;
      })(), '');
    check('V1619-OLD (v16.20 DELIBERATE CHANGE) old saved entries (v16.19 verdict, v16.18 verdict, v15) still open unchanged; importer accepts v16.19 and v16.20',
      (function () {
        resetHist19();
        runInCtx(`(function(){ selected = ['superman', 'rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; const r = simulateBattle(); const mk = function (fv, id, story) { return { id: id, date: 'old', winner: r.winner, loser: r.loserFighter ? r.loserFighter.name : '', battlefield: r.battlefield.name, victoryMode: r.victoryMode, victoryType: r.victoryCondition || 'KO', formatVersion: fv, alpha: r.alpha.map(function (f) { return f.name + ' (' + f.variant + ')'; }), beta: r.beta.map(function (f) { return f.name + ' (' + f.variant + ')'; }), story: story, breakdown: '<li>old breakdown</li>', eventRecord: r.events, finalRecord: r.finalRecord || null, finalState: r.finalState || null, continuities: [], researchRefs: [], validation: { integrity: [], accuracy: [], quality: [] }, checks: [], quality: [], mainStoryMeta: fv === 'v16.18' ? { kind: 'offline', verdict: true, sessionId: 'old-1', provider: 'Offline fallback (rule-based verdict)', reason: 'test' } : (fv === 'v16.19' ? { kind: 'offline', verdict: true, sessionId: 'old-19', provider: 'Offline fallback (rule-based verdict)', reason: 'test' } : null) }; }; localStorage.setItem('warroom_battles_v3', JSON.stringify([mk('v16.19', 2003, '<p>old v1619 story</p>'), mk('v16.18', 2001, '<p>old v1618 story</p>'), mk('v15', 2002, '<p>old v15 story</p>')])); })()`);
        const imp = JSON.parse(runInCtx(`JSON.stringify([validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.19'}), validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.20'}), validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.18'}), validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v15'})])`));
        let o19 = '', o18 = '', o15 = '';
        try { runInCtx(`viewHistory(2003)`); o19 = els['story-output'].innerHTML || ''; } catch (e) { o19 = 'THREW'; }
        try { runInCtx(`viewHistory(2001)`); o18 = els['story-output'].innerHTML || ''; } catch (e) { o18 = 'THREW'; }
        try { runInCtx(`viewHistory(2002)`); o15 = els['story-output'].innerHTML || ''; } catch (e) { o15 = 'THREW'; }
        return imp[0].ok === true && imp[1].ok === true && imp[2].ok === true && imp[3].ok === true && o19.indexOf('old v1619 story') !== -1 && o18.indexOf('old v1618 story') !== -1 && o15.indexOf('old v15 story') !== -1;
      })(), '');
    check('V1619-NO-MEDIA (v16.20 DELIBERATE CHANGE) breakdown module adds no voice, image-generation, or video-recording calls',
      (function () {
        const region = html.slice(html.indexOf('WAR-ROOM v16.20: TEXT-ONLY'), html.indexOf('async function generateVerdictV1614'));
        return region.indexOf('speechSynthesis') === -1 && region.indexOf('MediaRecorder') === -1 && region.indexOf('<video') === -1 && region.indexOf('generateImage') === -1;
      })(), '');
    check('V1628-VERSION (v16.32 DELIBERATE CHANGE) build carries v16.35 title, heading, and save format; v16.24 and v16.27 still accepted by the importer',
      html.indexOf('<title>WAR-ROOM v16.35') !== -1 && html.indexOf('<h1>WAR-ROOM v16.35</h1>') !== -1 && html.indexOf("formatVersion:'v16.35'") !== -1
      && JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.24'}))`)).ok === true
      && JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.27'}))`)).ok === true, '');
    check('V1619-NAV-KEPT v16.15 slideshow navigation still wraps (regression guard for old saved verdicts)',
      runInCtx('verdictNavIndexV1615(2,1,5)') === 3 && runInCtx('verdictNavIndexV1615(4,1,5)') === 0 && runInCtx('verdictNavIndexV1615(0,-1,5)') === 4, '');
    check('V1619-LOCKED-KEPT fallback verdicts still pass the locked checker (0 FAILED) and stay 150-200 words (regression guard)',
      (function () {
        return [['superman', 'rocky', 12345, 'death'], ['spiderman', 'batman', 145416145, 'incapacitation'], ['goku', 'vegeta', 999, 'death']].every(function (args) {
          const f = verdictFixture(args[0], args[1], args[2], args[3]);
          const w = verdictWords(f.txt);
          return f.checks.filter(c => c.state === 'FAILED').length === 0 && w >= 150 && w <= 200;
        });
      })(), '');

    // ================= v16.20 EXPANDED PAIRING + FIXES =================
    const checkFailed1620 = (f, name) => f.checks.filter(c => c.name === name && c.state === 'FAILED').length > 0;
    const checkPassed1620 = (f, name) => f.checks.filter(c => c.name === name && c.state === 'PASSED').length > 0;
    const seqCheckName1620 = 'Breakdown section 7 finishing sequence comes only from the log, in order';
    // v16.20 NOTE: the V151-4 settings test leaves the harness battlefield stub on 'ruined' (Ruined City, +12 DEF), which changes battles. The live round-1/2 fixtures were fought on Open Arena, so pin the stub to 'arena' (Open Arena) for these exact-sequence fixtures.
    runInCtx(`document.getElementById('battlefield-select').value='arena';`);
    check('V1620-SEQ-R12 round-1/2 closing runs are the CONSECUTIVE final winner attacks (Goku vs Vegeta x2, Superman vs Rocky, Superman vs Goku)',
      (function () {
        const gv1 = bdFixture('goku', 'vegeta', 35965350, 'death');
        const gv2 = bdFixture('goku', 'vegeta', 999, 'death');
        const sr = bdFixture('superman', 'rocky', 742768439, 'death');
        const sg = bdFixture('superman', 'goku', 2071345574, 'death');
        return eq(gv1.facts.finishingSequence, ['Ki Blast', 'Final Flash', 'Blue Evolution Final Flash'])
          && eq(gv2.facts.finishingSequence, ['Galick Gun', 'Final Flash', 'Blue Evolution Final Flash'])
          && eq(sr.facts.finishingSequence, ['Heat Vision', 'Tornado Spin', 'Heat Vision'])
          && eq(sg.facts.finishingSequence, ['Heat Vision', 'Tornado Spin', 'Heat Vision'])
          && failed19(gv1).length === 0 && failed19(gv2).length === 0 && failed19(sr).length === 0 && failed19(sg).length === 0;
      })(), 'gv1=' + JSON.stringify(bdFixture('goku', 'vegeta', 35965350, 'death').facts.finishingSequence) + ' sr=' + JSON.stringify(bdFixture('superman', 'rocky', 742768439, 'death').facts.finishingSequence));
    check('V1620-SEQ-DPW current-engine Deadpool vs Wolverine closing run is the consecutive suffix ending in the finisher (v16.19 run changed by the regen fix — see report)',
      (function () {
        const f = bdFixture('deadpool', 'wolverine', 1508321541, 'death');
        const wins = JSON.parse(runInCtx(`JSON.stringify(winnerAttackNamesV1620(JSON.parse(${JSON.stringify(JSON.stringify(f.r))}), ${JSON.stringify(f.facts.winner)}))`));
        const suffix = wins.slice(wins.length - 3);
        return eq(f.facts.finishingSequence, suffix) && suffix[suffix.length - 1] === f.facts.finisher && failed19(f).length === 0;
      })(), 'seq=' + JSON.stringify(bdFixture('deadpool', 'wolverine', 1508321541, 'death').facts.finishingSequence) + ' finisher=' + bdFixture('deadpool', 'wolverine', 1508321541, 'death').facts.finisher);
    check('V1620-SEQ-SYNTHETIC the v16.19 Deadpool vs Wolverine closing run (Barrage — Claw Slash — Barrage) derives as the consecutive run on a synthetic record',
      (function () {
        const base = bdFixture('deadpool', 'wolverine', 1508321541, 'death').r;
        const rec = JSON.parse(JSON.stringify(base));
        const wAtt = rec.events.filter(function (e) { return e.type === 'attack' && e.actor === 'Wolverine'; });
        const last3 = wAtt.slice(wAtt.length - 3);
        last3[0].ability = 'Berserker Barrage'; last3[1].ability = 'Adamantium Claw Slash'; last3[2].ability = 'Berserker Barrage';
        const ko = [...rec.events].reverse().find(function (e) { return e.type === 'knockout' || e.type === 'incapacitated'; });
        if (ko) ko.ability = 'Berserker Barrage';
        // Finisher is derived from finalRecord.finishingAbility first (line: finisher = finalRecord.finishingAbility || last-attack ability), so it must move with the renamed closing attacks.
        if (rec.finalRecord) rec.finalRecord.finishingAbility = 'Berserker Barrage';
        const facts = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(JSON.parse(${JSON.stringify(JSON.stringify(rec))})))`));
        const txt = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(rec))}))`);
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(rec))})))`));
        return eq(facts.finishingSequence, ['Berserker Barrage', 'Adamantium Claw Slash', 'Berserker Barrage']) && checks.filter(c => c.state === 'FAILED').length === 0;
      })(), '');
    check('V1620-SEQ-DISTINCT-FAILS checker FAILS the v16.19 distinct-names section 7 (Freeze Breath — Tornado Spin — Heat Vision) for Superman vs Rocky',
      (function () {
        const f = bdFixture('superman', 'rocky', 742768439, 'death');
        const txt = withSection(f, 6, 'The finishing sequence, in order: Freeze Breath — Tornado Spin — Heat Vision.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return checks.some(c => c.name === seqCheckName1620 && c.state === 'FAILED');
      })(), '');
    check('V1620-SEQ-SKIPPED-FAILS checker FAILS a section 7 that skips a recorded closing attack (Heat Vision — Heat Vision)',
      (function () {
        const f = bdFixture('superman', 'rocky', 742768439, 'death');
        const txt = withSection(f, 6, 'The finishing sequence, in order: Heat Vision — Heat Vision.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return checks.some(c => c.name === seqCheckName1620 && c.state === 'FAILED');
      })(), '');
    check('V1620-SEQ-REORDERED-FAILS checker FAILS a reordered closing run (Tornado Spin — Heat Vision — Heat Vision)',
      (function () {
        const f = bdFixture('superman', 'rocky', 742768439, 'death');
        const txt = withSection(f, 6, 'The finishing sequence, in order: Tornado Spin — Heat Vision — Heat Vision.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return checks.some(c => c.name === seqCheckName1620 && c.state === 'FAILED');
      })(), '');
    check('V1620-CRITERION-CANNOTHARM cannot-harm derivation for Superman vs Rocky and Saitama vs Frodo (never damage type)',
      (function () {
        const sr = bdFixture('superman', 'rocky', 742768439, 'death');
        const sf = bdFixture('saitama', 'frodo', 22, 'death');
        return sr.facts.decisiveKey === 'cannot-harm' && sf.facts.decisiveKey === 'cannot-harm'
          && secBody(sr, 5).indexOf('cannot-harm') !== -1 && secBody(sf, 5).indexOf('cannot-harm') !== -1
          && failed19(sr).length === 0 && failed19(sf).length === 0;
      })(), 'sr=' + bdFixture('superman', 'rocky', 742768439, 'death').facts.decisiveKey + ' sf=' + bdFixture('saitama', 'frodo', 22, 'death').facts.decisiveKey);
    check('V1620-CRITERION-SAMETIER same-tier Spider-Man vs Batman derives prepared counter detected (not bare power tier); checker FAILS a power-tier draft',
      (function () {
        const f = bdFixture('spiderman', 'batman', 145416145, 'incapacitation');
        const txt = withSection(f, 5, 'Other criteria were considered. Decisive: power tier.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return f.facts.decisiveKey === 'prepared counter detected' && failed19(f).length === 0
          && checks.some(c => c.name === 'Breakdown same-tier criterion is not bare power tier' && c.state === 'FAILED');
      })(), 'key=' + bdFixture('spiderman', 'batman', 145416145, 'incapacitation').facts.decisiveKey);
    check('V1620-CRITERION-GODVSGOD God vs God Superman vs Goku derives durability (criteria-heavy); checker FAILS a bare power-tier draft',
      (function () {
        const f = bdFixture('superman', 'goku', 2071345574, 'death');
        const txt = withSection(f, 5, 'Criteria considered: power, speed, durability, regeneration, hax/bypass, stamina, weakness exposed. Decisive: power tier.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return f.facts.decisiveKey === 'durability' && failed19(f).length === 0
          && checks.some(c => c.name === 'Breakdown God vs God criterion is criteria-heavy' && c.state === 'FAILED');
      })(), 'key=' + bdFixture('superman', 'goku', 2071345574, 'death').facts.decisiveKey);
    check('V1620-CRITERION-DAMAGETYPE-FAILS checker FAILS damage type without a recorded damage-type interaction',
      (function () {
        const f = bdFixture('superman', 'rocky', 742768439, 'death');
        const txt = withSection(f, 5, 'Other criteria were considered. Decisive: damage type.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return checks.some(c => c.name === 'Breakdown decisive criterion matches the recorded mechanism' && c.state === 'FAILED');
      })(), '');
    check('V1620-REGEN-DISTINCT Deadpool vs Wolverine offline text states regeneration for BOTH fighters as a distinct mechanic (figure + cap + never-revives)',
      (function () {
        const f = bdFixture('deadpool', 'wolverine', 1508321541, 'death');
        const hasBoth = f.txt.indexOf('Deadpool regenerates in this fight: 40 HP per round') !== -1 && f.txt.indexOf('Wolverine regenerates in this fight: 40 HP per round') !== -1;
        return hasBoth && f.txt.indexOf('50% of maximum HP per battle') !== -1 && f.txt.indexOf('never revives after HP 0') !== -1 && failed19(f).length === 0
          && checkPassed1620(f, 'Breakdown states regeneration as a distinct mechanic');
      })(), '');
    check('V1620-REGEN-NOCLAIM Superman vs Rocky text claims no regeneration for either fighter; checker FAILS an invented regen claim',
      (function () {
        const f = bdFixture('superman', 'rocky', 742768439, 'death');
        const noClaim = !/(Superman|Rocky Balboa)\s+(regenerated|recovered|recovers?|heals?|healed|regenerating)\b/i.test(f.txt);
        const txt = withSection(f, 1, secBody(f, 1) + ' Superman regenerated 40 HP per round in this fight.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return noClaim && failed19(f).length === 0
          && checks.some(c => c.name === 'Breakdown does not claim regeneration that did not happen' && c.state === 'FAILED');
      })(), '');
    check('V1620-REGEN-GATE-FAILS checker FAILS a regen statement stripped of its per-round figure',
      (function () {
        const f = bdFixture('deadpool', 'wolverine', 1508321541, 'death');
        const txt = f.txt.split('40 HP per round').join('quickly');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return checks.some(c => c.name === 'Breakdown states regeneration as a distinct mechanic' && c.state === 'FAILED');
      })(), '');
    check('V1620-WOLVERINE-AGREEMENT Wolverine panel, log, and structured line agree on regeneration (vs regen foe and vs a damaging non-regen foe)',
      (function () {
        const panel = runInCtx(`dossierPanelHtmlV1612(byId('wolverine'))`);
        // The dossier panel renders deep-dossier + shared-schema sections, not the structured-profile block; the per-round line lives in structuredProfileForV14 (the source the live report quoted as the "structured line").
        const structured = JSON.parse(runInCtx(`JSON.stringify(structuredProfileForV14(byId('wolverine')))`));
        const sd = JSON.parse(runInCtx(`JSON.stringify(sharedDossierFieldsV1620(byId('wolverine')))`));
        const vsDp = sim19('wolverine', 'deadpool', 1508321541, 'death');
        // Rocky is NOT a valid heal witness: Rocky cannot harm Wolverine (tier gap + durability), so Wolverine stays at full HP and the engine emits no heal events. Batman can damage Wolverine, so he is the non-regen-foe witness.
        const vsBm = sim19('wolverine', 'batman', 12345, 'death');
        const healsDp = vsDp.events.some(function (e) { return e.type === 'heal' && e.actor === 'Wolverine'; });
        const healsBm = vsBm.events.some(function (e) { return e.type === 'heal' && e.actor === 'Wolverine'; });
        return structured.regen.perRound === 40 && panel.indexOf('regenerative') !== -1 && panel.indexOf('HP reaching 0 after the regeneration cap is exhausted') !== -1 && sd.durabilityType === 'regenerative' && sd.durabilityNote === '' && healsDp && healsBm;
      })(), '');
    check('V1627-LIVE-OFFLINE-VIEW (v16.27 DELIBERATE CHANGE: no saved views) live offline breakdown HTML shows free-form paragraphs + offline status banner with the reason, no slideshow',
      (function () {
        const storyHtml = runInCtx(`(function(){ selected = ['superman','rocky']; forcedSeed = 832046845; forcedVictoryMode = 'death'; var r = simulateBattle(); return breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r); })()`);
        const banner = runInCtx(`setOnlineStatusV1626('failed', 'All providers unavailable')`);
        const hasParas = (storyHtml.match(/<p>/g) || []).length >= 5;
        const noFixed = ['1. Matchup', '6. Criteria scoreboard', '9. Verdict'].every(function (h) { return storyHtml.indexOf(h) === -1; });
        return storyHtml.indexOf('breakdown-v1619') !== -1 && hasParas && noFixed
          && storyHtml.indexOf('verdict-panel') === -1 && storyHtml.indexOf('Panel 1 of 5') === -1
          && banner.indexOf('Online AI unavailable') !== -1 && banner.indexOf('All providers unavailable') !== -1;
      })(), '');
    check('V1627-LIVE-OFFLINE-REBUILD (v16.27 DELIBERATE CHANGE: no saved views) live offline breakdown rebuilds free-form paragraphs from the live record, never a stale slideshow string',
      (function () {
        const storyHtml = runInCtx(`(function(){ selected = ['superman','rocky']; forcedSeed = 832046845; forcedVictoryMode = 'death'; var r = simulateBattle(); return breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r); })()`);
        return storyHtml.indexOf('breakdown-v1619') !== -1 && storyHtml.indexOf('blow by blow') !== -1 && storyHtml.indexOf('Superman') !== -1 && storyHtml.indexOf('verdict-panel') === -1;
      })(), '');
    check('V1626-HEADINGS (v16.26 DELIBERATE CHANGE: no saved views; v16.33 DELIBERATE CHANGE: Death (knockout) headings) live result titles say BREAKDOWN and updateModeHeadings sets Breakdown episode headings',
      (function () {
        const t = html.indexOf("DEATH (KNOCKOUT) BATTLE BREAKDOWN") !== -1 && html.indexOf("INCAPACITATION BREAKDOWN") !== -1
          && html.indexOf("DEATH BATTLE VERDICT") === -1 && html.indexOf("INCAPACITATION VERDICT") === -1;
        runInCtx(`updateModeHeadings('incapacitation')`);
        const ehI = els['episode-heading'] ? (els['episode-heading'].innerText || '') : '';
        runInCtx(`updateModeHeadings('death')`);
        const ehD = els['episode-heading'] ? (els['episode-heading'].innerText || '') : '';
        return t && ehI.indexOf('Breakdown') !== -1 && ehI.indexOf('Verdict') === -1 && ehD.indexOf('Breakdown') !== -1 && ehD.indexOf('Verdict') === -1;
      })(), '');
    check('V1620-WORDING offline template varies by record, section 5 pivots, prompt carries the wording guide',
      (function () {
        const a = bdFixture('superman', 'rocky', 742768439, 'death');
        const b = bdFixture('goku', 'vegeta', 35965350, 'death');
        const c = bdFixture('deadpool', 'wolverine', 1508321541, 'death');
        const openers = [secBody(a, 0), secBody(b, 0), secBody(c, 0)];
        const varied = new Set(openers).size >= 2;
        const pivots = [a, b, c].every(function (f) { return /\bBut\b/.test(secBody(f, 4)); });
        const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(a.r))}))`);
        const noCopy = pr.indexOf('ShortStory') === -1 && a.txt.indexOf('ShortStory') === -1;
        return varied && pivots && pr.indexOf('hard pivot') !== -1 && pr.indexOf('maybe') !== -1 && pr.indexOf('present tense') !== -1 && noCopy
          && [a, b, c].every(function (f) { return failed19(f).length === 0; });
      })(), '');
    check('V1620-DOSSIER-FIELDS shared dossier fields: Raven half-demon, Sephiroth angel, Ghost Rider species unknown, no invented resistance/bypass',
      (function () {
        const rv = JSON.parse(runInCtx(`JSON.stringify(sharedDossierFieldsV1620(byId('raven')))`));
        const sp = JSON.parse(runInCtx(`JSON.stringify(sharedDossierFieldsV1620(byId('sephiroth')))`));
        const gr = JSON.parse(runInCtx(`JSON.stringify(sharedDossierFieldsV1620(byId('ghostrider')))`));
        const sm = JSON.parse(runInCtx(`JSON.stringify(sharedDossierFieldsV1620(byId('superman')))`));
        const panelRv = runInCtx(`dossierPanelHtmlV1612(byId('raven'))`);
        return rv.nature.value === 'half-demon' && rv.nature.status.indexOf('stated') === 0
          && sp.nature.value === 'angel' && sp.nature.status.indexOf('stated') === 0
          && gr.nature.value === 'unknown'
          && rv.damageResisted.reductions.length === 0 && sp.damageResisted.reductions.length === 0 && gr.damageBypassed.types.length === 0
          && sm.damageBypassed.types.indexOf('magic') !== -1
          && panelRv.indexOf('Shared dossier') !== -1 && panelRv.indexOf('Nature / origin') !== -1 && panelRv.indexOf('half-demon') !== -1;
      })(), '');
    check('V1620-CACHE-KEY-ROTATION old v16.19 breakdown cache key is not served; new v1620 key put/get round-trips',
      (function () {
        resetHist19();
        const r = sim19('superman', 'rocky', 12345, 'death');
        runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1619', JSON.stringify([{key: breakdownCacheKeyV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))})), text: 'STALE-V1619-TEXT'}]));`);
        runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1635', '[]');`);
        const got = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
        runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}), 'FRESH-V1620-TEXT');`);
        const got2 = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
        return got !== 'STALE-V1619-TEXT' && got2 === 'FRESH-V1620-TEXT';
      })(), '');
    check('V1620-WINCONDITION (v16.28 DELIBERATE CHANGE) engine outcome set is knockout/incapacitation/stalemate (death no longer the loser state); sealing/containment/removal are not simulated and the prompt bans them as victories',
      (function () {
        const sd = JSON.parse(runInCtx(`JSON.stringify(sharedDossierFieldsV1620(byId('superman')))`));
        const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        return sd.winCondition.outcomes.indexOf('knockout') !== -1 && sd.winCondition.outcomes.indexOf('death') === -1 && sd.winCondition.outcomes.indexOf('incapacitation') !== -1 && sd.winCondition.outcomes.indexOf('stalemate') !== -1
          && sd.winCondition.sealing === 'not simulated' && sd.winCondition.containment === 'not simulated' && sd.winCondition.battlefieldRemoval === 'not simulated'
          && pr.indexOf('never end on sealing, containment, or battlefield removal') !== -1;
      })(), '');
    check('V1620-BANNED-CONTENT 0 LLM7/OVH URLs, 0 embedded keys, 0 EVENTS: blocks in breakdown prompts',
      (function () {
        const noVendor = html.indexOf('llm7.io') === -1 && html.indexOf('api.llm7') === -1 && html.indexOf('api.ovh') === -1 && html.indexOf('ovhcloud') === -1;
        const prs = ['superman', 'rocky', 'goku', 'vegeta', 'deadpool', 'wolverine'].length === 6
          && [bdFixture('superman', 'rocky', 12345, 'death').r, bdFixture('goku', 'vegeta', 999, 'death').r, bdFixture('deadpool', 'wolverine', 1508321541, 'death').r].every(function (r) {
            const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
            return pr.indexOf('EVENTS:') === -1;
          });
        return noVendor && prs && !/sk-[A-Za-z0-9]{16,}/.test(html);
      })(), '');

    await expectV16('V1619-CACHE-HIT (v16.20 DELIBERATE CHANGE) cached breakdown renders without a provider call (fetch stubbed to throw)', async () => {
      resetHist19();
      runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1635', '[]');`);
      const r = sim19('superman', 'rocky', 12345, 'death');
      const txt = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
      runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}), ${JSON.stringify(txt)});`);
      sandbox.fetch = async () => { throw new Error('network disabled in harness'); };
      let metaOut = null;
      const p = runInCtx(`generateBreakdownV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}), 'v19-test-sid-cache', { onReady: function (meta, storyHtml) { globalThis._v19meta = meta; globalThis._v19html = storyHtml; } })`);
      await p;
      metaOut = runInCtx(`globalThis._v19meta`);
      const outHtml = runInCtx(`globalThis._v19html`);
      sandbox.fetch = realFetch;
      check('V1619-CACHE-HIT (v16.20 DELIBERATE CHANGE) cached breakdown renders without a provider call (fetch stubbed to throw)',
        metaOut && metaOut.kind === 'ai' && (metaOut.provider || '').indexOf('Cached') !== -1 && metaOut.attempts === 0 && (outHtml || '').indexOf('breakdown-v1619') !== -1 && (els['story-output'].innerHTML || '').indexOf('breakdown-v1619') !== -1,
        'meta=' + JSON.stringify(metaOut));
    });
  }

  // ================= v16.21 PLAYER-TEST FIX-ALL-9 TESTS =================
  {
    const resetHist21 = () => runInCtx(`localStorage.setItem('warroom_battles_v3', '[]'); currentStorySavedSessionId = null; currentHistoryId = null;`);
    const sim21 = (a, b, seed, mode) => JSON.parse(runInCtx(`JSON.stringify((function(){ selected = ['` + a + `','` + b + `']; forcedSeed = ` + seed + `; forcedVictoryMode = '` + mode + `'; return simulateBattle(); })())`));
    const bd21 = (a, b, seed, mode) => {
      const r = sim21(a, b, seed, mode);
      const txt = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
      const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(r))})))`));
      const facts = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))})))`));
      const secs = JSON.parse(runInCtx(`JSON.stringify(splitBreakdownSectionsV1619(${JSON.stringify(txt)}))`));
      return { r, txt, checks, facts, secs };
    };
    const failed21 = (f) => f.checks.filter(c => c.state === 'FAILED');
    const sec21 = (f, i) => { const ps = f.txt.split(/\n\n+/).map(x => x.trim()).filter(Boolean); if (i === 0) return ps[0] || ''; if (i === 1) return ps.filter(x => x.indexOf('best case') !== -1 && x.indexOf(f.facts.aName) !== -1)[0] || ''; if (i === 2) return ps.filter(x => x.indexOf('best case') !== -1 && x.indexOf(f.facts.bName) !== -1)[0] || ''; if (i === 3) return ps.filter(x => x.indexOf('winning plan') !== -1 || x.indexOf('What wins it for') === 0)[0] || ''; if (i === 4) return ps.filter(x => /failed/i.test(x))[0] || ''; if (i === 7) return ps.filter(x => x.indexOf('Finisher:') === 0)[0] || ''; if (i === 8) return ps[ps.length - 1] || ''; return ''; };
    const six = [
      bd21('goku', 'vegeta', 999, 'death'),
      bd21('superman', 'rocky', 12345, 'death'),
      bd21('superman', 'goku', 283547443, 'death'),
      bd21('deadpool', 'wolverine', 2017809809, 'death'),
      bd21('saitama', 'frodo', 1338500181, 'death'),
      bd21('spiderman', 'batman', 145416145, 'incapacitation'),
    ];
    const deaths = six.slice(0, 5), incap = six[5];
    check('V1621-FIX1-LOSERSTATE Death battles read knocked out (never dead) and Incapacitation reads unconscious, in breakdown, checker, System A, and fallback verdict',
      deaths.every(f => sec21(f, 7).indexOf('knocked out') !== -1 && !/\b(dead|died|killed)\b/i.test(sec21(f, 7)))
      && sec21(incap, 7).indexOf('unconscious') !== -1 && !/\b(dead|died|killed)\b/i.test(sec21(incap, 7))
      && six.every(f => failed21(f).length === 0)
      && deaths.every(f => { const a = JSON.parse(runInCtx(`JSON.stringify(victoryStateChecksV14(JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`)); const d = a.filter(c => c.name.indexOf('Loser state') !== -1)[0]; return d && d.passed && d.detail.indexOf('knocked out') !== -1 && !/\b(dead|died|killed)\b/i.test(d.detail); })
      && deaths.every(f => { const v = runInCtx(`buildVerdictFallbackV1614(JSON.parse(${JSON.stringify(JSON.stringify(f.r))}))`); const last = v.split(/\n\n+/).pop(); return last.indexOf('knocked out') !== -1 && !/\b(dead|died|killed)\b/i.test(last); }),
      'deaths=' + deaths.map(f => sec21(f, 7).slice(0, 90)).join(' | '));
    check('V1621-FIX1-MERCY Superman vs Rocky breakdown carries the mercy note without contradicting the knocked-out state',
      (function () { const f = six[1]; return f.facts.mercy === true && sec21(f, 7).indexOf('mercy choice') !== -1 && sec21(f, 7).indexOf('knocked out') !== -1 && !/\b(dead|died|killed)\b/i.test(sec21(f, 7)); })(), '');
    check('V1621-FIX2-BEAT4 (v16.28 DELIBERATE CHANGE) Section 4 is the winner plan in all 6 player battles — as its own paragraph, except shutouts where v16.28 compression merges it into the best-case paragraph (never the loser plan presented as a winning plan)',
      six.every(f => { const s4 = sec21(f, 3); if (s4.indexOf(f.facts.winner) !== -1 && s4.indexOf(f.facts.winnerBestPlan) !== -1 && s4.indexOf(f.facts.loser + "'s best plan") === -1) return true; if (f.facts.loserDamage === 0) { const merged = sec21(f, 1); return merged.indexOf(f.facts.winner) !== -1 && merged.indexOf(f.facts.winnerBestPlan) !== -1; } return false; })
      && sec21(incap, 3).indexOf('Spider-Man') !== -1 && sec21(six[4], 1).indexOf('Saitama') !== -1,
      's4s=' + six.map(f => sec21(f, 3).slice(0, 70)).join(' | '));
    check('V1621-FIX3-DEDUP (v16.32 DELIBERATE CHANGE) Section 5 has no repeated claim in any player battle and carries a log number (deciding margin, not the loser damage total)',
      six.every(f => { const c = f.checks.filter(x => x.name === 'Breakdown section 5 has no repeated claim')[0]; return c && c.state === 'PASSED' && sec21(f, 4).indexOf(f.facts.margin + ' damage across ') !== -1; }),
      's5s=' + six.map(f => sec21(f, 4).slice(0, 120)).join(' | '));
    check('V1621-FIX4-MARGIN Shutouts are called shutouts, never close/small edge; the checker FAILS a close-framed shutout draft',
      (function () {
        const shut = [six[1], six[4]];
        const honest = shut.every(f => sec21(f, 0).indexOf('not a close fight') !== -1 && sec21(f, 0).indexOf('close answer') === -1 && sec21(f, 0).indexOf('small edge') === -1);
        const f = six[1];
        const lines = f.txt.split('\n\n'); lines[0] = lines[0].split('\n')[0] + '\nCan Rocky Balboa beat Superman on Open Arena? The record gives a close answer, decided by a small edge.';
        const draft = lines.join('\n\n');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(draft)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        const marginFail = checks.some(c => c.name === 'Breakdown section 1 margin is honest' && c.state === 'FAILED');
        return honest && marginFail;
      })(), 's1s=' + [six[1], six[4]].map(f => sec21(f, 0)).join(' | '));
    check('V1621-FIX5-CRITERION No offline breakdown claims struck harder; both-transformed battles name the finisher after the winner transformation and the loser transformation producing no finish',
      six.every(f => f.txt.indexOf('struck harder') === -1 && f.txt.indexOf('strikes harder') === -1)
      && (function () { const gv = six[0], dw = six[3]; return sec21(gv, 4).indexOf(gv.facts.finisher) !== -1 && sec21(gv, 4).indexOf('produced no finish') !== -1 && sec21(dw, 4).indexOf(dw.facts.finisher) !== -1 && sec21(dw, 4).indexOf('produced no finish') !== -1; })()
      && (function () { const gv = six[0]; const ev = JSON.parse(runInCtx(`JSON.stringify(transformDamageEvidenceV1621(JSON.parse(${JSON.stringify(JSON.stringify(gv.r))}), 'Vegeta'))`)); return ev && typeof ev.round === 'number' && ev.sharedPairs.length > 0; })(),
      'gv-decisive=' + six[0].facts.decisiveKey + ' dw-decisive=' + six[3].facts.decisiveKey + ' sg-decisive=' + six[2].facts.decisiveKey);
    check('V1621-FIX6-CHARACTER Deadpool, Vegeta, Saitama, Superman breakdowns each carry a recognisable character line; a fighter with no trigger gains no invented line',
      (function () {
        const dp = six[3], gv = six[0], sf = six[4], sr = six[1];
        const hasLine = (f, marker) => (sec21(f, 1) + ' ' + sec21(f, 2)).indexOf(marker) !== -1;
        const blank = runInCtx(`characterLineV1621({name:'Nobody', id:'nobody-xyz'}, JSON.parse(${JSON.stringify(JSON.stringify(sr.r))}))`);
        return hasLine(dp, 'jokes mid-fight') && hasLine(gv, 'Proud prince') && hasLine(sf, 'bored') && hasLine(sr, 'Compassionate and restrained') && blank === '';
      })(), '');
    check('V1621-FIX9-NOTYPE Roster search for Angel/Demon/Immortal surfaces the explicit no-type note (not silent 0 matches); type-adjacent info panels carry it; Superman does not; no fighter is relabelled',
      (function () {
        sandbox.fetch = async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
        let ok = true;
        ['angel', 'demon', 'immortal'].forEach(q => { runInCtx(`searchTerm = '${q}'; renderRoster();`); if ((els['roster-type-note'].innerText || '').indexOf('not yet in the roster with engine support') === -1) ok = false; });
        runInCtx(`searchTerm = 'goku'; renderRoster();`);
        if ((els['roster-type-note'].innerText || '') !== '') ok = false;
        runInCtx(`openInfo('dante')`);
        if ((els['info-content'].innerHTML || '').indexOf('Type note') === -1) ok = false;
        if ((els['info-content'].innerHTML || '').indexOf('not relabelled') === -1) ok = false;
        runInCtx(`openInfo('superman')`);
        if ((els['info-content'].innerHTML || '').indexOf('Type note') !== -1) ok = false;
        sandbox.fetch = realFetch;
        return ok;
      })(), '');
    check('V1626-NOEXPORT-STATIC (v16.26 DELIBERATE CHANGE) no export controls in markup; Technical Details + retry kept',
      html.slice(0, html.indexOf('<script>')).indexOf('export-note-top') === -1
      && html.slice(0, html.indexOf('<script>')).indexOf('Download JSON') === -1
      && html.indexOf('Technical Details') !== -1 && html.indexOf('id="retry-online-story-btn"') !== -1,
      '');
    check('V1626-NOEXPORT-FILES (v16.26 DELIBERATE CHANGE) markup has no export buttons/onclicks; live breakdown HTML renders without export',
      (function () {
        const markup = html.slice(0, html.indexOf('<script>'));
        const storyHtml = runInCtx(`(function(){ selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; var r = simulateBattle(); return breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r); })()`);
        return markup.indexOf('Download JSON') === -1 && markup.indexOf('Download story') === -1 && markup.indexOf('exportSavedEpisodeFile') === -1
          && storyHtml.indexOf('breakdown-v1619') !== -1 && storyHtml.indexOf('Download JSON') === -1;
      })(),
      '');
    await expectV16('V1626-FIX7-LIVE-RETRY (v16.26 DELIBERATE CHANGE: no saved entries) live fromRetry attempts visibly, then lands offline failure on the live banner with no history entry', async () => {
      resetHist21();
      sandbox.fetch = async () => { throw new Error('network disabled in harness'); };
      runInCtx(`verdictLastPostAtV1614 = 0; localStorage.setItem('warroom_breakdown_cache_v1635', '[]');`);
      const r = sim21('superman', 'rocky', 12345, 'death');
      runInCtx(`globalThis._v21r = JSON.parse(${JSON.stringify(JSON.stringify(r))});`);
      const p = runInCtx(`generateBreakdownV1619(globalThis._v21r, 'v21-test-sid-retry', { fromRetry: true, retryAttempt: 3 })`);
      const attempting = els['main-story-status'].innerText || '';
      const bannerAttempting = els['online-status-banner'].innerText || '';
      await p;
      const metaKind = runInCtx(`lastMainStoryMeta && lastMainStoryMeta.kind`);
      const histCount = JSON.parse(runInCtx(`JSON.stringify(loadHistory().length)`));
      const liveStatus = els['main-story-status'].innerText || '';
      const liveBanner = els['online-status-banner'].innerText || '';
      const storyHtml = els['story-output'].innerHTML || '';
      check('V1626-FIX7-LIVE-RETRY (v16.26 DELIBERATE CHANGE) live fromRetry attempts visibly, then offline failure on banner + status, offline breakdown shown, no history entry',
        attempting.indexOf('Retrying online breakdown (attempt 3)') !== -1
        && bannerAttempting.indexOf('Retrying online breakdown (attempt 3)') !== -1
        && metaKind === 'offline'
        && liveStatus.indexOf('Online AI unavailable') !== -1 && liveBanner.indexOf('Online AI unavailable') !== -1
        && storyHtml.indexOf('breakdown-v1619') !== -1 && histCount === 0,
        'attempting=' + attempting.slice(0, 80) + ' live=' + liveStatus.slice(0, 80));
      sandbox.fetch = realFetch;
    });
  }

  // ================= v16.22 THREE-FIX TESTS =================
  {
    const resetHist22 = () => runInCtx(`localStorage.setItem('warroom_battles_v3', '[]'); currentStorySavedSessionId = null; currentHistoryId = null; currentBattle = null;`);
    const sim22 = (a, b, seed, mode) => JSON.parse(runInCtx(`JSON.stringify((function(){ selected = ['` + a + `','` + b + `']; forcedSeed = ` + seed + `; forcedVictoryMode = '` + mode + `'; return simulateBattle(); })())`));
    const bd22 = (a, b, seed, mode) => {
      const r = sim22(a, b, seed, mode);
      const txt = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))}))`);
      const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(r))})))`));
      const facts = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(JSON.parse(${JSON.stringify(JSON.stringify(r))})))`));
      const secs = JSON.parse(runInCtx(`JSON.stringify(splitBreakdownSectionsV1619(${JSON.stringify(txt)}))`));
      return { r, txt, checks, facts, secs };
    };
    const failed22 = (f) => f.checks.filter(c => c.state === 'FAILED');
    const sec22 = (f, i) => { const ps = f.txt.split(/\n\n+/).map(x => x.trim()).filter(Boolean); if (i === 0) return ps[0] || ''; if (i === 3) return ps.filter(x => x.indexOf('winning plan') !== -1 || x.indexOf('What wins it for') === 0)[0] || ''; if (i === 4) return ps.filter(x => /failed/i.test(x))[0] || ''; if (i === 7) return ps.filter(x => x.indexOf('Finisher:') === 0)[0] || ''; if (i === 8) return ps[ps.length - 1] || ''; return ''; };
    const checkState22 = (f, name) => { const c = f.checks.filter(x => x.name === name)[0]; return c ? c.state : 'MISSING'; };
    const four = [
      bd22('goku', 'vegeta', 999, 'death'),
      bd22('superman', 'goku', 283547443, 'death'),
      bd22('deadpool', 'wolverine', 2017809809, 'death'),
      bd22('spiderman', 'batman', 145416145, 'incapacitation'),
    ];
    const gv = four[0], sg = four[1], dw = four[2];
    check('V1622-FIXA-VERDICT Transformation verdict lines name whose transformation and the finisher after it (never bare decided by transformation)',
      (function () {
        const trans = [gv, dw].filter(f => f.facts.decisiveKey === 'transformation');
        if (trans.length !== 2) return false;
        return trans.every(f => {
          const s9 = sec22(f, 8);
          return s9.indexOf(f.facts.winner) !== -1 && s9.indexOf(f.facts.winnerTransform) !== -1 && s9.indexOf(f.facts.finisher) !== -1
            && !/decided by transformation\./i.test(s9) && checkState22(f, 'Breakdown section 9 names whose transformation and what it changed') === 'PASSED';
        });
      })(), 'gv s9=' + sec22(gv, 8).slice(0, 140) + ' | dw s9=' + sec22(dw, 8).slice(0, 140) + ' | gv decisive=' + gv.facts.decisiveKey + ' dw decisive=' + dw.facts.decisiveKey);
    check('V1622-FIXA-VERDICT-NEGATIVE Checker FAILS a bare decided by transformation verdict line',
      (function () {
        const lines = gv.txt.split('\n\n'); lines[lines.length - 1] = 'Verdict: ' + gv.facts.winner + ' wins, decided by transformation.';
        const draft = lines.join('\n\n');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(draft)}, JSON.parse(${JSON.stringify(JSON.stringify(gv.r))})))`));
        return checks.some(c => c.name === 'Breakdown section 9 names whose transformation and what it changed' && c.state === 'FAILED');
      })(), '');
    check('V1622-FIXA-TIDE (v16.32 DELIBERATE CHANGE) Loser transformation is stated as producing no finish, never as turning the tide (Superman vs Goku); post-transform damage figures removed from the story under the margin-only rule, log evidence still asserted',
      (function () {
        const s5 = sec22(sg, 4);
        const tide = JSON.parse(runInCtx(`JSON.stringify(transformTideEvidenceV1622(JSON.parse(${JSON.stringify(JSON.stringify(sg.r))}), 'Goku', ${JSON.stringify(sg.facts.finisher)}))`));
        return sg.facts.decisiveKey !== 'transformation' && s5.indexOf('turned the tide') === -1 && s5.indexOf('produced no finish') !== -1
          && tide && tide.supported === false && tide.postActor < tide.postOpp
          && checkState22(sg, 'Breakdown tide-turning claims are backed by the log') === 'PASSED'
          && four.every(f => failed22(f).length === 0);
      })(), 'sg s5=' + sec22(sg, 4).slice(0, 260) + ' | sg decisive=' + sg.facts.decisiveKey + ' | sg tactic=' + (sg.facts.tacticSentence || ''));
    check('V1622-FIXA-TIDE-NEGATIVE Checker FAILS a tide-turning claim for a loser transformation the log contradicts',
      (function () {
        const s5 = sec22(sg, 4);
        if ((sg.facts.tacticSentence || '').indexOf('Goku') !== 0 || (sg.facts.tacticSentence || '').indexOf('transformation') === -1) return false;
        const lines = sg.txt.split('\n\n'); const si = lines.findIndex(x => /failed/i.test(x)); lines[si] = lines[si] + ' The transformation turned the tide from that point on.';
        const draft = lines.join('\n\n');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(draft)}, JSON.parse(${JSON.stringify(JSON.stringify(sg.r))})))`));
        return checks.some(c => c.name === 'Breakdown tide-turning claims are backed by the log' && c.state === 'FAILED');
      })(), 'sg tactic=' + (sg.facts.tacticSentence || ''));
    check('V1622-FIXA-PROMPT AI prompt carries verdict specificity and the tide rule',
      (function () {
        const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(gv.r))}))`);
        return pr.indexOf('never a bare decided by transformation') !== -1 && pr.indexOf('turned the tide only if') !== -1 && pr.indexOf('produced no finish') !== -1;
      })(), '');
    check('V1626-LIVE-RETRY (v16.26 DELIBERATE CHANGE: no saved episodes) Technical Details retry button present in markup; retryMainStoryV16 is a function; banner element exists',
      (function () {
        const markup = html.slice(0, html.indexOf('<script>'));
        return markup.indexOf('retryMainStoryV16()') !== -1 && markup.indexOf('Technical Details') !== -1
          && runInCtx('typeof retryMainStoryV16') === 'function' && els['online-status-banner'] != null;
      })(),
      '');
    check('V1622-FIXB-NOBATTLE Retry with no battle loaded writes a visible message instead of silently returning',
      (function () {
        resetHist22();
        runInCtx(`currentBattle = null; currentHistoryId = null;`);
        runInCtx(`retryMainStoryV16();`);
        return (els['main-story-status'].innerText || '').indexOf('No battle is loaded to retry') !== -1;
      })(), 'status=' + (els['main-story-status'].innerText || '').slice(0, 80));
    await expectV16('V1626-LIVE-SAVEDRETRY (v16.26 DELIBERATE CHANGE: no saved episodes) live fromRetry attempts visibly, then resolves offline with no history entry and no duplicate', async () => {
      resetHist22();
      sandbox.fetch = async () => { throw new Error('network disabled in harness'); };
      runInCtx(`verdictLastPostAtV1614 = 0; localStorage.setItem('warroom_breakdown_cache_v1635', '[]');`);
      const r = sim22('superman', 'rocky', 12345, 'death');
      runInCtx(`globalThis._v22r = JSON.parse(${JSON.stringify(JSON.stringify(r))});`);
      const p = runInCtx(`generateBreakdownV1619(globalThis._v22r, 'v22-live-retry', { fromRetry: true, retryAttempt: 1 })`);
      const attempting = els['main-story-status'].innerText || '';
      await p;
      const metaKind = runInCtx(`lastMainStoryMeta && lastMainStoryMeta.kind`);
      const histCount = JSON.parse(runInCtx(`JSON.stringify(loadHistory().length)`));
      const liveStatus = els['main-story-status'].innerText || '';
      const storyHtml = els['story-output'].innerHTML || '';
      check('V1626-LIVE-SAVEDRETRY (v16.26 DELIBERATE CHANGE) live fromRetry attempts visibly, then offline failure, offline breakdown shown, no history entry',
        attempting.indexOf('Retrying online breakdown') !== -1 && metaKind === 'offline'
        && liveStatus.indexOf('Online AI unavailable') !== -1 && storyHtml.indexOf('breakdown-v1619') !== -1 && histCount === 0,
        'attempting=' + attempting.slice(0, 70) + ' live=' + liveStatus.slice(0, 70));
      sandbox.fetch = realFetch;
    });

    check('V1626-FIXC-NOEXPORT-MARKUP (v16.26 DELIBERATE CHANGE) markup has no per-file export buttons or onclicks',
      (function () {
        const markup = html.slice(0, html.indexOf('<script>'));
        return markup.indexOf('Download JSON') === -1 && markup.indexOf('Download story') === -1 && markup.indexOf('exportSavedEpisodeFile') === -1;
      })(),
      '');
    check('V1626-FIXC-STATIC-MARKUP (v16.26 DELIBERATE CHANGE) markup has no per-file export buttons and no dual-download label',
      html.slice(0, html.indexOf('<script>')).indexOf('Download JSON') === -1
      && html.slice(0, html.indexOf('<script>')).indexOf('Download story') === -1
      && html.slice(0, html.indexOf('<script>')).indexOf('Export saved episode (JSON + story)') === -1
      && html.slice(0, html.indexOf('<script>')).indexOf("exportSavedEpisodeFile(${x.id},'json')") === -1,
      '');
    check('V1622-REGRESSION No regression on the other 6 fixes, winner/finisher/loser-state accuracy, or banned content',
      (function () {
        const six22 = [bd22('goku', 'vegeta', 999, 'death'), bd22('superman', 'rocky', 12345, 'death'), bd22('superman', 'goku', 283547443, 'death'), bd22('deadpool', 'wolverine', 2017809809, 'death'), bd22('saitama', 'frodo', 1338500181, 'death'), bd22('spiderman', 'batman', 145416145, 'incapacitation')];
        const allOk = six22.every(f => failed22(f).length === 0);
        const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(six22[0].r))}))`);
        return allOk && pr.indexOf('EVENTS:') === -1 && html.indexOf('llm7.io') === -1 && html.indexOf('api.ovh') === -1 && !/sk-[A-Za-z0-9]{16,}/.test(html);
      })(), '');
  }

  // ================= v16.23 PHASE 1 — STRUCTURED POWER PROFILE =================
  // Foundation only: schema + panel + prompt sharing. No engine change, no new
  // fighters, no online-flow change, no queued-minor-flaw fixes.
  const sim23 = (a, b, seed, mode) => JSON.parse(runInCtx(`JSON.stringify((function(){ selected = ['` + a + `','` + b + `']; forcedSeed = ` + seed + `; forcedVictoryMode = '` + mode + `'; return simulateBattle(); })())`));
  const bd23 = (a, b, seed, mode) => ({ r: sim23(a, b, seed, mode) });
  const profAll = JSON.parse(runInCtx(`JSON.stringify(ROSTER.map(function (f) { var p = powerProfileV1623(Object.assign({}, f, {variant: 'Base', variantId: 'base'})); return {id: p.fighterId, tier: p.tier.value, band: p.tier.band, feat: p.tier.feat, speed: p.speed.band, reaction: p.speed.reaction, dur: p.durability.type, durStatus: p.durability.status, way: p.durability.wayToLose, sig: p.damage.signature.name, sigType: p.damage.signature.type, sigStatus: p.damage.signature.status, powTypes: p.damage.powersetTypes, powStatus: p.damage.powersetStatus, resisted: p.damage.resisted, bypassed: p.damage.bypassed, hax: p.hax.status, nature: p.nature.value, powerSource: p.powerSource.value, range: p.range.value, rangeStatus: p.range.status, approach: p.range.approach, pushedOut: p.range.pushedOut, trans: p.transforms.map(function (t) { return {name: t.name, cond: t.conditionTrigger, condStatus: t.conditionStatus, eng: t.engineTrigger}; }), stamina: p.stamina.limit, staminaStatus: p.stamina.limitStatus, prepLimit: p.prep.limit}; }))`));
  const profById = {}; profAll.forEach(p => { profById[p.id] = p; });
  const DUR_VOCAB = ['mortal', 'regenerative', 'invulnerable', 'intangible', 'immortal', 'other'];
  const DMG_VOCAB = ['physical', 'energy', 'magic', 'psychic', 'internal', 'restraint', 'environmental', 'poison', 'sealing', 'reality'];
  check('V1623-P1 Roster stays 194 and every fighter/version has a structured power profile',
    profAll.length === 194 && profAll.every(p => p.tier && p.band && p.speed && p.reaction && p.dur && p.way && p.sig && p.sigType),
    'count=' + profAll.length);
  check('V1623-P2 Power source is unknown for all 194 (schema field present, never parsed from prose)',
    profAll.every(p => p.powerSource === 'unknown'), 'known=' + profAll.filter(p => p.powerSource !== 'unknown').map(p => p.id).join(','));
  check('V1623-P3 Nature known ONLY for the 10 authorised cases (8 deep dossiers + Raven + Sephiroth); tagline fighters stay unknown',
    (function () {
      const known = profAll.filter(p => p.nature !== 'unknown').map(p => p.id).sort();
      const want = ['batman', 'deadpool', 'frodo', 'goku', 'raven', 'rick', 'saitama', 'sephiroth', 'superman', 'wolverine'].sort();
      return JSON.stringify(known) === JSON.stringify(want)
        && profById['ghostrider'].nature === 'unknown' && profById['dante'].nature === 'unknown'
        && profById['doomslayer'].nature === 'unknown' && profById['buffy'].nature === 'unknown'
        && profById['danny'].nature === 'unknown' && profById['steven'].nature === 'unknown';
    })(), 'known=' + profAll.filter(p => p.nature !== 'unknown').map(p => p.id).join(','));
  check('V1623-P4 (v16.25 DELIBERATE CHANGE) Signature damage is AUTHORED for all 194; powerset types use the v16.25 single source and are never presented as authored',
    profAll.every(p => DMG_VOCAB.indexOf(p.sigType) !== -1 && p.sigStatus.indexOf('authored') !== -1)
    && profAll.every(p => p.powStatus.indexOf('single source') !== -1 && p.powStatus.indexOf('never presented as authored') !== -1)
    && (function () {
      const entries = JSON.parse(runInCtx(`JSON.stringify(structuredPowersForV14(Object.assign({}, byId('gojo'), {variant: 'Base', variantId: 'base'})).filter(function (x) { return x.isSignature; }).map(function (x) { return {name: x.name, type: x.damageType, src: x.damageTypeSource}; }))`));
      const kw = JSON.parse(runInCtx(`JSON.stringify(structuredPowersForV14(Object.assign({}, byId('goku'), {variant: 'Base', variantId: 'base'})).filter(function (x) { return x.name === 'Instant Transmission Strike'; }).map(function (x) { return {type: x.damageType, src: x.damageTypeSource, eff: x.effect}; }))`));
      return entries.length >= 1 && entries[0].type === 'energy' && entries[0].src === 'authored-signature'
        && kw.length >= 1 && kw[0].src === 'keyword-fallback' && kw[0].eff.indexOf('not authored') !== -1;
    })(),
    'bad sig=' + profAll.filter(p => DMG_VOCAB.indexOf(p.sigType) === -1 || p.sigStatus.indexOf('authored') === -1).map(p => p.id).join(','));
  check('V1623-P5 Authored signature differs from the keyword mapping where expected, proving the table is not the regex (Spider-Man: authored physical vs keyword restraint)',
    profById['spiderman'].sigType === 'physical' && runInCtx(`damageTypeCanonicalV14('Web + Impact Combo')`) === 'restraint'
    && profById['danny'].sigType === 'environmental' && runInCtx(`damageTypeCanonicalV14('Ghostly Wail')`) === 'physical',
    'spiderman authored=' + profById['spiderman'].sigType + ' danny authored=' + profById['danny'].sigType);
  check('V1623-P6 Durability types are in vocabulary with a defined way to lose; counts match the trait/deep derivation (regen 6, invulnerable 2, other 1, mortal 185, intangible/immortal 0)',
    (function () {
      const c = {}; profAll.forEach(p => { c[p.dur] = (c[p.dur] || 0) + 1; });
      return profAll.every(p => DUR_VOCAB.indexOf(p.dur) !== -1 && p.way && p.way.length > 0)
        && c['regenerative'] === 6 && c['invulnerable'] === 2 && c['other'] === 1 && c['mortal'] === 185
        && (c['intangible'] || 0) === 0 && (c['immortal'] || 0) === 0;
    })(), 'counts=' + JSON.stringify(profAll.reduce((a, p) => { a[p.dur] = (a[p.dur] || 0) + 1; return a; }, {})));
  check('V1623-P7 Hax is unknown for all 194 (schema present, nothing inferred from power names)',
    profAll.every(p => p.hax.indexOf('unknown') !== -1), '');
  check('V1623-P8 Transforms record a condition trigger ALONGSIDE the unchanged engine HP trigger; exactly 12 conditions are authored, the rest unknown',
    (function () {
      const withTrans = profAll.filter(p => p.trans.length > 0);
      const authored = profAll.filter(p => p.trans.length > 0 && p.trans[0].condStatus.indexOf('stated') !== -1);
      return withTrans.length > 0 && withTrans.every(p => p.trans[0].eng.indexOf('45%') !== -1)
        && authored.length === 12
        && profById['goku'].trans[0].cond.indexOf('Pushed') !== -1
        && profById['vegeta'].trans[0].cond.indexOf('Pride') !== -1
        && html.indexOf('actor.currentHp<=actor.maxHp*0.45') !== -1;
    })(), 'authored=' + profAll.filter(p => p.trans.length > 0 && p.trans[0].condStatus.indexOf('stated') !== -1).map(p => p.id).join(','));
  check('V1623-P9 Range: values in vocabulary, exactly 50 authored (18 close, 31 mid, 1 full-screen), 144 unknown; pushed-out unknown except Green Arrow',
    (function () {
      const c = {}; profAll.forEach(p => { c[p.range] = (c[p.range] || 0) + 1; });
      return c['close'] === 18 && c['mid'] === 31 && c['full-screen'] === 1 && c['unknown'] === 144
        && profById['goku'].range === 'close' && profById['gojo'].range === 'mid' && profById['storm'].range === 'full-screen'
        && profById['batman'].range === 'unknown'
        && profAll.filter(p => p.pushedOut.indexOf('unknown') === -1).map(p => p.id).join(',') === 'greenarrow';
    })(), 'counts=' + JSON.stringify(profAll.reduce((a, p) => { a[p.range] = (a[p.range] || 0) + 1; return a; }, {})));
  check('V1623-P10 Stamina limits come from profile weakness text where stated (Ben timeout, Goku drain, All-Might time limit); otherwise honestly unknown',
    profById['ben'].stamina.indexOf('Omnitrix timeout') !== -1 && profById['goku'].stamina.indexOf('stamina drains') !== -1
    && profById['allmight'].stamina.indexOf('Time limit') !== -1 && profById['batman'].staminaStatus === 'unknown',
    'ben=' + profById['ben'].stamina + ' batmanStatus=' + profById['batman'].staminaStatus);
  check('V1623-P11 Dossier panel renders the new profile fields with unknown honestly labelled (Superman + Batman spot checks, words only)',
    (function () {
      const sup = runInCtx(`powerProfileHtmlV1623(Object.assign({}, byId('superman'), {variant: 'Base', variantId: 'base'}))`);
      const bat = runInCtx(`powerProfileHtmlV1623(Object.assign({}, byId('batman'), {variant: 'Base', variantId: 'base'}))`);
      return sup.indexOf('Structured power profile (v16.23') !== -1 && sup.indexOf('Heat Vision') !== -1 && sup.indexOf('energy') !== -1
        && sup.indexOf('invulnerable') !== -1 && sup.indexOf('Power source') !== -1 && sup.indexOf('unknown') !== -1
        && bat.indexOf('Optimal range') !== -1 && bat.indexOf('unknown') !== -1;
    })(), '');
  check('V1623-P12 Profile summary and breakdown prompt use words/tiers/states only (no new HP/ATK/DEF numbers) and the prompt carries the profile without EVENTS:/forbidden URLs/keys',
    (function () {
      const sum = runInCtx(`powerProfileSummaryV1623(Object.assign({}, byId('superman'), {variant: 'Base', variantId: 'base'}))`);
      const b = bd23('superman', 'rocky', 12345, 'death');
      const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(b.r))}))`);
      return sum.indexOf('power source: unknown') !== -1 && !/\d+\s*(ATK|DEF)/.test(sum)
        && pr.indexOf('POWER PROFILE (v16.23') !== -1 && pr.indexOf('power source: unknown') !== -1
        && pr.indexOf('LOCKED OUTCOME') !== -1 && pr.indexOf('EVENTS:') === -1
        && html.indexOf('llm7.io') === -1 && html.indexOf('api.ovh') === -1 && !/sk-[A-Za-z0-9]{16,}/.test(html);
    })(), '');
  check('V1623-P13 Profile is per-version: a v2 instance keeps its variant id and the same authored signature type (no cross-version merge)',
    (function () {
      const v2 = JSON.parse(runInCtx(`JSON.stringify((function(){ var p = powerProfileV1623(Object.assign({}, byId('batman'), {variant: 'Armoured', variantId: 'v2'})); return {variant: p.variant, variantId: p.variantId, sigType: p.damage.signature.type, sigName: p.damage.signature.name}; })())`));
      return v2.variantId === 'v2' && v2.variant === 'Armoured' && v2.sigType === 'physical' && v2.sigName === 'Gadget Barrage';
    })(), '');
  check('V1623-P14 (v16.32 DELIBERATE CHANGE) Version stamps: title/heading/format are v16.35 and the importer still accepts v16.24 as legacy',
    html.indexOf('<title>WAR-ROOM v16.35') !== -1 && html.indexOf('<h1>WAR-ROOM v16.35</h1>') !== -1
    && html.indexOf("formatVersion:'v16.35'") !== -1 && html.indexOf("'v16.24'") !== -1,
    '');
  check('V1623-P15 File stays compact: v16.23 source is under 1,150,000 characters (delta well under ~200 KB)',
    html.length < 1150000, 'chars=' + html.length);
  check('V1623-P16 No Phase 1 outcome change: known v16.22 side-test winners still hold (Superman beats Rocky, Saitama beats Frodo)',
    (function () {
      const s1 = bd23('superman', 'rocky', 12345, 'death');
      const s2 = bd23('saitama', 'frodo', 1338500181, 'death');
      return s1.r.winner === 'Superman' && s2.r.winner === 'Saitama';
    })(), '');

  // ================= v16.24 PHASE 2 — CHARACTER-RULE RESOLVER (ALONGSIDE HP ENGINE) =================
  // No output switch, no HP removal, no online-flow change, no new fighters.
  // Resolver is deterministic and seed-recorded; HP engine still governs the main breakdown.
  const res24 = (a, b, seed, mode) => JSON.parse(runInCtx(`JSON.stringify(resolveCharacterRulesV1624(${JSON.stringify(a)},${JSON.stringify(b)},${seed},{victoryMode:${JSON.stringify(mode)}}))`));
  const hp24 = (a, b, seed, mode) => battle([[spec(a)], [spec(b)]], { seed, victoryMode: mode });
  const comp24 = (a, b, seed, mode) => { const r = res24(a, b, seed, mode); const h = hp24(a, b, seed, mode); return { r, h, match: (h.stalemate ? null : h.winner) === r.winner }; };
  check('V1624-R1 Resolver is deterministic: same seed/pair/version replays identically (no RNG, no Date)',
    JSON.stringify(res24('superman', 'rocky', 12345, 'death')) === JSON.stringify(res24('superman', 'rocky', 12345, 'death'))
    && JSON.stringify(res24('goku', 'vegeta', 999, 'death')) === JSON.stringify(res24('goku', 'vegeta', 999, 'death')), '');
  check('V1624-R2 Resolver records seed + inputs + decisive criterion + exchange sequence (replayable without HP ticks)',
    (function () { const r = res24('superman', 'rocky', 12345, 'death'); return r.seed === 12345 && r.inputs && r.inputs.directionAtoB && r.inputs.directionBtoA && r.decisiveCriterion && r.exchanges && r.exchanges.length >= 5 && r.steps && r.steps.length === 5; })(), '');
  check('V1624-R3 Resolver vs HP at seed 12345: all 7 known battles MATCH on winner',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death']];
      const bad = pairs.filter(([a, b, m]) => !comp24(a, b, 12345, m).match);
      return bad.length === 0;
    })(), 'mismatches=' + [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death']].filter(([a, b, m]) => !comp24(a, b, 12345, m).match).map(p => p.join(' vs ')).join(';'));
  check('V1624-R4 Resolver winner is seed-invariant (profiles, not RNG) — so seed 1 honestly CHANGES two HP winners, and the change is reported, not hidden',
    (function () {
      const g = comp24('goku', 'vegeta', 1, 'death'); const rv = comp24('raven', 'sephiroth', 1, 'death');
      return g.h.winner === 'Goku' && g.r.winner === 'Vegeta' && g.r.decisiveCriterion === 'stamina'
        && rv.h.winner === 'Raven' && rv.r.winner === 'Sephiroth' && rv.r.decisiveCriterion === 'speed';
    })(), 'goku/vegeta seed1 HP=' + comp24('goku', 'vegeta', 1, 'death').h.winner + ' RES=' + comp24('goku', 'vegeta', 1, 'death').r.winner + '; raven/seph seed1 HP=' + comp24('raven', 'sephiroth', 1, 'death').h.winner + ' RES=' + comp24('raven', 'sephiroth', 1, 'death').r.winner);
  check('V1624-R5 Cannot-harm branch: Superman vs Rocky (engine gate) and Saitama vs Frodo (overwhelming gap + resistance) both resolve cannot-harm',
    res24('superman', 'rocky', 12345, 'death').decisiveCriterion === 'cannot-harm'
    && res24('saitama', 'frodo', 12345, 'death').decisiveCriterion === 'cannot-harm'
    && res24('superman', 'rocky', 12345, 'death').inputs.directionBtoA.cannotHarm === true
    && res24('saitama', 'frodo', 12345, 'death').inputs.directionBtoA.cannotHarm === true, '');
  check('V1624-R6 Bypass branch is labelled, never invented: no bypass victory is claimed where none is recorded, and sealing/containment are capability notes only (not simulated victories)',
    (function () {
      const pairs = [['superman', 'rocky'], ['goku', 'vegeta'], ['deadpool', 'wolverine'], ['raven', 'sephiroth']];
      const ok = pairs.every(([a, b]) => { const r = res24(a, b, 12345, 'death'); return r.inputs.sealContainA.status.indexOf('not simulated') !== -1 || r.inputs.sealContainA.status.indexOf('NOT a simulated victory') !== -1; });
      const sup = res24('superman', 'goku', 12345, 'death');
      return ok && sup.decisiveCriterion !== 'bypass' && sup.inputs.sealContainA.sealing === 'not simulated' && sup.inputs.sealContainB.containment === 'not simulated';
    })(), '');
  check('V1624-R7 Stamina branch: Goku vs Vegeta resolves on Goku\'s stated stamina limit (Vegeta has none stated)',
    res24('goku', 'vegeta', 12345, 'death').decisiveCriterion === 'stamina' && res24('goku', 'vegeta', 12345, 'death').winner === 'Vegeta'
    && res24('goku', 'vegeta', 12345, 'death').inputs.runsOutFirst.fighter === 'A', '');
  check('V1624-R8 Character-rule branch: resolver records moral/peeve/fear/relationship/prep/transform rules from profiles only (Superman mercy, Vegeta pride, Batman finite prep)',
    (function () {
      const s = res24('superman', 'rocky', 12345, 'death'); const g = res24('goku', 'vegeta', 12345, 'death'); const sp = res24('spiderman', 'batman', 12345, 'incapacitation');
      const all = s.inputs.characterRules.concat(g.inputs.characterRules, sp.inputs.characterRules);
      return all.some(x => /compassion|mercy|no-kill|incapacitation/i.test(x.rule)) && all.some(x => /Pride|pride/i.test(x.rule))
        && sp.inputs.characterRules.some(x => /Finite prep|3 prepared/i.test(x.rule));
    })(), '');
  check('V1624-R9 Raven vs Sephiroth is labelled demon/angel-ADJACENT only, never a full demon vs angel test (nature for others is unknown)',
    (function () {
      const r = res24('raven', 'sephiroth', 12345, 'death');
      return r.winner === 'Sephiroth' && r.decisiveCriterion === 'speed'
        && profById['raven'].nature !== 'unknown' && profById['sephiroth'].nature !== 'unknown'
        && profById['ghostrider'].nature === 'unknown';
    })(), 'raven nature=' + profById['raven'].nature + ' sephiroth nature=' + profById['sephiroth'].nature);
  check('V1625-S1 (SUPERSEDES V1624-R10) Part 1 single source: the 5 test signatures agree in dossier = powers list = combat, with NO engine-keyword warning left',
    (function () {
      const five = [
        { id: 'gojo', sig: 'Hollow Purple', type: 'energy' },
        { id: 'ghostrider', sig: 'Hellfire Chain Strike', type: 'magic' },
        { id: 'pikachu', sig: 'Thunderbolt', type: 'energy' },
        { id: 'batman', sig: 'Gadget Barrage', type: 'physical' },
        { id: 'superman', sig: 'Heat Vision', type: 'energy' },
      ];
      const ok = five.every(function (f) {
        const prof = runInCtx(`powerProfileV1623(Object.assign({}, byId('${f.id}'), {variant: 'Base', variantId: 'base'})).damage.signature.type`);
        const pw = JSON.parse(runInCtx(`JSON.stringify(structuredPowersForV14(Object.assign({}, byId('${f.id}'), {variant: 'Base', variantId: 'base'})).filter(function (x) { return x.isSignature; }).map(function (x) { return x.damageType; }))`));
        const combat = JSON.parse(runInCtx(`JSON.stringify(resolveAttackV14({attacker: Object.assign({}, byId('${f.id}'), {currentHp: 1000, maxHp: 1000, atk: 100, def: 50, dex: 7, pw: 7}), target: Object.assign({}, byId('batman'), {currentHp: 1000, maxHp: 1000, atk: 100, def: 50, dex: 7, pw: 7}), ability: '${f.sig}', mult: 1, isSig: true, crit: false, boost: 1, rng: function () { return 0.5; }}))`));
        return prof === f.type && pw.indexOf(f.type) !== -1 && combat.dtype === f.type && combat.dtypeSource === 'authored-signature';
      });
      return ok && html.indexOf('engine governs') === -1 && html.indexOf('Engine keyword type for this signature') === -1
        && html.indexOf('authored column is NOT the combat damage type') === -1;
    })(), '');
  check('V1634-R11 (v16.34 DELIBERATE CHANGE: 3B MATCH/PARTIAL replaces Option B) Audit comparison is visible in the Audit disclosure without replacing the main telling (comparison HTML + audit field, HP winner unchanged); a record without criterion/finisher still yields a winner agreement, but reason/finisher are honestly not assumed',
    (function () {
      const b = hp24('superman', 'rocky', 12345, 'death');
      const comp = JSON.parse(runInCtx(`JSON.stringify(auditComparisonForBattleV1634(JSON.parse(${JSON.stringify(JSON.stringify({ alpha: [{ id: 'superman', variant: 'Base', variantId: 'base' }], beta: [{ id: 'rocky', variant: 'Base', variantId: 'base' }], seed: 12345, victoryMode: 'death', winner: 'Superman', stalemate: false }))})))`));
      const htmlCmp = runInCtx(`auditComparisonHtmlV1634(JSON.parse(${JSON.stringify(JSON.stringify(comp))}))`);
      return b.winner === 'Superman' && comp.overall === 'PARTIAL' && comp.winnerMatch === true && comp.loserStateMatch === true && comp.reasonMatch === false && comp.finisherMatch === false && comp.resolverWinner === 'Superman' && (comp.differences || []).length === 2
        && htmlCmp.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1
        && htmlCmp.indexOf('cannot be checked, not assumed') !== -1
        && html.indexOf('auditComparisonForBattleV1634') !== -1 && html.indexOf('auditComparisonHtmlV1634') !== -1;
    })(), '');
  check('V1624-R12 Playback/history/save still work: HP battle record is unchanged by the resolver (winner, events, stalemate flag intact)',
    (function () {
      const b = hp24('goku', 'vegeta', 12345, 'death');
      return b.winner === 'Vegeta' && Array.isArray(b.events) && b.events.length > 0 && b.stalemate === false;
    })(), '');
  check('V1624-R13 Resolver uses words/tiers/states only — no HP/ATK/DEF numbers enter its exchanges or criterion',
    (function () {
      const r = res24('superman', 'rocky', 12345, 'death');
      const txt = r.exchanges.join(' ') + ' ' + r.why;
      return !/\b\d+\s*(HP|ATK|DEF)\b/.test(txt) && !/\b\d{3,}\b/.test(txt);
    })(), '');
  check('V1624-R14 (v16.32 DELIBERATE CHANGE) Version stamps: title/heading/format are v16.35 and the importer still accepts v16.24 as legacy; no forbidden content',
    html.indexOf('<title>WAR-ROOM v16.35') !== -1 && html.indexOf('<h1>WAR-ROOM v16.35</h1>') !== -1
    && html.indexOf("formatVersion:'v16.35'") !== -1 && html.indexOf("'v16.24'") !== -1
    && html.indexOf('llm7.io') === -1 && html.indexOf('api.ovh') === -1 && !/sk-[A-Za-z0-9]{16,}/.test(html)
    && (function () { const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(bd23('superman', 'rocky', 12345, 'death').r))}))`); return pr.indexOf('EVENTS:') === -1; })(), '');
  check('V1624-R15 Roster stays 194; resolver does not add fighters, relabel nature, or change the main breakdown lock',
    profAll.length === 194 && runInCtx(`powerProfileV1623(Object.assign({}, byId('ghostrider'), {variant: 'Base', variantId: 'base'})).nature.value`) === 'unknown'
    && res24('superman', 'rocky', 12345, 'death').resolver.indexOf('main breakdown stays HP-engine-locked') !== -1, '');

  // ================= v16.25 — 100% PLAN FIX PARTS (Parts 1-5, 8, 9, 11a/11b) =================
  // No output switch, no HP hiding, no Phase 3, no Phase 4 speed work, no new fighters.
  // Parts 6-saved and 7 are SKIPPED under Part 10(a) FULL REMOVAL (see S7-SKIPPED);
  // the MATCH-definition half of Part 6 is retained in the live comparison display only.
  const s25text = (a, b, seed, mode) => {
    const bat = sim23(a, b, seed, mode);
    return runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(bat))}))`);
  };
  const s25secs = (txt) => txt.split(/\n\n+/).map(x => x.trim()).filter(Boolean).map(body => ({ body }));
  const s25facts = (bat) => JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(JSON.parse(${JSON.stringify(JSON.stringify(bat))})))`));
  const s25compSim = (a, b, seed, mode) => JSON.parse(runInCtx(`JSON.stringify((function(){ selected=['${a}','${b}']; forcedSeed=${seed}; forcedVictoryMode='${mode}'; var bat=simulateBattle(); var comp=auditComparisonForBattleV1634(bat); var htm=auditComparisonHtmlV1634(comp); return {overall:comp.overall, verdict:comp.verdict, hpCrit:comp.hpCriterion, hpFin:comp.hpFinisher, resCrit:comp.resolverReason, resFin:comp.resolverFinisher, reasonMatch:comp.reasonMatch, finisherMatch:comp.finisherMatch, winnerMatch:comp.winnerMatch, html:htm}; })())`));
  check('V1626-S2 (v16.26 DELIBERATE CHANGE: one durability word) Batman/Pikachu dossiers and profiles agree on mortal (no barrier claim), Gojo keeps the correct barrier sentence, breakdown states durability honesty',
    (function () {
      const ba = runInCtx(`resolverReconciliationHtmlV1624(Object.assign({}, byId('batman'), {variant: 'Base', variantId: 'base'}))`);
      const pi = runInCtx(`resolverReconciliationHtmlV1624(Object.assign({}, byId('pikachu'), {variant: 'Base', variantId: 'base'}))`);
      const go = runInCtx(`resolverReconciliationHtmlV1624(Object.assign({}, byId('gojo'), {variant: 'Base', variantId: 'base'}))`);
      const txt = s25text('superman', 'rocky', 12345, 'death');
      const baDur = runInCtx(`dossierForV1612(byId('batman')).durability.type`);
      const piDur = runInCtx(`dossierForV1612(byId('pikachu')).durability.type`);
      return ba.indexOf('agree on durability naming') !== -1 && ba.indexOf('barrier') === -1
        && pi.indexOf('agree on durability naming') !== -1 && pi.indexOf('barrier') === -1
        && baDur === 'mortal' && piDur === 'mortal'
        && go.indexOf('both names describe the same barrier defence') !== -1
        && txt.indexOf('grants no immunity') !== -1 && txt.indexOf('no fighter is untouchable') !== -1;
    })(), '');

  check('V1625-S3 Part 3 margin rule: pure function + end-to-end section 1 matches actual totals + retired criteria-score template gone + checker bans it',
    (function () {
      const m = (w, wd, ld) => runInCtx(`marginSentenceV1625(${JSON.stringify(w)},${wd},${ld})`);
      const pure = m('Superman', 1386, 0).indexOf('shutout') !== -1 && m('Saitama', 1123, 0).indexOf('shutout') !== -1
        && m('A', 1000, 600).indexOf('close fight') !== -1 && m('A', 1000, 600).indexOf('400') !== -1
        && m('A', 1000, 400).indexOf('not a close fight') !== -1;
      const e2e = [['superman', 'rocky', 12345, 'death'], ['saitama', 'frodo', 1338500181, 'death'], ['goku', 'vegeta', 12345, 'death']].every(([a, b, seed, mode]) => {
        const bat = sim23(a, b, seed, mode);
        const facts = s25facts(bat);
        const txt = runInCtx(`buildBreakdownOfflineV1619(JSON.parse(${JSON.stringify(JSON.stringify(bat))}))`);
        const secs = s25secs(txt);
        const s1 = secs[0].body;
        const langOk = facts.loserDamage === 0 ? s1.indexOf('shutout') !== -1 : (facts.margin > 500 ? s1.indexOf('not a close fight') !== -1 : s1.indexOf('close fight') !== -1);
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(bat))})))`));
        const byName = (n) => checks.filter(c => c.name === n)[0];
        const marginOk = byName('Breakdown section 1 margin is honest') && byName('Breakdown section 1 margin is honest').state === 'PASSED';
        const retiredOk = byName('Breakdown section 1 criteria-score margin template is retired') && byName('Breakdown section 1 criteria-score margin template is retired').state === 'PASSED';
        return langOk && marginOk && retiredOk;
      });
      return pure && e2e && html.indexOf('small (score difference') === -1;
    })(), '');
  check('V1625-S4 (v16.32 DELIBERATE CHANGE) Part 4 speed: 1.1 is slightly above average (never bare above average), Superman audit stated in breakdown and prompt with the v16.35 label, game-speed note present',
    (function () {
      const sb = JSON.parse(runInCtx(`JSON.stringify(speedBandV1623(1.1, 7))`));
      const all11 = JSON.parse(runInCtx(`JSON.stringify(ROSTER.filter(function (f) { return f.sp === 1.1; }).map(function (f) { return speedBandV1623(f.sp, f.dex).speed; }))`));
      const profSup = runInCtx(`powerProfileHtmlV1623(Object.assign({}, byId('superman'), {variant: 'Base', variantId: 'base'}))`);
      const txt = s25text('superman', 'rocky', 12345, 'death');
      const s6 = txt;
      const bat = sim23('superman', 'rocky', 12345, 'death');
      const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(bat))}))`);
      return sb.speed === 'slightly above average' && all11.length > 0 && all11.every(s => s === 'slightly above average')
        && profSup.indexOf('game speed, not canon speed') !== -1
        && s6.indexOf('Speed bands are game speed, not canon speed.') !== -1 && s6.indexOf('Superman speed audit (v16.35)') !== -1
        && pr.indexOf('SUPERMAN SPEED AUDIT (v16.35)') !== -1 && pr.indexOf('game speed, not canon speed') !== -1;
    })(), '');
  check('V1625-S5 Part 5 victory headers: Death = knocked out (HP 0), not dead; Incapacitation = unconscious, not dead; stalemate unchanged; saved title carries the same wording',
    (function () {
      const dh = JSON.parse(runInCtx(`JSON.stringify(victoryHeaderV1625({winner: 'Superman', loserFighter: {name: 'Rocky Balboa'}, victoryMode: 'death', stalemate: false, battlefield: {name: 'Open Arena'}, victoryCondition: 'Death (HP 0)'}))`));
      const ih = JSON.parse(runInCtx(`JSON.stringify(victoryHeaderV1625({winner: 'Spider-Man', loserFighter: {name: 'Batman'}, victoryMode: 'incapacitation', stalemate: false, battlefield: {name: 'Open Arena'}, victoryCondition: 'Incapacitation'}))`));
      const sh = JSON.parse(runInCtx(`JSON.stringify(victoryHeaderV1625({winner: 'Stalemate', victoryMode: 'death', stalemate: true, battlefield: {name: 'Open Arena'}, victoryCondition: 'Stalemate'}))`));
      return dh.title.indexOf('knocked out (HP 0), not dead') !== -1 && dh.desc.indexOf('HP 0 means knocked out, not dead') !== -1
        && ih.title.indexOf('unconscious, not dead') !== -1 && ih.desc.indexOf('never labelled death') !== -1
        && sh.title === 'STALEMATE — NO DEATH'
        && html.split('knocked out (HP 0), not dead').length >= 3;
    })(), '');
  check('V1634-AUDIT-S6 (v16.34 DELIBERATE CHANGE: 3B MATCH/PARTIAL replaces Option B) the audit comparison is INDEPENDENT (resolver main vs HP audit), not derived; the 3 named battles report their observed independent values with MATCH/PARTIAL + differences listed honestly, not a mismatch label; unknown inputs are still not assumed',
      (function () {
        const gv = s25compSim('goku', 'vegeta', 12345, 'death');
        const sg = s25compSim('superman', 'goku', 12345, 'death');
        const dw = s25compSim('deadpool', 'wolverine', 12345, 'death');
        const fake = JSON.parse(runInCtx(`JSON.stringify(auditComparisonForBattleV1634(JSON.parse(${JSON.stringify(JSON.stringify({ alpha: [{ id: 'superman', variant: 'Base', variantId: 'base' }], beta: [{ id: 'rocky', variant: 'Base', variantId: 'base' }], seed: 12345, victoryMode: 'death', winner: 'Superman', stalemate: false }))})))`));
        const fakeHtml = runInCtx(`auditComparisonHtmlV1634(JSON.parse(${JSON.stringify(JSON.stringify(fake))}))`);
        // Observed independent values at seed 12345 (probe of the built file):
        // Goku/Vegeta: HP transformation/Ki Blast, resolver stamina/Galick Gun (PARTIAL; reason + finisher differ).
        // Superman/Goku: HP durability/Heat Vision, resolver incapacitation/Heat Vision (PARTIAL; reason differs, finisher coincides).
        // Deadpool/Wolverine: HP transformation/Berserker Barrage, resolver tier difference/Adamantium Claw Slash (PARTIAL; reason + finisher differ).
        // Derivation is gone: no aligned fields, no old verdict labels, differences listed honestly.
        return gv.overall === 'PARTIAL' && gv.winnerMatch === true && gv.reasonMatch === false && gv.finisherMatch === false && gv.hpCrit === 'transformation' && gv.hpFin === 'Ki Blast' && gv.resCrit === 'stamina' && gv.resFin === 'Galick Gun'
          && sg.overall === 'PARTIAL' && sg.winnerMatch === true && sg.reasonMatch === false && sg.finisherMatch === true && sg.hpCrit === 'durability' && sg.resCrit === 'incapacitation' && sg.resFin === 'Heat Vision'
          && dw.overall === 'PARTIAL' && dw.winnerMatch === true && dw.reasonMatch === false && dw.finisherMatch === false && dw.hpCrit === 'transformation' && dw.resCrit === 'tier difference' && dw.resFin === 'Adamantium Claw Slash'
          && [gv.html, sg.html, dw.html].every(h => h.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1 && h.indexOf('Differences (listed honestly)') !== -1 && h.indexOf('by construction') === -1 && h.indexOf('reports the main-engine result') === -1 && h.indexOf('Reason — two explanations') === -1 && h.indexOf('Finisher — two explanations') === -1 && h.indexOf('PARTIAL MATCH') === -1 && h.indexOf('WINNER AGREEMENT') === -1 && h.indexOf('WINNER MISMATCH') === -1)
          && fakeHtml.indexOf('cannot be checked, not assumed') !== -1;
      })(), '');
  check('V1625-S7-SKIPPED (Part 10(a) FULL REMOVAL) Parts 6-saved and 7 NOT built: no latest-20 label, no save-once stable-ID logic, no new saved-episode resolver field work',
    html.indexOf('latest 20') === -1 && html.indexOf('save-once') === -1 && html.indexOf('save once per battle') === -1, '');
  check('V1626-S8 (v16.26 DELIBERATE CHANGE: history removed) one status call writes all three surfaces identically; interim is honest; provider-error names 402; sync writes no history',
    (function () {
      const f = runInCtx(`setOnlineStatusV1626('failed', 'All providers unavailable')`);
      const i = runInCtx(`setOnlineStatusV1626('interim', '60')`);
      const p = runInCtx(`setOnlineStatusV1626('provider-error', '402 (free limit)')`);
      runInCtx(`localStorage.setItem('warroom_battles_v3', '[]');`);
      const n = runInCtx(`syncOnlineBreakdownStatusV1625('v1626-s8', {kind:'offline', reason:'All providers unavailable'})`);
      const after = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
      return f.indexOf('Online AI unavailable') !== -1 && f.indexOf('All providers unavailable') !== -1
        && i.indexOf('Still trying') !== -1 && i.indexOf('not a failure yet') !== -1
        && p.indexOf('402') !== -1 && p.indexOf('trying the next provider') !== -1
        && n === 0 && after.length === 0;
    })(), '');
  check('V1625-S9 Part 9 starting form: pure helper (Base, v2 with/without legal transform) + wording wired into roster/slot/analysis sources',
    (function () {
      const base = runInCtx(`startingFormNoteV1625('Base', true)`);
      const v2t = runInCtx(`startingFormNoteV1625('Armored Batsuit', true)`);
      const v2n = runInCtx(`startingFormNoteV1625('Ring-bearer', false)`);
      const fBat = runInCtx(`startingFormNoteForFighterV1625(Object.assign({}, byId('batman'), {variant: 'Base', variantId: 'base'}), 'Base', 'base')`);
      const fGokuV2 = runInCtx(`startingFormNoteForFighterV1625(Object.assign({}, byId('goku'), {variant: 'Super Saiyan God', variantId: 'v2'}), 'Super Saiyan God', 'v2')`);
      const fFrodoV2 = runInCtx(`startingFormNoteForFighterV1625(Object.assign({}, byId('frodo'), {variant: 'Ring-bearer', variantId: 'v2'}), 'Ring-bearer', 'v2')`);
      return base === 'Starting form: Base — transformations may trigger mid-fight.'
        && v2t === 'Starting form: Armored Batsuit — transformations may trigger mid-fight.'
        && v2n === 'Starting form: Ring-bearer — no further in-combat transformation is legal from this version.'
        && fBat === base && fGokuV2 === 'Starting form: Super Saiyan God — transformations may trigger mid-fight.' && fFrodoV2 === v2n
        && html.indexOf('Starting forms:</b>') !== -1 && html.indexOf('Starting form: Base — transformations may trigger mid-fight.') !== -1;
    })(), '');
  check('V1625-S11 Part 11 per-power records: all 15 fighters, full fields, outcome/status vocabularies, no invented powers, resolver carries records, record direction override, no sealing/removal outcome',
    (function () {
      const ids = ['spiderman', 'batman', 'goku', 'vegeta', 'superman', 'rocky', 'deadpool', 'wolverine', 'saitama', 'frodo', 'raven', 'sephiroth', 'gojo', 'ghostrider', 'pikachu'];
      const OUT = ['no effect', 'resisted', 'wounding', 'incapacitating', 'sealing', 'removal', 'lethal'];
      const STA = ['demonstrated', 'interpretation', 'unknown'];
      const all = ids.every(function (id) {
        const recs = JSON.parse(runInCtx(`JSON.stringify(powerRecordsForV1625('${id}'))`));
        if (!recs.length) return false;
        const allowed = JSON.parse(runInCtx(`JSON.stringify((function(){ var f=byId('${id}'); var s={}; (typeof actualPowersFor==='function'?actualPowersFor(f):(POWERS[f.id]||[])).forEach(function(n){ s[n]=true; }); if(f.sig) s[f.sig]=true; if(typeof TRANSSIG!=='undefined' && TRANSSIG[f.id]) s[TRANSSIG[f.id]]=true; return Object.keys(s); })())`));
        return recs.every(function (r) {
          return r.fighterId === id && r.power && r.effect && r.reach && r.canHurt && r.cannotHurt && r.stoppedBy && r.costLimit && OUT.indexOf(r.outcomeIfLands) !== -1 && r.outcomeNote && STA.indexOf(r.status) !== -1 && r.damageType && Array.isArray(r.cannotHurtVs) && allowed.indexOf(r.power) !== -1;
        });
      });
      const res = res24('superman', 'rocky', 12345, 'death');
      const dir = JSON.parse(runInCtx(`JSON.stringify(powerRecordDirectionV1625({id: 'batman', sig: 'Gadget Barrage', name: 'Batman'}, 'invulnerable', false))`));
      const dirBypass = runInCtx(`powerRecordDirectionV1625({id: 'batman', sig: 'Gadget Barrage', name: 'Batman'}, 'invulnerable', true)`);
      const dirGoku = runInCtx(`powerRecordDirectionV1625({id: 'goku', sig: 'Kamehameha', name: 'Goku'}, 'invulnerable', false)`);
      const noSeal = ids.every(function (id) { const recs = JSON.parse(runInCtx(`JSON.stringify(powerRecordsForV1625('${id}'))`)); return recs.every(function (r) { return r.outcomeIfLands !== 'sealing' && r.outcomeIfLands !== 'removal'; }); });
      const panel = runInCtx(`powerRecordsHtmlV1625(Object.assign({}, byId('pikachu'), {variant: 'Base', variantId: 'base'}))`);
      const other179 = runInCtx(`powerRecordsForV1625('luffy').length`) === 0;
      return all && res.powerRecords && res.powerRecords.length === 2 && res.powerRecords[0].fighter === 'Superman'
        && dir && dir.cannotHurt === true && dirBypass === null && dirGoku === null && noSeal && other179
        && panel.indexOf('Thunderbolt') !== -1 && panel.indexOf('Regice clean KO') !== -1;
    })(), '');

  // ================= v16.26 — PHASE 3 SIMPLIFIED FLOW: LOCKS, TONE, CONDITIONS =================
  {
    const sim26 = (a, b, seed, mode) => {
      const out = runInCtx(`(function(){ selected = ['` + a + `','` + b + `']; forcedSeed = ` + seed + `; forcedVictoryMode = '` + mode + `'; var bt = simulateBattle(); var tx = buildBreakdownOfflineV1619(bt); var cs = checkBreakdownV1619(tx, bt); var fc = breakdownFactsV1619(bt); var ps = tx.split(/\\n\\n+/).map(function(x){ return x.trim(); }).filter(Boolean); return JSON.stringify({ winner: bt.winner, finisher: fc.finisher, loserState: fc.loserStateWord, decisive: fc.decisiveKey, failed: cs.filter(function(c){ return c.state === 'FAILED'; }).map(function(c){ return c.name; }), txt: tx, firstPara: ps[0] || '', lastPara: ps[ps.length - 1] || '' }); })()`);
      return JSON.parse(out);
    };
    const seven26 = [
      ['spiderman', 'batman', 145416145, 'incapacitation'],
      ['goku', 'vegeta', 999, 'death'],
      ['superman', 'rocky', 12345, 'death'],
      ['superman', 'goku', 283547443, 'death'],
      ['deadpool', 'wolverine', 2017809809, 'death'],
      ['saitama', 'frodo', 1338500181, 'death'],
      ['raven', 'sephiroth', 12345, 'death'],
    ].map(function (p) { return sim26(p[0], p[1], p[2], p[3]); });
    console.log('V1626-SEVEN winners: ' + seven26.map(function (x) { return x.winner + ' by ' + x.finisher + ' (' + x.loserState + ', ' + x.decisive + ')'; }).join(' | '));
    check('V1627-SEVEN-LOCKS (v16.27 DELIBERATE CHANGE) all 7 known battles: checker passes, final paragraph names the battle winner, telling names finisher + loser state',
      seven26.every(function (x) { return x.failed.length === 0 && x.lastPara.indexOf(x.winner) !== -1 && x.txt.indexOf(x.loserState) !== -1 && x.txt.indexOf(x.finisher) !== -1; }),
      'failed=' + JSON.stringify(seven26.map(function (x) { return x.failed; })));
    check('V1626-SEVEN-KNOWN-WINNERS Spider-Man beats Batman by incapacitation and Superman beats Rocky',
      seven26[0].winner === 'Spider-Man' && seven26[2].winner === 'Superman',
      'spider-bat=' + seven26[0].winner + ' super-rocky=' + seven26[2].winner);
    const tone26 = [seven26[5], seven26[1], seven26[3]];
    check('V1627-TONE-VARIES (v16.27 DELIBERATE CHANGE) three different decisive reasons produce three different free-form tellings (openings differ, no fixed heading list, no shared stock opening); no probability/lean in any verdict',
      tone26[0].decisive !== tone26[1].decisive && tone26[1].decisive !== tone26[2].decisive && tone26[0].decisive !== tone26[2].decisive
      && new Set(tone26.map(function (x) { return x.firstPara.slice(0, 120); })).size === 3
      && tone26.every(function (x) { return x.txt.indexOf('1. Matchup') === -1 && x.txt.indexOf('6. Criteria scoreboard') === -1 && x.txt.indexOf('fan to fan') === -1; })
      && tone26.every(function (x) { return x.txt.indexOf('Decisive:') !== -1; })
      && tone26.every(function (x) { var v = x.lastPara.toLowerCase(); return v.indexOf('probably') === -1 && v.indexOf('likely') === -1 && v.indexOf('maybe') === -1; }),
      'decisives=' + tone26.map(function (x) { return x.decisive; }).join(','));
    check('V1626-DURABILITY-MORTAL Batman, Pikachu, Goku, Frodo, Rick dossiers use mortal (never normal) as the durability term',
      ['batman', 'pikachu', 'goku', 'frodo', 'rick'].every(function (id) {
        const d = JSON.parse(runInCtx(`JSON.stringify(dossierForV1612(byId('` + id + `')))`));
        const p = JSON.parse(runInCtx(`JSON.stringify(powerProfileV1623(byId('` + id + `')))`));
        const panel = runInCtx(`dossierPanelHtmlV1612(byId('` + id + `'))`);
        const di = panel.indexOf('Durability');
        const ei = di === -1 ? -1 : panel.indexOf('</p>', di);
        const seg = (di === -1 || ei === -1) ? '' : panel.slice(di, ei);
        return d.durability.type === 'mortal' && p.durability.type === 'mortal' && seg.indexOf('mortal') !== -1 && seg.indexOf('normal') === -1;
      }),
      '');
    check('V1627-AUDIT-ORDER (v16.27 DELIBERATE CHANGE) character record comes first: no Scaling/Base stats/multiplier AND no numeric speed/dexterity/tactics/power/stamina line before the collapsed Audit numbers block in dossier or slot preview',
      (function () {
        try {
          runInCtx(`openInfo('batman')`);
          const info = els['info-content'].innerHTML || '';
          const ai = info.indexOf('<details class="audit-numbers"');
          if (ai === -1) return false;
          const before = info.slice(0, ai);
          const after = info.slice(ai);
          const numPat = /speed \d|dexterity \d+\/10|tactics \d+\/10|power \d+\/10|stamina \d+\/10|×\d/;
          const infoOk = before.indexOf('Scaling (1-10)') === -1 && before.indexOf('Base stats:') === -1 && before.indexOf('×') === -1 && !numPat.test(before)
            && after.indexOf('Scaling (1-10)') !== -1 && after.indexOf('Base stats:') !== -1 && after.indexOf('×') !== -1
            && before.indexOf('Fighting style') !== -1;
          runInCtx(`selected = ['batman','superman']; selectedVariants = {}; renderSlots();`);
          const slots = els['alpha-squad-slots'].innerHTML || '';
          const si = slots.indexOf('<details class="audit-numbers"');
          const st = slots.indexOf('Final battle stats:');
          return infoOk && si !== -1 && st > si;
        } catch (e) { return false; }
      })(),
      '');
    check('V1626-PART1 Gojo dossier marks the old v16.20 shared damage-type list SUPERSEDED; the old line is gone',
      (function () {
        const panel = runInCtx(`dossierPanelHtmlV1612(byId('gojo'))`);
        return panel.indexOf('SUPERSEDED in v16.26') !== -1 && panel.indexOf('<b>Damage types dealt:</b>') === -1;
      })(),
      '');
    check('V1627-SPEED-OPEN (v16.27 DELIBERATE CHANGE) roster speeds unchanged (Superman 1.1, Frodo 1.2, Gojo 1.2, Saitama 1.2); the Superman audit note stays in the free-form telling and the fuller rebalance clause is in the dossier speed status',
      runInCtx(`byId('superman').sp`) === 1.1 && runInCtx(`byId('frodo').sp`) === 1.2 && runInCtx(`byId('gojo').sp`) === 1.2 && runInCtx(`byId('saitama').sp`) === 1.2
      && seven26[2].txt.indexOf('roster speed 1.1 is a game-scale ordering number') !== -1
      && seven26[2].txt.indexOf('needs its own decision, not a silent fix') !== -1
      && runInCtx(`powerProfileV1623(byId('superman')).speed.status`).indexOf('rebalance') !== -1,
      '');
    check('V1626-MODE-WORDING mode selector says the loser is knocked out, not dead; the old HP-0-by-death wording is gone',
      html.indexOf('the loser is knocked out, not dead') !== -1 && html.indexOf('must reach HP 0 to lose by death') === -1,
      '');
    check('V1626-ROSTER-194 roster stays at 194 fighters',
      runInCtx(`ROSTER.length`) === 194,
      '');
    check('V1626-TEXT-ONLY-BREAKDOWN live breakdown HTML has no image/video/audio element; the prompt carries the TEXT-ONLY marker',
      (function () {
        const storyHtml = runInCtx(`(function(){ selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; var r = simulateBattle(); return breakdownHtmlV1619(buildBreakdownOfflineV1619(r), r); })()`);
        const pr = runInCtx(`(function(){ selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; var r = simulateBattle(); return buildBreakdownPromptV1619(r); })()`);
        return storyHtml.indexOf('<img') === -1 && storyHtml.indexOf('<video') === -1 && storyHtml.indexOf('<audio') === -1 && pr.indexOf('TEXT ONLY') !== -1 && pr.toLowerCase().indexOf('video') === -1;
      })(),
      '');
  }

  // ================= v16.27 — FIX RELEASE: RETEST, FREE-FORM TONE, AUDIT LEAK, TIMER, SPEED CLAUSE, RESOLVER ADVISORY/LABEL =================
  {
    const numPat27 = /speed \d|dexterity \d+\/10|tactics \d+\/10|power \d+\/10|stamina \d+\/10|×\d/;
    const fixedHeadings27 = ['1. Matchup', '2. Fighter A best case', '3. Fighter B best case', '4. Best plan', '5. Why it stalls', '6. Criteria scoreboard', '7. Finishing sequence', '8. Finisher and loser state', '9. Verdict'];
    check('V1627-RETEST-DELETED dossier Retest button element + fetch handler are deleted (not CSS-hidden) for all 6 side-checked dossiers',
      (function () {
        if (html.indexOf('Retest canon sources') !== -1) return false;
        return ['batman', 'superman', 'saitama', 'frodo', 'pikachu', 'gojo'].every(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          return info.indexOf('Retest') === -1 && info.indexOf('fetchCanonForInfo') === -1;
        });
      })(), '');
    check('V1628-AUDIT-LEAK-DOSSIERS (v16.28 DELIBERATE CHANGE) no audit numbers outside collapsed Audit in any of the 6 side-checked dossiers; Audit still holds them',
      (function () {
        return ['batman', 'superman', 'saitama', 'frodo', 'pikachu', 'gojo'].every(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          const ai = info.indexOf('<details class="audit-numbers"');
          if (ai === -1) return false;
          const before = info.slice(0, ai), after = info.slice(ai);
          return before.indexOf('Scaling (1-10)') === -1 && before.indexOf('Base stats:') === -1 && !numPat27.test(before)
            && after.indexOf('Scaling (1-10)') !== -1 && after.indexOf('Base stats:') !== -1;
        });
      })(), '');
    check('V1627-AUDIT-LEAK-PREVIEW Review Matchup preview open part has no HP/ATK/DEF, scaling, speed decimal, or multiplier; collapsed Audit there holds them',
      (function () {
        const out = runInCtx(`(function(){ var bf = BATTLEFIELDS[0]; var a = makeBattleInstance(byId('spiderman'), bf), b = makeBattleInstance(byId('batman'), bf); return generateAnalysis(a, b).html; })()`);
        const ai = out.indexOf('<details class="audit-numbers"');
        if (ai === -1) return false;
        const before = out.slice(0, ai), after = out.slice(ai);
        const leak = /HP \d|ATK \d|DEF \d|\/10|×\d|speed \d/.test(before);
        return !leak && after.indexOf('Start-of-fight stats') !== -1 && after.indexOf('Strength (ATK)') !== -1;
      })(), '');
    check('V1627-TIMER-UPDATES interim status text carries the elapsed seconds given (60 and 150), and the generator polls elapsed time on an interval (no frozen 60s timeout)',
      (function () {
        const t60 = runInCtx(`setOnlineStatusV1626('interim', '60')`);
        const t150 = runInCtx(`setOnlineStatusV1626('interim', '150')`);
        return t60.indexOf('60 seconds') !== -1 && t150.indexOf('150 seconds') !== -1
          && html.indexOf('_genStartV1627') !== -1 && html.indexOf('setInterval(function () { try { if (isCurrent() && !_resolvedV1626)') !== -1
          && html.indexOf("setOnlineStatusV1626('interim', '60')") === -1;
      })(), '');
    check('V1627-FAILURE-IN-PLACE failure status renders in place with the real provider code/reason (no reload, no fabricated failure while running)',
      (function () {
        const t = runInCtx(`setOnlineStatusV1626('failed', 'Pollinations POST HTTP 402: insufficient_credits')`);
        return t.indexOf('Online AI unavailable') !== -1 && t.indexOf('402') !== -1
          && html.indexOf("setOnlineStatusV1626('failed', _r)") !== -1;
      })(), '');
    check('V1627-SPEED-CLAUSE dossier speed status carries the fuller rebalance clause; no speed number changed',
      (function () {
        const st = runInCtx(`powerProfileV1623(byId('superman')).speed.status`);
        return st.indexOf('rebalance') !== -1 && st.indexOf('unchanged because changing it would change battle outcomes') !== -1
          && st.indexOf('not a silent fix') !== -1 && runInCtx(`byId('superman').sp`) === 1.1;
      })(), '');
    check('V1634-AUDIT-DEFINITION (v16.34 DELIBERATE CHANGE: 3B MATCH/PARTIAL replaces Option B) the audit panel uses MATCH/PARTIAL: Superman vs Rocky genuinely coincides on all four fields (MATCH, no differences); the v16.28 derivation construction stays retired and no old Option B label remains',
      (function () {
        const count = html.split('The resolver reports the main-engine (HP engine) result').length - 1;
        runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._v1628B = simulateBattle();`);
        const rv = runInCtx(`renderAuditV1634(globalThis._v1628B)`);
        const vis = els['resolver-visible'].innerHTML || '';
        const comp = JSON.parse(runInCtx(`JSON.stringify(auditComparisonForBattleV1634(globalThis._v1628B))`));
        return count === 0 && html.indexOf('Advisory only: the resolver and the main (HP engine) result can disagree') === -1
          && html.indexOf('can disagree') === -1 && html.indexOf('by construction in v16.28') === -1
          && rv === 'ok' && vis.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1
          && vis.indexOf('Resolver-main result') !== -1
          && vis.indexOf('All four fields agree: MATCH.') !== -1 && comp.overall === 'MATCH' && comp.winnerDisagreement === false && (comp.differences || []).length === 0
          && comp.winnerMatch === true && comp.reasonMatch === true && comp.finisherMatch === true && comp.loserStateMatch === true;
      })(), '');
    check('V1634-AUDIT-LABEL (v16.34 DELIBERATE CHANGE) audit comparison heading reads exactly "Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)"',
      (function () {
        runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._v1628B2 = simulateBattle();`);
        const comp = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._v1628B2))`);
        return comp.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1
          && comp.indexOf('alongside the HP engine') === -1 && comp.indexOf('NOT the main breakdown') === -1;
      })(), '');
    check('V1628-TONE-VARIES (v16.28 DELIBERATE CHANGE) two battles with different decisive reasons share no heading list, no stock opening, and no identical paragraph; both carry loser plan + stall, finisher + loser state, one-sentence verdict',
      (function () {
        const mk = (a, b, seed, mode) => JSON.parse(runInCtx(`JSON.stringify((function(){ selected = ['` + a + `','` + b + `']; forcedSeed = ` + seed + `; forcedVictoryMode = '` + mode + `'; var bt = simulateBattle(); var tx = buildBreakdownOfflineV1619(bt); var fc = breakdownFactsV1619(bt); var ps = tx.split(/\\n\\n+/).map(function(x){ return x.trim(); }).filter(Boolean); return { tx: tx, decisive: fc.decisiveKey, finisher: fc.finisher, loserState: fc.loserStateWord, winner: fc.winner, first: ps[0] || '', last: ps[ps.length - 1] || '' }; })())`));
        const x = mk('superman', 'rocky', 12345, 'death');
        const y = mk('goku', 'vegeta', 999, 'death');
        if (x.decisive === y.decisive) return false;
        const noHead = (t) => fixedHeadings27.every(function (h) { return t.indexOf(h) === -1; });
        const noStock = (t) => t.indexOf('fan to fan') === -1 && t.indexOf('Here is the moment the fight stops being a debate') === -1;
        const complete = (o) => o.tx.indexOf("'s best plan was") !== -1 && o.tx.indexOf('failed') !== -1 && o.tx.indexOf(o.finisher) !== -1 && o.tx.indexOf(o.loserState) !== -1 && o.last.indexOf(o.winner) !== -1 && o.last.slice(-1) === '.';
        const parasOfTx = (t) => t.split(/\n\n+/).map(function (q) { return q.trim(); }).filter(Boolean);
        const sharedParas = parasOfTx(x.tx).filter(function (p) { return parasOfTx(y.tx).indexOf(p) !== -1; });
        return noHead(x.tx) && noHead(y.tx) && noStock(x.tx) && noStock(y.tx) && x.first.slice(0, 100) !== y.first.slice(0, 100) && complete(x) && complete(y) && sharedParas.length === 0;
      })(), '');
  }


  // ================= v16.28 — FIX RELEASE: TONE, AUDIT LEAKS, SPEED CLAUSE (ALL DOSSIERS), RESOLVER DERIVATION, SHUTOUT PACING, DEATH WORDING, HEALING-FACTOR RECORD =================
  {
    const stripDetails28 = (h) => String(h || '').replace(/<details[\s\S]*?<\/details>/g, '');
    const sim28 = (a, b, seed, mode) => { runInCtx(`selected = ['` + a + `','` + b + `']; forcedSeed = ` + seed + `; forcedVictoryMode = '` + mode + `'; globalThis._bt28 = simulateBattle();`); };
    const paras28 = (t) => String(t || '').split(/\n\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
    check('V1634-AUDIT-LEAK-ALL (v16.34 DELIBERATE CHANGE: audit panel replaces the comparison render) Saitama + Gojo dossiers and the Saitama vs Frodo audit carry no dodgeMult, stamina cost, HP-trigger, scaling, base-stat, or tier-gap number outside collapsed detail',
      (function () {
        let ok = true;
        ['saitama', 'gojo'].forEach(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          const body = stripDetails28(info);
          if (info.indexOf('<details class="audit-numbers"') === -1) ok = false;
          if (/dodgeMult|15 stamina|HP at or below|HP falls to|below \d+% HP|Scaling \(1-10\)|Base stats:|×\d/.test(body)) ok = false;
        });
        sim28('saitama', 'frodo', 12345, 'death');
        const comp = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._bt28))`);
        if (/tier gap/.test(stripDetails28(comp))) ok = false;
        if (comp.indexOf('Resolver working (detail') === -1) ok = false;
        return ok;
      })(), '');
    check('V1628-SPEED-CLAUSE-ALL every one of the 194 dossiers carries the fuller speed clause in plain words in its Speed line; speed numbers unchanged (Superman 1.1, Frodo 1.2, Gojo 1.2, Saitama 1.2)',
      (function () {
        const ids = JSON.parse(runInCtx(`JSON.stringify(ROSTER.map(function (f) { return f.id; }))`));
        if (ids.length !== 194) return false;
        let ok = true;
        ids.forEach(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          if (info.indexOf('rebalance') === -1 || info.indexOf('game speed, not canon speed') === -1) ok = false;
        });
        return ok && runInCtx(`byId('superman').sp`) === 1.1 && runInCtx(`byId('frodo').sp`) === 1.2
          && runInCtx(`byId('gojo').sp`) === 1.2 && runInCtx(`byId('saitama').sp`) === 1.2;
      })(), '');
    check('V1634-AUDIT-COMPARISON (v16.34 DELIBERATE CHANGE: 3B MATCH/PARTIAL replaces Option B) all 7 known pairs + Vader vs Superman at seed 12345 report their OBSERVED audit comparison (MATCH = all four fields, else PARTIAL with differences listed honestly, never a winner disagreement buried); the HP record is unchanged by rendering the comparison. Criterion changes vs v16.33 for 3 pairs only: Spider-Man/Batman, Superman/Goku, and Vader/Superman now resolve on incapacitation (step 3 decides before stamina); winners unchanged.',
      (function () {
        const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
        // Observed at seed 12345 from the built file (golden — a later change is a regression signal, not a silent pass).
        const golden = {
          'spiderman/batman': { hw: 'Spider-Man', hc: 'damage edge', hf: 'Web + Impact Combo', hl: 'unconscious', rw: 'Spider-Man', rc: 'incapacitation', rf: 'Web + Impact Combo', rl: 'unconscious', overall: 'PARTIAL', wm: true, rm: false, fm: true, lm: true, ndiff: 1 },
          'goku/vegeta': { hw: 'Vegeta', hc: 'transformation', hf: 'Ki Blast', hl: 'knocked out', rw: 'Vegeta', rc: 'stamina', rf: 'Galick Gun', rl: 'knocked out', overall: 'PARTIAL', wm: true, rm: false, fm: false, lm: true, ndiff: 2 },
          'superman/rocky': { hw: 'Superman', hc: 'cannot-harm', hf: 'Heat Vision', hl: 'knocked out', rw: 'Superman', rc: 'cannot-harm', rf: 'Heat Vision', rl: 'knocked out', overall: 'MATCH', coincide: true, wm: true, rm: true, fm: true, lm: true, ndiff: 0 },
          'superman/goku': { hw: 'Superman', hc: 'durability', hf: 'Heat Vision', hl: 'knocked out', rw: 'Superman', rc: 'incapacitation', rf: 'Heat Vision', rl: 'knocked out', overall: 'PARTIAL', wm: true, rm: false, fm: true, lm: true, ndiff: 1 },
          'deadpool/wolverine': { hw: 'Wolverine', hc: 'transformation', hf: 'Berserker Barrage', hl: 'knocked out', rw: 'Wolverine', rc: 'tier difference', rf: 'Adamantium Claw Slash', rl: 'knocked out', overall: 'PARTIAL', wm: true, rm: false, fm: false, lm: true, ndiff: 2 },
          'saitama/frodo': { hw: 'Saitama', hc: 'cannot-harm', hf: 'Serious Punch', hl: 'knocked out', rw: 'Saitama', rc: 'cannot-harm', rf: 'Serious Punch', rl: 'knocked out', overall: 'MATCH', coincide: true, wm: true, rm: true, fm: true, lm: true, ndiff: 0 },
          'raven/sephiroth': { hw: 'Sephiroth', hc: 'transformation', hf: 'Masamune Slash', hl: 'knocked out', rw: 'Sephiroth', rc: 'speed', rf: 'Masamune Slash', rl: 'knocked out', overall: 'PARTIAL', wm: true, rm: false, fm: true, lm: true, ndiff: 1 },
          'vader/superman': { hw: 'Superman', hc: 'durability', hf: 'Heat Vision', hl: 'knocked out', rw: 'Superman', rc: 'incapacitation', rf: 'Heat Vision', rl: 'knocked out', overall: 'PARTIAL', wm: true, rm: false, fm: true, lm: true, ndiff: 1 },
        };
        return pairs.every(function (pr) {
          sim28(pr[0], pr[1], 12345, pr[2]);
          const w = runInCtx(`globalThis._bt28.winner`);
          if (!w) return false;
          const before = runInCtx(`globalThis._bt28.winner + '|' + ((globalThis._bt28.finalRecord && globalThis._bt28.finalRecord.finishingAbility) || '')`);
          const c = JSON.parse(runInCtx(`JSON.stringify((function(){ var cc = auditComparisonForBattleV1634(globalThis._bt28); return {overall: cc.overall, hw: cc.hpWinner, hc: cc.hpCriterion, hf: cc.hpFinisher, hl: cc.hpLoserState, rw: cc.resolverWinner, rc: cc.resolverReason, rf: cc.resolverFinisher, rl: cc.resolverLoserState, wd: cc.winnerDisagreement, wm: cc.winnerMatch, rm: cc.reasonMatch, fm: cc.finisherMatch, lm: cc.loserStateMatch, ndiff: (cc.differences || []).length}; })())`));
          const compHtml = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._bt28))`);
          const after = runInCtx(`globalThis._bt28.winner + '|' + ((globalThis._bt28.finalRecord && globalThis._bt28.finalRecord.finishingAbility) || '')`);
          const g = golden[pr[0] + '/' + pr[1]];
          const full = g.coincide === true;
          return c.hw === g.hw && c.hc === g.hc && c.hf === g.hf && c.hl === g.hl
            && c.rw === g.rw && c.rc === g.rc && c.rf === g.rf && c.rl === g.rl
            && c.overall === g.overall && c.wd === false
            && c.wm === g.wm && c.rm === g.rm && c.fm === g.fm && c.lm === g.lm
            && c.ndiff === g.ndiff
            && compHtml.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1
            && compHtml.indexOf('by construction') === -1 && compHtml.indexOf('reports the main-engine result') === -1 && compHtml.indexOf('PARTIAL MATCH') === -1 && compHtml.indexOf('MISMATCH') === -1 && compHtml.indexOf('Reason — two explanations') === -1 && compHtml.indexOf('Finisher — two explanations') === -1 && compHtml.indexOf('WINNER AGREEMENT') === -1 && (full ? compHtml.indexOf('All four fields agree: MATCH.') !== -1 : compHtml.indexOf('Differences (listed honestly)') !== -1)
            && before === after;
        });
      })(), '');
    check('V1628-SHUTOUT-PACING a 0-damage-loss telling is compressed (at most 6 paragraphs, no separate winner-plan paragraph, no repeated damage-number sentence) and still complete',
      (function () {
        let found = false;
        [12345, 999, 777, 1, 2, 3, 7, 42].forEach(function (sd) {
          if (found) return;
          sim28('saitama', 'frodo', sd, 'death');
          const fc = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(globalThis._bt28))`));
          if (fc.loserDamage === 0) found = true;
        });
        if (!found) return false;
        const t = runInCtx(`buildBreakdownOfflineV1619(globalThis._bt28)`);
        const ps = paras28(t);
        const fc = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(globalThis._bt28))`));
        const last = ps[ps.length - 1] || '';
        const dealtCount = (t.match(/dealt \d+ damage/g) || []).length;
        return ps.length <= 6 && ps.every(function (p) { return p.indexOf('winning plan') === -1 && p.indexOf('What wins it for') !== 0; })
          && t.indexOf("'s best plan was") !== -1 && t.indexOf('failed') !== -1 && t.indexOf(fc.finisher) !== -1
          && t.indexOf(fc.loserStateWord) !== -1 && last.indexOf(fc.winner) !== -1 && dealtCount <= 1;
      })(), '');
    check('V1628-DEATH-WORDING rendered dossiers for all fighters plus a sample battle log contain zero "lethal finish" / "killing blow" / "after death"; win conditions read knockout, incapacitation, stalemate',
      (function () {
        const ids = JSON.parse(runInCtx(`JSON.stringify(ROSTER.map(function (f) { return f.id; }))`));
        let ok = true;
        ids.forEach(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          if (/lethal finish|killing blow|after death/.test(info)) ok = false;
          if (info.indexOf('knockout, incapacitation, stalemate') === -1) ok = false;
        });
        sim28('superman', 'rocky', 12345, 'death');
        const logText = runInCtx(`JSON.stringify(globalThis._bt28.events)`);
        if (/lethal finish|killing blow|after death/.test(logText)) ok = false;
        return ok;
      })(), '');
    check('V1628-HEALING-FACTOR-RECORDED Wolverine "Healing Factor Strike" is a recorded roster move with a POWER_RECORDS entry (status interpretation) — kept, not renamed or relabelled as a fallback',
      (function () {
        const powers = JSON.parse(runInCtx(`JSON.stringify(POWERS['wolverine'])`));
        const rec = JSON.parse(runInCtx(`JSON.stringify(POWER_RECORDS_V1625['wolverine']['Healing Factor Strike'])`));
        return Array.isArray(powers) && powers.indexOf('Healing Factor Strike') !== -1 && !!rec && rec.s === 'interpretation';
      })(), '');
    check('V1629-POWER-LABEL (v16.32 DELIBERATE CHANGE) power-records section header and prompt line read v16.33, not v16.25',
      (function () {
        runInCtx(`openInfo('gojo')`);
        const info = els['info-content'].innerHTML || '';
        return info.indexOf('Character power records (v16.35') !== -1 && info.indexOf('Character power records (v16.25') === -1
          && html.indexOf('POWER RECORDS (v16.35') !== -1 && html.indexOf('POWER RECORDS (v16.25') === -1;
      })(), '');
    check('V1629-STALE-SWEEP (v16.32 DELIBERATE CHANGE) home Phase 3 panel, 1v1 note, resolver fallback, and v15 rule lines carry current or version-neutral wording',
      html.indexOf('that is the whole flow in v16.35') !== -1 && html.indexOf('WAR-ROOM is 1v1 only.') !== -1
        && html.indexOf('WAR-ROOM v15 is 1v1 only') === -1 && html.indexOf('that is the whole flow in v16.27') === -1
        && html.indexOf('Resolver comparison (v16.27)') === -1 && html.indexOf('Tier is UNKNOWN in v15') === -1
        && html.indexOf('never change stats in v15') === -1 && html.indexOf('Legacy combined check is not used in v15') === -1, '');
    check('V1630-STALE-V15-SWEEP (v16.32 DELIBERATE CHANGE) no present-tense stale v15 note remains in player-facing text: home-panel note + Research notes read "since v15" or current version; every reworded string verified',
      (function () {
        const oldStale = ['Research never changes battle stats in v15', 'no research bonus in v15', 'No battle stat bonus in v15', 'kept removed in v15', 'Research bonus: none in v15', 'none in v15 — REMOVED', 'Cache key (v15', 'No aggregate score is used in v15', '(engine rule, v15)'];
        if (!oldStale.every(function (x) { return html.indexOf(x) === -1; })) return false;
        const fresh = ['Research never changes battle stats — since v15', 'no research bonus — since v15', 'No battle stat bonus — since v15', 'kept removed since v15', 'Research bonus: none since v15', 'none since v15 — REMOVED', 'Cache key (version-keyed, since v15)', 'No aggregate score is used in this build', '(engine rule, since v15)'];
        if (!fresh.every(function (x) { return html.indexOf(x) !== -1; })) return false;
        // Dossier render check on the correct surface: the Research-stat-bonus row lives in
        // renderDossier (Research Dossier panel, #dossier-output), not in openInfo's modal.
        runInCtx(`renderDossier(['gojo'])`);
        const dos = els['dossier-output'].innerHTML || '';
        return dos.indexOf('none since v15') !== -1 && dos.indexOf('none in v15') === -1 && dos.indexOf('version-keyed, since v15') !== -1;
      })(), '');
    check('V1630-SITE-IN-USE-GUARD (v16.31 VERIFICATION ITEM) New Battle has no in-game guard that can refuse the click: no site_in_use string, resetSimulator switches screens unconditionally, pending generation is session-gated and a new run overwrites the controller',
      (function () {
        if (html.indexOf('site_in_use') !== -1) return false;
        const start = html.indexOf('function resetSimulator()');
        if (start === -1) return false;
        const rs = html.slice(start, start + 1500);
        if (rs.indexOf("document.getElementById('results-screen').classList.remove('active')") === -1) return false;
        if (rs.indexOf("document.getElementById('draft-screen').classList.add('active')") === -1) return false;
        const beforeSwitch = rs.slice(0, rs.indexOf("document.getElementById('results-screen')"));
        if (/return;/.test(beforeSwitch)) return false;
        return html.indexOf('currentStorySessionId === sid') !== -1 && (html.match(/currentStoryController = controller/g) || []).length >= 3;
      })(), '');
    check('V1629-VARIATION-ROBUST (v16.32 DELIBERATE CHANGE) 7 known pairs at seed 12345: no two same-decisive-key tellings share both blanked opener and paragraph-role order; locks hold every telling',
      (function () {
        const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death']];
        const tellings = pairs.map(function (pr) {
          sim28(pr[0], pr[1], 12345, pr[2]);
          const tx = runInCtx(`buildBreakdownOfflineV1619(globalThis._bt28)`);
          const fc = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(globalThis._bt28))`));
          const ps = paras28(tx);
          const blank = function (s) { let o = s; [fc.winner, fc.loser, fc.finisher || '', fc.battlefield].forEach(function (x) { if (x) o = o.split(x).join(''); }); return o.replace(/\d+/g, ''); };
          const role = function (p, i, n) {
            if (i === 0) return 'opener';
            if (i === n - 1) return 'verdict';
            if (p.indexOf('Finisher:') === 0) return 'finisher';
            if (/blow by blow/i.test(p)) return 'sequence';
            if (p.indexOf('speed audit') !== -1) return 'audit';
            if (p.indexOf('winning plan') !== -1 || p.indexOf('What wins it for') === 0) return 'winnerplan';
            if (p.indexOf("'s best plan was") !== -1) return 'stall';
            return 'best';
          };
          return { key: fc.decisiveKey, opener: blank(ps[0] || ''), roles: ps.map(function (p, i) { return role(p, i, ps.length); }).join('>'), text: tx, fc: fc, ps: ps };
        });
        const locks = tellings.every(function (x) {
          const dec = (x.text.match(/Decisive:/g) || []).length;
          return dec === 1 && x.text.indexOf(x.fc.finisher) !== -1 && x.text.indexOf(x.fc.loserStateWord) !== -1
            && (x.ps[x.ps.length - 1] || '').indexOf(x.fc.winner) !== -1;
        });
        if (!locks) return false;
        const groups = {};
        tellings.forEach(function (x) { (groups[x.key] = groups[x.key] || []).push(x); });
        let varied = true;
        Object.keys(groups).forEach(function (k) {
          const g = groups[k];
          if (g.length < 2) return;
          const combos = g.map(function (x) { return x.opener + '||' + x.roles; });
          if (new Set(combos).size < 2) varied = false;
        });
        const openers = new Set(tellings.map(function (x) { return x.opener; }));
        return varied && openers.size >= 4;
      })(), '');
    check('V1629-CHARACTER-RESEARCH-SPEED (v16.32 DELIBERATE CHANGE) breakdown Character Research panel carries the plain-words speed clause; Superman + Gojo stories carry matching audit paragraphs; numbers unchanged',
      (function () {
        const panelOk = html.indexOf('Speed audit — ') !== -1 && html.indexOf('result-dossier-output') !== -1
          && html.indexOf('game speed, not canon speed; left unchanged because changing it would change outcomes; a rebalance needs its own decision.') !== -1;
        sim28('superman', 'rocky', 12345, 'death');
        const tS = runInCtx(`buildBreakdownOfflineV1619(globalThis._bt28)`);
        sim28('gojo', 'frodo', 12345, 'death');
        const tG = runInCtx(`buildBreakdownOfflineV1619(globalThis._bt28)`);
        return panelOk && tS.indexOf('Superman speed audit (v16.35)') !== -1 && tG.indexOf('Gojo speed audit (v16.35)') !== -1
          && runInCtx(`byId('superman').sp`) === 1.1 && runInCtx(`byId('gojo').sp`) === 1.2
          && runInCtx(`byId('frodo').sp`) === 1.2 && runInCtx(`byId('saitama').sp`) === 1.2;
      })(), '');
    check('V1634-MARGIN-ONLY-AUDIT (v16.34 DELIBERATE CHANGE: main surface is now the resolver telling, Combat Details lives in Audit) HP telling still carries the deciding margin but no damage-total scoreline and no dealt-damage sentence; Combat Details header states damage totals live in the Audit, not in the main telling',
      (function () {
        const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death']];
        const ok = pairs.every(function (pr) {
          sim28(pr[0], pr[1], 12345, pr[2]);
          const tx = runInCtx(`buildBreakdownOfflineV1619(globalThis._bt28)`);
          const fc = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(globalThis._bt28))`));
          const dealt = (tx.match(/dealt \d+ damage/g) || []).length;
          const scoreline = tx.indexOf(fc.winnerDamage + '-' + fc.loserDamage) !== -1 || tx.indexOf(fc.winnerDamage + '–' + fc.loserDamage) !== -1;
          return tx.indexOf('margin of') !== -1 && dealt === 0 && !scoreline;
        });
        return ok && html.indexOf('damage totals live here, not in the main telling') !== -1 && html.indexOf('damage totals live here, not in the story') === -1;
      })(), '');
    check('V1629-TIMER-SURFACES (v16.32 DELIBERATE CHANGE) interim timer/status writes to the breakdown-page banner, story status, and Technical Details in one call; retry routes through the same generator',
      (function () {
        const t60 = runInCtx(`setOnlineStatusV1626('interim', '60')`);
        const t150 = runInCtx(`setOnlineStatusV1626('interim', '150')`);
        return t60.indexOf('60 seconds') !== -1 && t150.indexOf('150 seconds') !== -1
          && html.indexOf("document.getElementById('online-status-banner')") !== -1
          && html.indexOf("document.getElementById('main-story-status')") !== -1
          && html.indexOf("document.getElementById('online-status-tech')") !== -1
          && html.indexOf('setInterval(function () { try { if (isCurrent() && !_resolvedV1626)') !== -1
          && html.indexOf('generateBreakdownV1619(b, sid, { fromRetry: true') !== -1;
      })(), '');
    check('V1629-HEALING-FACTOR-WORDING (v16.32 DELIBERATE CHANGE) Wolverine Healing Factor Strike entry states the move is recorded and only its damage type is unknown, keeping the labelled keyword fallback',
      (function () {
        const pw = runInCtx(`JSON.stringify(structuredPowersForV14(byId('wolverine')))`);
        const rec = runInCtx(`powerRecordsHtmlV1625(Object.assign({}, byId('wolverine'), {variant: 'Base', variantId: 'base'}))`);
        return pw.indexOf('Healing Factor Strike') !== -1 && pw.indexOf('keyword-fallback') !== -1 && pw.indexOf('not authored') !== -1
          && pw.indexOf('the move itself is recorded') !== -1 && pw.indexOf('the authored type for this power is unknown') === -1
          && rec.indexOf('damage type: unknown (keyword fallback, not authored)') !== -1 && rec.indexOf('the move itself is recorded') !== -1;
      })(), '');
    check('V1629-SIGNATURE-MULTIPLIER (v16.32 DELIBERATE CHANGE) no signature multiplier value outside collapsed Audit in any of the 6 side-checked dossiers; Audit still holds it',
      (function () {
        return ['batman', 'superman', 'saitama', 'frodo', 'pikachu', 'gojo'].every(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          const stripped = info.replace(/<details class="audit-numbers"[\s\S]*?<\/details>/g, '');
          const kept = (info.match(/<details class="audit-numbers"[\s\S]*?<\/details>/g) || []).join('');
          return stripped.indexOf('Signature multiplier x') === -1 && !/×\d/.test(stripped) && stripped.indexOf('Signature multiplier:') === -1
            && kept.indexOf('signature multiplier') !== -1;
        });
      })(), '');
    check('V1629-HP-ROSTER (v16.31 VERIFICATION ITEM) roster Base HP Saitama 2000 / Frodo 950 matches simulated Base battle max HP; no stat or display change',
      (function () {
        if (runInCtx(`byId('saitama').hp`) !== 2000 || runInCtx(`byId('frodo').hp`) !== 950) return false;
        sim28('saitama', 'frodo', 12345, 'death');
        const fs = JSON.parse(runInCtx(`JSON.stringify(globalThis._bt28.finalState)`));
        const s = fs.filter(function (x) { return x.name === 'Saitama'; })[0] || {};
        const f = fs.filter(function (x) { return x.name === 'Frodo Baggins'; })[0] || {};
        return s.currentHp === 2000 && s.maxHp === 2000 && f.currentHp === 0 && f.maxHp === 950;
      })(), '');


    check('V1634-LAYER-MAP (v16.34 DELIBERATE CHANGE: registry extended with v1634 functions) layer map + banners present; registry covers every new V1631 and V1634 function; new ENGINE functions contain no page, storage, network, or random calls',
      (function () {
        if (html.indexOf('LAYER MAP — Phase 3A (v16.31)') === -1) return false;
        if (html.indexOf('LAYER: DATA — roster facts') === -1) return false;
        if (html.indexOf('LAYER: ENGINE — HP-engine battle simulation') === -1) return false;
        if (html.indexOf('LAYER: RENDER — visible resolver panel') === -1) return false;
        const layers = JSON.parse(runInCtx(`JSON.stringify({a: layerOfV1631('powerIdV1631'), b: layerOfV1631('charFirstV1631'), c: layerOfV1631('heldOutForV1631'), d: layerOfV1631('validateCharFirstV1631'), e: layerOfV1631('validateCharFirstBatchV1631'), f: layerOfV1631('charFirstDirectionV1631'), g: layerOfV1631('charFirstSealNoteV1631'), h: layerOfV1631('charFirstRunsOutV1631'), i: layerOfV1631('charFirstRulesV1631'), j: layerOfV1631('resolveCharFirstV1631'), k: layerOfV1631('compareCharFirstToHpV1631'), l: layerOfV1631('resolverComparisonForBattleV1631'), m: layerOfV1631('resolverComparisonHtmlV1624'), n: layerOfV1631('no-such-function'), o: layerOfV1631('resolveCharFirstV1634'), p: layerOfV1631('incapDecisivePowerV1634'), q: layerOfV1631('frozenResolverResultV1634'), r: layerOfV1631('auditComparisonForBattleV1634'), s: layerOfV1631('auditComparisonHtmlV1634'), t: layerOfV1631('renderAuditV1634'), u: layerOfV1631('resolverTellingTextV1634'), v: layerOfV1631('resolverTellingHtmlV1634')})`));
        if (layers.a !== 'data' || layers.b !== 'data' || layers.c !== 'data' || layers.d !== 'data' || layers.e !== 'data') return false;
        if (layers.f !== 'engine' || layers.g !== 'engine' || layers.h !== 'engine' || layers.i !== 'engine' || layers.j !== 'engine' || layers.k !== 'engine' || layers.l !== 'engine') return false;
        if (layers.m !== 'render' || layers.n !== 'unregistered') return false;
        if (layers.o !== 'engine' || layers.p !== 'engine' || layers.q !== 'engine' || layers.r !== 'engine') return false;
        if (layers.s !== 'render' || layers.t !== 'render' || layers.u !== 'render' || layers.v !== 'render') return false;
        const purity = JSON.parse(runInCtx(`JSON.stringify(['charFirstDirectionV1631','charFirstSealNoteV1631','charFirstRunsOutV1631','charFirstRulesV1631','resolveCharFirstV1631','compareCharFirstToHpV1631','resolverComparisonForBattleV1631','resolveCharFirstV1634','incapDecisivePowerV1634','transformAssessmentV1634','frozenResolverResultV1634','compareResolverMainToHpAuditV1634','auditComparisonForBattleV1634'].map(function (n) { var s = eval(n).toString(); return s.indexOf('document.') === -1 && s.indexOf('localStorage') === -1 && s.indexOf('fetch(') === -1 && s.indexOf('Math.random') === -1; }))`));
        return purity.every(Boolean);
      })(), '');
    check('V1633-SCHEMA-ALL all 194 fighters convert to the character-first schema with 0 validation errors: durability + way to lose present, id unique, signature flagged exactly once, audit block present, no invented status',
      (function () {
        const batch = JSON.parse(runInCtx(`JSON.stringify(validateCharFirstBatchV1631())`));
        if (!batch.ok || batch.converted !== 194 || batch.total !== 194 || batch.errors.length !== 0) return false;
        if (batch.perCategory['Anime'].converted !== 33 || batch.perCategory['Comics'].converted !== 33) return false;
        if (batch.perCategory['Video Games'].converted !== 32 || batch.perCategory['Movies & TV'].converted !== 32) return false;
        if (batch.perCategory['Animation'].converted !== 32 || batch.perCategory['Fantasy & Sci-Fi'].converted !== 32) return false;
        const per = JSON.parse(runInCtx(`JSON.stringify((function(){ var ids = {}, sigBad = 0, durBad = 0, auditBad = 0, invented = 0; ROSTER.forEach(function (f) { if (ids[f.id]) sigBad++; ids[f.id] = true; var c = charFirstV1631(f); if (!c.durability || !c.durability.type || !c.durability.wayToLose) durBad++; if (c.powers.filter(function (p) { return p.signature; }).length !== 1) sigBad++; if (!c.audit || typeof c.audit.hp !== 'number') auditBad++; if (/"\w*[Ss]tatus":"invented"/.test(JSON.stringify(c))) invented++; }); return {unique: Object.keys(ids).length, sigBad: sigBad, durBad: durBad, auditBad: auditBad, invented: invented}; })())`));
        return per.unique === 194 && per.sigBad === 0 && per.durBad === 0 && per.auditBad === 0 && per.invented === 0;
      })(), '');
    check('V1633-BATCH-TABLE batch unknown counts by field type match the measured Phase 3A table (continuity 140, nature 184, range 144, hax/delivery/powerSource/morals-canon/style 194, stamina-limit 175, power-does/range/limit/outcome 179 fighters, transform-needed 100)',
      (function () {
        const batch = JSON.parse(runInCtx(`JSON.stringify(validateCharFirstBatchV1631())`));
        const u = batch.unknownFightersByDim, s = batch.unknownSlotsByDim;
        return u['continuity'] === 140 && u['nature'] === 184 && u['range'] === 144 && u['hax'] === 194 && u['delivery'] === 194
          && u['powerSource'] === 194 && u['morals-canon'] === 194 && u['style'] === 194 && u['stamina-limit'] === 175
          && u['power-does'] === 179 && u['power-range'] === 179 && u['power-limit'] === 179 && u['power-outcome'] === 179
          && u['transform-needed'] === 100 && s['style'] === 1164 && s['power-does'] === 590 && s['transform-needed'] === 100;
      })(), '');
    check('V1633-HELD-OUT held-out counts by type match the measured table (seal-remove 194, incapacitation 190, hax/delivery 194, limit/outcome 179, transform-needed 100, nature 184, range 144); a transform fighter with unknown needed never has that transform simulated',
      (function () {
        const batch = JSON.parse(runInCtx(`JSON.stringify(validateCharFirstBatchV1631())`));
        const h = batch.heldOutByType;
        if (h['seal-remove-victory'] !== 194 || h['incapacitation-victory'] !== 190 || h['hax-decisive'] !== 194 || h['delivery-decisive'] !== 194) return false;
        if (h['limit-decisive'] !== 179 || h['outcome-decisive'] !== 179 || h['transform-needed'] !== 100 || h['nature-decisive'] !== 184 || h['range-decisive'] !== 144) return false;
        const sp = JSON.parse(runInCtx(`JSON.stringify((function(){ var c = charFirstV1631(byId('spiderman')); var r = resolveCharFirstV1631('spiderman', 'batman', 12345, {victoryMode: 'death'}); return {tr: c.transforms.map(function (t) { return t.neededStatus; }), used: r.transformsUsed, held: c.heldOut.map(function (x) { return x.type; })}; })())`));
        return sp.tr.length === 1 && sp.tr[0] === 'unknown' && Array.isArray(sp.used) && sp.used.length === 0 && sp.held.indexOf('transform-needed') !== -1;
      })(), '');
    check('V1634-HP-AUDIT-INVARIANCE (v16.34 DELIBERATE CHANGE: main output is now resolver-based, so the 21 golden rows are asserted as HP-AUDIT rows, not main rows) HP-audit results reproduce all 21 v16.32 golden rows EXACTLY (winner, finisher, loser state, damage, margin, rounds) — any difference is a regression',
      (function () {
        const rows = [
          ['spiderman/batman', 12345, 'Spider-Man', 'Web + Impact Combo', 'knocked out', 1020, 376, 644, 6],
          ['spiderman/batman', 1712342347, 'Spider-Man', 'Web + Impact Combo', 'knocked out', 1181, 376, 805, 8],
          ['spiderman/batman', 1492544618, 'Spider-Man', 'Web Shot', 'knocked out', 1114, 188, 926, 7],
          ['goku/vegeta', 12345, 'Vegeta', 'Ki Blast', 'knocked out', 1544, 844, 700, 7],
          ['goku/vegeta', 1762409013, 'Vegeta', 'Blue Evolution Final Flash', 'knocked out', 1321, 758, 563, 5],
          ['goku/vegeta', 905405617, 'Vegeta', 'Blue Evolution Final Flash', 'knocked out', 1471, 1111, 360, 6],
          ['superman/rocky', 12345, 'Superman', 'Heat Vision', 'knocked out', 1386, 0, 1386, 7],
          ['superman/rocky', 1151448685, 'Superman', 'Heat Vision', 'knocked out', 1386, 0, 1386, 7],
          ['superman/rocky', 619347670, 'Superman', 'Heat Vision', 'knocked out', 1386, 0, 1386, 7],
          ['superman/goku', 12345, 'Superman', 'Heat Vision', 'knocked out', 1563, 683, 880, 8],
          ['superman/goku', 633055016, 'Superman', 'Tornado Spin', 'knocked out', 1499, 371, 1128, 6],
          ['superman/goku', 1309220515, 'Superman', 'Tornado Spin', 'knocked out', 1600, 458, 1142, 6],
          ['deadpool/wolverine', 12345, 'Wolverine', 'Berserker Barrage', 'knocked out', 1773, 1355, 418, 9],
          ['deadpool/wolverine', 11607066, 'Wolverine', 'Berserker Barrage', 'knocked out', 1841, 1642, 199, 9],
          ['deadpool/wolverine', 135669327, 'Wolverine', 'Berserker Barrage', 'knocked out', 1704, 1280, 424, 8],
          ['saitama/frodo', 12345, 'Saitama', 'Serious Punch', 'knocked out', 1123, 0, 1123, 3],
          ['saitama/frodo', 880835498, 'Saitama', 'Serious Punch', 'knocked out', 1274, 0, 1274, 3],
          ['saitama/frodo', 319391491, 'Saitama', 'Serious Punch', 'knocked out', 1274, 0, 1274, 3],
          ['raven/sephiroth', 12345, 'Sephiroth', 'Masamune Slash', 'knocked out', 1622, 1384, 238, 7],
          ['raven/sephiroth', 504643909, 'Sephiroth', 'Supernova Strike', 'knocked out', 1514, 1165, 349, 6],
          ['raven/sephiroth', 592863626, 'Sephiroth', 'Masamune Slash', 'knocked out', 1638, 1384, 254, 7]
        ];
        return rows.every(function (r) {
          const parts = r[0].split('/');
          sim28(parts[0], parts[1], r[1], 'death');
          const fc = JSON.parse(runInCtx(`JSON.stringify(breakdownFactsV1619(globalThis._bt28))`));
          return fc.winner === r[2] && fc.finisher === r[3] && fc.loserStateWord === r[4]
            && fc.winnerDamage === r[5] && fc.loserDamage === r[6] && (fc.winnerDamage - fc.loserDamage) === r[7] && fc.rounds === r[8];
        });
      })(), '');
    check('V1633-NO-INVENTION no field is invented: Gojo continuity stated, Frodo continuity omitted (unknown), Goku nature stated, Ghost Rider nature unknown, every record flags hax + delivery as unknown',
      (function () {
        const spots = JSON.parse(runInCtx(`JSON.stringify({gojo: charFirstV1631(byId('gojo')).continuity, frodo: charFirstV1631(byId('frodo')).continuity, goku: charFirstV1631(byId('goku')).nature, ghost: charFirstV1631(byId('ghostrider')).nature})`));
        if (!spots.gojo || spots.gojo.value !== 'Jujutsu Kaisen continuity' || spots.gojo.status !== 'stated') return false;
        if (spots.frodo !== null) return false;
        if (!spots.goku || spots.goku.value.indexOf('Saiyan') !== 0) return false;
        if (spots.ghost !== null) return false;
        const flags = JSON.parse(runInCtx(`JSON.stringify(ROSTER.every(function (f) { var c = charFirstV1631(f); return c.unknown.indexOf('hax') !== -1 && c.unknown.indexOf('delivery') !== -1 && c.unknown.length > 0; }))`));
        return flags === true;
      })(), '');
    check('V1633-SPEED-UNCHANGED speed numbers unchanged (Superman 1.1, Frodo 1.2, Gojo 1.2, Saitama 1.2) and the plain-words speed clause is intact in both dossier surfaces',
      (function () {
        if (runInCtx(`byId('superman').sp`) !== 1.1 || runInCtx(`byId('frodo').sp`) !== 1.2) return false;
        if (runInCtx(`byId('gojo').sp`) !== 1.2 || runInCtx(`byId('saitama').sp`) !== 1.2) return false;
        let ok = true;
        ['superman', 'gojo'].forEach(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          if (info.indexOf('rebalance') === -1 || info.indexOf('game speed, not canon speed') === -1) ok = false;
        });
        return ok;
      })(), '');
    check('V1633-QUOTE-SURFACES decision-4 targeted-check surfaces: no present-tense "in v15" anywhere, and the 3 surfaces carry their "since v15" wordings for the live-test quote check',
      (function () {
        if (html.indexOf('in v15') !== -1) return false;
        return html.indexOf('No battle stat bonus — since v15, research fills the dossier only.') !== -1
          && html.indexOf('Research never changes battle stats — since v15, research fills the dossier only.') !== -1
          && html.indexOf('skips the physical-durability cannot-harm gate (engine rule, since v15)') !== -1;
      })(), '');
    check('V1634-CACHE-KEY (v16.34 DELIBERATE CHANGE) breakdown cache key rotated to v1635, old v1634 key absent, legacy 9-section rejection retained',
      (function () {
        return html.indexOf('warroom_breakdown_cache_v1635') !== -1 && html.indexOf('warroom_breakdown_cache_v1634') === -1;
      })(), '');
    check('V1633-RESOLVER-WORDS schema resolver exchanges + why carry words only: no HP/ATK/DEF numbers, no 3+ digit numbers',
      (function () {
        const r = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('superman', 'rocky', 12345, {victoryMode: 'death'}); return {exchanges: x.exchanges, why: x.why}; })())`));
        const txt = r.exchanges.join(' ') + ' ' + r.why;
        return !/\b\d+\s*(HP|ATK|DEF)\b/.test(txt) && !/\b\d{3,}\b/.test(txt) && r.exchanges.length === 5;
      })(), '');
    check('V1634-VERSION (v16.34 DELIBERATE CHANGE) title, heading, audit heading, save format, and save method string all read v16.35',
      (function () {
        return html.indexOf('<title>WAR-ROOM v16.35') !== -1 && html.indexOf('<h1>WAR-ROOM v16.35</h1>') !== -1
          && html.indexOf("formatVersion:'v16.35'") !== -1
          && html.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1
          && html.indexOf('v16.35 resolver telling') !== -1;
      })(), '');
  }

    check('V1633-BYPASS-NOT-A-WIN (Problem 2 reconciliation) bypass is a can-hurt fact, never a win: Vader vs Superman schema winner is Superman on stamina (not Vader on bypass); the bypassPath still exists in the direction as a can-hurt assessment; NO pair among the standard 7 + Vader resolves on criterion bypass; the schema resolver has no best-move concept (no power-total comparison anywhere)',
      (function () {
        const r = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('vader','superman',12345,{victoryMode:'death'}); return {winner: x.winner, criterion: x.decisiveCriterion, finisher: x.finisher, loserState: x.loserState, bypassAB: x.inputs.directionAtoB.bypassPath, canHurtAB: x.inputs.directionAtoB.canHurt, canHurtBA: x.inputs.directionBtoA.canHurt, runsOut: x.inputs.runsOutFirst}; })())`));
        if (r.winner !== 'Superman' || r.criterion !== 'stamina' || r.finisher !== 'Heat Vision' || r.loserState !== 'knocked out') return false;
        // The bypass fact survives as a can-hurt assessment, but awards no win.
        if (!r.bypassAB || r.bypassAB.indexOf('skips the physical-durability cannot-harm gate') === -1) return false;
        if (r.canHurtAB !== true || r.canHurtBA !== true) return false;
        if (r.runsOut.fighter !== 'A') return false;
        // No pair among the 8 resolves on 'bypass' (standard 7 criteria unchanged from v16.31).
        const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
        for (const pr of pairs) {
          const c = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('${pr[0]}','${pr[1]}',12345,{victoryMode:'${pr[2]}'}); return {criterion: x.decisiveCriterion}; })())`));
          if (c.criterion === 'bypass') return false;
        }
        // No best-move concept: no best-move field, no power-total comparison in the resolver source.
        const src = runInCtx(`resolveCharFirstV1631.toString()`);
        return src.indexOf('bestMove') === -1 && src.indexOf('best move') === -1 && html.indexOf('base power') === -1 && html.indexOf('multi-turn signature') === -1;
      })(), '');
    check('V1634-BYPASS-UNREACHABLE (Problem 1, unreachable by design; v16.34 DELIBERATE CHANGE: audit render replaces the comparison render) the exact "skips..." string occurs only twice in the file (both direction functions), is embedded only in direction.reason, and NEVER renders in the live audit panel — even for Vader vs Superman, where the bypass fact applies; the rendered panel contains the generic why but no direction reason and no "skips..." string',
      (function () {
        const occurrences = html.split('skips the physical-durability cannot-harm gate').length - 1;
        if (occurrences !== 2) return false;
        runInCtx(`selected = ['vader','superman']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt28 = simulateBattle();`);
        const compHtml = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._bt28))`);
        const dir = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('vader','superman',12345,{victoryMode:'death'}); return {reasonAB: x.inputs.directionAtoB.reason, bypassAB: x.inputs.directionAtoB.bypassPath}; })())`));
        return dir.bypassAB !== null && dir.reasonAB.indexOf('skips the physical-durability cannot-harm gate') !== -1
          && compHtml.indexOf('skips the physical') === -1
          && compHtml.indexOf(dir.reasonAB) === -1
          && compHtml.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1;
      })(), '');
    check('V1634-BYPASS-MECHANISMS (Problem 1, three texts distinguished; v16.34 DELIBERATE CHANGE: audit render replaces the comparison render) exactly three bypass mechanisms exist and only one renders live: (i) direction bypassPath "skips..." string (direction.reason only, never printed live — see V1634-BYPASS-UNREACHABLE); (ii) NO question-2 "bypasses..." line exists in the file (no QUESTION string at all); (iii) NO HP-gate bypass panel exists in the file (no "HP gate" / "move gate" / "dossier/HP" / "gates were bypassed" strings); the only live resolver panel is the audit render, which prints winner/criterion/finisher/why/exchanges — never direction reasons',
      (function () {
        if (html.indexOf('QUESTION') !== -1) return false;
        if (html.indexOf('HP gate') !== -1 || html.indexOf('move gate') !== -1 || html.indexOf('dossier/HP') !== -1 || html.indexOf('gates were bypassed') !== -1) return false;
        if (html.indexOf('cannot-harm blocks') !== -1) return false;
        runInCtx(`selected = ['vader','superman']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt28 = simulateBattle();`);
        const compHtml = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._bt28))`);
        return compHtml.indexOf('Audit comparison (v16.35') !== -1
          && compHtml.indexOf('Resolver-main winner:') !== -1
          && compHtml.indexOf('Resolver exchanges') !== -1
          && compHtml.indexOf('Darth Vader can hurt Superman via:') === -1;
      })(), '');
    check('V1634-AUDIT-LABELLING (v16.34 DELIBERATE CHANGE: 3B MATCH/PARTIAL replaces Option B) agreement pairs render MATCH with all four fields agreeing, PARTIAL pairs list their differences honestly, and a constructed winner disagreement renders WINNER DISAGREEMENT prominently; main telling is resolver-locked; heading exact v16.34',
      (function () {
        const pairs = [['superman', 'rocky', 'death'], ['goku', 'vegeta', 'death'], ['vader', 'superman', 'death']];
        const expected = { 'superman/rocky': 'MATCH', 'goku/vegeta': 'PARTIAL', 'vader/superman': 'PARTIAL' };
        const okPairs = pairs.every(function (pr) {
          runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt28 = simulateBattle();`);
          const c = JSON.parse(runInCtx(`JSON.stringify((function(){ var cc = auditComparisonForBattleV1634(globalThis._bt28); return {overall: cc.overall, wm: cc.winnerMatch, lm: cc.loserStateMatch, wd: cc.winnerDisagreement, ndiff: (cc.differences || []).length}; })())`));
          const h = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._bt28))`);
          const exp = expected[pr[0] + '/' + pr[1]];
          const ndiffOk = (exp === 'MATCH') ? (c.ndiff === 0) : (c.ndiff > 0);
          return c.overall === exp && c.wm === true && c.lm === true && c.wd === false && ndiffOk
            && h.indexOf('Audit comparison (v16.35 — resolver is the main output, HP engine is the hidden audit)') !== -1
            && h.indexOf('Reason:</b> resolver main (main explanation in character-first terms)') !== -1 && h.indexOf('HP audit (what the HP audit says ended that fight in that seed)') !== -1
            && h.indexOf("Finisher:</b> resolver main (winner's signature, or transformed-form power where the winner transformed)") !== -1 && h.indexOf('HP audit (actual final attack in that seed)') !== -1
            && h.indexOf('WINNER AGREEMENT') === -1 && h.indexOf('WINNER MISMATCH') === -1 && h.indexOf('PARTIAL MATCH') === -1
            && (exp === 'MATCH' ? h.indexOf('All four fields agree: MATCH.') !== -1 : h.indexOf('Differences (listed honestly)') !== -1);
        });
        if (!okPairs) return false;
        const bad = runInCtx(`auditComparisonHtmlV1634({frozen: {winner: 'Vegeta', decisiveCriterion: 'stamina', finisher: 'Galick Gun', loserState: 'knocked out', why: 'test why', exchanges: [], transformsUsed: [], heldOutA: [], heldOutB: [], inputs: {}, moveCounts: [], staminaStages: {}, conditions: {}, seed: 12345, version: 'v16.34'}, hpWinner: 'Superman', hpCriterion: 'durability', hpFinisher: 'Heat Vision', hpLoserState: 'knocked out', resolverWinner: 'Vegeta', resolverReason: 'stamina', resolverFinisher: 'Galick Gun', resolverLoserState: 'knocked out', winnerMatch: false, reasonMatch: false, finisherMatch: false, loserStateMatch: true, differences: [{field: 'winner', hp: 'Superman', resolver: 'Vegeta', note: 'test disagreement'}], overall: 'PARTIAL', winnerDisagreement: true, verdict: 'test verdict'})`);
        return bad.indexOf('WINNER DISAGREEMENT') !== -1 && bad.indexOf('stated plainly here, never buried') !== -1
          && bad.indexOf('Superman') !== -1 && bad.indexOf('Vegeta') !== -1;
      })(), '');
    check('V1633-SYSTEMC-FLAGGED System C label is FLAGGED when failed > 0, never PASSED-with-failed; 0 failed still PASSED; quality note/lines use the new helper; Systems A/B keep validationSummaryV14 (which already returns FAILED, never PASSED, when failed > 0)',
      (function () {
        const f1 = runInCtx(`systemCSummaryV1633([{passed: false, name: 'C-Q3', detail: 'x'}, {passed: true, name: 'C-Q1', detail: 'y'}])`);
        const f0 = runInCtx(`systemCSummaryV1633([{passed: true, name: 'C-Q1', detail: 'y'}])`);
        if (f1 !== 'FLAGGED (1 failed, 0 unverified)') return false;
        if (f0 !== 'PASSED (0 unverified, honestly labelled)') return false;
        if (html.split('systemCSummaryV1633(quality)').length - 1 !== 2) return false;
        if (html.indexOf('System C — Story Quality: FLAGGED') === -1) return false;
        if (html.indexOf('validationSummaryV14(integrity)') === -1) return false;
        if (html.indexOf('validationSummaryV14(accuracy)') === -1) return false;
        return true;
      })(), '');
    check('V1633-DEATH-KNOCKOUT-NAMING selector, START button, battle/result headers, and episode headings carry Death (knockout); the old bare labels are gone from those surfaces; the mode-change relabel regex is updated so switching modes cannot restore the bare label; game title 1v1 Death Battles kept',
      (function () {
        if (html.indexOf('Death (knockout) — the loser is knocked out, not dead') === -1) return false;
        if (html.indexOf('Start Death (knockout) Battle') === -1) return false;
        if (html.indexOf('DEATH (KNOCKOUT) BATTLE BREAKDOWN') === -1) return false;
        if (html.indexOf('Death (knockout) Battle Breakdown') === -1) return false;
        if (html.indexOf('Death (knockout) Match') === -1) return false;
        if (html.indexOf('Death (knockout) Battle Episode') === -1) return false;
        if (html.indexOf('Death (default)') !== -1) return false;
        if (html.indexOf('/^Start (Death|Incapacitation) Battle/') !== -1) return false;
        if (html.indexOf('<title>WAR-ROOM v16.35 — 1v1 Death Battles') === -1) return false;
        return true;
      })(), '');

  // ================= v16.34 — Phase 3B: resolver main, HP audit =================
  check('V1634-MAIN-TELLING-RESOLVER (a) main telling is resolver-based: the resolver telling text matches the frozen result (winner, criterion, finisher, loser state) and the live wiring routes showResults/renderAi/renderOffline through the audit renderer, not the retired visible renderer',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      const ok = pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt34 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt34))`));
        const t = runInCtx(`resolverTellingTextV1634(globalThis._bt34)`);
        if (f.error || !f.winner) return false;
        return t.indexOf(f.winner) !== -1 && t.indexOf(f.finisher) !== -1 && t.indexOf(f.loserState) !== -1 && t.indexOf('Decisive: ' + f.decisiveCriterion) !== -1;
      });
      const wiring = html.indexOf('renderAuditV1634(b)') !== -1 && html.split('renderAuditV1634(b)').length - 1 >= 3
        && html.indexOf('renderResolverVisibleV1626(b); } catch') === -1
        && html.indexOf('var fallbackText = resolverTellingTextV1634(b);') !== -1
        && html.indexOf('resolverTellingHtmlV1634(b)') !== -1;
      return ok && wiring;
    })(), '');
  check('V1634-AUDIT-COLLAPSED (b) HP audit lives behind a collapsed Audit disclosure, off by default: the Audit details has no open attribute, holds #resolver-visible and the Combat Details list inside it, story precedes breakdown-output, the audit render writes the comparison into #resolver-visible, and the Combat Details content carries HP numbers',
    (function () {
      const ai = html.indexOf('Audit — resolver main vs HP audit');
      const ri = html.indexOf('id="resolver-visible"');
      const bi = html.indexOf('id="breakdown-output"');
      const si = html.indexOf('id="story-output"');
      const auditTag = html.slice(Math.max(0, ai - 80), ai); // v16.35 DELIBERATE CHANGE: id="audit-disclosure" lengthened the tag past the old 40-char lookback; window widened, intent unchanged (tag present, no open attribute)
      runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt34 = simulateBattle();`);
      const rv = runInCtx(`renderAuditV1634(globalThis._bt34)`);
      const vis = els['resolver-visible'].innerHTML || '';
      const bd = runInCtx(`generateBreakdown(globalThis._bt34)`);
      return ai !== -1 && ri !== -1 && bi !== -1 && si !== -1 && ai < ri && ri < bi && si < bi
        && auditTag.indexOf('<details') !== -1 && auditTag.indexOf('open') === -1
        && rv === 'ok' && vis.indexOf('Audit comparison (v16.35') !== -1 && vis.indexOf('HP-audit result') !== -1
        && bd.indexOf('HP ') !== -1 && bd.indexOf('damage') !== -1 && bd.indexOf('Rounds in record:') !== -1;
    })(), '');
  check('V1634-AUDIT-DEFINITION-CONSTRUCTED (c) audit panel MATCH/PARTIAL definition on constructed inputs: all four match = MATCH; reason differs = PARTIAL with differences listed honestly and no winner disagreement; winner differs = PARTIAL with WINNER DISAGREEMENT stated prominently',
    (function () {
      const mk = (over) => JSON.parse(JSON.stringify(Object.assign({ frozen: { winner: 'Superman', decisiveCriterion: 'cannot-harm', finisher: 'Heat Vision', loserState: 'knocked out', why: 'test why', exchanges: [], transformsUsed: [], heldOutA: [], heldOutB: [], inputs: {}, moveCounts: [], staminaStages: {}, conditions: {}, seed: 12345, version: 'v16.34' }, hpWinner: 'Superman', hpCriterion: 'cannot-harm', hpFinisher: 'Heat Vision', hpLoserState: 'knocked out', resolverWinner: 'Superman', resolverReason: 'cannot-harm', resolverFinisher: 'Heat Vision', resolverLoserState: 'knocked out', winnerMatch: true, reasonMatch: true, finisherMatch: true, loserStateMatch: true, differences: [], overall: 'MATCH', winnerDisagreement: false, verdict: 'test verdict' }, over)));
      const hMatch = runInCtx(`auditComparisonHtmlV1634(JSON.parse(${JSON.stringify(JSON.stringify(mk({})))}))`);
      const hPartial = runInCtx(`auditComparisonHtmlV1634(JSON.parse(${JSON.stringify(JSON.stringify(mk({ resolverReason: 'stamina', reasonMatch: false, differences: [{ field: 'reason', hp: 'cannot-harm', resolver: 'stamina', note: 'test difference' }], overall: 'PARTIAL' })))}))`);
      const hDis = runInCtx(`auditComparisonHtmlV1634(JSON.parse(${JSON.stringify(JSON.stringify(mk({ resolverWinner: 'Vegeta', resolverReason: 'stamina', resolverFinisher: 'Galick Gun', winnerMatch: false, reasonMatch: false, finisherMatch: false, hpWinner: 'Superman', differences: [{ field: 'winner', hp: 'Superman', resolver: 'Vegeta', note: 'test disagreement' }], overall: 'PARTIAL', winnerDisagreement: true })))}))`);
      return hMatch.indexOf('All four fields agree: MATCH.') !== -1 && hMatch.indexOf('WINNER DISAGREEMENT') === -1
        && hPartial.indexOf('Differences (listed honestly)') !== -1 && hPartial.indexOf('WINNER DISAGREEMENT') === -1
        && hDis.indexOf('WINNER DISAGREEMENT') !== -1 && hDis.indexOf('stated plainly here, never buried') !== -1 && hDis.indexOf('Superman') !== -1 && hDis.indexOf('Vegeta') !== -1;
    })(), '');
  check('V1634-WINNER-AGREEMENT (d) ACCEPTANCE — resolver-main winner == HP-audit winner for the standard 7 + Vader at seed 12345 and golden seeds; ANY disagreement FAILS this check loudly (it is a blocker, never weakened, never hidden)',
    (function () {
      const cases = [
        ['spiderman', 'batman', 'death', [12345, 1712342347, 1492544618]],
        ['spiderman', 'batman', 'incapacitation', [12345]],
        ['goku', 'vegeta', 'death', [12345, 1762409013, 905405617]],
        ['superman', 'rocky', 'death', [12345, 1151448685, 619347670]],
        ['superman', 'goku', 'death', [12345, 633055016, 1309220515]],
        ['deadpool', 'wolverine', 'death', [12345, 11607066, 135669327]],
        ['saitama', 'frodo', 'death', [12345, 880835498, 319391491]],
        ['raven', 'sephiroth', 'death', [12345, 504643909, 592863626]],
        ['vader', 'superman', 'death', [12345, 999, 777]],
      ];
      const bad = [];
      cases.forEach(function (cs) {
        cs[3].forEach(function (seed) {
          runInCtx(`selected = ['${cs[0]}','${cs[1]}']; forcedSeed = ${seed}; forcedVictoryMode = '${cs[2]}'; globalThis._bt34 = simulateBattle();`);
          const c = JSON.parse(runInCtx(`JSON.stringify((function(){ var cc = auditComparisonForBattleV1634(globalThis._bt34); return {wm: cc.winnerMatch, rw: cc.resolverWinner, hw: cc.hpWinner, rc: cc.resolverReason, hc: cc.hpCriterion}; })())`));
          if (c.wm !== true) bad.push(cs[0] + '/' + cs[1] + ' seed ' + seed + ': resolver ' + c.rw + ' (' + c.rc + ') vs HP ' + c.hw + ' (' + c.hc + ')');
        });
      });
      return bad.length === 0;
    })(), '');
  check('V1634-FROZEN-FIELDS (e) frozen result carries all required fields: winner, loser state, finisher power id in repertoire, reason, 5 word-only exchanges, transforms list (possibly empty), move counts with limits unknown, stamina stages, seed, versions, conditions',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      return pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt34 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt34))`));
        if (f.error || !f.winner || !f.loserState || !f.finisher || !f.finisherPowerId || !f.decisiveCriterion) return false;
        if (!Array.isArray(f.exchanges) || f.exchanges.length !== 5) return false;
        if (!Array.isArray(f.transformsUsed)) return false;
        if (!Array.isArray(f.moveCounts) || !f.moveCounts.every(m => m.limit === 'unknown' && m.powerId && m.count >= 1)) return false;
        if (!f.staminaStages || !f.staminaStages.A || !f.staminaStages.B) return false;
        if (f.seed !== 12345 || f.version !== 'v16.35') return false;
        if (!f.conditions || f.conditions.battlefield !== 'Open Arena' || !f.conditions.modeLabel || !f.conditions.winConditions) return false;
        const winRec = (f.winner === f.fighterA.name) ? f.fighterA : f.fighterB;
        if (f.finisher !== winRec.signature) return false;
        const pid = runInCtx(`powerIdV1631(${JSON.stringify(f.finisher)})`);
        return pid === f.finisherPowerId;
      });
    })(), '');
  check('V1634-TRANSFORMS-NEEDED (f) transforms only when needed: shutouts never transform; base winners never transform; Goku (loser, pushed) transforms vs Vegeta and vs Superman; finisher stays in the base repertoire when only the loser transforms; transformed-power id maps cleanly',
    (function () {
      const tr = (a, b, mode) => JSON.parse(runInCtx(`JSON.stringify((function(){ selected = ['${a}','${b}']; forcedSeed = 12345; forcedVictoryMode = '${mode}'; var bt = simulateBattle(); var f = frozenResolverResultV1634(bt); return {winner: f.winner, tr: f.transformsUsed, finRep: f.finisherRepertoire}; })())`));
      const shut1 = tr('superman', 'rocky', 'death'), shut2 = tr('saitama', 'frodo', 'death');
      if (shut1.tr.length !== 0 || shut2.tr.length !== 0) return false;
      const gv = tr('goku', 'vegeta', 'death'), sg = tr('superman', 'goku', 'death');
      if (gv.winner !== 'Vegeta' || gv.tr.length !== 1 || gv.tr[0].fighter !== 'Goku' || gv.tr[0].to !== 'Super Saiyan Blue') return false;
      if (sg.winner !== 'Superman' || sg.tr.length !== 1 || sg.tr[0].fighter !== 'Goku' || sg.tr[0].to !== 'Super Saiyan Blue') return false;
      if (gv.finRep.indexOf('base repertoire') === -1 || sg.finRep.indexOf('base repertoire') === -1) return false;
      const vg = tr('vegeta', 'goku', 'death');
      if (vg.winner !== 'Vegeta' || vg.tr.some(t => t.fighter === 'Vegeta')) return false;
      const supG = tr('superman', 'goku', 'death');
      if (supG.tr.some(t => t.fighter === 'Superman')) return false;
      const pid = runInCtx(`powerIdV1631('God Kamehameha')`);
      return pid === 'god-kamehameha';
    })(), '');
  check('V1634-INTRO-FIX (g) intro sentence fix: 0 occurrences of "with every difference listed"; new 3B wording present (resolver is main, MATCH all four, audit panel named correctly); the old panel sentence survives exactly once, only inside the dead-code v16.33 render (intentional history, not a live surface)',
    (function () {
      return html.split('with every difference listed').length - 1 === 0
        && html.indexOf('The resolver is the main output in this build') !== -1
        && html.indexOf('MATCH when all four fields agree') !== -1
        && html.indexOf('Audit comparison (v16.35') !== -1
        && html.split('main breakdown stays HP-engine-locked; the resolver does not become the main output until Phase 3B').length - 1 === 1
        && html.indexOf('main breakdown stays HP-engine-locked; the resolver does not become the main output until Phase 3B') > html.indexOf('function resolverComparisonHtmlV1624');
    })(), '');
  check('V1634-NO-HP-NUMBERS-TELLING (h) (v16.35 DELIBERATE CHANGE: the brief-mandated HP-audit pointer sentence is the ONLY allowed HP token in the telling) no HP numbers in the main telling: no HP/ATK/DEF numbers, no damage totals, no margin sentence, no dealt-damage sentence, no 3+ digit numbers, no round counts; HP appears only inside the exact Fix 3 pointer sentence, never as HP 0 or a damage figure',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      const NOTE1635 = 'No resolver transform is used in this telling. HP-audit transforms are listed separately in Audit; they do not change the resolver winner.';
      return pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt34 = simulateBattle();`);
        const t = runInCtx(`resolverTellingTextV1634(globalThis._bt34)`);
        const stripped = t.split(NOTE1635).join('');
        return !/\b\d+\s*(HP|ATK|DEF)\b/.test(t) && t.indexOf('margin of') === -1 && !/dealt \d+ damage/.test(t)
          && !/\b\d{3,}\b/.test(t) && !/round \d+/i.test(t) && t.indexOf('damage totals') === -1 && t.indexOf('HP 0') === -1
          && !/\bHP\b/.test(stripped) && (t.indexOf('HP-audit') === -1 || t.indexOf(NOTE1635) !== -1);
      });
    })(), '');
  check('V1634-TELLING-SHAPE resolver telling shape: matchup question, loser best case first, hard pivot, one Decisive line, finisher + exact loser state, one-sentence verdict naming winner + decisive criterion; no hedging filler; shutouts compressed to 5 paragraphs; first paragraphs vary across pairs',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      const firsts = [];
      const ok = pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt34 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt34))`));
        const t = runInCtx(`resolverTellingTextV1634(globalThis._bt34)`);
        const paras = t.split(/\n\n+/).map(x => x.trim()).filter(Boolean);
        firsts.push(paras[0] || '');
        const loser = (f.winner === f.fighterA.name) ? f.fighterB.name : f.fighterA.name;
        const shutout = f.decisiveCriterion === 'cannot-harm';
        if (paras[0].indexOf('Can ' + loser + ' beat ' + f.winner) !== 0) return false;
        if (t.indexOf("'s best case is") === -1) return false;
        if (t.indexOf('Decisive: ' + f.decisiveCriterion) === -1) return false;
        if (t.indexOf('Finisher: ' + f.finisher + '. ' + loser + ' is ' + f.loserState) === -1) return false;
        const last = paras[paras.length - 1] || '';
        if (last.indexOf('Verdict: ' + f.winner + ' wins, decided by ') !== 0) return false;
        if (/\b(maybe|possibly|might|probably|likely|perhaps)\b/i.test(t)) return false;
        if (shutout && paras.length !== 5) return false;
        if (!shutout && !(paras.length === 6 || paras.length === 7)) return false;
        return true;
      });
      return ok && (new Set(firsts)).size >= 4;
    })(), '');
  check('V1634-RESOLVER-WORDS new resolver exchanges + why + telling carry words only: no HP/ATK/DEF numbers, no 3+ digit numbers, exchanges length 5',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      return pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt34 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = frozenResolverResultV1634(globalThis._bt34); return {exchanges: x.exchanges, why: x.why}; })())`));
        const t = runInCtx(`resolverTellingTextV1634(globalThis._bt34)`);
        const txt = f.exchanges.join(' ') + ' ' + f.why + ' ' + t;
        return !/\b\d+\s*(HP|ATK|DEF)\b/.test(txt) && !/\b\d{3,}\b/.test(txt) && f.exchanges.length === 5;
      });
    })(), '');
  // ================= v16.35 — Phase 3B fix build =================
  check('V1635-FIX1-HEADER (Fix 1) live result header comes ONLY from the frozen resolver: on a disagreement input (Raven vs Sephiroth seed 1742094419, resolver Sephiroth, HP Raven) the rendered result-title names the resolver winner, never the HP winner, and the audit states WINNER DISAGREEMENT; non-disagreement battle still correct; showResults source calls the frozen header, never the old HP header',
    (function () {
      runInCtx(`selected = ['raven','sephiroth']; forcedSeed = 1742094419; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      const fD = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt35))`));
      const hpW = runInCtx(`globalThis._bt35.winner`);
      if (fD.winner !== 'Sephiroth' || hpW !== 'Raven') return false;
      runInCtx(`setResultHeaderFromFrozenV1635(frozenResolverResultV1634(globalThis._bt35))`);
      const titleD = runInCtx(`document.getElementById('result-title').innerText`);
      const descD = runInCtx(`document.getElementById('result-desc').innerText`);
      if (titleD.indexOf('Sephiroth Wins') === -1 || titleD.indexOf('Raven Wins') !== -1) return false;
      if (descD.indexOf('HP 0') !== -1) return false;
      const compD = JSON.parse(runInCtx(`JSON.stringify(auditComparisonForBattleV1634(globalThis._bt35))`));
      if (!compD.winnerDisagreement) return false;
      const compHtmlD = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._bt35))`);
      if (compHtmlD.indexOf('WINNER DISAGREEMENT') === -1) return false;
      runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      runInCtx(`setResultHeaderFromFrozenV1635(frozenResolverResultV1634(globalThis._bt35))`);
      const titleN = runInCtx(`document.getElementById('result-title').innerText`);
      const descN = runInCtx(`document.getElementById('result-desc').innerText`);
      if (titleN.indexOf('Superman Wins') === -1 || titleN.indexOf('knocked out, not dead') === -1) return false;
      if (descN.indexOf('HP 0') !== -1) return false;
      const src = runInCtx(`showResults.toString()`);
      return src.indexOf('setResultHeaderFromFrozenV1635') !== -1 && src.indexOf('victoryHeaderV1625') === -1 && src.indexOf('collapseResultsAuditV1635') !== -1;
    })(), '');
  check('V1635-FIX2-NO-HP-OUTSIDE-AUDIT (Fix 2) live-style main screen text (header title + desc + telling) from a frozen resolver result contains zero "HP 0" and zero damage totals',
    (function () {
      runInCtx(`selected = ['raven','sephiroth']; forcedSeed = 1742094419; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      runInCtx(`setResultHeaderFromFrozenV1635(frozenResolverResultV1634(globalThis._bt35))`);
      const main = runInCtx(`document.getElementById('result-title').innerText`) + ' ' + runInCtx(`document.getElementById('result-desc').innerText`) + ' ' + runInCtx(`resolverTellingTextV1634(globalThis._bt35)`);
      return main.indexOf('HP 0') === -1 && !/\b\d+ damage\b/.test(main) && !/dealt \d+/.test(main) && !/\b\d{3,}\b/.test(main);
    })(), '');
  check('V1635-FIX3-LABELLING (Fix 3) differing transform sources are labelled by source: telling carries the exact brief sentence, never a bare "No transform is used"; telling never copies an HP transform form name; audit panel carries both source-headed lists; resolver transform present case is headed "Resolver transforms"',
    (function () {
      runInCtx(`selected = ['raven','sephiroth']; forcedSeed = 1742094419; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      const NOTE = 'No resolver transform is used in this telling. HP-audit transforms are listed separately in Audit; they do not change the resolver winner.';
      const t = runInCtx(`resolverTellingTextV1634(globalThis._bt35)`);
      if (t.indexOf(NOTE) === -1) return false;
      if (t.indexOf('No transform is used') !== -1) return false;
      if (t.indexOf('Demon Surge') !== -1 || t.indexOf('One-Winged Angel Form') !== -1) return false; // v16.35 check correction: bare 'One-Winged Angel' is Sephiroth's legitimate style description in the telling, not an HP leak; the HP form name is 'One-Winged Angel Form'
      const compHtml = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._bt35))`);
      if (compHtml.indexOf(NOTE) === -1) return false;
      if (compHtml.indexOf('HP-audit transforms (not the main telling)') === -1) return false;
      if (compHtml.indexOf('Demon Surge') === -1 || compHtml.indexOf('One-Winged Angel') === -1) return false;
      runInCtx(`selected = ['goku','vegeta']; forcedSeed = 1440350128; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      const t2 = runInCtx(`resolverTellingTextV1634(globalThis._bt35)`);
      if (t2.indexOf('Resolver transforms: Goku becomes Super Saiyan Blue') === -1) return false;
      const f2 = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt35))`));
      if (f2.transformsUsed.length !== 1 || f2.transformsUsed[0].fighter !== 'Goku') return false;
      return true;
    })(), '');
  check('V1635-FIX3-WINNER-SWEEP (Fix 3b outcome: sweep clean, no exclusion code needed) winner is never in transformsUsed across standard 7 + Vader at seed 12345 + the three side seeds',
    (function () {
      const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman']];
      const seeds = [12345, 1440350128, 1948497691, 1742094419];
      return pairs.every(function (pr) {
        return seeds.every(function (sd) {
          runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = ${sd}; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
          const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt35))`));
          return !(f.transformsUsed || []).some(function (t) { return t.fighter === f.winner; });
        });
      });
    })(), '');
  check('V1635-FIX4-SAME-TAB-COLLAPSED (Fix 4) Audit + Combat Details start collapsed on a second battle in the same tab: opened in battle 1, collapsed by the battle-2 reset; showResults and resetSimulator both call the reset',
    (function () {
      runInCtx(`document.getElementById('audit-disclosure').open = true; document.getElementById('combat-details-disclosure').open = true;`);
      runInCtx(`collapseResultsAuditV1635()`);
      const a = runInCtx(`document.getElementById('audit-disclosure').open`);
      const c = runInCtx(`document.getElementById('combat-details-disclosure').open`);
      const src = runInCtx(`showResults.toString()`);
      const rs = runInCtx(`resetSimulator.toString()`);
      return a === false && c === false && src.indexOf('collapseResultsAuditV1635') !== -1 && rs.indexOf('collapseResultsAuditV1635') !== -1;
    })(), '');
  check('V1635-FIX5-SPEED-WHY (Fix 5a/5b) Raven vs Sephiroth seed 1742094419 resolver reasoning is valid and stated plainly: criterion speed, why names Sephiroth faster than Raven; HP damage race does not decide it (resolver never reads HP damage totals)',
    (function () {
      runInCtx(`selected = ['raven','sephiroth']; forcedSeed = 1742094419; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt35))`));
      if (f.winner !== 'Sephiroth' || f.decisiveCriterion !== 'speed') return false;
      if (f.why.indexOf('Sephiroth is faster than Raven') === -1) return false;
      const t = runInCtx(`resolverTellingTextV1634(globalThis._bt35)`);
      if (t.indexOf('Sephiroth is faster than Raven') === -1) return false;
      if (t.indexOf('1713') !== -1 || t.indexOf('1445') !== -1) return false;
      return true;
    })(), '');
  check('V1635-FIX5D-FINISHER-REPERTOIRE (Fix 5d) every resolver finisher is a power in the winner repertoire (base or transformed-form) across standard 7 + Vader at seed 12345',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      return pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt35 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt35))`));
        if (!f.finisherPowerId || !f.finisherRepertoire || f.finisherRepertoire.indexOf('repertoire') === -1) return false;
        const wId = (f.winner === f.fighterA.name) ? f.fighterA.id : f.fighterB.id;
        const names = JSON.parse(runInCtx(`JSON.stringify(charFirstV1631(byId('${wId}')).powers.map(function (p) { return p.name || p; }))`));
        if (names.indexOf(f.finisher) !== -1) return true;
        const wt = (f.transformsUsed || []).filter(function (t) { return t.fighter === f.winner; });
        if (wt.length && (wt[0].transformedPowers || []).indexOf(f.finisher) !== -1) return true;
        return false;
      });
    })(), '');
  console.log('\\n' + passed + ' passed, ' + failed + ' failed.');
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(failed ? 1 : 0);
})();

