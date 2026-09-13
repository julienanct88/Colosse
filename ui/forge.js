/**
 * FORGE — couche de présentation, indépendante du moteur Colosse 3.6.0.
 * Aucune statistique fictive, aucun stockage ni prescription dans ce module.
 */
import { TRAINING_DAYS, STRENGTH_DAYS, getTrainingPhase, getExercisePlan } from '../program.js';
import { estimateSessionDuration } from '../engine/duration.js';
import { isoDate, addDays } from '../engine/math.js';
import { activityProgress } from '../engine/activity.js';
import { canCancelSession } from '../engine/session.js';
import { escapeHtml, formatKg, formatDateFr, formatClock } from './templates.js';

export const FORGE_UI_VERSION = '1.0.0';
const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  barbell: '<path d="m6.5 6.5 11 11M4 4l3-1 2 2-6 6-2-2 1-3m15 7 2-2 3 1 1 3-2 2-6-6ZM3 3l2 2m14 14 2 2"/>',
  chart: '<path d="M4 3v17h17M7 14l4-5 4 3 5-7"/>',
  weight: '<path d="M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M8 8a5 5 0 0 1 8 0l-4 4Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  timer: '<circle cx="12" cy="14" r="8"/><path d="M9 2h6m-3 0v4m0 5v4m6-10 2 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  note: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',
  tune: '<path d="M4 7h7m5 0h4M4 17h2m5 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  flame: '<path d="M12 3c1 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 3-6 0 3 1 4 2 4 2-3 3-6 2-10Z"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
};
export function icon(name, cls = '') {
  return `<svg class="f-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] ?? paths.grid}</svg>`;
}
export function renderForgeHeader(app) {
  const running = app.snapshot.sessions.some(s => s.execution?.active && !s.endedAt);
  return `<header class="topbar forge-topbar">
    <button class="f-brand" data-action="tab" data-tab="home" aria-label="Colosse, accueil"><span class="f-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>COLOSSE<span class="f-brand-edition">ADAPTIVE / FORGE</span></span></button>
    <button class="f-top-status" data-action="${running ? 'forge-resume' : 'forge-open'}" ${running ? '' : 'data-tab="settings" data-section="forge-data"'}>${running ? '<i class="f-live-dot"></i> En séance' : `${icon('shield')} Sur cet appareil`}</button>
  </header>`;
}
export function renderForgeNav(active) {
  const items = [['home','home','Accueil'],['training','barbell','Séance'],['weight','weight','Poids'],['history','chart','Progrès'],['tools','grid','Tout']];
  return `<nav class="bottom-nav forge-nav" aria-label="Navigation principale">${items.map(([id,ic,label]) => `<button class="nav-item ${active === id || (id === 'tools' && active === 'settings') ? 'active' : ''}" data-action="tab" data-tab="${id}" ${active === id || (id === 'tools' && active === 'settings') ? 'aria-current="page"' : ''}>${icon(ic)}<small>${label}</small></button>`).join('')}</nav>`;
}
export function renderForgeWeek(app, context) {
  const first = isoDate(app.viewWeekStart), last = isoDate(addDays(app.viewWeekStart,6));
  return `<section class="f-week" aria-label="Calendrier du programme">
    <div class="f-section-head"><h2>Ta semaine</h2><div class="f-week-controls"><button data-action="week-prev" aria-label="Semaine précédente">${icon('back')}</button><button data-action="week-today" class="f-week-range" aria-label="Revenir à cette semaine">${formatDateFr(first,{day:'numeric',month:'short'})} – ${formatDateFr(last,{day:'numeric',month:'short'})}</button><button data-action="week-next" aria-label="Semaine suivante">${icon('chevron')}</button></div></div>
    <div class="f-week-days">${TRAINING_DAYS.map(day => {
      const date=app.dayDate(day), s=app.snapshot.sessions.find(s=>s.id===`${date}:${day.id}`), done=s && app.isSessionComplete(s,day);
      return `<button class="f-week-day ${day.id===context.day.id?'is-active':''} ${date===isoDate()?'is-today':''} ${done?'is-done':''}" data-action="select-day" data-day="${day.id}" aria-label="${escapeHtml(formatDateFr(date,{weekday:'long',day:'numeric',month:'long'})+' · '+day.name+(done?' · terminée':''))}" aria-pressed="${day.id===context.day.id}"><span>${formatDateFr(date,{weekday:'short'}).slice(0,1).toUpperCase()}</span><strong>${Number(date.slice(-2))}</strong><i>${done?'✓':''}</i></button>`;
    }).join('')}</div></section>`;
}
export function renderForgeHome(app) {
  const c=app.currentContext(), {day, session, weekIndex}=c;
  const phase=getTrainingPhase(weekIndex), plan=estimateSessionDuration(day, ex=>getExercisePlan(ex,weekIndex));
  const sets=app.activeSetCount(session,day), running=app.snapshot.sessions.find(s=>s.execution?.active&&!s.endedAt);
  const completed=app.completedWeekSessions(), lastLog=[...app.snapshot.dailyLogs].filter(l=>Number.isFinite(l.weightKg)&&l.weightKg>0).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const todayLog=app.snapshot.dailyLogs.find(l=>l.date===isoDate()), activity=activityProgress(todayLog??{},app.snapshot.profile);
  const active=!!(session.execution?.active&&!session.endedAt);
  const dateLabel=c.date===isoDate()?'Aujourd’hui':formatDateFr(c.date,{weekday:'long',day:'numeric',month:'short'});
  return `<section class="f-home-intro"><span class="eyebrow">${escapeHtml(formatDateFr(isoDate(),{weekday:'long',day:'numeric',month:'long'}))}</span><h1>La force se<br>construit<span class="f-accent">.</span></h1><p>Une séance après l’autre.</p></section>
    ${running && running.id!==session.id ? `<button class="f-running-banner" data-action="forge-resume">${icon('play')} Une séance est en cours <span>Reprendre ${icon('arrow')}</span></button>` : ''}
    <section class="f-session-hero">
      <div class="f-hero-top"><span class="f-kicker">${escapeHtml(dateLabel)}</span><span class="f-pill">${active?'En cours':session.endedAt?'Enregistrée':'Au programme'}</span></div>
      <div class="f-hero-art" aria-hidden="true"><div></div><div></div><div></div></div>
      <h2>${escapeHtml(day.name)}</h2><p>${escapeHtml(day.focus)}</p>
      <div class="f-hero-metrics"><span>${icon('clock')} ${escapeHtml(plan.targetLabel??`${plan.minutes} min`)}</span><span>${icon('barbell')} ${day.exercises.length} exercices</span></div>
      <button class="f-cta" data-action="${active?'forge-resume':'forge-open'}" ${active?'':'data-tab="training"'}><span>${active?'Reprendre la séance':session.endedAt?'Voir ma séance':'Préparer ma séance'}</span>${icon('arrow')}</button>
      ${active&&canCancelSession(session)?'<button class="f-hero-cancel" data-action="cancel-session">↺ Annuler cette séance</button>':''}
      <div class="f-hero-foot"><span>Semaine ${weekIndex} <b>·</b> ${escapeHtml(phase.name)}</span>${sets.done?`<span>${sets.done}/${sets.total} séries</span>`:''}</div>
    </section>
    ${renderForgeWeek(app,c)}
    <section class="f-regularity"><div class="f-mini-icon">${icon('barbell')}</div><div><strong>Régularité</strong><span>${completed===0?'Chaque séance compte.':`${completed} séance${completed>1?'s':''} complète${completed>1?'s':''} cette semaine.`}</span></div><strong class="f-count">${completed}<small> / ${STRENGTH_DAYS.length}</small></strong><div class="f-streak-bars" aria-hidden="true">${STRENGTH_DAYS.map((_,i)=>`<i class="${i<completed?'filled':''}"></i>`).join('')}</div></section>
    <div class="f-section-head f-follow-head"><h2>Tes repères</h2><button class="text-button" data-action="tab" data-tab="weight">Tout voir ${icon('arrow')}</button></div>
    <section class="f-metric-grid"><button class="f-metric-card" data-action="forge-open" data-tab="weight" data-section="forge-checkin"><span>${icon('weight')} Dernière pesée</span><strong>${lastLog?formatKg(lastLog.weightKg,1):'—'}<small> kg</small></strong><p>${lastLog?formatDateFr(lastLog.date,{day:'numeric',month:'short'}):'Ajouter ma première pesée'} ${icon('plus')}</p></button><button class="f-metric-card" data-action="forge-open" data-tab="weight" data-section="forge-activity"><span>${icon('activity')} Activité du jour</span><strong>${activity.percent}<small> %</small></strong><p>${todayLog?.steps?`${Number(todayLog.steps).toLocaleString('fr-FR')} pas saisis`:'Pas et vélo à renseigner'} ${icon('chevron')}</p></button></section>
    <button class="f-checkin-link" data-action="forge-open" data-tab="weight" data-section="forge-checkin"><span class="f-mini-icon">${icon('note')}</span><span><strong>Ton check-in quotidien</strong><small>Poids, sommeil, nutrition et ressenti</small></span>${icon('arrow')}</button>
    <p class="f-local-note">${icon('shield')} Données locales. Pense à exporter ta sauvegarde.</p>`;
}
export const TOOL_GROUPS = [
  {name:'Entraînement', items:[
    ['training','','barbell','Ma séance','Programme complet, séries et variantes'],
    ['training','forge-readiness','activity','État du jour','Énergie, fatigue et sommeil'],
    ['training','forge-exercises','list','Exercices et variantes','Ordre, machines, technique et prescriptions'],
    ['training','forge-notes','note','Notes de séance','Ressenti et observations'],
    ['history','forge-history','chart','Historique des séances','Détail, volume et résultats'],
    ['history','forge-prescriptions','tune','Prochaines prescriptions','Charges conseillées par le moteur'],
  ]},
  {name:'Poids & récupération', items:[
    ['weight','forge-checkin','weight','Check-in quotidien','Poids, taille, calories, adhérence et sommeil'],
    ['weight','forge-activity','activity','Pas et vélo','Activité quotidienne et intensité'],
    ['weight','forge-chart','chart','Courbe de poids','Poids réel et trajectoire sur 28 jours'],
    ['weight','forge-targets','list','Objectifs hebdomadaires','Trajectoire et fourchettes de poids'],
    ['weight','forge-trend','tune','Bilan adaptatif','Analyse et ajustements caloriques'],
    ['weight','forge-checkins','note','Derniers check-ins','Retrouver les données saisies'],
    ['history','forge-adjustments','flame','Ajustements appliqués','Historique nutritionnel'],
  ]},
  {name:'Ton application', items:[
    ['settings','forge-profile','user','Profil et objectifs','Données de départ et durée de séance'],
    ['settings','forge-nutrition','flame','Nutrition et garde-fous','Calories, macros, pas et vélo'],
    ['settings','forge-preferences','tune','Préférences','Repos automatique, son et vibration'],
    ['settings','forge-data','download','Sauvegarde et restauration','Exporter / importer JSON, migration et effacement'],
  ]}
];
export function normalizeSearch(value) { return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
export function renderForgeTools() {
 return `<section class="f-tools-head"><span class="eyebrow">TOUS TES ACCÈS</span><h1>Rien ne se perd<span class="f-accent">.</span></h1><p>Le programme, le suivi et les réglages. Au même endroit.</p></section><label class="f-search">${icon('search')}<input type="search" id="forge-tool-search" placeholder="Rechercher une fonction…" aria-label="Rechercher une fonction" autocomplete="off"/></label><div class="f-tools-groups">${TOOL_GROUPS.map(group=>`<section class="f-tool-group"><h2>${group.name}</h2><div class="f-tool-list">${group.items.map(([tab,section,ic,label,desc])=>`<button class="f-tool" data-action="forge-open" data-tab="${tab}" data-section="${section}" data-tool-search="${escapeHtml(normalizeSearch(group.name+' '+label+' '+desc))}"><span class="f-tool-icon">${icon(ic)}</span><span><strong>${label}</strong><small>${desc}</small></span>${icon('chevron')}</button>`).join('')}</div></section>`).join('')}</div><p id="forge-no-results" class="empty-state" hidden>Aucun résultat. Essaie « poids », « variantes » ou « sauvegarde ».</p><p class="f-local-note">Interface Forge ${FORGE_UI_VERSION} · Moteur Colosse conservé.</p>`;
}
/** Native stepping with the real machine increment; no prescription is modified. */
export function steppedValue(current, delta, minimum=0) {
  const parsed=Number.parseFloat(String(current??'').replace(',','.'));
  const base=Number.isFinite(parsed)?parsed:0;
  return Math.max(minimum,Math.round((base+Number(delta))*1000)/1000);
}
/**
 * Démonstration : AUCUNE vidéo vérifiée n'existe dans le programme. On propose
 * donc une RECHERCHE YouTube, nommée comme telle, construite à partir du nom du
 * mouvement et de sa variante (jamais une URL inventée).
 */
export const DEMO_SEARCH_BASE = 'https://www.youtube.com/results?search_query=';
/** Matériel en français ; jamais répété s'il figure déjà dans le nom de la variante. */
export const EQUIPMENT_LABELS = { barbell: 'barre', cable: 'poulie', dumbbell: 'haltères', machine: 'machine', cardio: 'cardio' };
export function variantDisplay(variant) {
  if (!variant) return '';
  const materiel = EQUIPMENT_LABELS[variant.equipment] ?? variant.equipment ?? '';
  const deja = !materiel || normalizeSearch(variant.label).includes(normalizeSearch(materiel));
  return deja ? String(variant.label) : `${variant.label} · ${materiel}`;
}
export function demoSearch({ name, variantLabel = '', context = 'technique musculation' }) {
  const terms = [name, variantLabel && !String(name).toLowerCase().includes(String(variantLabel).toLowerCase()) ? variantLabel : '', context].filter(Boolean).join(' ');
  return { url: DEMO_SEARCH_BASE + encodeURIComponent(terms), label: 'Rechercher une démonstration', hint: 'Recherche YouTube · ouvre un nouvel onglet', terms };
}
export function renderDemoButton(demo, cls = '') {
  return `<a class="f-demo-button ${cls}" href="${escapeHtml(demo.url)}" target="_blank" rel="noopener noreferrer" data-demo-search="${escapeHtml(demo.terms)}">${icon('play')}<span><strong>${escapeHtml(demo.label)}</strong><small>${escapeHtml(demo.hint)}</small></span></a>`;
}
