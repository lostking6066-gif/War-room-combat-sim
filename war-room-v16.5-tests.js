/* WAR-ROOM v16.5 regression harness (v16/v16.1/v16.2/v16.3/v16.4 tests retained, plus v16.5 live-defect tests) — Node, DOM-stub, deterministic.
   Usage: node war-room-v16.5-tests.js [path-to-war-room-v16.5.html]
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

const htmlPath = process.argv[2] || path.join(__dirname, 'war-room-v16.5.html');
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
vm.runInContext(script, sandbox, { filename: 'war-room-v16.5-extracted.js' });
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
  check('AUDIT v16.2 format in live save path (v15/v15.1/v16/v16.1 saves still loadable, see V151-3)', html.indexOf("formatVersion:'v16.5'") !== -1, '');
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
  check('V151-3 saved Death reopened after Incapacitation shows Death heading', els['episode-heading'].innerText.indexOf('Death Battle Episode') === 0, els['episode-heading'].innerText);
  const incapSave = { id: 515151, formatVersion: 'v15.1', winner: 'Spider-Man', victoryType: 'Incapacitation — knockout (unconscious, not dead)', victoryMode: 'incapacitation', battlefield: 'Open Arena', date: '10/30/2026, 6:20:00 AM', rounds: 6, seed: 4817076, eventRecord: [], story: '<h3>Chapter I</h3><p>Saved incap story.</p>', breakdown: '<li>Saved breakdown.</li>' };
  setSave(incapSave);
  runInCtx(`document.getElementById('victory-select').value='death'; document.getElementById('episode-heading').innerText='Death Battle Episode — 6 Chapters (Narrator Style C)'; viewHistory(515151);`);
  check('V151-3b saved Incapacitation reopened after Death shows Incapacitation heading', els['episode-heading'].innerText.indexOf('Incapacitation Episode') === 0, els['episode-heading'].innerText);
  const v15Save = { id: 616161, formatVersion: 'v15', winner: 'Superman', victoryType: 'Death (HP 0)', victoryMode: 'death', battlefield: 'Open Arena', date: '10/30/2026, 6:10:00 AM', rounds: 6, seed: 1, eventRecord: [], story: '<h3>Chapter I</h3><p>v15 story.</p>', breakdown: '<li>v15 breakdown.</li>' };
  setSave(v15Save);
  runInCtx(`viewHistory(616161);`);
  check('V151-3c v15 save loads correctly (not orphaned) with its own Death heading', els['episode-heading'].innerText.indexOf('Death Battle Episode') === 0 && els['result-desc'].innerText.indexOf('6:10:00') !== -1, els['episode-heading'].innerText);
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
  check('V151-6 no user-visible v14 blocked-check text, no Death Rules heading, no fixed signature timing', html.indexOf('(v14 blocked check') === -1 && html.indexOf('Death Rules — what counts') === -1 && html.indexOf('every 4th action') === -1 && html.indexOf('Victory Rules — what counts') !== -1 && html.indexOf('used tactically, not on a fixed schedule') !== -1, '');
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
    const goodCur = goodTextFor(cur);
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => goodCur });
    runInCtx(`showResults();`);
    const ok = await waitFor(() => ((els['main-story-label'] && els['main-story-label'].innerText) || '').indexOf('Online AI Story') !== -1, 3000);
    check('V16-3 showResults auto-generates the online AI story (no button click required)',
      ok && (els['story-output'].innerHTML || '').indexOf(goodCur.slice(0, 40)) !== -1 && (els['main-story-label'].innerText || '').indexOf('Offline Story') === -1,
      'label=' + els['main-story-label'].innerText + ' storyHasGood=' + ((els['story-output'].innerHTML || '').indexOf(goodCur.slice(0, 40)) !== -1));
    const saved = JSON.parse(sandbox.localStorage.getItem('warroom_battles_v3') || '[]');
    check('V16-3b auto-generated battle is saved as v16.5 with AI mainStoryMeta',
      saved.length > 0 && saved[0].formatVersion === 'v16.5' && saved[0].mainStoryMeta && saved[0].mainStoryMeta.kind === 'ai',
      saved.length ? (saved[0].formatVersion + ' ' + JSON.stringify(saved[0].mainStoryMeta)) : 'no saves');
    sandbox.fetch = realFetch;
  });
  // V16-4 Stale result ignored after a newer battle's generation starts.
  await expectV16('V16-4 stale result ignored', async () => {
    const b1 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const b2 = battle([[spec('spiderman')], [spec('batman')]], { seed: 145416145, victoryMode: 'incapacitation' });
    // Incapacitation good text must not use death wording: build it separately.
    const fin2 = finAtkOf(b2);
    const loser2 = b2.alpha[0].name === b2.winner ? b2.beta[0].name : b2.alpha[0].name;
    const good2 = b2.alpha[0].name + ' and ' + b2.beta[0].name + ' clashed, trading blows and reading each other as the fight wore on. '
      + b2.winner + ' found the opening that mattered and struck with ' + (fin2 ? fin2.ability : 'a final blow')
      + ', and ' + loser2 + ' fell unconscious at the end while ' + b2.winner + ' stood as the winner.';
    const good1 = goodTextFor(b1);
    const pending = [];
    sandbox.fetch = (url, opts) => new Promise((resolve) => { pending.push(resolve); });
    setVmBattle('globalThis._v16b1', b1);
    setVmBattle('globalThis._v16b2', b2);
    runInCtx(`globalThis._v16p1 = generateMainStoryV16(globalThis._v16b1, 'v16-test-old-1', {});`);
    runInCtx(`globalThis._v16p2 = generateMainStoryV16(globalThis._v16b2, 'v16-test-new-2', {});`);
    // Resolve the NEW battle first, then the old one; the old text must never render.
    pending[1]({ ok: true, status: 200, text: async () => good2 });
    await sandbox._v16p2;
    pending[0]({ ok: true, status: 200, text: async () => good1 });
    await sandbox._v16p1;
    const sid = runInCtx(`currentStorySessionId`);
    check('V16-4 stale (old-session) story never renders under the newer battle',
      (els['story-output'].innerHTML || '').indexOf(good2.slice(0, 40)) !== -1
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
  // V16-8 UI order, Advanced collapsed by default, old main-path buttons gone.
  check('V16-8 main story precedes combat details in DOM; Advanced collapsed by default; retry lives only in Technical Details',
    html.indexOf('id="story-output"') !== -1 && html.indexOf('id="story-output"') < html.indexOf('id="breakdown-output"')
    && html.indexOf('<details class="adv" id="advanced-settings">') !== -1
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
  await expectV16('V161-1 stale header cleared in preparing phase', async () => {
    const b1 = battle([[spec('spiderman')], [spec('batman')]], { seed: 841747056, victoryMode: 'incapacitation' });
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 1348984983, victoryMode: 'death' });
    // Plant Battle 1's stale UI exactly as the live test saw it.
    els['main-story-label'].innerText = 'Offline Story — Online AI generation was unavailable. Reason: Pollinations POST HTTP 402 / GET: Pollinations GET HTTP 404 — Spider-Man vs Batman validation';
    els['main-story-diagnostics'].innerHTML = 'Session: v16-841747056-1793358359926-1<br>Provider: Offline fallback<br>Attempts: 1<br>Validation: Spider-Man/Batman checks';
    els['main-story-status'].innerText = 'Online AI generation was unavailable — showing the offline episode instead.';
    els['ai-story-output'].innerText = 'Battle 1 Spider-Man/Batman validation lines';
    const pending = [];
    sandbox.fetch = (url, opts) => new Promise((resolve) => { pending.push(resolve); });
    setVmBattle('globalThis._v161b2', b2);
    runInCtx(`globalThis._v161p = generateMainStoryV16(globalThis._v161b2, 'v16-test-b2-new', {});`);
    // Preparing phase: reset ran synchronously at generation start, before
    // any fetch resolves. No Battle 1 string may remain anywhere in the
    // story header / label / diagnostics / status / ai-story box.
    const label = els['main-story-label'].innerText || '';
    const diag = els['main-story-diagnostics'].innerHTML || '';
    const status = els['main-story-status'].innerText || '';
    const aiBox = els['ai-story-output'].innerText || '';
    const story = els['story-output'].innerHTML || '';
    const joined = label + ' | ' + diag + ' | ' + status + ' | ' + aiBox;
    check('V161-1a preparing phase shows only the NEW session; no Battle 1 session/reason/validation remains',
      diag.indexOf('v16-test-b2-new') !== -1 && joined.indexOf('v16-841747056-1793358359926-1') === -1
      && joined.indexOf('Spider-Man') === -1 && joined.indexOf('Batman') === -1
      && status.indexOf('Preparing battle story') !== -1 && story.indexOf('Preparing battle story') !== -1,
      'label=' + label + ' diag=' + diag + ' status=' + status);
    // A stale-session render must be refused even if called directly.
    runInCtx(`renderMainStoryLabelV16({kind:'ai',provider:'Stale',passed:9,unverified:0}, 'v16-test-old-1'); renderMainStoryDiagnosticsV16({sessionId:'v16-test-old-1',provider:'Stale',attempts:9,promptSize:1}, 'v16-test-old-1');`);
    check('V161-1b renders gated on session: an old-session label/diagnostics call writes nothing',
      (els['main-story-label'].innerText || '').indexOf('Online AI Story') === -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('v16-test-old-1') === -1,
      'label=' + els['main-story-label'].innerText);
    // Resolve Battle 2: the final story must be Battle 2's own, not Battle 1's.
    const good2 = goodTextFor(b2);
    pending[0]({ ok: true, status: 200, text: async () => good2 });
    await sandbox._v161p;
    check('V161-1c resolved story is Battle 2 own story (Superman/Rocky), never Battle 1 text',
      (els['story-output'].innerHTML || '').indexOf(good2.slice(0, 40)) !== -1
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
    check('V161-2 mode heading updates immediately both directions (death -> incapacitation -> death)',
      deathH.indexOf('Death Match') !== -1 && incapH.indexOf('Incapacitation Match') !== -1 && backH.indexOf('Death Match') !== -1,
      'death=' + deathH + ' incap=' + incapH + ' back=' + backH);
    check('V161-2b the live victory-select change handler itself calls updateModeHeadings (not just the function existing)',
      html.indexOf("updateModeHeadings(_vs.value)") !== -1, '');
  }
  // V161-3 Panels relocated (not deleted) into Advanced / Technical Details, in DOM order.
  {
    const adv = html.indexOf('<details class="adv" id="advanced-settings">');
    const modeB = html.indexOf('id="mode-b-panel"');
    const vic = html.indexOf('id="victory-rules-panel"');
    const brains = html.indexOf('id="four-brains-panel"');
    const hist = html.indexOf('Battle History (saved on this device only)');
    const tech = html.indexOf('Technical Details');
    const dl = html.indexOf('Download story as HTML');
    const combat = html.indexOf('Combat Details');
    const newBattle = html.indexOf('onclick="resetSimulator()">New Battle');
    check('V161-3 Mode B / Victory Rules / Four Brains are inside Advanced Settings in DOM order (after its <details>, before Battle History)',
      adv !== -1 && modeB > adv && vic > modeB && brains > vic && brains < hist, 'adv=' + adv + ' modeB=' + modeB + ' vic=' + vic + ' brains=' + brains + ' hist=' + hist);
    check('V161-3b download/export buttons are inside Technical Details (after its summary, after Combat Details, after New Battle)',
      tech !== -1 && dl > tech && dl > combat && dl > newBattle && html.indexOf('Export saved episode (JSON + story)') > tech, 'tech=' + tech + ' dl=' + dl);
    check('V161-3c relocated panels keep their content and element IDs (video-url, video-notes, battlefield rules text)',
      html.indexOf('id="video-url"') !== -1 && html.indexOf('id="video-notes"') !== -1 && html.indexOf('Regeneration can heal, but it does NOT revive') !== -1, '');
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
    check('V161-4c fallback label shows the exact offline label + 402 explanation, and no key was requested (no Authorization header) when none is saved',
      label.indexOf('Offline Story — Online AI generation was unavailable.') !== -1
      && label.indexOf('Pollinations returned payment-required (402)') !== -1 && !authSent
      && seen.filter(c => c.method === 'POST').length === 2,
      'label=' + label + ' authSent=' + authSent + ' calls=' + seen.length);
    runInCtx(`V162_402_WAIT_MS = 35000;`);
    sandbox.fetch = realFetch;
  });
  // V161-5 Saved Pollinations key: used only with a saved key, value never in the file.
  await expectV16('V161-5 saved Pollinations key path', async () => {
    const TESTKEY = 'V161-TESTKEY-ONLY-IN-HARNESS-9f3a';
    sandbox.localStorage.setItem('warroom_pollinations_key', TESTKEY);
    const seen = [];
    sandbox.fetch = async (url, opts) => {
      seen.push({ url: String(url), method: (opts && opts.method) || 'GET', auth: (opts && opts.headers && opts.headers.Authorization) || '' });
      if (opts && opts.headers && opts.headers.Authorization === 'Bearer ' + TESTKEY) {
        const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
        return { ok: true, status: 200, text: async () => goodTextFor(b) };
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
    check('V162-Ca 402 triggers exactly one wait-retry (2 POSTs total), then falls back with a plain-words rate-limit reason',
      seenC.filter(m => m === 'POST').length === 2
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
    check('V162-Gb fallback diagnostics show the real cap (4500)',
      (els['main-story-diagnostics'].innerHTML || '').indexOf('cap 4500') !== -1,
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
  const unnamedDraft = 'Two figures clashed in a long fight on the open ground while the crowd watched the exchange grow fiercer and the arena lights burned bright overhead.';
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
    check('V163-Ac revision prompt repeats the naming rule alongside the failed checks', revCalls === 1 && namingOk(revBody) && revBody.indexOf('REVISION') !== -1, 'revCalls=' + revCalls);
    sandbox.fetch = realFetch;
  });
  // V163-B Revision 402 -> wait -> success; keyed secondary 402 -> wait -> success.
  await expectV16('V163-B 402 wait-retry on revision and keyed stages', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    let calls = 0; let revCalls = 0; let revBody = '';
    sandbox.fetch = async (url, opts) => {
      calls++;
      const body = (opts && opts.body) || '';
      if (body.indexOf('REVISION') !== -1) {
        revCalls++; revBody = body;
        if (revCalls === 1) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
        return { ok: true, status: 200, text: async () => goodDraftFor(b) };
      }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v163b', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163b, 'v16-test-rev402-1', {})`);
    check('V163-Ba revision 402 waits and retries once, then renders the AI story (not fallback)',
      calls === 3 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1 && (els['story-output'].innerHTML || '').indexOf(b.winner) !== -1,
      'calls=' + calls + ' label=' + els['main-story-label'].innerText);
    check('V163-Bb revision body carries the naming rule', revBody.indexOf('opening paragraph') !== -1 && revBody.indexOf('full recorded names') !== -1, '');
    sandbox.localStorage.setItem('warroom_pollinations_key', 'test-key-163');
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good2 = goodDraftFor(b2);
    let keyedCalls = 0; let keyedAuth = '';
    sandbox.fetch = async (url, opts) => {
      const hdrs = (opts && opts.headers) || {};
      if (hdrs.Authorization) {
        keyedCalls++; keyedAuth = hdrs.Authorization;
        if (keyedCalls === 1) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
        return { ok: true, status: 200, text: async () => good2 };
      }
      return { ok: false, status: 500, text: async () => 'Server error' };
    };
    setVmBattle('globalThis._v163b2', b2);
    await runInCtx(`generateMainStoryV16(globalThis._v163b2, 'v16-test-key402-1', {})`);
    check('V163-Bc saved-key secondary 402 waits and retries once, then renders the AI story with the key',
      keyedCalls === 2 && keyedAuth === 'Bearer test-key-163' && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1 && (els['main-story-label'].innerText || '').indexOf('your saved key') !== -1,
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
    check('V163-Ca 402 wait-retry happens at most once per stage and the fallback explains the rate limit in plain words',
      posts === 2 && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1 && (els['main-story-label'].innerText || '').indexOf('1 reply every 30 seconds') !== -1,
      'posts=' + posts + ' label=' + els['main-story-label'].innerText);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V163-D Abort/timeout: one retry -> success; second abort -> interrupted fallback.
  await expectV16('V163-D abort retry', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good = goodDraftFor(b);
    let calls = 0;
    sandbox.fetch = async () => { calls++; if (calls === 1) throw new Error('signal is aborted without reason'); return { ok: true, status: 200, text: async () => good }; };
    setVmBattle('globalThis._v163d', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163d, 'v16-test-abort-1', {})`);
    check('V163-Da abort retries once and then renders the AI story',
      calls === 2 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'calls=' + calls + ' label=' + els['main-story-label'].innerText);
    let calls2 = 0;
    sandbox.fetch = async () => { calls2++; throw new Error('signal is aborted without reason'); };
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v163d2', b2);
    await runInCtx(`generateMainStoryV16(globalThis._v163d2, 'v16-test-abort-2', {})`);
    check('V163-Db second abort falls back with an interrupted / network-drop reason, never blaming the provider as fact',
      calls2 === 2 && (els['main-story-label'].innerText || '').indexOf('Offline Story — Online AI generation was unavailable.') !== -1 && (els['main-story-label'].innerText || '').indexOf('interrupted') !== -1 && (els['main-story-label'].innerText || '').indexOf('network drop') !== -1,
      'calls2=' + calls2 + ' label=' + els['main-story-label'].innerText);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V163-E A superseded session never retries after an abort or a 402.
  await expectV16('V163-E superseded session never retries', async () => {
    runInCtx(`V162_402_WAIT_MS = 50; V163_ABORT_RETRY_DELAY_MS = 50;`);
    const b1 = battle([[spec('spiderman')], [spec('batman')]], { seed: 900636602, victoryMode: 'incapacitation' });
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good2 = goodDraftFor(b2);
    let calls = 0;
    sandbox.fetch = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
      return { ok: true, status: 200, text: async () => good2 };
    };
    setVmBattle('globalThis._v163e1', b1);
    setVmBattle('globalThis._v163e2', b2);
    const p1 = runInCtx(`generateMainStoryV16(globalThis._v163e1, 'v16-test-sup-1', {})`);
    const p2 = runInCtx(`generateMainStoryV16(globalThis._v163e2, 'v16-test-sup-2', {})`);
    await p1; await p2;
    check('V163-Ea superseded generation makes no retry POST and the newer battle story wins',
      calls === 2 && (els['story-output'].innerHTML || '').indexOf(good2.slice(0, 40)) !== -1 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'calls=' + calls + ' label=' + els['main-story-label'].innerText);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V163-F Worst-case combined sequence stays within the 10-POST cap.
  await expectV16('V163-F total POSTs per battle never exceed the cap', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    sandbox.localStorage.setItem('warroom_pollinations_key', 'test-key-163');
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    const good = goodDraftFor(b);
    let calls = 0;
    sandbox.fetch = async (url, opts) => {
      calls++;
      const hdrs = (opts && opts.headers) || {};
      const body = (opts && opts.body) || '';
      if (hdrs.Authorization) {
        if (calls === 7) return { ok: false, status: 400, text: async () => 'output_token_limit_exceeded' };
        return { ok: true, status: 200, text: async () => good };
      }
      if (calls === 1) return { ok: false, status: 400, text: async () => 'output_token_limit_exceeded' };
      if (calls === 2) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
      if (calls === 3) return { ok: true, status: 200, text: async () => unnamedDraft };
      if (body.indexOf('REVISION') !== -1) {
        if (calls === 4) throw new Error('signal is aborted without reason');
        if (calls === 5) return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
        return { ok: false, status: 500, text: async () => 'Server error' };
      }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v163f', b);
    await runInCtx(`generateMainStoryV16(globalThis._v163f, 'v16-test-cap-1', {})`);
    const counted = runInCtx(`v163PostCount`);
    check('V163-Fa combined 402 + abort + token-limit + revision + keyed sequence uses at most 10 POSTs and ends as an AI story',
      calls <= 10 && counted <= 10 && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'calls=' + calls + ' counted=' + counted + ' label=' + els['main-story-label'].innerText);
    sandbox.localStorage.removeItem('warroom_pollinations_key');
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
    check('V164-Ad revision prompt repeats the verbatim-climax rule with the recorded ability', revCalls === 1 && revBody.indexOf(ruleS) !== -1, 'revCalls=' + revCalls);
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
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The crowd watched the exchange grow fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
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
    check('V164-Dd saved-renderer audit: every live-only note/summary element is touched by viewHistory', missing.length === 0, 'missing=' + missing.join(','));
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
    const kwSpider = 'Spider fought Batman on the open ground for a long time while the crowd watched the exchange grow fiercer and fiercer.';
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
    const godDraft = 'Goku and Rocky Balboa fought on the open ground in god form, trading blows while the crowd watched the exchange grow fiercer and fiercer.';
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
  // T6: JSON length finish -> meta carries finish reason, stage, length; T15: truncation reason (same run shape, Superman battle below in T15).
  await expectV16('V165-T6 length finish diagnostics', async () => {
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The crowd watched the exchange grow fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: longBad }, finish_reason: 'length' }] }) });
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t6', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t6, 'v16-test-v165t6-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T6 mock length finish produces meta with finish reason, revision stage, and exact draft length, rendered in Technical Details',
      meta.rejectedDraftFinishReason === 'length' && meta.rejectedDraftStage === 'revision' && meta.rejectedDraftLength === longBad.length
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected draft length: ' + longBad.length + ' characters') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected draft stage: revision') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Provider finish reason: length') !== -1,
      'stage=' + meta.rejectedDraftStage + ' finish=' + meta.rejectedDraftFinishReason + ' len=' + meta.rejectedDraftLength);
    sandbox.fetch = realFetch;
  });
  // T7: revision-fetch failure labels the initial draft's diagnostics explicitly.
  await expectV16('V165-T7 revision failure labelling', async () => {
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      if (body.indexOf('REVISION') !== -1) throw new Error('revision transport boom');
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t7', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t7, 'v16-test-v165t7-1', {})`);
    check('V165-T7 revision-fetch failure names the revision failure and shows the initial draft excerpts',
      (els['main-story-label'].innerText || '').indexOf('Revision request failed (no revised draft returned)') !== -1
      && (els['main-story-label'].innerText || '').indexOf('diagnostics below are for the initial draft') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Two figures clashed') !== -1,
      'label=' + els['main-story-label'].innerText);
    sandbox.fetch = realFetch;
  });
  // T8: condensed-retry draft stores stage initial-condensed and the condensed prompt size.
  await expectV16('V165-T8 condensed retry stage', async () => {
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The crowd watched the exchange grow fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
    let calls = 0;
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      calls++;
      if (body.indexOf('REVISION') !== -1) throw new Error('revision transport boom');
      if (calls === 1) return { ok: false, status: 400, text: async () => 'output_token_limit_exceeded' };
      return { ok: true, status: 200, text: async () => longBad };
    };
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const condLen = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`).length;
    setVmBattle('globalThis._v165t8', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t8, 'v16-test-v165t8-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T8 condensed-retry draft stores stage initial-condensed and the condensed prompt length, not the full prompt length',
      meta.rejectedDraftStage === 'initial-condensed' && meta.rejectedDraftPromptSize === condLen
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected draft stage: initial-condensed') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Prompt size for this draft: ' + condLen + ' characters') !== -1,
      'stage=' + meta.rejectedDraftStage + ' promptSize=' + meta.rejectedDraftPromptSize + ' condLen=' + condLen);
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
  // T10: revision prompt from the condensed brief, complete-story instruction, shorter than full+draft.
  await expectV16('V165-T10 revision prompt', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const full = runInCtx(`buildPromptV16(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const cond = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const fin = finAtkOf(b);
    let revPrompt = '';
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let content = '';
      try { content = JSON.parse(body).messages[1].content; } catch (e) {}
      if (body.indexOf('REVISION') !== -1) { revPrompt = content; return { ok: true, status: 200, text: async () => goodDraftFor(b) }; }
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v165t10', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t10, 'v16-test-v165t10-1', {})`);
    check('V165-T10 revision prompt is condensed-based, complete-story + aftermath + word count, carries failures/rules/previous draft, and is shorter than the old full-prompt revision prompt',
      revPrompt.indexOf(cond) === 0
      && revPrompt.indexOf('RESEARCH DOSSIER EXTRACTS') === -1
      && revPrompt.indexOf('Participants named') !== -1
      && revPrompt.indexOf('The climax sentence must contain the finishing ability name verbatim, exactly as recorded: ' + fin.ability) !== -1
      && revPrompt.indexOf('full recorded names') !== -1
      && revPrompt.indexOf(unnamedDraft) !== -1
      && revPrompt.indexOf('COMPLETE revised story') !== -1
      && revPrompt.indexOf('final paragraph must be the aftermath') !== -1
      && revPrompt.indexOf('600–800 words') !== -1
      && cond.length < full.length
      && revPrompt.length < (full.length + (revPrompt.length - cond.length) - 'REVISED STORY INSTRUCTION — Return the COMPLETE revised story, from opening to aftermath, not only the changed passages. The final paragraph must be the aftermath matching the final winner and loser states. Length: about 600–800 words. Do not change events, the winner, or the final state.'.length + 'Fix ONLY these, change nothing else, and do not change events, the winner, or the final state.'.length),
      'revLen=' + revPrompt.length + ' fullLen=' + full.length + ' draftLen=' + unnamedDraft.length);
    sandbox.fetch = realFetch;
  });
  // T11: revision token-limit error gets exactly one condensed retry, then an AI story.
  await expectV16('V165-T11 revision condensed retry', async () => {
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    const cond = runInCtx(`buildCondensedPromptV162(JSON.parse(${JSON.stringify(JSON.stringify(b))}))`);
    const good = goodDraftFor(b);
    let calls = 0; let condensedUsed = false; let revAttempts = 0;
    sandbox.fetch = async (url, opts) => {
      const body = (opts && opts.body) || '';
      let content = '';
      try { content = JSON.parse(body).messages[1].content; } catch (e) {}
      calls++;
      if (content === cond) condensedUsed = true;
      if (body.indexOf('REVISION') !== -1) {
        revAttempts++;
        if (revAttempts === 1) return { ok: false, status: 400, text: async () => 'output_token_limit_exceeded' };
        return { ok: true, status: 200, text: async () => good };
      }
      if (revAttempts >= 1 && content === cond) return { ok: true, status: 200, text: async () => good };
      return { ok: true, status: 200, text: async () => unnamedDraft };
    };
    setVmBattle('globalThis._v165t11', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t11, 'v16-test-v165t11-1', {})`);
    check('V165-T11 revision token-limit error triggers exactly one condensed retry and then renders the AI story',
      calls === 3 && condensedUsed && (els['main-story-label'].innerText || '').indexOf('Online AI Story') !== -1,
      'calls=' + calls + ' condensedUsed=' + condensedUsed + ' label=' + els['main-story-label'].innerText);
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
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The crowd watched the exchange grow fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: longBad }, finish_reason: 'length' }] }) });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v165t15', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t15, 'v16-test-v165t15-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T15 length finish gives the distinct truncation fallback reason and never an AI story',
      meta.kind === 'offline' && meta.reason === 'Draft stopped before finishing (provider output limit) — draft did not pass validation'
      && (els['main-story-label'].innerText || '').indexOf('Draft stopped before finishing (provider output limit)') !== -1
      && (els['main-story-label'].innerText || '').indexOf('Online AI Story') === -1,
      'reason=' + meta.reason);
    sandbox.fetch = realFetch;
  });
  await expectV16('V165-T16 stop finish keeps plain reason', async () => {
    const longBad = ('Two figures clashed on the open ground while the arena lights burned bright overhead. ' + 'The crowd watched the exchange grow fiercer with each passing moment. ').repeat(12) + 'FINALMARKER climax tail.';
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: longBad }, finish_reason: 'stop' }] }) });
    const b = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v165t16', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t16, 'v16-test-v165t16-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T16 stop finish with a failing draft keeps the plain validation reason (no truncation wording)',
      meta.kind === 'offline' && meta.reason === 'Draft did not pass validation'
      && (els['main-story-label'].innerText || '').indexOf('provider output limit') === -1,
      'reason=' + meta.reason);
    sandbox.fetch = realFetch;
  });
  // T17: attempts label honesty + stage-named 402 retry status.
  await expectV16('V165-T17 attempts breakdown', async () => {
    runInCtx(`V162_402_WAIT_MS = 1; V163_ABORT_RETRY_DELAY_MS = 1;`);
    let calls = 0;
    sandbox.fetch = async () => {
      calls++;
      if (calls === 1) throw new Error('signal is aborted without reason');
      if (calls === 2) return { ok: true, status: 200, text: async () => unnamedDraft };
      return { ok: true, status: 200, text: async () => goodDraftFor(b) };
    };
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165t17', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165t17, 'v16-test-v165t17-1', {})`);
    const meta = JSON.parse(runInCtx(`JSON.stringify(lastMainStoryMeta)`));
    check('V165-T17 abort retry on initial + revision renders attempts 3 with the stage/retry breakdown',
      meta.attempts === 3 && (meta.attemptsBreakdown || '').indexOf('initial ×2 (1 retry)') !== -1 && (meta.attemptsBreakdown || '').indexOf('revision ×1') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Provider attempts: 3') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('initial ×2 (1 retry)') !== -1,
      'attempts=' + meta.attempts + ' breakdown=' + meta.attemptsBreakdown);
    let statusAtRetry = '';
    sandbox.fetch = async () => {
      statusAtRetry = els['main-story-status'].innerText || '';
      if (statusAtRetry.indexOf('402') !== -1 || statusAtRetry.indexOf('Free anonymous limit') !== -1) {
        return { ok: true, status: 200, text: async () => goodDraftFor(b2) };
      }
      return { ok: false, status: 402, text: async () => 'Free limit reached: 1 reply every 30 seconds per IP. Please wait 3 seconds.' };
    };
    const b2 = battle([[spec('superman')], [spec('rocky')]], { seed: 12345, victoryMode: 'death' });
    setVmBattle('globalThis._v165t17b', b2);
    await runInCtx(`generateMainStoryV16(globalThis._v165t17b, 'v16-test-v165t17b-1', {})`);
    check('V165-T17b 402 retry status names the stage (initial stage)',
      statusAtRetry.indexOf('(initial stage)') !== -1,
      'statusAtRetry=' + statusAtRetry);
    runInCtx(`V162_402_WAIT_MS = 35000; V163_ABORT_RETRY_DELAY_MS = 3000;`);
    sandbox.fetch = realFetch;
  });
  // V165-E: save copy + saved view carry the new diagnostic fields.
  await expectV16('V165-E save copy diagnostics', async () => {
    sandbox.fetch = async () => ({ ok: true, status: 200, text: async () => unnamedDraft });
    const b = battle([[spec('spiderman')], [spec('batman')]], { seed: 12345, victoryMode: 'incapacitation' });
    setVmBattle('globalThis._v165save', b);
    await runInCtx(`generateMainStoryV16(globalThis._v165save, 'v16-test-v165save-1', {})`);
    runInCtx(`saveMainStoryOnceV16(globalThis._v165save, '<p>Saved offline story.</p>', '<li>Saved breakdown.</li>', [], [], [], lastMainStoryMeta);`);
    const saved = JSON.parse(runInCtx(`localStorage.getItem('warroom_battles_v3')`));
    const entry = saved && saved[0];
    const m = entry && entry.mainStoryMeta;
    const okSave = !!m && m.rejectedDraftStage === 'revision' && typeof m.rejectedDraftLength === 'number' && m.rejectedDraftLength > 0
      && typeof m.attemptsBreakdown === 'string' && m.attemptsBreakdown.indexOf('revision') !== -1;
    runInCtx(`localStorage.setItem('warroom_battles_v3', JSON.stringify([JSON.parse(${JSON.stringify(JSON.stringify(Object.assign({}, entry, { id: 777201 })))} )]));`);
    runInCtx(`viewHistory(777201);`);
    check('V165-Ea save copy carries stage/length/breakdown/probe and the saved view renders the new diagnostic lines',
      okSave
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Rejected draft stage: revision') !== -1
      && (els['main-story-diagnostics'].innerHTML || '').indexOf('Per-check probe') !== -1,
      'stage=' + (m && m.rejectedDraftStage) + ' breakdown=' + (m && m.attemptsBreakdown));
    sandbox.fetch = realFetch;
  });

  console.log('\\n' + passed + ' passed, ' + failed + ' failed.');
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(failed ? 1 : 0);
})();

