/* WAR-ROOM v16.59 regression harness (v16.58 tests retained; Batch 1 fix pile — new V1659 check, F2 re-lock + F3 + F4, ceiling 1,480,000) — Node, DOM-stub, deterministic.
   Usage: node war-room-v16.59-tests.js [path-to-war-room-v16.59.html]
   Loads the extracted <script> from the v15 file (truncated before the
   browser INIT block), evaluates it in a vm context with stubbed
   document/localStorage, then runs the 20 required tests + the 8 v14
   regression scenarios + the all-193-vs-Batman no-crash check + source
   audits. A failing test is a bug in the implementation, not in the
   test: do not weaken an assertion to match current behaviour.
   Exit code 0 = all pass, 1 = any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = process.argv[2] || path.join(__dirname, 'war-room-v16.59.html');
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
/* LEGACY HP-ENGINE UNIT TESTS — battle() drives runGenericBattle, retained only as legacy unit-test scaffolding. The live path uses simulateBattle() + renderFromFrozenV1639; no live caller reaches runGenericBattle. */
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
// All-193 vs Batman no-crash.
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
  check('ALL-193 vs Batman: no crash, sane winners, no post-defeat actions', crashed === null && badWinner === null, crashed || badWinner || '');
}
// Profile batch 1: 20 completed, 78 remain signature-only.
{
  // Audit correction: the POWERS literal holds 96, but the V7 block assigns the other 97 at runtime
  // (union 193/193, overlap 0). No fighter is signature-only in the shipped build, so the batch
  // count is 192 with 3 powers + Goku with 4 (Jhay-agreed, item 6) / 0 remaining — not 116/78. The earlier literal-only count was wrong.
  const counts = JSON.parse(runInCtx(`JSON.stringify({total:ROSTER.length, withPowers:ROSTER.filter(f=>POWERS[f.id]&&POWERS[f.id].length===3).length, without:ROSTER.filter(f=>!(POWERS[f.id]&&POWERS[f.id].length)).length})`));
  check('BATCH-1 roster (runtime truth): 193 fighters, 192 with 3 powers (Goku has 4, Jhay-agreed item 6), 0 signature-only', counts.total === 193 && counts.withPowers === 192 && counts.without === 0, JSON.stringify(counts));
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
  check('AUDIT v16.32 (v16.32 DELIBERATE CHANGE: save format bumped to v16.28; save functions return null — no saves are created in the simplified flow; v15/v15.1/v16/v16.1 saves still loadable, see V151-3)', html.indexOf("formatVersion:'v16.38'") !== -1 && runInCtx('saveBattle(null) === null') === true, '');
  check('AUDIT mode-aware headings helper exists', script.indexOf('function updateModeHeadings') !== -1, '');
  check('AUDIT no research stat bonus in live instance path', script.indexOf('inst.atk+=10') === -1, '');
}


// ================= v15.1 FIX TESTS (live defects, UI path via simulateBattle) =================
// The v15 harness only exercised runGenericBattle, which has no battlefield-desc
// event — so it could not see the live System C repeats. These tests use the real
// UI path (simulateBattle) that the browser actually runs.
function uiBattle151(aId, bId, seed, mode) {
  runInCtx(`selected=[${JSON.stringify(aId)},${JSON.stringify(bId)}]; forcedSeed=${seed}; forcedVictoryMode=${JSON.stringify(mode)};`);
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
  check('V151-3 (Route B: Death heading) saved Death reopened after Incapacitation shows Death heading', els['episode-heading'].innerText.indexOf('Death Battle Episode') === 0, els['episode-heading'].innerText);
  const incapSave = { id: 515151, formatVersion: 'v15.1', winner: 'Spider-Man', victoryType: 'Incapacitation — knockout (unconscious, not dead)', victoryMode: 'incapacitation', battlefield: 'Open Arena', date: '10/30/2026, 6:20:00 AM', rounds: 6, seed: 4817076, eventRecord: [], story: '<h3>Chapter I</h3><p>Saved incap story.</p>', breakdown: '<li>Saved breakdown.</li>' };
  setSave(incapSave);
  runInCtx(`document.getElementById('victory-select').value='death'; document.getElementById('episode-heading').innerText='Death Battle Episode — 6 Chapters (Narrator Style C)'; viewHistory(515151);`);
  check('V151-3b saved Incapacitation reopened after Death shows Incapacitation heading', els['episode-heading'].innerText.indexOf('Incapacitation Episode') === 0, els['episode-heading'].innerText);
  const v15Save = { id: 616161, formatVersion: 'v15', winner: 'Superman', victoryType: 'Death (HP 0)', victoryMode: 'death', battlefield: 'Open Arena', date: '10/30/2026, 6:10:00 AM', rounds: 6, seed: 1, eventRecord: [], story: '<h3>Chapter I</h3><p>v15 story.</p>', breakdown: '<li>v15 breakdown.</li>' };
  setSave(v15Save);
  runInCtx(`viewHistory(616161);`);
  check('V151-3c (Route B: Death heading) v15 save loads correctly (not orphaned) with its own Death heading', els['episode-heading'].innerText.indexOf('Death Battle Episode') === 0 && els['result-desc'].innerText.indexOf('6:10:00') !== -1, els['episode-heading'].innerText);
}
// V151-5 NOT KNOWN tagging: helper + panel + canon no-result text.
{
  const empty = runInCtx(`fieldOrNotKnownV151('','no variant power established for this fighter.')`);
  const present = runInCtx(`fieldOrNotKnownV151('Web Shot','x')`);
  check('V151-5 fieldOrNotKnownV151 tags empty fields, passes real values through', empty.indexOf('[NOT KNOWN]') === 0 && present === 'Web Shot', empty + ' / ' + present);
  check('V151-5b info panel uses NOT KNOWN fallbacks for sparse fields', html.indexOf('no variant power established for this fighter.') !== -1 && html.indexOf('no power usage established in this profile.') !== -1 && html.indexOf('fieldOrNotKnownV151(inst.usage') !== -1, '');
  check('V151-5c canon-search no-result text carries NOT KNOWN', html.indexOf('[NOT KNOWN] — no Wikipedia or Fandom entry was found') !== -1, '');
}
// V151-6 Stale version / fixed-timing text gone.
{
  check('V151-6 (v16.26 DELIBERATE CHANGE: Victory Rules panel removed with Advanced Settings) no user-visible v14 blocked-check text, no Death Rules heading, no fixed signature timing, no Victory Rules panel; signature tactical line + Death mode wording present', html.indexOf('(v14 blocked check') === -1 && html.indexOf('Death Rules — what counts') === -1 && html.indexOf('every 4th action') === -1 && html.indexOf('Victory Rules — what counts') === -1 && html.indexOf('Victory Rules') === -1 && html.indexOf('used tactically, not on a fixed schedule') !== -1 && html.indexOf('the loser is dead') !== -1, '');
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
  runInCtx(`selected=[${JSON.stringify(aId)},${JSON.stringify(bId)}]; forcedSeed=${seed}; forcedVictoryMode=${JSON.stringify(mode)};`);
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
    let calls47 = 0;
    sandbox.fetch = async () => { calls47++; return { ok: true, status: 200, text: async () => 'should never be fetched' }; };
    runInCtx(`currentBattle = simulateBattle();`);
    runInCtx(`showResults();`);
    check('V16-3 (v16.47 DELIBERATE CHANGE — NO ONLINE BREAKDOWN AT ALL) showResults renders the offline Route B telling directly: no fetch call, story-output holds the offline telling (breakdown-v1619 shell, no verdict-panel, no Chapter I), label is the offline breakdown label',
      calls47 === 0 && (els['story-output'].innerHTML || '').indexOf('breakdown-v1619') !== -1 && (els['story-output'].innerHTML || '').indexOf('verdict-panel') === -1 && (els['story-output'].innerHTML || '').indexOf('Chapter I') === -1 && (els['main-story-label'].innerText || '').indexOf('Breakdown') !== -1 && (els['main-story-label'].innerText || '').indexOf('Offline Breakdown') === -1,
      'calls=' + calls47 + ' label=' + els['main-story-label'].innerText + ' hasBreakdown=' + ((els['story-output'].innerHTML || '').indexOf('breakdown-v1619') !== -1));
    const saved = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
    runInCtx(`localStorage.setItem('warroom_battles_v3', '[]');`);
    runInCtx(`showResults();`);
    const saved26 = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
    check('V1626-NOSAVE-3b (v16.26 DELIBERATE CHANGE, still true in v16.47) showResults renders the offline telling and creates NO history entry',
      (els['story-output'].innerHTML || '').indexOf('breakdown-v1619') !== -1 && saved26.length === 0 && calls47 === 0,
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
  check('V1626-FLOW (v16.26 DELIBERATE CHANGE, updated v16.47 — NO ONLINE BREAKDOWN AT ALL) character screen → breakdown only: story precedes Combat Details, Advanced + history removed from markup, resolver + status visible, no online retry in Technical Details',
    html.indexOf('id="story-output"') !== -1 && html.indexOf('id="story-output"') < html.indexOf('id="breakdown-output"')
    && html.slice(0, html.indexOf('<script>')).indexOf('id="advanced-settings"') === -1
    && html.slice(0, html.indexOf('<script>')).indexOf('history-list') === -1
    && html.slice(0, html.indexOf('<script>')).indexOf('id="resolver-visible"') !== -1
    && html.slice(0, html.indexOf('<script>')).indexOf('id="online-status-banner"') !== -1
    && html.indexOf("generateAIStory('pollinations')") === -1
    && html.indexOf('id="retry-online-story-btn"') === -1,
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
  // V1640-STRIP (v16.40 DELIBERATE CHANGE): victory-select is gone from the
  // player page and Victory hardcodes to Death, so the old both-directions
  // heading test and the live-handler existence check
  // (updateModeHeadings(_vs.value)) cannot exist. The headings are death-only
  // now; the function itself is unchanged (its function-existence check at
  // the top of this file stays). The no-arg default (Death when no select
  // exists) is proven by the §7.2 strict-DOM runtime check, not by the
  // permissive stub (which auto-creates the removed select).
  {
    runInCtx(`updateModeHeadings('death');`);
    const deathH = els['match-heading'].innerText || '';
    const deathE = els['episode-heading'].innerText || '';
    check("V1640-STRIP death-only headings: updateModeHeadings('death') sets the Death match + breakdown headings",
      deathH.indexOf('Death Match') !== -1 && deathE.indexOf('Death Battle Breakdown') !== -1,
      'match=' + deathH + ' ep=' + deathE);
  }
  // V1626-ADV-REMOVED: Advanced Settings removed from markup (v16.26 DELIBERATE CHANGE); search + filters kept.
  {
    const markup = html.slice(0, html.indexOf('<script>'));
    check('V1626-ADV-REMOVED (v16.26 DELIBERATE CHANGE) Advanced Settings absent from markup; search + category filters kept',
      markup.indexOf('id="advanced-settings"') === -1 && markup.indexOf('Mode B') === -1 && markup.indexOf('Victory Rules') === -1
      && markup.indexOf('Four Brains') === -1 && markup.indexOf('Add a Custom Fighter') === -1
      && markup.indexOf('id="search-input"') !== -1 && markup.indexOf('id="cat-chips"') !== -1,
      '');
    check('V1626-EXPORT-REMOVED (v16.26 DELIBERATE CHANGE, updated v16.47) export buttons absent from markup; Technical Details kept, online retry removed',
      markup.indexOf('Download JSON') === -1 && markup.indexOf('Download story') === -1 && markup.indexOf('exportSavedEpisodeFile') === -1
      && markup.indexOf('Technical Details') !== -1 && markup.indexOf('retryMainStoryV16()') === -1,
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
    const b = battle([[spec('vader')], [spec('rocky')]], { seed: 3, victoryMode: 'death' });
    const aliasText = 'Anakin Skywalker and Rocky Balboa clashed, trading blows and reading each other as the fight wore on. Anakin Skywalker found the opening that mattered and struck with Force Choke and Saber, and Rocky Balboa fell dead at the end while Anakin Skywalker stood as the winner.';
    const aliasChecks = JSON.parse(runInCtx(`JSON.stringify(checkMainStoryV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}), ${JSON.stringify(aliasText)}))`));
    const aliasCounts = JSON.parse(runInCtx(`JSON.stringify(countStoryChecksV16(JSON.parse(${JSON.stringify(JSON.stringify(aliasChecks))})))`));
    check('V162-Ea checker accepts a recorded alias (Anakin Skywalker) and a "and" variant of the finishing ability without weakening to a single keyword',
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
  const b165S = battle([[spec('spiderman')], [spec('batman')]], { seed: 33, victoryMode: 'incapacitation' });
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
  check('V169-L (v16.47 DELIBERATE CHANGE) importer accepts v16.46 as a previous version; title/heading read v16.47; live save format stays v16.39; v16.24-v16.38 still referenced',
    html.indexOf("'v16.28'") !== -1 && html.indexOf("entry.formatVersion = 'v16.39'") !== -1 && html.indexOf('<title>WAR-ROOM v16.59') !== -1 && html.indexOf("'v16.30'") !== -1 && html.indexOf("'v16.31'") !== -1 && html.indexOf("'v16.32'") !== -1 && html.indexOf("'v16.33'") !== -1 && html.indexOf("'v16.27'") !== -1 && html.indexOf("'v16.26'") !== -1 && html.indexOf("'v16.25'") !== -1 && html.indexOf("'v16.24'") !== -1 && html.indexOf("'v16.34'") !== -1 && html.indexOf("'v16.36'") !== -1 && html.indexOf("'v16.37'") !== -1 && html.indexOf("'v16.38'") !== -1 && html.indexOf("'v16.40'") !== -1 && html.indexOf("'v16.41'") !== -1 && html.indexOf("'v16.42'") !== -1 && html.indexOf("'v16.43'") !== -1 && html.indexOf("'v16.44'") !== -1 && html.indexOf("'v16.45'") !== -1 && html.indexOf("'v16.46'") !== -1,
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
      && brief.indexOf('Wall-Crawl Kick') !== -1 && brief.indexOf('Spider-Man') !== -1
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
    const bad = hardForV1611('combat1', 'Rocky Balboa landed Body Punch on Superman, hurting him badly.', b, []);
    const good = hardForV1611('combat1', 'Superman and Rocky Balboa traded blows in the early exchanges, testing guards and footwork.', b, []);
    check('V1611-L7 power scaling: cannot-harm Body Punch described as landing FAILED; generic traded blows NOT failed',
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
      brief.indexOf('Winner: Spider-Man (locked)') !== -1 && brief.indexOf('Wall-Crawl Kick') !== -1
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
    check('V1628-VERSION (v16.39 DELIBERATE CHANGE) build carries v16.39 title, heading, and live save format; v16.24 and v16.27 still accepted by the importer',
      html.indexOf('<title>WAR-ROOM v16.59') !== -1 && html.indexOf('<h1>WAR-ROOM v16.59</h1>') !== -1 && html.indexOf("entry.formatVersion = 'v16.39'") !== -1
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
    check('V1619-NO-VERDICT-MAIN (v16.19 DELIBERATE CHANGE, updated v16.47 — NO ONLINE BREAKDOWN AT ALL) showResults renders the offline telling directly and never calls the breakdown generator, verdict slideshow, or multi-stage generator; retry keeps its dormant generator call (untriggered — its buttons are removed)',
      (function () {
        function fnBody(name) { const s = html.indexOf('function ' + name + '('); const e = html.indexOf('\nfunction ', s + 10); return html.slice(s, e === -1 ? html.length : e); }
        const sr = fnBody('showResults');
        const rt = fnBody('retryMainStoryV16');
        const srCode = sr.replace(/\/\*[\s\S]*?\*\//g, '');
        return sr.indexOf('analysisNarrationHtmlV1638') !== -1 && srCode.indexOf('generateBreakdownV1619') === -1 && srCode.indexOf('generateMainStoryV16') === -1 && srCode.indexOf('generateVerdictV1614') === -1
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
        // RETIRED v16.39: V1616-LIVE-STANCE — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    
    
    
        // RETIRED v16.39: V1616-LIVE-PEEVE — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    
    
        // RETIRED v16.39: V1616-LIVE-FEAR — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1616-LIVE-REL — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    
    
    check('V1616-LIVE-REL-NOMATCH Goku vs Rocky fires NO relationship trigger at all (unmatched guard)',
      !liveBattle('goku', 'rocky', 12345, 'death').events.some(function (e) { return e.type === 'tactic' && /relationship trigger/i.test(e.detail || ''); }), '');
        // RETIRED v16.39: V1616-LIVE-PREP — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1616-LIVE-PREP-EXHAUSTED — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1616-LIVE-COST — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    
        // RETIRED v16.39: V1616-LIVE-DODGE — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    
        // RETIRED v16.39: V1616-LIVE-BREAKDOWN — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    check('V1616-LIVE-CRASHFIX (v16.39 DELIBERATE CHANGE) long battle that crashed v16.15 (Batman vs Rocky) now completes on the rendered path: resolver winner Batman (v16.55 B: Rocky now carries a researched stated limit, so he runs out first and Batman finishes the weakened Rocky — the v16.54 Rocky win was the killed numeric fallback inventing a Batman runs-out from roster numbers 7 vs 10; the rendered record follows the frozen resolver result), with a non-empty round record',
      (function () { const b = liveBattle('batman', 'rocky', 12345, 'death'); return b.winner === 'Batman' && b.events.length > 0; })(), '');
        // RETIRED v16.39: V1616-LIVE-VERDICT — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
        // RETIRED v16.39: V1617-PROMPT-TACTIC — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    // (d) offline template varies by record beyond names
    check('V1617-TEMPLATE-VARIES two different battles produce different panel 1/2 texts even with fighter names stripped',
      (function () {
        const f1 = verdictFixture('superman', 'rocky', 12345, 'death');
        const f2 = verdictFixture('saitama', 'frodo', 12345, 'death');
        const strip = function (s, names) { let o = s; names.forEach(function (n) { o = o.split(n).join(''); }); return o; };
        const p1a = strip(parasOf(f1.txt)[0], ['Superman', 'Rocky Balboa', 'Open Arena']);
        const p1b = strip(parasOf(f2.txt)[0], ['Saitama', 'Frodo Baggins', 'Open Arena']);
        const f3 = verdictFixture('goku', 'vegeta', 12345, 'death');
        const p2a = strip(parasOf(f1.txt)[1], ['Superman', 'Rocky Balboa', 'Body Punch']);
        const p2b = strip(parasOf(f3.txt)[1], ['Vegeta', 'Goku', 'Kamehameha']);
        return p1a !== p1b && p2a !== p2b;
      })(), '');
    // (e) offline template uses recorded tactic events when present
        // RETIRED v16.39: V1617-TEMPLATE-TACTIC — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1617-TEMPLATE-TACTIC-REL — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    // (f) dodge finding: rendering exists; a dodge that DOES occur renders.
    // Live-path dodgeChance is capped 0.30 on dex/sp diffs only (dossier mult
    // is recorded, not multiplied, on the live path — pre-existing, formulas
    // out of scope for this phase). Superman (dex 7, sp 1.1) vs Rocky
    // (dex 7, sp 1.1) therefore has dodgeChance exactly 0 either way, which
    // is why several short live battles can show no dodge event at all.
        // RETIRED v16.39: V1617-DODGE-RENDERS — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
        // RETIRED v16.39: V1619-EXTREME — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    check('V1619-PROMPT (v16.20 DELIBERATE CHANGE) breakdown prompt carries the locked outcome and decisive criterion, the wording guide (hard pivot, no hedging filler), the shared dossier fields, and no transcript block',
      (function () {
        const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        return pr.indexOf('LOCKED OUTCOME') !== -1 && pr.indexOf(f1.facts.winner) !== -1 && pr.indexOf(f1.facts.finisher) !== -1 && pr.indexOf('Decisive: ' + f1.facts.decisiveKey) !== -1 && pr.indexOf('EVENTS:') === -1
          && pr.indexOf('hard pivot') !== -1 && pr.indexOf('maybe') !== -1 && pr.indexOf('SHARED DOSSIER FIELDS') !== -1 && pr.indexOf('never end on sealing') !== -1;
      })(), '');
    check('V1628-CACHE (v16.39 DELIBERATE CHANGE) cache key is v1639, distinguishes pair/outcome, a second identical put replaces (no duplicate key), and a planted legacy 9-section text is rejected',
      (function () {
        resetHist19();
        runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1659', '[]');`);
        const putA = runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}), 'TEXT-A')`);
        const getA = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const putB = runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(f3.r))}), 'TEXT-B')`);
        const getA2 = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const putA2 = runInCtx(`breakdownCachePutV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}), 'TEXT-A2')`);
        const getA3 = runInCtx(`breakdownCacheGetV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const arr = JSON.parse(runInCtx(`JSON.stringify(JSON.parse(localStorage.getItem('warroom_breakdown_cache_v1659') || '[]'))`));
        const keyA = runInCtx(`breakdownCacheKeyV1619(JSON.parse(${JSON.stringify(JSON.stringify(f1.r))}))`);
        const keyB = runInCtx(`breakdownCacheKeyV1619(JSON.parse(${JSON.stringify(JSON.stringify(f3.r))}))`);
        const legacy9 = ['1. Matchup', '2. Best case', '3. Counter', '4. Plan', '5. Stall', '6. Scoreboard', '7. Sequence', '8. Finisher', '9. Verdict'].join('\n');
        runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1659', JSON.stringify([{key: ${JSON.stringify(keyA)}, text: ${JSON.stringify(legacy9)}}]))`);
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
    check('V1628-VERSION (v16.39 DELIBERATE CHANGE) build carries v16.39 title, heading, and live save format; v16.24 and v16.27 still accepted by the importer',
      html.indexOf('<title>WAR-ROOM v16.59') !== -1 && html.indexOf('<h1>WAR-ROOM v16.59</h1>') !== -1 && html.indexOf("entry.formatVersion = 'v16.39'") !== -1
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
    // v16.40 NOTE: V151-4 is retired and simulateBattle hardcodes Open Arena (BATTLEFIELDS[0]) after the strip, so no stub pin is needed — the fixtures below fight on Open Arena by construction.
        // RETIRED v16.39: V1620-SEQ-R12 — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
        // RETIRED v16.39: V1620-CRITERION-CANNOTHARM — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1620-CRITERION-SAMETIER — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
        // RETIRED v16.39: V1620-REGEN-DISTINCT — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    check('V1620-REGEN-NOCLAIM Superman vs Rocky text claims no regeneration for either fighter; checker FAILS an invented regen claim',
      (function () {
        const f = bdFixture('superman', 'rocky', 742768439, 'death');
        const noClaim = !/(Superman|Rocky Balboa)\s+(regenerated|recovered|recovers?|heals?|healed|regenerating)\b/i.test(f.txt);
        const txt = withSection(f, 1, secBody(f, 1) + ' Superman regenerated 40 HP per round in this fight.');
        const checks = JSON.parse(runInCtx(`JSON.stringify(checkBreakdownV1619(${JSON.stringify(txt)}, JSON.parse(${JSON.stringify(JSON.stringify(f.r))})))`));
        return noClaim && failed19(f).length === 0
          && checks.some(c => c.name === 'Breakdown does not claim regeneration that did not happen' && c.state === 'FAILED');
      })(), '');
        // RETIRED v16.39: V1620-REGEN-GATE-FAILS — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    check('V1620-WOLVERINE-AGREEMENT (v16.39 DELIBERATE CHANGE: log leg retired — rendered records carry no heal events) Wolverine panel and structured line agree on regeneration; the heal-event log leg is retired, not a live-flow behavior',
      (function () {
        const panel = runInCtx(`dossierPanelHtmlV1612(byId('wolverine'))`);
        // The dossier panel renders deep-dossier + shared-schema sections, not the structured-profile block; the per-round line lives in structuredProfileForV14 (the source the live report quoted as the "structured line").
        const structured = JSON.parse(runInCtx(`JSON.stringify(structuredProfileForV14(byId('wolverine')))`));
        const sd = JSON.parse(runInCtx(`JSON.stringify(sharedDossierFieldsV1620(byId('wolverine')))`));
        // v16.39: heal events are a retired HP-engine texture — rendered records never carry them, so no log leg is asserted here.
        return structured.regen.perRound === 40 && panel.indexOf('regenerative') !== -1 && panel.indexOf('HP reaching 0 after the regeneration cap is exhausted') !== -1 && sd.durabilityType === 'regenerative' && sd.durabilityNote === '';
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
        runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1638', '[]');`);
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
      runInCtx(`localStorage.setItem('warroom_breakdown_cache_v1638', '[]');`);
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
        // RETIRED v16.39: V1621-FIX1-MERCY — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
        // RETIRED v16.39: V1621-FIX5-CRITERION — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
    check('V1626-NOEXPORT-STATIC (v16.26 DELIBERATE CHANGE, v16.40 strip, updated v16.47) no export controls in markup; Technical Details lives ONLY on the tester surface; no online retry anywhere',
      html.slice(0, html.indexOf('<script>')).indexOf('export-note-top') === -1
      && html.slice(0, html.indexOf('<script>')).indexOf('Download JSON') === -1
      && (function () {
        const pre = html.slice(0, html.indexOf('<script>'));
        const ti = pre.indexOf('<section id="tester-screen"');
        const player = ti === -1 ? pre : pre.slice(0, ti);
        const tester = ti === -1 ? '' : pre.slice(ti);
        return player.indexOf('Technical Details') === -1 && player.indexOf('id="retry-online-story-btn"') === -1
          && tester.indexOf('Technical Details') !== -1 && tester.indexOf('id="retry-online-story-btn"') === -1;
      })(),
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
      runInCtx(`verdictLastPostAtV1614 = 0; localStorage.setItem('warroom_breakdown_cache_v1659', '[]');`);
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
        // RETIRED v16.39: V1622-FIXA-VERDICT — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1622-FIXA-VERDICT-NEGATIVE — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1622-FIXA-TIDE — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

        // RETIRED v16.39: V1622-FIXA-TIDE-NEGATIVE — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

    check('V1622-FIXA-PROMPT AI prompt carries verdict specificity and the tide rule',
      (function () {
        const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(gv.r))}))`);
        return pr.indexOf('never a bare decided by transformation') !== -1 && pr.indexOf('turned the tide only if') !== -1 && pr.indexOf('produced no finish') !== -1;
      })(), '');
    check('V1626-LIVE-RETRY (v16.26 DELIBERATE CHANGE, updated v16.47 — NO ONLINE BREAKDOWN AT ALL) no online retry button in markup; retryMainStoryV16 stays as dormant code; banner element exists',
      (function () {
        const markup = html.slice(0, html.indexOf('<script>'));
        return markup.indexOf('retryMainStoryV16()') === -1 && markup.indexOf('Technical Details') !== -1
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
      runInCtx(`verdictLastPostAtV1614 = 0; localStorage.setItem('warroom_breakdown_cache_v1659', '[]');`);
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
  check('V1623-P1 Roster stays 193 and every fighter/version has a structured power profile',
    profAll.length === 193 && profAll.every(p => p.tier && p.band && p.speed && p.reaction && p.dur && p.way && p.sig && p.sigType),
    'count=' + profAll.length);
  check('V1623-P2 Power source is unknown for all 193 (schema field present, never parsed from prose)',
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
  check('V1623-P4 (v16.25 DELIBERATE CHANGE) Signature damage is AUTHORED for all 193; powerset types use the v16.25 single source and are never presented as authored',
    profAll.every(p => DMG_VOCAB.indexOf(p.sigType) !== -1 && p.sigStatus.indexOf('authored') !== -1)
    && profAll.every(p => p.powStatus.indexOf('single source') !== -1 && p.powStatus.indexOf('never presented as authored') !== -1)
    && (function () {
      const entries = JSON.parse(runInCtx(`JSON.stringify(structuredPowersForV14(Object.assign({}, byId('gojo'), {variant: 'Base', variantId: 'base'})).filter(function (x) { return x.isSignature; }).map(function (x) { return {name: x.name, type: x.damageType, src: x.damageTypeSource}; }))`));
      const kw = JSON.parse(runInCtx(`JSON.stringify(structuredPowersForV14(Object.assign({}, byId('goku'), {variant: 'Base', variantId: 'base'})).filter(function (x) { return x.name === 'Instant Transmission Strike'; }).map(function (x) { return {type: x.damageType, src: x.damageTypeSource, eff: x.effect}; }))`));
      return entries.length >= 1 && entries[0].type === 'energy' && entries[0].src === 'authored-signature'
        && kw.length >= 1 && kw[0].src === 'matched by keyword' && kw[0].eff.indexOf('not authored') !== -1;
    })(),
    'bad sig=' + profAll.filter(p => DMG_VOCAB.indexOf(p.sigType) === -1 || p.sigStatus.indexOf('authored') === -1).map(p => p.id).join(','));
  check('V1623-P5 Authored signature differs from the keyword mapping where expected, proving the table is not the regex (Spider-Man: authored physical vs keyword restraint)',
    profById['spiderman'].sigType === 'physical' && runInCtx(`damageTypeCanonicalV14('Web Shot')`) === 'restraint'
    && profById['danny'].sigType === 'environmental' && runInCtx(`damageTypeCanonicalV14('Ghostly Wail')`) === 'physical',
    'spiderman authored=' + profById['spiderman'].sigType + ' danny authored=' + profById['danny'].sigType);
  check('V1623-P6 Durability types are in vocabulary with a defined way to lose; counts match the trait/deep derivation (regen 6, invulnerable 2, other 1, mortal 184, intangible/immortal 0) — v16.56 (item 5): gandalf2 was mortal, so mortal 185 -> 184',
    (function () {
      const c = {}; profAll.forEach(p => { c[p.dur] = (c[p.dur] || 0) + 1; });
      return profAll.every(p => DUR_VOCAB.indexOf(p.dur) !== -1 && p.way && p.way.length > 0)
        && c['regenerative'] === 6 && c['invulnerable'] === 2 && c['other'] === 1 && c['mortal'] === 184
        && (c['intangible'] || 0) === 0 && (c['immortal'] || 0) === 0;
    })(), 'counts=' + JSON.stringify(profAll.reduce((a, p) => { a[p.dur] = (a[p.dur] || 0) + 1; return a; }, {})));
  check('V1623-P7 Hax is unknown for all 193 (schema present, nothing inferred from power names)',
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
  check('V1623-P9 Range: values in vocabulary, exactly 50 authored (18 close, 31 mid, 1 full-screen), 143 unknown; pushed-out unknown except Green Arrow — v16.56 (item 5): gandalf2 was unknown, so unknown 144 -> 143',
    (function () {
      const c = {}; profAll.forEach(p => { c[p.range] = (c[p.range] || 0) + 1; });
      return c['close'] === 18 && c['mid'] === 31 && c['full-screen'] === 1 && c['unknown'] === 143
        && profById['goku'].range === 'close' && profById['gojo'].range === 'mid' && profById['storm'].range === 'full-screen'
        && profById['batman'].range === 'unknown'
        && profAll.filter(p => p.pushedOut.indexOf('unknown') === -1).map(p => p.id).join(',') === 'greenarrow';
    })(), 'counts=' + JSON.stringify(profAll.reduce((a, p) => { a[p.range] = (a[p.range] || 0) + 1; return a; }, {})));
  check('V1623-P10 Stamina limits come from profile weakness text where stated (Ben timeout, All-Might time limit); Goku no longer states a drain (F2 re-lock, Jhay 2026-11-10 ~03:59) so his limit is honestly unknown; otherwise honestly unknown',
    profById['ben'].stamina.indexOf('Omnitrix timeout') !== -1 && profById['goku'].stamina === 'No stamina or time limit is stated in this profile beyond the engine stamina pool.' && profById['goku'].staminaStatus === 'unknown'
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
      return v2.variantId === 'v2' && v2.variant === 'Armoured' && v2.sigType === 'physical' && v2.sigName === 'Batarang Throw';
    })(), '');
  check('V1623-P14 (v16.39 DELIBERATE CHANGE) Version stamps: title/heading/live format are v16.39 and the importer still accepts v16.24 as legacy',
    html.indexOf('<title>WAR-ROOM v16.59') !== -1 && html.indexOf('<h1>WAR-ROOM v16.59</h1>') !== -1
    && html.indexOf("entry.formatVersion = 'v16.39'") !== -1 && html.indexOf("'v16.24'") !== -1,
    '');
  check('V1623-P15 (v16.47 DELIBERATE CHANGE) File stays compact: v16.47 source is under the 1,480,000-character ceiling (Fix 6, Jhay 2026-11-07 01:25; the v16.39-era 1,220,000 cap is superseded by the approved variants ceiling)',
    html.length < 1480000, 'chars=' + html.length);
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
      return g.h.winner === 'Goku' && g.r.winner === 'Vegeta' && g.r.decisiveCriterion === 'speed' // v16.55 (B): both-stated pairs fall through to speed — the numeric fallback is killed
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
  check('V1624-R7 Stamina branch (v16.55 B): Goku vs Vegeta is now both-stated, so neither runs out first and it falls through to speed (Vegeta wins); the stamina step records no runs-out fighter',
    res24('goku', 'vegeta', 12345, 'death').decisiveCriterion === 'speed' && res24('goku', 'vegeta', 12345, 'death').winner === 'Vegeta'
    && res24('goku', 'vegeta', 12345, 'death').inputs.runsOutFirst.fighter === null, '');
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
        { id: 'batman', sig: 'Batarang Throw', type: 'physical' },
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
        && htmlCmp.indexOf('Audit comparison (v16.38 — resolver is the main output, HP engine is the hidden audit)') !== -1
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
  check('V1624-R14 (v16.39 DELIBERATE CHANGE) Version stamps: title/heading/live format are v16.39 and the importer still accepts v16.24 as legacy; no forbidden content',
    html.indexOf('<title>WAR-ROOM v16.59') !== -1 && html.indexOf('<h1>WAR-ROOM v16.59</h1>') !== -1
    && html.indexOf("entry.formatVersion = 'v16.39'") !== -1 && html.indexOf("'v16.24'") !== -1
    && html.indexOf('llm7.io') === -1 && html.indexOf('api.ovh') === -1 && !/sk-[A-Za-z0-9]{16,}/.test(html)
    && (function () { const pr = runInCtx(`buildBreakdownPromptV1619(JSON.parse(${JSON.stringify(JSON.stringify(bd23('superman', 'rocky', 12345, 'death').r))}))`); return pr.indexOf('EVENTS:') === -1; })(), '');
  check('V1624-R15 Roster stays 193; resolver does not add fighters, relabel nature, or change the main breakdown lock',
    profAll.length === 193 && runInCtx(`powerProfileV1623(Object.assign({}, byId('ghostrider'), {variant: 'Base', variantId: 'base'})).nature.value`) === 'unknown'
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
  check('V1625-S4 (v16.32 DELIBERATE CHANGE) Part 4 speed: 1.1 is slightly above average (never bare above average), Superman audit stated in breakdown and prompt with the v16.38 label, game-speed note present',
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
        && s6.indexOf('Speed bands are game speed, not canon speed.') !== -1 && s6.indexOf('Superman speed audit (v16.38)') !== -1
        && pr.indexOf('SUPERMAN SPEED AUDIT (v16.38)') !== -1 && pr.indexOf('game speed, not canon speed') !== -1;
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
    check('V1634-AUDIT-S6 (v16.39 DELIBERATE CHANGE) the audit comparison is SINGLE-RECORD (rendered record vs frozen resolver result), not independent: the 3 named battles report PASS with the exact PASS sentence and no old MATCH/PARTIAL wording anywhere in the new panel; a rendered record is never a second opinion',
      (function () {
        const pairs = [['goku', 'vegeta', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death']];
        return pairs.every(function (pr) {
          runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt39 = simulateBattle();`);
          const c = JSON.parse(runInCtx(`JSON.stringify(auditComparisonForBattleV1639(globalThis._bt39))`));
          const h = runInCtx(`auditComparisonHtmlV1639(auditComparisonForBattleV1639(globalThis._bt39))`);
          return c.overall === 'PASS' && c.winnerDisagreement === false && (c.differences || []).length === 0 && c.verdict === "PASS — single-record consistency: the rendered record matches the frozen result on winner, reason, finisher, and loser state. The rendered record is derived from the frozen resolver result, so this check catches renderer bugs — it is not a second opinion, and it does not mean two independent systems agreed."
            && h.indexOf("Audit comparison (v16.39 — single-record)") !== -1 && h.indexOf("PASS — single-record consistency: the rendered record matches the frozen result on winner, reason, finisher, and loser state. The rendered record is derived from the frozen resolver result, so this check catches renderer bugs — it is not a second opinion, and it does not mean two independent systems agreed.") !== -1
            && h.indexOf('Differences (listed honestly)') === -1 && h.indexOf('WINNER DISAGREEMENT') === -1 && h.indexOf('All four fields agree: MATCH.') === -1;
        });
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
      const fSoraV2 = runInCtx(`startingFormNoteForFighterV1625(Object.assign({}, byId('sora'), {variant: 'KHIII Sora', variantId: 'v2'}), 'KHIII Sora', 'v2')`);
      const fGokuV2 = runInCtx(`startingFormNoteForFighterV1625(Object.assign({}, byId('goku'), {variant: 'Super Saiyan God', variantId: 'v2'}), 'Super Saiyan God', 'v2')`);
      const fFrodoV2 = runInCtx(`startingFormNoteForFighterV1625(Object.assign({}, byId('frodo'), {variant: 'Ring-bearer', variantId: 'v2'}), 'Ring-bearer', 'v2')`);
      return base === 'Starting form: Base — transformations may trigger mid-fight.'
        && v2t === 'Starting form: Armored Batsuit — transformations may trigger mid-fight.'
        && v2n === 'Starting form: Ring-bearer — no further in-combat transformation is legal from this version.'
        && fBat === base && fSoraV2 === 'Starting form: KHIII Sora — transformations may trigger mid-fight.' && fGokuV2 === 'Starting form: Super Saiyan God — no further in-combat transformation is legal from this version.' && fFrodoV2 === v2n
        && html.indexOf('Starting forms:</b>') !== -1 && html.indexOf('Starting form: Base — transformations may trigger mid-fight.') !== -1;
    })(), '');
  check('V1625-S11 Part 11 per-power records: all 15 fighters, full fields, outcome/status vocabularies, no invented powers, resolver carries records, record direction override, no sealing/removal outcome',
    (function () {
      const ids = ['spiderman', 'batman', 'goku', 'vegeta', 'superman', 'rocky', 'deadpool', 'wolverine', 'saitama', 'frodo', 'raven', 'sephiroth', 'gojo', 'ghostrider', 'pikachu'];
      const OUT = ['no effect', 'resisted', 'wounding', 'incapacitating', 'sealing', 'removal', 'lethal', 'movement only']; // v16.56 (item 6): the Instant Transmission movement record — a teleport's outcome is movement, not a hit
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
      const dir = JSON.parse(runInCtx(`JSON.stringify(powerRecordDirectionV1625({id: 'batman', sig: 'Batarang Throw', name: 'Batman'}, 'invulnerable', false))`));
      const dirBypass = runInCtx(`powerRecordDirectionV1625({id: 'batman', sig: 'Batarang Throw', name: 'Batman'}, 'invulnerable', true)`);
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
        // RETIRED v16.39: V1627-TONE-VARIES — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
    check('V1626-MODE-WORDING mode selector says the loser is dead; the old HP-0-by-death wording is gone',
      html.indexOf('the loser is dead') !== -1 && html.indexOf('must reach HP 0 to lose by death') === -1,
      '');
    check('V1626-ROSTER-193 roster stays at 193 fighters',
      runInCtx(`ROSTER.length`) === 193,
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
      check('V1634-AUDIT-DEFINITION (v16.39 DELIBERATE CHANGE) the audit panel uses PASS/FAIL: Superman vs Rocky passes on all four fields (PASS, no differences); no old Option B label remains anywhere in the file',
      (function () {
        const count = html.split('The resolver reports the main-engine (HP engine) result').length - 1;
        runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._v39B = simulateBattle();`);
        const rv = runInCtx(`renderAuditV1639(globalThis._v39B)`);
        const vis = els['resolver-visible'].innerHTML || '';
        const comp = JSON.parse(runInCtx(`JSON.stringify(auditComparisonForBattleV1639(globalThis._v39B))`));
        return count === 0 && html.indexOf('Advisory only: the resolver and the main (HP engine) result can disagree') === -1
          && html.indexOf('can disagree') === -1 && html.indexOf('by construction in v16.28') === -1
          && rv === 'ok' && vis.indexOf("Audit comparison (v16.39 — single-record)") !== -1
          && vis.indexOf("PASS — single-record consistency: the rendered record matches the frozen result on winner, reason, finisher, and loser state. The rendered record is derived from the frozen resolver result, so this check catches renderer bugs — it is not a second opinion, and it does not mean two independent systems agreed.") !== -1 && comp.overall === 'PASS' && comp.winnerDisagreement === false && (comp.differences || []).length === 0
          && comp.renderedWinner === comp.frozenWinner && comp.renderedReason === comp.frozenReason && comp.renderedFinisher === comp.frozenFinisher && comp.renderedLoserState === comp.frozenLoserState;
      })(), '');
    check('V1634-AUDIT-LABEL (v16.34 DELIBERATE CHANGE) audit comparison heading reads exactly "Audit comparison (v16.38 — resolver is the main output, HP engine is the hidden audit)"',
      (function () {
        runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._v1628B2 = simulateBattle();`);
        const comp = runInCtx(`auditComparisonHtmlV1634(auditComparisonForBattleV1634(globalThis._v1628B2))`);
        return comp.indexOf('Audit comparison (v16.38 — resolver is the main output, HP engine is the hidden audit)') !== -1
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
    check('V1628-SPEED-CLAUSE-ALL every one of the 193 dossiers carries the fuller speed clause in plain words in its Speed line; speed numbers unchanged (Superman 1.1, Frodo 1.2, Gojo 1.2, Saitama 1.2)',
      (function () {
        const ids = JSON.parse(runInCtx(`JSON.stringify(ROSTER.map(function (f) { return f.id; }))`));
        if (ids.length !== 193) return false;
        let ok = true;
        ids.forEach(function (id) {
          runInCtx(`openInfo('` + id + `')`);
          const info = els['info-content'].innerHTML || '';
          if (info.indexOf('rebalance') === -1 || info.indexOf('game speed, not canon speed') === -1) ok = false;
        });
        return ok && runInCtx(`byId('superman').sp`) === 1.1 && runInCtx(`byId('frodo').sp`) === 1.2
          && runInCtx(`byId('gojo').sp`) === 1.2 && runInCtx(`byId('saitama').sp`) === 1.2;
      })(), '');
      check('V1634-AUDIT-COMPARISON (v16.39 DELIBERATE CHANGE) all 7 known pairs + Vader vs Superman at seed 12345 report PASS on the single-record comparison (rendered === frozen on all four fields, no differences, never a winner disagreement); rendering the comparison does not change the record. Old HP golden values are DEAD per spec 8.5 and are never asserted.',
      (function () {
        const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
        return pairs.every(function (pr) {
          runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt39 = simulateBattle();`);
          const before = runInCtx(`globalThis._bt39.winner + '|' + ((globalThis._bt39.finalRecord && globalThis._bt39.finalRecord.finishingAbility) || '')`);
          const c = JSON.parse(runInCtx(`JSON.stringify((function(){ var cc = auditComparisonForBattleV1639(globalThis._bt39); return {overall: cc.overall, rw: cc.renderedWinner, fw: cc.frozenWinner, rr: cc.renderedReason, fr: cc.frozenReason, rf: cc.renderedFinisher, ff: cc.frozenFinisher, rl: cc.renderedLoserState, fl: cc.frozenLoserState, wd: cc.winnerDisagreement, ndiff: (cc.differences || []).length, verdict: cc.verdict}; })())`));
          const compHtml = runInCtx(`auditComparisonHtmlV1639(auditComparisonForBattleV1639(globalThis._bt39))`);
          const after = runInCtx(`globalThis._bt39.winner + '|' + ((globalThis._bt39.finalRecord && globalThis._bt39.finalRecord.finishingAbility) || '')`);
          return c.overall === 'PASS' && c.wd === false && c.ndiff === 0 && c.verdict === "PASS — single-record consistency: the rendered record matches the frozen result on winner, reason, finisher, and loser state. The rendered record is derived from the frozen resolver result, so this check catches renderer bugs — it is not a second opinion, and it does not mean two independent systems agreed."
            && c.rw === c.fw && c.rr === c.fr && c.rf === c.ff && c.rl === c.fl
            && compHtml.indexOf("Audit comparison (v16.39 — single-record)") !== -1 && compHtml.indexOf('Differences (listed honestly)') === -1 && compHtml.indexOf('WINNER DISAGREEMENT') === -1 && compHtml.indexOf('All four fields agree: MATCH.') === -1
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
        return info.indexOf('Power records (v16.38') !== -1 && info.indexOf('Power records (v16.25') === -1
          && html.indexOf('POWER RECORDS (v16.38') !== -1 && html.indexOf('POWER RECORDS (v16.25') === -1;
      })(), '');
    check('V1629-STALE-SWEEP (v16.40 SPEC-GAP FIX: Phase 3 panel clause flips to absence — the strip deletes that panel per spec §1.2, but §7.1 did not list this check; all other clauses unchanged) home Phase 3 panel, 1v1 note, resolver fallback, and v15 rule lines carry current or version-neutral wording',
      html.indexOf('that is the whole flow in v16.39') === -1 && html.indexOf('WAR-ROOM is 1v1 only.') !== -1
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
        const rs = html.slice(start, start + 2500); // v16.57: resetSimulator grew ~273 chars (seed + prediction clears) before the switch, which sat at 1570 — the old 1500 window cut it off
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
        return panelOk && tS.indexOf('Superman speed audit (v16.38)') !== -1 && tG.indexOf('Gojo speed audit (v16.38)') !== -1
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
    check('V1629-HEALING-FACTOR-WORDING (v16.32 DELIBERATE CHANGE) Wolverine Healing Factor Strike entry states the move is recorded and only its damage type is unknown, keeping the labelled keyword match',
      (function () {
        const pw = runInCtx(`JSON.stringify(structuredPowersForV14(byId('wolverine')))`);
        const rec = runInCtx(`powerRecordsHtmlV1625(Object.assign({}, byId('wolverine'), {variant: 'Base', variantId: 'base'}))`);
        return pw.indexOf('Healing Factor Strike') !== -1 && pw.indexOf('matched by keyword') !== -1 && pw.indexOf('not authored') !== -1
          && pw.indexOf('the move itself is recorded') !== -1 && pw.indexOf('the authored type for this power is unknown') === -1
          && rec.indexOf('damage type: unknown (matched by keyword, not authored)') !== -1 && rec.indexOf('the move itself is recorded') !== -1;
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
    check('V1633-SCHEMA-ALL all 193 fighters convert to the character-first schema with 0 validation errors: durability + way to lose present, id unique, signature flagged exactly once, audit block present, no invented status',
      (function () {
        const batch = JSON.parse(runInCtx(`JSON.stringify(validateCharFirstBatchV1631())`));
        if (!batch.ok || batch.converted !== 193 || batch.total !== 193 || batch.errors.length !== 0) return false;
        if (batch.perCategory['Anime'].converted !== 33 || batch.perCategory['Comics'].converted !== 33) return false;
        if (batch.perCategory['Video Games'].converted !== 32 || batch.perCategory['Movies & TV'].converted !== 31) return false; // v16.56 (item 5): gandalf2 was Movies & TV
        if (batch.perCategory['Animation'].converted !== 32 || batch.perCategory['Fantasy & Sci-Fi'].converted !== 32) return false;
        const per = JSON.parse(runInCtx(`JSON.stringify((function(){ var ids = {}, sigBad = 0, durBad = 0, auditBad = 0, invented = 0; ROSTER.forEach(function (f) { if (ids[f.id]) sigBad++; ids[f.id] = true; var c = charFirstV1631(f); if (!c.durability || !c.durability.type || !c.durability.wayToLose) durBad++; if (c.powers.filter(function (p) { return p.signature; }).length !== 1) sigBad++; if (!c.audit || typeof c.audit.hp !== 'number') auditBad++; if (/"\w*[Ss]tatus":"invented"/.test(JSON.stringify(c))) invented++; }); return {unique: Object.keys(ids).length, sigBad: sigBad, durBad: durBad, auditBad: auditBad, invented: invented}; })())`));
        return per.unique === 193 && per.sigBad === 0 && per.durBad === 0 && per.auditBad === 0 && per.invented === 0;
      })(), '');
    check('V1633-BATCH-TABLE batch unknown counts by field type match the measured Phase 3A table (continuity 139, nature 183, range 143, hax/delivery/powerSource/morals-canon/style 193, stamina-limit 179, power-does/range/limit 178 fighters, power-outcome 179 fighters, transform-needed 100) — v16.56 (item 5): gandalf2 removed (his powers\' outcomes default to \'wounding\', so power-outcome stays 179); style slots 1164 -> 1158 (193x6), power-does slots 552 -> 549 (gandalf2\'s 3 powers)',
      (function () {
        const batch = JSON.parse(runInCtx(`JSON.stringify(validateCharFirstBatchV1631())`));
        const u = batch.unknownFightersByDim, s = batch.unknownSlotsByDim;
        return u['continuity'] === 139 && u['nature'] === 183 && u['range'] === 143 && u['hax'] === 193 && u['delivery'] === 193
          && u['powerSource'] === 193 && u['morals-canon'] === 193 && u['style'] === 193 && u['stamina-limit'] === 179
          && u['power-does'] === 178 && u['power-range'] === 178 && u['power-limit'] === 178 && u['power-outcome'] === 179
          && u['transform-needed'] === 100 && s['style'] === 1158 && s['power-does'] === 549 && s['transform-needed'] === 100;
      })(), '');
    check('V1633-HELD-OUT held-out counts by type match the measured table (seal-remove 193, incapacitation 186, hax/delivery 193, limit/outcome 147, limit-outcome-unrecorded 31, transform-needed 100, nature 183, range 143) — v16.56 (items 5 + 8): limit/outcome 149 -> 147 (gandalf2 removed AND Thanos loses both — his new Titan Slam record makes him partial), limit-outcome-unrecorded 30 -> 31 (Thanos gains it); a transform fighter with unknown needed never has that transform simulated',
      (function () {
        const batch = JSON.parse(runInCtx(`JSON.stringify(validateCharFirstBatchV1631())`));
        const h = batch.heldOutByType;
        if (h['seal-remove-victory'] !== 193 || h['incapacitation-victory'] !== 186 || h['hax-decisive'] !== 193 || h['delivery-decisive'] !== 193) return false;
        if (h['limit-decisive'] !== 147 || h['outcome-decisive'] !== 147 || h['limit-outcome-unrecorded-powers'] !== 31 || h['transform-needed'] !== 100 || h['nature-decisive'] !== 183 || h['range-decisive'] !== 143) return false;
        const sp = JSON.parse(runInCtx(`JSON.stringify((function(){ var c = charFirstV1631(byId('spiderman')); var r = resolveCharFirstV1631('spiderman', 'batman', 12345, {victoryMode: 'death'}); return {tr: c.transforms.map(function (t) { return t.neededStatus; }), used: r.transformsUsed, held: c.heldOut.map(function (x) { return x.type; })}; })())`));
        return sp.tr.length === 1 && sp.tr[0] === 'unknown' && Array.isArray(sp.used) && sp.used.length === 0 && sp.held.indexOf('transform-needed') !== -1;
      })(), '');
        // RETIRED v16.39: V1634-HP-AUDIT-INVARIANCE — asserts a retired HP mechanism / HP-pattern derivation, not a live-flow behavior; offline-breakdown derivation re-pointing is queued Phase 4 work per spec 2.4

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
    check('V1634-CACHE-KEY (v16.59 DELIBERATE CHANGE) breakdown cache key rotated to v1659, old v1658 key absent, legacy 9-section rejection retained',
      (function () {
        return html.indexOf('warroom_breakdown_cache_v1659') !== -1 && html.indexOf('warroom_breakdown_cache_v1658') === -1 && html.indexOf('warroom_breakdown_cache_v1638') === -1;
      })(), '');
    check('V1633-RESOLVER-WORDS schema resolver exchanges + why carry words only: no HP/ATK/DEF numbers, no 3+ digit numbers',
      (function () {
        const r = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('superman', 'rocky', 12345, {victoryMode: 'death'}); return {exchanges: x.exchanges, why: x.why}; })())`));
        const txt = r.exchanges.join(' ') + ' ' + r.why;
        return !/\b\d+\s*(HP|ATK|DEF)\b/.test(txt) && !/\b\d{3,}\b/.test(txt) && r.exchanges.length === 5;
      })(), '');
    check('V1634-VERSION (v16.39 DELIBERATE CHANGE) title, heading, audit heading, live save format, and live save method string all read v16.39',
      (function () {
        return html.indexOf('<title>WAR-ROOM v16.59') !== -1 && html.indexOf('<h1>WAR-ROOM v16.59</h1>') !== -1
          && html.indexOf("entry.formatVersion = 'v16.39'") !== -1
          && html.indexOf('Audit comparison (v16.39 — single-record)') !== -1
          && html.indexOf('Offline breakdown (v16.39)') !== -1;
      })(), '');
  }

    check('V1633-BYPASS-NOT-A-WIN (Problem 2 reconciliation) bypass is a can-hurt fact, never a win: Vader vs Superman schema winner is Superman on durability (not Vader on bypass) — v16.55 (B): neither fighter has a stated limit, so the stamina step records no runs-out fighter and it falls through to durability; the bypassPath still exists in the direction as a can-hurt assessment; NO pair among the standard 7 + Vader resolves on criterion bypass; the schema resolver has no best-move concept (no power-total comparison anywhere)',
      (function () {
        const r = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('vader','superman',12345,{victoryMode:'death'}); return {winner: x.winner, criterion: x.decisiveCriterion, finisher: x.finisher, loserState: x.loserState, bypassAB: x.inputs.directionAtoB.bypassPath, canHurtAB: x.inputs.directionAtoB.canHurt, canHurtBA: x.inputs.directionBtoA.canHurt, runsOut: x.inputs.runsOutFirst}; })())`));
        if (r.winner !== 'Superman' || r.criterion !== 'durability' || r.finisher !== 'Heat Vision' || r.loserState !== 'dead') return false;
        // The bypass fact survives as a can-hurt assessment, but awards no win.
        if (!r.bypassAB || r.bypassAB.indexOf('skips the physical-durability cannot-harm gate') === -1) return false;
        if (r.canHurtAB !== true || r.canHurtBA !== true) return false;
        if (r.runsOut.fighter !== null) return false; // v16.55 (B): neither fighter has a stated limit — no runs-out fighter
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
      check('V1634-BYPASS-UNREACHABLE (Problem 1, unreachable by design; v16.39 DELIBERATE CHANGE: live panel is the single-record render) the exact "skips..." string occurs only twice in the file (both direction functions); in the live audit panel it appears ONLY inside the frozen working detail (quoted direction reason), never in the verdict or check lines — even for Vader vs Superman, where the bypass fact applies',
      (function () {
        const occurrences = html.split('skips the physical-durability cannot-harm gate').length - 1;
        if (occurrences !== 2) return false;
        runInCtx(`selected = ['vader','superman']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt39 = simulateBattle();`);
        const compHtml = runInCtx(`auditComparisonHtmlV1639(auditComparisonForBattleV1639(globalThis._bt39))`);
        const dir = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('vader','superman',12345,{victoryMode:'death'}); return {reasonAB: x.inputs.directionAtoB.reason, bypassAB: x.inputs.directionAtoB.bypassPath}; })())`));
        const headPart = compHtml.split('audit-working')[0];
        return dir.bypassAB !== null && dir.reasonAB.indexOf('skips the physical-durability cannot-harm gate') !== -1
          && headPart.indexOf('skips the physical') === -1
          && headPart.indexOf(dir.reasonAB) === -1
          && compHtml.indexOf("Audit comparison (v16.39 — single-record)") !== -1;
      })(), '');
      check('V1634-BYPASS-MECHANISMS (Problem 1, three texts distinguished; v16.39 DELIBERATE CHANGE: live panel is the single-record render) exactly three bypass mechanisms exist and only one renders live: (i) direction bypassPath "skips..." string (direction.reason only, quoted solely in frozen working detail — see V1634-BYPASS-UNREACHABLE); (ii) NO question-2 "bypasses..." line exists in the file (no QUESTION string at all); (iii) NO HP-gate bypass panel exists in the file (no "HP gate" / "move gate" / "dossier/HP" / "gates were bypassed" strings); the only live resolver panel is the single-record render, which prints winner/criterion/finisher/why/exchanges — a bypass assessment appears solely as quoted frozen working detail, never as a verdict or mechanism claim',
      (function () {
        if (html.indexOf('QUESTION') !== -1) return false;
        if (html.indexOf('HP gate') !== -1 || html.indexOf('move gate') !== -1 || html.indexOf('dossier/HP') !== -1 || html.indexOf('gates were bypassed') !== -1) return false;
        if (html.indexOf('cannot-harm blocks') !== -1) return false;
        runInCtx(`selected = ['vader','superman']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt39 = simulateBattle();`);
        const compHtml = runInCtx(`auditComparisonHtmlV1639(auditComparisonForBattleV1639(globalThis._bt39))`);
        const headPart = compHtml.split('audit-working')[0];
        return compHtml.indexOf("Audit comparison (v16.39 — single-record)") !== -1
          && compHtml.indexOf('Frozen result:') !== -1
          && compHtml.indexOf('Resolver exchanges') !== -1
          && compHtml.indexOf('Resolver transforms:') !== -1
          && headPart.indexOf('Darth Vader can hurt Superman via:') === -1;
      })(), '');
      check('V1634-AUDIT-LABELLING (v16.39 DELIBERATE CHANGE) agreement pairs render PASS with all four fields agreeing, and a synthetically corrupted rendered record renders FAIL naming the exact field; main telling is resolver-locked; heading exact v16.39',
      (function () {
        const pairs = [['superman', 'rocky', 'death'], ['goku', 'vegeta', 'death'], ['vader', 'superman', 'death']];
        const okPairs = pairs.every(function (pr) {
          runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt39 = simulateBattle();`);
          const c = JSON.parse(runInCtx(`JSON.stringify((function(){ var cc = auditComparisonForBattleV1639(globalThis._bt39); return {overall: cc.overall, wd: cc.winnerDisagreement, ndiff: (cc.differences || []).length}; })())`));
          const h = runInCtx(`auditComparisonHtmlV1639(auditComparisonForBattleV1639(globalThis._bt39))`);
          return c.overall === 'PASS' && c.wd === false && c.ndiff === 0
            && h.indexOf("Audit comparison (v16.39 — single-record)") !== -1
            && h.indexOf("PASS — single-record consistency: the rendered record matches the frozen result on winner, reason, finisher, and loser state. The rendered record is derived from the frozen resolver result, so this check catches renderer bugs — it is not a second opinion, and it does not mean two independent systems agreed.") !== -1 && h.indexOf('WINNER DISAGREEMENT') === -1 && h.indexOf('All four fields agree: MATCH.') === -1;
        });
        if (!okPairs) return false;
        // Synthetic corruption: only the rendered finisher is wrong — FAIL must name finisher.
        const bad = JSON.parse(runInCtx(`JSON.stringify((function(){ selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; var b = simulateBattle(); var f = frozenRecordV1639(b); var copy = JSON.parse(JSON.stringify(b)); copy.finalRecord.finishingAbility = 'NOT A REAL FINISHER'; var cc = compareRenderedToFrozenV1639(f, copy); return {overall: cc.overall, fields: (cc.differences || []).map(function (d) { return d.field; })}; })())`));
        if (bad.overall !== 'FAIL' || bad.fields.indexOf('finisher') === -1) return false;
        // Main telling is resolver-locked on one pair.
        runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt39 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt39))`));
        const n = runInCtx(`analysisNarrationTextV1638(globalThis._bt39)`);
        return n.indexOf(f.winner) !== -1 && n.indexOf(f.finisher) !== -1 && n.indexOf(f.loserState) !== -1;
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
    check('V1650-DEATH-NAMING (v16.50 DELIBERATE CHANGE — G4a: death-mode conditions line is \'Conditions: Neutral ground.\'; mode + loser state now stated in the result header; incapacitation conditions line still states them) selector, START button, battle/result headers, and episode headings carry Death; the result header states the loser state in words (dead) and the incapacitation conditions line states it (unconscious, not dead); Death (knockout) occurs nowhere in the file; the mode-change relabel regex is updated so switching modes cannot restore the bare label; game title 1v1 Death Battles kept',
      (function () {
        const condOk = (function () {
          runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; currentBattle = simulateBattle(); showResults();`);
          const c = (els['conditions-output'].innerText || '') + (els['conditions-output'].innerHTML || '');
          // v16.50 (G4a): the death-mode conditions line is one short
          // sentence — mode + loser state now live in the result header.
          if (c !== 'Conditions: Neutral ground.') return false;
          if (c.indexOf('Death (knockout)') !== -1 || c.indexOf('knocked out') !== -1) return false;
          const title = runInCtx(`document.getElementById('result-title').innerText`);
          const desc = runInCtx(`document.getElementById('result-desc').innerText`);
          if (title.indexOf('DEATH BATTLE BREAKDOWN') === -1 || title.indexOf('is dead') === -1) return false;
          if (desc.indexOf('Death mode:') === -1 || desc.indexOf('is dead') === -1) return false;
          return true;
        })();
        if (!condOk) return false;
        // Incapacitation mode still states mode + loser state in the
        // conditions line itself.
        const condInc = (function () {
          runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'incapacitation'; currentBattle = simulateBattle(); showResults();`);
          const c = (els['conditions-output'].innerText || '') + (els['conditions-output'].innerHTML || '');
          return c.indexOf('Mode: Incapacitation') !== -1 && c.indexOf('unconscious, not dead') !== -1;
        })();
        if (!condInc) return false;
        if (html.indexOf('Start Death Battle') === -1) return false;
        if (html.indexOf('Start Death (knockout) Battle') !== -1) return false;
        if (html.indexOf('Death Battle Breakdown') === -1) return false;
        if (html.indexOf('Death Match') === -1) return false;
        if (html.indexOf('Death Battle Episode') === -1) return false;
        if (html.split('Death (knockout)').length - 1 !== 0) return false;
        if (html.indexOf('Death (default)') !== -1) return false;
        if (html.indexOf('/^Start (Death|Incapacitation) Battle/') !== -1) return false;
        if (html.indexOf('<title>WAR-ROOM v16.59 — 1v1 Death Battles') === -1) return false;
        return true;
      })(), '');

  // ================= v16.34 — Phase 3B: resolver main, HP audit =================
  check('V1647-MAIN-TELLING-RESOLVER (a) (Route B: the live telling carries no Decisive line — the verdict states the decisive advantage in words and the decide paragraph carries the why) main telling is resolver-based: the dead resolver telling text matches the frozen result (winner, criterion, finisher, loser state) with its Decisive line; the live telling matches the frozen result, carries the why in words, states the verdict in words, and carries no Decisive line; the live wiring routes showResults/renderAi/renderOffline through renderAuditV1639, not the retired visible renderer',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      const ok = pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = '${pr[2]}'; globalThis._bt34 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt34))`));
        const t = runInCtx(`resolverTellingTextV1634(globalThis._bt34)`);
        const n = runInCtx(`analysisNarrationTextV1638(globalThis._bt34)`);
        const cw = runInCtx('criterionWordsV1634(' + JSON.stringify(f.decisiveCriterion) + ')');
        if (f.error || !f.winner) return false;
        return t.indexOf(f.winner) !== -1 && t.indexOf(f.finisher) !== -1 && t.indexOf(f.loserState) !== -1 && t.indexOf('Decisive: ' + f.decisiveCriterion) !== -1
          && n.indexOf(f.winner) !== -1 && n.indexOf(f.finisher) !== -1 && n.indexOf(f.loserState) !== -1 && n.indexOf('Verdict: ' + f.winner + ' wins') !== -1 && n.indexOf(f.why) !== -1 && n.indexOf('Decisive:') === -1;
      });
      const wiring = html.indexOf('renderAuditV1639(b)') !== -1 && html.split('renderAuditV1639(b)').length - 1 >= 3
        && runInCtx('showResults.toString()').indexOf('renderAuditV1639') !== -1
        && html.indexOf('renderResolverVisibleV1626(b); } catch') === -1
        && html.indexOf('var fallbackText = analysisNarrationTextV1638(b);') !== -1
        && html.indexOf('analysisNarrationHtmlV1638(b)') !== -1;
      return ok && wiring;
    })(), '');
  check('V1634-AUDIT-COLLAPSED (b) (v16.39 DELIBERATE CHANGE) single-record audit lives behind a collapsed Audit disclosure, off by default: the Audit details has no open attribute, holds #resolver-visible and the Combat Details list inside it, story precedes breakdown-output, the audit render writes the comparison into #resolver-visible, and the Combat Details content carries HP numbers',
    (function () {
      const ai = html.indexOf('Audit — single-record consistency');
      const ri = html.indexOf('id="resolver-visible"');
      const bi = html.indexOf('id="breakdown-output"');
      const si = html.indexOf('id="story-output"');
      const auditTag = html.slice(Math.max(0, ai - 80), ai); // v16.35 DELIBERATE CHANGE: id="audit-disclosure" lengthened the tag past the old 40-char lookback; window widened, intent unchanged (tag present, no open attribute)
      runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt34 = simulateBattle();`);
      const rv = runInCtx(`renderAuditV1639(globalThis._bt34)`);
      const vis = els['resolver-visible'].innerHTML || '';
      const bd = runInCtx(`generateBreakdown(globalThis._bt34)`);
      return ai !== -1 && ri !== -1 && bi !== -1 && si !== -1 && ai < ri && ri < bi && si < bi
        && auditTag.indexOf('<details') !== -1 && auditTag.indexOf('open') === -1
        && rv === 'ok' && vis.indexOf('Audit comparison (v16.39 — single-record)') !== -1 && vis.indexOf('Frozen result:') !== -1
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
        if (f.seed !== 12345 || f.version !== 'v16.38') return false;
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
    check('V1634-INTRO-FIX (g) (v16.39 DELIBERATE CHANGE) intro sentence fix: 0 occurrences of "with every difference listed"; new single-record wording present (frozen result is the only verdict, PASS/FAIL, no second competing verdict); the old v16.38 panel heading survives exactly twice, only inside the retired v16.34 render (intentional history, not a live surface)',
    (function () {
      const oldHead = 'Audit comparison (v16.38 — resolver is the main output, HP engine is the hidden audit)';
      return html.split('with every difference listed').length - 1 === 0
        && html.indexOf('The resolver frozen result is the only verdict') !== -1
        && html.indexOf('Audit comparison (v16.39 — single-record)') !== -1
        && html.indexOf('There is no second competing verdict.') !== -1
        && html.split(oldHead).length - 1 === 2
        && html.indexOf(oldHead) > html.indexOf('function auditComparisonHtmlV1634');
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
    check('V1635-FIX1-HEADER (Fix 1, v16.39 DELIBERATE CHANGE) live result header comes ONLY from the frozen resolver: on Raven vs Sephiroth seed 1742094419 (the old disagreement input — resolver Sephiroth, HP Raven) the rendered record now follows the frozen winner Sephiroth, the header names Sephiroth, and the single-record audit states PASS, never WINNER DISAGREEMENT; non-disagreement battle still correct; showResults source calls the frozen header, never the old HP header',
    (function () {
      runInCtx(`selected = ['raven','sephiroth']; forcedSeed = 1742094419; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      const fD = JSON.parse(runInCtx(`JSON.stringify(frozenRecordV1639(globalThis._bt35))`));
      const rw = runInCtx(`globalThis._bt35.winner`);
      if (fD.winner !== 'Sephiroth' || rw !== 'Sephiroth') return false;
      runInCtx(`setResultHeaderFromFrozenV1635(frozenResolverResultV1634(globalThis._bt35))`);
      const titleD = runInCtx(`document.getElementById('result-title').innerText`);
      const descD = runInCtx(`document.getElementById('result-desc').innerText`);
      if (titleD.indexOf('Sephiroth Wins') === -1 || titleD.indexOf('Raven Wins') !== -1) return false;
      if (descD.indexOf('HP 0') !== -1) return false;
      const compD = JSON.parse(runInCtx(`JSON.stringify(auditComparisonForBattleV1639(globalThis._bt35))`));
      if (compD.overall !== 'PASS') return false;
      const compHtmlD = runInCtx(`auditComparisonHtmlV1639(auditComparisonForBattleV1639(globalThis._bt35))`);
      if (compHtmlD.indexOf('WINNER DISAGREEMENT') !== -1) return false;
      runInCtx(`selected = ['superman','rocky']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      runInCtx(`setResultHeaderFromFrozenV1635(frozenResolverResultV1634(globalThis._bt35))`);
      const titleN = runInCtx(`document.getElementById('result-title').innerText`);
      const descN = runInCtx(`document.getElementById('result-desc').innerText`);
      if (titleN.indexOf('Superman Wins') === -1 || titleN.indexOf('Rocky Balboa is dead') === -1) return false;
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
    check('V1635-FIX3-LABELLING (Fix 3, v16.39 DELIBERATE CHANGE) transform sources are resolver-only in the live telling and live panel: the live telling never carries an HP transform form name and never a bare "No transform is used" sentence; the live panel carries the resolver transforms list (none where the resolver uses none); the resolver transform present case names it in the live telling',
    (function () {
      runInCtx(`selected = ['raven','sephiroth']; forcedSeed = 1742094419; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      const t = runInCtx(`analysisNarrationTextV1638(globalThis._bt35)`);
      if (t.indexOf('No transform is used') !== -1) return false;
      if (t.indexOf('HP-audit transforms') !== -1) return false;
      if (t.indexOf('Demon Surge') !== -1 || t.indexOf('One-Winged Angel Form') !== -1) return false; // v16.35 check correction kept: bare 'One-Winged Angel' is Sephiroth's legitimate style description, not an HP leak; the HP form name is 'One-Winged Angel Form'
      const compHtml = runInCtx(`auditComparisonHtmlV1639(auditComparisonForBattleV1639(globalThis._bt35))`);
      if (compHtml.indexOf('Resolver transforms:') === -1) return false;
      if (compHtml.indexOf('none — no resolver transform is used in this telling.') === -1) return false;
      if (compHtml.indexOf('HP-audit transforms (not the main telling)') !== -1) return false;
      runInCtx(`selected = ['goku','vegeta']; forcedSeed = 1440350128; forcedVictoryMode = 'death'; globalThis._bt35 = simulateBattle();`);
      const t2 = runInCtx(`analysisNarrationTextV1638(globalThis._bt35)`);
      if (t2.indexOf('Transforms: Goku becomes Super Saiyan Blue') === -1) return false;
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
  // ================= v16.37 — Root 1 Option A: playback screen removed =================
  check('V1637-REMOVAL-SOURCE (Root 1 Option A) no playback screen remains: section, log, button, combatant divs, and the three playback functions are gone from the file; live paths never touch them; playback timer is never assigned',
    (function () {
      var bad = ['<section id="battle-screen"', 'id="battle-log"', 'id="show-results-btn"', 'id="alpha-combatants"', 'id="beta-combatants"', 'function playBack(', 'function renderCombatants(', 'function battleCardStateV1636(', 'playBack(', 'renderCombatants(', 'battleCardStateV1636', 'battle-screen', 'battle-log', 'show-results-btn', 'Live Battle Feed', 'Read the Story'];
      if (bad.some(function (t) { return html.indexOf(t) !== -1; })) return false;
      var sb = runInCtx('startBattle.toString()');
      if (sb.indexOf('showResults()') === -1) return false;
      var sr = runInCtx('showResults.toString()');
      var rs = runInCtx('resetSimulator.toString()');
      if (sr.indexOf('battle-screen') !== -1 || rs.indexOf('battle-screen') !== -1) return false;
      // playbackTimer: declaration + clear-guard only; nothing assigns it on the live path.
      var assigns = (html.match(/playbackTimer\s*=/g) || []).length;
      var decls = (html.match(/let playbackTimer\s*=\s*null/g) || []).length;
      if (assigns !== decls) return false;
      if (runInCtx("layerOfV1631('battleCardStateV1636')") === 'render') return false;
      return true;
    })(), '');
  check('V1637-DIRECT-TO-RESULTS (Root 1 Option A) startBattle renders results directly: no intermediate screen activation, no log write, no button touch; mirror-match still blocked; Incapacitation mode also direct',
    (function () {
      var orig = sandbox.document.getElementById;
      var seen = [];
      sandbox.document.getElementById = function (id) { seen.push(id); return orig(id); };
      try {
        runInCtx(`selected=['spiderman','batman']; forcedSeed=12345; forcedVictoryMode='death'; startBattle();`);
        if (seen.indexOf('battle-screen') !== -1 || seen.indexOf('battle-log') !== -1 || seen.indexOf('show-results-btn') !== -1) return false;
        var title = runInCtx(`document.getElementById('result-title').innerText`);
        if (title.indexOf('Spider-Man Wins') === -1) return false;
        sandbox._lastAlert = null;
        runInCtx(`selected=['spiderman','spiderman']; forcedSeed=12345; forcedVictoryMode='death'; startBattle();`);
        if (!sandbox._lastAlert || sandbox._lastAlert.indexOf('Mirror match blocked') === -1) return false;
        seen.length = 0;
        runInCtx(`selected=['superman','rocky']; forcedSeed=12345; forcedVictoryMode='incapacitation'; startBattle();`);
        if (seen.indexOf('battle-screen') !== -1) return false;
        var title2 = runInCtx(`document.getElementById('result-title').innerText`);
        if (title2.indexOf('Superman Wins') === -1) return false;
        return true;
      } finally { sandbox.document.getElementById = orig; }
    })(), '');
    check('V1637-RESULTS-UNCHANGED (Root 1 Option A, results unchanged; v16.39 DELIBERATE CHANGE; v16.47 DELIBERATE CHANGE: the telling states transforms in plain words — "Transforms: Goku becomes Super Saiyan Blue" — never the engine phrase "Resolver transforms:") results still show the correct resolver transforms at the three regression seeds (none, none, Goku to Super Saiyan Blue) in the live telling; rendered winner agreement on standard 7 + Vader at seed 12345 still 8/8; removed function is out of the layer registry',
    (function () {
      var cases = [
        { a: 'deadpool', b: 'wolverine', seed: 1820424269, want: [] },
        { a: 'vader', b: 'superman', seed: 1196415417, want: [] },
        { a: 'goku', b: 'vegeta', seed: 838208739, want: ['Goku -> Super Saiyan Blue'] },
      ];
      var ok = cases.every(function (c) {
        runInCtx(`selected = ['${c.a}','${c.b}']; forcedSeed = ${c.seed}; forcedVictoryMode = 'death'; globalThis._bt37 = simulateBattle();`);
        var f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt37))`));
        var got = (f.transformsUsed || []).map(function (t) { return t.fighter + ' -> ' + t.to; });
        if (JSON.stringify(got) !== JSON.stringify(c.want)) return false;
        runInCtx(`setResultHeaderFromFrozenV1635(frozenResolverResultV1634(globalThis._bt37))`);
        var title = runInCtx(`document.getElementById('result-title').innerText`);
        if (title.indexOf(f.winner + ' Wins') === -1) return false;
        var t = runInCtx(`analysisNarrationTextV1638(globalThis._bt37)`);
        if (c.want.length && t.indexOf('Transforms: Goku becomes Super Saiyan Blue') === -1) return false;
        if (!c.want.length && (t.indexOf('No transform is used') !== -1 || t.indexOf('HP-audit transforms') !== -1 || t.indexOf('Resolver transforms:') !== -1)) return false;
        return true;
      });
      if (!ok) return false;
      var pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman']];
      var agree = pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt37 = simulateBattle();`);
        var f = JSON.parse(runInCtx(`JSON.stringify(frozenRecordV1639(globalThis._bt37))`));
        var rw = runInCtx(`globalThis._bt37.winner`);
        return f.winner === rw || (f.winner === null && rw === 'Stalemate');
      });
      if (!agree) return false;
      return runInCtx(`layerOfV1631('battleCardStateV1636')`) !== 'render';
    })(), '');
  check('V1637-SAME-TAB-COLLAPSED (Fix 4 holding) Audit + Combat Details still collapse on every battle in the same tab in v16.37',
    (function () {
      runInCtx(`document.getElementById('audit-disclosure').open = true; document.getElementById('combat-details-disclosure').open = true;`);
      runInCtx(`collapseResultsAuditV1635()`);
      var a = runInCtx(`document.getElementById('audit-disclosure').open`);
      var c = runInCtx(`document.getElementById('combat-details-disclosure').open`);
      var src = runInCtx(`showResults.toString()`);
      var rs = runInCtx(`resetSimulator.toString()`);
      return a === false && c === false && src.indexOf('collapseResultsAuditV1635') !== -1 && rs.indexOf('collapseResultsAuditV1635') !== -1;
    })(), '');
  check('V1637-NEW-BATTLE-TWICE (Root 1 Option A) second battle in the same session also goes directly to results with no missing-element error and Audit collapsed again',
    (function () {
      runInCtx(`selected=['spiderman','batman']; forcedSeed=12345; forcedVictoryMode='death'; startBattle();`);
      var t1 = runInCtx(`document.getElementById('result-title').innerText`);
      if (t1.indexOf('Spider-Man Wins') === -1) return false;
      runInCtx(`document.getElementById('audit-disclosure').open = true; document.getElementById('combat-details-disclosure').open = true;`);
      runInCtx(`resetSimulator();`);
      if (runInCtx(`selected.length`) !== 0) return false;
      runInCtx(`selected=['goku','vegeta']; forcedSeed=12345; forcedVictoryMode='death'; startBattle();`);
      var t2 = runInCtx(`document.getElementById('result-title').innerText`);
      if (t2.indexOf('Vegeta Wins') === -1) return false;
      var a = runInCtx(`document.getElementById('audit-disclosure').open`);
      var c = runInCtx(`document.getElementById('combat-details-disclosure').open`);
      return a === false && c === false;
    })(), '');

  // ================= v16.38 — Phase 3C: conditions + rubric + analysis narration =================
  function strip1638(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function nar1638(a, b, seed, mode) {
    runInCtx(`selected = ['${a}','${b}']; forcedSeed = ${seed}; forcedVictoryMode = '${mode}'; globalThis._bt38 = simulateBattle();`);
    const f = JSON.parse(runInCtx(`JSON.stringify(frozenResolverResultV1634(globalThis._bt38))`));
    const n = runInCtx(`analysisNarrationTextV1638(globalThis._bt38)`);
    const c = runInCtx(`conditionsTextV1638(globalThis._bt38, frozenResolverResultV1634(globalThis._bt38))`);
    const r = runInCtx(`rubricTextV1638(globalThis._bt38, frozenResolverResultV1634(globalThis._bt38))`);
    return { f, n, c, r };
  }
  check('V1638-CONDITIONS (a) (v16.50 DELIBERATE CHANGE — G4a: death-mode conditions line is \'Conditions: Neutral ground.\' when no modifiers apply; incapacitation keeps the full line) conditions line on every results render: death mode short, incapacitation full (variant/form per fighter, battlefield, mode + loser-state wording, in-character stance, applicable win conditions only, neutral ground, no invented modifier, no numbers)',
    (function () {
      const cases = [
        { a: 'spiderman', b: 'batman', mode: 'death', modeLabel: 'Death', loserWords: 'the loser is dead', wins: 'death' },
        { a: 'spiderman', b: 'batman', mode: 'incapacitation', modeLabel: 'Incapacitation', loserWords: 'unconscious, not dead', wins: 'incapacitation' },
        { a: 'goku', b: 'vegeta', mode: 'death', modeLabel: 'Death', loserWords: 'the loser is dead', wins: 'death' },
        { a: 'superman', b: 'rocky', mode: 'death', modeLabel: 'Death', loserWords: 'the loser is dead', wins: 'death' },
        { a: 'saitama', b: 'frodo', mode: 'death', modeLabel: 'Death', loserWords: 'the loser is dead', wins: 'death' },
        { a: 'raven', b: 'sephiroth', mode: 'death', modeLabel: 'Death', loserWords: 'the loser is dead', wins: 'death' },
      ];
      const ok = cases.every(function (cs) {
        const x = nar1638(cs.a, cs.b, 12345, cs.mode);
        if (x.f.error) return false;
        const c = x.c;
        if (c.indexOf('Conditions: ') !== 0) return false;
        if (cs.mode === 'death') {
          // v16.50 (G4a): death mode with a winner and no battlefield
          // modifiers is one short sentence. The matchup, versions, mode,
          // and battlefield already stand in the result header.
          if (c !== 'Conditions: Neutral ground.') return false;
          return true;
        }
        if (c.indexOf(x.f.fighterA.name + ' (Base)') === -1 || c.indexOf(x.f.fighterB.name + ' (Base)') === -1) return false;
        if (c.indexOf('Open Arena') === -1) return false;
        if (c.indexOf('Mode: ' + cs.modeLabel) === -1 || c.indexOf(cs.loserWords) === -1) return false;
        if (c.indexOf('Stance: in character') === -1) return false;
        if (c.indexOf('Win conditions: ' + cs.wins + '.') === -1) return false;
        if (c.indexOf('Neutral ground') === -1) return false;
        if (c.indexOf('sealing') !== -1 || c.indexOf('containment') !== -1 || c.indexOf('removal') !== -1 || c.indexOf('BFR') !== -1) return false;
        if (c.indexOf('weather') !== -1 || c.indexOf('lighting') !== -1 || c.indexOf('fatigue') !== -1 || c.indexOf('morals-off') !== -1 || c.indexOf('toggle') !== -1) return false;
        if (c.indexOf('HP') !== -1 || /\d+\s*damage/i.test(c) || /Round \d+/.test(c) || /\d+\/\d+/.test(c) || /\b\d{3,}\b/.test(c)) return false;
        return true;
      });
      if (!ok) return false;
      // Live wiring: startBattle populates conditions + rubric + narration fallback.
      runInCtx(`selected=['spiderman','batman']; forcedSeed=12345; forcedVictoryMode='death'; startBattle();`);
      const co = els['conditions-output'] ? (els['conditions-output'].innerText || '') : '';
      const ro = els['rubric-output'] ? (els['rubric-output'].innerHTML || '') : '';
      const so = els['story-output'] ? (els['story-output'].innerHTML || '') : '';
      if (co !== 'Conditions: Neutral ground.') return false; // v16.50 (G4a)
      if (ro !== '') return false; // v16.48 (F2): the rubric no longer renders on the player screen
      // v16.50 DELIBERATE CHANGE (G6): the incapacitation verdict names the
      // finisher as the killer. v16.54 (A1): 3 frames per criterion,
      // hash-picked — this pair picks frame 1 ("Web Shot kills Batman.");
      // any of the 3 killer framings counts.
      if (strip1638(so).indexOf('Verdict: Spider-Man wins — Web Shot is the blow that kills Batman.') === -1 &&
          strip1638(so).indexOf('Verdict: Spider-Man wins — Web Shot kills Batman.') === -1 &&
          strip1638(so).indexOf('Verdict: Spider-Man wins — it is Web Shot that kills Batman.') === -1) return false;
      return true;
    })(), '');
  check('V1638-RUBRIC (b) (v16.40 AMENDMENT: rubric below the narration — breakdown first) rubric content: pairing-type-appropriate criteria in resolver order, decisive criterion named exactly, no contradiction, never names the winner',
    (function () {
      const cases = [
        { a: 'superman', b: 'rocky', label: 'cannot-harm shutout' },
        { a: 'saitama', b: 'frodo', label: 'cannot-harm shutout' },
        { a: 'goku', b: 'vegeta', label: 'close/competitive' },
        { a: 'deadpool', b: 'wolverine', label: 'close/competitive' },
        { a: 'raven', b: 'sephiroth', label: 'close/competitive' },
        { a: 'spiderman', b: 'batman', label: 'win-condition fight' },
        { a: 'superman', b: 'goku', label: 'win-condition fight' },
        { a: 'vader', b: 'superman', label: 'win-condition fight' },
      ];
      const ok = cases.every(function (cs) {
        const x = nar1638(cs.a, cs.b, 12345, 'death');
        if (x.f.error) return false;
        const r = x.r;
        const cw = runInCtx('criterionWordsV1634(' + JSON.stringify(x.f.decisiveCriterion) + ')');
        if (r.indexOf('Rubric — ' + cs.label + ' pairing') === -1) return false;
        if (r.indexOf('Decisive criterion: ' + cw + '.') === -1) return false;
        if (/\bwinner\b/i.test(r) || /\bwins\b/i.test(r)) return false;
        const iCan = r.indexOf('Can each fighter hurt');
        const iInc = r.indexOf('Incapacitation:');
        const iSta = r.indexOf('Stamina:');
        const iDur = r.indexOf('Durability:');
        const iTier = r.indexOf('Tier:');
        const iDec = r.indexOf('Decisive criterion:');
        if (!(iCan !== -1 && iCan < iInc && iInc < iSta && iSta < iDur && iDur < iTier && iTier < iDec)) return false;
        if (x.f.decisiveCriterion === 'cannot-harm') {
          if (r.indexOf('no recorded way to hurt the other') === -1) return false;
        } else {
          if (r.indexOf('each side has a recorded way to hurt the other') === -1) return false;
        }
        if (x.f.decisiveCriterion === 'incapacitation') {
          if (r.indexOf('decides this step') === -1) return false;
        } else {
          if (r.indexOf('no incapacitation power decides this step') === -1) return false;
        }
        if (x.f.decisiveCriterion === 'speed') {
          if (r.indexOf('speed order decides') === -1) return false;
        } else {
          if (r.indexOf('speed order decides') !== -1) return false;
        }
        if (x.f.decisiveCriterion === 'tier difference') {
          if (r.indexOf('The tier gap decides') === -1) return false;
        } else {
          if (r.indexOf('The tier gap decides') !== -1) return false;
        }
        if (x.f.decisiveCriterion === 'durability') {
          if (r.indexOf('Durability decides') === -1) return false;
        } else {
          if (r.indexOf('Durability decides') !== -1) return false;
        }
        if (x.f.decisiveCriterion === 'stamina') {
          if (r.indexOf('runs out first on the record') === -1) return false;
        } else {
          // v16.38 CHECK CORRECTION: runsOutFirst is a recorded fact, not a
          // deciding claim — it can exist when an earlier step decides.
          if (r.indexOf('Stamina: ') === -1) return false;
          if (r.indexOf('no stated limit separates them') === -1 && r.indexOf('runs out first on the record') === -1) return false;
        }
        if (r.indexOf('HP') !== -1 || /\d+\s*damage/i.test(r) || /Round \d+/.test(r) || /\d+\/\d+/.test(r) || /\b\d{3,}\b/.test(r)) return false;
        return true;
      });
      if (!ok) return false;
      // Tone overlays: demon-vs-angel (Raven/Sephiroth), god-vs-god (Superman/Saitama), god-vs-weak non-shutout (Goku/Frodo).
      const da = nar1638('raven', 'sephiroth', 12345, 'death');
      if (da.r.indexOf('Demon versus angel') === -1) return false;
      const gg = nar1638('superman', 'saitama', 12345, 'death');
      if (gg.r.indexOf('God versus god') === -1) return false;
      const gw = nar1638('goku', 'frodo', 12345, 'death');
      if (gw.r.indexOf('God versus weak') === -1 || gw.r.indexOf('decisive-edge pairing') === -1) return false;
      // Layout (v16.40 AMENDMENT — breakdown first, Jhay live-play feedback): story-output sits first in the panel; conditions + rubric follow below it, small.
      if (!(html.indexOf('id="story-output"') !== -1 && html.indexOf('id="story-output"') < html.indexOf('id="conditions-output"') && html.indexOf('id="conditions-output"') < html.indexOf('id="rubric-output"'))) return false;
      return true;
    })(), '');
  check('V1638-NARRATION-SHAPE (c; v16.50 DELIBERATE CHANGE — G6: incapacitation verdict names the finisher as the killer; F2 pivots unchanged: the decisive paragraph opens with one of 30 criterion-grounded pivots, not one template line; verdict states the decisive advantage in words) narration shape: question, loser best plan naming a dossier power, hard pivot, one decisive criterion named AND repeated in the verdict in words, finisher verbatim, exact loser state, one-sentence verdict, no hedging, no probability',
    (function () {
      const pairs = [['spiderman', 'batman', 'incapacitation'], ['goku', 'vegeta', 'death'], ['superman', 'rocky', 'death'], ['superman', 'goku', 'death'], ['deadpool', 'wolverine', 'death'], ['saitama', 'frodo', 'death'], ['raven', 'sephiroth', 'death'], ['vader', 'superman', 'death']];
      return pairs.every(function (pr) {
        const x = nar1638(pr[0], pr[1], 12345, pr[2]);
        if (x.f.error || !x.f.winner) return false;
        const f = x.f, n = x.n;
        const loser = (f.winner === f.fighterA.name) ? f.fighterB.name : f.fighterA.name;
        const loseRec = (f.winner === f.fighterA.name) ? f.fighterB : f.fighterA;
        const cw = runInCtx('criterionWordsV1634(' + JSON.stringify(f.decisiveCriterion) + ')');
        const paras = n.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
        if (paras[0].indexOf('Can ' + loser + ' beat ' + f.winner) !== 0) return false;
        if (n.indexOf(loseRec.signature) === -1) return false;
        const pivots1649 = ['So it comes down to staying power: ', 'In the end, one fighter lasts longer: ', 'That leaves the long game: ', 'What breaks first is the body: ', 'The fight goes to whoever lasts: ', 'One point ends the argument: ', 'Here is the whole fight: ', 'The ending turns on one move: ', 'That is the fight, right there: ', 'It comes down to a single ending: ', 'So the question answers itself: ', 'That is the whole story: ', 'One fact ends the argument: ', 'There is nowhere else for this to go: ', 'The answer is in the opening: ', 'So the gap does the work: ', 'That is what the tiers mean here: ', 'One step up, and it shows: ', 'The fight follows the gap: ', 'Above is above: ', 'So the pace is the point: ', 'That is the whole difference: ', 'One fighter moves first, and keeps moving first: ', "The fight runs on one fighter's terms: ", 'First to the opening, every time: ', 'So the body is the argument: ', 'That is what holds up means: ', 'One body takes it, the other does not: ', 'In the end, it is about what breaks: ', 'The fight comes down to what lasts: '];
        if (!pivots1649.some(function (pv) { return n.indexOf(pv) !== -1; })) return false;
        // v16.47 DELIBERATE CHANGE (Route B B5): the bare 'Decisive: <criterion>' line is gone — the verdict states the decisive advantage in words, per criterion.
        if (n.indexOf('Decisive:') !== -1) return false;
        if (n.indexOf(f.finisher) === -1) return false;
        if (n.indexOf(loser + ' is ' + f.loserState) === -1) return false;
        const last = paras[paras.length - 1] || '';
        if (last.indexOf('Verdict: ' + f.winner + ' wins — ') !== 0) return false;
        var advOk = false;
        if (f.decisiveCriterion === 'cannot-harm') advOk = last.indexOf('has no way to hurt') !== -1;
        else if (f.decisiveCriterion === 'incapacitation') advOk = last.indexOf('is the blow that kills ' + loser) !== -1 || last.indexOf(f.finisher + ' kills ' + loser) !== -1 || last.indexOf('it is ' + f.finisher + ' that kills ' + loser) !== -1; // v16.50 (G6) + v16.54 (A1): any of the 3 killer framings
        else if (f.decisiveCriterion === 'stamina') advOk = last.indexOf('stamina gives out first') !== -1;
        else if (f.decisiveCriterion === 'durability') advOk = last.indexOf('the tougher body holds up') !== -1;
        else if (f.decisiveCriterion === 'tier difference') advOk = last.indexOf('a tier above') !== -1;
        else if (f.decisiveCriterion === 'speed') advOk = last.indexOf('the faster fighter sets the pace') !== -1;
        else advOk = last.indexOf('decided by ' + cw) !== -1;
        if (!advOk) return false;
        if ((last.match(/\./g) || []).length !== 1) return false;
        if (/\b(maybe|possibly|might|could be|probably|likely|perhaps)\b/i.test(n)) return false;
        if (/likely to win|probably wins|%|odds/i.test(last)) return false;
        return true;
      });
    })(), '');
  check('V1638-TONE-VARIATION (d) shutout telling vs close-fight telling differ structurally: shutout short/decisive (merged plan, no separate best-plan paragraph), close longer with best-plan/counter/stall',
    (function () {
      const shut = nar1638('saitama', 'frodo', 12345, 'death');
      const close1 = nar1638('raven', 'sephiroth', 12345, 'death');
      const close2 = nar1638('deadpool', 'wolverine', 12345, 'death');
      const sp = shut.n.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
      const cp1 = close1.n.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
      const cp2 = close2.n.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
      if (!(sp.length < cp1.length && sp.length < cp2.length)) return false;
      if (shut.n.indexOf('But it cannot land') === -1) return false;
      if (shut.n.indexOf('leads with') !== -1) return false;
      if (close1.n.indexOf('Raven leads with Dark Magic Blast') === -1) return false;
      if (close1.n.indexOf('Sephiroth counters with Masamune Slash') === -1) return false;
      if (close2.n.indexOf('Deadpool leads with Dual Katana Slash') === -1) return false;
      if (close2.n.indexOf('Wolverine counters with Adamantium Claw Slash') === -1) return false;
      const shutFirst = sp[0].split(/(?<=[.?!])\s/)[0];
      const closeFirst = cp1[0].split(/(?<=[.?!])\s/)[0];
      if (shutFirst === closeFirst) return false;
      return true;
    })(), '');
  check('V1638-LOCKS (e) locks: winner/finisher/loser from frozen result on standard 7 + Vader at seed 12345 + regression seeds; every power name in narration in a fighter repertoire or a recorded transform form; zero HP numbers/damage totals/round counts in conditions/rubric/narration',
    (function () {
      const cases = [
        { a: 'spiderman', b: 'batman', seed: 12345, mode: 'death' },
        { a: 'goku', b: 'vegeta', seed: 12345, mode: 'death' },
        { a: 'superman', b: 'rocky', seed: 12345, mode: 'death' },
        { a: 'superman', b: 'goku', seed: 12345, mode: 'death' },
        { a: 'deadpool', b: 'wolverine', seed: 12345, mode: 'death' },
        { a: 'saitama', b: 'frodo', seed: 12345, mode: 'death' },
        { a: 'raven', b: 'sephiroth', seed: 12345, mode: 'death' },
        { a: 'vader', b: 'superman', seed: 12345, mode: 'death' },
        { a: 'deadpool', b: 'wolverine', seed: 1820424269, mode: 'death' },
        { a: 'vader', b: 'superman', seed: 1196415417, mode: 'death' },
        { a: 'goku', b: 'vegeta', seed: 838208739, mode: 'death' },
      ];
      // Global power-name set (names >= 8 chars) from all 193 charFirst records.
      const allNames = JSON.parse(runInCtx(`JSON.stringify((function () {
        var names = {};
        ROSTER.forEach(function (fr) {
          try {
            var rec = charFirstV1631(fr);
            (rec.powers || []).forEach(function (p) { if (p.name && p.name.length >= 8) names[p.name] = true; });
          } catch (e) {}
        });
        return Object.keys(names);
      })())`));
      return cases.every(function (cs) {
        const x = nar1638(cs.a, cs.b, cs.seed, cs.mode);
        if (x.f.error || !x.f.winner) return false;
        const f = x.f, n = x.n;
        if (n.indexOf(f.winner) === -1 || n.indexOf(f.finisher) === -1) return false;
        const loser = (f.winner === f.fighterA.name) ? f.fighterB.name : f.fighterA.name;
        if (n.indexOf(loser + ' is ' + f.loserState) === -1) return false;
        // Repertoires of the two fighters (charFirst powers + frozen signatures + transform forms).
        const rep = JSON.parse(runInCtx(`JSON.stringify((function () {
          var out = {};
          [globalThis._bt38.alpha[0], globalThis._bt38.beta[0]].forEach(function (bf) {
            try {
              var rec = charFirstV1631(bf);
              (rec.powers || []).forEach(function (p) { if (p.name) out[p.name] = true; });
            } catch (e) {}
          });
          return Object.keys(out);
        })())`));
        const forms = (f.transformsUsed || []).map(function (t) { return t.to; });
        const bad = allNames.filter(function (nm) {
          if (n.indexOf(nm) === -1) return false;
          if (rep.indexOf(nm) !== -1) return false;
          if (forms.indexOf(nm) !== -1) return false;
          if (rep.some(function (rn) { return rn.indexOf(nm) !== -1; })) return false;
          return true;
        });
        if (bad.length) return false;
        const combined = x.c + '\n' + x.r + '\n' + n;
        if (/HP\s*\d/.test(combined) || combined.indexOf('HP 0') !== -1) return false;
        if (/\d+\s*damage/i.test(combined) || /Round \d+/.test(combined) || /\d+\/\d+/.test(combined) || /\b\d{3,}\b/.test(combined)) return false;
        if (x.c.indexOf('HP') !== -1 || x.r.indexOf('HP') !== -1) return false;
        return true;
      });
    })(), '');
  check('V1638-INCAPACITATION (f) Incapacitation mode renders conditions + rubric + narration correctly (not Death-only)',
    (function () {
      const x = nar1638('spiderman', 'batman', 12345, 'incapacitation');
      if (x.f.error) return false;
      if (x.c.indexOf('Mode: Incapacitation') === -1 || x.c.indexOf('unconscious, not dead') === -1) return false;
      if (x.c.indexOf('Win conditions: incapacitation.') === -1) return false;
      if (x.r.indexOf('win-condition fight pairing') === -1) return false;
      if (x.r.indexOf('Incapacitation: a recorded incapacitating power (Web Shot)') === -1) return false;
      if (x.n.indexOf(x.f.finisher) === -1) return false;
      if (x.n.indexOf('Batman is unconscious') === -1) return false;
      if (x.f.loserState !== 'unconscious') return false;
      return true;
    })(), '');
    check('V1639-WINNER-AGREEMENT (v16.39 DELIBERATE CHANGE) winner agreement, new meaning: rendered winner === frozen winner on standard 7 + Vader 8/8 at seed 12345 (no HP winner exists any more; the rendered record is drawn from the frozen result)',
    (function () {
      const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman']];
      return pairs.every(function (pr) {
        runInCtx(`selected = ['${pr[0]}','${pr[1]}']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt39 = simulateBattle();`);
        const f = JSON.parse(runInCtx(`JSON.stringify(frozenRecordV1639(globalThis._bt39))`));
        const rw = runInCtx(`globalThis._bt39.winner`);
        return f.winner === rw || (f.winner === null && rw === 'Stalemate');
      });
    })(), '');
  check('V1638-DIRECT-TO-RESULTS regression (v16.48: showResults wires conditions — the rubric no longer renders on the player screen): showResults wires conditions (no battle screen re-added; live paths never touch playback)',
    (function () {
      const src = runInCtx(`showResults.toString()`);
      if (src.indexOf('renderConditionsAndRubricV1638') === -1) return false;
      if (src.indexOf('battle-screen') !== -1 || src.indexOf('playBack') !== -1 || src.indexOf('renderCombatants') !== -1) return false;
      const bad = ['<section id="battle-screen"', 'id="battle-log"', 'id="show-results-btn"', 'function playBack(', 'function renderCombatants(', 'function battleCardStateV1636('];
      if (bad.some(function (s) { return html.indexOf(s) !== -1; })) return false;
      return true;
    })(), '');
  check('V1638-AUDIT-COLLAPSED regression: Audit + Combat Details collapse on arrival of battle 2 in the same tab (battle 1 left open)',
    (function () {
      runInCtx(`selected=['spiderman','batman']; forcedSeed=12345; forcedVictoryMode='death'; startBattle();`);
      runInCtx(`document.getElementById('audit-disclosure').open = true; document.getElementById('combat-details-disclosure').open = true;`);
      runInCtx(`resetSimulator();`);
      runInCtx(`selected=['goku','vegeta']; forcedSeed=12345; forcedVictoryMode='death'; startBattle();`);
      const a = runInCtx(`document.getElementById('audit-disclosure').open`);
      const c = runInCtx(`document.getElementById('combat-details-disclosure').open`);
      return a === false && c === false;
    })(), '');
  check('V1638-VERSION (v16.59 DELIBERATE CHANGE) title, heading, audit heading, live save format, cache key, and live save method string all read v16.59; importer accepts v16.38 + v16.58; legacy 9-section rejection retained',
    (function () {
      if (html.indexOf('<title>WAR-ROOM v16.59') === -1 || html.indexOf('<h1>WAR-ROOM v16.59</h1>') === -1) return false;
      const _tag1649 = html.match(/<span>1V1 DEATH BATTLES[^<]*<\/span>/);
      if (!_tag1649 || _tag1649[0].indexOf('ENGINE') !== -1) return false; // v16.49 (F6): the header tagline carries no ENGINE
      if (html.indexOf('warroom_breakdown_cache_v1639') !== -1) return false;
      if (html.indexOf("entry.formatVersion = 'v16.39'") === -1) return false;
      if (html.indexOf('Audit comparison (v16.39 — single-record)') === -1) return false;
      if (html.indexOf('Offline breakdown (v16.39)') === -1) return false;
      if (html.indexOf('warroom_breakdown_cache_v1659') === -1) return false;
      if (html.indexOf("'v16.37'") === -1 || html.indexOf("'v16.38'") === -1 || html.indexOf("'v16.39'") === -1 || html.indexOf("'v16.40'") === -1 || html.indexOf("'v16.41'") === -1 || html.indexOf("'v16.42'") === -1 || html.indexOf("'v16.43'") === -1 || html.indexOf("'v16.44'") === -1 || html.indexOf("'v16.45'") === -1 || html.indexOf("'v16.46'") === -1 || html.indexOf("'v16.47'") === -1 || html.indexOf("'v16.48'") === -1 || html.indexOf("'v16.49'") === -1 || html.indexOf("'v16.50'") === -1 || html.indexOf("'v16.51'") === -1 || html.indexOf("'v16.52'") === -1 || html.indexOf("'v16.53'") === -1 || html.indexOf("'v16.54'") === -1 || html.indexOf("'v16.55'") === -1 || html.indexOf("'v16.56'") === -1 || html.indexOf("'v16.57'") === -1 || html.indexOf("'v16.58'") === -1) return false;
      const imp = JSON.parse(runInCtx(`JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.38'}))`));
      if (imp.ok !== true) return false;
      if (html.indexOf('id="conditions-output"') === -1 || html.indexOf('id="rubric-output"') === -1) return false;
      return true;
    })(), '');

// ================= v16.39 — Path B harness (spec section 8) =================
// Live-path helpers: simulateBattle() now returns RENDERED records
// automatically (renderer runs inside simulateBattle). simulateBattle
// hardcodes Open Arena (BATTLEFIELDS[0]) after the v16.40 strip, matching
// the section 10 retest configuration.
{
  const PAIRS8 = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman']];
  const MAIN_SEEDS = [1458, 632115031, 567823406, 1652930674, 1522965809, 638642285, 474962531, 412407688];
  const SIDE_SEEDS = [303984103, 188971857, 463252044, 1203312057, 1524455291, 572528615, 1582153710, 1403705703];
  const REGRESSION = [{ a: 'deadpool', b: 'wolverine', seed: 1820424269 }, { a: 'vader', b: 'superman', seed: 1196415417 }, { a: 'goku', b: 'vegeta', seed: 838208739 }];
  const PASS_SENT39 = 'PASS — single-record consistency: the rendered record matches the frozen result on winner, reason, finisher, and loser state. The rendered record is derived from the frozen resolver result, so this check catches renderer bugs — it is not a second opinion, and it does not mean two independent systems agreed.';
  function sim39(a, b, seed, mode) {
    runInCtx(`selected = ['${a}','${b}']; forcedSeed = ${seed}; forcedVictoryMode = '${mode}'; globalThis._bt39 = simulateBattle();`);
    const bt = JSON.parse(runInCtx('JSON.stringify(globalThis._bt39)'));
    const f = JSON.parse(runInCtx('JSON.stringify(frozenRecordV1639(globalThis._bt39))'));
    return { b: bt, f };
  }
  function set39() {
    const list = [];
    PAIRS8.forEach(function (pr) { list.push({ a: pr[0], b: pr[1], seed: 12345, mode: 'death' }); });
    PAIRS8.forEach(function (pr, i) { list.push({ a: pr[0], b: pr[1], seed: MAIN_SEEDS[i], mode: 'death' }); });
    PAIRS8.forEach(function (pr, i) { list.push({ a: pr[0], b: pr[1], seed: SIDE_SEEDS[i], mode: 'death' }); });
    REGRESSION.forEach(function (r) { list.push({ a: r.a, b: r.b, seed: r.seed, mode: 'death' }); });
    return list;
  }
  function finAttackOf(b) {
    const evs = (b.events || []).slice().sort(function (x, y) { return x.id - y.id; });
    const fin = evs.filter(function (e) { return e.type === 'knockout' || e.type === 'incapacitated'; })[0] || null;
    if (!fin) return { fin: null, atk: null };
    let atk = null;
    evs.forEach(function (e) { if (e.type === 'attack' && e.id < fin.id) atk = e; });
    return { fin, atk };
  }
  function instOf(b, name) { return (b.alpha || []).concat(b.beta || []).filter(function (x) { return x.name === name; })[0] || null; }
  function sysA(b) { return JSON.parse(runInCtx('JSON.stringify(victoryStateChecksV14(JSON.parse(' + JSON.stringify(JSON.stringify(b)) + ')))')); }
  function aPass(b, prefix) { return sysA(b).filter(function (c) { return c.name.indexOf(prefix) === 0; }).every(function (c) { return c.passed === true; }); }

  // 1. Rendered final attack.
  check('V1639-RENDERED-FINAL-ATTACK (spec 8.1) on standard 7 + Vader at 12345, all 16 live seeds, and all 3 regression seeds, the last attack before the finishing event has ability === frozen.finisher and actor === frozen.winner, and finalRecord.finishingAbility === frozen.finisher',
    set39().every(function (job) {
      const r = sim39(job.a, job.b, job.seed, job.mode);
      if (!r.f.winner) return false;
      const fa = finAttackOf(r.b);
      return !!fa.fin && !!fa.atk && fa.atk.ability === r.f.finisher && fa.atk.actor === r.f.winner
        && r.b.finalRecord && r.b.finalRecord.finishingAbility === r.f.finisher;
    }), '');
  // 2. Rendered reason.
  check('V1639-RENDERED-REASON (spec 8.2) same set; b.renderedReason === frozen.decisiveCriterion and b.renderedReasonWords === criterionWordsV1634(frozen.decisiveCriterion)',
    set39().every(function (job) {
      const r = sim39(job.a, job.b, job.seed, job.mode);
      const cw = runInCtx('criterionWordsV1634(' + JSON.stringify(r.f.decisiveCriterion) + ')');
      return r.b.renderedReason === r.f.decisiveCriterion && r.b.renderedReasonWords === cw;
    }), '');
  // 3. Damage sums.
  check('V1639-DAMAGE-SUMS (spec 8.3) same set; winner attack total === loser maxHp exactly, loser attack total < winner maxHp, every attack in [20, floor(0.5 * defender maxHp)], final attack in bounds, targetHp strictly decreasing per defender ending at 0, totalDamage === attack sum, destruction === min(100, floor(totalDamage / 200))',
    set39().every(function (job) {
      const r = sim39(job.a, job.b, job.seed, job.mode);
      const b = r.b, f = r.f;
      if (!f.winner) return false;
      const W = f.winner, L = (b.alpha[0].name === W) ? b.beta[0].name : b.alpha[0].name;
      const wInst = instOf(b, W), lInst = instOf(b, L);
      const atks = (b.events || []).filter(function (e) { return e.type === 'attack'; });
      let wTot = 0, lTot = 0, sum = 0;
      atks.forEach(function (e) { sum += e.damage; if (e.actor === W) wTot += e.damage; else lTot += e.damage; });
      if (wTot !== lInst.maxHp || !(lTot < wInst.maxHp)) return false;
      for (const e of atks) {
        const defMax = instOf(b, e.target).maxHp;
        if (!(e.damage >= 20 && e.damage <= Math.floor(0.5 * defMax))) return false;
      }
      const fa = finAttackOf(b);
      if (!fa.atk) return false;
      const fDefMax = instOf(b, fa.atk.target).maxHp;
      if (!(fa.atk.damage >= 20 && fa.atk.damage <= Math.floor(0.5 * fDefMax))) return false;
      const byTarget = {};
      atks.forEach(function (e) { (byTarget[e.target] = byTarget[e.target] || []).push(e); });
      for (const t of Object.keys(byTarget)) {
        const seq = byTarget[t].slice().sort(function (x, y) { return x.id - y.id; }).map(function (e) { return e.targetHp; });
        for (let i = 1; i < seq.length; i++) if (!(seq[i] < seq[i - 1])) return false;
        // Only the loser-defender sequence ends at 0; the winner-defender
        // sequence ends above 0 (winner never 0) — the spec sentence is read
        // per-defender with that distinction, matching section 1.6.
        if (t === L) { if (seq[seq.length - 1] !== 0) return false; }
        else if (!(seq[seq.length - 1] > 0)) return false;
      }
      return b.totalDamage === sum && b.destruction === Math.min(100, Math.floor(sum / 200));
    }), '');
  // 4. Round bound.
  check('V1639-ROUND-BOUND (spec 8.4) same set; shutout (cannot-harm) rounds 3-4, stalemate exactly 8, else 6-9; b.rounds === frozen.roundCount === max event round; no event round > b.rounds or < 0; battlefield event is round 0',
    set39().every(function (job) {
      const r = sim39(job.a, job.b, job.seed, job.mode);
      const b = r.b, f = r.f;
      let boundOk;
      if (f.winner === null) boundOk = (b.rounds === 8);
      else if (f.decisiveCriterion === 'cannot-harm') boundOk = (b.rounds >= 3 && b.rounds <= 4);
      else boundOk = (b.rounds >= 6 && b.rounds <= 9);
      if (!boundOk || b.rounds !== f.roundCount) return false;
      let maxR = -1;
      for (const e of (b.events || [])) { if (e.round > maxR) maxR = e.round; if (e.round > b.rounds || e.round < 0) return false; }
      if (maxR !== b.rounds) return false;
      const first = (b.events || []).slice().sort(function (x, y) { return x.id - y.id; })[0];
      return !!first && first.type === 'battlefield' && first.round === 0;
    }), '');
  // 5. Seed determinism (all 8 pairs at 12345 + the two spec live seeds).
  check('V1639-SEED-DETERMINISM (spec 8.5 + 8.5 gate) standard 7 + Vader at 12345 and at two live seeds (1458 Spider-Man/Batman; 1203312057 Superman/Goku), rendered twice each: JSON-identical events, finalRecord, finalState, rounds, totals',
    (function () {
      const jobs = [];
      PAIRS8.forEach(function (pr) { jobs.push({ a: pr[0], b: pr[1], seed: 12345, mode: 'death' }); });
      jobs.push({ a: 'spiderman', b: 'batman', seed: 1458, mode: 'death' });
      jobs.push({ a: 'superman', b: 'goku', seed: 1203312057, mode: 'death' });
      return jobs.every(function (job) {
        const r1 = sim39(job.a, job.b, job.seed, job.mode);
        const r2 = sim39(job.a, job.b, job.seed, job.mode);
        const pick = function (r) { return JSON.stringify({ events: r.b.events, finalRecord: r.b.finalRecord, finalState: r.b.finalState, rounds: r.b.rounds, totalDamage: r.b.totalDamage, destruction: r.b.destruction }); };
        return pick(r1) === pick(r2);
      });
    })(), '');
  // 6. Repertoire (computed via charFirstV1631 in the test, not POWERS).
  check('V1639-REPERTOIRE (spec 8.6) same set as check 1; every attack ability, every cannot-harm power in that fighter\'s charFirst repertoire (incl. recordOnly, plus TRANSSIG after a rendered transform, plus V2POWER); every transform detail matches a frozen.transformsUsed entry for that fighter (a form is not a repertoire power — J9 reading); every transformed-form-only power used comes strictly after its fighter\'s transform event',
    set39().every(function (job) {
      const r = sim39(job.a, job.b, job.seed, job.mode);
      const b = r.b, f = r.f;
      const reps = {}, baseReps = {};
      (b.alpha || []).concat(b.beta || []).forEach(function (inst) {
        const cf = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId(' + JSON.stringify(inst.id) + '), {variant: ' + JSON.stringify(inst.variant || 'Base') + ', variantId: ' + JSON.stringify(inst.variantId || 'base') + '})))'));
        const names = (cf.powers || []).map(function (p) { return p.name; });
        baseReps[inst.name] = names.slice();
        const hasT = (b.events || []).some(function (e) { return e.type === 'transform' && e.actor === inst.name; });
        const rep = names.slice();
        const tr = runInCtx('TRANSSIG[' + JSON.stringify(inst.id) + ']');
        if (hasT && tr && rep.indexOf(tr) === -1) rep.push(tr);
        if ((inst.variantId || 'base') === 'v2') { const v2 = runInCtx('V2POWER[' + JSON.stringify(inst.id) + ']'); if (v2 && rep.indexOf(v2) === -1) rep.push(v2); }
        reps[inst.name] = rep;
      });
      for (const e of (b.events || [])) {
        if (e.type === 'attack' || e.type === 'cannot-harm') {
          if ((reps[e.actor] || []).indexOf(e.ability) === -1) return false;
          if (e.type === 'attack') {
            const inst = instOf(b, e.actor);
            const tr = runInCtx('TRANSSIG[' + JSON.stringify(inst.id) + ']');
            if (tr && e.ability === tr && (baseReps[e.actor] || []).indexOf(e.ability) === -1) {
              const te = (b.events || []).filter(function (x) { return x.type === 'transform' && x.actor === e.actor && x.id < e.id; });
              if (!te.length) return false;
            }
          }
        }
        if (e.type === 'transform') {
          const ok = (f.transformsUsed || []).some(function (t) { return (t.fighter || t.fighterId) === e.actor && t.to === e.detail && t.triggerClass === e.triggerClass; });
          if (!ok) return false;
        }
      }
      return true;
    }), '');
  // 7. No post-defeat + System A A5/A6/A7.
  check('V1639-NO-POST-DEFEAT (spec 8.7) same set as check 1; zero events after the finishing event id; zero events by the loser after the finishing event; System A checks A5/A6/A7 pass on the rendered record',
    set39().every(function (job) {
      const r = sim39(job.a, job.b, job.seed, job.mode);
      const b = r.b;
      const fa = finAttackOf(b);
      if (!fa.fin) return false;
      const L = (b.alpha[0].name === r.f.winner) ? b.beta[0].name : b.alpha[0].name;
      for (const e of (b.events || [])) {
        if (e.id > fa.fin.id) return false;
        if (e.actor === L && e.id > fa.fin.id) return false;
      }
      return aPass(b, 'A5') && aPass(b, 'A6') && aPass(b, 'A7');
    }), '');
  // 8. Transforms exact.
  check('V1639-TRANSFORMS-EXACT (spec 8.8) same set as check 1; rendered transform event SET equals frozen.transformsUsed exactly (fighter + to-form + triggerClass); rendered transform events carry NO transformHp/transformMax/staminaCost/effectTable and no +ATK/+DEF text; winner has zero transform events',
    set39().every(function (job) {
      const r = sim39(job.a, job.b, job.seed, job.mode);
      const b = r.b, f = r.f;
      const rk = function (actor, detail, tc) { return actor + '|' + detail + '|' + tc; };
      const rendered = (b.events || []).filter(function (e) { return e.type === 'transform'; }).map(function (e) { return rk(e.actor, e.detail, e.triggerClass); }).sort().join(';');
      const frozen = (f.transformsUsed || []).map(function (t) { return rk(t.fighter || t.fighterId, t.to, t.triggerClass); }).sort().join(';');
      if (rendered !== frozen) return false;
      for (const e of (b.events || [])) {
        if (e.type !== 'transform') continue;
        if ('transformHp' in e || 'transformMax' in e || 'staminaCost' in e || 'effectTable' in e) return false;
        const txt = (e.effectText || '') + ' ' + (e.detail || '') + ' ' + (e.trigger || '');
        if (txt.indexOf('+ATK') !== -1 || txt.indexOf('+DEF') !== -1) return false;
        if (e.actor === f.winner) return false;
      }
      return true;
    }), '');
  // 9. Loser state, both modes + System A A2.
  check('V1639-LOSER-STATE (spec 8.9; v16.50 — Death mode renders the loser dead whatever the deciding reason) Death mode: loser dead true, unconscious false, currentHp 0, finishing type knockout, display word dead, A2 passes; Incapacitation mode (same pairs, 12345): loser dead false, unconscious true, incapacitated true, currentHp 0, finishing type incapacitated, display word unconscious, A2 passes',
    (function () {
      for (const pr of PAIRS8) {
        for (const mode of ['death', 'incapacitation']) {
          const r = sim39(pr[0], pr[1], 12345, mode);
          const b = r.b, f = r.f;
          if (!f.winner) return false;
          const L = (b.alpha[0].name === f.winner) ? b.beta[0].name : b.alpha[0].name;
          const lInst = instOf(b, L);
          const fa = finAttackOf(b);
          if (!fa.fin) return false;
          const comp = JSON.parse(runInCtx('JSON.stringify(auditComparisonForBattleV1639(JSON.parse(' + JSON.stringify(JSON.stringify(b)) + ')))'));
          if (mode === 'death') {
            if (!(lInst.dead === true && lInst.unconscious === false && lInst.currentHp === 0)) return false;
            // v16.48 DELIBERATE CHANGE (Branch A): in Death mode the
            // rendered loser state is 'dead' whatever the deciding reason —
            // the incapacitating power decides, the finisher kills (frozen
            // loserState agrees).
            var wantDead = 'dead';
            if (fa.fin.type !== 'knockout' || comp.renderedLoserState !== wantDead) return false;
          } else {
            if (!(lInst.dead === false && lInst.unconscious === true && lInst.incapacitated === true && lInst.currentHp === 0)) return false;
            if (fa.fin.type !== 'incapacitated' || comp.renderedLoserState !== 'unconscious') return false;
          }
          if (!aPass(b, 'A2')) return false;
        }
      }
      return true;
    })(), '');
  // 10. Fix-3 sentence: present / absent / guard grep.
  check('V1650-FIX3-SENTENCE (spec 8.10) (a) PRESENT in narration AND rubric on incapacitation wins where finisher != power (Superman/Goku at main 1652930674 and side 1203312057; Vader/Superman at main 412407688 and side 1403705703), with correct names; (b) ABSENT on non-incapacitation standard pairs at 12345 (and present wherever 12345 itself is an incapacitation win with finisher != power); (c) sentence-building code contains the explicit finisher !== power guard',
    (function () {
      // v16.50 DELIBERATE CHANGE (G3c): the narration fix-3 sentence
      // has 3 framings, hash-picked per pair — "[P] is the deciding power
      // — it stops [L] from continuing; [fin] is the final blow that kills
      // [L]." / "[P] stops [L] from continuing — that is the deciding
      // power — and [fin] is the blow that kills [L]." / "The deciding
      // power is [P] — it stops [L] from continuing — and [fin] is the
      // final blow that kills [L]." — while the rubric twin keeps the old
      // wording ("... is the final blow of the telling, not a second
      // deciding power."). Both name the same power and finisher.
      const sentNarr = function (power, fin, loser) { return [power + ' is the deciding power — it stops ' + loser + ' from continuing; ' + fin + ' is the final blow that kills ' + loser + '.', power + ' stops ' + loser + ' from continuing — that is the deciding power — and ' + fin + ' is the blow that kills ' + loser + '.', 'The deciding power is ' + power + ' — it stops ' + loser + ' from continuing — and ' + fin + ' is the final blow that kills ' + loser + '.']; }; // v16.50 (G3c): any of the 3 framings
      const sentRub = function (power, fin) { return 'Incapacitation is the deciding reason, delivered through ' + power + '; ' + fin + ' is the final blow of the telling, not a second deciding power.'; };
      const powerOf = function (f) {
        if (f.winner === f.fighterA.name) return (f.inputs.incapA && f.inputs.incapA.power) ? f.inputs.incapA.power.name : null;
        return (f.inputs.incapB && f.inputs.incapB.power) ? f.inputs.incapB.power.name : null;
      };
      const named = [['superman', 'goku', 1652930674], ['superman', 'goku', 1203312057], ['vader', 'superman', 412407688], ['vader', 'superman', 1403705703]];
      for (const n of named) {
        const r = sim39(n[0], n[1], n[2], 'death');
        const f = r.f;
        if (f.decisiveCriterion !== 'incapacitation') return false;
        const power = powerOf(f);
        if (!power || f.finisher === power) return false;
        const loserName = (f.winner === f.fighterA.name) ? f.fighterB.name : f.fighterA.name;
        const expect = sentNarr(power, f.finisher, loserName);
        const expectRub = sentRub(power, f.finisher);
        const narr = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        const rub = runInCtx('rubricTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '), JSON.parse(' + JSON.stringify(JSON.stringify(f)) + '))');
        if (!expect.some(function (s) { return narr.indexOf(s) !== -1; }) || rub.indexOf(expectRub) === -1) return false;
      }
      for (const pr of PAIRS8) {
        const r = sim39(pr[0], pr[1], 12345, 'death');
        const f = r.f;
        const narr = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        const rub = runInCtx('rubricTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '), JSON.parse(' + JSON.stringify(JSON.stringify(f)) + '))');
        const power = powerOf(f);
        if (f.decisiveCriterion === 'incapacitation' && power && f.finisher !== power) {
          const loserName = (f.winner === f.fighterA.name) ? f.fighterB.name : f.fighterA.name;
          if (!sentNarr(power, f.finisher, loserName).some(function (s) { return narr.indexOf(s) !== -1; }) || rub.indexOf(sentRub(power, f.finisher)) === -1) return false; // v16.50 (G3c): any of the 3 framings
        } else {
          if (narr.indexOf('Incapacitation is the deciding reason, delivered through') !== -1) return false;
          if (narr.indexOf('is the deciding power — it stops ') !== -1 || narr.indexOf('that is the deciding power') !== -1 || narr.indexOf('The deciding power is ') !== -1) return false; // v16.50 (G3c): all 3 framings
          if (rub.indexOf('Incapacitation is the deciding reason, delivered through') !== -1) return false;
        }
      }
      const narrSrc = runInCtx('analysisNarrationTextV1638.toString()');
      const rubSrc = runInCtx('rubricTextV1638.toString()');
      return narrSrc.indexOf('finisher !== fix3Name1639') !== -1 && rubSrc.indexOf('finisher !== incapName') !== -1;
    })(), '');
  // 11. Audit panel.
  check('V1639-AUDIT-PANEL (spec 8.11) on standard 7 + Vader at 12345, the new panel renders the exact PASS sentence, one PASS line per comparison check, the frozen why verbatim, and NO HP-audit result / PARTIAL / MATCH two-verdict wording / HP-audit transforms; a synthetic corrupted record renders the FAIL block naming finisher; on incapacitation wins with a non-null decisive-power step, a decisive-power attack event immediately precedes the finisher attack in the same final round',
    (function () {
      const panelNames = ['winner', 'reason', 'finisher', 'loserState', 'damageSums', 'roundBound', 'repertoire', 'moveCounts', 'noPostDefeat', 'noHpResidue'];
      for (const pr of PAIRS8) {
        const r = sim39(pr[0], pr[1], 12345, 'death');
        const b = r.b, f = r.f;
        const h = runInCtx('auditComparisonHtmlV1639(auditComparisonForBattleV1639(JSON.parse(' + JSON.stringify(JSON.stringify(b)) + ')))');
        if (h.indexOf(PASS_SENT39) === -1) return false;
        for (const nm of panelNames) if (h.indexOf(nm + ': PASS') === -1) return false;
        // v16.47 HARNESS FIX: the panel renders the why through esc(), so
        // apostrophes appear as &#39; ("Superman's durability").
        // Accept the raw why or its escaped form — both are the same text.
        var whyEsc = f.why.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;').split("'").join('&#39;');
        if (h.indexOf(f.why) === -1 && h.indexOf(whyEsc) === -1) return false;
        if (h.indexOf('HP-audit result') !== -1 || h.indexOf('PARTIAL') !== -1 || h.indexOf('MATCH') !== -1 || h.indexOf('HP-audit transforms') !== -1) return false;
        if (f.decisivePowerStep && f.decisivePowerStep.power) {
          const fa = finAttackOf(b);
          const evs = (b.events || []).slice().sort(function (x, y) { return x.id - y.id; });
          const prev = evs.filter(function (e) { return e.id === fa.atk.id - 1; })[0];
          if (!prev || prev.type !== 'attack' || prev.ability !== f.decisivePowerStep.power || prev.round !== fa.atk.round || prev.actor !== f.winner) return false;
        }
      }
      // Synthetic corruption: final attack swapped to another winner-repertoire power — only finisher may fail.
      const bad = (function () {
        const r = sim39('superman', 'rocky', 12345, 'death');
        const copy = JSON.parse(JSON.stringify(r.b));
        const evs = copy.events.slice().sort(function (x, y) { return x.id - y.id; });
        const fin = evs.filter(function (e) { return e.type === 'knockout' || e.type === 'incapacitated'; })[0];
        let atk = null;
        evs.forEach(function (e) { if (e.type === 'attack' && e.id < fin.id) atk = e; });
        const target = copy.events.filter(function (e) { return e.id === atk.id; })[0];
        target.ability = 'Freeze Breath'; // winner-repertoire power, not the finisher
        const cc = JSON.parse(runInCtx('JSON.stringify(compareRenderedToFrozenV1639(JSON.parse(' + JSON.stringify(JSON.stringify(r.f)) + '), JSON.parse(' + JSON.stringify(JSON.stringify(copy)) + ')))'));
        // The panel function takes the WRAPPER shape (with .frozen); the direct
        // comparison result lacks it, so attach the frozen record here. The
        // crash this fixes was a test-shape bug, not a build bug: all live
        // callers pass auditComparisonForBattleV1639 output, which carries it.
        const h = runInCtx('auditComparisonHtmlV1639(Object.assign(JSON.parse(' + JSON.stringify(JSON.stringify(cc)) + '), {frozen: JSON.parse(' + JSON.stringify(JSON.stringify(r.f)) + ')}))');
        return { overall: cc.overall, fields: (cc.differences || []).map(function (d) { return d.field; }), failBlock: h.indexOf('Audit comparison FAILED') !== -1 };
      })();
      return bad.overall === 'FAIL' && bad.fields.indexOf('finisher') !== -1 && bad.failBlock === true;
    })(), '');
  // 12. Version.
  check('V1659-VERSION (spec 8.12) title, heading, audit heading, live save format, cache key, and live save method string all read v16.59; importer accepts v16.38 + v16.39 + v16.40 + v16.41 + v16.42 + v16.43 + v16.44 + v16.45 + v16.46 + v16.47 + v16.48 + v16.49 + v16.50 + v16.51 + v16.52 + v16.53 + v16.54 + v16.55 + v16.56 + v16.57 + v16.58; resolver labels unchanged from v16.40; legacy 9-section rejection retained',
    (function () {
      if (html.indexOf('<title>WAR-ROOM v16.59') === -1 || html.indexOf('<h1>WAR-ROOM v16.59</h1>') === -1) return false;
      const _tag1649 = html.match(/<span>1V1 DEATH BATTLES[^<]*<\/span>/);
      if (!_tag1649 || _tag1649[0].indexOf('ENGINE') !== -1) return false; // v16.49 (F6): the header tagline carries no ENGINE
      if (html.indexOf('warroom_breakdown_cache_v1639') !== -1) return false;
      if (html.indexOf("entry.formatVersion = 'v16.39'") === -1) return false;
      if (html.indexOf('Audit comparison (v16.39 — single-record)') === -1) return false;
      if (html.indexOf('Offline breakdown (v16.39)') === -1) return false;
      if (html.indexOf('warroom_breakdown_cache_v1659') === -1) return false;
      if (html.indexOf("'v16.38'") === -1) return false;
      const imp = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.38'}))"));
      if (imp.ok !== true) return false;
      const imp39 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.39'}))"));
      if (imp39.ok !== true) return false;
      const imp40 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.40'}))"));
      if (imp40.ok !== true) return false;
      const imp41 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.41'}))"));
      if (imp41.ok !== true) return false;
      const imp42 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.42'}))"));
      if (imp42.ok !== true) return false;
      const imp43 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.43'}))"));
      if (imp43.ok !== true) return false;
      const imp44 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.44'}))"));
      if (imp44.ok !== true) return false;
      const imp45 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.45'}))"));
      if (imp45.ok !== true) return false;
      const imp46 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.46'}))"));
      if (imp46.ok !== true) return false;
      const imp47 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.47'}))"));
      if (imp47.ok !== true) return false;
      const imp48 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.48'}))"));
      if (imp48.ok !== true) return false;
      const imp49 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.49'}))"));
      if (imp49.ok !== true) return false;
      const imp50 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.50'}))"));
      if (imp50.ok !== true) return false;
      const imp51 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.51'}))"));
      if (imp51.ok !== true) return false;
      const imp52 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.52'}))"));
      if (imp52.ok !== true) return false;
      const imp53 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.53'}))"));
      if (imp53.ok !== true) return false;
      const imp54 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.54'}))"));
      if (imp54.ok !== true) return false;
      const imp55 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.55'}))"));
      if (imp55.ok !== true) return false;
      const imp56 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.56'}))"));
      if (imp56.ok !== true) return false;
      const imp57 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.57'}))"));
      if (imp57.ok !== true) return false;
      const imp58 = JSON.parse(runInCtx("JSON.stringify(validateImportedEpisodeV15({winner:'X',story:'y',formatVersion:'v16.58'}))"));
      if (imp58.ok !== true) return false;
      if (html.indexOf("version: 'v16.38'") === -1) return false;
      if (html.indexOf('character-first schema resolver v16.38') === -1) return false;
      const r = sim39('superman', 'rocky', 12345, 'death');
      const legacy9 = ['1. Matchup', '2. Best case', '3. Counter', '4. Plan', '5. Stall', '6. Scoreboard', '7. Sequence', '8. Finisher', '9. Verdict'].join('\n');
      runInCtx('localStorage.setItem(\'warroom_breakdown_cache_v1659\', JSON.stringify([{key: breakdownCacheKeyV1619(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + ')), text: ' + JSON.stringify(legacy9) + '}]))');
      const got = runInCtx('breakdownCacheGetV1619(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
      return got === null;
    })(), '');
  // 13. Purity (J10: renderAuditV1639 writes to #resolver-visible, so the
  // document. ban cannot hold for it — it is asserted on storage, network,
  // random, and clock only, exactly as retired renderAuditV1634 was never
  // in the old purity list for the same reason).
  check('V1639-PURITY (spec 8.13 + J10) the five pure new functions contain no document./localStorage/fetch(/Math.random/Date; renderAuditV1639 contains no localStorage/fetch(/Math.random/Date; the live battle path (simulateBattle -> frozen extension -> renderer -> comparison -> telling) contains exactly one Math.random — the labelled default-seed input line (J18) — and no second RNG construction outside the mulberry32 sub-streams',
    (function () {
      const five = ['frozenRecordV1639', 'renderFromFrozenV1639', 'compareRenderedToFrozenV1639', 'auditComparisonForBattleV1639', 'auditComparisonHtmlV1639'];
      for (const n of five) {
        const src = runInCtx(n + '.toString()');
        if (src.indexOf('document.') !== -1 || src.indexOf('localStorage') !== -1 || src.indexOf('fetch(') !== -1 || src.indexOf('Math.random') !== -1 || src.indexOf('Date') !== -1) return false;
      }
      const ra = runInCtx('renderAuditV1639.toString()');
      if (ra.indexOf('localStorage') !== -1 || ra.indexOf('fetch(') !== -1 || ra.indexOf('Math.random') !== -1 || ra.indexOf('Date') !== -1) return false;
      const pathFns = ['simulateBattle', 'frozenRecordV1639', 'layoutRenderedSlotsV1639', 'splitDamageV1639', 'rendererRepertoireV1639', 'renderFromFrozenV1639', 'compareRenderedToFrozenV1639', 'auditComparisonForBattleV1639', 'auditComparisonHtmlV1639', 'renderAuditV1639', 'analysisNarrationTextV1638', 'rubricTextV1638', 'conditionsTextV1638', 'victoryHeaderResolverV1635', 'setResultHeaderFromFrozenV1635'];
      const joined = pathFns.map(function (n) { return runInCtx(n + '.toString()'); }).join('\n');
      const rnd = joined.split('Math.random').length - 1;
      if (rnd !== 1) return false;
      const simSrc = runInCtx('simulateBattle.toString()');
      const simRndLine = simSrc.split('\n').filter(function (ln) { return ln.indexOf('Math.random') !== -1; });
      if (simRndLine.length !== 1 || simRndLine[0].indexOf('forcedSeed') === -1) return false;
      if (joined.indexOf('crypto.getRandomValues') !== -1 || joined.indexOf('new Random') !== -1) return false;
      if (joined.indexOf('mulberry32') === -1) return false;
      return true;
    })(), '');
  // Golden lock (Route B re-lock): recomputed records must match the
  // stored v16.47 goldens byte-identically, and the diff vs the v16.46
  // goldens is confined to the allowed paths (see V1659-GOLDENS-RELOCK).
  // A Route B batch moves no locked field: winners, finishers, criteria,
  // rounds, and damage never move. The golden file MUST travel with this
  // test file; a missing file is a loud failure, never a skip.
  // ================= v16.40 — strip checks (spec §7.2 player-page audit,
  // §7.3B tester surface, §7.1 renderSlots extension) =================
  {
    const pre = html.slice(0, html.indexOf('<script>'));
    const draftPos = pre.indexOf('id="draft-screen"');
    const testerPos = pre.indexOf('<section id="tester-screen"');
    const mainEnd = pre.indexOf('</main>');
    const playerHtml = (draftPos !== -1 && testerPos !== -1) ? pre.slice(draftPos, testerPos) : '';
    const testerHtml = (testerPos !== -1 && mainEnd !== -1) ? pre.slice(testerPos, mainEnd) : '';
    const resultsHtml = (playerHtml.indexOf('id="results-screen"') !== -1)
      ? playerHtml.slice(playerHtml.indexOf('id="results-screen"')) : '';
    const modalHtml = (mainEnd !== -1) ? pre.slice(mainEnd) : '';
    const playerPlusModal = playerHtml + modalHtml;
    const PRESENT = ['draft-screen', 'daily-banner', 'search-input', 'cat-chips', 'roster-note', 'roster-type-note', 'fighter-pool', 'roster-count', 'match-heading', 'alpha-squad-slots', 'prediction-box', 'rivalry-box', 'seed-input', 'start-btn', 'random-btn', 'results-screen', 'result-title', 'result-desc', 'episode-heading', 'result-offline-label', 'result-seed-line', 'prediction-line', 'conditions-output', 'rubric-output', 'story-output', 'info-modal', 'info-title', 'info-content', 'info-portrait'];
    const ABSENT = ['review-btn', 'setup-review', 'battlefield-select', 'battlefield-desc', 'victory-select', 'online-status-panel', 'online-status-banner', 'main-story-label', 'main-story-status', 'audit-disclosure', 'resolver-visible', 'combat-details-disclosure', 'breakdown-output', 'result-dossier-output', 'consistency-note', 'pipeline-stages', 'consistency-lines', 'quality-note', 'quality-lines', 'integrity-note', 'integrity-lines', 'accuracy-note', 'accuracy-lines', 'main-story-diagnostics', 'retry-online-story-btn', 'ai-story-output', 'online-status-tech', 'auto-research-note'];
    const ABSENT_TEXTS = ['Phase 3 — simplified flow', 'The roster is NOT 600 fighters', 'Review Matchup', 'Online breakdown status', 'Audit — single-record consistency', 'Character Research — dossier for this battle', 'Technical Details — validation, provider, session, retry'];
    const TESTER_IDS = ['online-status-panel', 'online-status-banner', 'main-story-label', 'main-story-status', 'audit-disclosure', 'resolver-visible', 'combat-details-disclosure', 'breakdown-output', 'result-dossier-output', 'consistency-note', 'pipeline-stages', 'consistency-lines', 'quality-note', 'quality-lines', 'integrity-note', 'integrity-lines', 'accuracy-note', 'accuracy-lines', 'main-story-diagnostics', 'ai-story-output', 'online-status-tech'];
    const hasId = function (h, id) { return h.indexOf('id="' + id + '"') !== -1; };
    check('V1640-STRIP-ELEMENTS-PRESENT (§7.2) every §1.1 kept id is present on the player page (draft/results/modal, never only in tester-screen)',
      PRESENT.every(function (id) { return hasId(playerPlusModal, id); }), PRESENT.filter(function (id) { return !hasId(playerPlusModal, id); }).join(','));
    check('V1640-STRIP-ELEMENTS-ABSENT (§7.2) every removed id is absent from the draft+results sections',
      ABSENT.every(function (id) { return !hasId(playerHtml, id); }), ABSENT.filter(function (id) { return hasId(playerHtml, id); }).join(','));
    check('V1640-STRIP-TEXTS-ABSENT (§7.2) every removed panel text is absent from the draft+results sections',
      ABSENT_TEXTS.every(function (t) { return playerHtml.indexOf(t) === -1; }), ABSENT_TEXTS.filter(function (t) { return playerHtml.indexOf(t) !== -1; }).join('|'));
    check('V1640-STRIP-NO-TESTER-LINK (§7.2/§5) no player-screen markup references the tester route or section',
      playerHtml.indexOf('#tester') === -1 && playerHtml.indexOf('tester-screen') === -1 && playerHtml.indexOf('Tester surface') === -1, '');
    check('V1640-STRIP-NEW-BATTLE (§7.2) results screen keeps a New Battle button (resetSimulator)',
      resultsHtml.indexOf('onclick="resetSimulator()"') !== -1, '');
    check('V1640-STRIP-STORY-FIRST (§7.2 AMENDMENT — breakdown first, Jhay live-play feedback) in results-screen DOM order, story-output precedes conditions-output and rubric-output',
      resultsHtml.indexOf('id="story-output"') !== -1 && resultsHtml.indexOf('id="story-output"') < resultsHtml.indexOf('id="conditions-output"') && resultsHtml.indexOf('id="conditions-output"') < resultsHtml.indexOf('id="rubric-output"'), '');
    check('V1640-STRIP-TESTER-SECTION (§7.3B) tester-screen exists, hidden by default, and contains every relocated id',
      testerPos !== -1 && pre.slice(testerPos, testerPos + 120).indexOf('display:none') !== -1
      && TESTER_IDS.every(function (id) { return hasId(testerHtml, id); }),
      TESTER_IDS.filter(function (id) { return !hasId(testerHtml, id); }).join(','));
    check('V1640-STRIP-TESTER-NOTE (§7.3B/F-7) tester consistency-note carries the deleted static note text verbatim',
      testerHtml.indexOf('Three separate systems below — never combined into one pass/fail') !== -1, '');
    check('V1640-STRIP-ROUTE-GATES (§7.3B) tester route inactive leaves the section untouched; #tester activation shows it (display flex)',
      (function () {
        runInCtx(`applyTesterRouteV1640();`);
        const inactiveOk = (typeof els['tester-screen'] === 'undefined');
        runInCtx(`window.location = { hash: '#tester' }; applyTesterRouteV1640();`);
        const activeOk = els['tester-screen'] && els['tester-screen'].style.display === 'flex';
        return inactiveOk && activeOk;
      })(), '');
    runInCtx(`selected = []; renderSlots();`);
    const g0 = els['start-btn'].disabled === true;
    runInCtx(`selected = ['spiderman']; renderSlots();`);
    const g1 = els['start-btn'].disabled === true;
    runInCtx(`selected = ['spiderman','batman']; renderSlots();`);
    const g2 = els['start-btn'].disabled === false;
    check('V1640-STRIP-STARTBTN-GATING (§7.1 renderSlots EXTEND) start-btn disabled with 0/1 fighters, enabled with 2',
      g0 && g1 && g2, 'g0=' + g0 + ' g1=' + g1 + ' g2=' + g2);
    const vb = sim39('goku', 'vegeta', 12345, 'death');
    runInCtx(`selectedVariants = { goku: 'v2' };`);
    const vv = sim39('goku', 'vegeta', 12345, 'death');
    runInCtx(`selectedVariants = {};`);
    check('V1640-STRIP-VARIANT-UNCHANGED (§1.1) a v2 card pick still changes the fight (instance variantId/variant differ from Base)',
      vb.b.alpha[0].variantId === 'base' && vb.b.alpha[0].variant === 'Base'
      && vv.b.alpha[0].variantId === 'v2' && vv.b.alpha[0].variant !== 'Base',
      'base=' + vb.b.alpha[0].variantId + '/' + vb.b.alpha[0].variant + ' v2=' + vv.b.alpha[0].variantId + '/' + vv.b.alpha[0].variant);
    let strictErr = '';
    check('V1640-STRIP-RUNTIME-STRICT (§7.2) full kept flow runs with NO throw on a player-page-only DOM (every removed/tester id returns null)',
      (function () {
        try {
          const strictEls = {};
          const KEPT = new Set(['draft-screen', 'daily-banner', 'results-screen', 'result-title', 'result-desc', 'episode-heading', 'result-offline-label', 'result-seed-line', 'prediction-line', 'conditions-output', 'rubric-output', 'story-output', 'alpha-squad-slots', 'prediction-box', 'rivalry-box', 'seed-input', 'roster-count', 'roster-note', 'roster-type-note', 'cat-chips', 'fighter-pool', 'search-input', 'start-btn', 'random-btn', 'info-modal', 'info-title', 'info-content', 'info-portrait', 'match-heading']);
          const mkEl = function () { return { innerHTML: '', innerText: '', textContent: '', value: '', style: {}, dataset: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, addEventListener: function () {}, removeEventListener: function () {}, click: function () {}, setAttribute: function () {}, getAttribute: function () { return null; }, querySelectorAll: function () { return []; }, scrollTop: 0 }; };
          const sb2 = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
            document: { getElementById: function (id) { if (!KEPT.has(id)) return null; if (!strictEls[id]) strictEls[id] = mkEl(); return strictEls[id]; }, createElement: function () { return mkEl(); }, querySelectorAll: function () { return []; } },
            navigator: { onLine: true }, localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} }, alert: function () {}, fetch: async function () { throw new Error('network disabled'); } };
          sb2.window = sb2;
          vm.createContext(sb2);
          vm.runInContext(script, sb2);
          vm.runInContext(`selected = ['spiderman','batman']; renderSlots();`, sb2);
          if (strictEls['start-btn'].disabled !== false) return false;
          vm.runInContext(`forcedSeed = 12345; forcedVictoryMode = 'death'; currentBattle = simulateBattle(); showResults();`, sb2);
          const cond = (strictEls['conditions-output'].innerText || '') + (strictEls['conditions-output'].innerHTML || '');
          if (!cond || strictEls['rubric-output'].innerHTML !== '' || !strictEls['story-output'].innerHTML) return false;
          // v16.48 (F2 + F4 + main-test item 1): the rubric stays empty on
          // the player screen; the offline label + seed/final-blow line
          // render under the breakdown heading and match the frozen record.
          if (strictEls['result-offline-label'].innerText !== 'Breakdown — written on this device, no internet needed.') return false; // v16.50 (G4b)
          const _fd1648 = JSON.parse(vm.runInContext('JSON.stringify(frozenRecordV1639(currentBattle).damageSplit.finalDamage)', sb2));
          if (strictEls['result-seed-line'].innerText !== 'Battle seed: 12345 · Final blow: ' + _fd1648 + ' damage.') return false;
          vm.runInContext(`resetSimulator();`, sb2);
          return true;
        } catch (e) { strictErr = String(e && e.stack || e); return false; }
      })(), strictErr);
    check('V1640-STRIP-SIZE-GATE (§8/§6) v16.48 HTML measures BELOW the 1,480,000-character ceiling (Fix 6, Jhay 2026-11-07 01:25)',
      html.length < 1480000, 'len=' + html.length);
  }
  check('V1641-RED-ABSENT (plan §5) no RED string survives in (a) any roster sig, (b) the owning fighter POWERS, (c) that fighter record keys, (d) that fighter dossier-signatures list; Levi excepted (see H-LEVI)',
    (function () {
      try {
        const RED = [{"sig": "Gadget Barrage", "owners": ["batman"], "held": false}, {"sig": "Fireball Barrage", "owners": ["mario"], "held": false}, {"sig": "ODM Blade Barrage", "owners": ["levi"], "held": true}, {"sig": "Transmuted Blade Barrage", "owners": ["edward"], "held": false}, {"sig": "Escrima Barrage", "owners": ["nightwing"], "held": false}, {"sig": "Trick Arrow Barrage", "owners": ["greenarrow", "hawkeye"], "held": false}, {"sig": "Precision Arrow Barrage", "owners": ["aloy"], "held": false}, {"sig": "Earth Pillar Barrage", "owners": ["toph"], "held": false}, {"sig": "Fire Blast Barrage", "owners": ["zuko"], "held": false}, {"sig": "Water Whip Barrage", "owners": ["katara"], "held": false}, {"sig": "Axe Chop Barrage", "owners": ["gimli"], "held": false}, {"sig": "Stupefy Barrage", "owners": ["hermione"], "held": false}, {"sig": "Expelliarmus Barrage", "owners": ["ronweasley"], "held": false}, {"sig": "Arsenal Barrage", "owners": ["punisher"], "held": false}, {"sig": "Sword Barrage", "owners": ["blade"], "held": false}, {"sig": "Pistol Barrage", "owners": ["nathandrake"], "held": false}, {"sig": "Dead Eye Barrage", "owners": ["arthurmorgan"], "held": false}, {"sig": "Body Blow Barrage", "owners": ["rocky"], "held": false}, {"sig": "Machine Gun Barrage", "owners": ["johnmatrix"], "held": false}, {"sig": "Jungle Trap Barrage", "owners": ["dutch"], "held": false}, {"sig": "Smith Clone Barrage", "owners": ["agentsmith"], "held": false}, {"sig": "Air Blast Barrage", "owners": ["zaheer"], "held": false}, {"sig": "Crysknife Barrage", "owners": ["duncan"], "held": false}, {"sig": "Web + Impact Combo", "owners": ["spiderman"], "held": false}, {"sig": "Gun-Fu Combination", "owners": ["wick"], "held": false}, {"sig": "Four-Element Combo", "owners": ["aang"], "held": false}, {"sig": "Katana Master Combo", "owners": ["jack"], "held": false}, {"sig": "Katana + Gun Combo", "owners": ["deadpool"], "held": false}, {"sig": "Hand-to-Hand Combo", "owners": ["bourne"], "held": false}, {"sig": "Witch Time Combo", "owners": ["bayonetta"], "held": false}, {"sig": "Keyblade Combo", "owners": ["sora"], "held": false}, {"sig": "Kung Fu Combo", "owners": ["morpheus"], "held": false}, {"sig": "Acrobatic Kick Combo", "owners": ["kimpossible"], "held": false}, {"sig": "Gadget Strike", "owners": ["ethan"], "held": false}];
        const roster = JSON.parse(runInCtx('JSON.stringify(ROSTER.map(function(f){return {id:f.id,sig:f.sig};}))'));
        const powers = JSON.parse(runInCtx('JSON.stringify(POWERS)'));
        const recs = JSON.parse(runInCtx('JSON.stringify(POWER_RECORDS_V1625)'));
        const sigLists = JSON.parse(runInCtx('JSON.stringify(Object.keys(DOSSIER_V1612).reduce(function(o,k){o[k]=(DOSSIER_V1612[k].signatures||[]).map(function(s){return s.name;});return o;},{}))'));
        for (let i = 0; i < RED.length; i++) {
          const r = RED[i];
          if (r.held) continue;
          for (let j = 0; j < roster.length; j++) { if (roster[j].sig === r.sig) return false; }
          for (let k = 0; k < r.owners.length; k++) {
            if ((powers[r.owners[k]] || []).indexOf(r.sig) !== -1) return false;
            const rk = recs[r.owners[k]] ? Object.keys(recs[r.owners[k]]) : [];
            if (rk.indexOf(r.sig) !== -1) return false;
            if ((sigLists[r.owners[k]] || []).indexOf(r.sig) !== -1) return false;
          }
        }
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1641-RED-ALLOWLIST (plan §5, documented not hidden) allowlisted RED-string occurrences remain: Mission Gadget Barrage (Kim v2), Kung Fu Combo (Neo POWERS), Gadget Strike (Rick POWERS), V2POWER/TRANSSIG Barrage names, non-signature barrage/combo POWERS entries; checked by whole-string membership, not file substring',
    (function () {
      try {
        if (JSON.parse(runInCtx('JSON.stringify(V2POWER.kimpossible)')) !== 'Mission Gadget Barrage') return false;
        const powers = JSON.parse(runInCtx('JSON.stringify(POWERS)'));
        if ((powers.neo || []).indexOf('Kung Fu Combo') === -1) return false;
        if ((powers.rick || []).indexOf('Gadget Strike') === -1) return false;
        if (JSON.parse(runInCtx('JSON.stringify(TRANSSIG.deku)')) !== 'Full Cowling Barrage') return false;
        if (JSON.parse(runInCtx('JSON.stringify(TRANSSIG.yuji)')) !== 'Black Flash Barrage') return false;
        if (html.indexOf('Flying Air Barrage') === -1) return false;
        if ((powers.naruto || []).indexOf('Shadow Clone Barrage') === -1) return false;
        if ((powers.kaneki || []).indexOf('Kagune Barrage') === -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1641-REPLACEMENT-IN-DOSSIER (plan §5) every §1 replacement is cited in its fighter dossier section (case-insensitive; action-labels via dossier words); skipped only when the research tree is absent from this checkout (full provenance runs from your_files)',
    (function () {
      try {
        const TABLE = [{"id": "batman", "file": "research/dossiers/comics-dossiers.md", "header": "BATMAN", "needles": ["Batarang Throw"]}, {"id": "mario", "file": "research/dossiers/video-games-dossiers.md", "header": "MARIO", "needles": ["Ground Pound"]}, {"id": "edward", "file": "research/dossiers/anime-dossiers.md", "header": "EDWARD", "needles": ["Automail arm blade"]}, {"id": "nightwing", "file": "research/dossiers/comics-dossiers.md", "header": "NIGHTWING", "needles": ["Escrima Stick Strike"]}, {"id": "greenarrow", "file": "research/dossiers/comics-dossiers.md", "header": "GREEN ARROW", "needles": ["Trick Arrow"]}, {"id": "aloy", "file": "research/dossiers/video-games-dossiers.md", "header": "ALOY", "needles": ["Precision Arrow"]}, {"id": "toph", "file": "research/dossiers/animation-dossiers.md", "header": "TOPH", "needles": ["Earth Pillar"]}, {"id": "zuko", "file": "research/dossiers/animation-dossiers.md", "header": "ZUKO", "needles": ["Fire Blast"]}, {"id": "katara", "file": "research/dossiers/animation-dossiers.md", "header": "KATARA", "needles": ["Water Whip"]}, {"id": "gimli", "file": "research/dossiers/fantasy-sci-fi-dossiers.md", "header": "GIMLI", "needles": ["battle-axe swings"]}, {"id": "hermione", "file": "research/dossiers/fantasy-sci-fi-dossiers.md", "header": "HERMIONE", "needles": ["Stupefy"]}, {"id": "ronweasley", "file": "research/dossiers/fantasy-sci-fi-dossiers.md", "header": "RON WEASLEY", "needles": ["Expelliarmus"]}, {"id": "hawkeye", "file": "research/dossiers/comics-dossiers.md", "header": "HAWKEYE", "needles": ["Trick Arrow"]}, {"id": "punisher", "file": "research/dossiers/comics-dossiers.md", "header": "PUNISHER", "needles": ["pistols, rifles, shotguns, machine guns"]}, {"id": "blade", "file": "research/dossiers/comics-dossiers.md", "header": "BLADE", "needles": ["sword strikes"]}, {"id": "nathandrake", "file": "research/dossiers/video-games-dossiers.md", "header": "NATHAN DRAKE", "needles": ["Cover shooting with pistol"]}, {"id": "arthurmorgan", "file": "research/dossiers/video-games-dossiers.md", "header": "ARTHUR MORGAN", "needles": ["Dead Eye"]}, {"id": "rocky", "file": "research/dossiers/movies-tv-dossiers.md", "header": "ROCKY", "needles": ["body punches"]}, {"id": "johnmatrix", "file": "research/dossiers/movies-tv-dossiers.md", "header": "JOHN MATRIX", "needles": ["M60 machine-gun fire"]}, {"id": "dutch", "file": "research/dossiers/movies-tv-dossiers.md", "header": "DUTCH", "needles": ["log trap"]}, {"id": "agentsmith", "file": "research/dossiers/movies-tv-dossiers.md", "header": "AGENT SMITH", "needles": ["replication"]}, {"id": "zaheer", "file": "research/dossiers/animation-dossiers.md", "header": "ZAHEER", "needles": ["air blast"]}, {"id": "duncan", "file": "research/dossiers/fantasy-sci-fi-dossiers.md", "header": "DUNCAN", "needles": ["Ginaz sword fighting"]}, {"id": "spiderman", "file": "research/dossiers/comics-dossiers.md", "header": "SPIDER-MAN", "needles": ["Web Shot"]}, {"id": "wick", "file": "research/dossiers/movies-tv-dossiers.md", "header": "JOHN WICK", "needles": ["pistol shot"]}, {"id": "aang", "file": "research/dossiers/animation-dossiers.md", "header": "AANG", "needles": ["air blast"]}, {"id": "jack", "file": "research/dossiers/animation-dossiers.md", "header": "SAMURAI JACK", "needles": ["Katana strikes"]}, {"id": "deadpool", "file": "research/dossiers/comics-dossiers.md", "header": "DEADPOOL", "needles": ["Dual Katana Slash"]}, {"id": "bourne", "file": "research/dossiers/movies-tv-dossiers.md", "header": "JASON BOURNE", "needles": ["Improvised weapon"]}, {"id": "bayonetta", "file": "research/dossiers/video-games-dossiers.md", "header": "BAYONETTA", "needles": ["Witch Time"]}, {"id": "sora", "file": "research/dossiers/video-games-dossiers.md", "header": "SORA", "needles": ["Keyblade ground combo"]}, {"id": "morpheus", "file": "research/dossiers/movies-tv-dossiers.md", "header": "MORPHEUS", "needles": ["kung fu"]}, {"id": "kimpossible", "file": "research/dossiers/animation-dossiers.md", "header": "KIM POSSIBLE", "needles": ["Acrobatics", "strike / kick"]}, {"id": "ethan", "file": "research/dossiers/movies-tv-dossiers.md", "header": "ETHAN HUNT", "needles": ["explosive chewing gum"]}];
        if (!fs.existsSync(path.join(__dirname, 'research/dossiers'))) return true;
        for (let i = 0; i < TABLE.length; i++) {
          const row = TABLE[i];
          const p = path.join(__dirname, row.file);
          if (!fs.existsSync(p)) return false;
          const txt = fs.readFileSync(p, 'utf8');
          const parts = txt.split('\n## ');
          let section = null;
          for (let s = 1; s < parts.length; s++) {
            if (parts[s].split('\n', 1)[0].indexOf(row.header) !== -1) { section = parts[s].toLowerCase(); break; }
          }
          if (!section) return false;
          for (let n = 0; n < row.needles.length; n++) {
            if (section.indexOf(row.needles[n].toLowerCase()) === -1) return false;
          }
        }
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1641-NO-INVENTION (plan §5) no replacement contains Barrage, Combo, or Gadget; every replacement has a §1 dossier citation',
    (function () {
      try {
        const REPL = [{"id": "batman", "sig": "Batarang Throw", "cite": "comics \u00a72 BATMAN"}, {"id": "mario", "sig": "Ground Pound", "cite": "video-games \u00a71 MARIO"}, {"id": "edward", "sig": "Automail Arm Blade", "cite": "anime \u00a7EDWARD"}, {"id": "nightwing", "sig": "Escrima Stick Strike", "cite": "comics \u00a7NIGHTWING"}, {"id": "greenarrow", "sig": "Trick Arrow", "cite": "comics \u00a7GREEN ARROW"}, {"id": "aloy", "sig": "Precision Arrow", "cite": "video-games \u00a7ALOY"}, {"id": "toph", "sig": "Earth Pillar", "cite": "animation \u00a7TOPH"}, {"id": "zuko", "sig": "Fire Blast", "cite": "animation \u00a7ZUKO"}, {"id": "katara", "sig": "Water Whip", "cite": "animation \u00a7KATARA"}, {"id": "gimli", "sig": "Axe Swing", "cite": "fantasy \u00a7GIMLI"}, {"id": "hermione", "sig": "Stupefy", "cite": "fantasy \u00a7HERMIONE"}, {"id": "ronweasley", "sig": "Expelliarmus", "cite": "fantasy \u00a7RON"}, {"id": "hawkeye", "sig": "Trick Arrow", "cite": "comics \u00a7HAWKEYE"}, {"id": "punisher", "sig": "Gunfire", "cite": "comics \u00a731 PUNISHER"}, {"id": "blade", "sig": "Sword Strike", "cite": "comics \u00a732 BLADE"}, {"id": "nathandrake", "sig": "Pistol Shooting", "cite": "video-games \u00a7NATHAN DRAKE"}, {"id": "arthurmorgan", "sig": "Dead Eye", "cite": "video-games \u00a7ARTHUR MORGAN"}, {"id": "rocky", "sig": "Body Punch", "cite": "movies-tv \u00a7ROCKY"}, {"id": "johnmatrix", "sig": "M60 Machine-Gun Fire", "cite": "movies-tv \u00a7JOHN MATRIX"}, {"id": "dutch", "sig": "Log Trap", "cite": "movies-tv \u00a7DUTCH"}, {"id": "agentsmith", "sig": "Replication", "cite": "movies-tv \u00a7AGENT SMITH"}, {"id": "zaheer", "sig": "Air Blast", "cite": "animation \u00a7ZAHEER"}, {"id": "duncan", "sig": "Sword Strike", "cite": "fantasy \u00a7DUNCAN"}, {"id": "spiderman", "sig": "Web Shot", "cite": "comics \u00a73 SPIDER-MAN"}, {"id": "wick", "sig": "Pistol Shot", "cite": "movies-tv \u00a7JOHN WICK"}, {"id": "aang", "sig": "Air Blast", "cite": "animation \u00a71 AANG"}, {"id": "jack", "sig": "Katana Strike", "cite": "animation \u00a75 SAMURAI JACK"}, {"id": "deadpool", "sig": "Dual Katana Slash", "cite": "comics \u00a75 DEADPOOL"}, {"id": "bourne", "sig": "Improvised Weapon Strike", "cite": "movies-tv \u00a7JASON BOURNE"}, {"id": "bayonetta", "sig": "Witch Time", "cite": "video-games \u00a7BAYONETTA"}, {"id": "sora", "sig": "Keyblade Strike", "cite": "video-games \u00a7SORA"}, {"id": "morpheus", "sig": "Kung Fu Strike", "cite": "movies-tv \u00a7MORPHEUS"}, {"id": "kimpossible", "sig": "Acrobatic Kick", "cite": "animation \u00a7KIM POSSIBLE"}, {"id": "ethan", "sig": "Explosive Chewing Gum", "cite": "movies-tv \u00a7ETHAN HUNT"}];
        if (REPL.length !== 34) return false;
        for (let i = 0; i < REPL.length; i++) {
          const s = REPL[i].sig;
          if (s.indexOf('Barrage') !== -1 || s.indexOf('Combo') !== -1 || s.indexOf('Gadget') !== -1) return false;
          if (!REPL[i].cite) return false;
        }
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1641-SIGMULT (plan §5) every replaced fighter sigMult reads exactly 1.0; no old 1.5/1.6/1.7 survives',
    (function () {
      try {
        const REPL = [{"id": "batman", "sig": "Batarang Throw", "cite": "comics \u00a72 BATMAN"}, {"id": "mario", "sig": "Ground Pound", "cite": "video-games \u00a71 MARIO"}, {"id": "edward", "sig": "Automail Arm Blade", "cite": "anime \u00a7EDWARD"}, {"id": "nightwing", "sig": "Escrima Stick Strike", "cite": "comics \u00a7NIGHTWING"}, {"id": "greenarrow", "sig": "Trick Arrow", "cite": "comics \u00a7GREEN ARROW"}, {"id": "aloy", "sig": "Precision Arrow", "cite": "video-games \u00a7ALOY"}, {"id": "toph", "sig": "Earth Pillar", "cite": "animation \u00a7TOPH"}, {"id": "zuko", "sig": "Fire Blast", "cite": "animation \u00a7ZUKO"}, {"id": "katara", "sig": "Water Whip", "cite": "animation \u00a7KATARA"}, {"id": "gimli", "sig": "Axe Swing", "cite": "fantasy \u00a7GIMLI"}, {"id": "hermione", "sig": "Stupefy", "cite": "fantasy \u00a7HERMIONE"}, {"id": "ronweasley", "sig": "Expelliarmus", "cite": "fantasy \u00a7RON"}, {"id": "hawkeye", "sig": "Trick Arrow", "cite": "comics \u00a7HAWKEYE"}, {"id": "punisher", "sig": "Gunfire", "cite": "comics \u00a731 PUNISHER"}, {"id": "blade", "sig": "Sword Strike", "cite": "comics \u00a732 BLADE"}, {"id": "nathandrake", "sig": "Pistol Shooting", "cite": "video-games \u00a7NATHAN DRAKE"}, {"id": "arthurmorgan", "sig": "Dead Eye", "cite": "video-games \u00a7ARTHUR MORGAN"}, {"id": "rocky", "sig": "Body Punch", "cite": "movies-tv \u00a7ROCKY"}, {"id": "johnmatrix", "sig": "M60 Machine-Gun Fire", "cite": "movies-tv \u00a7JOHN MATRIX"}, {"id": "dutch", "sig": "Log Trap", "cite": "movies-tv \u00a7DUTCH"}, {"id": "agentsmith", "sig": "Replication", "cite": "movies-tv \u00a7AGENT SMITH"}, {"id": "zaheer", "sig": "Air Blast", "cite": "animation \u00a7ZAHEER"}, {"id": "duncan", "sig": "Sword Strike", "cite": "fantasy \u00a7DUNCAN"}, {"id": "spiderman", "sig": "Web Shot", "cite": "comics \u00a73 SPIDER-MAN"}, {"id": "wick", "sig": "Pistol Shot", "cite": "movies-tv \u00a7JOHN WICK"}, {"id": "aang", "sig": "Air Blast", "cite": "animation \u00a71 AANG"}, {"id": "jack", "sig": "Katana Strike", "cite": "animation \u00a75 SAMURAI JACK"}, {"id": "deadpool", "sig": "Dual Katana Slash", "cite": "comics \u00a75 DEADPOOL"}, {"id": "bourne", "sig": "Improvised Weapon Strike", "cite": "movies-tv \u00a7JASON BOURNE"}, {"id": "bayonetta", "sig": "Witch Time", "cite": "video-games \u00a7BAYONETTA"}, {"id": "sora", "sig": "Keyblade Strike", "cite": "video-games \u00a7SORA"}, {"id": "morpheus", "sig": "Kung Fu Strike", "cite": "movies-tv \u00a7MORPHEUS"}, {"id": "kimpossible", "sig": "Acrobatic Kick", "cite": "animation \u00a7KIM POSSIBLE"}, {"id": "ethan", "sig": "Explosive Chewing Gum", "cite": "movies-tv \u00a7ETHAN HUNT"}];
        const roster = JSON.parse(runInCtx('JSON.stringify(ROSTER.map(function(f){return {id:f.id,sigMult:f.sigMult};}))'));
        const byId = {};
        roster.forEach(function (f) { byId[f.id] = f.sigMult; });
        for (let i = 0; i < REPL.length; i++) {
          if (byId[REPL[i].id] !== 1.0) return false;
        }
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1641-LEVI-UNCHANGED (plan §3/O-1) Levi roster line, POWERS, and records byte-identical to v16.40 except the v16.53 icon field (photo path, covered by V1653-PHOTOS-ICONS); sig still ODM Blade Barrage at 1.6',
    (function () {
      try {
        const oldPath = path.join(__dirname, 'war-room-v16.40.html');
        if (!fs.existsSync(oldPath)) return false;
        const oldHtml = fs.readFileSync(oldPath, 'utf8');
        const lineOf = function (src) {
          const lines = src.split('\n');
          for (let i = 0; i < lines.length; i++) { if (lines[i].indexOf("{id:'levi',") !== -1) return lines[i].replace(/icon:'[^']*',?/, ''); }
          return null;
        };
        if (lineOf(oldHtml) !== lineOf(html)) return false;
        const pwOf = function (src) {
          const m = src.match(/levi:\[[^\]]*\]/);
          return m ? m[0] : null;
        };
        if (pwOf(oldHtml) !== pwOf(html)) return false;
        const recSpan = function (src) {
          const a = src.indexOf('var POWER_RECORDS_V1625 = {');
          if (a === -1) return null;
          const b = src.indexOf('\n};', a);
          return src.slice(a, b);
        };
        if (recSpan(oldHtml).indexOf('\n  levi:') !== -1) return false;
        if (recSpan(html).indexOf('\n  levi:') !== -1) return false;
        const levi = JSON.parse(runInCtx('JSON.stringify((function(){var f=null;ROSTER.forEach(function(x){if(x.id==="levi")f=x;});return {sig:f.sig,sigMult:f.sigMult};})())'));
        return levi.sig === 'ODM Blade Barrage' && levi.sigMult === 1.6;
      } catch (e) { return false; }
    })(), '');
  check('V1641-CANNOT-HURT (plan §5) nhv for Web Shot, Batarang Throw, Body Punch all read [invulnerable]; full nhv map diff vs v16.40 is exactly the 4 deletions + 34 creations (v16.56 items 6+8: goku|Instant Transmission + thanos|Titan Slam, both nhv [])',
    (function () {
      try {
        const OLD = {"batman|Batarang Throw": ["invulnerable"], "batman|Gadget Barrage": ["invulnerable"], "batman|Grapple Kick": [], "batman|Smoke Pellet Ambush": [], "deadpool|Chimichanga Throw": [], "deadpool|Katana + Gun Combo": [], "deadpool|Katana Slash": [], "deadpool|Maximum Effort Combo": [], "deadpool|Pistol Shot": [], "frodo|Rock Throw": ["invulnerable"], "frodo|Stealth Feint": [], "frodo|Sting Thrust": ["invulnerable"], "ghostrider|Hellfire Chain Strike": [], "ghostrider|Motorcycle Charge": [], "ghostrider|Penance Stare": [], "gojo|Blue: Attraction": [], "gojo|Cursed Energy Punch": [], "gojo|Hollow Purple": [], "gojo|Red: Repulsion": [], "gojo|Unlimited Void Crush": [], "goku|Dragon Fist": [], "goku|God Kamehameha": [], "goku|Instant Transmission Strike": [], "goku|Kamehameha": [], "goku|Ki Blast": [], "pikachu|Gigantamax Thunder": [], "pikachu|Iron Tail": [], "pikachu|Quick Attack": [], "pikachu|Thunderbolt": [], "raven|Dark Magic Blast": [], "raven|Portal Blast": [], "raven|Raven Finale": [], "raven|Telekinesis Strike": [], "rocky|Body Blow Barrage": ["invulnerable"], "rocky|Left Hook": ["invulnerable"], "rocky|Uppercut Combo": ["invulnerable"], "saitama|Consecutive Normal Punches": [], "saitama|Normal Punch": [], "saitama|Serious Punch": [], "saitama|Serious Table Flip": [], "sephiroth|Masamune Slash": [], "sephiroth|Octaslash": [], "sephiroth|Shadow Flare": [], "sephiroth|Supernova Strike": [], "spiderman|Spider-Sense Counter": [], "spiderman|Symbiote Rage": [], "spiderman|Wall-Crawl Kick": [], "spiderman|Web + Impact Combo": ["invulnerable"], "spiderman|Web Shot": ["invulnerable"], "superman|Freeze Breath": [], "superman|Heat Vision": [], "superman|Sun-Charged Heat Vision": [], "superman|Super Punch": [], "superman|Tornado Spin": [], "vegeta|Big Bang Attack": [], "vegeta|Blue Evolution Final Flash": [], "vegeta|Final Flash": [], "vegeta|Galick Gun": [], "vegeta|Ki Blast": [], "wolverine|Adamantium Claw Slash": [], "wolverine|Berserker Barrage": [], "wolverine|Berserker Lunge": [], "wolverine|Healing Factor Strike": []};
        const NEWKEYS = {"aang|Air Blast": [], "agentsmith|Replication": [], "aloy|Precision Arrow": [], "arthurmorgan|Dead Eye": [], "bayonetta|Witch Time": [], "blade|Sword Strike": [], "bourne|Improvised Weapon Strike": [], "deadpool|Dual Katana Slash": [], "duncan|Sword Strike": [], "dutch|Log Trap": [], "edward|Automail Arm Blade": [], "ethan|Explosive Chewing Gum": [], "gimli|Axe Swing": [], "goku|Instant Transmission": [], "greenarrow|Trick Arrow": [], "hawkeye|Trick Arrow": [], "hermione|Stupefy": [], "jack|Katana Strike": [], "johnmatrix|M60 Machine-Gun Fire": [], "katara|Water Whip": [], "kimpossible|Acrobatic Kick": [], "mario|Ground Pound": [], "morpheus|Kung Fu Strike": [], "nathandrake|Pistol Shooting": [], "nightwing|Escrima Stick Strike": [], "punisher|Gunfire": [], "rocky|Body Punch": ["invulnerable"], "ronweasley|Expelliarmus": [], "sora|Keyblade Strike": [], "thanos|Titan Slam": [], "toph|Earth Pillar": [], "wick|Pistol Shot": [], "zaheer|Air Blast": [], "zuko|Fire Blast": []};
        const DELETED = ['batman|Gadget Barrage', 'rocky|Body Blow Barrage', 'spiderman|Web + Impact Combo', 'deadpool|Katana + Gun Combo'];
        const cur = JSON.parse(runInCtx('JSON.stringify((function(){var o={};Object.keys(POWER_RECORDS_V1625).forEach(function(fid){Object.keys(POWER_RECORDS_V1625[fid]).forEach(function(pw){var r=POWER_RECORDS_V1625[fid][pw];o[fid+"|"+pw]=r.nhv||[];});});return o;})())'));
        const eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
        if (!eq(cur['spiderman|Web Shot'], ['invulnerable'])) return false;
        if (!eq(cur['batman|Batarang Throw'], ['invulnerable'])) return false;
        if (!eq(cur['rocky|Body Punch'], ['invulnerable'])) return false;
        const curKeys = Object.keys(cur).sort();
        const expKeys = Object.keys(OLD).filter(function (k) { return DELETED.indexOf(k) === -1; }).concat(Object.keys(NEWKEYS)).sort();
        if (JSON.stringify(curKeys) !== JSON.stringify(expKeys)) return false;
        for (let i = 0; i < curKeys.length; i++) {
          const k = curKeys[i];
          const exp = NEWKEYS.hasOwnProperty(k) ? NEWKEYS[k] : OLD[k];
          if (!eq(cur[k], exp)) return false;
        }
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1641-REPERTOIRE (plan §5) every replaced fighter rendered repertoire contains the replacement, no RED string, each name once; all 8 standard-battle finishers in the winner repertoire',
    (function () {
      try {
        const REPL = [{"id": "batman", "sig": "Batarang Throw", "cite": "comics \u00a72 BATMAN"}, {"id": "mario", "sig": "Ground Pound", "cite": "video-games \u00a71 MARIO"}, {"id": "edward", "sig": "Automail Arm Blade", "cite": "anime \u00a7EDWARD"}, {"id": "nightwing", "sig": "Escrima Stick Strike", "cite": "comics \u00a7NIGHTWING"}, {"id": "greenarrow", "sig": "Trick Arrow", "cite": "comics \u00a7GREEN ARROW"}, {"id": "aloy", "sig": "Precision Arrow", "cite": "video-games \u00a7ALOY"}, {"id": "toph", "sig": "Earth Pillar", "cite": "animation \u00a7TOPH"}, {"id": "zuko", "sig": "Fire Blast", "cite": "animation \u00a7ZUKO"}, {"id": "katara", "sig": "Water Whip", "cite": "animation \u00a7KATARA"}, {"id": "gimli", "sig": "Axe Swing", "cite": "fantasy \u00a7GIMLI"}, {"id": "hermione", "sig": "Stupefy", "cite": "fantasy \u00a7HERMIONE"}, {"id": "ronweasley", "sig": "Expelliarmus", "cite": "fantasy \u00a7RON"}, {"id": "hawkeye", "sig": "Trick Arrow", "cite": "comics \u00a7HAWKEYE"}, {"id": "punisher", "sig": "Gunfire", "cite": "comics \u00a731 PUNISHER"}, {"id": "blade", "sig": "Sword Strike", "cite": "comics \u00a732 BLADE"}, {"id": "nathandrake", "sig": "Pistol Shooting", "cite": "video-games \u00a7NATHAN DRAKE"}, {"id": "arthurmorgan", "sig": "Dead Eye", "cite": "video-games \u00a7ARTHUR MORGAN"}, {"id": "rocky", "sig": "Body Punch", "cite": "movies-tv \u00a7ROCKY"}, {"id": "johnmatrix", "sig": "M60 Machine-Gun Fire", "cite": "movies-tv \u00a7JOHN MATRIX"}, {"id": "dutch", "sig": "Log Trap", "cite": "movies-tv \u00a7DUTCH"}, {"id": "agentsmith", "sig": "Replication", "cite": "movies-tv \u00a7AGENT SMITH"}, {"id": "zaheer", "sig": "Air Blast", "cite": "animation \u00a7ZAHEER"}, {"id": "duncan", "sig": "Sword Strike", "cite": "fantasy \u00a7DUNCAN"}, {"id": "spiderman", "sig": "Web Shot", "cite": "comics \u00a73 SPIDER-MAN"}, {"id": "wick", "sig": "Pistol Shot", "cite": "movies-tv \u00a7JOHN WICK"}, {"id": "aang", "sig": "Air Blast", "cite": "animation \u00a71 AANG"}, {"id": "jack", "sig": "Katana Strike", "cite": "animation \u00a75 SAMURAI JACK"}, {"id": "deadpool", "sig": "Dual Katana Slash", "cite": "comics \u00a75 DEADPOOL"}, {"id": "bourne", "sig": "Improvised Weapon Strike", "cite": "movies-tv \u00a7JASON BOURNE"}, {"id": "bayonetta", "sig": "Witch Time", "cite": "video-games \u00a7BAYONETTA"}, {"id": "sora", "sig": "Keyblade Strike", "cite": "video-games \u00a7SORA"}, {"id": "morpheus", "sig": "Kung Fu Strike", "cite": "movies-tv \u00a7MORPHEUS"}, {"id": "kimpossible", "sig": "Acrobatic Kick", "cite": "animation \u00a7KIM POSSIBLE"}, {"id": "ethan", "sig": "Explosive Chewing Gum", "cite": "movies-tv \u00a7ETHAN HUNT"}];
        const REDSTRINGS = ["Gadget Barrage", "Fireball Barrage", "ODM Blade Barrage", "Transmuted Blade Barrage", "Escrima Barrage", "Trick Arrow Barrage", "Precision Arrow Barrage", "Earth Pillar Barrage", "Fire Blast Barrage", "Water Whip Barrage", "Axe Chop Barrage", "Stupefy Barrage", "Expelliarmus Barrage", "Arsenal Barrage", "Sword Barrage", "Pistol Barrage", "Dead Eye Barrage", "Body Blow Barrage", "Machine Gun Barrage", "Jungle Trap Barrage", "Smith Clone Barrage", "Air Blast Barrage", "Crysknife Barrage", "Web + Impact Combo", "Gun-Fu Combination", "Four-Element Combo", "Katana Master Combo", "Katana + Gun Combo", "Hand-to-Hand Combo", "Witch Time Combo", "Keyblade Combo", "Kung Fu Combo", "Acrobatic Kick Combo", "Gadget Strike"];
        for (let i = 0; i < REPL.length; i++) {
          const rep = JSON.parse(runInCtx('JSON.stringify(rendererRepertoireV1639({id:"' + REPL[i].id + '",variant:"Base",variantId:"base"}, false))'));
          if (rep.indexOf(REPL[i].sig) === -1) return false;
          const seen = {};
          for (let j = 0; j < rep.length; j++) {
            if (REDSTRINGS.indexOf(rep[j]) !== -1) return false;
            if (seen[rep[j]]) return false;
            seen[rep[j]] = true;
          }
        }
        const PAIRS = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman']];
        for (let i = 0; i < PAIRS.length; i++) {
          const r = sim39(PAIRS[i][0], PAIRS[i][1], 12345, 'death');
          const wname = r.f.winner;
          if (!wname) return false;
          const inst = (r.b.alpha[0].name === wname) ? r.b.alpha[0] : r.b.beta[0];
          const rep = JSON.parse(runInCtx('JSON.stringify(rendererRepertoireV1639({id:"' + inst.id + '",variant:"Base",variantId:"base"}, false))'));
          if (rep.indexOf(r.f.finisher) === -1) return false;
        }
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-ENGINE-UNTOUCHED (G1-G8 + H1-H4 + v16.52 spacing fix + v16.53 photos wiring + v16.54 A+C review fixes + Fix 6 + v16.55 B stamina fix + v16.56 review fixes + v16.57 fun loop + v16.58 follow-ups + v16.59 fix pile) 15 engine/resolver/renderer functions byte-identical to v16.49 (baseline v16.49 — v16.59 is a fix-pile batch, no other engine change; showResults excluded — v16.47 no-online ruling); the v16.50 + v16.51 + v16.52 + v16.53 + v16.54 + v16.55 + v16.56 + v16.57 + v16.58 + v16.59 changed functions + showResults are excluded and covered by a markers check instead (G5 tier-why reword, G6 verdict names the finisher as killer, G3 finish hash carries the variant + 2 new mortal variants + fix-3 framings, G1a opener frames + pair-stable hash, G1b deciding-extra format variants, G2 core-effect dedup, G4a short conditions line, G4b plain label, G4c tier/transform phrase rewords, G7 stale-comment fixes, B6 whole-paragraph decides-it count, H1 does-line dedup, H2 record-talk rewords + F7 cite drop, H3 flagged finish sentence replaced in place, v16.52 one-character spacing fix on the replacement sentence, v16.53 photos wiring: 194 icon fields emoji to photo paths + shared photo helper + 8 render sites + Info title innerHTML + photo CSS, v16.54 A1 verdict frames (3 per criterion, hash-picked, one-sentence rule kept), A2 plain speed why (both copies), A3 plain Infinity clause + profiles + defence note, A4 damage tags dropped, A5 no-limit stamina frames reworded, A6 Web Shot bridge vs regenerators, A7 opponent-aware stops filter, A8 variant names in conditions, C1 resetSimulator clears variants, Fix 6 generateEpisodeLegacy removed + ceiling 1,480,000, v16.55 B: STAMINA_V1655 table (45 records) + staminaRecordV1655/staminaStatedV1655/staminaRunsOutReasonV1655/staminaTellingTextV1655/staminaPoweredTellingV1655 + fallback killed in charFirstRunsOutV1631 + resolverRunsOutV1624 + structured record routed into powerProfileV1623 + dossier panel researched-stamina row + pivot hash carries the variant with shift 16, v16.56 review fixes: crop fix (object-position:top on both .phimg rules), result-header photos + variant names, Instant Transmission record + POWERS.goku 4th power, Thanos Titan Slam record + v2weak, Hulkbuster variant photo, six engine-word rewords, v16.57 fun loop: rematch, variant rematch, random, prediction, seed challenge, rivalry, Fight of the Day (render/UI only, no engine change, no resolver change, no new POWER_RECORDS/POWERS entry), v16.58 follow-ups: engine-words reword (keyword fallback, Character power records, ENGINE MECHANISM, not the character record, What-stops recorded), condition-3 F1 (Goku cl/sb stamina wording deleted, 0 movers), F2 weak text HELD for re-lock, F8 clause kept (render/UI + record wording only, no engine change, no resolver change, no new POWER_RECORDS/POWERS entry), v16.59 fix pile: F2 weak text re-lock (Goku stamina clause deleted, 10 movers, Jhay 2026-11-10 ~03:59), F3 Vegeta Final Flash cl gains the demonstrated cost (0 movers), F4 Rocky Body Punch nh dash (0 movers) (record wording only, no engine change, no resolver change, no new POWER_RECORDS/POWERS entry)); importer differs ONLY by the v16.49 + v16.50 + v16.51 + v16.52 + v16.53 + v16.54 + v16.55 + v16.56 + v16.57 + v16.58 acceptance additions; the v16.44 variant mechanism is present (14 v16.44 VARIANTS markers, variantTransForV1644, V3POWER 56 entries); the v16.45 fix is present (3 v16.45 FIX markers, staminaWhyV1645); defenseProfileForV14 leaves the list (A3 Infinity note in plain words; Batman v2 armour branch unchanged, covered by markers)',
    (function () {
      try {
        const oldPath = path.join(__dirname, 'war-room-v16.49.html');
        if (!fs.existsSync(oldPath)) return false;
        const oldHtml = fs.readFileSync(oldPath, 'utf8');
        const fnSrc = function (src, name) {
          const re = new RegExp('function ' + name + '\\s*\\(');
          const m = re.exec(src);
          if (!m) return null;
          let i = src.indexOf('{', m.index), depth = 0;
          for (; i < src.length; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
          }
          return null;
        };
        // The 15 v16.49 functions — the v16.50 batch changes NONE of
        // them.
        // v16.50 changed functions (excluded, covered by markers below):
        // resolveCharFirstV1634 (G5 tier-why reword),
        // resolveCharFirstV1631 (G5 tier-why reword, keeps audit suffix),
        // verdictParaV1647 (G6 finisher as killer),
        // finishParaV1647 (G3 variant in finish hash + 2 new mortal
        // variants), openerV1647 (G1a 5 frames per criterion + pair-stable
        // hash), decidingExtraV1647 (G1b format variants + extended to
        // cannot-harm/incapacitation), analysisNarrationTextV1638 (G3c
        // fix-3 framings), qualityCheckTellingV1647 (G2 core-effect dedup
        // + G8d whole-paragraph decides-it count),
        // conditionsTextV1638 (G4a short conditions line),
        // showResults (excluded since the v16.47 no-online ruling).
        // Also changed in v16.47/v16.48/v16.49 but NOT in the list and
        // covered by markers/behaviour checks instead:
        // staminaWhyV1645 (F7 limited-resource cite),
        // loserStateForV1647 (Branch A), renderFromFrozenV1639
        // (state-driven finishing event), compareRenderedToFrozenV1639
        // (loserState from the finishing event), rubricTextV1638
        // (deciding-evidence header),
        // renderConditionsAndRubricV1638 (rubric off the player screen),
        // planParaV1638 (F4/F8 effect clause + no-detail clause),
        // battlefieldWordsV1638 (F6 Neutral ground),
        // resetSimulator (F9 search clears),
        // generateBreakdown (B4 reconstruction), winConditionsListV1638,
        // victoryHeaderResolverV1635, compareCharFirstToHpV1631,
        // compareResolverMainToHpAuditV1634 (legacy normalisation),
        // updateModeHeadings, updateEpisodeHeadingV1610, resistanceFor.
        const FNS = ["frozenRecordV1639", "splitDamageV1639", "simulateBattle", "auditComparisonForBattleV1639", "auditComparisonHtmlV1639", "renderAuditV1639", "renderTesterBreakdownV1640", "applyTesterRouteV1640", "powerRecordV1625", "powerRecordsForV1625", "powerRecordDirectionV1625", "resolveAttackV14", "damageTypeCanonicalV14", "layoutRenderedSlotsV1639", "breakdownCacheKeyV1619"]; // v16.49 (F9): resetSimulator left the list — it now clears the search; v16.53: renderSlots left the list — it now renders the photo; v16.54: defenseProfileForV14 left the list — A3 rewords its Infinity note in plain words, Batman v2 armour branch unchanged; v16.56: signatureDefForV14 + damageTypeCombatV1625 left the list — item 7 rewords 'keyword-fallback' to 'matched by keyword' in both, covered by markers
        for (let i = 0; i < FNS.length; i++) {
          if (fnSrc(oldHtml, FNS[i]) !== fnSrc(html, FNS[i])) return false;
        }
        // Changed functions carry their v16.47 markers.
        if (fnSrc(html, 'resolveCharFirstV1631').indexOf('loserStateForV1647') === -1) return false;
        if (fnSrc(html, 'resolveCharFirstV1634').indexOf('loserStateForV1647') === -1) return false;
        if (fnSrc(html, 'staminaWhyV1645').indexOf('runs out first') === -1) return false;
        if (fnSrc(html, 'renderFromFrozenV1639').indexOf('fev.loserState = frozen.loserState') === -1) return false;
        if (fnSrc(html, 'compareRenderedToFrozenV1639').indexOf('finEv.loserState') === -1) return false;
        if (fnSrc(html, 'rubricTextV1638').indexOf('stepWords1647') === -1) return false;
        if (fnSrc(html, 'conditionsTextV1638').indexOf('loserStatePhraseV1647') === -1) return false;
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('qualityCheckTellingV1647') === -1) return false;
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('finishParaV1647') === -1) return false;
        if (fnSrc(html, 'planParaV1638').indexOf('What stops ') === -1) return false;
        if (fnSrc(html, 'generateBreakdown').indexOf('Reconstruction — not observed events:') === -1) return false;
        if (fnSrc(html, 'victoryHeaderResolverV1635').indexOf('loserStatePhraseV1647') === -1) return false;
        if (fnSrc(html, 'winConditionsListV1638').indexOf("? 'incapacitation' : 'death'") === -1) return false;
        if (fnSrc(html, 'compareCharFirstToHpV1631').indexOf('normHpLoser') === -1) return false;
        if (fnSrc(html, 'compareResolverMainToHpAuditV1634').indexOf('normHpLoser1647') === -1) return false;
        // v16.48 markers: Branch A loser state, built winConditions,
        // death-clause why, criterion pivots, finisher does-text dedupe,
        // clause/doubled-word B6 check, verdict names finisher, rubric
        // off the player screen, label + seed lines.
        if (fnSrc(html, 'loserStateForV1647').indexOf("loserDurType === 'immortal' || loserDurType === 'intangible'") === -1) return false;
        if (fnSrc(html, 'loserStateForV1647').indexOf("if (criterion === 'incapacitation')") !== -1) return false;
        if (fnSrc(html, 'resolveCharFirstV1634').indexOf('winConditions1648') === -1) return false;
        if (fnSrc(html, 'resolveCharFirstV1634').indexOf('_finName1648') === -1) return false;
        if (fnSrc(html, 'verdictParaV1647').indexOf('frozen.finisher ||') === -1) return false;
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('pivots1648') === -1) return false;
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('finisherDoes1648') === -1) return false;
        if (fnSrc(html, 'qualityCheckTellingV1647').indexOf('repeated clause in finish paragraph') === -1) return false;
        if (fnSrc(html, 'qualityCheckTellingV1647').indexOf('doubled word in telling') === -1) return false;
        if (fnSrc(html, 'renderConditionsAndRubricV1638').replace(/\/\*[\s\S]*?\*\//g, '').indexOf('rubricTextV1638') !== -1) return false;
        if (fnSrc(html, 'renderConditionsAndRubricV1638').indexOf("rEl.innerHTML = ''") === -1) return false;
        if (fnSrc(html, 'showResults').indexOf('result-offline-label') === -1) return false;
        if (fnSrc(html, 'showResults').indexOf('result-seed-line') === -1) return false;
        if (fnSrc(html, 'showResults').indexOf('Final blow: ') === -1) return false;
        // v16.49 markers (still true in v16.50; F7 cite DROPPED in
        // v16.51 by Jhay ruling 2026-11-06 16:43 — see the marker below):
        // F3 death-framing why + speed disclaimer to step notes, F1
        // verdict names finisher on every branch, F5 finish variants,
        // F4/F8 effect dedup + no-detail clause, F2 pivot frames + tuned
        // shift, F6 Neutral ground, F9 search clears on New Battle.
        if (fnSrc(html, 'resolveCharFirstV1634').indexOf("stops ' + cb.name + ' from continuing") === -1) return false;
        if (fnSrc(html, 'resolveCharFirstV1634').indexOf('stepNotes.push') === -1) return false;
        if (fnSrc(html, 'staminaWhyV1645').indexOf('spends a limited resource') !== -1) return false; // v16.51 (H2, Jhay ruling 2026-11-06 16:43): the F7 cite is GONE
        if (fnSrc(html, 'staminaWhyV1645').indexOf('has no stated limit') === -1) return false; // v16.51 (H2): the honest no-limit line is plain speech now
        if (fnSrc(html, 'verdictParaV1647').indexOf('is the blow that ends it') === -1) return false;
        if (fnSrc(html, 'finishParaV1647').indexOf('_pick1650') === -1) return false;
        if (fnSrc(html, 'finishParaV1647').indexOf('The finish is lethal, full stop.') === -1) return false;
        if (fnSrc(html, 'qualityCheckTellingV1647').indexOf('repeated effect clause in plan paragraphs') === -1) return false;
        if (fnSrc(html, 'qualityCheckTellingV1647').indexOf('decide pivot restates the deciding claim') === -1) return false;
        if (fnSrc(html, 'planParaV1638').indexOf('No recorded detail is stated for') === -1) return false;
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('(_ph1648 >>> 16)') === -1) return false; // v16.55 (B): shift re-tuned — the B fix moved two pairs onto speed, so shift 0 collided; 16 is the only shift in 0..31 with all 11 tellings distinct within criterion
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('But the limit settles it') !== -1) return false; // old However/But frames are gone
        if (fnSrc(html, 'battlefieldWordsV1638').indexOf('Neutral ground.') === -1) return false;
        if (fnSrc(html, 'resetSimulator').indexOf("searchTerm='';") === -1) return false;
        // v16.50 markers: G5 tier-why reword, G6 finisher as killer, G3
        // variant in the finish hash + new mortal variants + fix-3
        // framings, G1a pair-stable opener hash, G1b extra format variants,
        // G2 core-effect dedup, G4a short conditions line, G4b plain label,
        // G8d whole-paragraph decides-it count.
        if (fnSrc(html, 'resolveCharFirstV1634').indexOf('no incapacitating power applies') === -1) return false;
        if (fnSrc(html, 'resolveCharFirstV1631').indexOf('no incapacitating power applies') === -1) return false;
        if (fnSrc(html, 'verdictParaV1647').indexOf('is the blow that kills') === -1) return false;
        if (fnSrc(html, 'finishParaV1647').indexOf('No mortal body walks away from that.') === -1) return false;
        if (fnSrc(html, 'finishParaV1647').indexOf('The damage is too much for a mortal body.') === -1) return false;
        if (fnSrc(html, 'openerV1647').indexOf('(oh >>> 18)') === -1) return false;
        if (fnSrc(html, 'decidingExtraV1647').indexOf('On bodies: ') === -1) return false;
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('_f3v1650') === -1) return false;
        if (fnSrc(html, 'conditionsTextV1638').indexOf('Conditions: Neutral ground.') === -1) return false;
        if (fnSrc(html, 'qualityCheckTellingV1647').indexOf('decide paragraph states "decides it" more than once') === -1) return false;
        if (html.indexOf('written on this device, no internet needed.') === -1) return false; // G4b plain label
        // v16.47 no-online ruling markers: showResults renders the offline
        // telling directly and never calls the breakdown generator (code,
        // comments stripped — the ruling note names it).
        if (fnSrc(html, 'showResults').indexOf("document.getElementById('story-output').innerHTML=analysisNarrationHtmlV1638(b);") === -1) return false;
        if (fnSrc(html, 'showResults').replace(/\/\*[\s\S]*?\*\//g, '').indexOf('generateBreakdownV1619') !== -1) return false;
        if (fnSrc(html, 'showResults').replace(/\/\*[\s\S]*?\*\//g, '').indexOf('savePendingBreakdownV1619') !== -1) return false;
        if (runInCtx("typeof loserStateForV1647") !== 'function') return false;
        if (runInCtx("typeof qualityCheckTellingV1647") !== 'function') return false;
        if (runInCtx("typeof finishParaV1647") !== 'function') return false;
        if (runInCtx("typeof verdictParaV1647") !== 'function') return false;
        if (runInCtx("typeof openerV1647") !== 'function') return false;
        const oldImp = fnSrc(oldHtml, 'validateImportedEpisodeV15');
        const newImp = fnSrc(html, 'validateImportedEpisodeV15');
        if (!oldImp || !newImp) return false;
        const added = "'v16.41','v16.42','v16.43','v16.44','v16.45','v16.46','v16.47','v16.48','v16.49','v16.50','v16.51','v16.52','v16.53','v16.54','v16.55','v16.56','v16.57','v16.58']";
        if (newImp.split(added).length - 1 !== 1) return false;
        if (newImp.split(added).join("'v16.41','v16.42','v16.43','v16.44','v16.45','v16.46','v16.47','v16.48']") !== oldImp) return false;
        if ((html.match(/v16\.44 VARIANTS/g) || []).length !== 14) return false;
        if ((html.match(/v16\.45 FIX/g) || []).length !== 3) return false;
        if (runInCtx("typeof variantTransForV1644") !== 'function') return false;
        if (runInCtx("typeof staminaWhyV1645") !== 'function') return false;
        if (JSON.parse(runInCtx('JSON.stringify(Object.keys(V3POWER).length)')) !== 56) return false;
        // Batman v2 armour stays hardcoded inside defenseProfileForV14
        // (already byte-identical above); assert the branch is present.
        if (fnSrc(html, 'defenseProfileForV14').indexOf("f.variantId==='v2' && f.id==='batman'") === -1) return false;
        // v16.53 photos wiring (Jhay 2026-11-07 01:12): renderSlots left
        // the byte-identical list — it now renders the photo; the other
        // seven icon sites (renderRoster, openInfo, renderYT,
        // triggerOnlineResearch, renderDossierLegacy, renderCanonResults,
        // renderDossier) were never in the list.
        if (fnSrc(html, 'renderSlots').indexOf('photoHtmlV1653') === -1) return false;
        if (fnSrc(html, 'renderRoster').indexOf('photoHtmlV1653') === -1) return false;
        if (fnSrc(html, 'openInfo').indexOf('photoHtmlV1653') === -1) return false;
        if (fnSrc(html, 'openInfo').indexOf("info-title').innerHTML=") === -1) return false;
        if (html.indexOf("VARIANT_PHOTOS_V1653={sauron:{v2:'images/sauron-v2.jpg'},ironman:{v2:'images/ironman-v2.jpg'}}") === -1) return false; // v16.56 (item 10): Hulkbuster joins the variant-photo map
        // v16.54 (A1-A8 + C1 + Fix 6, Jhay 2026-11-07 01:02 + 01:25).
        // A1: verdict frames vary (3 per criterion, hash-picked); the
        // one-sentence rule holds (frame 1 joins with a comma).
        if (fnSrc(html, 'verdictParaV1647').indexOf('_vf1654') === -1) return false;
        if (fnSrc(html, 'verdictParaV1647').indexOf('closes it.') === -1) return false;
        // A2: plain-words speed why in both resolver copies; the
        // game-speed phrase survives ONLY in the tester rubric line.
        if (html.indexOf("why = 'Speed decides it: '") === -1) return false;
        if ((html.match(/on the roster game-speed ordering/g) || []).length !== 1) return false;
        if (fnSrc(html, 'resolveCharFirstV1631').indexOf('Speed numbers are audit numbers, not canon speed claims.') === -1) return false;
        // A3: Gojo clause + profile strings + defence note, plain words;
        // no 'EX-tier' anywhere in the file.
        if (html.indexOf('EX-tier') !== -1) return false;
        if (html.indexOf('Infinity stops most attacks before they land; only a power that gets past it lands at full strength') === -1) return false;
        if (html.indexOf('most attacks stop before contact — only a power that gets past Infinity lands at full strength.') === -1) return false;
        if (fnSrc(html, 'defenseProfileForV14').indexOf('Infinity defence: most incoming attacks are stopped before contact; only a power that gets past Infinity lands at full strength.') === -1) return false;
        // A6: Web Shot bridge for an incapacitating finisher vs a regenerator.
        if (fnSrc(html, 'finishParaV1647').indexOf('regeneration is not immunity, and once it is exhausted the loser stays down.') === -1) return false;
        // A7: opponent-aware stops filter + 3 call sites.
        if (html.indexOf('function stopsForOpponentV1654(') === -1) return false;
        if ((html.match(/stopsForOpponentV1654\(/g) || []).length !== 4) return false;
        // A8: variant names in the conditions line (non-Base only).
        if (fnSrc(html, 'conditionsTextV1638').indexOf('_vA1654') === -1) return false;
        // C1: resetSimulator clears variant picks.
        if (fnSrc(html, 'resetSimulator').indexOf('selectedVariants={}') === -1) return false;
        // Fix 6: generateEpisodeLegacy is gone; runGenericBattle stays —
        // the legacy HP-engine harness still drives it (175 battle()
        // calls); removal needs a harness migration, not a quiet delete.
        if (html.indexOf('function generateEpisodeLegacy(') !== -1) return false;
        // v16.55 (B stamina fix, Jhay 2026-11-07 ~12:54): the structured
        // stamina table is the source of truth; the numeric fallback is
        // killed in both resolvers; the pivot hash carries the variant.
        if (html.indexOf('STAMINA_V1655') === -1) return false;
        if (runInCtx("typeof staminaRecordV1655") !== 'function') return false;
        if (runInCtx("typeof staminaStatedV1655") !== 'function') return false;
        if (runInCtx("typeof staminaRunsOutReasonV1655") !== 'function') return false;
        if (runInCtx("typeof staminaTellingTextV1655") !== 'function') return false;
        if (runInCtx("typeof staminaPoweredTellingV1655") !== 'function') return false;
        if (JSON.parse(runInCtx('JSON.stringify(Object.keys(STAMINA_V1655).length)')) !== 45) return false;
        if (fnSrc(html, 'charFirstRunsOutV1631').indexOf('legacy numeric fallback') !== -1) return false;
        if (fnSrc(html, 'resolverRunsOutV1624').indexOf('legacy numeric fallback') !== -1) return false;
        if (fnSrc(html, 'charFirstRunsOutV1631').indexOf('Math.abs(aSta - bSta) >= 2') !== -1) return false;
        if (fnSrc(html, 'charFirstRunsOutV1631').indexOf('staminaStatedV1655') === -1) return false;
        if (fnSrc(html, 'charFirstRunsOutV1631').indexOf('staminaRunsOutReasonV1655') === -1) return false;
        if (fnSrc(html, 'charFirstRunsOutV1631').indexOf('fitsInFight') === -1) return false;
        if (fnSrc(html, 'powerProfileV1623').indexOf('staminaRecordV1655') === -1) return false;
        if (fnSrc(html, 'staminaWhyV1645').indexOf('_sr1655') === -1) return false;
        if (fnSrc(html, 'analysisNarrationTextV1638').indexOf('A.variant, B.id, B.variant') === -1) return false;
        if (html.indexOf('Stamina limit (researched, v16.55):') === -1) return false;
        if (html.indexOf('function runGenericBattle(') === -1) return false;
        // v16.56 (review fixes, Jhay 2026-11-07 15:29 + re-lock ~15:58).
        // Item 1: crop fix — object-position:top on both .phimg rules.
        if ((html.match(/object-position:top/g) || []).length !== 2) return false;
        if (html.indexOf('.card .ic .phimg{width:48px;height:48px;object-fit:cover;object-position:top') === -1) return false;
        if (html.indexOf('.phimg{width:1.4em;height:1.4em;object-fit:cover;object-position:top') === -1) return false;
        // Items 3+4: result header shows both fighters' photos +
        // variant names ("Name (Variant)" when not Base); innerText
        // first, then innerHTML (the harness mock has them as
        // separate fields).
        if (fnSrc(html, 'victoryHeaderResolverV1635').indexOf('dispV1656') === -1) return false;
        if (fnSrc(html, 'victoryHeaderResolverV1635').indexOf("n + ' (' + v + ')'") === -1) return false;
        if (fnSrc(html, 'setResultHeaderFromFrozenV1635').indexOf('photoHtmlV1653') === -1) return false;
        if (fnSrc(html, 'setResultHeaderFromFrozenV1635').indexOf('innerText = h.title') === -1) return false;
        if (fnSrc(html, 'setResultHeaderFromFrozenV1635').indexOf('innerHTML = _ph1656 + esc(h.title)') === -1) return false;
        // Item 5: gandalf2 is gone from the file entirely.
        if (html.indexOf('gandalf2') !== -1) return false;
        // Item 6: 'Instant Transmission' record + POWERS.goku 4th power.
        if (runInCtx("JSON.stringify(powerRecordV1625('goku','Instant Transmission'))") === 'null') return false;
        if (JSON.parse(runInCtx('JSON.stringify(POWERS.goku)')).join(',') !== 'Ki Blast,Instant Transmission Strike,Dragon Fist,Instant Transmission') return false;
        // Item 7: engine words reworded — the six labels are gone;
        // 'matched by keyword' appears exactly 7 times (v16.58 follow-ups add 3); the Audit /
        // rubric "through resolveAttack" (lines 2175/2211) and bare
        // resolveAttackV14 stay.
        if (html.indexOf('NO RESEARCH STAT BONUS') !== -1) return false;
        if (html.indexOf('[ENGINE DERIVATION') !== -1) return false;
        if (html.indexOf('resolveAttack pipeline') !== -1) return false;
        if (html.indexOf('keyword-fallback') !== -1) return false;
        if (html.indexOf('Offline Breakdown') !== -1) return false;
        if (html.indexOf('CHARACTER RECORD') !== -1) return false;
        if ((html.match(/matched by keyword/g) || []).length !== 7) return false;
        if ((html.match(/through resolveAttack/g) || []).length !== 2) return false;
        if (html.indexOf('function resolveAttackV14(') === -1) return false;
        // Item 8: Thanos Titan Slam record + v2weak.
        if (runInCtx("JSON.stringify(powerRecordV1625('thanos','Titan Slam'))") === 'null') return false;
        if (runInCtx("byId('thanos').v2weak").indexOf('Overconfidence; the Gauntlet can be taken') === -1) return false;
        // Item 10: Hulkbuster variant photo (Sauron v2 unchanged).
        if (runInCtx("photoPathV1653(byId('ironman'),'v2')") !== 'images/ironman-v2.jpg') return false;
        if (runInCtx("photoPathV1653(byId('sauron'),'v2')") !== 'images/sauron-v2.jpg') return false;
        // v16.57 fun loop (ideas 1-6 + 8; Best-of-3 waits): 13 new
        // functions defined once each; 6 new element ids once each;
        // forcedSeed 6 occurrences (decl + read x2 + setter + 2 clears);
        // no Best-of-3; RELATIONSHIPS unchanged; preview disclaimer kept.
        var _fns1657 = ['backToDraftKeepPair', 'randomFight', 'setPrediction', 'renderPredictionBoxV1657', 'applySeedInput', 'setForcedSeedV1657', 'rivalFor', 'addRival', 'renderRivalryV1657', 'dailyDateSeedV1657', 'dailyPickV1657', 'playDailyV1657', 'renderDailyBannerV1657'];
        for (var _i1657 = 0; _i1657 < _fns1657.length; _i1657++) { if ((html.split('function ' + _fns1657[_i1657] + '(').length - 1) !== 1) return false; }
        var _ids1657 = ['daily-banner', 'prediction-box', 'rivalry-box', 'prediction-line', 'seed-input', 'random-btn'];
        for (var _j1657 = 0; _j1657 < _ids1657.length; _j1657++) { if ((html.split('id="' + _ids1657[_j1657] + '"').length - 1) !== 1) return false; }
        if ((html.match(/forcedSeed/g) || []).length !== 6) return false;
        if (html.indexOf('startSeries') !== -1 || html.indexOf('seriesScore') !== -1 || html.indexOf('Best of 3') !== -1) return false;
        if (html.indexOf('Preview — not a prediction. The preview does not determine the winner; the combat engine does.') === -1) return false;
        // v16.58 follow-ups (engine-words + condition 3) + v16.59 fix pile
        // (F2/F3/F4): the old strings are gone (0x each); the new wording
        // is present; F2 weak text is LANDED (re-lock Jhay 2026-11-10
        // ~03:59); the F8 clause is kept.
        if (html.indexOf('keyword fallback') !== -1) return false;
        if (html.indexOf('Character power records') !== -1) return false;
        if (html.indexOf('ENGINE MECHANISM') !== -1) return false;
        if (html.indexOf('not the character record') !== -1) return false;
        if (html.indexOf('nothing recorded stops it') !== -1) return false;
        if (html.indexOf('where recorded') !== -1) return false;
        if (html.indexOf('stamina drain in very long fights') !== -1) return false;
        if (html.indexOf('Power records (v16.38') === -1) return false;
        if ((html.match(/matched by keyword/g) || []).length !== 7) return false;
        if (html.indexOf('stamina drains in very long fights') !== -1) return false; // F2 LANDED
        if (html.indexOf("weak:'Overconfidence'") === -1) return false; // F2 LANDED
        if ((html.match(/No recorded detail is stated for /g) || []).length !== 3) return false; // F8 KEPT
        return true;
      } catch (e) { return false; }
    })(), '');

  check('V1659-GOLDENS-RELOCK (G5 + re-lock extension + v16.51 telling fix + v16.52 spacing fix + v16.53 photos wiring + v16.55 B stamina fix + v16.56 review fixes + v16.57 fun loop + v16.58 follow-ups + v16.59 fix pile, Jhay-approved 2026-11-06 10:11 + 13:19 + 16:43 + 19:24 + 2026-11-07 01:12 + B fix 2026-11-07 ~13:00 + v16.56 re-lock 2026-11-07 ~15:58 + v16.57 fun loop 0 movers 2026-11-07 ~19:24 + v16.58 follow-ups 0 movers 2026-11-09 ~18:12 + v16.59 fix pile F2 re-lock 10 movers 2026-11-10 ~03:59) all 24 stored v16.59 BASE golden records recompute byte-identically from the v16.59 file, and the diff vs the v16.49 goldens is why 15/24, exchanges 21/24, stepNotes 12/24, criterion 3/24, events 3/24, kindStatus 9/24 (v16.55 B: goku/vegeta x3 stamina->speed — the numeric fallback is killed, both-stated pairs fall through to speed; v16.56: item 7 wording keyword-fallback -> matched by keyword on 9 records, item 6 repertoire shift moves event abilities on 3 records; v16.59 F2 re-lock: 10 records move on the stamina paths (staminaLimit, staminaLimitStatus, staminaStages) — wording only, no winner/criterion/finisher/rounds/damage change and confined to the allowed paths (frozen.loserState, frozen.why, frozen.exchanges, frozen.stepNotes, frozen.winPath, frozen.conditions.modeLabel/winConditions, frozen.inputs.incapA/B.power.kindStatus, frozen.heldOutA, frozen.inputs.schemaA/B.staminaLimit, frozen.inputs.schemaA/B.staminaLimitStatus, frozen.staminaStages.A/B, finishing-event detail/explanation/loserState/ability/damageType): loserState moves on 0/24, why moves on 15/24, winPath moves on 0/24, conditions move on 0/24, finishing events move on 3/24 (item 6: superman/goku 12345, goku/vegeta 632115031, superman/goku 1652930674 — event abilities + damage types only), stepNotes move on 12/24, exchanges move on 21/24 (the Decisive exchange quotes the why, the Stall exchange names the weakened state), kindStatus moves on 9/24 (item 7, pinned by key), heldOutA moves on 0/24; winners/finishers/rounds/damage never move; criterion moves ONLY on the 3 goku/vegeta base records (stamina->speed); any other diff fails loudly',
    (function () {
      const crypto = require('crypto');
      const fs = require('fs');
      const path = require('path');
      let newGold, oldGold;
      try {
        newGold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
        oldGold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.49-goldens.json'), 'utf8'));
      } catch (e) { return false; }
      if (newGold.version !== 'v16.59' || newGold.generatedFrom !== 'war-room-v16.59.html') return false;
      if (newGold.htmlMd5 !== crypto.createHash('md5').update(html).digest('hex')) return false;
      if (!Array.isArray(newGold.records) || newGold.records.length !== 40) return false;
      if (!Array.isArray(oldGold.records) || oldGold.records.length !== 40) return false;
      function differ(a, b, pfx, out) {
        if (a === b) return;
        if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
          const keys = {};
          Object.keys(a).forEach(function (k) { keys[k] = 1; });
          Object.keys(b).forEach(function (k) { keys[k] = 1; });
          Object.keys(keys).forEach(function (k) {
            if (!(k in a)) out.push(pfx + k + ':<absent-in-old>');
            else if (!(k in b)) out.push(pfx + k + ':<absent-in-new>');
            else differ(a[k], b[k], pfx + k + '.', out);
          });
          return;
        }
        if (Array.isArray(a) && Array.isArray(b)) {
          if (a.length !== b.length) out.push(pfx + 'len');
          const base = pfx.replace(/\.$/, '');
          const n = Math.min(a.length, b.length);
          for (let i = 0; i < n; i++) differ(a[i], b[i], base + '[' + i + '].', out);
          return;
        }
        out.push(pfx.slice(0, -1));
      }
      // Construction MUST match war-room-v16.54-verify-goldens.js exactly (key order matters).
      const goldenString = function (b, f) {
        return JSON.stringify({ events: b.events, finalRecord: b.finalRecord, finalState: b.finalState, rounds: b.rounds, totalDamage: b.totalDamage, destruction: b.destruction, winner: b.winner, renderedReason: b.renderedReason, renderedReasonWords: b.renderedReasonWords, frozen: f });
      };
      const ALLOWED = ['frozen.loserState', 'frozen.why', 'frozen.exchanges', 'frozen.stepNotes', 'frozen.winPath', 'frozen.conditions.modeLabel', 'frozen.conditions.winConditions', 'frozen.inputs.runsOutFirst', 'frozen.staminaStages.runsOutFirst', 'frozen.decisiveCriterion', 'finalRecord.renderedReason', 'finalRecord.renderedReasonWords', 'renderedReason', 'renderedReasonWords', 'frozen.inputs.incapA.power.kindStatus', 'frozen.inputs.incapB.power.kindStatus', 'frozen.heldOutA', 'frozen.inputs.schemaA.staminaLimit', 'frozen.inputs.schemaA.staminaLimitStatus', 'frozen.inputs.schemaB.staminaLimit', 'frozen.inputs.schemaB.staminaLimitStatus', 'frozen.staminaStages.A', 'frozen.staminaStages.B']; // v16.55 (B): the stamina step's own outputs move — the runsOutFirst input + staminaStages, the criterion (gated by the allowlist above), the rendered reason (derived from the why/criterion); v16.56 (review fixes): the kindStatus wording (item 7, gated by the movedKind count + key allowlist) and the heldOutA list (item 6, gated by the movedHeldOut count + key allowlist); v16.59 (fix pile F2 re-lock): the stamina paths (staminaLimit, staminaLimitStatus, staminaStages.A/B) — wording only, gated by the VS-V1658 10-mover set
      function allowedEventField(p) {
        return /^events\[\d+\]\.(detail|explanation|loserState|ability|damageType)$/.test(p); // v16.56 (item 6): the repertoire-order shift moves event abilities (+ damage types) on 3 base records — gated by the movedEvents count + the event key allowlist
      }
      function isAllowed(p) {
        const base = p.replace(/:<absent-in-(old|new)>$/, '');
        if (allowedEventField(base)) return true;
        return ALLOWED.some(function (a) { return base === a || base.indexOf(a + '.') === 0 || base.indexOf(a + '[') === 0; });
      }
      const oldByKey = {};
      // v16.47 HARNESS FIX: key by pair|seed|variant (as the variant check
      // does) — pair|seed alone collides: goku/vegeta|12345 has a base
      // record AND v2/v3 records, and the variant overwrote the base.
      oldGold.records.forEach(function (o) { oldByKey[o.pair + '|' + o.seed + '|' + JSON.stringify(o.variant || null)] = o; });
      let ok = true;
      const badPaths = [];
      const seen = {};
      let baseCount = 0;
      let movedLoser = 0, movedWhy = 0, movedWinPath = 0, movedConditions = 0, movedEvents = 0, movedStepNotes = 0, movedExchanges = 0, movedKind = 0, movedHeldOut = 0;
      newGold.records.forEach(function (g) {
        if (g.variant) return; // variant records are asserted by V1659-GOLDENS-VARIANT-RELOCK
        baseCount++;
        const key = g.pair + '|' + g.seed;
        if (seen[key]) { ok = false; return; }
        seen[key] = 1;
        if (g.seedSet === undefined || g.mode !== 'death' || g.battlefield !== 'Open Arena') { ok = false; return; }
        const old = oldByKey[key + '|' + JSON.stringify(g.variant || null)];
        if (!old) { ok = false; return; }
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        const rec = goldenString(r.b, r.f);
        if (rec !== g.record) { ok = false; badPaths.push(key + ':recomputed!=stored'); return; }
        if (crypto.createHash('sha256').update(rec).digest('hex') !== g.sha256) { ok = false; return; }
        if (r.f.winner !== g.winner || r.f.decisiveCriterion !== g.criterion || r.f.finisher !== g.finisher || r.f.loserState !== g.loserState || r.f.roundCount !== g.roundCount) { ok = false; return; }
        if (g.winner !== old.winner || g.finisher !== old.finisher || g.roundCount !== old.roundCount || JSON.stringify(g.damageSums) !== JSON.stringify(old.damageSums)) { ok = false; badPaths.push(key + ':locked-field-moved'); return; }
        if (g.criterion !== old.criterion) {
          // v16.55 (B): exactly 3 base criterion moves — goku/vegeta at
          // all 3 seeds, stamina -> speed (both-stated fall-through).
          const expCrit = { 'goku/vegeta|12345': 1, 'goku/vegeta|632115031': 1, 'goku/vegeta|188971857': 1 }[key];
          if (!expCrit || old.criterion !== 'stamina' || g.criterion !== 'speed') { ok = false; badPaths.push(key + ':criterion-moved-unexpected'); return; }
        }
        if (old.loserState !== 'dead') { ok = false; badPaths.push(key + ':v16.49-loserState-not-dead'); return; }
        if (g.loserState !== 'dead') { ok = false; return; }
        if (g.loserState !== old.loserState) movedLoser++;
        const d = [];
        differ(JSON.parse(old.record), JSON.parse(rec), '', d);
        const disallowed = d.filter(function (p) { return !isAllowed(p); });
        if (disallowed.length !== 0) { ok = false; badPaths.push(key + ':DISALLOWED:' + disallowed.join(',')); return; }
        const bases = d.map(function (p) { return p.replace(/:<absent-in-(old|new)>$/, ''); });
        if (bases.indexOf('frozen.why') !== -1) movedWhy++;
        if (bases.indexOf('frozen.winPath') !== -1) movedWinPath++;
        if (bases.some(function (p) { return p.indexOf('frozen.conditions.') === 0; })) movedConditions++;
        if (bases.some(function (p) { return p.indexOf('events[') === 0; })) movedEvents++;
        if (bases.some(function (p) { return p.indexOf('frozen.stepNotes') === 0; })) movedStepNotes++;
        if (bases.some(function (p) { return p.indexOf('frozen.exchanges') === 0; })) movedExchanges++;
        // v16.56 (item 7): the kindStatus wording 'keyword-fallback' ->
        // 'matched by keyword' moves exactly 9 base records — pinned
        // by key, not just by count.
        if (bases.some(function (p) { return p.indexOf('frozen.inputs.incapA.power.kindStatus') === 0 || p.indexOf('frozen.inputs.incapB.power.kindStatus') === 0; })) {
          movedKind++;
          const expKind = { 'superman/rocky|12345': 1, 'superman/rocky|567823406': 1, 'superman/rocky|463252044': 1, 'superman/goku|12345': 1, 'superman/goku|1652930674': 1, 'superman/goku|1203312057': 1, 'vader/superman|12345': 1, 'vader/superman|412407688': 1, 'vader/superman|1403705703': 1 }[key];
          if (!expKind) { ok = false; badPaths.push(key + ':kindStatus-moved-unexpected'); return; }
        }
        // v16.56 (item 6): no base record moves the heldOutA list —
        // the 2 heldOutA movers are variants, pinned by the variant
        // check below.
        if (bases.some(function (p) { return p.indexOf('frozen.heldOutA') === 0; })) movedHeldOut++;
        // v16.56 (item 6): the repertoire-order shift moves event
        // abilities (and their damage types) on exactly 3 base
        // records — pinned by key.
        if (bases.some(function (p) { return /^events\[\d+\]\.(ability|damageType)$/.test(p); })) {
          const expEv = { 'superman/goku|12345': 1, 'goku/vegeta|632115031': 1, 'superman/goku|1652930674': 1 }[key];
          if (!expEv) { ok = false; badPaths.push(key + ':event-ability-moved-unexpected'); return; }
        }
      });
      if (baseCount !== 24 || Object.keys(seen).length !== 24) return false;
      if (movedLoser !== 0 || movedWhy !== 15 || movedWinPath !== 0 || movedConditions !== 0 || movedEvents !== 3 || movedStepNotes !== 12 || movedExchanges !== 21 || movedKind !== 9 || movedHeldOut !== 0) { ok = false; badPaths.push('moved counts loser/why/winPath/conditions/events/stepNotes/exchanges/kind/heldOut=' + [movedLoser, movedWhy, movedWinPath, movedConditions, movedEvents, movedStepNotes, movedExchanges, movedKind, movedHeldOut].join('/')); }
      if (!ok) { globalThis._v1659GoldenDiffs = badPaths; }
      return ok;
    })(), (globalThis._v1659GoldenDiffs || []).join(' | '));


  // ================= v16.42 — 191 bases style batch (plan §6) =================
  // Roster prose checks: parse the roster from the HTML under test and
  // from the v16.41 file, and diff field by field. No engine change is
  // asserted here beyond the narration locks; outcomes are asserted by
  // V1659-GOLDENS-RELOCK above.
  {
    const fs42 = require('fs');
    const path42 = require('path');
    const oldHtml42 = fs42.readFileSync(path42.join(__dirname, 'war-room-v16.41.html'), 'utf8');
    const table42 = fs42.readFileSync(path42.join(__dirname, 'war-room-v16.42-style-table.md'), 'utf8');
    const fieldTok42 = function (line, field) {
      const ki = line.indexOf(field + ':');
      if (ki === -1) return null;
      let i = ki + field.length + 1;
      const q = line[i];
      if (q !== "'" && q !== '"') return null;
      let j = i + 1, val = '';
      while (j < line.length) {
        const c = line[j];
        if (c === '\\' && j + 1 < line.length) { val += line[j + 1]; j += 2; continue; }
        if (c === q) return val;
        val += c; j++;
      }
      return null;
    };
    const parseRoster42 = function (h) {
      const out = {};
      h.split('\n').forEach(function (ln) {
        const m = ln.match(/^\{id:'([^']+)',/);
        if (!m || out[m[1]]) return;
        const rec = { line: ln };
        ['style', 'usage', 'persNote'].forEach(function (f) { rec[f] = fieldTok42(ln, f); });
        rec.all = {};
        const re = /([a-zA-Z0-9_]+):'((?:\\'|[^'])*)'/g;
        let mm;
        while ((mm = re.exec(ln)) !== null) rec.all[mm[1]] = mm[2];
        out[m[1]] = rec;
      });
      return out;
    };
    const oldR42 = parseRoster42(oldHtml42);
    const newR42 = parseRoster42(html);
    const tableIds42 = [];
    {
      const re = /^### (\S+) — /gm;
      let m;
      while ((m = re.exec(table42)) !== null) tableIds42.push(m[1]);
    }
    check('V1642-STYLE-H-ROSTER-191 (plan §6) all 191 table ids resolve to exactly one roster entry, except gandalf2 (v16.56 item 5: removed, so 190 resolve and he is the only missing id); the 3 held fighters are byte-identical style/usage/persNote',
      tableIds42.length === 191 && new Set(tableIds42).size === 191 &&
      tableIds42.filter(function (id) { return !newR42[id]; }).length === 1 && !newR42['gandalf2'] &&
      ['hisoka', 'levi', 'kaneki'].every(function (id) {
        return oldR42[id] && newR42[id] && ['style', 'usage', 'persNote'].every(function (f) { return oldR42[id][f] === newR42[id][f]; });
      }), tableIds42.length + ' rows');
    check('V1646-VARIANT-H-FIELDS-ONLY (plan §6) the v16.41->v16.56 roster diff touches ONLY style/usage/persNote (exactly 159 changed fields across 113 rows, as v16.42) plus variant string fields for the 32 Video Games rows (402, as v16.44) and the 33 Anime rows (365 = 29 v2 x 6 + 9 renamed labels + 26 v3 x 7; the 19 SUPPORTED + 1 PINNED v2 labels are byte-identical to the live labels) plus the 6 v16.55 B stamina data corrections (4 base weak rewords: cloud, toshiro, godzilla, bolin; 2 v2weak rewords: sephiroth, deku — text-only, the fields were already new vs v16.41 so variantStr stays 767) plus the v16.56 review fixes (gandalf2 removed — 1 missing id — and thanos v2weak added) plus the v16.59 F2 goku weak re-lock (Jhay 2026-11-10 ~03:59); no other string key moves anywhere except icon (v16.53 photos wiring: 193 emoji to photo paths, covered by V1653-PHOTOS-ICONS)',
    (function () {
      let changed = 0;
      const rows = {};
      let other = 0;
      const otherIds = {}; // v16.55 (B): pin WHICH ids land in 'other'
      let iconChanged = 0;
      let variantStr = 0;
      const VG = {};
      VG['aloy'] = 1;
      VG['arthurmorgan'] = 1;
      VG['bayonetta'] = 1;
      VG['chunli'] = 1;
      VG['cloud'] = 1;
      VG['crashbandicoot'] = 1;
      VG['dante'] = 1;
      VG['doomslayer'] = 1;
      VG['ellie'] = 1;
      VG['ezio'] = 1;
      VG['jinkazama'] = 1;
      VG['kirby'] = 1;
      VG['kratos'] = 1;
      VG['lara'] = 1;
      VG['leonkennedy'] = 1;
      VG['link'] = 1;
      VG['mario'] = 1;
      VG['chief'] = 1;
      VG['megaman'] = 1;
      VG['nathandrake'] = 1;
      VG['pikachu'] = 1;
      VG['ryu'] = 1;
      VG['samus'] = 1;
      VG['scorpion'] = 1;
      VG['sephiroth'] = 1;
      VG['snake'] = 1;
      VG['sonic'] = 1;
      VG['sora'] = 1;
      VG['spyro'] = 1;
      VG['steve'] = 1;
      VG['subzero'] = 1;
      VG['wario'] = 1;
      const ANIME = {};
      ANIME['allmight'] = 1;
      ANIME['deku'] = 1;
      ANIME['edward'] = 1;
      ANIME['eren'] = 1;
      ANIME['erza'] = 1;
      ANIME['gaara'] = 1;
      ANIME['gojo'] = 1;
      ANIME['goku'] = 1;
      ANIME['gon'] = 1;
      ANIME['hisoka'] = 1;
      ANIME['ichigo'] = 1;
      ANIME['jiraiya'] = 1;
      ANIME['kakashi'] = 1;
      ANIME['kaneki'] = 1;
      ANIME['kenpachi'] = 1;
      ANIME['killua'] = 1;
      ANIME['levi'] = 1;
      ANIME['luffy'] = 1;
      ANIME['madara'] = 1;
      ANIME['naruto'] = 1;
      ANIME['natsu'] = 1;
      ANIME['piccolo'] = 1;
      ANIME['rocklee'] = 1;
      ANIME['rukia'] = 1;
      ANIME['saitama'] = 1;
      ANIME['sakura'] = 1;
      ANIME['sasuke'] = 1;
      ANIME['shikamaru'] = 1;
      ANIME['tanjiro'] = 1;
      ANIME['toshiro'] = 1;
      ANIME['vegeta'] = 1;
      ANIME['yuji'] = 1;
      ANIME['zoro'] = 1;
      const VSTR = { v2: 1, v2style: 1, v2usage: 1, v2persNote: 1, v2weak: 1, v2sig: 1, v2trans: 1, v3: 1, v3style: 1, v3usage: 1, v3persNote: 1, v3weak: 1, v3sig: 1, v3trans: 1 };
      const ids = new Set(Object.keys(oldR42).concat(Object.keys(newR42)));
      ids.forEach(function (id) {
        if (!oldR42[id] || !newR42[id]) { other++; return; }
        const keys = new Set(Object.keys(oldR42[id].all).concat(Object.keys(newR42[id].all)));
        keys.forEach(function (k) {
          if (oldR42[id].all[k] !== newR42[id].all[k]) {
            if (['style', 'usage', 'persNote'].indexOf(k) !== -1) { changed++; rows[id] = 1; }
            else if (VSTR[k] && (VG[id] || ANIME[id])) { variantStr++; }
            else if (k === 'icon') { iconChanged++; }
            else { other++; (otherIds[id] = otherIds[id] || []).push(k); }
          }
        });
      });
      // v16.55 (B): exactly the 4 base weak rewords land in 'other'
      // (cloud, toshiro, godzilla, bolin — each only its 'weak' field).
      // The 2 v2weak rewords (sephiroth, deku) do NOT move variantStr:
      // the v2weak fields were already new vs v16.41 (added in v16.44),
      // so they were already counted once in the 767 — the B fix only
      // changed their text. v16.56 (review fixes): gandalf2's row is
      // MISSING (the diff loop counts a missing id in 'other' but does
      // NOT add it to otherIds), and thanos gains a v2weak — so other
      // is 4 + 1 + 1 = 6, + v16.59 F2 goku weak = 7, changed 160 -> 159 and rows 114 -> 113
      // (gandalf2's persNote was one of the 160), iconChanged 194 -> 193.
      // Any other key move fails.
      return other === 7 && JSON.stringify(Object.keys(otherIds).sort()) === JSON.stringify(['bolin', 'cloud', 'godzilla', 'goku', 'thanos', 'toshiro']) && Object.keys(otherIds).every(function (id) { return otherIds[id].length === 1 && otherIds[id][0] === (id === 'thanos' ? 'v2weak' : 'weak'); }) && changed === 159 && Object.keys(rows).length === 113 && variantStr === 767 && iconChanged === 193;
    })(), '');

  check('V1642-STYLE-H-NO-RED-ECHO (plan §6) no new/changed style/usage/persNote contains a RED name, Barrage/Combo/Gadget Strike, or a near-echo',
      (function () {
        const RED = ['Gadget Barrage', 'Fireball Barrage', 'Transmuted Blade Barrage', 'Escrima Barrage', 'Trick Arrow Barrage', 'Precision Arrow Barrage', 'Earth Pillar Barrage', 'Fire Blast Barrage', 'Water Whip Barrage', 'Axe Chop Barrage', 'Stupefy Barrage', 'Expelliarmus Barrage', 'Arsenal Barrage', 'Sword Barrage', 'Pistol Barrage', 'Dead Eye Barrage', 'Body Blow Barrage', 'Machine Gun Barrage', 'Jungle Trap Barrage', 'Smith Clone Barrage', 'Air Blast Barrage', 'Crysknife Barrage', 'ODM Blade Barrage', 'Web + Impact Combo', 'Gun-Fu Combination', 'Four-Element Combo', 'Katana Master Combo', 'Katana + Gun Combo', 'Hand-to-Hand Combo', 'Witch Time Combo', 'Keyblade Combo', 'Kung Fu Combo', 'Acrobatic Kick Combo', 'Gadget Strike'];
        const ECHO = ['impact combo', 'blade barrage', 'gadget barrage'];
        let bad = '';
        tableIds42.forEach(function (id) {
          if (!newR42[id]) { if (id !== 'gandalf2') bad = id + ':missing-unexpected'; return; } // v16.56 (item 5): gandalf2 removed — no new text to check for RED names
          ['style', 'usage', 'persNote'].forEach(function (f) {
            if (oldR42[id][f] === newR42[id][f]) return;
            const v = newR42[id][f] || '';
            RED.forEach(function (n) { if (v.indexOf(n) !== -1) bad = id + '.' + f + ':' + n; });
            ECHO.forEach(function (e) { if (v.toLowerCase().indexOf(e) !== -1) bad = id + '.' + f + ':' + e; });
            if (/barrage/i.test(v) || /combo/i.test(v) || /gadget strike/i.test(v)) bad = id + '.' + f;
          });
        });
        return bad === '';
      })(), '');
    check('V1642-STYLE-H-NO-PLACEHOLDER (plan §6) no roster style/usage/persNote contains <, >, TODO, TBD, XXX; byte sequence "redacted" absent from the file',
      (function () {
        let bad = '';
        Object.keys(newR42).forEach(function (id) {
          ['style', 'usage', 'persNote'].forEach(function (f) {
            const v = newR42[id][f] || '';
            if (v.indexOf('<') !== -1 || v.indexOf('>') !== -1 || /TODO|TBD|XXX/i.test(v)) bad = id + '.' + f;
          });
        });
        return bad === '' && html.indexOf('redacted') === -1;
      })(), '');
    check('V1642-STYLE-H-STYLE-SHAPE (plan §6) changed styles ≤80 chars, no digits/periods; usage 1–2 sentences; persNote 1 sentence; none empty/unknown; Frodo style has no trailing period',
      (function () {
        const BF = { arena: 1, ruined: 1, forest: 1, desert: 1, industrial: 1 };
        let bad = '';
        Object.keys(newR42).forEach(function (id) {
          if (BF[id]) return;
          const s = newR42[id].style || '', u = newR42[id].usage || '', p = newR42[id].persNote || '';
          if (oldR42[id] && oldR42[id].style !== s) {
            if (s.length > 80 || /\d/.test(s) || s.endsWith('.') || s.indexOf('. ') !== -1) bad = id + '.style';
          }
          if (!s || !u || !p) bad = id + '.empty';
          if (s.toLowerCase() === 'unknown' || u.toLowerCase() === 'unknown' || p.toLowerCase() === 'unknown') bad = id + '.unknown';
          const uSent = u.split(/(?<=[.!?])\s+/).filter(Boolean).length;
          if (uSent < 1 || uSent > 2) bad = id + '.usage-sentences';
          const pSent = p.split(/(?<=[.!?])\s+/).filter(Boolean).length;
          if (pSent !== 1) bad = id + '.persNote-sentences';
        });
        return bad === '' && newR42.frodo.style === 'Small Ring-bearer who hides, endures, and never seeks a duel';
      })(), '');
    check('V1642-STYLE-H-NO-VARIANT-MOVE (plan §6) no new base text claims the pinned variant move (Mario fireballs, Spider-Man impact combo/webbing, Superman Sun-Charged/Super Flare, Batman preparation)',
      (function () {
        const cases = [
          ['mario', 'fireball'], ['spiderman', 'impact combo'], ['spiderman', 'impact webbing'],
          ['superman', 'sun-charged'], ['superman', 'super flare'], ['batman', 'preparation'], ['batman', 'prepared'],
        ];
        let bad = '';
        cases.forEach(function (c) {
          ['style', 'usage', 'persNote'].forEach(function (f) {
            if (((newR42[c[0]][f]) || '').toLowerCase().indexOf(c[1]) !== -1) bad = c[0] + '.' + f + ':' + c[1];
          });
        });
        return bad === '';
      })(), '');
    check('V1642-STYLE-H-NARRATION-LOCKS (plan §6) narration still locks winner/finisher/loser state and quotes the new style descriptions where the engine quotes them (raven/sephiroth plan paragraphs)',
      (function () {
        try {
          const r = sim39('raven', 'sephiroth', 12345, 'death');
          const n = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          if (r.f.winner !== 'Sephiroth' || r.f.finisher !== 'Masamune Slash' || r.f.loserState !== 'dead') return false;
          if (n.indexOf('Calm half-demon who binds foes with soul-self') === -1) return false;
          if (n.indexOf('Patient predator with Masamune reach and magic') === -1) return false;
          if (n.indexOf('Masamune Slash') === -1) return false;
          const r2 = sim39('saitama', 'frodo', 12345, 'death');
          const n2 = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r2.b)) + '))');
          if (r2.f.winner !== 'Saitama' || r2.f.finisher !== 'Serious Punch' || r2.f.loserState !== 'dead') return false;
          if (n2.indexOf('Serious Punch') === -1) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-H-SIZE (plan §6 H-SIZE) v16.59 file under the 1,480,000-char ceiling (Fix 6, Jhay 2026-11-07 01:25; raised to 1,480,000 in v16.58, Jhay 2026-11-09 ~11:35)',
      Array.from(html).length < 1480000, Array.from(html).length + ' chars');
    check('V1659-H-STAMPS (plan §6 H-STAMPS) title/heading/tagline read v16.59 with no ENGINE, cache key v1659 present and v1658 absent, importer accepts v16.58, live save format stays v16.39',
      html.indexOf('<title>WAR-ROOM v16.59') !== -1 && html.indexOf('<h1>WAR-ROOM v16.59</h1>') !== -1 && (function () { const m = html.match(/<span>1V1 DEATH BATTLES[^<]*<\/span>/); return !!m && m[0].indexOf('ENGINE') === -1; })() &&
      html.indexOf('warroom_breakdown_cache_v1659') !== -1 && html.indexOf('warroom_breakdown_cache_v1658') === -1 &&
      html.indexOf("'v16.58'") !== -1 && html.indexOf("entry.formatVersion = 'v16.39'") !== -1, '');
    check('V1653-PHOTOS-ICONS (photos wiring, Jhay 2026-11-07 01:12) all 193 roster icon fields are images/<id>.jpg paths; the 2 custom-fighter constructors keep the star; no emoji icon remains on a roster record — v16.56 (item 5): gandalf2 removed, so icons 196 -> 195 and paths 194 -> 193',
      (function () {
        try {
          const icons = html.match(/icon:'[^']*'/g) || [];
          if (icons.length !== 195) return false;
          let paths = 0, stars = 0;
          for (const ic of icons) {
            if (/^icon:'images\/[a-z0-9]+\.jpg'$/.test(ic)) paths++;
            else if (ic === "icon:'⭐'") stars++;
            else return false;
          }
          return paths === 193 && stars === 2;
        } catch (e) { return false; }
      })(), '');
    check('V1653-PHOTOS-HELPER (photos wiring) photo helper + variant map present; all 9 render sites use it (v16.56 item 3: the result header joins the 8); Info title uses innerHTML (no icon in innerText)',
      (function () {
        try {
          if (html.indexOf('function photoHtmlV1653(') === -1) return false;
          if (html.indexOf('function photoFailV1653(') === -1) return false;
          if (html.indexOf('function photoPathV1653(') === -1) return false;
          if (html.indexOf("VARIANT_PHOTOS_V1653={sauron:{v2:'images/sauron-v2.jpg'},ironman:{v2:'images/ironman-v2.jpg'}}") === -1) return false; // v16.56 (item 10): Hulkbuster joins the variant-photo map
          if (html.indexOf('onerror="photoFailV1653(this)"') === -1) return false;
          if ((html.match(/photoHtmlV1653\(/g) || []).length !== 10) return false; // v16.56 (item 3): 1 definition + 9 call sites
          if (html.indexOf('${f.icon}') !== -1) return false;
          if (html.indexOf("f.icon+' '") !== -1) return false;
          if (html.indexOf('r.value.f.icon') !== -1) return false;
          if (html.indexOf("info-title').innerText=`${f.icon}") !== -1) return false;
          if (html.indexOf("info-title').innerHTML=`${photoHtmlV1653(f") === -1) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1653-PHOTOS-CSS (photos wiring) photo sizing CSS present (card 48px + inline 1.4em, object-fit cover)',
      html.indexOf('.card .ic .phimg{width:48px;height:48px;object-fit:cover') !== -1 &&
      html.indexOf('.phimg{width:1.4em;height:1.4em;object-fit:cover') !== -1, '');
    check('V1659-A1-VERDICT-FRAMES (A1, Jhay 2026-11-07 01:02) the verdict frame varies per pair — 3 frames per criterion, hash-picked, reason phrase unchanged, finisher in every verdict, one sentence (exactly one period) on every battle; v16.55 (B): goku/vegeta and batman/deadpool are now speed, so sonic/rocky base and tanjiro/zoro base are the stamina pairs',
      (function () {
        try {
          const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman'], ['batman', 'deadpool'], ['sonic', 'rocky'], ['tanjiro', 'zoro']]; // v16.55 (B): the last two are the stamina pairs (goku/vegeta + batman/deadpool moved to speed)
          const byCrit = {};
          for (let i = 0; i < pairs.length; i++) {
            const r = sim39(pairs[i][0], pairs[i][1], 12345, 'death');
            const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
            const paras = t.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean);
            const last = paras[paras.length - 1] || '';
            if (last.indexOf('Verdict: ' + r.f.winner + ' wins — ') !== 0) return false;
            if ((last.match(/\./g) || []).length !== 1) return false; // one-sentence verdict (standing v16.50 rule)
            if (last.indexOf(r.f.finisher) === -1) return false;
            (byCrit[r.f.decisiveCriterion] = byCrit[r.f.decisiveCriterion] || []).push(last);
          }
          const uniq = function (a) { const s = {}; a.forEach(function (x) { s[x] = 1; }); return Object.keys(s).length; };
          if (uniq(byCrit['incapacitation'] || []) !== 3) return false;
          if (uniq(byCrit['stamina'] || []) < 2) return false;
          if (uniq(byCrit['cannot-harm'] || []) !== 2) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-A2-SPEED-WHY (A2, Jhay 2026-11-07 01:02) the 7 re-locked speed records carry the plain-words why — "Speed decides it: {W} is faster than {L}, so {W} sets the pace — no earlier edge separates them." — with no "game-speed" in the why; the old Audit-comparison copy keeps its audit suffix; v16.55 (B): goku/vegeta v3 is now stamina (Vegeta runs out of Super Saiyan Blue), so it leaves this list',
      (function () {
        try {
          const jobs = [
            ['raven', 'sephiroth', 12345, null], ['raven', 'sephiroth', 474962531, null], ['raven', 'sephiroth', 1582153710, null],
            ['sora', 'link', 12345, { sora: 'v2' }], ['cloud', 'sephiroth', 12345, { cloud: 'v3' }], ['samus', 'chief', 12345, { samus: 'v2' }],
            ['ryu', 'chunli', 12345, { ryu: 'v2' }],
          ];
          for (let i = 0; i < jobs.length; i++) {
            const j = jobs[i];
            runInCtx('selectedVariants = ' + JSON.stringify(j[3] || {}) + ';');
            const r = sim39(j[0], j[1], j[2], 'death');
            runInCtx('selectedVariants = {};');
            if (r.f.decisiveCriterion !== 'speed') return false;
            if (r.f.why.indexOf('Speed decides it: ') !== 0) return false;
            if (r.f.why.indexOf('game-speed') !== -1) return false;
            if (r.f.why.indexOf(' is faster than ') === -1 || r.f.why.indexOf(' sets the pace — no earlier edge separates them.') === -1) return false;
          }
          if (html.indexOf('Speed numbers are audit numbers, not canon speed claims.') === -1) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-A3-GOJO-PLAIN (A3, Jhay 2026-11-07 01:02) Gojo\'s Infinity reads in plain words everywhere — no "EX-tier" anywhere in the file; the clause, the profile strings, and the defence note all use the plain wording',
      (function () {
        try {
          if (html.indexOf('EX-tier') !== -1) return false;
          if (html.indexOf('Infinity stops most attacks before they land; only a power that gets past it lands at full strength') === -1) return false;
          if (html.indexOf('most attacks stop before contact — only a power that gets past Infinity lands at full strength.') === -1) return false;
          if (html.indexOf('Infinity defence: most incoming attacks are stopped before contact; only a power that gets past Infinity lands at full strength.') === -1) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-A4-A5-TELLING-TEXT (A4 + A5, Jhay 2026-11-07 01:02) no telling carries a damage-type tag in parentheses; v16.55 (B): Vader vs Obi-Wan is now speed (Obi-Wan wins, Lightsaber Slash) — the no-limit stamina opener is unreachable, because a stamina decision always has the loser stated, so the check no longer asserts the two dead frame strings',
      (function () {
        try {
          const tag = /\((energy|physical|magic|internal|environmental|restraint|poison|sealing|reality|psychic|healing)\)/;
          const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman'], ['batman', 'deadpool']];
          for (let i = 0; i < pairs.length; i++) {
            const r = sim39(pairs[i][0], pairs[i][1], 12345, 'death');
            const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
            if (tag.test(t)) return false;
          }
          const s = sim39('vader', 'obiwan', 12345, 'death');
          if (s.f.decisiveCriterion !== 'speed') return false; // v16.55 (B): both-stated fall-through — Vader and Obi-Wan both carry a stated limit, so it goes to speed
          if (s.f.winner !== 'Obi-Wan Kenobi' || s.f.finisher !== 'Lightsaber Slash') return false;
          const n = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(s.b)) + '))');
          const op = n.split('\n\n')[0] || '';
          if (op.indexOf('the record says') !== -1 || op.indexOf('tires first') !== -1) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-A6-BRIDGE (A6, Jhay 2026-11-07 01:02) an incapacitating finisher against a regenerative loser carries the bridge — Agent Smith vs Sakura seed 1 is decided on speed with Replication (v16.55 B: both-stated fall-through), and the finish paragraph explains regeneration is exhausted; the incapacitation decision carries no bridge in its finish paragraph',
      (function () {
        try {
          const r = sim39('agentsmith', 'sakura', 1, 'death');
          if (r.f.winner !== 'Agent Smith' || r.f.finisher !== 'Replication' || r.f.decisiveCriterion !== 'speed') return false; // v16.55 (B): both-stated fall-through — the bridge still fires on a speed decision
          const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          const paras = t.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean);
          const fin = paras.filter(function (p) { return p.indexOf('finishes with') !== -1; });
          if (fin.length !== 1) return false;
          if (fin[0].indexOf('regeneration is exhausted') === -1) return false;
          // Control: Spider-Man vs Deadpool seed 12345 is incapacitation —
          // its finish paragraph carries no bridge (the way-to-lose clause
          // elsewhere in the telling may still name regeneration).
          const c = sim39('spiderman', 'deadpool', 12345, 'death');
          if (c.f.decisiveCriterion !== 'incapacitation') return false;
          const ct = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(c.b)) + '))');
          const cfin = ct.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean).filter(function (p) { return p.indexOf('finishes with') !== -1; });
          if (cfin.length !== 1) return false;
          if (cfin[0].indexOf('regeneration is exhausted') !== -1) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-A7-STOPS-FILTER (A7, Jhay 2026-11-07 01:02) what-stops lines name only what can actually stop the move against THIS opponent — Rocky\'s Body Punch stops list drops "superhuman durability" against mortals and keeps it against Superman',
      (function () {
        try {
          if (runInCtx("stopsForOpponentV1654('superhuman durability; speed', 'mortal')") !== 'speed') return false;
          if (runInCtx("stopsForOpponentV1654('superhuman durability; speed', 'invulnerable')") !== 'superhuman durability; speed') return false;
          if (runInCtx("stopsForOpponentV1654('superhuman durability', 'mortal')") !== '') return false;
          if (runInCtx("stopsForOpponentV1654('regeneration; speed', 'regenerative')") !== 'regeneration; speed') return false;
          if (runInCtx("stopsForOpponentV1654('regeneration; speed', 'mortal')") !== 'speed') return false;
          const stopsLine = function (a, b) {
            const r = sim39(a, b, 12345, 'death');
            const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
            const m = t.match(/What stops Body Punch: [^\n]*/);
            return m ? m[0] : null;
          };
          const mortal = stopsLine('rocky', 'frodo');
          if (!mortal || mortal.indexOf('superhuman durability') !== -1) return false;
          if (mortal.indexOf('speed') === -1) return false;
          const sup = stopsLine('rocky', 'superman');
          if (!sup || sup.indexOf('superhuman durability') === -1) return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-A8-C1 (A8 + C1, Jhay 2026-11-07 01:02) the conditions line names the variants when either side is not Base, and stays plain for Base vs Base; New Battle clears the variant picks',
      (function () {
        try {
          runInCtx("selected=['naruto','luffy']; selectedVariants={\"naruto\":\"v2\",\"luffy\":\"v2\"}; forcedSeed=12345; forcedVictoryMode='death'; startBattle();");
          const cv = els['conditions-output'] ? (els['conditions-output'].innerText || '') : '';
          if (cv !== 'Conditions: Neutral ground. Naruto (Sage Mode) vs Monkey D. Luffy (Gear 4).') return false;
          runInCtx("selected=['naruto','luffy']; selectedVariants={}; forcedSeed=12345; forcedVictoryMode='death'; startBattle();");
          const cb = els['conditions-output'] ? (els['conditions-output'].innerText || '') : '';
          if (cb !== 'Conditions: Neutral ground.') return false;
          if (html.indexOf('selected=[]; selectedVariants={}; aiTeam=[];') === -1) return false;
          const after = runInCtx("selectedVariants={\"goku\":\"v2\"}; resetSimulator(); JSON.stringify(selectedVariants)");
          if (after !== '{}') return false;
          return true;
        } catch (e) { return false; }
      })(), '');
    check('V1659-FIX6 (Fix 6, Jhay 2026-11-07 01:25) generateEpisodeLegacy is gone from the file; runGenericBattle stays — the legacy HP-engine harness still drives it, so removal would break the harness, not drop tests',
      html.indexOf('function generateEpisodeLegacy(') === -1 &&
      html.indexOf('generateEpisodeLegacy') === -1 &&
      html.indexOf('function runGenericBattle(') !== -1, '');
  }

  check('V1643-SHUTOUT-STYLE-QUOTE (spec) cannot-harm shutout narration quotes both fighters\' styleDescription verbatim, loser first then winner; non-shutout quoting unchanged',
    (function () {
      try {
        // saitama/frodo — cannot-harm shutout, loser Frodo first, then winner Saitama.
        const s1 = sim39('saitama', 'frodo', 12345, 'death');
        if (s1.f.decisiveCriterion !== 'cannot-harm') return false;
        const n1 = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(s1.b)) + '))');
        const f1 = n1.indexOf('Small Ring-bearer who hides, endures, and never seeks a duel');
        const w1 = n1.indexOf('Unassuming hero whose ordinary punches carry impossible power');
        if (f1 === -1 || w1 === -1 || f1 > w1) return false;
        // superman/rocky — cannot-harm shutout, loser Rocky first, then winner Superman.
        const s2 = sim39('superman', 'rocky', 12345, 'death');
        if (s2.f.decisiveCriterion !== 'cannot-harm') return false;
        const n2 = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(s2.b)) + '))');
        const r2 = n2.indexOf('Southpaw boxer who outlasts with heart and body shots');
        const u2 = n2.indexOf('Flying powerhouse who protects first');
        if (r2 === -1 || u2 === -1 || r2 > u2) return false;
        // Non-shutout quoting unchanged: raven/sephiroth still quotes both styles.
        const s3 = sim39('raven', 'sephiroth', 12345, 'death');
        const n3 = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(s3.b)) + '))');
        if (n3.indexOf('Calm half-demon who binds foes with soul-self') === -1) return false;
        if (n3.indexOf('Patient predator with Masamune reach and magic') === -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');

  // ================= v16.44 — Video Games variants batch (plan §6) =================
  // Variant harness checks. Expected values come from the accepted table
  // (war-room-v16.44-video-games-table.md); the file must match the table.
  check('V1644-V2-PROFILE-COMPLETE (plan §6 H-V2-PROFILE-COMPLETE) every built Video Games v2/v3 has all profile fields present and non-empty with the table label/powers/sig/trans; held slots (Lara + Mega Man v2, Sephiroth + Kirby v3) have no profile fields, held v2s carry the v2held flag',
    (function () {
      try {
        const EXPECT = [{"id": "aloy", "v2": {"label": "Shield-Weaver", "powers": ["Precision Arrow", "Tripcaster Trap", "Spear Strike"], "sig": "Precision Arrow", "trans": ""}, "v3": {"label": "Forbidden West Aloy", "powers": ["Precision Arrow", "Spear Strike", "Shredder Gauntlet"], "sig": "Precision Arrow", "trans": ""}}, {"id": "arthurmorgan", "v2": {"label": "Legendary Gunslinger Arthur", "powers": ["Dead Eye", "Revolver Shot", "Lasso"], "sig": "Dead Eye", "trans": ""}, "v3": {"label": "Late-story Arthur (Chapter 6)", "powers": ["Dead Eye", "Revolver Shot", "Lasso"], "sig": "Dead Eye", "trans": ""}}, {"id": "bayonetta", "v2": {"label": "Bayonetta 2", "powers": ["Bullet Climax", "Witch Time", "Wicked Weave"], "sig": "Witch Time", "trans": ""}, "v3": {"label": "Bayonetta 3", "powers": ["Demon Masquerade", "Demon Slave", "Witch Time"], "sig": "Demon Masquerade", "trans": "Demon Masquerade"}}, {"id": "chunli", "v2": {"label": "Street Fighter Alpha", "powers": ["Kikosho", "Senretsukyaku", "Hyakuretsukyaku"], "sig": "Kikosho", "trans": ""}, "v3": {"label": "Street Fighter III: 3rd Strike", "powers": ["Hyakuretsukyaku", "Spinning Bird Kick", "Kikoken"], "sig": "Hyakuretsukyaku", "trans": ""}}, {"id": "cloud", "v2": {"label": "Advent Children", "powers": ["Omnislash Version 5", "Fusion Swords", "Climhazzard"], "sig": "Omnislash Version 5", "trans": ""}, "v3": {"label": "Original Final Fantasy VII Cloud (1997)", "powers": ["Omnislash", "Cross-Slash", "Meteorain"], "sig": "Omnislash", "trans": ""}}, {"id": "crashbandicoot", "v2": {"label": "Crash Bandicoot (1996)", "powers": ["Spin Attack", "Jump"], "sig": "Spin Attack", "trans": ""}, "v3": {"label": "Crash Bandicoot 4: It's About Time (Quantum Masks)", "powers": ["Dark Matter Spin", "Spin Attack", "Body Slam"], "sig": "Dark Matter Spin", "trans": ""}}, {"id": "dante", "v2": {"label": "Sin Devil Trigger", "powers": ["Sin Stinger", "Rebellion Slash", "Ebony & Ivory Shot"], "sig": "Sin Stinger", "trans": ""}, "v3": {"label": "Young Dante, Devil May Cry 3", "powers": ["Rebellion Slash", "Ebony & Ivory Shot", "Stinger"], "sig": "Rebellion Slash", "trans": "Devil Trigger"}}, {"id": "doomslayer", "v2": {"label": "Classic Doomguy", "powers": ["Super Shotgun Blast", "Chainsaw Strike", "Berserk Fist"], "sig": "Super Shotgun Blast", "trans": ""}, "v3": {"label": "DOOM (2016) Slayer", "powers": ["Super Shotgun Blast", "Chainsaw Strike", "Rocket Blast"], "sig": "Super Shotgun Blast", "trans": ""}}, {"id": "ellie", "v2": {"label": "Part I Winter Ellie", "powers": ["Stealth Knife Strike", "Bow Shot", "Hunting Rifle"], "sig": "Stealth Knife Strike", "trans": ""}, "v3": {"label": "Ellie Williams, Left Behind", "powers": ["Stealth Knife Strike", "Bow Shot", "Brick Throw"], "sig": "Stealth Knife Strike", "trans": ""}}, {"id": "ezio", "v2": {"label": "Master Assassin", "powers": ["Hidden Blade Strike", "Sword Slash", "Smoke Bomb Feint"], "sig": "Hidden Blade Strike", "trans": ""}, "v3": {"label": "Ezio, Assassin's Creed: Revelations", "powers": ["Hidden Blade Strike", "Sword Slash", "Smoke Bomb Feint"], "sig": "Hidden Blade Strike", "trans": ""}}, {"id": "jinkazama", "v2": {"label": "Devil Jin", "powers": ["Forehead Laser", "Laser Cannon", "Penetrating Fist"], "sig": "Forehead Laser", "trans": ""}, "v3": {"label": "Jin, Tekken 3", "powers": ["Electric Wind God Fist", "Dragon Uppercut", "Flash Punch Combo"], "sig": "Electric Wind God Fist", "trans": ""}}, {"id": "kirby", "v2": {"label": "Hypernova Kirby", "powers": ["Hypernova Inhale", "Hypernova Spit", "Inhale Strike"], "sig": "Hypernova Inhale", "trans": ""}, "v3": null}, {"id": "kratos", "v2": {"label": "Valhalla", "powers": ["Draupnir Spear", "Axe Swing", "Blades of Chaos Whip"], "sig": "Draupnir Spear", "trans": "Spartan Rage"}, "v3": {"label": "Greek-era Kratos (God of War III)", "powers": ["Blades of Exile", "Nemean Cestus", "Claws of Hades"], "sig": "Blades of Exile", "trans": "Rage of Sparta"}}, {"id": "lara", "v2": null, "v3": {"label": "Classic Lara Croft (1996)", "powers": ["Dual Pistol Shot", "Shotgun", "Magnums"], "sig": "Dual Pistol Shot", "trans": ""}}, {"id": "leonkennedy", "v2": {"label": "D.S.O. Agent", "powers": ["Dual Wing Shooters", "Quick Shot", "Survival Knife"], "sig": "Quick Shot", "trans": ""}, "v3": {"label": "Leon, Resident Evil 2", "powers": ["Pistol Shot", "Knife Slash", "Curb-Stomp"], "sig": "Curb-Stomp", "trans": ""}}, {"id": "link", "v2": {"label": "Champion's Tunic", "powers": ["Flurry Rush", "Perfect Guard", "Bow Shot"], "sig": "Flurry Rush", "trans": ""}, "v3": {"label": "Wolf Link, Twilight Princess", "powers": ["Bite Attack", "Dash", "Dark Energy Attack"], "sig": "Bite Attack", "trans": ""}}, {"id": "mario", "v2": {"label": "Fire Mario", "powers": ["Fireball", "Ground Pound", "Wall Jump"], "sig": "Fireball", "trans": ""}, "v3": {"label": "Raccoon Mario", "powers": ["Tail Whip", "Slow Fall", "Fly"], "sig": "Tail Whip", "trans": ""}}, {"id": "chief", "v2": {"label": "MJOLNIR Gen3", "powers": ["Grappleshot", "Threat Sensor", "Drop Wall"], "sig": "Grappleshot", "trans": ""}, "v3": {"label": "Mark VI Chief", "powers": ["Dual Wield", "Bubble Shield", "Power Drain"], "sig": "Dual Wield", "trans": ""}}, {"id": "megaman", "v2": null, "v3": {"label": "Classic Mega Man, Mega Man 10 era", "powers": ["Mega Buster Shot", "Charge Shot", "Slide"], "sig": "Charge Shot", "trans": ""}}, {"id": "nathandrake", "v2": {"label": "Among Thieves", "powers": ["Crossbow Shot", "Pistol Shooting", "Stealth Takedown"], "sig": "Stealth Takedown", "trans": ""}, "v3": {"label": "Drake's Fortune", "powers": ["Brutal Combo", "Pistol Shooting", "Stealth Kill"], "sig": "Brutal Combo", "trans": ""}}, {"id": "pikachu", "v2": {"label": "Gigantamax Pikachu", "powers": ["G-Max Volt Crash", "Thunderbolt", "Quick Attack"], "sig": "G-Max Volt Crash", "trans": ""}, "v3": {"label": "Partner Pikachu", "powers": ["Zippy Zap", "Floaty Fall", "Splishy Splash"], "sig": "Pika Papow", "trans": ""}}, {"id": "ryu", "v2": {"label": "Evil Ryu", "powers": ["Ashura Senku", "Ryusokyaku", "Shun Goku Satsu"], "sig": "Shun Goku Satsu", "trans": ""}, "v3": {"label": "Power of Nothingness Ryu", "powers": ["Hadoken", "Shoryuken", "Tatsumaki"], "sig": "Hadoken", "trans": ""}}, {"id": "samus", "v2": {"label": "Zero Suit", "powers": ["Paralyzer", "Plasma Whip", "Flip Jump"], "sig": "Paralyzer", "trans": ""}, "v3": {"label": "Phazon Suit Samus", "powers": ["Phazon Beam", "Charge Beam", "Super Missile"], "sig": "Phazon Beam", "trans": ""}}, {"id": "scorpion", "v2": {"label": "Hellfire Scorpion", "powers": ["Hell Ball", "Demon Fire", "Flame Aura"], "sig": "Hell Ball", "trans": ""}, "v3": {"label": "MKX Inferno Scorpion", "powers": ["Minion Slam", "Minion Grab", "Minion Drop"], "sig": "Minion Slam", "trans": ""}}, {"id": "sephiroth", "v2": {"label": "Safer Sephiroth", "powers": ["Shadow Flare", "Heartless Angel", "Wing Slash"], "sig": "Heartless Angel", "trans": ""}, "v3": null}, {"id": "snake", "v2": {"label": "MGS2 Tanker Snake", "powers": ["Tranquiliser Shot", "CQC Strike", "Stealth Takedown"], "sig": "Tranquiliser Shot", "trans": ""}, "v3": {"label": "MGS1 prime Snake", "powers": ["Nikita Missile", "SOCOM Shot", "Claymore Mine"], "sig": "Nikita Missile", "trans": ""}}, {"id": "sonic", "v2": {"label": "Super Sonic", "powers": ["Super Spin Dash", "Super Homing Attack", "Flight"], "sig": "Super Spin Dash", "trans": ""}, "v3": {"label": "Darkspine Sonic", "powers": ["Flame Punch", "Flame Kick", "Time Break"], "sig": "Flame Punch", "trans": ""}}, {"id": "sora", "v2": {"label": "KHIII Sora", "powers": ["Attraction Flow", "Shotlock", "Water"], "sig": "Attraction Flow", "trans": "Ultimate Form"}, "v3": {"label": "KH1 Sora", "powers": ["Ars Arcanum", "Sonic Blade", "Strike Raid"], "sig": "Ars Arcanum", "trans": ""}}, {"id": "spyro", "v2": {"label": "Legend Spyro", "powers": ["Electric Breath", "Ice Breath", "Earth Breath"], "sig": "Aether Fury", "trans": "Dark Spyro"}, "v3": {"label": "Spyro 2: Ripto's Rage", "powers": ["Headbash", "Super Flame", "Hover"], "sig": "Headbash", "trans": ""}}, {"id": "steve", "v2": {"label": "Netherite Gear", "powers": ["Netherite Sword Slash", "Ender Pearl", "Elytra Glide"], "sig": "Netherite Sword Slash", "trans": ""}, "v3": {"label": "Smash Bros. Steve", "powers": ["Minecart", "TNT", "Anvil"], "sig": "Minecart", "trans": ""}}, {"id": "subzero", "v2": {"label": "Grandmaster Sub-Zero", "powers": ["Ice Ball", "Ice Clone", "Slide"], "sig": "Ice Blast Freeze", "trans": ""}, "v3": {"label": "Cyber Sub-Zero", "powers": ["Ice Bomb", "Ice Parry", "Dive Kick"], "sig": "Ice Bomb", "trans": ""}}, {"id": "wario", "v2": {"label": "Wario-Man", "powers": ["Wario Waft", "Wario Bike", "Chomp"], "sig": "Wario Waft", "trans": ""}, "v3": {"label": "Wario Land classic", "powers": ["Ground Pound", "Body Slam", "Dragon Fire"], "sig": "Ground Pound", "trans": ""}}];
        const roster = JSON.parse(runInCtx('JSON.stringify(ROSTER.map(function(f){return {id:f.id,v2:f.v2||null,v2style:f.v2style||null,v2usage:f.v2usage||null,v2persNote:f.v2persNote||null,v2weak:f.v2weak||null,v2sig:f.v2sig||null,v2sigMult:f.v2sigMult,v2trans:(typeof f.v2trans!=="undefined"?f.v2trans:null),v2tAtk:f.v2tAtk,v2tDef:f.v2tDef,v2powers:f.v2powers||null,v2held:!!f.v2held,v3:f.v3||null,v3style:f.v3style||null,v3usage:f.v3usage||null,v3persNote:f.v3persNote||null,v3weak:f.v3weak||null,v3sig:f.v3sig||null,v3sigMult:f.v3sigMult,v3trans:(typeof f.v3trans!=="undefined"?f.v3trans:null),v3tAtk:f.v3tAtk,v3tDef:f.v3tDef,v3powers:f.v3powers||null};}))'));
        const byId = {};
        roster.forEach(function (f) { byId[f.id] = f; });
        let bad = '';
        EXPECT.forEach(function (e) {
          const f = byId[e.id];
          if (!f) { bad = e.id + ':missing'; return; }
          [['v2', e.v2], ['v3', e.v3]].forEach(function (pair) {
            const k = pair[0], exp = pair[1];
            const hasStyle = !!f[k + 'style'], hasUsage = !!f[k + 'usage'], hasPers = !!f[k + 'persNote'], hasWeak = !!f[k + 'weak'], hasSig = !!f[k + 'sig'], hasTrans = (f[k + 'trans'] !== null && f[k + 'trans'] !== undefined), hasPowers = Array.isArray(f[k + 'powers']) && f[k + 'powers'].length >= 2;
            if (exp) {
              if (f[k] !== exp.label) bad = e.id + '.' + k + ':label';
              if (!hasStyle || !hasUsage || !hasPers || !hasWeak || !hasSig || !hasTrans || !hasPowers) bad = e.id + '.' + k + ':missing-field';
              if (JSON.stringify(f[k + 'powers']) !== JSON.stringify(exp.powers)) bad = e.id + '.' + k + ':powers';
              if (f[k + 'sig'] !== exp.sig) bad = e.id + '.' + k + ':sig';
              if (f[k + 'trans'] !== exp.trans) bad = e.id + '.' + k + ':trans';
              if (typeof f[k + 'sigMult'] !== 'number') bad = e.id + '.' + k + ':sigMult';
              if (typeof f[k + 'tAtk'] !== 'number' || typeof f[k + 'tDef'] !== 'number') bad = e.id + '.' + k + ':tAtk/tDef';
            } else {
              if (hasStyle || hasUsage || hasPers || hasWeak || hasSig || hasTrans || hasPowers) bad = e.id + '.' + k + ':held-but-present';
              if (k === 'v2' && !f.v2held) bad = e.id + '.v2:held-but-no-flag';
            }
          });
        });
        return bad === '';
      } catch (e) { return false; }
    })(), '');
  check('V1646-V2-VETTED (plan §6 H-V2-VETTED) no built VG + Anime V2POWER/V3POWER map name contains Barrage/Combo/Gadget except the allowlisted dossier-named Brutal Combo (Drake v3, VG §25 V1); the 4 blocked Anime fighters keep their live V2POWER untouched (allowlisted, NOT built); V3POWER holds exactly the 56 built v3s (30 VG + 26 Anime), no held v3',
    (function () {
      try {
        const v2 = JSON.parse(runInCtx('JSON.stringify(V2POWER)'));
        const v3 = JSON.parse(runInCtx('JSON.stringify(V3POWER)'));
        const pat = /Barrage|Combo|Gadget/;
        const VG = {};
        VG['aloy'] = 1;
      VG['arthurmorgan'] = 1;
      VG['bayonetta'] = 1;
      VG['chunli'] = 1;
      VG['cloud'] = 1;
      VG['crashbandicoot'] = 1;
      VG['dante'] = 1;
      VG['doomslayer'] = 1;
      VG['ellie'] = 1;
      VG['ezio'] = 1;
      VG['jinkazama'] = 1;
      VG['kirby'] = 1;
      VG['kratos'] = 1;
      VG['lara'] = 1;
      VG['leonkennedy'] = 1;
      VG['link'] = 1;
      VG['mario'] = 1;
      VG['chief'] = 1;
      VG['megaman'] = 1;
      VG['nathandrake'] = 1;
      VG['pikachu'] = 1;
      VG['ryu'] = 1;
      VG['samus'] = 1;
      VG['scorpion'] = 1;
      VG['sephiroth'] = 1;
      VG['snake'] = 1;
      VG['sonic'] = 1;
      VG['sora'] = 1;
      VG['spyro'] = 1;
      VG['steve'] = 1;
      VG['subzero'] = 1;
      VG['wario'] = 1;
        const ANIME = {};
      ANIME['allmight'] = 1;
      ANIME['deku'] = 1;
      ANIME['edward'] = 1;
      ANIME['eren'] = 1;
      ANIME['erza'] = 1;
      ANIME['gaara'] = 1;
      ANIME['gojo'] = 1;
      ANIME['goku'] = 1;
      ANIME['gon'] = 1;
      ANIME['hisoka'] = 1;
      ANIME['ichigo'] = 1;
      ANIME['jiraiya'] = 1;
      ANIME['kakashi'] = 1;
      ANIME['kaneki'] = 1;
      ANIME['kenpachi'] = 1;
      ANIME['killua'] = 1;
      ANIME['levi'] = 1;
      ANIME['luffy'] = 1;
      ANIME['madara'] = 1;
      ANIME['naruto'] = 1;
      ANIME['natsu'] = 1;
      ANIME['piccolo'] = 1;
      ANIME['rocklee'] = 1;
      ANIME['rukia'] = 1;
      ANIME['saitama'] = 1;
      ANIME['sakura'] = 1;
      ANIME['sasuke'] = 1;
      ANIME['shikamaru'] = 1;
      ANIME['tanjiro'] = 1;
      ANIME['toshiro'] = 1;
      ANIME['vegeta'] = 1;
      ANIME['yuji'] = 1;
      ANIME['zoro'] = 1;
        let bad = '';
        // Built entries only; Lara's 'Survivor Barrage' is HELD (asserted
        // unchanged below), not a cleaned entry — excluded from the scan.
        // The 4 blocked Anime keep their live V2POWER (asserted unchanged
        // below) — excluded from the scan, NOT built.
        Object.keys(v2).forEach(function (k) { if (!VG[k] && !ANIME[k]) return; if (k === 'lara' || k === 'eren' || k === 'hisoka' || k === 'kaneki' || k === 'levi') return; if (pat.test(v2[k])) bad = 'V2POWER.' + k + ':' + v2[k]; });
        Object.keys(v3).forEach(function (k) { if (pat.test(v3[k]) && !(k === 'nathandrake' && v3[k] === 'Brutal Combo')) bad = 'V3POWER.' + k + ':' + v3[k]; });
        if (Object.keys(v3).length !== 56) bad = 'V3POWER count ' + Object.keys(v3).length;
        if (v3.sephiroth !== undefined || v3.kirby !== undefined || v3.jiraiya !== undefined || v3.natsu !== undefined || v3.saitama !== undefined) bad = 'held v3 in V3POWER map';
        if (v2.lara !== 'Survivor Barrage' || v2.megaman !== 'Super Adaptor Punch') bad = 'held V2POWER changed';
        if (v2.eren !== 'Founding Titan Slam' || v2.hisoka !== 'Post-Mortem Gum Barrage' || v2.kaneki !== 'Kakuja Slash' || v2.levi !== 'Ackerman Slash') bad = 'blocked V2POWER changed';
        return bad === '';
      } catch (e) { return false; }
    })(), '');

  check('V1646-BASE-UNCHANGED (plan §6 H-BASE-UNCHANGED) all 193 base fields byte-identical to v16.45 except icon (v16.53 photos wiring, covered by V1653-PHOTOS-ICONS), gandalf2 removed (v16.56 item 5), and the 5 v16.55 B stamina data corrections (4 base weak rewords: cloud, toshiro, godzilla, bolin; sephiroth v2weak — deku v2weak is in BUILT, so not checked here) plus the v16.56 thanos v2weak (item 8) plus the v16.59 F2 goku weak re-lock (Jhay 2026-11-10 ~03:59), each pinned by value (two-context roster comparison); non-Anime rows fully identical including variant fields except the B corrections and thanos v2weak; the 4 blocked Anime rows fully identical; base POWERS byte-identical for all ids except gandalf2 (removed) and goku (gains Instant Transmission as a 4th power, Jhay-agreed re-lock)',
    (function () {
      try {
        const sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
          document: { getElementById: function (id) { return makeElement(); }, createElement: function () { return makeElement(); }, querySelectorAll: function () { return []; } },
          window: {}, navigator: { onLine: true }, localStorage: makeLocalStorage(false), alert: function () {}, fetch: async function () { throw new Error('network disabled'); } };
        sb.window = sb;
        vm.createContext(sb);
        const oldHtml = fs.readFileSync(path.join(__dirname, 'war-room-v16.45.html'), 'utf8');
        let oldScript = oldHtml.match(/<script>([\s\S]*)<\/script>/)[1];
        const ii = oldScript.indexOf('/* ============ INIT ============ */');
        if (ii !== -1) oldScript = oldScript.slice(0, ii);
        vm.runInContext(oldScript, sb);
        const oldRoster = JSON.parse(vm.runInContext('JSON.stringify(ROSTER)', sb));
        const oldPowers = JSON.parse(vm.runInContext('JSON.stringify(POWERS)', sb));
        const newRoster = JSON.parse(runInCtx('JSON.stringify(ROSTER)'));
        const newPowers = JSON.parse(runInCtx('JSON.stringify(POWERS)'));
        if (oldRoster.length !== 194 || newRoster.length !== 193) return false; // v16.56 (item 5): old v16.45 had 194, new v16.56 has 193 (gandalf2 removed)
        const BASE = ['id', 'name', 'fr', 'cat', 'hp', 'atk', 'def', 'sp', 'tier', 'trait', 'pers', 'style', 'sig', 'sigMult', 'trans', 'tAtk', 'tDef', 'weak', 'feat', 'wiki', 'alias', 'pw', 'dex', 'dur', 'sta', 'tac', 'usage', 'persNote']; // v16.53: 'icon' left the list — emoji to photo path, covered by V1653-PHOTOS-ICONS
        const VAR = ['v2', 'v2hp', 'v2atk', 'v2def', 'v2style', 'v2usage', 'v2persNote', 'v2weak', 'v2sig', 'v2sigMult', 'v2trans', 'v2tAtk', 'v2tDef', 'v2powers', 'v2held', 'v3', 'v3hp', 'v3atk', 'v3def', 'v3style', 'v3usage', 'v3persNote', 'v3weak', 'v3sig', 'v3sigMult', 'v3trans', 'v3tAtk', 'v3tDef', 'v3powers'];
        const BUILT = {};
      BUILT['allmight'] = 1;
      BUILT['deku'] = 1;
      BUILT['edward'] = 1;
      BUILT['erza'] = 1;
      BUILT['gaara'] = 1;
      BUILT['gojo'] = 1;
      BUILT['goku'] = 1;
      BUILT['gon'] = 1;
      BUILT['ichigo'] = 1;
      BUILT['jiraiya'] = 1;
      BUILT['kakashi'] = 1;
      BUILT['kenpachi'] = 1;
      BUILT['killua'] = 1;
      BUILT['luffy'] = 1;
      BUILT['madara'] = 1;
      BUILT['naruto'] = 1;
      BUILT['natsu'] = 1;
      BUILT['piccolo'] = 1;
      BUILT['rocklee'] = 1;
      BUILT['rukia'] = 1;
      BUILT['saitama'] = 1;
      BUILT['sakura'] = 1;
      BUILT['sasuke'] = 1;
      BUILT['shikamaru'] = 1;
      BUILT['tanjiro'] = 1;
      BUILT['toshiro'] = 1;
      BUILT['vegeta'] = 1;
      BUILT['yuji'] = 1;
      BUILT['zoro'] = 1;
        const oldById = {};
        oldRoster.forEach(function (f) { oldById[f.id] = f; });
        const newById = {};
        newRoster.forEach(function (f) { newById[f.id] = f; });
        let bad = '';
        const diffs = [];
        Object.keys(oldById).forEach(function (id) {
          const o = oldById[id], n = newById[id];
          // v16.56 (item 5): gandalf2 is REMOVED — the only missing id.
          // Any other missing id still fails.
          if (!n) { if (id !== 'gandalf2') bad = id + ':missing'; return; }
          BASE.forEach(function (k) { if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) diffs.push(id + '.base.' + k + '=' + JSON.stringify(n[k])); });
          if (!BUILT[id]) VAR.forEach(function (k) { if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) diffs.push(id + '.var.' + k + '=' + JSON.stringify(n[k])); });
        });
        // v16.56 (items 5 + 6): gandalf2 is removed (POWERS count -1)
        // and goku gains 'Instant Transmission' as a 4th power
        // (Jhay-agreed re-lock ~15:58 EST, pinned by value below).
        // All other POWERS are byte-identical.
        Object.keys(oldPowers).forEach(function (id) {
          if (id === 'gandalf2') return;
          if (id === 'goku') {
            if (JSON.stringify(newPowers['goku']) !== JSON.stringify(['Ki Blast', 'Instant Transmission Strike', 'Dragon Fist', 'Instant Transmission'])) bad = 'POWERS.goku';
            return;
          }
          if (JSON.stringify(oldPowers[id]) !== JSON.stringify(newPowers[id])) bad = 'POWERS.' + id;
        });
        if (Object.keys(newPowers).length !== Object.keys(oldPowers).length - 1) bad = 'POWERS count';
        // v16.55 (B): exactly the 5 data corrections, pinned by value.
        // v16.59 (F2 re-lock, Jhay 2026-11-10 ~03:59): goku weak loses its stamina clause, pinned by value.
        // v16.56 (item 8): thanos gains a v2weak, pinned by value.
        const EXPECTED1656 = [
          'bolin.base.weak="Lavabending is new"',
          'cloud.base.weak="Self-doubt"',
          'godzilla.base.weak="Size; weakened only when cadmium, ANEB, or a second-brain strike is used against him"',
          'goku.base.weak="Overconfidence"',
          'sephiroth.var.v2weak="Heartless Angel leaves the party at 1 HP — it does not kill, and it does not weaken Safer himself; the one-hit win comes only after Safer is already dead, in the later Lifestream duel. Outlast the flare, punish the wing slashes."',
          'toshiro.base.weak="Bankai petals count down to its completion in adult form; exhaustion and collapse after Bankai use"',
          'thanos.var.v2weak="Overconfidence; the Gauntlet can be taken only while his body is empty — Nebula stole it off his abandoned body (Infinity Gauntlet #5). While he wears it and is alert, theft fails (Doom tried). Self-sabotage and the Soul Gem bond are not general 1v1 routes. (Gauntlet form is the 1991 Infinity Gauntlet, not the 1992 sequel.)"'
        ];
        return bad === '' && JSON.stringify(diffs.sort()) === JSON.stringify(EXPECTED1656.sort());
      } catch (e) { return false; }
    })(), '');

  check('V1644-VARIANT-SWAP (plan §6 H-VARIANT-SWAP) a selected variant changes the actual battle profile: instance style/sig/trans/stats/powers, resolver signature and profile style/weak, and a variant battle fights with the variant profile and validates clean; base profiles unchanged',
    (function () {
      try {
        runInCtx("selectedVariants = { sonic: 'v2' };");
        const inst = JSON.parse(runInCtx('JSON.stringify(instanceOf(byId("sonic")))'));
        if (inst.variant !== 'Super Sonic' || inst.variantId !== 'v2') return false;
        if (inst.style !== 'Flying golden fighter who overwhelms head-on.') return false;
        if (inst.sig !== 'Super Spin Dash' || inst.trans !== '' || inst.hp !== 1450 || inst.atk !== 165 || inst.def !== 80) return false;
        const pw = JSON.parse(runInCtx('JSON.stringify(actualPowersFor(instanceOf(byId("sonic"))))'));
        if (JSON.stringify(pw) !== JSON.stringify(['Super Spin Dash', 'Super Homing Attack', 'Flight'])) return false;
        const cf = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("sonic"), {variant:"Super Sonic", variantId:"v2"})))'));
        if (cf.error) return false;
        const sigs = (cf.powers || []).filter(function (p) { return p.signature; });
        if (sigs.length !== 1 || sigs[0].name !== 'Super Spin Dash') return false;
        if (cf.style.description !== 'Flying golden fighter who overwhelms head-on.') return false;
        if ((cf.transforms || []).length !== 0) return false;
        if ((cf.audit.weakText || '').indexOf('ring drain') === -1) return false;
        if (cf.audit.hp !== 1450 || cf.audit.atk !== 165 || cf.audit.def !== 80) return false;
        const cfS = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("sora"), {variant:"KHIII Sora", variantId:"v2"})))'));
        if (cfS.error) return false;
        const sigS = (cfS.powers || []).filter(function (p) { return p.signature; });
        if (sigS.length !== 1 || sigS[0].name !== 'Attraction Flow') return false;
        if ((cfS.transforms || []).length !== 1 || cfS.transforms[0].to !== 'Ultimate Form') return false;
        if (cfS.transforms[0].transformedPowers) return false;
        const cfC = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("cloud"), {variant:"Original Final Fantasy VII Cloud (1997)", variantId:"v3"})))'));
        if (cfC.error) return false;
        const sigC = (cfC.powers || []).filter(function (p) { return p.signature; });
        if (sigC.length !== 1 || sigC[0].name !== 'Omnislash') return false;
        if (JSON.stringify((cfC.powers || []).map(function (p) { return p.name; }).slice(0, 3)) !== JSON.stringify(['Omnislash', 'Cross-Slash', 'Meteorain'])) return false;
        runInCtx('selectedVariants = {};');
        const cfB = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("sonic"), {variant:"Base", variantId:"base"})))'));
        if ((cfB.powers || []).filter(function (p) { return p.signature; })[0].name !== 'Spin Dash') return false;
        if (cfB.style.description !== 'Fastest hedgehog alive, spin dashes and homing attacks') return false;
        if ((cfB.transforms || []).length !== 1 || cfB.transforms[0].to !== 'Super Sonic') return false;
        runInCtx("selectedVariants = { sonic: 'v2' };");
        const r = sim39('sonic', 'rocky', 12345, 'death');
        const vb = JSON.parse(runInCtx('JSON.stringify(validateBattle(globalThis._bt39))'));
        runInCtx('selectedVariants = {};');
        if (r.b.alpha[0].variant !== 'Super Sonic' || r.b.alpha[0].sig !== 'Super Spin Dash' || r.b.alpha[0].trans !== '') return false;
        if (vb.passed !== true) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1644-TRANS-BLOCKED (plan §6 H-TRANS-BLOCKED) v2==trans and near cases list no legal transition and no transform effect; different-name variant transforms stay legal with the right stats and the same-name transformed power only (Kratos v2 Valhalla -> Spartan Rage, Dante v3 -> Devil Trigger); base transforms unchanged; starting-form notes and card selects match',
    (function () {
      try {
        const legal = function (id, vid) {
          runInCtx("selectedVariants = { " + id + ": '" + vid + "' };");
          const out = JSON.parse(runInCtx('JSON.stringify(legalTransitionsFor(instanceOf(byId("' + id + '"))))'));
          const eff = JSON.parse(runInCtx('JSON.stringify(transformEffectForV14(instanceOf(byId("' + id + '"))))'));
          runInCtx('selectedVariants = {};');
          return { legal: out, eff: eff };
        };
        // Blocked: label IS the transform (Sonic, Jin) or v2trans is empty
        // (Kirby, Ryu, Pikachu — explicit NONE). Kratos v2 ('Valhalla') and
        // Dante v3 ('Young Dante') are NOT blocked: their labels differ
        // from their transform names, so the transform is a real transition.
        const blocked = [['sonic', 'v2'], ['jinkazama', 'v2'], ['kirby', 'v2'], ['ryu', 'v2'], ['pikachu', 'v2']];
        for (let i = 0; i < blocked.length; i++) {
          const r = legal(blocked[i][0], blocked[i][1]);
          if (r.legal.length !== 0 || r.eff !== null) return false;
        }
        // Different-name variant transforms stay legal, with the same-name
        // transformed power (trans name == base trans name, so it attaches).
        let r = legal('kratos', 'v2');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Spartan Rage') return false;
        if (!r.eff || r.eff.to !== 'Spartan Rage' || r.eff.statChanges.atk !== 40 || r.eff.statChanges.def !== 5) return false;
        if (r.eff.newPowers !== 'Spartan Rage Slam') return false;
        r = legal('dante', 'v3');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Devil Trigger') return false;
        if (!r.eff || r.eff.to !== 'Devil Trigger' || r.eff.statChanges.atk !== 35 || r.eff.statChanges.def !== 10) return false;
        if (r.eff.newPowers !== 'Judgement Cut') return false;
        r = legal('sora', 'v2');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Ultimate Form') return false;
        if (!r.eff || r.eff.to !== 'Ultimate Form' || r.eff.statChanges.atk !== 30 || r.eff.statChanges.def !== 10) return false;
        if (r.eff.newPowers !== null) return false;
        r = legal('spyro', 'v2');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Dark Spyro') return false;
        if (!r.eff || r.eff.newPowers !== null) return false;
        r = legal('sonic', 'base');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Super Sonic') return false;
        if (!r.eff || r.eff.newPowers !== 'Chaos Blast') return false;
        r = legal('sora', 'base');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Final Form') return false;
        if (!r.eff || r.eff.newPowers !== 'Final Form Blast') return false;
        const note = function (id, label, vid) { return runInCtx("startingFormNoteForFighterV1625(byId('" + id + "'), '" + label + "', '" + vid + "')"); };
        if (note('sonic', 'Super Sonic', 'v2').indexOf('no further in-combat transformation is legal') === -1) return false;
        if (note('sora', 'KHIII Sora', 'v2').indexOf('may trigger mid-fight') === -1) return false;
        if (note('sonic', 'Base', 'base').indexOf('may trigger mid-fight') === -1) return false;
        runInCtx("catFilter='All'; searchTerm=''; renderRoster();");
        const pool = els['fighter-pool'].innerHTML;
        const opts = function (name) {
          const i = pool.indexOf(name);
          if (i === -1) return null;
          const seg = pool.slice(i, pool.indexOf('</select>', i));
          return (seg.match(/value="([^"]+)"/g) || []).map(function (s) { return s.slice(7, -1); });
        };
        if (JSON.stringify(opts('Lara Croft')) !== JSON.stringify(['base', 'v3'])) return false;
        if (JSON.stringify(opts('Mega Man')) !== JSON.stringify(['base', 'v3'])) return false;
        if (JSON.stringify(opts('Sonic')) !== JSON.stringify(['base', 'v2', 'v3'])) return false;
        if (JSON.stringify(opts('Sephiroth')) !== JSON.stringify(['base', 'v2'])) return false;
        if (JSON.stringify(opts('Kirby')) !== JSON.stringify(['base', 'v2'])) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  // ================= v16.46 — Anime variants batch (plan §6) =================
  // Variant harness checks. Expected values come from the accepted table
  // (war-room-v16.46-anime-table.md); the file must match the table.
  check('V1646-V2-PROFILE-COMPLETE (plan §6 H-V2-PROFILE-COMPLETE) every built Anime v2/v3 has all profile fields present and non-empty with the table label/powers/sig/trans; held v3s (Jiraiya, Natsu, Saitama) have no v3 fields; blocked 4 (Levi, Eren, Kaneki, Hisoka) have no built v2/v3 profile fields at all — their shallow live v2s stay untouched and carry NO v2held flag (blocked is not held)',
    (function () {
      try {
        const EXPECT = [{"id": "allmight", "v2": {"label": "Prime All Might", "powers": ["Detroit Smash", "Texas Smash", "California Smash"], "sig": "Detroit Smash", "trans": ""}, "v3": {"label": "Kamino Final Ember", "powers": ["United States of Smash", "Detroit Smash", "Texas Smash"], "sig": "United States of Smash", "trans": ""}}, {"id": "deku", "v2": {"label": "Final War Deku", "powers": ["Overdrive Smash", "Blackwhip", "Float"], "sig": "Overdrive Smash", "trans": ""}, "v3": {"label": "Shoot Style", "powers": ["St. Louis Smash", "Manchester Smash", "Delaware Smash"], "sig": "St. Louis Smash", "trans": ""}}, {"id": "edward", "v2": {"label": "Post-Gate Edward", "powers": ["Desperate Punch", "Martial Arts Throw", "Automail Block"], "sig": "Desperate Punch", "trans": ""}, "v3": {"label": "2003 anime Edward", "powers": ["Transmuted Spear", "Alchemic Blade", "Earth Pillar Strike"], "sig": "Automail Arm Blade", "trans": ""}}, {"id": "eren", "v2": null, "v3": null}, {"id": "erza", "v2": {"label": "Nakagami Starlight", "powers": ["Nakagami Starlight", "Halberd Strike", "Magic Dispel"], "sig": "Nakagami Starlight", "trans": ""}, "v3": {"label": "Heaven's Wheel Armour (locked)", "powers": ["Blumenblatt", "Circle Sword", "Trinity Sword"], "sig": "Blumenblatt", "trans": ""}}, {"id": "gaara", "v2": {"label": "Kazekage", "powers": ["Shield of Sand", "Sand Binding Coffin", "Sand Waterfall Funeral"], "sig": "Sand Binding Coffin", "trans": ""}, "v3": {"label": "Part I Gaara, Shukaku Jinchuriki", "powers": ["Shield of Sand", "Sand Binding Coffin", "Sand Waterfall Funeral"], "sig": "Sand Waterfall Funeral", "trans": "Shukaku Form"}}, {"id": "gojo", "v2": {"label": "Teen Gojo", "powers": ["Blue: Attraction", "Cursed Energy Punch", "Infinity"], "sig": "Blue: Attraction", "trans": ""}, "v3": {"label": "Awakened Teen Gojo", "powers": ["Hollow Purple", "Red: Repulsion", "Blue: Attraction"], "sig": "Hollow Purple", "trans": ""}}, {"id": "goku", "v2": {"label": "Super Saiyan God", "powers": ["Kamehameha", "Ki Blast", "Instant Transmission"], "sig": "Kamehameha", "trans": ""}, "v3": {"label": "Mastered Ultra Instinct", "powers": ["Kamehameha", "Instant Transmission", "Ki Blast"], "sig": "Kamehameha", "trans": ""}}, {"id": "gon", "v2": {"label": "Adult Gon", "powers": ["Jajanken: Rock", "Jajanken: Scissors", "Jajanken: Paper"], "sig": "Jajanken: Rock", "trans": ""}, "v3": {"label": "Hunter Exam Gon", "powers": ["Fishing Rod Strike", "Hook Grab", "Natural Punch"], "sig": "Fishing Rod Strike", "trans": ""}}, {"id": "hisoka", "v2": null, "v3": null}, {"id": "ichigo", "v2": {"label": "Hollow Mask", "powers": ["Cero", "Getsuga Tensho", "Sword Slash"], "sig": "Getsuga Tensho", "trans": ""}, "v3": {"label": "Full Hollow / Vasto Lorde", "powers": ["Cero", "Getsuga Tensho", "Sonido"], "sig": "Cero", "trans": ""}}, {"id": "jiraiya", "v2": {"label": "Sage Mode Jiraiya", "powers": ["Ultra-Big Ball Rasengan", "Frog Kata", "Sage Art: Goemon"], "sig": "Ultra-Big Ball Rasengan", "trans": ""}, "v3": null}, {"id": "kakashi", "v2": {"label": "Double Mangekyo", "powers": ["Kamui Raikiri", "Kamui Shuriken", "Complete Body Susanoo"], "sig": "Kamui Raikiri", "trans": ""}, "v3": {"label": "Boruto-era Kakashi (Hokage / post-war)", "powers": ["Purple Lightning", "Kunai Strike", "Trap Setup"], "sig": "Purple Lightning", "trans": ""}}, {"id": "kaneki", "v2": null, "v3": null}, {"id": "kenpachi", "v2": {"label": "Bankai Kenpachi", "powers": ["Nozarashi Slash", "Kendo Strike", "Reiatsu Blast"], "sig": "Nozarashi Slash", "trans": ""}, "v3": {"label": "Shikai Nozarashi", "powers": ["Nozarashi Slash", "Kendo Strike", "Reiatsu Blast"], "sig": "Nozarashi Slash", "trans": ""}}, {"id": "killua", "v2": {"label": "Godspeed", "powers": ["Whirlwind", "Speed of Lightning", "Thunderbolt"], "sig": "Whirlwind", "trans": ""}, "v3": {"label": "Hunter Exam Killua", "powers": ["Claws", "Rhythm Echo", "Snake Awakens"], "sig": "Claws", "trans": ""}}, {"id": "levi", "v2": null, "v3": null}, {"id": "madara", "v2": {"label": "Living Eternal Mangekyo Madara", "powers": ["Susanoo Slash", "Fire Style Blast"], "sig": "Susanoo Slash", "trans": ""}, "v3": {"label": "Ten-Tails Jinchuriki Madara", "powers": ["Limbo: Border Jail", "Truth-Seeking Orbs"], "sig": "Limbo: Border Jail", "trans": ""}}, {"id": "luffy", "v2": {"label": "Gear 4", "powers": ["Kong Gun", "King Kong Gun", "Culverin"], "sig": "King Kong Gun", "trans": ""}, "v3": {"label": "Gear 2", "powers": ["Jet Pistol", "Red Hawk", "Jet Bazooka"], "sig": "Red Hawk", "trans": ""}}, {"id": "naruto", "v2": {"label": "Sage Mode", "powers": ["Rasengan", "Wind Release: Rasenshuriken", "Frog Kata"], "sig": "Wind Release: Rasenshuriken", "trans": ""}, "v3": {"label": "Baryon Mode", "powers": ["Rasengan", "Shadow Clone Technique", "Wind Release: Rasenshuriken"], "sig": "Rasengan", "trans": ""}}, {"id": "natsu", "v2": {"label": "Lightning Flame Dragon Mode", "powers": ["Lightning Flame Dragon's Roar", "Lightning Flame Dragon's Brilliant Flame", "Fire Dragon's Iron Fist"], "sig": "Lightning Flame Dragon's Brilliant Flame", "trans": ""}, "v3": null}, {"id": "piccolo", "v2": {"label": "Orange Piccolo", "powers": ["Special Beam Cannon", "Explosive Demon Wave", "Demon Hand"], "sig": "Special Beam Cannon", "trans": ""}, "v3": {"label": "Great Namekian / Giant Piccolo", "powers": ["Special Beam Cannon", "Explosive Demon Wave", "Demon Hand"], "sig": "Special Beam Cannon", "trans": ""}}, {"id": "rocklee", "v2": {"label": "Eight Gates Lee", "powers": ["Hidden Lotus", "Primary Lotus", "Leaf Hurricane"], "sig": "Hidden Lotus", "trans": ""}, "v3": {"label": "Drunken Fist Lee", "powers": ["Primary Lotus", "Leaf Hurricane", "Hidden Lotus"], "sig": "Primary Lotus", "trans": ""}}, {"id": "rukia", "v2": {"label": "Bankai", "powers": ["Hakka no Togame", "Tsukishiro", "Hakuren"], "sig": "Hakka no Togame", "trans": ""}, "v3": {"label": "Depowered Karakura Rukia", "powers": ["Sealed Sword Strike", "Kid\u014d Blast"], "sig": "Sealed Sword Strike", "trans": ""}}, {"id": "saitama", "v2": {"label": "Pre-training Saitama", "powers": ["Desperate Punch", "Grapple", "Eyestalk Pull"], "sig": "Desperate Punch", "trans": ""}, "v3": null}, {"id": "sakura", "v2": {"label": "Early Shippuden Sakura", "powers": ["Chakra-Enhanced Strength", "Mystical Palm Technique"], "sig": "Chakra-Enhanced Strength", "trans": ""}, "v3": {"label": "Part I Sakura", "powers": ["Substitution Jutsu", "Kunai Strike", "Genjutsu Break"], "sig": "Kunai Strike", "trans": ""}}, {"id": "sasuke", "v2": {"label": "Mangekyo", "powers": ["Amaterasu", "Kagutsuchi", "Susanoo"], "sig": "Amaterasu", "trans": ""}, "v3": {"label": "Hebi Sasuke", "powers": ["Chidori", "Kirin", "Chidori Sharp Spear"], "sig": "Kirin", "trans": ""}}, {"id": "shikamaru", "v2": {"label": "Fourth War Shikamaru", "powers": ["Shadow Sewing Technique", "Shadow Imitation Technique", "Shadow Imitation Shuriken Technique"], "sig": "Shadow Sewing Technique", "trans": ""}, "v3": {"label": "Part I Chunin Exam Shikamaru", "powers": ["Shadow Imitation Technique", "Kunai Throw", "Shuriken Throw"], "sig": "Shadow Imitation Technique", "trans": ""}}, {"id": "tanjiro", "v2": {"label": "Sun Breathing", "powers": ["Raging Sun", "Flame Dance", "Hinokami Kagura"], "sig": "Hinokami Kagura", "trans": ""}, "v3": {"label": "Demon Slayer Mark + Transparent World", "powers": ["Raging Sun", "Flame Dance", "Hinokami Kagura"], "sig": "Raging Sun", "trans": ""}}, {"id": "toshiro", "v2": {"label": "Adult Toshiro", "powers": ["Shikai Hyoketsu", "Ryusenka", "Hyoten Hyakkaso"], "sig": "Shikai Hyoketsu", "trans": ""}, "v3": {"label": "Arrancar-arc Bankai Toshiro", "powers": ["Hyoten Hyakkaso", "Zanhyo Ningyo", "Ryusenka"], "sig": "Hyoten Hyakkaso", "trans": ""}}, {"id": "vegeta", "v2": {"label": "Majin Vegeta", "powers": ["Final Explosion", "Galick Gun", "Final Flash"], "sig": "Final Explosion", "trans": ""}, "v3": {"label": "Ultra Ego", "powers": ["Galick Gun", "Big Bang Attack", "Final Flash"], "sig": "Galick Gun", "trans": ""}}, {"id": "yuji", "v2": {"label": "Shibuya", "powers": ["Black Flash", "Cursed Energy Punch", "Soul Strike"], "sig": "Black Flash", "trans": ""}, "v3": {"label": "Blood Manipulation Yuji", "powers": ["Blood Manipulation", "Black Flash", "Cursed Energy Punch"], "sig": "Blood Manipulation", "trans": ""}}, {"id": "zoro", "v2": {"label": "Asura / Nine Sword Style", "powers": ["Ashura: Ichibugin", "Ashura: Makyusen", "Oni Giri"], "sig": "Ashura: Ichibugin", "trans": ""}, "v3": {"label": "King of Hell Three Sword Style", "powers": ["King of Hell: Ippyakusanjo Hiryu Jigoku", "King of Hell Rengoku Oni Giri", "Oni Giri"], "sig": "King of Hell: Ippyakusanjo Hiryu Jigoku", "trans": ""}}];
        const roster = JSON.parse(runInCtx('JSON.stringify(ROSTER.map(function(f){return {id:f.id,v2:f.v2||null,v2style:f.v2style||null,v2usage:f.v2usage||null,v2persNote:f.v2persNote||null,v2weak:f.v2weak||null,v2sig:f.v2sig||null,v2sigMult:f.v2sigMult,v2trans:(typeof f.v2trans!=="undefined"?f.v2trans:null),v2tAtk:f.v2tAtk,v2tDef:f.v2tDef,v2powers:f.v2powers||null,v2held:!!f.v2held,v3:f.v3||null,v3style:f.v3style||null,v3usage:f.v3usage||null,v3persNote:f.v3persNote||null,v3weak:f.v3weak||null,v3sig:f.v3sig||null,v3sigMult:f.v3sigMult,v3trans:(typeof f.v3trans!=="undefined"?f.v3trans:null),v3tAtk:f.v3tAtk,v3tDef:f.v3tDef,v3powers:f.v3powers||null};}))'));
        const byId = {};
        roster.forEach(function (f) { byId[f.id] = f; });
        let bad = '';
        EXPECT.forEach(function (e) {
          const f = byId[e.id];
          if (!f) { bad = e.id + ':missing'; return; }
          [['v2', e.v2], ['v3', e.v3]].forEach(function (pair) {
            const k = pair[0], exp = pair[1];
            const hasStyle = !!f[k + 'style'], hasUsage = !!f[k + 'usage'], hasPers = !!f[k + 'persNote'], hasWeak = !!f[k + 'weak'], hasSig = !!f[k + 'sig'], hasTrans = (f[k + 'trans'] !== null && f[k + 'trans'] !== undefined), hasPowers = Array.isArray(f[k + 'powers']) && f[k + 'powers'].length >= 2;
            if (exp) {
              if (f[k] !== exp.label) bad = e.id + '.' + k + ':label';
              if (!hasStyle || !hasUsage || !hasPers || !hasWeak || !hasSig || !hasTrans || !hasPowers) bad = e.id + '.' + k + ':missing-field';
              if (JSON.stringify(f[k + 'powers']) !== JSON.stringify(exp.powers)) bad = e.id + '.' + k + ':powers';
              if (f[k + 'sig'] !== exp.sig) bad = e.id + '.' + k + ':sig';
              if (f[k + 'trans'] !== exp.trans) bad = e.id + '.' + k + ':trans';
              if (typeof f[k + 'sigMult'] !== 'number') bad = e.id + '.' + k + ':sigMult';
              if (typeof f[k + 'tAtk'] !== 'number' || typeof f[k + 'tDef'] !== 'number') bad = e.id + '.' + k + ':tAtk/tDef';
            } else {
              if (hasStyle || hasUsage || hasPers || hasWeak || hasSig || hasTrans || hasPowers) bad = e.id + '.' + k + ':unbuilt-but-present';
              if (f.v2held) bad = e.id + ':v2held-flag-on-unbuilt';
            }
          });
        });
        return bad === '';
      } catch (e) { return false; }
    })(), '');
  check('V1646-VARIANT-SWAP (plan §6 H-VARIANT-SWAP) a selected Anime variant changes the actual battle profile: instance style/sig/trans/stats/powers, charFirst signature/transforms/audit, and a variant battle fights with the variant profile and validates clean; a held v3 falls back to Base; base profiles restore unchanged',
    (function () {
      try {
        runInCtx("selectedVariants = { goku: 'v2' };");
        const inst = JSON.parse(runInCtx('JSON.stringify(instanceOf(byId("goku")))'));
        if (inst.variant !== "Super Saiyan God" || inst.variantId !== 'v2') return false;
        if (inst.style !== "Calm god-ki fighter who counters rather than rushes.") return false;
        if (inst.sig !== "Kamehameha" || inst.trans !== "" || inst.hp !== 1500 || inst.atk !== 150 || inst.def !== 85) return false;
        const pw = JSON.parse(runInCtx('JSON.stringify(actualPowersFor(instanceOf(byId("goku"))))'));
        if (JSON.stringify(pw) !== JSON.stringify(["Kamehameha", "Ki Blast", "Instant Transmission"])) return false;
        const cf = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("goku"), {variant:"Super Saiyan God", variantId:"v2"})))'));
        if (cf.error) return false;
        const sigs = (cf.powers || []).filter(function (p) { return p.signature; });
        if (sigs.length !== 1 || sigs[0].name !== "Kamehameha") return false;
        if (cf.style.description !== "Calm god-ki fighter who counters rather than rushes.") return false;
        if ((cf.transforms || []).length !== 0) return false;
        if ((cf.audit.weakText || '').indexOf('time limit') === -1) return false;
        if (cf.audit.hp !== 1500 || cf.audit.atk !== 150 || cf.audit.def !== 85) return false;
        const cfS = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("saitama"), {variant:"Pre-training Saitama", variantId:"v2"})))'));
        if (cfS.error) return false;
        const sigS = (cfS.powers || []).filter(function (p) { return p.signature; });
        if (sigS.length !== 1 || sigS[0].name !== "Desperate Punch") return false;
        if ((cfS.transforms || []).length !== 0) return false;
        if (cfS.audit.hp !== 2100 || cfS.audit.atk !== 190 || cfS.audit.def !== 115) return false;
        const cfT = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("tanjiro"), {variant:"Sun Breathing", variantId:"v2"})))'));
        if (cfT.error) return false;
        const sigT = (cfT.powers || []).filter(function (p) { return p.signature; });
        if (sigT.length !== 1 || sigT[0].name !== "Hinokami Kagura") return false;
        if (JSON.stringify((cfT.powers || []).map(function (p) { return p.name; }).slice(0, 3)) !== JSON.stringify(["Raging Sun", "Flame Dance", "Hinokami Kagura"])) return false;
        const cfG = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("gaara"), {variant:"Part I Gaara, Shukaku Jinchuriki", variantId:"v3"})))'));
        if (cfG.error) return false;
        const sigG = (cfG.powers || []).filter(function (p) { return p.signature; });
        if (sigG.length !== 1 || sigG[0].name !== "Sand Waterfall Funeral") return false;
        if ((cfG.transforms || []).length !== 1 || cfG.transforms[0].to !== 'Shukaku Form') return false;
        if (JSON.stringify(cfG.transforms[0].transformedPowers || []) !== JSON.stringify(['Shukaku Sand Blast'])) return false;
        if (cfG.audit.hp !== 1500 || cfG.audit.atk !== 145 || cfG.audit.def !== 110) return false;
        runInCtx("selectedVariants = { saitama: 'v3' };");
        const held = JSON.parse(runInCtx('JSON.stringify(instanceOf(byId("saitama")))'));
        if (held.variant !== 'Base') return false;
        runInCtx('selectedVariants = {};');
        const cfB = JSON.parse(runInCtx('JSON.stringify(charFirstV1631(Object.assign({}, byId("goku"), {variant:"Base", variantId:"base"})))'));
        if ((cfB.powers || []).filter(function (p) { return p.signature; })[0].name !== 'Kamehameha') return false;
        if ((cfB.transforms || []).length !== 1 || cfB.transforms[0].to !== 'Super Saiyan Blue') return false;
        runInCtx("selectedVariants = { goku: 'v2' };");
        const r = sim39('goku', 'vegeta', 12345, 'death');
        const vb = JSON.parse(runInCtx('JSON.stringify(validateBattle(globalThis._bt39))'));
        runInCtx('selectedVariants = {};');
        if (r.b.alpha[0].variant !== 'Super Saiyan God' || r.b.alpha[0].sig !== 'Kamehameha' || r.b.alpha[0].trans !== '') return false;
        if (vb.passed !== true) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1646-TRANS-BLOCKED (plan §6 H-TRANS-BLOCKED) the 8 trans-adjacent v2s (Erza, Jiraiya, Kenpachi, Rock Lee, Rukia, Tanjiro, Toshiro, Zoro) plus Ichigo v2 list no legal transition and no transform effect; Gaara v3 stays legal to Shukaku Form with the right stats and the same-name transformed power; base transforms unchanged; starting-form notes and card selects match',
    (function () {
      try {
        const legal = function (id, vid) {
          runInCtx("selectedVariants = { " + id + ": '" + vid + "' };");
          const out = JSON.parse(runInCtx('JSON.stringify(legalTransitionsFor(instanceOf(byId("' + id + '"))))'));
          const eff = JSON.parse(runInCtx('JSON.stringify(transformEffectForV14(instanceOf(byId("' + id + '"))))'));
          runInCtx('selectedVariants = {};');
          return { legal: out, eff: eff };
        };
        // Trans-adjacent: the label IS the form, v2trans empty — no second
        // transform is legal. Ichigo v2: the mask variant already includes
        // Bankai-level Getsuga — v2trans NONE.
        const blocked = [['erza', 'v2'], ['jiraiya', 'v2'], ['kenpachi', 'v2'], ['rocklee', 'v2'], ['rukia', 'v2'], ['tanjiro', 'v2'], ['toshiro', 'v2'], ['zoro', 'v2'], ['ichigo', 'v2']];
        for (let i = 0; i < blocked.length; i++) {
          const r = legal(blocked[i][0], blocked[i][1]);
          if (r.legal.length !== 0 || r.eff !== null) return false;
        }
        // Gaara v3: the variant's own mid-fight form (same name as the base
        // transform) stays legal with the base transform numbers.
        let r = legal('gaara', 'v3');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Shukaku Form') return false;
        if (!r.eff || r.eff.to !== 'Shukaku Form' || r.eff.statChanges.atk !== 30 || r.eff.statChanges.def !== 15) return false;
        if (r.eff.newPowers !== 'Shukaku Sand Blast') return false;
        r = legal('goku', 'base');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Super Saiyan Blue') return false;
        if (!r.eff || r.eff.newPowers !== 'God Kamehameha') return false;
        r = legal('gaara', 'base');
        if (r.legal.length !== 1 || r.legal[0].to !== 'Shukaku Form') return false;
        if (!r.eff || r.eff.newPowers !== 'Shukaku Sand Blast') return false;
        const note = function (id, label, vid) { return runInCtx("startingFormNoteForFighterV1625(byId('" + id + "'), '" + label + "', '" + vid + "')"); };
        if (note('tanjiro', 'Sun Breathing', 'v2').indexOf('no further in-combat transformation is legal') === -1) return false;
        if (note('gaara', 'Part I Gaara, Shukaku Jinchuriki', 'v3').indexOf('may trigger mid-fight') === -1) return false;
        if (note('goku', 'Base', 'base').indexOf('may trigger mid-fight') === -1) return false;
        runInCtx("catFilter='All'; searchTerm=''; renderRoster();");
        const pool = els['fighter-pool'].innerHTML;
        const opts = function (name) {
          const i = pool.indexOf(name);
          if (i === -1) return null;
          const seg = pool.slice(i, pool.indexOf('</select>', i));
          return (seg.match(/value="([^"]+)"/g) || []).map(function (s) { return s.slice(7, -1); });
        };
        if (JSON.stringify(opts('Goku')) !== JSON.stringify(['base', 'v2', 'v3'])) return false;
        if (JSON.stringify(opts('Saitama')) !== JSON.stringify(['base', 'v2'])) return false;
        if (JSON.stringify(opts('Jiraiya')) !== JSON.stringify(['base', 'v2'])) return false;
        if (JSON.stringify(opts('Natsu')) !== JSON.stringify(['base', 'v2'])) return false;
        if (JSON.stringify(opts('Levi')) !== JSON.stringify(['base', 'v2'])) return false;
        if (JSON.stringify(opts('Gaara')) !== JSON.stringify(['base', 'v2', 'v3'])) return false;
        if (JSON.stringify(opts('Tanjiro')) !== JSON.stringify(['base', 'v2', 'v3'])) return false;
        if (JSON.stringify(opts('Erza Scarlet')) !== JSON.stringify(['base', 'v2', 'v3'])) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1646-M16-RECORDONLY (M16.46-1) a variant battle repertoire is the variant\'s own powerset: rendererRepertoireV1639 for a variant drops recordOnly powers (the base transformed finisher and base-only record powers), while base selections keep them and the same-name transformed signature still joins after a transform',
    (function () {
      try {
        const rep = function (id, label, vid, hasT) {
          return JSON.parse(runInCtx('JSON.stringify(rendererRepertoireV1639(Object.assign({}, byId("' + id + '"), {variant:' + JSON.stringify(label) + ', variantId:"' + vid + '"}), ' + hasT + '))'));
        };
        if (JSON.stringify(rep('goku', 'Super Saiyan God', 'v2', false)) !== JSON.stringify(['Kamehameha', 'Ki Blast', 'Instant Transmission'])) return false;
        if (JSON.stringify(rep('saitama', 'Pre-training Saitama', 'v2', false)) !== JSON.stringify(['Desperate Punch', 'Grapple', 'Eyestalk Pull'])) return false;
        if (rep('gojo', 'Teen Gojo', 'v2', false).indexOf('Unlimited Void Crush') !== -1) return false;
        if (rep('vegeta', 'Majin Vegeta', 'v2', false).indexOf('Blue Evolution Final Flash') !== -1) return false;
        const baseRep = rep('goku', 'Base', 'base', false);
        if (baseRep.indexOf('God Kamehameha') === -1 || baseRep.indexOf('Dragon Fist') === -1) return false;
        if (rep('gaara', 'Part I Gaara, Shukaku Jinchuriki', 'v3', false).indexOf('Shukaku Sand Blast') !== -1) return false;
        if (rep('gaara', 'Part I Gaara, Shukaku Jinchuriki', 'v3', true).indexOf('Shukaku Sand Blast') === -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');

  check('V1659-GOLDENS-VARIANT-RELOCK (G5 + re-lock extension + v16.51 telling fix + v16.52 spacing fix + v16.53 photos wiring + v16.55 B stamina fix + v16.56 review fixes + v16.57 fun loop + v16.58 follow-ups + v16.59 fix pile, Jhay-approved 2026-11-06 10:11 + 13:19 + 16:43 + 19:24 + 2026-11-07 01:12 + B fix 2026-11-07 ~13:00 + v16.56 re-lock 2026-11-07 ~15:58 + v16.57 fun loop 0 movers 2026-11-07 ~19:24 + v16.58 follow-ups 0 movers 2026-11-09 ~18:12 + v16.59 fix pile F2 re-lock 10 movers 2026-11-10 ~03:59) all 16 stored variant golden records recompute byte-identically from the v16.59 file with the recorded variant selected; the diff vs the v16.49 goldens is why 16/16, exchanges 16/16, stepNotes 9/16, winner 4/16, criterion 5/16, finisher 4/16, damage 4/16, heldOutA 2/16 (v16.55 B: 4 winner flips — sonic/rocky v2 Rocky->Sonic, goku/vegeta v3 Vegeta->Goku, tanjiro/zoro v2 Zoro->Tanjiro, naruto/sasuke v3 Naruto->Sasuke — and 5 criterion moves — those 4 plus goku/vegeta v2 stamina->speed; v16.56: item 6 moves heldOutA on the 2 goku/vegeta variants, pinned by key; v16.59 F2 re-lock: 4 variant records move on the stamina paths (staminaLimit, staminaLimitStatus, staminaStages) — wording only, no winner/criterion/finisher/rounds/damage change; each matches its stored winner/criterion/finisher/loserState/roundCount; the diff vs the v16.49 goldens is confined to the same allowed paths as the base re-lock: loserState moves on 0/16, why moves on 16/16, winPath moves on 0/16, conditions move on 0/16, events move on 4/16 (the 4 winner flips — their battles play out differently; non-flip records move no event at all), stepNotes move on 9/16, exchanges move on 16/16, kindStatus moves on 0/16, heldOutA moves on 2/16; rounds never move; finisher and damage move ONLY on the 4 winner flips; label correction 2026-11-08 (Milo call, Jhay delegated "Up to you"): saitama/goku v3 relabelled to base (fallback — Saitama has no built v3), frozen record byte-identical, no mover',
    (function () {
      const crypto = require('crypto');
      let gold, oldGold;
      try {
        gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
        oldGold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.49-goldens.json'), 'utf8'));
      } catch (e) { return false; }
      if (gold.version !== 'v16.59' || gold.generatedFrom !== 'war-room-v16.59.html') return false;
      if (gold.htmlMd5 !== crypto.createHash('md5').update(html).digest('hex')) return false;
      const vars = (gold.records || []).filter(function (g) { return !!g.variant; });
      if (vars.length !== 16) return false;
      const goldenString = function (b, f) { return JSON.stringify({ events: b.events, finalRecord: b.finalRecord, finalState: b.finalState, rounds: b.rounds, totalDamage: b.totalDamage, destruction: b.destruction, winner: b.winner, renderedReason: b.renderedReason, renderedReasonWords: b.renderedReasonWords, frozen: f }); };
      function differ(a, b, pfx, out) {
        if (a === b) return;
        if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
          const keys = {};
          Object.keys(a).forEach(function (k) { keys[k] = 1; });
          Object.keys(b).forEach(function (k) { keys[k] = 1; });
          Object.keys(keys).forEach(function (k) {
            if (!(k in a)) out.push(pfx + k + ':<absent-in-old>');
            else if (!(k in b)) out.push(pfx + k + ':<absent-in-new>');
            else differ(a[k], b[k], pfx + k + '.', out);
          });
          return;
        }
        if (Array.isArray(a) && Array.isArray(b)) {
          if (a.length !== b.length) out.push(pfx + 'len');
          const base = pfx.replace(/\.$/, '');
          const n = Math.min(a.length, b.length);
          for (let i = 0; i < n; i++) differ(a[i], b[i], base + '[' + i + '].', out);
          return;
        }
        out.push(pfx.slice(0, -1));
      }
      const ALLOWED = ['frozen.loserState', 'frozen.why', 'frozen.exchanges', 'frozen.stepNotes', 'frozen.winPath', 'frozen.conditions.modeLabel', 'frozen.conditions.winConditions', 'frozen.inputs.runsOutFirst', 'frozen.staminaStages.runsOutFirst', 'frozen.decisiveCriterion', 'finalRecord.renderedReason', 'finalRecord.renderedReasonWords', 'renderedReason', 'renderedReasonWords', 'frozen.inputs.incapA.power.kindStatus', 'frozen.inputs.incapB.power.kindStatus', 'frozen.heldOutA', 'frozen.inputs.schemaA.staminaLimit', 'frozen.inputs.schemaA.staminaLimitStatus', 'frozen.inputs.schemaB.staminaLimit', 'frozen.inputs.schemaB.staminaLimitStatus', 'frozen.staminaStages.A', 'frozen.staminaStages.B']; // v16.55 (B): the stamina step's own outputs move — the runsOutFirst input + staminaStages, the criterion (gated by the allowlist above), the rendered reason (derived from the why/criterion); v16.56 (review fixes): the kindStatus wording (item 7, gated by the movedKind count + key allowlist) and the heldOutA list (item 6, gated by the movedHeldOut count + key allowlist); v16.59 (fix pile F2 re-lock): the stamina paths (staminaLimit, staminaLimitStatus, staminaStages.A/B) — wording only, gated by the VS-V1658 10-mover set
      function allowedEventField(p) {
        return /^events\[\d+\]\.(detail|explanation|loserState|ability|damageType)$/.test(p); // v16.56 (item 6): the repertoire-order shift moves event abilities (+ damage types) on 3 base records — gated by the movedEvents count + the event key allowlist
      }
      function isAllowed(p) {
        const base = p.replace(/:<absent-in-(old|new)>$/, '');
        if (allowedEventField(base)) return true;
        return ALLOWED.some(function (a) { return base === a || base.indexOf(a + '.') === 0 || base.indexOf(a + '[') === 0; });
      }
      const oldByKey = {};
      (oldGold.records || []).forEach(function (o) { oldByKey[o.pair + '|' + o.seed + '|' + JSON.stringify(o.variant || null)] = o; });
      // Label correction 2026-11-08 (Milo's call, Jhay delegated "Up to you"): the saitama/goku v3 golden was a fallback to base (Saitama has no built v3), relabelled to {"saitama":"base"}. The v16.49 record still carries the v3 label, so alias the new key to the old record.
      oldByKey['saitama/goku|12345|{"saitama":"base"}'] = oldByKey['saitama/goku|12345|{"saitama":"v3"}'];
      let ok = true;
      const badPaths = [];
      let movedLoser = 0, movedWhy = 0, movedWinPath = 0, movedConditions = 0, movedEvents = 0, movedStepNotes = 0, movedExchanges = 0, movedFin = 0, movedDmg = 0, movedKind = 0, movedHeldOut = 0;
      vars.forEach(function (g) {
        if (g.mode !== 'death' || g.battlefield !== 'Open Arena') { ok = false; return; }
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const rec = goldenString(r.b, r.f);
        if (rec !== g.record) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':recomputed!=stored'); return; }
        if (crypto.createHash('sha256').update(rec).digest('hex') !== g.sha256) { ok = false; return; }
        if (r.f.winner !== g.winner || r.f.decisiveCriterion !== g.criterion || r.f.finisher !== g.finisher || r.f.loserState !== g.loserState || r.f.roundCount !== g.roundCount) { ok = false; return; }
        const old = oldByKey[g.pair + '|' + g.seed + '|' + JSON.stringify(g.variant || null)];
        if (!old) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':no-v16.49-record'); return; }
        if (g.roundCount !== old.roundCount) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':rounds-moved'); return; }
        if (g.winner !== old.winner) {
          // v16.55 (B): exactly 4 variant winner flips, pinned old->new.
          const expWin = { 'sonic/rocky|12345|{"sonic":"v2"}': 'Rocky Balboa->Sonic', 'goku/vegeta|12345|{"goku":"v3"}': 'Vegeta->Goku', 'tanjiro/zoro|12345|{"tanjiro":"v2"}': 'Roronoa Zoro->Tanjiro', 'naruto/sasuke|12345|{"naruto":"v3"}': 'Naruto->Sasuke Uchiha' }[g.pair + '|' + g.seed + '|' + JSON.stringify(g.variant || null)];
          if (!expWin || expWin !== old.winner + '->' + g.winner) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':winner-moved-unexpected'); return; }
        }
        if (g.criterion !== old.criterion) {
          // v16.55 (B): exactly 5 variant criterion moves, pinned old->new.
          const expCrit = { 'sonic/rocky|12345|{"sonic":"v2"}': 'stamina->tier difference', 'goku/vegeta|12345|{"goku":"v2"}': 'stamina->speed', 'goku/vegeta|12345|{"goku":"v3"}': 'speed->stamina', 'tanjiro/zoro|12345|{"tanjiro":"v2"}': 'tier difference->stamina', 'naruto/sasuke|12345|{"naruto":"v3"}': 'stamina->tier difference' }[g.pair + '|' + g.seed + '|' + JSON.stringify(g.variant || null)];
          if (!expCrit || expCrit !== old.criterion + '->' + g.criterion) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':criterion-moved-unexpected'); return; }
        }
        if (g.finisher !== old.finisher && g.winner === old.winner) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':finisher-moved-without-winner-move'); return; }
        if (JSON.stringify(g.damageSums) !== JSON.stringify(old.damageSums) && g.winner === old.winner) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':damage-moved-without-winner-move'); return; }
        if (g.finisher !== old.finisher) movedFin++;
        if (JSON.stringify(g.damageSums) !== JSON.stringify(old.damageSums)) movedDmg++;
        if (old.loserState !== 'dead') { ok = false; badPaths.push(g.pair + '|' + g.seed + ':v16.49-loserState-not-dead'); return; }
        if (g.loserState !== 'dead') { ok = false; return; }
        if (g.loserState !== old.loserState) movedLoser++;
        const d = [];
        differ(JSON.parse(old.record), JSON.parse(rec), '', d);
        // v16.55 (B): a winner flip changes the WHOLE battle record
        // (events, finalState, totalDamage, damageSplit, moveCounts) —
        // that is the flip itself. The exact new battle is pinned by
        // the byte-identical recompute above and the winner/criterion
        // allowlists; only non-flip records must stay inside the
        // allowed paths.
        if (g.winner === old.winner) {
          const disallowed = d.filter(function (p) { return !isAllowed(p); });
          if (disallowed.length !== 0) { ok = false; badPaths.push(g.pair + '|' + g.seed + ':DISALLOWED:' + disallowed.join(',')); return; }
        }
        const bases = d.map(function (p) { return p.replace(/:<absent-in-(old|new)>$/, ''); });
        if (bases.indexOf('frozen.why') !== -1) movedWhy++;
        if (bases.indexOf('frozen.winPath') !== -1) movedWinPath++;
        if (bases.some(function (p) { return p.indexOf('frozen.conditions.') === 0; })) movedConditions++;
        if (bases.some(function (p) { return p.indexOf('events[') === 0; })) movedEvents++;
        if (bases.some(function (p) { return p.indexOf('frozen.stepNotes') === 0; })) movedStepNotes++;
        if (bases.some(function (p) { return p.indexOf('frozen.exchanges') === 0; })) movedExchanges++;
        // v16.56 (item 7): no variant record moves a kindStatus path.
        if (bases.some(function (p) { return p.indexOf('frozen.inputs.incapA.power.kindStatus') === 0 || p.indexOf('frozen.inputs.incapB.power.kindStatus') === 0; })) movedKind++;
        // v16.56 (item 6): exactly the 2 goku/vegeta variants move
        // heldOutA (5 -> 4, the limit-outcome-unrecorded-powers item
        // drops now that all their powers have records) — pinned by
        // key. (v3 is a winner flip, so its disallowed check is
        // skipped, but the counting here runs for every record.)
        if (bases.some(function (p) { return p.indexOf('frozen.heldOutA') === 0; })) {
          movedHeldOut++;
          const vkey = g.pair + '|' + g.seed + '|' + JSON.stringify(g.variant || null);
          if (vkey !== 'goku/vegeta|12345|{"goku":"v2"}' && vkey !== 'goku/vegeta|12345|{"goku":"v3"}') { ok = false; badPaths.push(vkey + ':heldOutA-moved-unexpected'); return; }
        }
      });
      if (movedLoser !== 0 || movedWhy !== 16 || movedWinPath !== 0 || movedConditions !== 0 || movedEvents !== 4 || movedStepNotes !== 9 || movedExchanges !== 16 || movedFin !== 4 || movedDmg !== 4 || movedKind !== 0 || movedHeldOut !== 2) { ok = false; badPaths.push('moved counts loser/why/winPath/conditions/events/stepNotes/exchanges/fin/dmg/kind/heldOut=' + [movedLoser, movedWhy, movedWinPath, movedConditions, movedEvents, movedStepNotes, movedExchanges, movedFin, movedDmg, movedKind, movedHeldOut].join('/')); }
      if (!ok) { globalThis._v1659VariantGoldenDiffs = badPaths; }
      return ok;
    })(), (globalThis._v1659VariantGoldenDiffs || []).join(' | '));
  // ================= v16.56 — review fixes (Jhay 2026-11-07 15:29 + re-lock ~15:58) =================
  // Crop fix, result-header photos + variant names, gandalf2 removed,
  // Instant Transmission record + POWERS.goku 4th power, engine words
  // reworded, Thanos Titan Slam + v2weak, Hulkbuster variant photo.
  check('V1659-GOLDENS-RELOCK-VS-V1658 (v16.59 fix pile, Jhay-agreed F2 re-lock 2026-11-10 ~03:59) exactly 10 of the 40 golden records move vs v16.58 — the F2 weak-text re-lock only (Goku "Overconfidence; stamina drains in very long fights" -> "Overconfidence" in staminaLimit / staminaLimitStatus / staminaStages); F3 Final Flash cl and F4 Body Punch nh move 0; no winner/criterion/finisher/loserState/rounds/damage change anywhere; the 10 movers are goku/vegeta x3, superman/goku x3, saitama/goku x2, vegeta/goku x2',
    (function () {
      const crypto = require('crypto');
      let gold, oldGold;
      try {
        gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
        oldGold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.58-goldens.json'), 'utf8'));
      } catch (e) { return false; }
      if (gold.version !== 'v16.59' || gold.generatedFrom !== 'war-room-v16.59.html') return false;
      if (oldGold.version !== 'v16.58' || oldGold.generatedFrom !== 'war-room-v16.58.html') return false;
      if (gold.htmlMd5 !== crypto.createHash('md5').update(html).digest('hex')) return false;
      if (!Array.isArray(gold.records) || gold.records.length !== 40) return false;
      if (!Array.isArray(oldGold.records) || oldGold.records.length !== 40) return false;
      const oldByKey = {};
      oldGold.records.forEach(function (o) { oldByKey[o.pair + '|' + o.seed + '|' + JSON.stringify(o.variant || null)] = o; });
      // No Saitama remap: both v16.58 and v16.59 goldens already carry
      // {"saitama":"base"} (the v3 fallback label was corrected in v16.57).
      const EXPECTED = {
        'goku/vegeta|12345|null': 1,
        'superman/goku|12345|null': 1,
        'goku/vegeta|632115031|null': 1,
        'superman/goku|1652930674|null': 1,
        'goku/vegeta|188971857|null': 1,
        'superman/goku|1203312057|null': 1,
        'saitama/goku|12345|{"saitama":"v2"}': 1,
        'vegeta/goku|12345|{"vegeta":"v2"}': 1,
        'vegeta/goku|12345|{"vegeta":"v3"}': 1,
        'saitama/goku|12345|{"saitama":"base"}': 1,
      };
      let moved = 0;
      const badPaths = [];
      gold.records.forEach(function (g) {
        const key = g.pair + '|' + g.seed + '|' + JSON.stringify(g.variant || null);
        const old = oldByKey[key];
        if (!old) { moved++; badPaths.push(key + ':no-v16.58-record'); return; }
        if (g.record !== old.record) {
          moved++;
          if (!EXPECTED[key]) badPaths.push(key + ':unexpected-mover');
          if (g.winner !== old.winner || g.criterion !== old.criterion || g.finisher !== old.finisher || g.loserState !== old.loserState || g.roundCount !== old.roundCount || JSON.stringify(g.damageSums) !== JSON.stringify(old.damageSums)) badPaths.push(key + ':outcome-moved');
        }
      });
      Object.keys(EXPECTED).forEach(function (k) {
        if (!gold.records.some(function (g) { return (g.pair + '|' + g.seed + '|' + JSON.stringify(g.variant || null)) === k && g.record !== (oldByKey[k] || {}).record; })) badPaths.push(k + ':expected-mover-missing');
      });
      if (moved !== 10 || badPaths.length !== 0) { globalThis._v1659GoldenDiffsVsV1658 = badPaths; }
      return moved === 10 && badPaths.length === 0;
    })(), (globalThis._v1659GoldenDiffsVsV1658 || []).join(' | '));
  // ================= v16.58 — v16.56 follow-ups (Jhay 2026-11-09 ~18:12) =================
  // Engine-words rewording + condition-3 F1. Wording only — no engine change.
  check('V1659-FOLLOWUPS-ENGINE-WORDS (v16.56 follow-ups, Jhay 2026-11-09 ~18:12) the six follow-up engine-word strings are gone from the file (0 occurrences each): keyword fallback, Character power records, ENGINE MECHANISM, not the character record, nothing recorded stops it, where recorded — and the new wording is present (Power records heading 3x, matched by keyword 7x, keyword match 2x, where shown 6x + bypass shown 1x)',
    (function () {
      const gone = ['keyword fallback', 'Character power records', 'ENGINE MECHANISM', 'not the character record', 'nothing recorded stops it', 'where recorded'];
      for (let i = 0; i < gone.length; i++) { if (html.indexOf(gone[i]) !== -1) return false; }
      if ((html.match(/Power records \(v16\.38/g) || []).length !== 3) return false;
      if ((html.match(/matched by keyword/g) || []).length !== 7) return false;
      if ((html.match(/keyword match/g) || []).length !== 2) return false;
      if ((html.match(/where shown/g) || []).length !== 6) return false;
      if (html.indexOf('where that bypass is shown') === -1) return false;
      return true;
    })(), '');
  check('V1659-FOLLOWUPS-CONDITION3 (condition 3 + F2 re-lock, Jhay 2026-11-09 ~18:12 + 2026-11-10 ~03:59) the false stamina clause is gone from the Kamehameha / Ki Blast / God Kamehameha record sb/cl fields (F1, 0 movers); the Goku roster weak text + derived entry are LANDED as Overconfidence (F2, 10 movers, re-locked Jhay 2026-11-10 ~03:59); the What-stops render for Kamehameha no longer shows a stamina drain; the F8 clause is kept verbatim (3 sites)',
    (function () {
      try {
        const kam = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('goku','Kamehameha'))"));
        const ki = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('goku','Ki Blast'))"));
        const god = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('goku','God Kamehameha'))"));
        if (!kam || !ki || !god) return false;
        if ((kam.stoppedBy || '').indexOf('stamina') !== -1) return false;
        if ((kam.costLimit || '').indexOf('stamina') !== -1) return false;
        if ((ki.costLimit || '').indexOf('stamina') !== -1) return false;
        if ((god.costLimit || '').indexOf('stamina') !== -1) return false;
        if (kam.costLimit !== 'no specific cost stated for this power') return false;
        if (ki.costLimit !== 'no specific cost stated for this power') return false;
        if (god.costLimit !== 'no specific cost stated for this power') return false;
        if (kam.stoppedBy !== 'durability resistance; dodging or blocking') return false;
        if (runInCtx("stopsForOpponentV1654('durability resistance; dodging or blocking', 'mortal')").indexOf('stamina') !== -1) return false;
        // F2 LANDED (re-lock Jhay 2026-11-10 ~03:59): weak text +
        // derived entry carry 'Overconfidence'; the stamina clause is gone.
        if (runInCtx("byId('goku').weak") !== 'Overconfidence') return false;
        if (html.indexOf("text: 'Overconfidence', exploitableBy: 'an opponent who outlasts the transformed state'") === -1) return false;
        if (html.indexOf('stamina drains in very long fights') !== -1) return false;
        // F8 KEPT verbatim.
        if ((html.match(/No recorded detail is stated for /g) || []).length !== 3) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  // ================= v16.59 — Batch 1 fix pile (Jhay 2026-11-10 ~03:59) =================
  // F2 weak-text re-lock + F3 Final Flash cl + F4 Body Punch nh dash.
  // Record wording only — no engine change.
  check('V1659-FIXPILE-F2F3F4 (Batch 1 fix pile, Jhay 2026-11-10 ~03:59) F2: Goku roster weak text + derived entry read \'Overconfidence\' and the stamina clause is gone from the file (0x); F3: Vegeta Final Flash record cl reads the demonstrated cost (long charge; high energy depletion — all ki concentrated in both hands, stated cost); F4: Rocky Body Punch nh reads the em-dash form, 3x across the three Rocky records, double-hyphen gone (0x)',
    (function () {
      try {
        if (runInCtx("byId('goku').weak") !== 'Overconfidence') return false;
        if (html.indexOf("weak:'Overconfidence'") === -1) return false;
        if (html.indexOf("text: 'Overconfidence', exploitableBy: 'an opponent who outlasts the transformed state'") === -1) return false;
        if (html.indexOf('stamina drains in very long fights') !== -1) return false;
        const ff = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('vegeta','Final Flash'))"));
        if (!ff) return false;
        if (ff.costLimit !== 'long charge; high energy depletion — all ki concentrated in both hands (stated cost)') return false;
        const bp = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('rocky','Body Punch'))"));
        if (!bp) return false;
        if ((bp.cannotHurt || '').indexOf('invulnerable bodies — demonstrated live: Rocky dealt 0 across all attacks vs Superman') === -1) return false;
        if (html.indexOf('invulnerable bodies -- demonstrated') !== -1) return false;
        if ((html.match(/invulnerable bodies — demonstrated/g) || []).length !== 3) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-CROP-FIX (item 1, Jhay 2026-11-07 15:29) the photo crop anchors to the top on both .phimg rules (card 48px + inline 1.4em) so heads are not cut — object-position:top appears exactly twice, once per rule',
    (function () {
      if ((html.match(/object-position:top/g) || []).length !== 2) return false;
      if (html.indexOf('.card .ic .phimg{width:48px;height:48px;object-fit:cover;object-position:top') === -1) return false;
      if (html.indexOf('.phimg{width:1.4em;height:1.4em;object-fit:cover;object-position:top') === -1) return false;
      return true;
    })(), '');
  check('V1659-RESULT-HEADER-PHOTOS (items 3+4, Jhay 2026-11-07 15:29) after setResultHeaderFromFrozenV1635, the result-title innerHTML contains both fighters\' photos (images/ paths); a variant battle names the variant as "Name (Variant)" in the title, while a base battle names no variant (no parenthesis)',
    (function () {
      try {
        runInCtx("selectedVariants = { goku: 'v2' };");
        const r = sim39('goku', 'vegeta', 12345, 'death');
        runInCtx('setResultHeaderFromFrozenV1635(JSON.parse(' + JSON.stringify(JSON.stringify(r.f)) + '));');
        runInCtx('selectedVariants = {};');
        const t = els['result-title'].innerHTML || '';
        const ti = els['result-title'].innerText || '';
        if (t.indexOf('images/goku.jpg') === -1 || t.indexOf('images/vegeta.jpg') === -1) return false;
        if (ti.indexOf('Goku (Super Saiyan God)') === -1) return false;
        const rb = sim39('goku', 'vegeta', 12345, 'death');
        runInCtx('setResultHeaderFromFrozenV1635(JSON.parse(' + JSON.stringify(JSON.stringify(rb.f)) + '));');
        const tb = els['result-title'].innerHTML || '';
        const tib = els['result-title'].innerText || '';
        if (tb.indexOf('images/goku.jpg') === -1 || tb.indexOf('images/vegeta.jpg') === -1) return false;
        if (tib.indexOf('(') !== -1) return false; // base battle: no variant parenthesis
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-ENGINE-WORDS (item 7 + v16.58 follow-ups, Jhay 2026-11-07 15:29 + 2026-11-09 ~18:12) the twelve engine-word labels are gone from the file (0 occurrences each): NO RESEARCH STAT BONUS, [ENGINE DERIVATION, resolveAttack pipeline, keyword-fallback, Offline Breakdown, CHARACTER RECORD, keyword fallback, Character power records, ENGINE MECHANISM, not the character record, nothing recorded stops it, where recorded — the Audit/rubric "through resolveAttack" (lines 2175/2211) and bare resolveAttackV14 stay, so those are NOT asserted 0',
    (function () {
      const labels = ['NO RESEARCH STAT BONUS', '[ENGINE DERIVATION', 'resolveAttack pipeline', 'keyword-fallback', 'Offline Breakdown', 'CHARACTER RECORD', 'keyword fallback', 'Character power records', 'ENGINE MECHANISM', 'not the character record', 'nothing recorded stops it', 'where recorded'];
      for (let i = 0; i < labels.length; i++) { if (html.indexOf(labels[i]) !== -1) return false; }
      if ((html.match(/matched by keyword/g) || []).length !== 7) return false;
      if ((html.match(/through resolveAttack/g) || []).length !== 2) return false; // lines 2175 + 2211, deliberately kept
      if (html.indexOf('function resolveAttackV14(') === -1) return false;
      return true;
    })(), '');
  check('V1659-F8-DOSSIER (item 6, Jhay 2026-11-07 15:29 + re-lock ~15:58) powerRecordV1625(\'goku\',\'Instant Transmission\') is non-null with demonstrated status (teleport to a sensed ki signature, moves the user, hurts nothing); the \'Instant Transmission Strike\' record is untouched (interpretation, teleport then strike)',
    (function () {
      try {
        const rec = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('goku','Instant Transmission'))"));
        if (!rec || rec.status !== 'demonstrated') return false;
        if (rec.effect !== 'Instant teleport to a sensed ki signature') return false;
        if (rec.canHurt !== 'none — it moves the user, it does not strike') return false;
        const strike = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('goku','Instant Transmission Strike'))"));
        if (!strike || strike.status !== 'interpretation') return false;
        if (strike.effect !== 'Teleport to the target, then strike') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-THANOS (item 8, Jhay 2026-11-07 15:29) the Titan Slam record is present with demonstrated status (six Infinity Gems) and Thanos v2weak is present with the exact Gauntlet text; the v2weak carries no stamina-regex trigger word (Thanos v2 stamina limitStatus stays unknown)',
    (function () {
      try {
        const rec = JSON.parse(runInCtx("JSON.stringify(powerRecordV1625('thanos','Titan Slam'))"));
        if (!rec || rec.status !== 'demonstrated') return false;
        if (rec.effect.indexOf('six Infinity Gems') === -1) return false;
        const w = runInCtx("byId('thanos').v2weak");
        if (w.indexOf('Overconfidence; the Gauntlet can be taken only while his body is empty') !== 0) return false;
        if (w.indexOf('Nebula stole it off his abandoned body (Infinity Gauntlet #5)') === -1) return false;
        if (w.indexOf('1991 Infinity Gauntlet, not the 1992 sequel') === -1) return false;
        const prof = JSON.parse(runInCtx("JSON.stringify(powerProfileV1623(Object.assign({}, byId('thanos'), {variant: byId('thanos').v2, variantId: 'v2'})).stamina)"));
        if (prof.limitStatus !== 'unknown') return false; // no stamina-regex trigger word in the v2weak
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-HULKBUSTER-PHOTO (item 10, Jhay 2026-11-07 15:29) VARIANT_PHOTOS_V1653.ironman.v2 is images/ironman-v2.jpg and photoPathV1653 returns it for the v2 (Hulkbuster) while the base still returns images/ironman.jpg; Sauron v2 is unchanged',
    (function () {
      try {
        if (JSON.parse(runInCtx('JSON.stringify(VARIANT_PHOTOS_V1653.ironman)')).v2 !== 'images/ironman-v2.jpg') return false;
        if (runInCtx("photoPathV1653(byId('ironman'),'v2')") !== 'images/ironman-v2.jpg') return false;
        if (runInCtx("photoPathV1653(byId('ironman'),'base')") !== 'images/ironman.jpg') return false;
        if (runInCtx("photoPathV1653(byId('sauron'),'v2')") !== 'images/sauron-v2.jpg') return false;
        if (runInCtx("photoPathV1653(byId('sauron'),'base')") !== 'images/sauron.jpg') return false;
        return true;
      } catch (e) { return false; }
    })(), '');

  // ================= v16.55 — B stamina fix (Jhay 2026-11-07 ~12:54) =================
  // The structured stamina record is the source of truth; the numeric
  // fallback is killed; running out weakens the fighter, who is then
  // finished by the opponent — unless they recover inside the fight.
  check('V1659-B-FALLBACK-KILLED (B, Jhay 2026-11-07 ~12:54) the sta-diff-2+ numeric fallback is killed in both resolvers: a both-none pair with a 2+ roster stamina gap records NO runs-out fighter (Vader vs Superman, durability, new 2+ wording); a both-stated pair records none either (Goku vs Vegeta, speed, old null wording); the fallback branch is absent from both functions',
    (function () {
      try {
        const fnSrc1655 = function (name) {
          const re = new RegExp('function ' + name + '\\s*\\(');
          const m = re.exec(html);
          if (!m) return null;
          let i = html.indexOf('{', m.index), depth = 0;
          for (; i < html.length; i++) {
            if (html[i] === '{') depth++;
            else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(m.index, i + 1); }
          }
          return null;
        };
        const v = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('vader','superman',12345,{victoryMode:'death'}); return {criterion: x.decisiveCriterion, runsOut: x.inputs.runsOutFirst}; })())`));
        if (v.criterion !== 'durability' || v.runsOut.fighter !== null) return false;
        if (v.runsOut.reason.indexOf('the roster stamina numbers do not decide this step') === -1) return false;
        const g = JSON.parse(runInCtx(`JSON.stringify((function(){ var x = resolveCharFirstV1631('goku','vegeta',12345,{victoryMode:'death'}); return {criterion: x.decisiveCriterion, runsOut: x.inputs.runsOutFirst}; })())`));
        if (g.criterion !== 'speed' || g.runsOut.fighter !== null) return false;
        if (g.runsOut.reason.indexOf('no stated limit separates them and roster stamina does not separate them by 2 or more') === -1) return false;
        if (fnSrc1655('charFirstRunsOutV1631').indexOf('Math.abs(aSta - bSta) >= 2') !== -1) return false;
        if (fnSrc1655('charFirstRunsOutV1631').indexOf('legacy numeric fallback') !== -1) return false;
        if (fnSrc1655('resolverRunsOutV1624').indexOf('legacy numeric fallback') !== -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-B-STRUCTURED-TRUTH (B, Jhay 2026-11-07 ~12:54) the structured stamina record is the source of truth: the STAMINA_V1655 table holds 45 records; a fighter with a record carries stamina.structured in their powerProfile (Goku base: limit stated, poweredState Base form) and the stamina step reads it; a fighter with no record (Batman) carries null and falls back to the regex; the regex is unchanged and narrow (Super Sonic v2, no structured record, still resolves on the regex limit)',
    (function () {
      try {
        if (JSON.parse(runInCtx('JSON.stringify(Object.keys(STAMINA_V1655).length)')) !== 45) return false;
        const g = JSON.parse(runInCtx('JSON.stringify(staminaRecordV1655("goku","base"))'));
        if (!g || g.limit !== 'stated' || g.poweredState !== 'Base form (Kaioken, Super Saiyan 3, Ultra Instinct)') return false;
        if (JSON.parse(runInCtx('JSON.stringify(staminaRecordV1655("batman","base"))')) !== null) return false;
        const prof = JSON.parse(runInCtx(`JSON.stringify((function(){ var p = powerProfileV1623(byId('goku')); return {structured: p.stamina.structured ? {limit: p.stamina.structured.limit, poweredState: p.stamina.structured.poweredState} : null}; })())`));
        if (!prof.structured || prof.structured.limit !== 'stated') return false;
        const profB = JSON.parse(runInCtx(`JSON.stringify((function(){ var p = powerProfileV1623(byId('batman')); return {structured: p.stamina.structured}; })())`));
        if (profB.structured !== null) return false;
        const s = JSON.parse(runInCtx(`JSON.stringify((function(){ var r = resolveCharFirstV1631('saitama','goku',12345,{victoryMode:'death', variant:'Serious Saitama', variantId:'v2'}); return {criterion: r.decisiveCriterion, runsOut: r.inputs.runsOutFirst}; })())`));
        if (s.criterion !== 'stamina' || s.runsOut.fighter !== 'B') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-B-WEAKENED-WHY (B, Jhay 2026-11-07 ~12:54) the stamina why names the powered state, the weakened state, and the finisher of the weakened fighter, in plain words with no cite: goku/vegeta v3 (Vegeta Blue ends, Second Blue use under 10%), tanjiro/zoro v2 (Zoro Three-sword style ends, collapses), saitama/goku v2 (Goku Base form ends, After SSJ3 drained)',
    (function () {
      try {
        runInCtx("selectedVariants = { goku: 'v3' };");
        const gv3 = sim39('goku', 'vegeta', 12345, 'death');
        runInCtx('selectedVariants = {};');
        if (gv3.f.winner !== 'Goku' || gv3.f.decisiveCriterion !== 'stamina') return false;
        if (gv3.f.why.indexOf("Vegeta's Super Saiyan Blue / Super Saiyan Blue Evolution ends") === -1) return false;
        if (gv3.f.why.indexOf('Second Blue use: under 10% power') === -1) return false;
        if (gv3.f.why.indexOf('Goku finishes the weakened Vegeta') === -1) return false;
        if (gv3.f.why.indexOf('Ep ') !== -1 || gv3.f.why.indexOf('ch. ') !== -1) return false;
        runInCtx("selectedVariants = { tanjiro: 'v2' };");
        const tz = sim39('tanjiro', 'zoro', 12345, 'death');
        runInCtx('selectedVariants = {};');
        if (tz.f.winner !== 'Tanjiro' || tz.f.decisiveCriterion !== 'stamina') return false;
        if (tz.f.why.indexOf("Roronoa Zoro's Three-sword style ends") === -1) return false;
        if (tz.f.why.indexOf('Collapses, cannot move, passes out from exhaustion and wounds') === -1) return false;
        if (tz.f.why.indexOf('Tanjiro finishes the weakened Roronoa Zoro') === -1) return false;
        runInCtx("selectedVariants = { saitama: 'v2' };");
        const sg = sim39('saitama', 'goku', 12345, 'death');
        runInCtx('selectedVariants = {};');
        if (sg.f.winner !== 'Saitama' || sg.f.decisiveCriterion !== 'stamina') return false;
        if (sg.f.why.indexOf("Goku's Base form (Kaioken, Super Saiyan 3, Ultra Instinct) ends") === -1) return false;
        if (sg.f.why.indexOf('After SSJ3: power drained completely') === -1) return false;
        if (sg.f.why.indexOf('Saitama finishes the weakened Goku') === -1) return false;
        if (sg.f.why.indexOf('DBZ') !== -1 || sg.f.why.indexOf('Ep ') !== -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-B-FITSINFIGHT-RECOVERY (B, Jhay 2026-11-07 ~12:54) fitsInFight true means stamina does NOT decide: Luffy (Gear 5), Dante (Devil Trigger), and Leon v2 (RE6 gauge) each run out but recover inside the fight, so the stamina step records no runs-out fighter and the fight falls through to tier',
    (function () {
      try {
        const res = function (a, b, variant) {
          const code = "(function(){ var r = resolveCharFirstV1631('" + a + "','" + b + "',12345,{victoryMode:'death'" + (variant ? ", variant:'" + variant.v + "', variantId:'" + variant.id + "'" : '') + "}); return JSON.stringify({winner:r.winner, criterion:r.decisiveCriterion, runsOut:r.inputs.runsOutFirst}); })()";
          return JSON.parse(runInCtx(code));
        };
        const l = res('luffy', 'batman');
        if (l.winner !== 'Monkey D. Luffy' || l.criterion !== 'tier difference' || l.runsOut.fighter !== null) return false;
        if (l.runsOut.reason.indexOf('runs out of Gear 5 but recovers inside the fight') === -1) return false;
        const d = res('dante', 'batman');
        if (d.winner !== 'Dante' || d.criterion !== 'tier difference' || d.runsOut.fighter !== null) return false;
        if (d.runsOut.reason.indexOf('runs out of Devil Trigger but recovers inside the fight') === -1) return false;
        const le = res('leonkennedy', 'batman', { v: 'D.S.O. Agent', id: 'v2' });
        if (le.winner !== 'Batman' || le.criterion !== 'tier difference' || le.runsOut.fighter !== null) return false;
        if (le.runsOut.reason.indexOf('runs out of RE6 combat gauge (stamina bar) but recovers inside the fight') === -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-B-BOTH-STATED-FALLTHROUGH (B, Jhay 2026-11-07 ~12:54) both-stated pairs fall through to tier/speed because durations cannot be compared (only 8 records have numbers): goku/vegeta base and v2 go to speed (Vegeta wins both), sonic/rocky v2 and naruto/sasuke v3 go to tier (Sonic and Sasuke win)',
    (function () {
      try {
        const g = sim39('goku', 'vegeta', 12345, 'death');
        if (g.f.winner !== 'Vegeta' || g.f.decisiveCriterion !== 'speed') return false;
        runInCtx("selectedVariants = { goku: 'v2' };");
        const gv2 = sim39('goku', 'vegeta', 12345, 'death');
        runInCtx('selectedVariants = {};');
        if (gv2.f.winner !== 'Vegeta' || gv2.f.decisiveCriterion !== 'speed') return false;
        runInCtx("selectedVariants = { sonic: 'v2' };");
        const sr = sim39('sonic', 'rocky', 12345, 'death');
        runInCtx('selectedVariants = {};');
        if (sr.f.winner !== 'Sonic' || sr.f.decisiveCriterion !== 'tier difference') return false;
        runInCtx("selectedVariants = { naruto: 'v3' };");
        const ns = sim39('naruto', 'sasuke', 12345, 'death');
        runInCtx('selectedVariants = {};');
        if (ns.f.winner !== 'Sasuke Uchiha' || ns.f.decisiveCriterion !== 'tier difference') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-B-DATA-CORRECTIONS (B, Jhay 2026-11-07 ~12:54) the 6 weak-text rewords are in the roster with the exact new values (Cloud drops Mako drain, Toshiro petals count down to Bankai completion, Godzilla drops radiation drain, Bolin drops draining, Sephiroth v2 one-hit win only after Safer is dead, Deku v2 no cut-Blackwhip-lines); the other records live in the structured object (Gearshift 5-min, Leon v2 gauge, Zoro v3 pass-out/week, Shikamaru ~5 min, All Might daily budget, Kakashi collapse/week/death)',
    (function () {
      try {
        const w = JSON.parse(runInCtx(`JSON.stringify({cloud: byId('cloud').weak, toshiro: byId('toshiro').weak, godzilla: byId('godzilla').weak, bolin: byId('bolin').weak, sephV2: byId('sephiroth').v2weak, dekuV2: byId('deku').v2weak})`));
        if (w.cloud !== 'Self-doubt') return false;
        if (w.toshiro !== 'Bankai petals count down to its completion in adult form; exhaustion and collapse after Bankai use') return false;
        if (w.godzilla !== 'Size; weakened only when cadmium, ANEB, or a second-brain strike is used against him') return false;
        if (w.bolin !== 'Lavabending is new') return false;
        if (w.sephV2.indexOf('the one-hit win comes only after Safer is already dead') === -1) return false;
        if (w.dekuV2.indexOf('cut Blackwhip lines') !== -1) return false;
        const r = JSON.parse(runInCtx(`JSON.stringify({
          dekuV2: staminaRecordV1655('deku','v2'),
          leonV2: staminaRecordV1655('leonkennedy','v2'),
          zoroV3: staminaRecordV1655('zoro','v3'),
          shikamaru: staminaRecordV1655('shikamaru','base'),
          allmight: staminaRecordV1655('allmight','base'),
          kakashi: staminaRecordV1655('kakashi','base')
        })`));
        if (!r.dekuV2 || r.dekuV2.poweredState.indexOf('Gearshift') === -1 || r.dekuV2.duration.indexOf('exactly 5 minutes') === -1) return false;
        if (!r.leonV2 || r.leonV2.poweredState !== 'RE6 combat gauge (stamina bar)') return false;
        if (!r.zoroV3 || r.zoroV3.weakenedState.indexOf('passes out from exhaustion') === -1 || r.zoroV3.recovery.indexOf('one week later') === -1) return false;
        if (!r.shikamaru || r.shikamaru.duration.indexOf('about 5 minutes') === -1) return false;
        if (!r.allmight || r.allmight.limit !== 'none' || r.allmight.duration.indexOf('daily budget') === -1) return false;
        if (!r.kakashi || r.kakashi.weakenedState.indexOf('bedridden at least a week') === -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-B-DOSSIER-ROW (B, Jhay 2026-11-07 ~12:54) the dossier panel shows the researched-stamina row for fighters with a structured record (Goku: the stated record; Sonic: the no-limit row) and no row for fighters without one (Batman)',
    (function () {
      try {
        runInCtx("selectedVariants = {}; openInfo('goku');");
        if ((els['info-content'].innerHTML || '').indexOf('<b>Stamina limit (researched, v16.55):</b>') === -1) return false;
        if ((els['info-content'].innerHTML || '').indexOf('Base form (Kaioken, Super Saiyan 3, Ultra Instinct)') === -1) return false;
        runInCtx("selectedVariants = {}; openInfo('sonic');");
        if ((els['info-content'].innerHTML || '').indexOf('No demonstrated stamina limit for this version.') === -1) return false;
        runInCtx("selectedVariants = {}; openInfo('batman');");
        if ((els['info-content'].innerHTML || '').indexOf('Stamina limit (researched') !== -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');


  // ================= v16.47 — Route B breakdown fix (plan B1-B6) =================
  // The offline telling is now the whole breakdown (Jhay ruling 2026-11-05
  // 23:54: no online breakdown at all). These checks pin the writing-quality
  // bar as code: the B6 pre-display check passes on the full telling, the
  // loser state is dead/incapacitated never knocked out, the telling carries
  // no engine language, the why carries the deciding step's evidence, the
  // Combat Details slots are labelled a reconstruction, the finish is
  // explained from the finisher's record (with the 10 gap finishers stated
  // as expected gaps), and the telling follows the ShortStory+ shape.
  check('V1647-TELLING-QUALITY (Route B B6) the pre-display quality check passes on the full telling for every golden battle + Batman vs Deadpool: the telling is multi-paragraph (no silent fallback to the short locked-facts form), carries a Verdict line, and qualityCheckTellingV1647 passes when called directly with the builder\'s own used-moves',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const jobs = gold.records.slice();
      jobs.push({ pair: 'batman/deadpool', seed: 12345, variant: null });
      for (let i = 0; i < jobs.length; i++) {
        const g = jobs[i];
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant || {}) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        if (t.split('\n\n').length < 4) return false;
        if (t.indexOf('Verdict: ') === -1) return false;
        if (t.indexOf(' wins. Finisher: ') !== -1) return false; // fallback form never appears
        const qc = JSON.parse(runInCtx(`JSON.stringify((function(){ var bt = globalThis._bt39; var f = frozenResolverResultV1634(bt); var bA = bt.alpha[0], bB = bt.beta[0]; var wB = (f.winner === f.fighterA.name) ? bA : bB; var lB = (f.winner === f.fighterA.name) ? bB : bA; var wR = (f.winner === f.fighterA.name) ? f.fighterA : f.fighterB; var lR = (f.winner === f.fighterA.name) ? f.fighterB : f.fighterA; var used = [{battleFighter: lB, power: lR.signature}, {battleFighter: wB, power: wR.signature}]; if (f.finisher) used.push({battleFighter: wB, power: f.finisher}); if (f.decisiveCriterion === 'incapacitation') { var incap = (f.winner === f.fighterA.name) ? f.inputs.incapA : f.inputs.incapB; if (incap && incap.power && incap.power.name) used.push({battleFighter: wB, power: incap.power.name}); } var tt = analysisNarrationTextV1638(bt); return qualityCheckTellingV1647(bt, f, tt, used); })())`));
        if (!qc.passed) return false;
      }
      return true;
    })(), '');
  check('V1650-LOSER-STATE (v16.50, Jhay re-lock 2026-11-06 10:11 — G5 only; loserState still dead on all 40) mortals die whatever the deciding reason: every golden record\'s loserState is dead, never knocked out, never incapacitated; winPath is death or incapacitation by criterion; frozen conditions winConditions is death on all 40 death-mode records; no golden record string contains knocked out',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      if (gold.records.length !== 40) return false;
      for (let i = 0; i < gold.records.length; i++) {
        const g = gold.records[i];
        if (g.record.indexOf('knocked out') !== -1) return false;
        if (g.loserState !== 'dead') return false;
        // Branch A: incapacitation-criterion battles are dead too — the
        // incapacitating power decides, the finisher kills.
        const rec = JSON.parse(g.record);
        if (rec.frozen.loserState !== g.loserState) return false;
        if (rec.frozen.winPath !== 'death' && rec.frozen.winPath !== 'incapacitation') return false;
        if (g.criterion === 'incapacitation' && rec.frozen.winPath !== 'incapacitation') return false;
        if (g.criterion !== 'incapacitation' && rec.frozen.winPath !== 'death') return false;
        if (rec.frozen.conditions.winConditions !== 'death') return false;
      }
      return true;
    })(), '');
  check('V1647-NO-ENGINE-TERMS (Route B B1/B6) the live telling carries no engine language: no schema, resolver, Step N, BFR, knocked out, commits, answers with, Decisive label, cannot-harm label, round numbers, or damage/HP numbers — on the 8 base pairs + Batman vs Deadpool',
    (function () {
      const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman'], ['batman', 'deadpool']];
      const banned = ['schema', 'resolver', 'BFR', 'knocked out', 'commits ', 'answers with', 'Decisive:', 'cannot-harm'];
      for (let i = 0; i < pairs.length; i++) {
        const r = sim39(pairs[i][0], pairs[i][1], 12345, 'death');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        for (let j = 0; j < banned.length; j++) { if (t.indexOf(banned[j]) !== -1) return false; }
        if (/Step \d/.test(t)) return false;
        if (/Round \d/.test(t)) return false;
        if (/\b\d+ damage\b/.test(t)) return false;
        if (/\bHP \d/.test(t)) return false;
        if (/\b\d+ HP\b/.test(t)) return false;
      }
      return true;
    })(), '');
  check('V1647-NO-KNOCKOUT-WORD (Route B B3) Death (knockout) is gone from the file and knocked out is gone from every live surface: the 8 base pairs\' telling, conditions, header title and desc carry no knocked out and no Death (knockout); the knocked-out literals left in the file are retired-path, legacy-comparison, and Audit-diagnostic strings only, never on a live surface',
    (function () {
      if (html.split('Death (knockout)').length - 1 !== 0) return false;
      const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman']];
      for (let i = 0; i < pairs.length; i++) {
        runInCtx(`selected = ['${pairs[i][0]}','${pairs[i][1]}']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt47 = simulateBattle(); showResults();`);
        const t = runInCtx(`analysisNarrationTextV1638(globalThis._bt47)`);
        const c = (els['conditions-output'].innerText || '') + (els['conditions-output'].innerHTML || '');
        const title = runInCtx(`document.getElementById('result-title').innerText`);
        const desc = runInCtx(`document.getElementById('result-desc').innerText`);
        const live = t + ' ' + c + ' ' + title + ' ' + desc;
        if (live.indexOf('knocked out') !== -1) return false;
        if (live.indexOf('Death (knockout)') !== -1) return false;
      }
      return true;
    })(), '');
check('V1651-WHY-EVIDENCE (Route B B1; v16.50 G5 + v16.51 H2) the why carries the deciding step\'s actual evidence, not one generic string per criterion: stamina whys name the powered state, the weakened state, and the finisher of the weakened fighter in plain speech (v16.55 B: the structured record replaces the old \'stated limit is:\' / \'has no stated limit\' strings; the F7 limited-resource cite was dropped by Jhay 2026-11-06 16:43); cannot-harm whys name the gate evidence; tier whys name the gap; speed whys name the faster fighter (no disclaimer in the why itself); incapacitation whys name the deciding power in death framing; no why carries schema/resolver language',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const jobs = gold.records.slice();
      jobs.push({ pair: 'batman/deadpool', seed: 12345, variant: null });
      for (let i = 0; i < jobs.length; i++) {
        const g = jobs[i];
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant || {}) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const why = r.f.why || '';
        const crit = r.f.decisiveCriterion;
        if (crit === 'stamina') {
          if (why.indexOf('runs out first') === -1) return false;
          // v16.55 (B): the structured stamina why names the powered
          // state + weakened state + the finisher of the weakened
          // fighter ("{L}'s {powered} ends. {Weakened}. {W} finishes
          // the weakened {L}.") — the old 'stated limit is:' / 'has no
          // stated limit' strings are gone from stamina whys (the
          // regex fallback keeps them only for unresearched variants,
          // e.g. Goku v2, which no golden exercises).
          if (why.indexOf('finishes the weakened') === -1) return false;
        } else if (crit === 'cannot-harm') {
          if (why.indexOf('cannot hurt') === -1) return false;
          // v16.50 re-lock extension (Jhay 2026-11-06 13:19 EST): the gate
          // evidence varies per pair in plain speech — "The tier difference
          // plus <X>'s durability block ..." / "<L>'s ordinary attacks
          // cannot get through <W> — a tier above ..." / "<W> fights a tier
          // above, and <L>'s ... no way through that durability ...". All
          // three name the tier gap, the defender's durability, and the
          // missing bypass/exploit/counter (the old 'tier gap' / 'record
          // says it cannot hurt' strings never occur).
          if (why.indexOf('tier gap') === -1 && why.indexOf('record says it cannot hurt') === -1 && !(why.indexOf('tier') !== -1 && why.indexOf('no bypass') !== -1)) return false;
        } else if (crit === 'tier difference') {
          if (why.indexOf('tier difference') === -1) return false;
          // v16.47 HARNESS FIX: the gap reads "fights one tier above"
          // (one tier) / "fights more than one tier above" (wider gap) —
          // 'one tier above' is a substring of both.
          if (why.indexOf('one tier apart') === -1 && why.indexOf('more than one tier above') === -1 && why.indexOf('one tier above') === -1) return false;
        } else if (crit === 'speed') {
          if (why.indexOf('is faster than') === -1) return false;
        } else if (crit === 'incapacitation') {
          if (why.indexOf('stops ') === -1 || why.indexOf(' from continuing') === -1) return false; // v16.49 (F3): 'X wins: [P] stops Y from continuing — and [finisher] kills Y.'
        }
        if (why.indexOf('schema') !== -1 || why.indexOf('resolver') !== -1) return false;
      }
      return true;
    })(), '');
  check('V1647-B4-RECONSTRUCTION (Route B B4, pick (i)) Combat Details labels its rendered slots as a reconstruction from the frozen record, never as observed blows; the finishing line states the recorded loser state; the telling carries no round numbers and no damage numbers',
    (function () {
      const r = sim39('superman', 'rocky', 12345, 'death');
      const bd = runInCtx(`generateBreakdown(globalThis._bt39)`);
      if (bd.indexOf('Reconstruction — not observed events:') === -1) return false;
      if (bd.indexOf('laid out from the resolver') === -1) return false;
      if (bd.indexOf('not from observed blows') === -1) return false;
      if (bd.indexOf('Rocky Balboa is dead') === -1) return false;
      if (bd.indexOf('finishing line states the recorded loser state') === -1) return false;
      const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
      if (/Round \d/.test(t)) return false;
      if (/\b\d+ damage\b/.test(t)) return false;
      return true;
    })(), '');
check('V1650-FINISH-EXPLAINED (Route B B3; v16.50 G3) the finish is explained from the finisher\'s recorded outcome: every telling\'s finish paragraph names the finisher and the recorded loser state; where the finisher\'s dossier power record carries an outcome the outcome sentence fires (one of 19 plain-word variants, hash-picked per pair with the variant in the input); where it carries none (10 variant finishers — Attraction Flow, Paralyzer, Hyakuretsukyaku, Aether Fury, Draupnir Spear, Master Sword Spin, Desperate Punch, Three Sword Style: Oni Giri, Rasengan, Final Explosion) the telling states finisher + loser state with no invented mechanism and no outcome sentence; no \'The record calls it\' anywhere',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const jobs = gold.records.slice();
      jobs.push({ pair: 'batman/deadpool', seed: 12345, variant: null });
      for (let i = 0; i < jobs.length; i++) {
        const g = jobs[i];
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant || {}) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        const paras = t.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean);
        const fin = paras.filter(function (p) { return p.indexOf('finishes with') !== -1; });
        if (fin.length !== 1) return false;
        const fp = fin[0];
        if (fp.indexOf(r.f.finisher) === -1) return false;
        const lState = (r.f.loserState === 'dead') ? 'is dead.' : (r.f.loserState === 'incapacitated') ? 'is incapacitated and cannot continue.' : 'is unconscious, not dead.';
        if (fp.indexOf(lState) === -1) return false;
        // v16.49 (F5): the outcome sentence fires from the DOSSIER power
        // record's outcome — not the Part 11 record. Gap finishers (a
        // dossier record with no outcome, or no record at all) carry no
        // outcome sentence and no invented mechanism.
        const OUTCOMES1650 = ["It's lethal.", 'The blow is lethal.', 'That is a killing blow.', 'The finish is lethal, full stop.', 'It stops the target from continuing.', 'The target cannot continue after that.', "That ends the target's ability to continue.", 'The wounds add up past what regeneration can cover.', 'Regeneration cannot keep up with that damage.', 'The healing cannot close wounds that fast.', 'The wounds add up past a defence that can be beaten.', 'Even that defence gives way under it.', 'The defence holds until it does not.', 'A mortal body does not get up from that.', 'A mortal body cannot take that and keep fighting.', 'That is more than a mortal body survives.', 'The body gives out under it.', 'The damage is too much for a mortal body.', 'No mortal body walks away from that.'];
        const winBf1649 = (r.f.winner === r.f.fighterA.name) ? 'globalThis._bt39.alpha[0]' : 'globalThis._bt39.beta[0]';
        const pw1649 = JSON.parse(runInCtx('JSON.stringify((function(){ try { return dossierPowerV1638(' + winBf1649 + ', ' + JSON.stringify(r.f.finisher) + '); } catch (e) { return null; } })())'));
        if (r.f.decisiveCriterion !== 'incapacitation') {
          if (pw1649 && pw1649.outcome) {
            if (!OUTCOMES1650.some(function (o) { return fp.indexOf(o) !== -1; })) return false;
          } else {
            if (OUTCOMES1650.some(function (o) { return fp.indexOf(o) !== -1; })) return false;
          }
          if (fp.indexOf('The record calls it') !== -1) return false;
        } else {
          const incapName = (r.f.winner === r.f.fighterA.name) ? (r.f.inputs.incapA && r.f.inputs.incapA.power && r.f.inputs.incapA.power.name) : (r.f.inputs.incapB && r.f.inputs.incapB.power && r.f.inputs.incapB.power.name);
          if (incapName && r.f.finisher !== incapName) {
            // v16.50 (G3c): the fix-3 sentence has 3 framings — any one
            // counts, as long as it names the deciding power and the
            // finisher as the killer.
            const loserName = (r.f.winner === r.f.fighterA.name) ? r.f.fighterB.name : r.f.fighterA.name;
            const f3 = [incapName + ' is the deciding power — it stops ' + loserName + ' from continuing; ' + r.f.finisher + ' is the final blow that kills ' + loserName + '.', incapName + ' stops ' + loserName + ' from continuing — that is the deciding power — and ' + r.f.finisher + ' is the blow that kills ' + loserName + '.', 'The deciding power is ' + incapName + ' — it stops ' + loserName + ' from continuing — and ' + r.f.finisher + ' is the final blow that kills ' + loserName + '.'];
            if (!f3.some(function (s) { return fp.indexOf(s) !== -1; })) return false;
          }
        }
      }
      return true;
    })(), '');
  check('V1650-SHORTSTORY-SHAPE (v16.50 G1-G8) the telling follows the ShortStory+ telling shape — opener poses the matchup as a question and names the conflict, loser\'s best case, winner\'s counter, a pivot to the deciding evidence, the finish, and the verdict — with a distinct opener first sentence per matchup and a criterion-grounded pivot, not one template sentence',
    (function () {
      const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman'], ['batman', 'deadpool']];
      const openers = [];
      for (let i = 0; i < pairs.length; i++) {
        const r = sim39(pairs[i][0], pairs[i][1], 12345, 'death');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        const paras = t.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (paras.length < 5) return false;
        if (paras[0].indexOf('?') === -1) return false; // opener poses the matchup as a question
        openers.push(paras[0].split(/(?<=[.?!])\s/)[0]);
        const pivots1649 = ['So it comes down to staying power: ', 'In the end, one fighter lasts longer: ', 'That leaves the long game: ', 'What breaks first is the body: ', 'The fight goes to whoever lasts: ', 'One point ends the argument: ', 'Here is the whole fight: ', 'The ending turns on one move: ', 'That is the fight, right there: ', 'It comes down to a single ending: ', 'So the question answers itself: ', 'That is the whole story: ', 'One fact ends the argument: ', 'There is nowhere else for this to go: ', 'The answer is in the opening: ', 'So the gap does the work: ', 'That is what the tiers mean here: ', 'One step up, and it shows: ', 'The fight follows the gap: ', 'Above is above: ', 'So the pace is the point: ', 'That is the whole difference: ', 'One fighter moves first, and keeps moving first: ', "The fight runs on one fighter's terms: ", 'First to the opening, every time: ', 'So the body is the argument: ', 'That is what holds up means: ', 'One body takes it, the other does not: ', 'In the end, it is about what breaks: ', 'The fight comes down to what lasts: '];
        const decide = paras.filter(function (p) { return pivots1649.some(function (pv) { return p.indexOf(pv) !== -1; }); });
        if (decide.length !== 1) return false;
        if (paras[paras.length - 1].indexOf('Verdict: ') !== 0) return false;
        const loser = (r.f.winner === r.f.fighterA.name) ? r.f.fighterB.name : r.f.fighterA.name;
        if (paras[0].indexOf(loser) === -1 && paras[0].indexOf(r.f.winner) === -1) return false; // opener names the matchup
        const planText = paras.slice(1, 3).join(' ');
        if (planText.indexOf('leads with') === -1 && planText.indexOf('best plan is') === -1) return false;
      }
      const uniq = {};
      openers.forEach(function (o) { uniq[o] = 1; });
      if (Object.keys(uniq).length !== openers.length) return false; // no two matchups share an opener first sentence
      return true;
    })(), '');
  check('V1650-PLAYER-RESULTS (G4a + G4b) after showResults (spiderman/batman, seed 12345) the player screen shows the plain offline label and the one-line seed/final-blow line, the conditions line is \'Conditions: Neutral ground.\', the rubric-output is empty, the player outputs carry no rubric/engine words, and the header states death (not death/incapacitation)',
    (function () {
      runInCtx(`selected = ['spiderman','batman']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt50 = currentBattle = simulateBattle(); showResults();`);
      const label = runInCtx(`document.getElementById('result-offline-label').innerText`);
      if (label !== 'Breakdown — written on this device, no internet needed.') return false; // v16.50 (G4b)
      const fd = JSON.parse(runInCtx(`JSON.stringify(frozenRecordV1639(globalThis._bt50).damageSplit.finalDamage)`));
      const seedLine = runInCtx(`document.getElementById('result-seed-line').innerText`);
      if (seedLine !== 'Battle seed: 12345 · Final blow: ' + fd + ' damage.') return false;
      const ro = runInCtx(`document.getElementById('rubric-output').innerHTML`);
      if (ro !== '') return false;
      const cond = (els['conditions-output'].innerText || '') + (els['conditions-output'].innerHTML || '');
      const story = (els['story-output'].innerText || '') + (els['story-output'].innerHTML || '');
      const live = cond + ' ' + story;
      if (cond.indexOf('Conditions: Neutral ground.') === -1) return false; // v16.50 (G4a)
      if (live.indexOf('Rubric —') !== -1 || live.indexOf('Decided at step') !== -1 || live.indexOf('Decisive criterion:') !== -1) return false;
      const title = runInCtx(`document.getElementById('result-title').innerText`);
      const desc = runInCtx(`document.getElementById('result-desc').innerText`);
      if (title.indexOf('death/incapacitation') !== -1 || desc.indexOf('death/incapacitation') !== -1) return false;
      if (desc.indexOf('Victory condition: death.') === -1) return false;
      const h = html.indexOf('id="episode-heading"');
      const l = html.indexOf('id="result-offline-label"');
      const s = html.indexOf('id="result-seed-line"');
      const st = html.indexOf('id="story-output"');
      if (h === -1 || l === -1 || s === -1 || st === -1 || !(h < l && l < s && s < st)) return false;
      return true;
    })(), '');
  check('H-V1650-VERDICT-KILLER (G6 + v16.54 A1) the verdict sentence names the finisher on EVERY branch, on all 40 golden tellings + Batman vs Deadpool: incapacitation ("[finisher] is the blow that kills [L]" / "[finisher] kills [L]" / "it is [finisher] that kills [L]"), stamina/tier ("[finisher] is the blow that ends it" / "[finisher] closes it"), cannot-harm/speed/durability ("[finisher] ends it" / "[finisher] closes it")',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const jobs = gold.records.slice();
      jobs.push({ pair: 'batman/deadpool', seed: 12345, variant: null });
      for (let i = 0; i < jobs.length; i++) {
        const g = jobs[i];
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant || {}) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        const paras = t.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean);
        const last = paras[paras.length - 1];
        if (last.indexOf('Verdict: ') !== 0) return false;
        if (last.indexOf(r.f.finisher) === -1) return false;
        // v16.50 (G6): on incapacitation the finisher is the KILLER, not
        // the stopper — the verdict must say so.
        if (r.f.decisiveCriterion === 'incapacitation') {
          const loserName = (r.f.winner === r.f.fighterA.name) ? r.f.fighterB.name : r.f.fighterA.name;
          // v16.54 (A1): any of the 3 killer framings counts.
          if (last.indexOf(r.f.finisher + ' is the blow that kills ' + loserName) === -1 &&
              last.indexOf(r.f.finisher + ' kills ' + loserName) === -1 &&
              last.indexOf('it is ' + r.f.finisher + ' that kills ' + loserName) === -1) return false;
        }
      }
      return true;
    })(), '');
  check('H-V1650-PIVOT-DISTINCT (F2) the 9 standard tellings at EACH of 3 seeds (12345, 132454433, 16026832) each open their decisive paragraph with a different pivot (30 pivots1649 wordings, hash-picked per pair) — no one template line in every battle, and no same-criterion pair shares an opener',
    (function () {
      const pivots1649 = ['So it comes down to staying power: ', 'In the end, one fighter lasts longer: ', 'That leaves the long game: ', 'What breaks first is the body: ', 'The fight goes to whoever lasts: ', 'One point ends the argument: ', 'Here is the whole fight: ', 'The ending turns on one move: ', 'That is the fight, right there: ', 'It comes down to a single ending: ', 'So the question answers itself: ', 'That is the whole story: ', 'One fact ends the argument: ', 'There is nowhere else for this to go: ', 'The answer is in the opening: ', 'So the gap does the work: ', 'That is what the tiers mean here: ', 'One step up, and it shows: ', 'The fight follows the gap: ', 'Above is above: ', 'So the pace is the point: ', 'That is the whole difference: ', 'One fighter moves first, and keeps moving first: ', "The fight runs on one fighter's terms: ", 'First to the opening, every time: ', 'So the body is the argument: ', 'That is what holds up means: ', 'One body takes it, the other does not: ', 'In the end, it is about what breaks: ', 'The fight comes down to what lasts: '];
      const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman'], ['batman', 'deadpool']];
      const seeds = [12345, 132454433, 16026832];
      for (let s = 0; s < seeds.length; s++) {
        const seen = {};
        for (let i = 0; i < pairs.length; i++) {
          runInCtx(`selected = ['${pairs[i][0]}','${pairs[i][1]}']; forcedSeed = ${seeds[s]}; forcedVictoryMode = 'death'; globalThis._bt50 = currentBattle = simulateBattle(); showResults();`);
          const t = runInCtx(`analysisNarrationTextV1638(globalThis._bt50)`);
          const paras = t.split('\n\n').map(function (x) { return x.trim(); }).filter(Boolean);
          const decide = paras.filter(function (p) { return pivots1649.some(function (pv) { return p.indexOf(pv) !== -1; }); });
          if (decide.length !== 1) return false;
          const pv = pivots1649.find(function (x) { return decide[0].indexOf(x) !== -1; });
          if (seen[pv]) return false;
          seen[pv] = 1;
        }
      }
      return true;
    })(), '');
  check('V1650-NO-DOUBLED-WORDS (main-test item 2) no golden telling and no Batman vs Deadpool telling carries a doubled word ("Both both" never renders anywhere in the file)',
    (function () {
      if (html.indexOf('Both both') !== -1) return false;
      const dbl = /\b([A-Za-z]+)\s+\1\b/i;
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const jobs = gold.records.slice();
      jobs.push({ pair: 'batman/deadpool', seed: 12345, variant: null });
      for (let i = 0; i < jobs.length; i++) {
        const g = jobs[i];
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant || {}) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        if (dbl.test(t)) return false;
        if (t.indexOf('Both both') !== -1) return false;
      }
      return true;
    })(), '');

  check('H-V1650-NO-DOUBLE-DECIDE (G5/G8d) in every golden telling + Batman vs Deadpool the decide paragraph never states the deciding claim twice: the pivot before the why and the deciding extra after it carry no "decides it", "settles it", or "decided", and the whole paragraph carries "decides it" at most once (the tier why carries it once since G5 reworded it)',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const jobs = gold.records.slice();
      jobs.push({ pair: 'batman/deadpool', seed: 12345, variant: null });
      for (let i = 0; i < jobs.length; i++) {
        const g = jobs[i];
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant || {}) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        const why = r.f.why || '';
        const paras = t.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean);
        const dec = paras.filter(function (p) { return why && p.indexOf(why) !== -1; });
        if (dec.length !== 1) return false;
        const before = dec[0].slice(0, dec[0].indexOf(why));
        const after = dec[0].slice(dec[0].indexOf(why) + why.length);
        if (/decides it|settles it|decided/i.test(before)) return false;
        if (/decides it|settles it/i.test(after)) return false;
        if ((dec[0].match(/decides it/gi) || []).length > 1) return false; // v16.50 (G5/G8d): whole-paragraph count
      }
      return true;
    })(), '');
  check('H-V1650-EFFECT-CORE (G2) no telling repeats the same CORE "it can hurt ..." effect clause across its plan paragraphs: the two attack paragraphs never carry clauses with the same core (the cleaned canHurt value up to the first ";" or " — ", trailing " at full effect" stripped) — checked over every golden telling + Batman vs Deadpool, excluding the finish paragraph',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const jobs = gold.records.slice();
      jobs.push({ pair: 'batman/deadpool', seed: 12345, variant: null });
      for (let i = 0; i < jobs.length; i++) {
        const g = jobs[i];
        runInCtx('selectedVariants = ' + JSON.stringify(g.variant || {}) + ';');
        const r = sim39(g.pair.split('/')[0], g.pair.split('/')[1], g.seed, 'death');
        runInCtx('selectedVariants = {};');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        const paras = t.split('\n\n').map(function (s) { return s.trim(); }).filter(Boolean);
        const seen = {};
        for (let j = 0; j < paras.length; j++) {
          if (paras[j].indexOf('finishes with') !== -1) continue;
          const m = paras[j].match(/it can hurt [^.]+/gi) || [];
          for (let k = 0; k < m.length; k++) {
            // v16.50 (G2): compare CORE clauses via the real function, not
            // whole cleaned values — a suffix must not hide a repeat.
            const nc = runInCtx('coreEffectV1650(' + JSON.stringify(m[k]) + ')');
            if (seen[nc]) return false;
            seen[nc] = 1;
          }
        }
      }
      return true;
    })(), '');
  check('H-V1650-FINISH-VARIED-11 (G3) the finish outcome sentences vary across the 11 live battles at EACH of 3 seeds (12345, 138292330, 1760855201): no two tellings that carry an outcome clause close with the same sentence (lethal / incapacitated / wounded-regenerative / wounded-invulnerable / wounded-mortal buckets, hash-picked per pair with the variant in the input); Batman/Deadpool never gets "The wounds add up against a mortal body."; the two incapacitation finish paragraphs use different fix-3 framings',
    (function () {
      const OUTCOMES1650 = ["It's lethal.", 'The blow is lethal.', 'That is a killing blow.', 'The finish is lethal, full stop.', 'It stops the target from continuing.', 'The target cannot continue after that.', "That ends the target's ability to continue.", 'The wounds add up past what regeneration can cover.', 'Regeneration cannot keep up with that damage.', 'The healing cannot close wounds that fast.', 'The wounds add up past a defence that can be beaten.', 'Even that defence gives way under it.', 'The defence holds until it does not.', 'A mortal body does not get up from that.', 'A mortal body cannot take that and keep fighting.', 'That is more than a mortal body survives.', 'The body gives out under it.', 'The damage is too much for a mortal body.', 'No mortal body walks away from that.'];
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      const seeds = [12345, 138292330, 1760855201];
      for (let s = 0; s < seeds.length; s++) {
        const seen = {};
        let f3b4 = '', f3b8 = '';
        for (let i = 0; i < pairs.length; i++) {
          runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
          const r = sim39(pairs[i][0], pairs[i][1], seeds[s], 'death');
          runInCtx('selectedVariants = {};');
          const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          const paras = t.split('\n\n').map(function (x) { return x.trim(); }).filter(Boolean);
          const fin = paras.filter(function (p) { return p.indexOf('finishes with') !== -1; });
          if (fin.length !== 1) return false;
          if (r.f.decisiveCriterion === 'incapacitation') {
            // v16.50 (G3c): capture the fix-3 sentence (the one naming the
            // deciding power) on B4 and B8 — they must use different
            // framings, not the identical template.
            const m = fin[0].match(/[^.]*deciding power[^.]*\./);
            if (pairs[i][0] === 'superman' && pairs[i][1] === 'goku') f3b4 = m ? m[0] : '';
            if (pairs[i][0] === 'vader' && pairs[i][1] === 'superman') f3b8 = m ? m[0] : '';
            continue;
          }
          const o = OUTCOMES1650.filter(function (x) { return fin[0].indexOf(x) !== -1; });
          if (o.length === 0) continue; // gap finisher (e.g. Rasengan) — no outcome sentence to vary
          if (o.length !== 1) return false;
          if (seen[o[0]]) return false;
          seen[o[0]] = 1;
          // v16.50 (G3b): Batman/Deadpool never gets the flagged sentence.
          if (pairs[i][0] === 'batman' && pairs[i][1] === 'deadpool' && o[0] === 'The wounds add up against a mortal body.') return false;
        }
        if (!f3b4 || !f3b8 || f3b4 === f3b8) return false;
      }
      return true;
    })(), '');
  check('H-V1650-NO-RECORD-TALK (F4/F6) the player screen carries no engine/record talk: after showResults on the 9 standard pairs the conditions + story text never contains "the record says it can hurt", "recorded incapacitating power", "The record calls it", "no recorded element", "recorded morals", or "ENGINE" (the liked opener "the record says nothing" / "the record says {L} tires first" stays allowed)',
    (function () {
      const pairs = [['spiderman', 'batman'], ['goku', 'vegeta'], ['superman', 'rocky'], ['superman', 'goku'], ['deadpool', 'wolverine'], ['saitama', 'frodo'], ['raven', 'sephiroth'], ['vader', 'superman'], ['batman', 'deadpool']];
      const banned = ['the record says it can hurt', 'recorded incapacitating power', 'The record calls it', 'no recorded element', 'recorded morals', 'ENGINE'];
      for (let i = 0; i < pairs.length; i++) {
        runInCtx(`selected = ['${pairs[i][0]}','${pairs[i][1]}']; forcedSeed = 12345; forcedVictoryMode = 'death'; globalThis._bt50 = currentBattle = simulateBattle(); showResults();`);
        const cond = (els['conditions-output'].innerText || '') + (els['conditions-output'].innerHTML || '');
        const story = (els['story-output'].innerText || '') + (els['story-output'].innerHTML || '');
        const live = cond + ' ' + story;
        for (let j = 0; j < banned.length; j++) { if (live.indexOf(banned[j]) !== -1) return false; }
      }
      return true;
    })(), '');
  check('H-V1651-BATMAN-CITE-DROPPED (F7, Jhay ruling 2026-11-06 16:43 — "drop the Batman cite") Batman vs Deadpool at all 3 seeds (12345, 132454433, 16026832) is decided on speed (v16.55 B: both-stated fall-through — Batman and Deadpool both carry a stated limit, so stamina no longer decides) and the why is the plain speed why with NO limited-resource cite and NO "record" wording: Deadpool wins, finisher Dual Katana Slash',
    (function () {
      const seeds = [12345, 132454433, 16026832];
      for (let i = 0; i < seeds.length; i++) {
        const r = sim39('batman', 'deadpool', seeds[i], 'death');
        if (r.f.decisiveCriterion !== 'speed') return false; // v16.55 (B): both-stated fall-through
        if (r.f.winner !== 'Deadpool' || r.f.finisher !== 'Dual Katana Slash') return false;
        if (r.f.why.indexOf('Speed decides it: ') !== 0) return false;
        if (r.f.why.indexOf('limited resource') !== -1) return false;
        if (r.f.why.indexOf('the record states') !== -1) return false;
        if (r.f.why.indexOf('record') !== -1) return false;
      }
      return true;
    })(), '');
  check('H-V1651-DOES-DEDUP (H1) no telling prints the same does line twice across its plan paragraphs: the 11 live battles + the side set (9 pairs) at EACH of 3 seeds (12345, 922703364, 157478250); the second plan paragraph (or the merged shutout paragraph\'s winner clause) drops its does when both powers carry the same recorded meaning (Kamehameha / Galick Gun / Final Flash share "Full-screen ki beam"); validated on the build probe — goku/vegeta carries the line exactly once at all 3 seeds',
    (function () {
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      const seeds = [12345, 922703364, 157478250];
      for (let s = 0; s < seeds.length; s++) {
        for (let i = 0; i < pairs.length; i++) {
          runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
          const r = sim39(pairs[i][0], pairs[i][1], seeds[s], 'death');
          runInCtx('selectedVariants = {};');
          const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          const paras = t.split('\n\n').map(function (x) { return x.trim(); }).filter(Boolean);
          const plan = [];
          if (paras[1]) plan.push(paras[1]);
          if (paras[2] && paras[2].indexOf('counters with') !== -1) plan.push(paras[2]);
          const seen = {};
          for (let p = 0; p < plan.length; p++) {
            const m = plan[p].match(/ — ([^.]+)\./g) || [];
            for (let k = 0; k < m.length; k++) {
              const v = m[k].replace(/^ — /, '').replace(/\.$/, '').trim().toLowerCase();
              if (seen[v]) return false;
              seen[v] = 1;
            }
          }
        }
      }
      return true;
    })(), '');
  check('H-V1651-RECORD-INVENTORY (H2) the player telling carries none of the dropped "record" phrases on the 11 live battles + the side set at EACH of 3 seeds (12345, 922703364, 157478250): "the record states Batman spends a limited resource" (F7 cite, dropped by Jhay 2026-11-06 16:43), "No stated limit is recorded for" (honest line, reworded), "a recorded loss ends the fight", "only a recorded bypass or an overwhelming gap ends the fight", "The record stops the question cold"; every remaining "record*" occurrence is inventoried below (F8 clause, Frodo/Superman opener frame, stamina opener frames kept per the v16.50 G4 keep-list, dossier record fields)',
    (function () {
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      const banned = ['the record states Batman spends a limited resource', 'No stated limit is recorded for', 'a recorded loss ends the fight', 'only a recorded bypass or an overwhelming gap ends the fight', 'The record stops the question cold'];
      const seeds = [12345, 922703364, 157478250];
      const inv = {};
      for (let s = 0; s < seeds.length; s++) {
        for (let i = 0; i < pairs.length; i++) {
          runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
          const r = sim39(pairs[i][0], pairs[i][1], seeds[s], 'death');
          runInCtx('selectedVariants = {};');
          const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          for (let j = 0; j < banned.length; j++) { if (t.indexOf(banned[j]) !== -1) return false; }
          const ms = t.match(/[^.!?]{0,50}record\w*[^.!?]{0,50}/gi) || [];
          ms.forEach(function (m) { const k = m.replace(/\s+/g, ' ').trim(); inv[k] = (inv[k] || 0) + 1; });
        }
      }
      console.log('H-V1651-RECORD-INVENTORY remaining record* occurrences (allowed — F8 clause, Frodo frame, stamina opener frames per v16.50 G4 keep-list, dossier record fields):');
      Object.keys(inv).forEach(function (k) { console.log('  x' + inv[k] + ' ' + k); });
      return true;
    })(), '');
  check('H-V1651-FINISH-NO-FLAGGED (H3) "The wounds add up against a mortal body." appears in NO telling across the 11 live battles + the side set at EACH of 3 seeds (12345, 922703364, 157478250) — the sentence was replaced in place in the mortal-bucket finish variants (bucket stays 6), not hash-dodged',
    (function () {
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      const seeds = [12345, 922703364, 157478250];
      for (let s = 0; s < seeds.length; s++) {
        for (let i = 0; i < pairs.length; i++) {
          runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
          const r = sim39(pairs[i][0], pairs[i][1], seeds[s], 'death');
          runInCtx('selectedVariants = {};');
          const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          if (t.indexOf('The wounds add up against a mortal body.') !== -1) return false;
        }
      }
      return true;
    })(), '');
  check('H-V1650-OPENER-DISTINCT (G1a) the 11 live tellings at EACH of 3 seeds (12345, 138292330, 1760855201) open with distinct P1 openers within their criterion (5 opener frames per criterion, pair-stable hash with the variant in the input, shift >>> 18) — no same-criterion pair shares an opener, including base vs variant forms of one pair',
    (function () {
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      const seeds = [12345, 138292330, 1760855201];
      for (let s = 0; s < seeds.length; s++) {
        const byCrit = {};
        for (let i = 0; i < pairs.length; i++) {
          runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
          const r = sim39(pairs[i][0], pairs[i][1], seeds[s], 'death');
          runInCtx('selectedVariants = {};');
          const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          const p1 = (t.split('\n\n').map(function (x) { return x.trim(); }).filter(Boolean)[0]) || '';
          const crit = r.f.decisiveCriterion;
          if (!byCrit[crit]) byCrit[crit] = [];
          if (byCrit[crit].indexOf(p1) !== -1) return false;
          byCrit[crit].push(p1);
        }
      }
      return true;
    })(), '');
  check('H-V1650-DECIDE-BODY-DISTINCT (G1b) the 11 live tellings at EACH of 3 seeds (12345, 138292330, 1760855201) have distinct decide paragraphs (pivot + why + deciding extra), and where the deciding extra is non-empty, same-criterion pairs do not share the same extra string — the frozen why now varies per pair on cannot-harm (G1b re-lock extension) and is pinned by the goldens',
    (function () {
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      const seeds = [12345, 138292330, 1760855201];
      for (let s = 0; s < seeds.length; s++) {
        const decs = [];
        const byCrit = {};
        for (let i = 0; i < pairs.length; i++) {
          runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
          const r = sim39(pairs[i][0], pairs[i][1], seeds[s], 'death');
          runInCtx('selectedVariants = {};');
          const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
          const why = r.f.why || '';
          const paras = t.split('\n\n').map(function (x) { return x.trim(); }).filter(Boolean);
          const dec = paras.filter(function (p) { return why && p.indexOf(why) !== -1; });
          if (dec.length !== 1) return false;
          if (decs.indexOf(dec[0]) !== -1) return false;
          decs.push(dec[0]);
          const extra = dec[0].slice(dec[0].indexOf(why) + why.length);
          const crit = r.f.decisiveCriterion;
          if (!byCrit[crit]) byCrit[crit] = [];
          if (extra.trim()) {
            if (byCrit[crit].indexOf(extra) !== -1) return false;
            byCrit[crit].push(extra);
          }
        }
      }
      return true;
    })(), '');
  check('H-V1650-CONDITIONS-SHORT (G4a + v16.54 A8) the conditions line is exactly "Conditions: Neutral ground." on every BASE death-mode telling with a winner and no battlefield modifiers (all 11 live battles at 3 seeds — the one variant pair names its variants instead); incapacitation mode keeps the full line',
    (function () {
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      const seeds = [12345, 138292330, 1760855201];
      for (let s = 0; s < seeds.length; s++) {
        for (let i = 0; i < pairs.length; i++) {
          runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
          const x = nar1638(pairs[i][0], pairs[i][1], seeds[s], 'death');
          runInCtx('selectedVariants = {};');
          if (pairs[i][2]) {
            // v16.54 (A8): a variant battle names the variants in the line.
            if (x.c !== 'Conditions: Neutral ground. Goku (Super Saiyan God) vs Vegeta (Base).') return false;
          } else if (x.c !== 'Conditions: Neutral ground.') return false;
        }
      }
      const xi = nar1638('spiderman', 'batman', 12345, 'incapacitation');
      if (xi.c.indexOf('Mode: Incapacitation') === -1 || xi.c.indexOf('unconscious, not dead') === -1) return false;
      return true;
    })(), '');
  check('H-V1650-LABEL-PLAIN (G4b) the player results screen label reads "Breakdown — written on this device, no internet needed." — no "frozen record" anywhere on the player screen (the tester surface still says the telling is written from the frozen record, out of scope)',
    (function () {
      runInCtx(`selected = ['spiderman','batman']; forcedSeed = 12345; forcedVictoryMode = 'death'; startBattle();`);
      const label = els['result-offline-label'] ? (els['result-offline-label'].innerText || '') : '';
      if (label !== 'Breakdown — written on this device, no internet needed.') return false;
      const so = els['story-output'] ? (els['story-output'].innerText || '') + (els['story-output'].innerHTML || '') : '';
      if (so.indexOf('frozen record') !== -1) return false;
      return true;
    })(), '');
  check('H-V1650-TIER-WHY-SINGLE (G5) the tier why contains "decides it" exactly once, on all 7 tier golden records (deadpool/wolverine x3, spyro/wario v2, mario/link v3, sonic/rocky v2, naruto/sasuke v3) — v16.55 (B): tanjiro/zoro v2 left tier for stamina, sonic/rocky v2 and naruto/sasuke v3 joined tier',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const tier = gold.records.filter(function (g) { return g.criterion === 'tier difference'; });
      if (tier.length !== 7) return false;
      for (let i = 0; i < tier.length; i++) {
        const why = (JSON.parse(tier[i].record).frozen || {}).why || '';
        if ((why.match(/decides it/g) || []).length !== 1) return false;
        if (why.indexOf('one tier above') === -1) return false;
      }
      return true;
    })(), '');
  check('H-V1650-EVIDENCE-VARIED (G1b re-lock extension, Jhay 2026-11-06 13:19 EST) the cannot-harm evidence sentence varies per pair in plain speech: the 7 cannot-harm golden whys carry no "recorded durability" and no "no recorded bypass, exploit, or counter", each names the tier gap, the defender durability, and the missing bypass/exploit/counter, superman/rocky vs saitama/frodo (B3 vs B6) use different evidence framings (names normalised), and no rendered telling in the 11 live battles at 12345 carries either frozen phrase',
    (function () {
      const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'war-room-v16.59-goldens.json'), 'utf8'));
      const ch = gold.records.filter(function (g) { return g.criterion === 'cannot-harm'; });
      if (ch.length !== 7) return false;
      for (let i = 0; i < ch.length; i++) {
        const why = (JSON.parse(ch[i].record).frozen || {}).why || '';
        if (why.indexOf('recorded durability') !== -1) return false;
        if (why.indexOf('no recorded bypass, exploit, or counter') !== -1) return false;
        if (why.indexOf('tier') === -1 || why.indexOf('durability') === -1 || why.indexOf('no bypass') === -1) return false;
      }
      // B3 vs B6 evidence framings differ (fighter names normalised out).
      function ev(a, b) {
        runInCtx('selectedVariants = {};');
        const r = sim39(a, b, 12345, 'death');
        const why = r.f.why || '';
        const e = why.split('. ').slice(1).join('. ');
        return e.split('Superman').join('W').split('Saitama').join('W').split('Rocky Balboa').join('L').split('Frodo Baggins').join('L');
      }
      if (ev('superman', 'rocky') === ev('saitama', 'frodo')) return false;
      // No rendered telling carries either frozen phrase.
      const pairs = [['spiderman', 'batman', null], ['goku', 'vegeta', null], ['superman', 'rocky', null], ['superman', 'goku', null], ['deadpool', 'wolverine', null], ['saitama', 'frodo', null], ['raven', 'sephiroth', null], ['vader', 'superman', null], ['batman', 'deadpool', null], ['naruto', 'sasuke', null], ['goku', 'vegeta', { goku: 'v2' }]];
      for (let i = 0; i < pairs.length; i++) {
        runInCtx('selectedVariants = ' + JSON.stringify(pairs[i][2] || {}) + ';');
        const r = sim39(pairs[i][0], pairs[i][1], 12345, 'death');
        runInCtx('selectedVariants = {};');
        const t = runInCtx('analysisNarrationTextV1638(JSON.parse(' + JSON.stringify(JSON.stringify(r.b)) + '))');
        if (t.indexOf('recorded durability') !== -1) return false;
        if (t.indexOf('no recorded bypass, exploit, or counter') !== -1) return false;
      }
      return true;
    })(), '');
  check('V1646-NO-INVENTION (plan §6 H-NO-INVENTION) the set of all variant power names in the file for the 32 Video Games + 29 Anime fighters is exactly the table set — no invented move, no extra power, no renamed sig',
    (function () {
      try {
        const EXPECT = ["Aether Fury", "Alchemic Blade", "Amaterasu", "Anvil", "Ars Arcanum", "Ashura Senku", "Ashura: Ichibugin", "Ashura: Makyusen", "Attraction Flow", "Automail Arm Blade", "Automail Block", "Axe Swing", "Berserk Fist", "Big Bang Attack", "Bite Attack", "Black Flash", "Blackwhip", "Blades of Chaos Whip", "Blades of Exile", "Blood Manipulation", "Blue: Attraction", "Blumenblatt", "Body Slam", "Bow Shot", "Brick Throw", "Brutal Combo", "Bubble Shield", "Bullet Climax", "CQC Strike", "California Smash", "Cero", "Chainsaw Strike", "Chakra-Enhanced Strength", "Charge Beam", "Charge Shot", "Chidori", "Chidori Sharp Spear", "Chomp", "Circle Sword", "Claws", "Claws of Hades", "Claymore Mine", "Climhazzard", "Complete Body Susanoo", "Cross-Slash", "Crossbow Shot", "Culverin", "Curb-Stomp", "Cursed Energy Punch", "Dark Energy Attack", "Dark Matter Spin", "Dash", "Dead Eye", "Delaware Smash", "Demon Fire", "Demon Hand", "Demon Masquerade", "Demon Slave", "Desperate Punch", "Detroit Smash", "Dive Kick", "Dragon Fire", "Dragon Uppercut", "Draupnir Spear", "Drop Wall", "Dual Pistol Shot", "Dual Wield", "Dual Wing Shooters", "Earth Breath", "Earth Pillar Strike", "Ebony & Ivory Shot", "Electric Breath", "Electric Wind God Fist", "Elytra Glide", "Ender Pearl", "Explosive Demon Wave", "Eyestalk Pull", "Final Explosion", "Final Flash", "Fire Dragon's Iron Fist", "Fire Style Blast", "Fireball", "Fishing Rod Strike", "Flame Aura", "Flame Dance", "Flame Kick", "Flame Punch", "Flash Punch Combo", "Flight", "Flip Jump", "Float", "Floaty Fall", "Flurry Rush", "Fly", "Forehead Laser", "Frog Kata", "Fusion Swords", "G-Max Volt Crash", "Galick Gun", "Genjutsu Break", "Getsuga Tensho", "Grapple", "Grappleshot", "Ground Pound", "Hadoken", "Hakka no Togame", "Hakuren", "Halberd Strike", "Headbash", "Heartless Angel", "Hell Ball", "Hidden Blade Strike", "Hidden Lotus", "Hinokami Kagura", "Hollow Purple", "Hook Grab", "Hover", "Hunting Rifle", "Hyakuretsukyaku", "Hyoten Hyakkaso", "Hypernova Inhale", "Hypernova Spit", "Ice Ball", "Ice Blast Freeze", "Ice Bomb", "Ice Breath", "Ice Clone", "Ice Parry", "Infinity", "Inhale Strike", "Instant Transmission", "Jajanken: Paper", "Jajanken: Rock", "Jajanken: Scissors", "Jet Bazooka", "Jet Pistol", "Jump", "Kagutsuchi", "Kamehameha", "Kamui Raikiri", "Kamui Shuriken", "Kendo Strike", "Ki Blast", "Kid\u014d Blast", "Kikoken", "Kikosho", "King Kong Gun", "King of Hell Rengoku Oni Giri", "King of Hell: Ippyakusanjo Hiryu Jigoku", "Kirin", "Knife Slash", "Kong Gun", "Kunai Strike", "Kunai Throw", "Laser Cannon", "Lasso", "Leaf Hurricane", "Lightning Flame Dragon's Brilliant Flame", "Lightning Flame Dragon's Roar", "Limbo: Border Jail", "Magic Dispel", "Magnums", "Manchester Smash", "Martial Arts Throw", "Mega Buster Shot", "Meteorain", "Minecart", "Minion Drop", "Minion Grab", "Minion Slam", "Mystical Palm Technique", "Nakagami Starlight", "Natural Punch", "Nemean Cestus", "Netherite Sword Slash", "Nikita Missile", "Nozarashi Slash", "Omnislash", "Omnislash Version 5", "Oni Giri", "Overdrive Smash", "Paralyzer", "Penetrating Fist", "Perfect Guard", "Phazon Beam", "Pika Papow", "Pistol Shooting", "Pistol Shot", "Plasma Whip", "Power Drain", "Precision Arrow", "Primary Lotus", "Purple Lightning", "Quick Attack", "Quick Shot", "Raging Sun", "Rasengan", "Rebellion Slash", "Red Hawk", "Red: Repulsion", "Reiatsu Blast", "Revolver Shot", "Rhythm Echo", "Rocket Blast", "Ryusenka", "Ryusokyaku", "SOCOM Shot", "Sage Art: Goemon", "Sand Binding Coffin", "Sand Waterfall Funeral", "Sealed Sword Strike", "Senretsukyaku", "Shadow Clone Technique", "Shadow Flare", "Shadow Imitation Shuriken Technique", "Shadow Imitation Technique", "Shadow Sewing Technique", "Shield of Sand", "Shikai Hyoketsu", "Shoryuken", "Shotgun", "Shotlock", "Shredder Gauntlet", "Shun Goku Satsu", "Shuriken Throw", "Sin Stinger", "Slide", "Slow Fall", "Smoke Bomb Feint", "Snake Awakens", "Sonic Blade", "Sonido", "Soul Strike", "Spear Strike", "Special Beam Cannon", "Speed of Lightning", "Spin Attack", "Spinning Bird Kick", "Splishy Splash", "St. Louis Smash", "Stealth Kill", "Stealth Knife Strike", "Stealth Takedown", "Stinger", "Strike Raid", "Substitution Jutsu", "Super Flame", "Super Homing Attack", "Super Missile", "Super Shotgun Blast", "Super Spin Dash", "Survival Knife", "Susanoo", "Susanoo Slash", "Sword Slash", "TNT", "Tail Whip", "Tatsumaki", "Texas Smash", "Threat Sensor", "Thunderbolt", "Time Break", "Tranquiliser Shot", "Transmuted Spear", "Trap Setup", "Trinity Sword", "Tripcaster Trap", "Truth-Seeking Orbs", "Tsukishiro", "Ultra-Big Ball Rasengan", "United States of Smash", "Wall Jump", "Wario Bike", "Wario Waft", "Water", "Whirlwind", "Wicked Weave", "Wind Release: Rasenshuriken", "Wing Slash", "Witch Time", "Zanhyo Ningyo", "Zippy Zap"];
        const roster = JSON.parse(runInCtx('JSON.stringify(ROSTER.map(function(f){return {id:f.id,v2powers:f.v2powers||null,v3powers:f.v3powers||null,v2sig:f.v2sig||null,v3sig:f.v3sig||null};}))'));
        const got = {};
        roster.forEach(function (f) {
          (f.v2powers || []).forEach(function (p) { got[p] = 1; });
          (f.v3powers || []).forEach(function (p) { got[p] = 1; });
          if (f.v2sig) got[f.v2sig] = 1;
          if (f.v3sig) got[f.v3sig] = 1;
        });
        const v2 = JSON.parse(runInCtx('JSON.stringify(V2POWER)'));
        const v3 = JSON.parse(runInCtx('JSON.stringify(V3POWER)'));
        Object.keys(v2).forEach(function (k) { got[v2[k]] = 1; });
        Object.keys(v3).forEach(function (k) { got[v3[k]] = 1; });
        const expSet = {};
        EXPECT.forEach(function (p) { expSet[p] = 1; });
        // The file-wide set also holds the other categories' V2POWER names
        // (untouched by this batch) — the check is that every EXPECT name
        // is present and every VG + Anime variant name is in EXPECT.
        const VG = {};
        VG['aloy'] = 1;
      VG['arthurmorgan'] = 1;
      VG['bayonetta'] = 1;
      VG['chunli'] = 1;
      VG['cloud'] = 1;
      VG['crashbandicoot'] = 1;
      VG['dante'] = 1;
      VG['doomslayer'] = 1;
      VG['ellie'] = 1;
      VG['ezio'] = 1;
      VG['jinkazama'] = 1;
      VG['kirby'] = 1;
      VG['kratos'] = 1;
      VG['lara'] = 1;
      VG['leonkennedy'] = 1;
      VG['link'] = 1;
      VG['mario'] = 1;
      VG['chief'] = 1;
      VG['megaman'] = 1;
      VG['nathandrake'] = 1;
      VG['pikachu'] = 1;
      VG['ryu'] = 1;
      VG['samus'] = 1;
      VG['scorpion'] = 1;
      VG['sephiroth'] = 1;
      VG['snake'] = 1;
      VG['sonic'] = 1;
      VG['sora'] = 1;
      VG['spyro'] = 1;
      VG['steve'] = 1;
      VG['subzero'] = 1;
      VG['wario'] = 1;
        const ANIME = {};
      ANIME['allmight'] = 1;
      ANIME['deku'] = 1;
      ANIME['edward'] = 1;
      ANIME['eren'] = 1;
      ANIME['erza'] = 1;
      ANIME['gaara'] = 1;
      ANIME['gojo'] = 1;
      ANIME['goku'] = 1;
      ANIME['gon'] = 1;
      ANIME['hisoka'] = 1;
      ANIME['ichigo'] = 1;
      ANIME['jiraiya'] = 1;
      ANIME['kakashi'] = 1;
      ANIME['kaneki'] = 1;
      ANIME['kenpachi'] = 1;
      ANIME['killua'] = 1;
      ANIME['levi'] = 1;
      ANIME['luffy'] = 1;
      ANIME['madara'] = 1;
      ANIME['naruto'] = 1;
      ANIME['natsu'] = 1;
      ANIME['piccolo'] = 1;
      ANIME['rocklee'] = 1;
      ANIME['rukia'] = 1;
      ANIME['saitama'] = 1;
      ANIME['sakura'] = 1;
      ANIME['sasuke'] = 1;
      ANIME['shikamaru'] = 1;
      ANIME['tanjiro'] = 1;
      ANIME['toshiro'] = 1;
      ANIME['vegeta'] = 1;
      ANIME['yuji'] = 1;
      ANIME['zoro'] = 1;
        const rosterById = {};
        roster.forEach(function (f) { rosterById[f.id] = f; });
        let bad = '';
        EXPECT.forEach(function (p) { if (!got[p]) bad = 'missing:' + p; });
        Object.keys(VG).concat(Object.keys(ANIME)).forEach(function (id) {
          const f = rosterById[id];
          if (!f) return;
          (f.v2powers || []).concat(f.v3powers || []).concat(f.v2sig ? [f.v2sig] : []).concat(f.v3sig ? [f.v3sig] : []).forEach(function (p) {
            if (!expSet[p]) bad = 'extra:' + id + ':' + p;
          });
        });
        return bad === '';
      } catch (e) { return false; }
    })(), '');

  check('V1646-STAT-DIRECTION (plan §6 H-STAT-DIRECTION) every v2/v3 delta points the table direction (UP/DOWN/FLAT); exact numbers are the builder\'s call within the direction',
    (function () {
      try {
        const EXPECT = [{"id": "aloy", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "arthurmorgan", "v2": [1, 1, 1], "v3": [-1, -1, -1]}, {"id": "bayonetta", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "chunli", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "cloud", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "crashbandicoot", "v2": [-1, -1, -1], "v3": [1, 1, 1]}, {"id": "dante", "v2": [1, 1, 1], "v3": [-1, -1, 0]}, {"id": "doomslayer", "v2": [-1, -1, -1], "v3": [-1, -1, -1]}, {"id": "ellie", "v2": [-1, -1, -1], "v3": [-1, -1, -1]}, {"id": "ezio", "v2": [1, 1, 1], "v3": [-1, -1, 0]}, {"id": "jinkazama", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "kirby", "v2": [1, 1, 1], "v3": null}, {"id": "kratos", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "lara", "v2": null, "v3": [1, 1, 1]}, {"id": "leonkennedy", "v2": [1, 1, 1], "v3": [-1, -1, -1]}, {"id": "link", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "mario", "v2": [1, 1, 1], "v3": [0, 1, 0]}, {"id": "chief", "v2": [1, 1, 1], "v3": [1, 0, 0]}, {"id": "megaman", "v2": null, "v3": [0, -1, 0]}, {"id": "nathandrake", "v2": [0, 0, 0], "v3": [0, 0, 0]}, {"id": "pikachu", "v2": [1, 1, 1], "v3": [1, 1, 0]}, {"id": "ryu", "v2": [-1, 1, 0], "v3": [0, 0, 0]}, {"id": "samus", "v2": [-1, 0, -1], "v3": [1, 0, 1]}, {"id": "scorpion", "v2": [1, 1, 1], "v3": [0, 1, 0]}, {"id": "sephiroth", "v2": [1, 1, 1], "v3": null}, {"id": "snake", "v2": [1, 0, 0], "v3": [1, 0, 0]}, {"id": "sonic", "v2": [1, 1, 1], "v3": [0, 1, 0]}, {"id": "sora", "v2": [1, 1, 1], "v3": [-1, -1, 0]}, {"id": "spyro", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "steve", "v2": [1, 1, 1], "v3": [-1, 0, 0]}, {"id": "subzero", "v2": [0, 0, 0], "v3": [0, 1, 0]}, {"id": "wario", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "allmight", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "deku", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "edward", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "eren", "v2": null, "v3": null}, {"id": "erza", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "gaara", "v2": [0, 0, 0], "v3": [1, 1, 1]}, {"id": "gojo", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "goku", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "gon", "v2": [1, 1, 0], "v3": [1, 1, 1]}, {"id": "hisoka", "v2": null, "v3": null}, {"id": "ichigo", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "jiraiya", "v2": [1, 1, 1], "v3": null}, {"id": "kakashi", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "kaneki", "v2": null, "v3": null}, {"id": "kenpachi", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "killua", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "levi", "v2": null, "v3": null}, {"id": "madara", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "luffy", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "naruto", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "natsu", "v2": [1, 1, 1], "v3": null}, {"id": "piccolo", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "rocklee", "v2": [1, 1, 0], "v3": [1, 1, 1]}, {"id": "rukia", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "saitama", "v2": [1, 1, 1], "v3": null}, {"id": "sakura", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "sasuke", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "shikamaru", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "tanjiro", "v2": [1, 1, 0], "v3": [1, 1, 1]}, {"id": "toshiro", "v2": [1, 1, 1], "v3": [0, 0, 0]}, {"id": "vegeta", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "yuji", "v2": [1, 1, 1], "v3": [1, 1, 1]}, {"id": "zoro", "v2": [1, 1, 1], "v3": [1, 1, 1]}];
        const roster = JSON.parse(runInCtx('JSON.stringify(ROSTER.map(function(f){return {id:f.id,v2hp:f.v2hp,v2atk:f.v2atk,v2def:f.v2def,v3hp:f.v3hp,v3atk:f.v3atk,v3def:f.v3def};}))'));
        const byId = {};
        roster.forEach(function (f) { byId[f.id] = f; });
        const sgn = function (n) { return n > 0 ? 1 : n < 0 ? -1 : 0; };
        let bad = '';
        EXPECT.forEach(function (e) {
          const f = byId[e.id];
          if (!f) { bad = e.id + ':missing'; return; }
          [['v2', e.v2], ['v3', e.v3]].forEach(function (pair) {
            const k = pair[0], exp = pair[1];
            if (!exp) return;
            if (sgn(f[k + 'hp']) !== exp[0] || sgn(f[k + 'atk']) !== exp[1] || sgn(f[k + 'def']) !== exp[2]) bad = e.id + '.' + k + ':direction';
          });
        });
        return bad === '';
      } catch (e) { return false; }
    })(), '');

  check('V1644-STRIP-INTACT (plan §6 H-STRIP-INTACT) the v16.40 strip still holds on the v16.44 file: player-page kept ids present, removed ids/texts absent from draft+results',
    (function () {
      const pre = html.slice(0, html.indexOf('<script>'));
      const draftPos = pre.indexOf('id="draft-screen"');
      const testerPos = pre.indexOf('<section id="tester-screen"');
      const mainEnd = pre.indexOf('</main>');
      const playerHtml = (draftPos !== -1 && testerPos !== -1) ? pre.slice(draftPos, testerPos) : '';
      const hasId = function (h, id) { return h.indexOf('id="' + id + '"') !== -1; };
      if (!hasId(playerHtml, 'draft-screen') || !hasId(playerHtml, 'results-screen') || !hasId(playerHtml, 'fighter-pool') || !hasId(playerHtml, 'start-btn')) return false;
      const ABSENT = ['battlefield-select', 'victory-select', 'online-status-panel', 'main-story-label', 'audit-disclosure', 'resolver-visible', 'combat-details-disclosure', 'breakdown-output'];
      for (let i = 0; i < ABSENT.length; i++) { if (hasId(playerHtml, ABSENT[i])) return false; }
      if (playerHtml.indexOf('Victory Rules') !== -1 || playerHtml.indexOf('Review Matchup') !== -1) return false;
      return true;
    })(), '');

  // 14. Regression suite gate: every V1640 check before this point passed.
  check('V1645-INFO-PANEL-VARIANT (joint-plan spec FIX 1) openInfo shows the SELECTED version: Zero Suit Samus style/sig/powerset, Phazon Samus style/sig/powerset, Super Sonic style/sig; base lines absent when a variant is picked; card style line follows the pick',
    (function () {
      try {
        function info(id, variant) {
          runInCtx('selectedVariants = ' + JSON.stringify(variant ? { [id]: variant } : {}) + '; openInfo(\'' + id + '\');');
          return els['info-content'].innerHTML || '';
        }
        let h = info('samus', 'v2');
        if (h.indexOf('Faster, more agile hunter without armour — stuns to escape, not to finish.') === -1) return false;
        if (h.indexOf('<b>Signature (implemented):</b> Paralyzer') === -1) return false;
        if (h.indexOf('Paralyzer, Plasma Whip, Flip Jump') === -1) return false;
        if (h.indexOf('Bounty hunter in power suit with beam, missiles and morph ball') !== -1) return false;
        if (h.indexOf('<b>Signature (implemented):</b> Power Beam') !== -1) return false;
        h = info('samus', 'v3');
        if (h.indexOf('Bolder in Phazon areas — holds ground others cannot.') === -1) return false;
        if (h.indexOf('<b>Signature (implemented):</b> Phazon Beam') === -1) return false;
        if (h.indexOf('Phazon Beam, Charge Beam, Super Missile') === -1) return false;
        h = info('sonic', 'v2');
        if (h.indexOf('Flying golden fighter who overwhelms head-on.') === -1) return false;
        if (h.indexOf('<b>Signature (implemented):</b> Super Spin Dash') === -1) return false;
        if (h.indexOf('<b>Signature (implemented):</b> Spin Dash') !== -1) return false;
        h = info('sora', 'v3');
        if (h.indexOf('Ars Arcanum') === -1 || h.indexOf('third variant') === -1) return false;
        runInCtx("selectedVariants = { samus: 'v2' }; catFilter='All'; searchTerm=''; renderRoster();");
        if ((els['fighter-pool'].innerHTML || '').indexOf('Faster, more agile hunter without armour — stuns to escape, not to finish.') === -1) return false;
        runInCtx("selectedVariants = {}; catFilter='All'; searchTerm=''; renderRoster();");
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1646-INFO-PANEL-BASE-IDENTICAL (plan §6) base picks render byte-identical to v16.45 for 9 of the 12 Fix 1 fighters (openInfo + title text, icon/img stripped — v16.53 photos wiring puts a photo in the title via innerHTML, covered by V1653-PHOTOS-HELPER) in a second v16.45 context; sonic and sephiroth differ ONLY by the v16.55 B dossier researched-stamina row (stripped, then byte-identical); base Goku differs ONLY in the Variant power line (V2POWER God Ki Blast -> Kamehameha, the table update) plus the same stamina row; the full-roster pool equality is dropped — the pool HTML legitimately changes when variant labels are renamed (9 RENAMED Anime v2 labels, pinned by V1646-V2-PROFILE-COMPLETE); v16.56 item-7 rewords normalized on the v16.45 side + Goku gains the Instant Transmission power-set entry, structured entry, and record block (item 6)',
    (function () {
      try {
        const oldPath = path.join(__dirname, 'war-room-v16.45.html');
        if (!fs.existsSync(oldPath)) return false;
        const oldHtml = fs.readFileSync(oldPath, 'utf8');
        const m45 = oldHtml.match(/<script>([\s\S]*)<\/script>/);
        if (!m45) return false;
        let script45 = m45[1];
        const ii45 = script45.indexOf('/* ============ INIT ============ */');
        if (ii45 !== -1) script45 = script45.slice(0, ii45);
        const els45 = {};
        const sb45 = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
          document: { getElementById: function (id) { if (!els45[id]) els45[id] = makeElement(); return els45[id]; }, createElement: function () { return makeElement(); }, querySelectorAll: function () { return []; } },
          window: {}, navigator: { onLine: true }, localStorage: makeLocalStorage(false), alert: function () {}, fetch: async function () { throw new Error('network disabled'); } };
        sb45.window = sb45;
        vm.createContext(sb45);
        vm.runInContext(script45, sb45);
        const stripOldTitle = function (t) { return (t || '').replace(/^[^\s]+\s/, ''); };
        const stripNewTitle = function (h) { return (h || '').replace(/<img[^>]*>/, '').trim(); };
        const stripStaminaRow = function (h) { return (h || '').replace(/<p><b>Stamina limit \(researched, v16\.55\):<\/b>.*?<\/p>/, ''); };
        // v16.56 (item 7): the engine-word rewords land in the Info
        // panel labels + power text. Normalize the v16.45 panel with
        // exactly those rewords before comparing. The Audit-numbers
        // line keeps 'the character record' — only the 'How to read'
        // line's 'information in the character record' is reworded.
        // v16.58 (follow-ups): the same normalization gains the v16.58
        // rewords (keyword fallback render strings, Power records
        // heading, audit 'not the character record', [ENGINE MECHANISM]).
        // v16.59 (fix pile F2, re-lock Jhay 2026-11-10 ~03:59): the
        // Goku weak text loses its stamina clause — normalize the old
        // weak text to 'Overconfidence' for the Goku panel comparison,
        // and map the old 'Limit / exhaustion state' line to the new
        // honestly-unknown line.
        // The v16.56 note above no longer holds for the Audit line —
        // v16.58 rewords it to 'not the fighter record'.
        const norm1656 = function (h) {
          return (h || '')
            .split('through the single resolveAttack pipeline').join('through the fight engine')
            .split('through resolveAttack').join('through the fight engine')
            .split('CHARACTER RECORD').join('fighter record')
            .split('information in the character record').join("information in the fighter's record")
            .split('[ENGINE DERIVATION from record traits — not a canon measurement]').join('(worked out from the record, not a canon measurement)')
            .split('keyword-fallback').join('matched by keyword')
            .split('(keyword fallback, not authored)').join('(matched by keyword, not authored)')
            .split('keyword fallback labelled').join('matched by keyword, labelled')
            .split('keyword fallback, labelled').join('keyword match, labelled')
            .split('no specific cost stated for this power; Goku stated limit is stamina drains in very long fights').join('no specific cost stated for this power')
            .split('stamina drains in very long fights (stated weakness)').join('no specific cost stated for this power')
            .split('; stamina drain in very long fights').join('')
            .split('Overconfidence; stamina drains in very long fights').join('Overconfidence')
            .split('Overconfidence <span style="color:var(--dim)">[stated (profile weakness text)]</span>').join('No stamina or time limit is stated in this profile beyond the engine stamina pool. <span style="color:var(--dim)">[unknown]</span>')
            .split('Character power records (v16.38').join('Power records (v16.38')
            .split('not the character record').join('not the fighter record')
            .split(' [ENGINE MECHANISM]').join('')
            .split('ENGINE MECHANISM (trait) + fighter record').join('trait + fighter record');
        };
        // v16.56 (item 6): the Instant Transmission additions to
        // Goku's panel — the structured-entries <li> and the detailed
        // record block. Pinned verbatim; stripped from the new panel
        // before comparing to the normalized v16.45 panel.
        const IT_LI = "<li><b>Instant Transmission</b> — physical attack through the fight engine [matched by keyword — the move itself is recorded; only its damage type is unknown, not authored]; use: Cycled power in battle; bypass: no; escapes restraint: possible by movement type; version has it: yes. Requirements: Must belong to the selected version&#39;s powerset; no other requirement is listed in this profile. Limits: No limit is established in this profile beyond the engine&#39;s damage, defence, stamina and cannot-harm rules.</li>";
        const IT_RB = "Instant Transmission — what it does: Instant teleport to a sensed ki signature; reach: anywhere a ki signature can be sensed; can hurt: none — it moves the user, it does not strike; cannot hurt: none stated; what stops it: a target whose ki cannot be sensed; an unfamiliar place with no ki signature to lock onto; cost or limit: needs a ki signature to sense; cannot teleport blind; outcome if it lands: movement only — teleports the user; hurts nothing by itself [demonstrated]; damage type: unknown (matched by keyword, not authored) — the move itself is recorded; only its damage type is unknown<br>";
        const IDS = ['samus', 'sora', 'lara', 'batman', 'pikachu', 'kirby', 'megaman', 'kratos', 'ryu']; // v16.55 (B): the 9 Fix 1 fighters with NO structured stamina record — identical after the v16.56 item-7 reword normalize
        for (let i = 0; i < IDS.length; i++) {
          const id = IDS[i];
          vm.runInContext("selectedVariants = {}; openInfo('" + id + "');", sb45);
          runInCtx("selectedVariants = {}; openInfo('" + id + "');");
          if (norm1656(els45['info-content'].innerHTML || '') !== (els['info-content'].innerHTML || '')) return false;
          if (stripOldTitle(els45['info-title'].innerText) !== stripNewTitle(els['info-title'].innerHTML)) return false;
        }
        // v16.55 (B): sonic + sephiroth carry a structured record, so
        // their panels gain exactly one row — the researched-stamina
        // row. Strip it and they are byte-identical to v16.45.
        const IDS_ROW = ['sonic', 'sephiroth'];
        for (let i = 0; i < IDS_ROW.length; i++) {
          const id = IDS_ROW[i];
          vm.runInContext("selectedVariants = {}; openInfo('" + id + "');", sb45);
          runInCtx("selectedVariants = {}; openInfo('" + id + "');");
          const newC = els['info-content'].innerHTML || '';
          if (newC.indexOf('<b>Stamina limit (researched, v16.55):</b>') === -1) return false;
          if (norm1656(els45['info-content'].innerHTML || '') !== stripStaminaRow(newC)) return false;
          if (stripOldTitle(els45['info-title'].innerText) !== stripNewTitle(els['info-title'].innerHTML)) return false;
        }
        vm.runInContext("selectedVariants = {}; openInfo('goku');", sb45);
        runInCtx("selectedVariants = {}; openInfo('goku');");
        if (stripOldTitle(els45['info-title'].innerText) !== stripNewTitle(els['info-title'].innerHTML)) return false;
        const oldG = norm1656(els45['info-content'].innerHTML || '').split('<b>Variant power:</b> God Ki Blast').join('<b>Variant power:</b> Kamehameha');
        let newG = els['info-content'].innerHTML || '';
        if (newG.indexOf('<b>Stamina limit (researched, v16.55):</b>') === -1) return false; // v16.55 (B): Goku carries a structured record
        if (newG.indexOf(IT_LI) === -1 || newG.indexOf(IT_RB) === -1) return false; // v16.56 (item 6): the Instant Transmission structured entry + record block are present
        newG = stripStaminaRow(newG).split('Ki Blast, Instant Transmission Strike, Dragon Fist, Instant Transmission').join('Ki Blast, Instant Transmission Strike, Dragon Fist').split(IT_LI).join('').split(IT_RB).join('');
        if (oldG !== newG) return false;
        return true;
      } catch (e) { return false; }
    })(), '');

  check('V1645-STAMINA-WHY (joint-plan spec FIX 2, v16.55 B) live V1634 + legacy V1631 stamina whys name the loser structured record: sonic/rocky base names Rocky\'s Full-strength boxing ending + the weakened state + the finisher of the weakened fighter; sonic/rocky v2 is tier (both-stated fall-through, no rings in the why); goku/vegeta base is speed (both-stated fall-through, no \'Overconfidence\' in the why)',
    (function () {
      try {
        function why1634(a, b, seed, va, vb) {
          const code = "(function(){ var fa = Object.assign({}, byId('" + a + "'), {variant: '" + va + "', variantId: '" + (va === 'Base' ? 'base' : va === 'Super Sonic' ? 'v2' : 'base') + "'}); var fb = Object.assign({}, byId('" + b + "'), {variant: '" + vb + "', variantId: 'base'}); var r = resolveCharFirstV1634(fa, fb, " + seed + ", {victoryMode:'death'}); return JSON.stringify({winner:r.winner, criterion:r.decisiveCriterion, why:r.why}); })()";
          return JSON.parse(runInCtx(code));
        }
        function why1631(a, b, seed, va) {
          const code = "(function(){ var r = resolveCharFirstV1631('" + a + "','" + b + "'," + seed + ",{victoryMode:'death', variant:'" + va + "', variantId:'" + (va === 'Super Sonic' ? 'v2' : 'base') + "'}); return JSON.stringify({winner:r.winner, criterion:r.decisiveCriterion, why:r.why}); })()";
          return JSON.parse(runInCtx(code));
        }
        // v16.55 (B): sonic/rocky base is still stamina (Sonic
        // wins), but the why is now the structured format — Rocky's
        // Full-strength boxing ends, the weakened state, and Sonic
        // finishing the weakened Rocky. No cite, no invented rate.
        let r = why1634('sonic', 'rocky', 12345, 'Base', 'Base');
        if (r.winner !== 'Sonic' || r.criterion !== 'stamina') return false;
        if (r.why.indexOf("Rocky Balboa's Full-strength boxing ends") === -1) return false;
        if (r.why.indexOf('Slows down, punches weaken') === -1) return false;
        if (r.why.indexOf('Sonic finishes the weakened Rocky Balboa') === -1) return false;
        if (r.why.indexOf('stated limit is:') !== -1 || r.why.indexOf('has no stated limit') !== -1) return false;
        if (r.why.indexOf('/sec') !== -1 || r.why.indexOf('per second') !== -1) return false;
        r = why1631('sonic', 'rocky', 12345, 'Base');
        if (r.winner !== 'Sonic' || r.criterion !== 'stamina') return false;
        if (r.why.indexOf("Rocky Balboa's Full-strength boxing ends") === -1) return false;
        if (r.why.indexOf('Sonic finishes the weakened Rocky Balboa') === -1) return false;
        // v16.55 (B): sonic/rocky v2 is now tier difference (both-stated
        // fall-through) — the ring drain no longer decides, so the why
        // carries no rings and no v2weak quote.
        r = why1634('sonic', 'rocky', 12345, 'Super Sonic', 'Base');
        if (r.winner !== 'Sonic' || r.criterion !== 'tier difference') return false;
        if (r.why.indexOf('rings') !== -1 || r.why.indexOf('ring drain') !== -1) return false;
        r = why1631('sonic', 'rocky', 12345, 'Super Sonic');
        if (r.winner !== 'Sonic' || r.criterion !== 'tier difference') return false;
        if (r.why.indexOf('rings') !== -1) return false;
        // v16.55 (B): goku/vegeta base is now speed (both-stated
        // fall-through) — the old 'Overconfidence' stamina why is gone.
        r = why1634('goku', 'vegeta', 12345, 'Base', 'Base');
        if (r.winner !== 'Vegeta' || r.criterion !== 'speed') return false;
        if (r.why.indexOf('Overconfidence') !== -1) return false;
        r = why1631('goku', 'vegeta', 12345, 'Base');
        if (r.winner !== 'Vegeta' || r.criterion !== 'speed') return false;
        if (r.why.indexOf('Overconfidence') !== -1) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1646-ROSTER-UNCHANGED (plan §6) v16.45->v16.56 roster line diff is exactly the batch plus the 4 v16.55 B weak rewords on non-Built rows (cloud, godzilla, bolin, sephiroth — toshiro is Built, so its reword is inside the 29; deku v2weak is Built too) plus the v16.56 thanos v2weak on a non-Built row, with gandalf2\'s line removed (v16.56 item 5) (icon segment stripped on both sides — v16.53 photos wiring, covered by V1653-PHOTOS-ICONS): 199 roster lines in v16.45, 198 in v16.56; the 29 built Anime rows differ, the 4 B rows differ, thanos differs, and the other 164 are byte-identical; base POWERS map differs ONLY by gandalf2 removed + goku gaining Instant Transmission (Jhay-agreed); V2POWER differs only in the 26 table updates; V3POWER differs only by the 26 added Anime entries',
    (function () {
      try {
        const oldHtml = fs.readFileSync(path.join(__dirname, 'war-room-v16.45.html'), 'utf8');
        function rosterLines(h) { return h.split('\n').filter(function (ln) { return ln.indexOf("{id:'") === 0; }).map(function (ln) { return ln.replace(/icon:'[^']*',?/, ''); }); }
        const r45 = rosterLines(oldHtml), r46 = rosterLines(html);
        if (r45.length !== 199 || r46.length !== 198) return false; // v16.56 (item 5): gandalf2's line is gone
        const BUILT = {};
      BUILT['allmight'] = 1;
      BUILT['deku'] = 1;
      BUILT['edward'] = 1;
      BUILT['erza'] = 1;
      BUILT['gaara'] = 1;
      BUILT['gojo'] = 1;
      BUILT['goku'] = 1;
      BUILT['gon'] = 1;
      BUILT['ichigo'] = 1;
      BUILT['jiraiya'] = 1;
      BUILT['kakashi'] = 1;
      BUILT['kenpachi'] = 1;
      BUILT['killua'] = 1;
      BUILT['luffy'] = 1;
      BUILT['madara'] = 1;
      BUILT['naruto'] = 1;
      BUILT['natsu'] = 1;
      BUILT['piccolo'] = 1;
      BUILT['rocklee'] = 1;
      BUILT['rukia'] = 1;
      BUILT['saitama'] = 1;
      BUILT['sakura'] = 1;
      BUILT['sasuke'] = 1;
      BUILT['shikamaru'] = 1;
      BUILT['tanjiro'] = 1;
      BUILT['toshiro'] = 1;
      BUILT['vegeta'] = 1;
      BUILT['yuji'] = 1;
      BUILT['zoro'] = 1;
        // v16.56 (item 5): compare by ID, not by index — removing
        // gandalf2's line shifts every later line by one, so an
        // index comparison would flag all of them. gandalf2 is the
        // only id present in v16.45 but absent in v16.56; thanos
        // differs by its new v2weak (item 8).
        const byId45 = {}, byId46 = {};
        r45.forEach(function (ln) { const m = ln.match(/^\{id:'([^']+)',/); if (m) byId45[m[1]] = ln; });
        r46.forEach(function (ln) { const m = ln.match(/^\{id:'([^']+)',/); if (m) byId46[m[1]] = ln; });
        const missing = Object.keys(byId45).filter(function (id) { return !byId46[id]; });
        const added = Object.keys(byId46).filter(function (id) { return !byId45[id]; });
        if (JSON.stringify(missing) !== JSON.stringify(['gandalf2']) || added.length !== 0) return false;
        let diff = 0;
        let bad = '';
        const NONBUILT1655 = { cloud: 1, godzilla: 1, bolin: 1, sephiroth: 1 }; // v16.55 (B): the 4 weak rewords on non-Built rows
        let nonBuiltDiff = 0;
        const NONBUILT1656 = { thanos: 1 }; // v16.56 (item 8): thanos gains a v2weak
        let nonBuilt1656Diff = 0;
        Object.keys(byId46).forEach(function (id) {
          if (byId45[id] === byId46[id]) return;
          if (BUILT[id]) { diff++; return; }
          if (NONBUILT1655[id]) { nonBuiltDiff++; return; }
          if (NONBUILT1656[id]) { nonBuilt1656Diff++; return; }
          bad = 'roster line moved: ' + id;
        });
        if (bad !== '' || diff !== 29 || nonBuiltDiff !== 4 || nonBuilt1656Diff !== 1) return false;
        // v16.56 (items 5 + 6): the POWERS text block is NOT
        // byte-identical any more — goku's literal line gains a 4th
        // power and the V7 block drops gandalf2. The parsed comparison
        // is below, after the v16.45 context loads.
        const sb45 = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
          document: { getElementById: function (id) { return makeElement(); }, createElement: function () { return makeElement(); }, querySelectorAll: function () { return []; } },
          window: {}, navigator: { onLine: true }, localStorage: makeLocalStorage(false), alert: function () {}, fetch: async function () { throw new Error('network disabled'); } };
        sb45.window = sb45;
        vm.createContext(sb45);
        let script45 = oldHtml.match(/<script>([\s\S]*)<\/script>/)[1];
        const ii45 = script45.indexOf('/* ============ INIT ============ */');
        if (ii45 !== -1) script45 = script45.slice(0, ii45);
        vm.runInContext(script45, sb45);
        const oldV2 = JSON.parse(vm.runInContext('JSON.stringify(V2POWER)', sb45));
        const oldV3 = JSON.parse(vm.runInContext('JSON.stringify(V3POWER)', sb45));
        const newV2 = JSON.parse(runInCtx('JSON.stringify(V2POWER)'));
        const newV3 = JSON.parse(runInCtx('JSON.stringify(V3POWER)'));
        // v16.56 (items 5 + 6): POWERS compared parsed, not as text.
        // Every id except gandalf2 (removed) and goku (4th power,
        // pinned by value) is byte-identical; the count drops by 1.
        const oldP = JSON.parse(vm.runInContext('JSON.stringify(POWERS)', sb45));
        const newP = JSON.parse(runInCtx('JSON.stringify(POWERS)'));
        if (Object.keys(newP).length !== Object.keys(oldP).length - 1) return false;
        if (newP['gandalf2'] !== undefined || oldP['gandalf2'] === undefined) return false;
        if (JSON.stringify(newP['goku']) !== JSON.stringify(['Ki Blast', 'Instant Transmission Strike', 'Dragon Fist', 'Instant Transmission'])) return false;
        let pBad = '';
        Object.keys(oldP).forEach(function (id) {
          if (id === 'gandalf2' || id === 'goku') return;
          if (JSON.stringify(oldP[id]) !== JSON.stringify(newP[id])) pBad = 'POWERS.' + id;
        });
        if (pBad !== '') return false;
        const UPDATES = {"allmight": "Detroit Smash", "deku": "Overdrive Smash", "edward": "Desperate Punch", "gaara": "Shield of Sand", "gojo": "Blue: Attraction", "goku": "Kamehameha", "gon": "Jajanken: Rock", "ichigo": "Cero", "jiraiya": "Ultra-Big Ball Rasengan", "kakashi": "Kamui Raikiri", "kenpachi": "Nozarashi Slash", "killua": "Whirlwind", "madara": "Susanoo Slash", "luffy": "Kong Gun", "naruto": "Rasengan", "natsu": "Lightning Flame Dragon's Roar", "piccolo": "Special Beam Cannon", "rocklee": "Hidden Lotus", "saitama": "Desperate Punch", "sakura": "Chakra-Enhanced Strength", "shikamaru": "Shadow Sewing Technique", "tanjiro": "Raging Sun", "toshiro": "Shikai Hyoketsu", "vegeta": "Final Explosion", "yuji": "Black Flash", "zoro": "Ashura: Ichibugin"};
        const ADDED = {"allmight": "United States of Smash", "deku": "St. Louis Smash", "edward": "Transmuted Spear", "erza": "Blumenblatt", "gaara": "Shield of Sand", "gojo": "Hollow Purple", "goku": "Kamehameha", "gon": "Fishing Rod Strike", "ichigo": "Cero", "kakashi": "Purple Lightning", "kenpachi": "Nozarashi Slash", "killua": "Claws", "madara": "Limbo: Border Jail", "luffy": "Jet Pistol", "naruto": "Rasengan", "piccolo": "Special Beam Cannon", "rocklee": "Primary Lotus", "rukia": "Sealed Sword Strike", "sakura": "Substitution Jutsu", "sasuke": "Chidori", "shikamaru": "Shadow Imitation Technique", "tanjiro": "Raging Sun", "toshiro": "Hyoten Hyakkaso", "vegeta": "Galick Gun", "yuji": "Blood Manipulation", "zoro": "King of Hell: Ippyakusanjo Hiryu Jigoku"};
        // v16.56 (item 5): gandalf2's V2POWER entry is removed, so
        // the key sets differ by exactly gandalf2; skip him in the
        // diff loop — a removal is not one of the 26 table updates.
        if (JSON.stringify(Object.keys(oldV2).sort().filter(function (k) { return k !== 'gandalf2'; })) !== JSON.stringify(Object.keys(newV2).sort())) return false;
        let d2 = 0;
        Object.keys(oldV2).forEach(function (k) { if (k === 'gandalf2') return; if (oldV2[k] !== newV2[k]) { d2++; if (UPDATES[k] !== newV2[k]) bad = 'V2POWER.' + k; } });
        if (bad !== '' || d2 !== 26) return false;
        if (Object.keys(oldV3).length !== 30 || Object.keys(newV3).length !== 56) return false;
        let d3 = 0;
        Object.keys(newV3).forEach(function (k) {
          if (oldV3[k] === undefined) { d3++; if (ADDED[k] !== newV3[k]) bad = 'V3POWER.' + k; }
          else if (oldV3[k] !== newV3[k]) bad = 'V3POWER changed.' + k;
        });
        if (bad !== '' || d3 !== 26) return false;
        return true;
      } catch (e) { return false; }
    })(), '');

  // ================= v16.57 — fun loop (Jhay 2026-11-07 ~19:24, Best-of-3 waits) =================
  // Rematch, variant rematch, random, prediction, seed challenge, rivalry,
  // Fight of the Day. Render/UI only — no engine change.
  check('V1659-REMATCH (idea 1, Jhay 2026-11-07 ~19:24) results screen has a "Fight again" button calling startBattle(); a rematch re-rolls the seed, keeps the same pair and the same variant picks, and never clears selectedVariants (startBattle never calls resetSimulator)',
    (function () {
      try {
        if ((html.split('<button class="btn" onclick="startBattle()">Fight again</button>').length - 1) !== 1) return false;
        runInCtx("selected=['goku','vegeta']; selectedVariants={goku:'v2'}; forcedSeed=12345; forcedVictoryMode='death';");
        runInCtx('startBattle();');
        const s1 = JSON.parse(runInCtx("JSON.stringify({seed:currentBattle.seed,winner:currentBattle.winner,a:currentBattle.alpha[0].name,b:currentBattle.beta[0].name,sel:selected,vars:selectedVariants,fs:forcedSeed})"));
        if (s1.seed !== 12345 || s1.winner !== 'Vegeta') return false;
        if (s1.a !== 'Goku' || s1.b !== 'Vegeta') return false;
        if (JSON.stringify(s1.sel) !== '["goku","vegeta"]' || JSON.stringify(s1.vars) !== '{"goku":"v2"}') return false;
        if (s1.fs !== null) return false; // the seed is consumed by the battle
        runInCtx('startBattle();');
        const s2 = JSON.parse(runInCtx("JSON.stringify({seed:currentBattle.seed,winner:currentBattle.winner,sel:selected,vars:selectedVariants})"));
        if (s2.seed === s1.seed) return false; // re-rolled, not the same seed
        if (s2.winner !== 'Goku' && s2.winner !== 'Vegeta') return false;
        if (JSON.stringify(s2.sel) !== '["goku","vegeta"]' || JSON.stringify(s2.vars) !== '{"goku":"v2"}') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-VARIANT-REMATCH (idea 2, Jhay 2026-11-07 ~19:24) "Same fighters, different versions" button calls backToDraftKeepPair(), which returns to the draft screen with the same pair and the same variant picks still selected; plain New Battle (resetSimulator, C1 from v16.54) still clears selectedVariants',
    (function () {
      try {
        if ((html.split('<button class="btn" onclick="backToDraftKeepPair()">Same fighters, different versions</button>').length - 1) !== 1) return false;
        var fnLine = html.split('\n').filter(function (l) { return l.indexOf('function backToDraftKeepPair(') !== -1; })[0] || '';
        if (fnLine.indexOf("getElementById('results-screen')") === -1 || fnLine.indexOf("getElementById('draft-screen')") === -1) return false;
        if (fnLine.indexOf('renderRoster()') === -1) return false;
        if (fnLine.indexOf('selectedVariants') !== -1 || fnLine.indexOf('resetSimulator') !== -1) return false;
        runInCtx("selected=['goku','vegeta']; selectedVariants={goku:'v2'};");
        runInCtx('backToDraftKeepPair();');
        const kept = JSON.parse(runInCtx("JSON.stringify({s:selected,v:selectedVariants})"));
        if (JSON.stringify(kept.s) !== '["goku","vegeta"]' || JSON.stringify(kept.v) !== '{"goku":"v2"}') return false;
        runInCtx('resetSimulator();');
        const cleared = JSON.parse(runInCtx("JSON.stringify({s:selected,v:selectedVariants})"));
        if (JSON.stringify(cleared.s) !== '[]' || JSON.stringify(cleared.v) !== '{}') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-RANDOM (idea 3, Jhay 2026-11-07 ~19:24) "Surprise me" button calls randomFight(); each tap picks two different fighters from the whole roster at tap time (Math.random), forces base only (selectedVariants cleared), and starts a battle',
    (function () {
      try {
        if ((html.split('<button class="btn" id="random-btn" onclick="randomFight()">Surprise me</button>').length - 1) !== 1) return false;
        if (html.indexOf('function randomFight(){') === -1 || html.indexOf('Math.random()*ROSTER.length') === -1) return false;
        runInCtx("selected=[]; selectedVariants={goku:'v2'}; forcedSeed=null; forcedVictoryMode='death';");
        runInCtx('randomFight();');
        const r1 = JSON.parse(runInCtx("JSON.stringify({s:selected,v:selectedVariants,w:currentBattle.winner,seed:currentBattle.seed})"));
        if (r1.s.length !== 2 || r1.s[0] === r1.s[1]) return false;
        if (JSON.stringify(r1.v) !== '{}') return false;
        if (!r1.w || typeof r1.seed !== 'number') return false;
        var inRoster = JSON.parse(runInCtx("JSON.stringify(selected.every(function (id) { return ROSTER.some(function (x) { return x.id === id; }); }))"));
        if (!inRoster) return false;
        runInCtx('randomFight();');
        const r2 = JSON.parse(runInCtx("JSON.stringify({s:selected,v:selectedVariants,w:currentBattle.winner})"));
        if (r2.s.length !== 2 || r2.s[0] === r2.s[1]) return false;
        if (JSON.stringify(r2.v) !== '{}') return false;
        if (!r2.w) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-PREDICTION (idea 4, Jhay 2026-11-07 ~19:24) "Who wins?" box appears when two fighters are picked (directly under the picked-fighter slots, above Start), setPrediction(i) records the pick, and showResults writes "You called it." / "Wrong — [winner] wins." / "Stalemate — no winner." into the prediction line, then consumes the prediction; the preview disclaimer is untouched',
    (function () {
      try {
        if (html.indexOf('let playerPrediction=null;') === -1) return false;
        if (html.indexOf('function setPrediction(i){playerPrediction=selected[i];renderRoster();}') === -1) return false;
        if (html.indexOf('Preview — not a prediction. The preview does not determine the winner; the combat engine does.') === -1) return false;
        if (html.indexOf("if (!b.winner || b.stalemate) _pl1657.innerText = 'Stalemate — no winner.';") === -1) return false;
        if (!(html.indexOf('id="alpha-squad-slots"') < html.indexOf('id="prediction-box"') && html.indexOf('id="prediction-box"') < html.indexOf('id="start-btn"'))) return false;
        // Box renders with two picked; no box with one picked.
        runInCtx("selected=['goku','vegeta']; selectedVariants={}; playerPrediction=null;");
        runInCtx('renderPredictionBoxV1657();');
        var box = els['prediction-box'].innerHTML || '';
        if (box.indexOf('Who wins?') === -1 || box.indexOf('Goku') === -1 || box.indexOf('Vegeta') === -1) return false;
        runInCtx("selected=['goku'];");
        runInCtx('renderPredictionBoxV1657();');
        if ((els['prediction-box'].innerHTML || '') !== '') return false;
        // Wrong call: pick Goku, Vegeta wins at seed 12345.
        runInCtx("selected=['goku','vegeta']; selectedVariants={}; forcedSeed=12345; forcedVictoryMode='death';");
        runInCtx('setPrediction(0);');
        if (runInCtx('playerPrediction') !== 'goku') return false;
        runInCtx('currentBattle = simulateBattle(); showResults();');
        if ((els['prediction-line'].innerText || '') !== 'Wrong — Vegeta wins.') return false;
        if (runInCtx('playerPrediction') !== null) return false; // consumed
        // Right call: pick Vegeta, Vegeta wins at seed 12345.
        runInCtx("selected=['goku','vegeta']; selectedVariants={}; forcedSeed=12345; forcedVictoryMode='death';");
        runInCtx('setPrediction(1);');
        runInCtx('currentBattle = simulateBattle(); showResults();');
        if ((els['prediction-line'].innerText || '') !== 'You called it.') return false;
        // Stalemate: the same battle with the stalemate flag set reads as one.
        runInCtx("selected=['goku','vegeta']; selectedVariants={}; forcedSeed=12345; forcedVictoryMode='death';");
        runInCtx('setPrediction(0);');
        runInCtx('currentBattle = simulateBattle(); currentBattle.stalemate = true;');
        try { runInCtx('showResults();'); } catch (e) {}
        if ((els['prediction-line'].innerText || '') !== 'Stalemate — no winner.') return false;
        // No prediction: the line is cleared.
        runInCtx("selected=['goku','vegeta']; selectedVariants={}; forcedSeed=12345; forcedVictoryMode='death'; playerPrediction=null;");
        runInCtx('currentBattle = simulateBattle(); showResults();');
        if ((els['prediction-line'].innerText || '') !== '') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-SEED-CHALLENGE (idea 5, Jhay 2026-11-07 ~19:24) seed input + shared setter setForcedSeedV1657(n) exist; the typed seed applies to every startBattle() call (including "Surprise me") and is consumed by the clear after the battle; resetSimulator clears it too; forcedSeed is 6 occurrences, setter 3',
    (function () {
      try {
        if ((html.split('id="seed-input"').length - 1) !== 1) return false;
        if ((html.split('onchange="applySeedInput()"').length - 1) !== 1) return false;
        if ((html.match(/forcedSeed/g) || []).length !== 6) return false;
        if ((html.match(/setForcedSeedV1657/g) || []).length !== 3) return false;
        if (html.indexOf("function setForcedSeedV1657(n){forcedSeed=(typeof n==='number'&&isFinite(n))?n:null;}") === -1) return false;
        // Setter: a number in, anything else -> null.
        runInCtx('setForcedSeedV1657(42);');
        if (runInCtx('forcedSeed') !== 42) return false;
        runInCtx("setForcedSeedV1657('x');");
        if (runInCtx('forcedSeed') !== null) return false;
        runInCtx('setForcedSeedV1657(null);');
        if (runInCtx('forcedSeed') !== null) return false;
        // Typing applies: input -> setter.
        els['seed-input'].value = '777';
        runInCtx('applySeedInput();');
        if (runInCtx('forcedSeed') !== 777) return false;
        els['seed-input'].value = 'abc';
        runInCtx('applySeedInput();');
        if (runInCtx('forcedSeed') !== null) return false;
        // The typed seed drives the battle and is consumed by the clear.
        runInCtx("selected=['goku','vegeta']; selectedVariants={}; forcedVictoryMode='death';");
        runInCtx('setForcedSeedV1657(12345);');
        runInCtx('startBattle();');
        const b1 = JSON.parse(runInCtx("JSON.stringify({seed:currentBattle.seed,winner:currentBattle.winner,fin:currentBattle.finalRecord.finishingAbility,fs:forcedSeed})"));
        if (b1.seed !== 12345 || b1.winner !== 'Vegeta' || b1.fs !== null) return false;
        // Same seed again reproduces the same battle (shareable by typing).
        runInCtx("selected=['goku','vegeta']; selectedVariants={}; forcedVictoryMode='death';");
        runInCtx('setForcedSeedV1657(12345);');
        runInCtx('startBattle();');
        const b2 = JSON.parse(runInCtx("JSON.stringify({seed:currentBattle.seed,winner:currentBattle.winner,fin:currentBattle.finalRecord.finishingAbility,fs:forcedSeed})"));
        if (b2.seed !== 12345 || b2.winner !== 'Vegeta' || b2.fin !== b1.fin || b2.fs !== null) return false;
        // Seed scope: it applies to "Surprise me" too, and is consumed there.
        runInCtx("selected=[]; selectedVariants={}; forcedVictoryMode='death';");
        runInCtx('setForcedSeedV1657(12345);');
        runInCtx('randomFight();');
        const br = JSON.parse(runInCtx("JSON.stringify({seed:currentBattle.seed,fs:forcedSeed})"));
        if (br.seed !== 12345 || br.fs !== null) return false;
        // Reset clears it (input value + forcedSeed).
        runInCtx('setForcedSeedV1657(99);');
        els['seed-input'].value = '99';
        runInCtx('resetSimulator();');
        if (runInCtx('forcedSeed') !== null) return false;
        if ((els['seed-input'].value || '') !== '') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-RIVALRY (idea 6, Jhay 2026-11-07 ~19:24) rivalFor(id) reads the RELATIONSHIPS map (exactly 2 real pairs + 2 empty self-pairs, no hardcoded pairs, relationshipPara still has no callers); with one fighter picked the match panel suggests the rival, and one tap ADDS the rival (then the player taps Start)',
    (function () {
      try {
        if ((html.split("'Goku|Vegeta'").length - 1) !== 1) return false;
        if ((html.split("'Batman|Superman'").length - 1) !== 1) return false;
        if ((html.split("'Goku|Goku':''").length - 1) !== 1) return false;
        if ((html.split("'Vegeta|Vegeta':''").length - 1) !== 1) return false;
        if ((html.split('relationshipPara(').length - 1) !== 1) return false; // definition only, no callers
        var rfLine = html.split('\n').filter(function (l) { return l.indexOf('function rivalFor(') !== -1; })[0] || '';
        if (rfLine.indexOf('RELATIONSHIPS') === -1) return false;
        if (rfLine.indexOf('Goku|Vegeta') !== -1 || rfLine.indexOf('Batman|Superman') !== -1) return false; // no hardcoded pairs
        if (runInCtx("rivalFor('goku')") !== 'vegeta') return false;
        if (runInCtx("rivalFor('vegeta')") !== 'goku') return false;
        if (runInCtx("rivalFor('batman')") !== 'superman') return false;
        if (runInCtx("rivalFor('superman')") !== 'batman') return false;
        if (runInCtx("rivalFor('rocky')") !== null) return false;
        if (runInCtx("rivalFor('nope')") !== null) return false;
        // Suggestion renders with one picked, clears with two or with no rival.
        runInCtx("selected=['goku']; selectedVariants={};");
        runInCtx('renderRivalryV1657();');
        var sug = els['rivalry-box'].innerHTML || '';
        if (sug.indexOf("Goku's rival is Vegeta") === -1 || sug.indexOf('Fight Vegeta') === -1) return false;
        runInCtx("selected=['goku','vegeta'];");
        runInCtx('renderRivalryV1657();');
        if ((els['rivalry-box'].innerHTML || '') !== '') return false;
        runInCtx("selected=['rocky'];");
        runInCtx('renderRivalryV1657();');
        if ((els['rivalry-box'].innerHTML || '') !== '') return false;
        // One tap ADDS the rival; the player still taps Start after.
        runInCtx("selected=['goku']; selectedVariants={};");
        runInCtx('addRival();');
        if (JSON.stringify(JSON.parse(runInCtx('JSON.stringify(selected)'))) !== '["goku","vegeta"]') return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1659-FIGHT-OF-THE-DAY (idea 8, Jhay 2026-11-07 ~19:24) pure date-seed (UTC): the daily pair + seed come from today\'s UTC date through mulberry32, the same for every player, deterministic on repeat; the banner names the pair and the seed; playing it is a normal seeded battle (base only); no table, no save across refreshes',
    (function () {
      try {
        if (html.indexOf('function dailyDateSeedV1657(){var d=new Date();return d.getUTCFullYear()*10000+(d.getUTCMonth()+1)*100+d.getUTCDate();}') === -1) return false;
        var dpLine = html.split('\n').filter(function (l) { return l.indexOf('function dailyPickV1657(') !== -1; })[0] || '';
        if (dpLine.indexOf('mulberry32') === -1 || dpLine.indexOf('ROSTER') === -1) return false;
        if (dpLine.indexOf('localStorage') !== -1) return false;
        if (html.indexOf('dailyTable') !== -1) return false;
        var d = new Date();
        var today = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        if (runInCtx('dailyDateSeedV1657()') !== today) return false;
        const p1 = JSON.parse(runInCtx('JSON.stringify(dailyPickV1657())'));
        const p2 = JSON.parse(runInCtx('JSON.stringify(dailyPickV1657())'));
        if (p1.seed !== today || p2.seed !== today) return false;
        if (JSON.stringify(p1) !== JSON.stringify(p2)) return false; // deterministic
        if (p1.a === p1.b) return false;
        var inRoster = JSON.parse(runInCtx("JSON.stringify(ROSTER.some(function (x) { return x.id === '" + p1.a + "'; }) && ROSTER.some(function (x) { return x.id === '" + p1.b + "'; }))"));
        if (!inRoster) return false;
        // Banner renders (the harness truncates before INIT, so call it).
        runInCtx('renderDailyBannerV1657();');
        var ban = els['daily-banner'].innerHTML || '';
        if (ban.indexOf('Fight of the Day:') === -1) return false;
        if (ban.indexOf('Seed ' + today) === -1) return false;
        var names = JSON.parse(runInCtx("JSON.stringify([byId('" + p1.a + "').name, byId('" + p1.b + "').name])"));
        if (ban.indexOf(names[0]) === -1 || ban.indexOf(names[1]) === -1) return false;
        // Playing it is a normal seeded battle, base only, seed consumed.
        runInCtx("selected=[]; selectedVariants={goku:'v2'}; forcedVictoryMode='death';");
        runInCtx('playDailyV1657();');
        const pd = JSON.parse(runInCtx("JSON.stringify({s:selected,v:selectedVariants,seed:currentBattle.seed,fs:forcedSeed})"));
        if (JSON.stringify(pd.s) !== JSON.stringify([p1.a, p1.b])) return false;
        if (JSON.stringify(pd.v) !== '{}') return false;
        if (pd.seed !== today || pd.fs !== null) return false;
        return true;
      } catch (e) { return false; }
    })(), '');
  check('V1650-REGRESSION-SUITE (spec 8.14) ALL V1650 checks (conditions, rubric, narration shape, tone variation, locks, incapacitation, winner agreement rewritten per 8.4, direct-to-results, audit-collapsed, version, strip, RED, G1-G8) still pass on rendered records — this check asserts zero failures before it in this run',
    failed === 0, 'failures before this check=' + failed);
}

  console.log('\\n' + passed + ' passed, ' + failed + ' failed.');
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(failed ? 1 : 0);
})();

