import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import {TOOL_GROUPS, normalizeSearch, steppedValue, icon, renderForgeNav, renderForgeTools} from '../ui/forge.js';
import {renderExecution} from '../ui/execution.js';
import {findDay, getExercisePlan} from '../program.js';
import {defaultProfile, makeSession} from '../defaults.js';
import {STAGES} from '../engine/execution.js';

const base = new URL('../', import.meta.url);
const app = readFileSync(new URL('app.js', base), 'utf8');
const source = readFileSync(new URL('sw.js', base), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('asset-manifest.json', base), 'utf8'));

function worker() {
  const handlers={}, entries=new Map(), state={precache:[], network:0, skipped:0};
  const cache={addAll:async urls=>{state.precache=urls;}, match:async request=>entries.get(typeof request==='string'?request:request.url)};
  const context={URL,console,self:{location:{origin:'https://colosse.example'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:()=>{state.skipped++;},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async()=>{state.network++;throw new Error('offline');}};
  vm.runInNewContext(source,context);
  return {handlers,entries,state};
}
function renderWork(variantId) {
  const day=findDay('push-a'), ex=day.exercises[0], session=makeSession(day.id,'2026-09-08',defaultProfile(new Date('2026-09-01')));
  const variant=ex.variants.find(v=>v.id===variantId)??ex.variants[0];session.exercises[ex.id].variantId=variant.id;
  const plan=getExercisePlan(ex,1);
  return renderExecution({stage:STAGES.WORK_SET,exercise:ex,exerciseId:ex.id,plan,variant,setIndex:0,totalSets:plan.sets,targetRir:3,side:null},{day,session,progress:{done:1,total:30,percent:3},elapsedSec:60,prescriptionLoadKg:60,lastExposure:null});
}

test('Forge : navigation conserve les quatre rubriques historiques',()=>{
  const h=renderForgeNav('training');
  assert.match(h,/data-tab="training"/);assert.match(h,/data-tab="weight"/);assert.match(h,/data-tab="history"/);assert.match(h,/data-tab="tools"/);assert.match(h,/aria-current="page"/);
  assert.ok(TOOL_GROUPS.flatMap(g=>g.items).some(t=>t[0]==='settings'));
});
test('Forge : les 17 liens du répertoire renvoient à des sections existantes',()=>{
  const links=TOOL_GROUPS.flatMap(g=>g.items);assert.equal(links.length,17);
  for(const [,id] of links)if(id)assert.ok(app.includes(`id="${id}"`),id);
});
test('Forge : recherche normalisée, accents, majuscules et espaces',()=>{
  assert.equal(normalizeSearch('  RÉCUPÉRATION '),'recuperation');assert.equal(normalizeSearch(null),'');
  assert.match(renderForgeTools(),/data-tool-search="poids &amp; recuperation/);
});
test('Forge : incréments respectés, pas de charge négative',()=>{
  assert.equal(steppedValue(60,2.5),62.5);assert.equal(steppedValue('12,5',2.5),15);assert.equal(steppedValue(1,-2.5),0);assert.equal(steppedValue('',5),5);
});
test('Forge : les icônes décoratives ne polluent pas le lecteur d’écran',()=>{
  assert.match(icon('home'),/aria-hidden="true"/);assert.match(icon('home'),/focusable="false"/);
});
test('Forge : saisie série utilise les actions du moteur historique',()=>{
  const h=renderWork();assert.match(h,/data-action="exec-validate-set"/);assert.match(h,/data-exec-field="weightKg"/);assert.match(h,/data-exec-field="reps"/);assert.match(h,/data-action="exec-show-program"/);
});
test('Forge : le RIR cible n’est pas présélectionné comme ressenti réel',()=>{
  const h=renderWork();const rir=h.slice(h.indexOf('data-exec-group="rir"'),h.indexOf('<details class="f-feedback-details"'));
  assert.match(rir,/is-target/);assert.doesNotMatch(rir,/chip-choice selected/);assert.match(rir,/data-value="6"/);
});
test('Forge : toutes les valeurs de douleur de 0 à 10 restent saisissables',()=>{
  const h=renderWork();for(let i=0;i<=10;i++)assert.ok(h.includes(`data-exec-field="pain" data-value="${i}"`));assert.match(h,/data-value="degraded"/);
});
test('Forge : la clé de brouillon est isolée par variante',()=>{
  const day=findDay('push-a'),vars=day.exercises[0].variants;assert.ok(vars.length>1);
  const getKey=h=>h.match(/data-forge-step="([^"]+)"/)[1];assert.notEqual(getKey(renderWork(vars[0].id)),getKey(renderWork(vars[1].id)));
});
test('Forge : le zoom utilisateur reste autorisé',()=>{
  for(const name of ['index.html','colosse-app.html']){const h=readFileSync(new URL(name,base),'utf8');assert.doesNotMatch(h,/maximum-scale=1|user-scalable=no/);assert.match(h,/viewport-fit=cover/);assert.match(h,/forge.css/);}
});
test('Forge : tous les assets déclarés existent et sont précachés',()=>{
  for(const a of manifest.assets){if(a==='./')continue;assert.ok(existsSync(new URL(a,base)),a);assert.ok(source.includes(JSON.stringify(a)),a);}
});
test('Forge : installer le worker ne force pas de rechargement',async()=>{
  const w=worker();let done;w.handlers.install({waitUntil:p=>done=p});await done;
  assert.equal(w.state.skipped,0);assert.ok(w.state.precache.includes('./forge.css'));assert.ok(w.state.precache.includes('./ui/forge.js'));
});
test('Forge : activation forcée uniquement sur demande explicite',()=>{
  const w=worker();w.handlers.message({data:{type:'SKIP_WAITING'}});assert.equal(w.state.skipped,1);
});
test('Forge : un asset en cache ne dépend pas du réseau',async()=>{
  const w=worker(), cached={ok:true,tag:'same-build'};w.entries.set('https://colosse.example/app.js',cached);
  let promise;w.handlers.fetch({request:{url:'https://colosse.example/app.js',method:'GET'},respondWith:p=>promise=p});
  assert.equal(await promise,cached);assert.equal(w.state.network,0);
});
test('Forge : navigation hors ligne utilise le shell mis en cache',async()=>{
  const w=worker(),shell={ok:true,tag:'shell'};w.entries.set('./colosse-app.html',shell);let promise;
  w.handlers.fetch({request:{url:'https://colosse.example/unknown',method:'GET',mode:'navigate'},respondWith:p=>promise=p});assert.equal(await promise,shell);
});
test('Forge : aucune interception des liens externes ni des requêtes d’écriture',()=>{
  const w=worker();let handled=false;const respondWith=()=>handled=true;
  w.handlers.fetch({request:{url:'https://example.net/',method:'GET'},respondWith});w.handlers.fetch({request:{url:'https://colosse.example/data',method:'POST'},respondWith});assert.equal(handled,false);
});
