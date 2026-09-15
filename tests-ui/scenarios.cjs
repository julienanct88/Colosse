// Usage : node tests-ui/scenarios.cjs <dossier de l'app> [port] [préfixe de scénario, ex. S4]
// Scénarios d'usage réels — ÉMULATION iPhone 15 (Chrome headless), pas un vrai iPhone.
// Données de test uniquement (profil jetable). Chaque clic testé passe par `toucher`,
// qui échoue si le bouton est masqué, hors écran ou recouvert.
const banc = require('./banc.cjs'); const { serveur, lancer, wait } = banc;
const toucher = async (page, sel, o) => { global.__etape = sel; if (process.env.TRACE) console.log('  →', sel); return banc.toucher(page, sel, o); };
const fs = require('fs'); const path = require('path'); const os = require('os');
const DOSSIER = process.argv[2]; const PORT = Number(process.argv[3] || 8860); const SEUL = process.argv[4] || null;
setTimeout(() => { console.log('WATCHDOG'); process.exit(2); }, 1500000);
const URL = `http://127.0.0.1:${PORT}/colosse-app.html`;
const resultats = [];
function attendu(cond, msg) { if (!cond) throw new Error(msg); }

// ---------- outils
const lireBase = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); x.onerror = () => rej(x.error); });
  const all = async (s) => new Promise((r) => { const t = db.transaction(s, 'readonly'); const g = t.objectStore(s).getAll(); g.onsuccess = () => r(g.result); });
  const out = { sessions: await all('sessions'), settings: (await all('settings'))[0]?.value ?? {}, dailyLogs: await all('dailyLogs') };
  db.close(); return out;
});
const seanceDu = async (page, dayId) => { const b = await lireBase(page); return b.sessions.filter((s) => s.dayId === dayId).sort((a, c) => (c.updatedAt || 0) - (a.updatedAt || 0))[0]; };
const etape = (page) => page.evaluate(() => ({
  titre: document.querySelector('.execution .exec-title')?.textContent?.trim() ?? null,
  sous: document.querySelector('.execution .exec-sub, .execution .f-work-kicker')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  serie: document.body.innerText.match(/Série \d+ sur \d+/)?.[0] ?? null,
  cote: document.querySelector('.execution .exec-side')?.textContent?.trim() ?? null,
  eyebrow: document.querySelector('.execution .exec-eyebrow')?.textContent?.trim() ?? null,
  guide: !!document.querySelector('.execution'), liste: !!document.querySelector('.exercise-list'),
}));
async function ouvrir(page) { await page.goto(URL, { waitUntil: 'load' }); await wait(2200); }
async function allerJour(page, dayId) {
  if (await page.evaluate(() => !!document.querySelector('.execution'))) await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
  if (!(await page.evaluate(() => document.querySelector('.bottom-nav [data-tab="training"]')?.getAttribute('aria-current') === 'page'))) await toucher(page, '.bottom-nav [data-tab="training"]');
  await page.evaluate(() => window.scrollTo(0, 0));
  await toucher(page, `[data-action="select-day"][data-day="${dayId}"]`);
}
// Préparation rapide (non testée) : passe échauffement/activations/rampes jusqu'à la série.
async function jusquASerie(page, { reference = '80' } = {}) {
  for (let i = 0; i < 30; i++) {
    const e = await page.evaluate(() => ({ timer: !!document.querySelector('.timer-overlay [data-action="timer-skip"]'), warm: !!document.querySelector('[data-action="exec-skip-general-warmup"]'), act: !!document.querySelector('[data-action="exec-validate-activation"]'), ref: !!document.querySelector('#exec-reference-load'), ramp: !!document.querySelector('[data-action="exec-validate-ramp"]'), serie: !!document.querySelector('[data-exec-field="reps"]') }));
    if (e.serie && !e.timer) return;
    if (e.timer) { await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]').click()); await wait(350); continue; }
    if (e.warm) { await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450); continue; }
    if (e.act) { await page.evaluate(() => document.querySelector('[data-action="exec-validate-activation"]').click()); await wait(350); continue; }
    if (e.ref) { await page.fill('#exec-reference-load', reference); await page.evaluate(() => document.querySelector('[data-action="exec-set-reference"]').click()); await wait(450); continue; }
    if (e.ramp) { await page.evaluate(() => document.querySelector('[data-action="exec-validate-ramp"]').click()); await wait(350); continue; }
    await wait(300);
  }
  throw new Error('série de travail non atteinte');
}

// ---- 3.6.3 : outils pour rejouer des données « comme sur le téléphone » (profil jetable)
const aujourdHuiIso = (page) => page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
async function ecrireBase(page, { profil = null, sessions = [], supprimerChampsProfil = [] } = {}) {
  await page.evaluate(async ({ profil, sessions, supprimerChampsProfil }) => {
    const db = await new Promise((res) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); });
    const t = db.transaction(['profile', 'sessions'], 'readwrite');
    const store = t.objectStore('profile');
    const actuel = await new Promise((r) => { const g = store.get('profile'); g.onsuccess = () => r(g.result); });
    const value = { ...(actuel?.value ?? {}), ...(profil ?? {}) };
    for (const champ of supprimerChampsProfil) delete value[champ];
    store.put({ id: 'profile', value });
    for (const session of sessions) t.objectStore('sessions').put(session);
    await new Promise((r) => { t.oncomplete = r; });
    db.close();
  }, { profil, sessions, supprimerChampsProfil });
}
const lireProfil = (page) => page.evaluate(async () => {
  const db = await new Promise((res) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); });
  const v = await new Promise((r) => { const g = db.transaction('profile').objectStore('profile').get('profile'); g.onsuccess = () => r(g.result?.value); });
  db.close(); return v;
});
/** Séance de test construite à partir de la séance que l'app crée elle-même pour ce jour. */
async function modeleSeance(page, dayId) {
  await allerJour(page, dayId);
  return (await lireBase(page)).sessions.filter((x) => x.dayId === dayId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
}
async function passerActivations(page) {
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(() => !!document.querySelector('.timer-overlay [data-action="timer-skip"]'))) { await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]').click()); await wait(350); continue; }
    if (await page.evaluate(() => !!document.querySelector('[data-action="exec-validate-activation"]'))) { await page.evaluate(() => document.querySelector('[data-action="exec-validate-activation"]').click()); await wait(350); continue; }
    return;
  }
}
async function saisirEtValider(page, { kg, reps, rir = 2 }) {
  if (kg !== undefined && await page.evaluate(() => !!document.querySelector('[data-exec-field="weightKg"]'))) await page.fill('[data-exec-field="weightKg"]', String(kg));
  await page.fill('[data-exec-field="reps"]', String(reps));
  await toucher(page, `[data-exec-field="rir"][data-value="${rir}"]`);
  await toucher(page, '[data-action="exec-validate-set"]');
}
async function demarrer(page, dayId) { await allerJour(page, dayId); await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]'); }

async function scenario(nom, fn) {
  if (SEUL && !nom.startsWith(SEUL)) return;
  const env = await lancer(); const { ctx, page, erreurs } = env;
  let dialogues = 'accepter'; const vus = [];
  page.removeAllListeners('dialog');
  page.on('dialog', async (d) => { vus.push(d.message()); if (dialogues === 'refuser') await d.dismiss(); else await d.accept(); });
  const t0 = Date.now();
  try {
    await ouvrir(page);
    const detail = await Promise.race([fn({ page, ctx, env, setDialogues: (v) => { dialogues = v; }, dialoguesVus: vus }), new Promise((_, rej) => setTimeout(() => rej(new Error('DÉLAI DÉPASSÉ après étape : ' + global.__etape)), 150000))]);
    attendu(erreurs.length === 0, 'erreurs JavaScript : ' + erreurs.join(' | '));
    resultats.push({ nom, ok: true, detail: detail ?? '', s: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    resultats.push({ nom, ok: false, detail: String(e.message ?? e).slice(0, 400), s: Math.round((Date.now() - t0) / 1000) });
    try { await page.screenshot({ path: path.join(os.tmpdir(), 'colosse-echec_' + nom.slice(0, 3).replace(/\W/g, '') + '.png') }); } catch {}
  } finally { await ctx.close().catch(() => {}); }
  const r = resultats.at(-1); console.log(`${r.ok ? 'OK ' : 'KO '} ${r.nom} (${r.s}s) — ${r.detail}`);
}

(async () => {
  const srv = await serveur(DOSSIER, PORT);

  // ---------------------------------------------------------------- 1. VÉLO
  await scenario('S1 Vélo : choix, mémorisation, rechargement, choix ponctuel', async ({ page }) => {
    await demarrer(page, 'push-a');
    let e = await etape(page); attendu(/ÉCHAUFFEMENT/.test(e.eyebrow ?? ''), 'pas sur l’échauffement : ' + JSON.stringify(e));
    await toucher(page, '[data-action="warmup-equipment"][data-equipment="bike"]');
    let txt = await page.evaluate(() => document.querySelector('.exec-warmup').innerText);
    attendu(/Vélo/.test(txt) && !/km\/h|inclinaison/.test(txt), 'écran vélo incorrect : ' + txt.replace(/\s+/g, ' ').slice(0, 160));
    await toucher(page, '[data-action="warmup-equipment-default"]');
    let base = await lireBase(page); attendu(base.settings.warmupEquipment === 'bike', 'préférence non mémorisée');
    await page.reload({ waitUntil: 'load' }); await wait(2200);
    txt = await page.evaluate(() => document.querySelector('.exec-warmup')?.innerText ?? '');
    attendu(/Vélo : ton choix habituel/.test(txt.replace(/\s+/g, ' ')), 'après rechargement, vélo non présélectionné : ' + txt.replace(/\s+/g, ' ').slice(0, 160));
    await toucher(page, '[data-action="exec-start-general-warmup"]');
    let s = await seanceDu(page, 'push-a');
    attendu(s.warmup.general.equipment === 'bike' && s.activeTimer?.kind === 'general-warmup', 'matériel non noté au démarrage : ' + JSON.stringify(s.warmup.general));
    attendu(await page.evaluate(() => document.querySelector('[data-action="warmup-equipment"]')?.disabled === true), 'choix modifiable pendant le chrono');
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    s = await seanceDu(page, 'push-a');
    attendu(s.warmup.general.equipment === 'bike' && s.warmup.general.skipped === true && s.activeTimer === null, 'échauffement interrompu mal enregistré : ' + JSON.stringify(s.warmup.general));
    // Choix ponctuel : autre séance, tapis cette fois, sans toucher à la préférence
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]'); await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '[data-action="finish-session"]');
    await demarrer(page, 'legs-a');
    txt = await page.evaluate(() => document.querySelector('.exec-warmup').innerText.replace(/\s+/g, ' '));
    attendu(/Vélo : ton choix habituel/.test(txt), 'nouvelle séance ne propose pas le vélo');
    await toucher(page, '[data-action="warmup-equipment"][data-equipment="treadmill"]');
    txt = await page.evaluate(() => document.querySelector('.exec-warmup').innerText.replace(/\s+/g, ' '));
    attendu(/km\/h/.test(txt) && /Mémoriser « Tapis »/.test(txt), 'tapis ponctuel mal affiché');
    base = await lireBase(page);
    attendu(base.settings.warmupEquipment === 'bike', 'le choix ponctuel a modifié la préférence');
    return 'vélo mémorisé, rechargé, noté sur l’échauffement ; tapis ponctuel sans changer la préférence';
  });

  // ---------------------------------------------------------------- 2. FICHES ET DÉMONSTRATIONS
  await scenario('S2 Fiches et démonstrations sur chaque type d’étape, sans modifier la séance', async ({ page, ctx }) => {
    await demarrer(page, 'push-a');
    const verifierFiche = async (selecteur, attenduTitre) => {
      const avant = JSON.stringify(await seanceDu(page, 'push-a'));
      await toucher(page, selecteur);
      const fiche = await page.evaluate(() => { const s = document.querySelector('.f-exercise-sheet'); return s ? { titre: s.querySelector('.f-sheet-title')?.textContent, texte: s.innerText.replace(/\s+/g, ' '), demo: s.querySelector('a.f-demo-button')?.href, label: s.querySelector('a.f-demo-button')?.innerText.replace(/\s+/g, ' ') } : null; });
      attendu(fiche, 'fiche non ouverte via ' + selecteur);
      attendu(!attenduTitre || fiche.titre.includes(attenduTitre), `fiche « ${fiche.titre} » au lieu de « ${attenduTitre} »`);
      attendu(/Rechercher une démonstration/.test(fiche.label) && /Recherche YouTube/.test(fiche.label) && /youtube\.com\/results\?search_query=/.test(fiche.demo), 'démo non présentée comme une recherche : ' + fiche.label);
      await toucher(page, '.f-exercise-sheet [data-action="exercise-sheet-close"]');
      const apres = JSON.stringify(await seanceDu(page, 'push-a'));
      attendu(avant === apres, 'consulter la fiche a modifié la séance');
      return fiche;
    };
    // échauffement général : démonstration
    attendu(await page.evaluate(() => /Rechercher une démonstration/.test(document.querySelector('.exec-warmup a.f-demo-button')?.innerText ?? '')), 'pas de démo sur l’échauffement');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(500);
    // activation
    const fa = await verifierFiche('.exec-card [data-action="activation-view"]');
    attendu(/ACTIVATION/.test(fa.texte), 'fiche activation incorrecte');
    for (let i = 0; i < 20; i++) { if (await page.evaluate(() => !!document.querySelector('.timer-overlay [data-action="timer-skip"]'))) { await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]').click()); await wait(300); continue; } if (await page.evaluate(() => !!document.querySelector('[data-action="exec-validate-activation"]'))) { await page.evaluate(() => document.querySelector('[data-action="exec-validate-activation"]').click()); await wait(350); continue; } break; }
    // 3.6.3 : directement la série 1 (plus d'écran « charge de référence »), échauffement proposé
    attendu(await page.evaluate(() => !document.querySelector('#exec-reference-load') && !!document.querySelector('.exec-work [data-exec-field="reps"]')), 'la série 1 n’est pas affichée directement');
    const fr = await verifierFiche('.exec-work [data-action="exercise-view"]', 'Développé incliné Smith');
    attendu(/Consignes essentielles/.test(fr.texte) && /Banc à 20-30°/.test(fr.texte), 'consignes absentes de la fiche');
    attendu(decodeURIComponent(fr.demo).includes('Développé incliné Smith Smith') === false && decodeURIComponent(fr.demo).includes('Développé incliné Smith'), 'recherche démo incohérente : ' + decodeURIComponent(fr.demo));
    await page.fill('[data-exec-field="weightKg"]', '80');
    await toucher(page, '.exec-work [data-action="exec-start-ramps"]');
    // montée en charge demandée
    attendu(await page.evaluate(() => /Banc à 20-30°/.test(document.querySelector('.exec-ramp .f-cue-visible')?.textContent ?? '')), 'consigne invisible sur la montée en charge');
    await verifierFiche('.exec-ramp [data-action="exercise-view"]', 'Développé incliné Smith');
    attendu(await page.evaluate(() => window.__atteindre(document.querySelector('.exec-ramp [data-action="exec-skip-ramps"]')).ok), '« Aller directement aux séries » non utilisable');
    attendu(/32\.5 kg|32 kg/.test(await page.evaluate(() => document.querySelector('.exec-ramp .exec-huge')?.textContent ?? '')), 'montée calculée sur une autre charge que 80 kg');
    await jusquASerie(page);
    // série de travail : consigne visible hors « Technique & douleur »
    attendu(await page.evaluate(() => { const c = document.querySelector('.exec-work .f-cue-visible'); return !!c && !c.closest('details') && window.__atteindre(c).ok; }), 'consigne de la série non visible');
    // ouvrir la démonstration réelle (nouvel onglet) avec une saisie en cours, puis revenir
    await page.fill('[data-exec-field="reps"]', '7');
    const [onglet] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }), toucher(page, '.exec-work a.f-demo-button')]);
    const adresse = onglet.url(); await onglet.close();
    attendu(/youtube\.com\/results\?search_query=/.test(adresse), 'onglet démo inattendu : ' + adresse);
    await page.bringToFront(); await wait(300);
    attendu(await page.evaluate(() => document.querySelector('[data-exec-field="reps"]').value) === '7', 'saisie perdue après la démonstration');
    await verifierFiche('.exec-work [data-action="exercise-view"]', 'Développé incliné Smith');
    attendu(await page.evaluate(() => document.querySelector('[data-exec-field="reps"]').value) === '7', 'saisie perdue après la fiche');
    return 'échauffement, activation, référence, montée en charge et série : fiche + recherche YouTube, séance inchangée, saisie conservée';
  });

  // ---------------------------------------------------------------- 3+4. CONSULTER UN AUTRE EXERCICE / FAIRE MAINTENANT
  await scenario('S3 Consulter un exercice plus bas puis « Faire maintenant » démarre le bon exercice', async ({ page }) => {
    await demarrer(page, 'push-a'); await jusquASerie(page);
    await saisirEtValider(page, { kg: 80, reps: 8 });
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(400);
    await page.fill('[data-exec-field="reps"]', '6');
    const avant = await seanceDu(page, 'push-a');
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    // consulter le 6e exercice sans rien changer
    await toucher(page, '[data-exercise-card="push-a-triceps-overhead"] [data-action="exercise-view"]');
    await toucher(page, '.f-exercise-sheet [data-action="exercise-sheet-close"]');
    attendu(JSON.stringify(await seanceDu(page, 'push-a')) === JSON.stringify(avant), 'consultation a modifié la séance');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="exec-resume"]');
    let e = await etape(page);
    attendu(e.titre === 'Développé incliné Smith' && e.serie === 'Série 2 sur 4', 'retour pas à la même étape : ' + JSON.stringify(e));
    attendu(await page.evaluate(() => document.querySelector('[data-exec-field="reps"]').value) === '6', 'brouillon perdu au retour');
    // Faire maintenant : exercice plus bas
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="push-a-triceps-overhead"] [data-action="exercise-do-now"]');
    e = await etape(page);
    const s = await seanceDu(page, 'push-a');
    const titre = await page.evaluate(() => document.querySelector('.execution .exec-title, .execution h2')?.textContent);
    attendu(/Extension triceps/.test(titre ?? ''), 'le mode guidé n’a pas démarré l’exercice choisi : ' + titre);
    attendu(s.exercises['push-a-incline-smith'].sets.filter((x) => x.done).length === 1, 'séries du Smith perdues');
    attendu(!s.exercises['push-a-incline-smith'].skipped, 'Smith marqué passé');
    attendu(s.exercises['push-a-incline-smith'].variantId === avant.exercises['push-a-incline-smith'].variantId, 'variante modifiée');
    attendu(s.exerciseOrder.indexOf('push-a-triceps-overhead') < s.exerciseOrder.indexOf('push-a-incline-smith'), 'ordre non modifié');
    attendu(!(await lireBase(page)).settings.dayOrders?.['push-a'], 'ordre par défaut modifié sans demande');
    return `« ${titre} » démarré ; Smith garde 1/4 séries, non passé, même variante ; ordre par défaut intact`;
  });

  // ---------------------------------------------------------------- 5+6. RÉORGANISATION ET BROUILLONS
  await scenario('S4 Réorganiser avant et pendant la séance, reprise d’un exercice partiel avec brouillons après rechargement', async ({ page }) => {
    await allerJour(page, 'push-a');
    // avant : Modifier l'ordre directement (flèche)
    await toucher(page, '.f-session-tools [data-action="exec-reorder"]');
    await toucher(page, '.sheet [data-drag-item="push-a-lateral"] [data-direction="up"]');
    await toucher(page, '.sheet [data-action="reorder-close"]');
    let s = await seanceDu(page, 'push-a');
    attendu(s.exerciseOrder.indexOf('push-a-lateral') === 3, 'flèche monter sans effet : ' + s.exerciseOrder.join(','));
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    await jusquASerie(page);
    await saisirEtValider(page, { kg: 80, reps: 8 }); await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(350);
    await saisirEtValider(page, { kg: 80, reps: 7 }); await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(350);
    // brouillon de la série 3 non validée
    await page.fill('[data-exec-field="weightKg"]', '82.5'); await page.fill('[data-exec-field="reps"]', '6'); await toucher(page, '[data-exec-field="rir"][data-value="1"]');
    // pendant : glisser Chest press en tête dans le panneau (doigt)
    await toucher(page, '.f-exec-tools [data-action="exec-reorder"]');
    const h = await page.evaluate(() => { const r = document.querySelector('.sheet [data-drag-item="push-a-chest-press"] [data-drag-handle]').getBoundingClientRect(); const t = document.querySelector('.sheet [data-drag-item]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cible: t.top + 5 }; });
    await page.evaluate(({ x, y, cible }) => { const el = document.querySelector('.sheet [data-drag-item="push-a-chest-press"] [data-drag-handle]'); const ev = (t, cy) => new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: cy, pointerId: 9, pointerType: 'touch', isPrimary: true }); el.dispatchEvent(ev('pointerdown', y)); let cy = y; const pas = (y - cible) / 12; for (let i = 0; i < 12; i++) { cy -= pas; window.dispatchEvent(ev('pointermove', cy)); } window.dispatchEvent(ev('pointerup', cy)); }, h);
    await wait(700); await toucher(page, '.sheet [data-action="reorder-close"]');
    s = await seanceDu(page, 'push-a');
    attendu(s.exerciseOrder.indexOf('push-a-chest-press') < s.exerciseOrder.indexOf('push-a-incline-smith'), 'glisser au doigt sans effet : ' + s.exerciseOrder.join(','));
    attendu(s.exercises['push-a-incline-smith'].sets.filter((x) => x.done).length === 2, 'séries perdues pendant la réorganisation');
    // Faire maintenant Chest press, saisir un brouillon dessus
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="push-a-chest-press"] [data-action="exercise-do-now"]');
    await jusquASerie(page, { reference: '60' });
    await page.fill('[data-exec-field="reps"]', '11');
    // FERMETURE de l'app puis réouverture
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    let titre = await page.evaluate(() => document.querySelector('.execution h2')?.textContent);
    attendu(/Chest press/.test(titre ?? ''), 'reprise après rechargement sur le mauvais exercice : ' + titre);
    attendu(await page.evaluate(() => document.querySelector('[data-exec-field="reps"]').value) === '11', 'brouillon Chest press perdu au rechargement');
    // retour au Smith partiellement fait
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="push-a-incline-smith"] [data-action="exercise-do-now"]');
    const e = await etape(page);
    attendu(e.serie === 'Série 3 sur 4', 'reprise du Smith pas en série 3/4 : ' + JSON.stringify(e));
    const b = await page.evaluate(() => ({ kg: document.querySelector('[data-exec-field="weightKg"]').value, reps: document.querySelector('[data-exec-field="reps"]').value, rir: document.querySelector('[data-exec-group="rir"] .chip-choice.selected')?.dataset.value }));
    attendu(b.kg === '82.5' && b.reps === '6' && b.rir === '1', 'brouillon du Smith non récupéré : ' + JSON.stringify(b));
    s = await seanceDu(page, 'push-a');
    attendu(s.exercises['push-a-incline-smith'].sets.filter((x) => x.done).length === 2, 'le brouillon a été compté comme série');
    attendu(s.exercises['push-a-chest-press'].sets.filter((x) => x.done).length === 0 && !s.exercises['push-a-chest-press'].skipped, 'Chest press modifié');
    return 'ordre changé avant/pendant (flèche + doigt), 2 séries conservées, Smith repris en 3/4 avec 82,5 kg × 6 RIR 1 après rechargement, brouillons non comptés';
  });

  // ---------------------------------------------------------------- 7. CHRONO PENDANT LA CONSULTATION
  await scenario('S5 Consultation pendant un repos : le chrono garde son propriétaire ; transition explicite', async ({ page, setDialogues, dialoguesVus }) => {
    await demarrer(page, 'push-a'); await jusquASerie(page);
    await saisirEtValider(page, { kg: 80, reps: 8 });
    let s = await seanceDu(page, 'push-a'); const t = s.activeTimer;
    attendu(t?.kind === 'work-rest' && t.context.exerciseId === 'push-a-incline-smith', 'repos non lancé');
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="push-a-lateral"] [data-action="exercise-view"]');
    await toucher(page, '.f-exercise-sheet [data-action="exercise-sheet-close"]');
    s = await seanceDu(page, 'push-a');
    attendu(JSON.stringify(s.activeTimer) === JSON.stringify(t), 'le chrono a changé pendant la consultation');
    attendu(await page.evaluate(() => !!document.querySelector('.timer-overlay')), 'chrono plus affiché');
    // Faire maintenant pendant le repos : refus de la confirmation => rien ne change
    setDialogues('refuser');
    await toucher(page, '[data-exercise-card="push-a-lateral"] [data-action="exercise-do-now"]');
    s = await seanceDu(page, 'push-a');
    attendu(JSON.stringify(s.activeTimer) === JSON.stringify(t) && s.exerciseOrder[0] === 'push-a-incline-smith', 'refuser la transition a quand même modifié la séance');
    attendu(/Un repos est en cours/.test(dialoguesVus.at(-1) ?? ''), 'pas d’explication du conflit : ' + dialoguesVus.at(-1));
    // accepter : le repos s'arrête SUR le Smith (durée réelle), rien n'est réaffecté
    setDialogues('accepter');
    await toucher(page, '[data-exercise-card="push-a-lateral"] [data-action="exercise-do-now"]');
    s = await seanceDu(page, 'push-a');
    attendu(s.activeTimer === null, 'chrono réaffecté ou non arrêté : ' + JSON.stringify(s.activeTimer));
    attendu(Number.isFinite(s.exercises['push-a-incline-smith'].sets[0].restActualSec), 'repos réel non enregistré sur la série du Smith');
    const titre = await page.evaluate(() => document.querySelector('.execution h2')?.textContent);
    attendu(/Élévations latérales/.test(titre ?? ''), 'mauvais exercice démarré : ' + titre);
    // pendant ce nouvel exercice, un repos lui appartient bien
    await saisirEtValider(page, { kg: 10, reps: 15 });
    s = await seanceDu(page, 'push-a');
    attendu(s.activeTimer?.context?.exerciseId === 'push-a-lateral', 'repos suivant mal attribué');
    return 'fiche consultée sans toucher au chrono ; transition refusée = rien ; acceptée = repos arrêté sur le Smith (restActualSec) puis latérales';
  });

  // ---------------------------------------------------------------- 8. GAUCHE/DROITE, CHRONOMÉTRÉ, VARIANTE, FERMETURE
  await scenario('S6 Gauche/droite avec brouillons par côté, refus pendant le changement de côté, reprise après fermeture', async ({ page, env }) => {
    await demarrer(page, 'legs-a');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="legs-a-bulgarian"] [data-action="exercise-do-now"]');
    let e = await etape(page); attendu(e.cote === 'CÔTÉ GAUCHE' && e.serie === 'Série 1 sur 3', 'pas sur fentes côté gauche : ' + JSON.stringify(e));
    await page.fill('[data-exec-field="weightKg"]', '20'); await page.fill('[data-exec-field="reps"]', '12'); await toucher(page, '[data-exec-field="rir"][data-value="2"]');
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    attendu(await page.evaluate(() => document.querySelector('[data-exec-field="reps"]').value) === '12', 'brouillon gauche perdu au rechargement');
    await toucher(page, '[data-action="exec-validate-set"]');
    let s = await seanceDu(page, 'legs-a');
    attendu(s.activeTimer?.kind === 'side-switch', 'pas de changement de côté');
    // Faire maintenant pendant le changement de côté : refusé avec explication
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="legs-a-leg-ext"] [data-action="exercise-do-now"]');
    const toast = await page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
    attendu(/Termine d’abord le côté droit de Fentes bulgares/.test(toast), 'pas d’explication pendant le changement de côté : ' + toast);
    s = await seanceDu(page, 'legs-a');
    attendu(s.activeTimer?.kind === 'side-switch' && s.exerciseOrder.indexOf('legs-a-leg-ext') > s.exerciseOrder.indexOf('legs-a-bulgarian'), 'le refus a modifié la séance');
    // 3.6.3 : le refus ramène sur l'étape en cours (mode guidé), pas sur la liste repliée
    attendu((await etape(page)).guide, 'le refus laisse sur la liste');
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    e = await etape(page); attendu(e.cote === 'CÔTÉ DROIT', 'pas passé au côté droit');
    // brouillon côté droit (préremplissage d'origine = valeurs du gauche), rechargement
    await page.fill('[data-exec-field="reps"]', '10'); await toucher(page, '[data-exec-field="rir"][data-value="1"]');
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    e = await etape(page); attendu(e.cote === 'CÔTÉ DROIT' && e.serie === 'Série 1 sur 3', 'rechargement : pas sur le côté droit : ' + JSON.stringify(e));
    const d = await page.evaluate(() => ({ reps: document.querySelector('[data-exec-field="reps"]').value, rir: document.querySelector('[data-exec-group="rir"] .chip-choice.selected')?.dataset.value }));
    attendu(d.reps === '10' && d.rir === '1', 'brouillon droit non récupéré : ' + JSON.stringify(d));
    s = await seanceDu(page, 'legs-a');
    attendu(s.exercises['legs-a-bulgarian'].sets[0].sides.left.reps === 12 && !s.exercises['legs-a-bulgarian'].sets[0].done, 'le brouillon droit a modifié le côté gauche ou validé la série');
    await saisirEtValider(page, { kg: 20, reps: 10, rir: 1 });
    s = await seanceDu(page, 'legs-a');
    const set = s.exercises['legs-a-bulgarian'].sets[0];
    attendu(set.done && set.sides.left.reps === 12 && set.sides.right.reps === 10, 'série unilatérale incorrecte : ' + JSON.stringify(set.sides));
    // fermeture complète (nouveau contexte, même profil)
    await env.ctx.close(); const env2 = await lancer(env.dir); env.ctx = env2.ctx;
    await env2.page.goto(URL, { waitUntil: 'load' }); await wait(2500);
    const titre = await env2.page.evaluate(() => ({ t: document.querySelector('.execution h2')?.textContent, serie: document.body.innerText.match(/Série \d+ sur \d+/)?.[0], cote: document.querySelector('.exec-side')?.textContent }));
    attendu(/Fentes bulgares/.test(titre.t ?? '') && titre.serie === 'Série 2 sur 3' && titre.cote === 'CÔTÉ GAUCHE', 'reprise après fermeture incorrecte : ' + JSON.stringify(titre));
    return 'gauche 12 (brouillon rechargé) → changement refusé expliqué → droite 10 (brouillon rechargé, gauche intact) ; après fermeture : fentes série 2/3 côté gauche';
  });

  await scenario('S7 Exercice chronométré (gainage) et changement de variante explicite, conservé par « Faire maintenant »', async ({ page }) => {
    await demarrer(page, 'legs-b');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="legs-b-plank"] [data-action="exercise-do-now"]');
    const lab = await page.evaluate(() => document.querySelector('.exec-work')?.innerText.replace(/\s+/g, ' '));
    attendu(/Durée · secondes/i.test(lab ?? '') && !(await page.evaluate(() => !!document.querySelector('[data-exec-field="weightKg"]'))), 'gainage mal présenté : ' + (lab ?? '').slice(0, 120));
    await saisirEtValider(page, { reps: 45, rir: 2 });
    let s = await seanceDu(page, 'legs-b');
    attendu(s.exercises['legs-b-plank'].sets[0].done && s.exercises['legs-b-plank'].sets[0].reps === 45, 'gainage non enregistré');
    // variante : changer explicitement dans les détails d'un exercice non commencé
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(350);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="legs-b-rdl"] details.f-exercise-detail > summary');
    const avant = (await seanceDu(page, 'legs-b')).exercises['legs-b-rdl'].variantId;
    await page.selectOption('[data-exercise-variant="legs-b-rdl"]', 'rdl-db');
    await wait(700);
    s = await seanceDu(page, 'legs-b');
    attendu(s.exercises['legs-b-rdl'].variantId === 'rdl-db' && avant !== 'rdl-db', 'variante non changée');
    const carte = await page.evaluate(() => document.querySelector('[data-exercise-card="legs-b-rdl"] .f-card-variant')?.textContent);
    attendu(/Haltères/.test(carte ?? ''), 'la carte n’affiche pas la nouvelle variante : ' + carte);
    attendu(s.exercises['legs-b-plank'].sets[0].done, 'changer une variante a touché un autre exercice');
    // « Faire maintenant » ne change pas la variante
    await toucher(page, '[data-exercise-card="legs-b-rdl"] [data-action="exercise-do-now"]');
    s = await seanceDu(page, 'legs-b');
    attendu(s.exercises['legs-b-rdl'].variantId === 'rdl-db', 'Faire maintenant a changé la variante');
    return `gainage 45 s enregistré ; variante ${avant} → rdl-db explicite ; Faire maintenant la conserve`;
  });

  // ---------------------------------------------------------------- 9. EXPORT / IMPORT
  await scenario('S8 Export puis import dans un appareil vierge (données de test)', async ({ page }) => {
    await demarrer(page, 'push-a'); await jusquASerie(page); await saisirEtValider(page, { kg: 80, reps: 8 });
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(350);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '.bottom-nav [data-tab="tools"]');
    await toucher(page, '.f-tool[data-action="forge-open"][data-section="forge-data"]');
    const telechargement = page.waitForEvent('download', { timeout: 8000 });
    await toucher(page, '[data-action="export-data"]');
    const dl = await telechargement; const fichier = path.join(os.tmpdir(), 'colosse-test-export.json'); await dl.saveAs(fichier);
    const data = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    attendu(data.sessions.some((x) => x.exercises?.['push-a-incline-smith']?.sets?.[0]?.done), 'export sans la série');
    const env2 = await lancer(); const dialogues2 = []; env2.page.on('dialog', (d) => dialogues2.push(d.message()));
    await env2.page.goto(URL, { waitUntil: 'load' }); await wait(2200);
    await toucher(env2.page, '.bottom-nav [data-tab="tools"]');
    await toucher(env2.page, '.f-tool[data-action="forge-open"][data-section="forge-data"]');
    const [choix] = await Promise.all([env2.page.waitForEvent('filechooser', { timeout: 8000 }), toucher(env2.page, '[data-action="import-data"]')]);
    await choix.setFiles(fichier); await wait(2000);
    const b2 = await lireBase(env2.page);
    await env2.ctx.close();
    attendu(dialogues2.some((m) => /importation remplace toutes les données/.test(m)), 'aucune confirmation avant import : ' + JSON.stringify(dialogues2));
    attendu(b2.sessions.some((x) => x.exercises?.['push-a-incline-smith']?.sets?.[0]?.done && x.exercises['push-a-incline-smith'].sets[0].weightKg === 80), 'import sans la série');
    return `${data.sessions.length} séance(s) exportée(s) → importées dans un profil vierge`;
  });

  // ---------------------------------------------------------------- 10. HISTORIQUES DE VARIANTES
  await scenario('S9 Historiques de variantes séparés : la fiche ne mélange pas barre et haltères', async ({ page }) => {
    await allerJour(page, 'legs-b');
    // Séance PASSÉE de test (profil jetable) : RDL à la barre 100 kg × 8, écrite comme l'app l'écrit.
    await page.evaluate(async () => {
      const db = await new Promise((res) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); });
      const tous = await new Promise((r) => { const g = db.transaction('sessions').objectStore('sessions').getAll(); g.onsuccess = () => r(g.result); });
      const modele = tous.find((x) => x.dayId === 'legs-b');
      const passe = JSON.parse(JSON.stringify(modele));
      passe.id = '2026-01-05:legs-b'; passe.date = '2026-01-05'; passe.startedAt = Date.parse('2026-01-05T18:00:00'); passe.endedAt = passe.startedAt + 3600e3;
      passe.exercises['legs-b-rdl'].variantId = 'rdl-barbell';
      Object.assign(passe.exercises['legs-b-rdl'].sets[0], { done: true, weightKg: 100, reps: 8, rir: 2, technique: 'good', pain: 0, completedAt: passe.startedAt + 600e3 });
      await new Promise((r) => { const t = db.transaction('sessions', 'readwrite'); t.objectStore('sessions').put(passe); t.oncomplete = r; });
      db.close();
    });
    await page.reload({ waitUntil: 'load' }); await wait(2200);
    await allerJour(page, 'legs-b');
    const fiche = async () => { await toucher(page, '[data-exercise-card="legs-b-rdl"] [data-action="exercise-view"]'); const t = await page.evaluate(() => document.querySelector('.f-exercise-sheet').innerText.replace(/\s+/g, ' ')); await toucher(page, '.f-exercise-sheet [data-action="exercise-sheet-close"]'); return t; };
    const s1 = (await seanceDu(page, 'legs-b')).exercises['legs-b-rdl'].variantId;
    attendu(s1 === 'rdl-barbell', 'variante de départ inattendue : ' + s1);
    const avecBarre = await fiche();
    attendu(/100 kg × 8/.test(avecBarre), 'la fiche barre n’affiche pas la dernière exposition barre : ' + avecBarre.slice(0, 200));
    await toucher(page, '[data-exercise-card="legs-b-rdl"] details.f-exercise-detail > summary');
    await page.selectOption('[data-exercise-variant="legs-b-rdl"]', 'rdl-db'); await wait(700);
    const avecHalteres = await fiche();
    attendu(!/100 kg/.test(avecHalteres), 'la fiche haltères reprend l’historique barre : ' + avecHalteres.slice(0, 200));
    const b = await lireBase(page);
    const passe = b.sessions.find((x) => x.id === '2026-01-05:legs-b');
    attendu(passe.exercises['legs-b-rdl'].variantId === 'rdl-barbell' && passe.exercises['legs-b-rdl'].sets[0].weightKg === 100, 'la séance passée a été modifiée');
    return 'barre : « 100 kg × 8 » ; après passage aux haltères : aucune exposition barre reprise ; séance passée intacte';
  });

  // ---------------------------------------------------------------- 3.6.2 : ANNULER UNE SÉANCE
  await scenario('S10 Cas réel : dimanche, séance de lundi démarrée pour tester, annulée depuis l’accueil', async ({ page, dialoguesVus }) => {
    const aujourdHui = await page.evaluate(() => new Date().getDay());
    await toucher(page, '.f-week-nav [data-action="week-next"], [data-action="week-next"]');
    await toucher(page, '[data-action="select-day"][data-day="pull-a"]');
    await allerJour(page, 'pull-a');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    attendu(await page.evaluate(() => !!document.querySelector('.execution')), 'mode guidé non ouvert');
    const autres = (await lireBase(page)).sessions.filter((x) => x.dayId !== 'pull-a').map((x) => JSON.stringify(x));
    // Retour à l'accueil : bloqué « En séance »
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '.bottom-nav [data-tab="home"]');
    let h = await page.evaluate(() => ({ statut: document.querySelector('.f-top-status')?.textContent.trim(), pill: document.querySelector('.f-session-hero .f-pill')?.textContent }));
    attendu(/En séance/.test(h.statut) && h.pill === 'En cours', 'état de départ non reproduit : ' + JSON.stringify(h));
    await toucher(page, '.f-session-hero [data-action="cancel-session"]');
    attendu(/Rien n’a été fait/.test(dialoguesVus.at(-1) ?? '') && /du lundi \d+ /.test(dialoguesVus.at(-1) ?? ''), 'confirmation absente ou inexacte : ' + dialoguesVus.at(-1));
    h = await page.evaluate(() => ({ statut: document.querySelector('.f-top-status')?.textContent.trim(), pill: document.querySelector('.f-session-hero .f-pill')?.textContent, cta: document.querySelector('.f-session-hero .f-cta')?.textContent.trim(), annuler: !!document.querySelector('[data-action="cancel-session"]') }));
    attendu(!/En séance/.test(h.statut) && h.pill === 'Au programme' && /Préparer ma séance/.test(h.cta) && !h.annuler, 'toujours en séance : ' + JSON.stringify(h));
    let s = await seanceDu(page, 'pull-a');
    const isoJour = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    attendu(s.date > isoJour, `la séance testée n’est pas dans le futur (${s.date} / ${isoJour})`);
    attendu(s.startedAt === null && s.endedAt === null && s.execution.active === false && !s.status, 'séance non remise au programme : ' + JSON.stringify({ startedAt: s.startedAt, endedAt: s.endedAt, execution: s.execution }));
    await page.reload({ waitUntil: 'load' }); await wait(2200);
    h = await page.evaluate(() => ({ statut: document.querySelector('.f-top-status')?.textContent.trim(), guide: !!document.querySelector('.execution') }));
    attendu(!/En séance/.test(h.statut) && !h.guide, 'après rechargement, de nouveau en séance : ' + JSON.stringify(h));
    const apres = (await lireBase(page)).sessions.filter((x) => x.dayId !== 'pull-a').map((x) => JSON.stringify(x));
    attendu(JSON.stringify(apres) === JSON.stringify(autres), 'une autre séance a été modifiée');
    return `jour réel ${aujourdHui} (0 = dimanche) ; lundi Pull A démarré → « Annuler cette séance » sur l’accueil → Au programme, plus « En séance », même après rechargement`;
  });

  await scenario('S11 Annuler pendant un repos avec séries validées (menu Options) : refus = rien, accord = tout remis, aucun chrono fantôme', async ({ page, setDialogues, dialoguesVus }) => {
    await demarrer(page, 'push-a'); await jusquASerie(page);
    await saisirEtValider(page, { kg: 80, reps: 8 });
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(400);
    await page.fill('[data-exec-field="reps"]', '3'); await toucher(page, '[data-exec-field="rir"][data-value="0"]');
    await saisirEtValider(page, { kg: 80, reps: 8 });
    // saisie NON validée sur la série suivante, pendant le repos
    await page.fill('[data-exec-field="weightKg"]', '99'); await page.fill('[data-exec-field="reps"]', '3');
    await page.evaluate(() => document.querySelector('[data-exec-field="rir"][data-value="5"]')?.click()); await wait(300);
    let s = await seanceDu(page, 'push-a');
    attendu(s.activeTimer?.kind === 'work-rest', 'repos non lancé');
    const avant = JSON.stringify(s);
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="forge-timer-toggle"]')?.click()); await wait(300);
    await toucher(page, '.exec-secondary [data-action="exec-menu"]');
    setDialogues('refuser');
    await toucher(page, '.sheet [data-action="cancel-session"]');
    attendu(/2 séries validées/.test(dialoguesVus.at(-1) ?? '') && /« Terminer »/.test(dialoguesVus.at(-1)), 'confirmation sans détail : ' + dialoguesVus.at(-1));
    attendu(JSON.stringify(await seanceDu(page, 'push-a')) === avant, 'refuser l’annulation a modifié la séance');
    setDialogues('accepter');
    if (!(await page.evaluate(() => !!document.querySelector('.sheet [data-action="cancel-session"]')))) await toucher(page, '.exec-secondary [data-action="exec-menu"]');
    await toucher(page, '.sheet [data-action="cancel-session"]');
    s = await seanceDu(page, 'push-a');
    const smith = s.exercises['push-a-incline-smith'];
    attendu(s.startedAt === null && s.activeTimer === null && smith.sets.every((x) => !x.done && x.reps === null), 'séance non remise à zéro');
    attendu(Object.keys(s.warmup.ramps).length === 0 && !s.warmup.general.skipped, 'échauffement/rampes conservés');
    const ecran = await page.evaluate(() => ({ overlay: !!document.querySelector('.timer-overlay'), guide: !!document.querySelector('.execution'), demarrer: !!document.querySelector('[data-action="start-session"]'), brouillons: Object.keys(JSON.parse(localStorage.getItem('colosse-brouillons-v1') || '{}')).filter((k) => k.startsWith('2026') && k.includes(':push-a:')).length }));
    attendu(!ecran.overlay && !ecran.guide && ecran.demarrer && ecran.brouillons === 0, 'écran après annulation : ' + JSON.stringify(ecran));
    await wait(1500);
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    const fantome = await page.evaluate(() => ({ overlay: !!document.querySelector('.timer-overlay'), statut: document.querySelector('.f-top-status')?.textContent.trim() ?? '' }));
    attendu(!fantome.overlay && !/En séance/.test(fantome.statut), 'chrono ou séance fantôme après rechargement : ' + JSON.stringify(fantome));
    // On peut redémarrer normalement : l'échauffement recommence
    await allerJour(page, 'push-a'); await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    attendu(/ÉCHAUFFEMENT/.test(await page.evaluate(() => document.querySelector('.exec-eyebrow')?.textContent ?? '')), 'redémarrage : pas de retour à l’échauffement');
    // Redémarrage : la 1re série est vierge (aucune valeur de la séance annulée), testé aussi SANS rechargement plus bas
    await jusquASerie(page);
    const vierge = await page.evaluate(() => ({ reps: document.querySelector('[data-exec-field="reps"]').value, rir: document.querySelector('[data-exec-group="rir"] .chip-choice.selected')?.dataset.value ?? null, serie: document.body.innerText.match(/Série \d+ sur \d+/)?.[0] }));
    attendu(vierge.serie === 'Série 1 sur 4' && vierge.reps === '' && vierge.rir === null, 'après redémarrage, série pas vierge : ' + JSON.stringify(vierge));
    return 'refus → séance identique ; accord → 0 série, pas de repos, pas de brouillon, écran « Démarrer » ; rechargement sans fantôme ; redémarrage à l’échauffement';
  });

  await scenario('S12 « Annuler la séance » depuis la liste Séance ; « Terminer » garde toujours l’historique', async ({ page }) => {
    await demarrer(page, 'legs-b');
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '.session-actions [data-action="cancel-session"]');
    let s = await seanceDu(page, 'legs-b');
    attendu(s.startedAt === null && !(await page.evaluate(() => !!document.querySelector('.session-actions [data-action="cancel-session"]'))), 'annulation depuis la liste inopérante');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    await passerActivations(page);
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]')?.click()); await wait(400);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '.session-actions [data-action="finish-session"]');
    s = await seanceDu(page, 'legs-b');
    attendu(s.startedAt !== null && s.endedAt !== null && s.status === 'INCOMPLETE', '« Terminer » ne fonctionne plus comme avant');
    attendu(!(await page.evaluate(() => !!document.querySelector('[data-action="cancel-session"]'))), '« Annuler » proposé sur une séance terminée');
    return 'annulée depuis la liste ; « Terminer » enregistre toujours la séance (INCOMPLETE), pas d’annulation proposée ensuite';
  });

  await scenario('S13 Saisie non validée puis annulation SANS rechargement : rien ne revient au redémarrage', async ({ page }) => {
    await demarrer(page, 'push-a'); await jusquASerie(page);
    const initial = await page.evaluate(() => document.querySelector('[data-exec-field="weightKg"]').value);
    await page.fill('[data-exec-field="weightKg"]', '99'); await page.fill('[data-exec-field="reps"]', '3');
    await toucher(page, '[data-exec-field="rir"][data-value="0"]');
    await toucher(page, '.exec-secondary [data-action="exec-menu"]');
    await toucher(page, '.sheet [data-action="cancel-session"]');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    await jusquASerie(page);
    const v = await page.evaluate(() => ({ kg: document.querySelector('[data-exec-field="weightKg"]').value, reps: document.querySelector('[data-exec-field="reps"]').value, rir: document.querySelector('[data-exec-group="rir"] .chip-choice.selected')?.dataset.value ?? null }));
    attendu(v.kg === initial && v.reps === '' && v.rir === null, `les valeurs de la séance annulée reviennent (charge initiale « ${initial} ») : ` + JSON.stringify(v));
    return 'après annulation et redémarrage immédiat : charge ' + v.kg + ', répétitions vides, aucun RIR présélectionné';
  });

  await scenario('S14 Séance enregistrée puis rouverte : « Annuler » n’est proposé nulle part, l’historique reste', async ({ page }) => {
    await demarrer(page, 'push-a'); await jusquASerie(page);
    await saisirEtValider(page, { kg: 80, reps: 8 });
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(400);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '.session-actions [data-action="finish-session"]');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '.session-actions [data-action="resume-session"]');
    const partout = async () => page.evaluate(() => document.querySelectorAll('[data-action="cancel-session"]').length);
    attendu(await partout() === 0, 'annulation proposée dans la liste d’une séance rouverte');
    await toucher(page, '.bottom-nav [data-tab="home"]');
    attendu(await partout() === 0, 'annulation proposée sur l’accueil');
    const s = await seanceDu(page, 'push-a');
    attendu(s.exercises['push-a-incline-smith'].sets[0].done && s.status && s.reopenedAt, 'séance rouverte altérée : ' + JSON.stringify({ status: s.status, reopenedAt: s.reopenedAt }));
    return 'séance terminée puis « Reprendre » : aucun bouton d’annulation (liste, accueil), série et statut conservés';
  });

  await scenario('S15 Deux séances : annuler l’une ne coupe pas le repos en cours de l’autre', async ({ page }) => {
    // Push A : repos en cours
    await demarrer(page, 'push-a'); await jusquASerie(page); await saisirEtValider(page, { kg: 80, reps: 8 });
    // Pull A démarrée aussi, puis l'app est fermée/rouverte
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await allerJour(page, 'pull-a'); await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    // après réouverture, le chrono affiché est celui de Pull A (le repos de Push A reste en base)
    await jusquASerie(page, { reference: '50' });
    await saisirEtValider(page, { kg: 50, reps: 10 });
    let pull = await seanceDu(page, 'pull-a');
    attendu(pull.activeTimer?.kind === 'work-rest', 'repos Pull A non lancé');
    // On annule Push A (qui garde un vieux repos en base)
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await allerJour(page, 'push-a'); await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '.session-actions [data-action="cancel-session"]');
    const push = await seanceDu(page, 'push-a'); pull = await seanceDu(page, 'pull-a');
    attendu(push.startedAt === null && push.activeTimer === null, 'Push A non annulée');
    attendu(pull.activeTimer?.kind === 'work-rest', 'le repos de Pull A a disparu de la base');
    attendu(await page.evaluate(() => !!document.querySelector('.timer-overlay')), 'le repos de Pull A n’est plus affiché');
    const toast = await page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
    attendu(/Pull A du .* est encore en cours/.test(toast), 'pas d’avertissement sur l’autre séance en cours : ' + toast);
    return 'Push A annulée ; repos de Pull A toujours affiché et enregistré ; message « Pull A … est encore en cours »';
  });

  await scenario('S16 Annuler un test : charges « de test » de la semaine suivante recalculées série par série ; saisie manuelle jamais écrasée', async ({ page }) => {
    // Historique réel de test : Pull A du 31 août, 80 kg sur les deux premiers exercices.
    await allerJour(page, 'pull-a');
    const ids = await page.evaluate(async () => {
      const db = await new Promise((res) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); });
      const tous = await new Promise((r) => { const g = db.transaction('sessions').objectStore('sessions').getAll(); g.onsuccess = () => r(g.result); });
      const modele = tous.find((x) => x.dayId === 'pull-a');
      const passe = JSON.parse(JSON.stringify(modele));
      passe.id = '2026-08-31:pull-a'; passe.date = '2026-08-31'; passe.startedAt = Date.parse('2026-08-31T18:00:00'); passe.endedAt = passe.startedAt + 3600e3; passe.status = 'COMPLETE';
      const [a, b] = passe.exerciseOrder;
      for (const id of [a, b]) passe.exercises[id].sets.forEach((set) => Object.assign(set, { done: true, weightKg: 80, reps: 8, rir: 2, technique: 'good', pain: 0, completedAt: passe.startedAt + 600e3 }));
      await new Promise((r) => { const t = db.transaction('sessions', 'readwrite'); t.objectStore('sessions').put(passe); t.oncomplete = r; });
      db.close(); return [a, b];
    });
    await page.reload({ waitUntil: 'load' }); await wait(2200);
    const passerRepos = async () => { await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(400); };
    // Test : Pull A de cette semaine, une série à 20 kg × 12 sur chacun des deux exercices
    await allerJour(page, 'pull-a'); await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    await jusquASerie(page, { reference: '20' }); await saisirEtValider(page, { kg: 20, reps: 12 }); await passerRepos();
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, `[data-exercise-card="${ids[1]}"] [data-action="exercise-do-now"]`);
    await jusquASerie(page, { reference: '20' }); await saisirEtValider(page, { kg: 20, reps: 12 }); await passerRepos();
    const test = await seanceDu(page, 'pull-a');
    // Semaine suivante : pré-remplie à partir du test
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="week-next"]');
    const sessions = async () => (await lireBase(page)).sessions;
    const futurId = (await sessions()).map((x) => x.id).filter((id) => id.endsWith(':pull-a') && id > test.id).sort()[0];
    attendu(futurId, 'séance de la semaine suivante non créée');
    let futur = (await sessions()).find((x) => x.id === futurId);
    const avant0 = futur.exercises[ids[0]].sets.map((x) => x.weightKg), avant1 = futur.exercises[ids[1]].sets.map((x) => x.weightKg);
    attendu(avant0[0] < 70 && avant1[0] < 70, 'pré-remplissage non issu du test : ' + JSON.stringify([avant0, avant1]));
    // L'utilisateur tape lui-même, sur le 2e exercice, la MÊME valeur que la charge proposée
    await toucher(page, `[data-exercise-card="${ids[1]}"] details.f-exercise-detail > summary`);
    const champ = `[data-set-row][data-exercise="${ids[1]}"][data-set="0"] [data-set-field="weightKg"]`;
    await page.fill(champ, String(avant1[0]));
    await page.evaluate((sel) => document.querySelector(sel).dispatchEvent(new Event('change', { bubbles: true })), champ); await wait(600);
    // Sur le 1er exercice de la semaine suivante : « Valider » sans répétitions (refusé, charge inchangée)
    await toucher(page, `[data-exercise-card="${ids[0]}"] details.f-exercise-detail > summary`);
    await toucher(page, `[data-action="toggle-set"][data-exercise="${ids[0]}"][data-set="0"]`);
    attendu(!(await sessions()).find((x) => x.id === futurId).startedAt, '« Valider » sans répétitions a démarré la séance future');
    // Le test continue APRÈS ce pré-remplissage : une 2e série sur le 1er exercice
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="week-prev"]');
    await toucher(page, `[data-exercise-card="${ids[0]}"] [data-action="exercise-do-now"]`);
    if (!(await page.evaluate(() => !!document.querySelector('.execution')))) { await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="exec-enter"]'); }
    await jusquASerie(page, { reference: '20' }); await saisirEtValider(page, { kg: 20, reps: 12 }); await passerRepos();
    attendu((await seanceDu(page, 'pull-a')).exercises[ids[0]].sets.filter((x) => x.done).length === 2, 'la 2e série du test n’a pas été validée');
    // Annulation du test
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '.session-actions [data-action="cancel-session"]');
    futur = (await sessions()).find((x) => x.id === futurId);
    const apres0 = futur.exercises[ids[0]].sets.map((x) => x.weightKg), apres1 = futur.exercises[ids[1]].sets.map((x) => x.weightKg);
    attendu(apres0.every((kg) => kg >= 70), `1er exercice : charges encore issues du test : ${JSON.stringify(avant0)} → ${JSON.stringify(apres0)}`);
    attendu(apres1[0] === avant1[0], `2e exercice : la charge tapée à la main a été écrasée : ${JSON.stringify(avant1)} → ${JSON.stringify(apres1)}`);
    attendu(apres1.slice(1).every((kg) => kg >= 70), `2e exercice : les séries non retouchées gardent la charge du test : ${JSON.stringify(apres1)}`);
    return `1er exercice ${JSON.stringify(avant0)} → ${JSON.stringify(apres0)} (test poursuivi, « Valider » sans reps) ; 2e exercice ${JSON.stringify(avant1)} → ${JSON.stringify(apres1)} (série 1 choisie à la main conservée)`;
  });

  await scenario('S17 Pré-remplissage fait avant la mise à jour (sans marque) : annoncé dans la confirmation puis recalculé', async ({ page, dialoguesVus }) => {
    await allerJour(page, 'pull-a');
    const premier = await page.evaluate(async () => {
      const db = await new Promise((res) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); });
      const tous = await new Promise((r) => { const g = db.transaction('sessions').objectStore('sessions').getAll(); g.onsuccess = () => r(g.result); });
      const passe = JSON.parse(JSON.stringify(tous.find((x) => x.dayId === 'pull-a')));
      passe.id = '2026-08-31:pull-a'; passe.date = '2026-08-31'; passe.startedAt = Date.parse('2026-08-31T18:00:00'); passe.endedAt = passe.startedAt + 3600e3; passe.status = 'COMPLETE';
      const a = passe.exerciseOrder[0];
      passe.exercises[a].sets.forEach((set) => Object.assign(set, { done: true, weightKg: 80, reps: 8, rir: 2, technique: 'good', pain: 0, completedAt: passe.startedAt + 600e3 }));
      await new Promise((r) => { const t = db.transaction('sessions', 'readwrite'); t.objectStore('sessions').put(passe); t.oncomplete = r; });
      db.close(); return a;
    });
    await page.reload({ waitUntil: 'load' }); await wait(2200);
    await allerJour(page, 'pull-a'); await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    await jusquASerie(page, { reference: '20' }); await saisirEtValider(page, { kg: 20, reps: 12 });
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(400);
    const test = await seanceDu(page, 'pull-a');
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="week-next"]');
    // Simule une séance pré-remplie par la version précédente : on retire la marque en base
    const futurId = await page.evaluate(async (testId) => {
      const db = await new Promise((res) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); });
      const tous = await new Promise((r) => { const g = db.transaction('sessions').objectStore('sessions').getAll(); g.onsuccess = () => r(g.result); });
      const futur = tous.filter((x) => x.dayId === 'pull-a' && x.id > testId).sort((a, b) => a.id.localeCompare(b.id))[0];
      for (const log of Object.values(futur.exercises)) delete log.autoSeed;
      await new Promise((r) => { const t = db.transaction('sessions', 'readwrite'); t.objectStore('sessions').put(futur); t.oncomplete = r; });
      db.close(); return futur.id;
    }, test.id);
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    let futur = (await lireBase(page)).sessions.find((x) => x.id === futurId);
    const avant = futur.exercises[premier].sets.map((x) => x.weightKg);
    attendu(avant[0] < 70 && !futur.exercises[premier].autoSeed, 'état ancien non reproduit : ' + JSON.stringify(avant));
    await allerJour(page, 'pull-a');
    await page.evaluate(() => window.scrollTo(0, 0));
    if (await page.evaluate((id) => !document.querySelector('.session-actions [data-action="cancel-session"]'), null)) await toucher(page, '[data-action="week-prev"]');
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '.session-actions [data-action="cancel-session"]');
    attendu(/seront recalculées/.test(dialoguesVus.at(-1) ?? ''), 'recalcul non annoncé : ' + dialoguesVus.at(-1));
    futur = (await lireBase(page)).sessions.find((x) => x.id === futurId);
    const apres = futur.exercises[premier].sets.map((x) => x.weightKg);
    attendu(apres.every((kg) => kg >= 70), `charges anciennes non recalculées : ${JSON.stringify(avant)} → ${JSON.stringify(apres)}`);
    return `sans marque : ${JSON.stringify(avant)} → ${JSON.stringify(apres)}, recalcul annoncé dans la confirmation`;
  });

  // ================================================================ 3.6.3 — SÉANCE RÉELLE DU 14/09
  await scenario('S18 Ta séance : profil commencé début août → séance faite en décharge gardée telle quelle, séances suivantes à 3 séries et charges normales, historique figé', async ({ page }) => {
    const jour = await aujourdHuiIso(page);
    const JOURS = { 1: 'pull-a', 2: 'push-a', 3: 'legs-a', 4: 'pull-b', 5: 'push-b', 6: 'legs-b' };
    const futur = await page.evaluate(() => { const d = new Date(); do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0); return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, dow: d.getDay() }; });
    const futurDay = JOURS[futur.dow];
    const modele = await modeleSeance(page, 'pull-a');
    const ex = modele.exerciseOrder[0];
    const modeleFutur = await modeleSeance(page, futurDay);
    const exF = modeleFutur.exerciseOrder[0];
    // Séance du jour : 2 séries faites en décharge (semaine 7).
    const enCours = JSON.parse(JSON.stringify(modele));
    Object.assign(enCours, { id: `${jour}:pull-a`, date: jour, weekIndex: 7, startedAt: Date.now() - 1800e3, endedAt: null, updatedAt: Date.now(), execution: { ...(enCours.execution ?? {}), active: false } });
    enCours.exercises[ex].sets = [0, 1].map(() => ({ id: 'x' + Math.random(), done: true, weightKg: 60, reps: 8, rir: 4, technique: 'good', pain: 0, restActualSec: 120, completedAt: Date.now() - 600e3 }));
    // Séance terminée le 01/09 (semaine 5) à 70 kg — référence normale.
    const ancienne = JSON.parse(JSON.stringify(modele));
    Object.assign(ancienne, { id: '2026-09-01:pull-a', date: '2026-09-01', weekIndex: 5, startedAt: Date.parse('2026-09-01T18:00:00'), endedAt: Date.parse('2026-09-01T19:20:00'), status: 'COMPLETE' });
    ancienne.exercises[ex].sets = [0, 1, 2].map(() => ({ id: 'y' + Math.random(), done: true, weightKg: 70, reps: 8, rir: 1, technique: 'good', pain: 0, restActualSec: 120, completedAt: Date.parse('2026-09-01T18:30:00') }));
    // Séance à venir déjà créée par 3.6.2 en décharge : 2 séries pré-remplies à 87,5 % (52,5 kg sur 60).
    const passeFutur = JSON.parse(JSON.stringify(modeleFutur));
    Object.assign(passeFutur, { id: `2026-09-02:${futurDay}`, date: '2026-09-02', weekIndex: 5, startedAt: Date.parse('2026-09-02T18:00:00'), endedAt: Date.parse('2026-09-02T19:00:00'), status: 'COMPLETE' });
    passeFutur.exercises[exF].sets = passeFutur.exercises[exF].sets.map(() => ({ id: 'z' + Math.random(), done: true, weightKg: 60, reps: 8, rir: 2, technique: 'good', pain: 0, completedAt: Date.parse('2026-09-02T18:30:00') }));
    const aVenir = JSON.parse(JSON.stringify(modeleFutur));
    Object.assign(aVenir, { id: `${futur.date}:${futurDay}`, date: futur.date, weekIndex: 7, startedAt: null, endedAt: null });
    aVenir.exercises[exF].sets = [0, 1].map(() => ({ id: 'w' + Math.random(), done: false, weightKg: 52.5, reps: null, rir: null, technique: 'good', pain: 0, restActualSec: null, completedAt: null }));
    aVenir.exercises[exF].autoSeed = { loadKg: 52.5, sources: [passeFutur.id], sets: [0, 1] };
    await ecrireBase(page, { profil: { startDate: '2026-08-05', programVersion: 'transformation-12s' }, supprimerChampsProfil: ['programStartDate'], sessions: [enCours, ancienne, passeFutur, aVenir] });
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    const profil = await lireProfil(page);
    attendu(profil.programStartDate === '2026-09-07' && profil.startDate === '2026-08-05', 'migration du début de programme incorrecte : ' + JSON.stringify({ p: profil.programStartDate, s: profil.startDate }));
    const base = await lireBase(page);
    const a = base.sessions.find((x) => x.id === '2026-09-01:pull-a'), c = base.sessions.find((x) => x.id === `${jour}:pull-a`), f = base.sessions.find((x) => x.id === aVenir.id);
    attendu(a.planWeekIndex === 5 && a.exercises[ex].sets.every((x) => x.done && x.weightKg === 70), 'séance terminée modifiée');
    attendu(c.planWeekIndex === 7 && c.weekIndex === 7 && c.exercises[ex].sets.filter((x) => x.done).length === 2, 'la séance faite en décharge a été réinterprétée : ' + JSON.stringify({ w: c.weekIndex, p: c.planWeekIndex }));
    const chargesF = f.exercises[exF].sets.map((x) => x.weightKg);
    const semaineF = f.weekIndex;
    attendu(semaineF <= 3 && chargesF.length >= 3 && chargesF.every((kg) => kg >= 60), `séance à venir : semaine ${semaineF}, charges ${JSON.stringify(chargesF)} (décharge non recalculée)`);
    // Accueil et liste du jour à venir
    await allerJour(page, futurDay);
    const carte = await page.evaluate((id) => ({ plan: document.querySelector(`[data-exercise-card="${id}"] .exercise-plan`)?.textContent.replace(/\s+/g, ' '), banniere: !!document.querySelector('.f-deload-banner') }), exF);
    attendu(!/décharge/.test(carte.plan ?? '') && !carte.banniere, 'le jour à venir est encore présenté en décharge : ' + JSON.stringify(carte));
    // Réglages : le début du programme est visible et expliqué
    await toucher(page, '.bottom-nav [data-tab="tools"]');
    await toucher(page, '.f-tool[data-action="forge-open"][data-section="forge-profile"]');
    const reglage = await page.evaluate(() => ({ v: document.querySelector('[data-profile-field="programStartDate"]')?.value, aide: document.querySelector('.f-program-start-help')?.textContent }));
    attendu(reglage.v === '2026-09-07' && /semaine/.test(reglage.aide ?? '') && /décharge/.test(reglage.aide ?? ''), 'réglage absent : ' + JSON.stringify(reglage));
    return `début du programme 2026-09-07 ; séance du jour (2 séries en décharge) gardée en semaine 7 ; ${futurDay} du ${futur.date} : semaine ${semaineF}, ${JSON.stringify(chargesF)} au lieu de [52.5, 52.5] ; 01/09 figée en semaine 5`;
  });

  await scenario('S19 « Faire maintenant » sur un exercice lourd : la série 1 directement, titre visible, échauffement seulement proposé', async ({ page }) => {
    await demarrer(page, 'pull-a');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="pull-a-chest-row"] [data-action="exercise-do-now"]');
    const e = await page.evaluate(() => ({ titre: document.querySelector('.execution .exec-title')?.textContent, serie: document.body.innerText.match(/Série \d+ sur \d+/)?.[0], charge: !!document.querySelector('#exec-reference-load'), offre: document.querySelector('.f-ramp-offer')?.textContent.replace(/\s+/g, ' '), titreVisible: window.__visible(document.querySelector('.execution .exec-title')).ok }));
    attendu(/Rowing poitrine appuyée/.test(e.titre ?? '') && e.serie === 'Série 1 sur 3' && !e.charge, 'pas directement la série : ' + JSON.stringify(e));
    attendu(e.titreVisible, 'titre de l’exercice recouvert (message) : ' + JSON.stringify(e));
    attendu(/Échauffement conseillé : 2 séries légères/.test(e.offre ?? ''), 'échauffement non proposé : ' + e.offre);
    // Sans charge saisie : explication, rien ne change
    await page.fill('[data-exec-field="weightKg"]', '');
    await toucher(page, '.exec-work [data-action="exec-start-ramps"]');
    const msg = await page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
    attendu(/Indique d’abord ta charge/.test(msg) && (await etape(page)).serie === 'Série 1 sur 3', 'charge vide mal gérée : ' + msg);
    // Avec charge : montée en charge, puis « Aller directement aux séries »
    await page.fill('[data-exec-field="weightKg"]', '40');
    await toucher(page, '.exec-work [data-action="exec-start-ramps"]');
    attendu(await page.evaluate(() => !!document.querySelector('.exec-ramp')), 'montée en charge non lancée');
    await toucher(page, '.exec-ramp [data-action="exec-skip-ramps"]');
    const apres = await etape(page);
    attendu(apres.serie === 'Série 1 sur 3' && !(await page.evaluate(() => !!document.querySelector('.f-ramp-offer'))), 'retour aux séries incorrect : ' + JSON.stringify(apres));
    const kg = await page.evaluate(() => document.querySelector('[data-exec-field="weightKg"]').value);
    attendu(kg === '40', 'charge saisie perdue : ' + kg);
    return 'Rowing appuyé : Série 1 sur 3 immédiatement, titre visible, échauffement proposé ; demandé puis sauté → retour à la série avec 40 kg';
  });

  await scenario('S20 Unilatéral : gauche → 15 s → droite (ressenti à indiquer) → repos 90 s → … → repos avant l’exercice suivant après la dernière série', async ({ page, env }) => {
    await demarrer(page, 'pull-a');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="pull-a-unilateral"] [data-action="exercise-do-now"]');
    const faireCote = async (reps, rir) => {
      await page.fill('[data-exec-field="weightKg"]', '12'); await page.fill('[data-exec-field="reps"]', String(reps));
      await toucher(page, `[data-exec-field="rir"][data-value="${rir}"]`);
      await toucher(page, '[data-action="exec-validate-set"]');
    };
    let e = await etape(page); attendu(e.serie === 'Série 1 sur 2' && e.cote === 'CÔTÉ GAUCHE', 'départ : ' + JSON.stringify(e));
    await faireCote(12, 2);
    let s = await seanceDu(page, 'pull-a');
    attendu(s.activeTimer?.kind === 'side-switch', 'pas de changement de côté');
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    const droite = await page.evaluate(() => ({ cote: document.querySelector('.exec-side')?.textContent, rir: document.querySelector('[data-exec-group="rir"] .chip-choice.selected')?.dataset.value ?? null, rappel: document.querySelector('.exec-work .f-side-summary')?.textContent }));
    attendu(droite.cote === 'CÔTÉ DROIT' && droite.rir === null && /Gauche fait\s: 12 kg × 12/.test(droite.rappel ?? ''), 'côté droit : ' + JSON.stringify(droite));
    await faireCote(11, 1);
    s = await seanceDu(page, 'pull-a');
    attendu(s.activeTimer?.kind === 'work-rest' && s.activeTimer.totalSec === 90, 'repos 90 s après les deux côtés absent : ' + JSON.stringify(s.activeTimer));
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    await faireCote(12, 2); await toucher(page, '.timer-overlay [data-action="timer-skip"]'); await faireCote(10, 1);
    s = await seanceDu(page, 'pull-a');
    const t = s.activeTimer;
    attendu(t?.kind === 'transition' && t.totalSec === 90 && t.context.exerciseId === 'pull-a-unilateral' && t.context.sessionId === s.id, 'pas de repos après la dernière série : ' + JSON.stringify(t));
    const overlay = await page.evaluate(() => ({ label: document.querySelector('.timer-overlay .timer-label')?.textContent, ensuite: document.querySelector('.timer-overlay .f-timer-next')?.textContent, titre: document.querySelector('.execution .exec-title')?.textContent, scroll: window.scrollY }));
    attendu(/EXERCICE SUIVANT/.test(overlay.label ?? '') && /Ensuite : /.test(overlay.ensuite ?? '') && overlay.scroll === 0, 'affichage du repos : ' + JSON.stringify(overlay));
    attendu(!overlay.titre?.includes('unilatéral'), 'l’écran reste sur l’exercice terminé : ' + overlay.titre);
    // « Faire maintenant » pendant ce repos : pas de confirmation, repos arrêté, jamais enregistré comme repos de série
    const dialogues = []; page.on('dialog', (d) => dialogues.push(d.message()));
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="pull-a-hammer"] [data-action="exercise-do-now"]');
    s = await seanceDu(page, 'pull-a');
    attendu(s.activeTimer === null && dialogues.length === 0, 'repos non arrêté ou confirmation inutile : ' + JSON.stringify({ t: s.activeTimer, dialogues }));
    attendu(s.exercises['pull-a-unilateral'].sets[1].restActualSec === null, 'le repos avant l’exercice suivant a été enregistré comme repos de série');
    attendu(/Curl marteau/.test((await etape(page)).titre ?? ''), 'mauvais exercice ouvert');
    const sets = s.exercises['pull-a-unilateral'].sets;
    attendu(sets[0].sides.left.reps === 12 && sets[0].sides.right.reps === 11 && sets[0].sides.right.rir === 1 && sets[1].done, 'côtés mal enregistrés : ' + JSON.stringify(sets.map((x) => x.sides)));
    return 'gauche 12 → 15 s → droite (RIR non présélectionné, rappel du gauche) → REPOS 90 s → série 2 → « REPOS AVANT L’EXERCICE SUIVANT » 90 s avec « Ensuite » ; Faire maintenant l’arrête sans confirmation';
  });

  await scenario('S21 Vue liste unilatérale : gauche fait visible, statut clair, « ✓ Fait » protégé, « Faire maintenant » pendant les 15 s ramène au côté droit', async ({ page, setDialogues, dialoguesVus }) => {
    await demarrer(page, 'pull-a');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    const carte = '[data-exercise-card="pull-a-unilateral"]';
    await toucher(page, `${carte} details.f-exercise-detail > summary`);
    const ligne = `${carte} [data-set-row][data-set="0"]`;
    await page.fill(`${ligne} [data-set-field="weightKg"]`, '12');
    await page.fill(`${ligne} [data-set-field="reps"]`, '20');
    await page.selectOption(`${ligne} [data-set-field="rir"]`, '0');
    await page.selectOption(`${ligne} [data-set-field="pain"]`, '2');
    await toucher(page, `${ligne} [data-action="toggle-set"]`);
    let s = await seanceDu(page, 'pull-a');
    attendu(s.activeTimer?.kind === 'side-switch', 'pas de changement de côté');
    const vue = await page.evaluate(({ carte, ligne }) => ({ resume: document.querySelector(`${ligne} .f-side-summary`)?.textContent, statut: document.querySelector(`${carte} .f-card-status`)?.textContent, rir: document.querySelector(`${ligne} [data-set-field="rir"]`)?.value, douleur: document.querySelector(`${ligne} [data-set-field="pain"]`)?.value, badge: document.querySelector(`${ligne} .side-badge`)?.textContent }), { carte, ligne });
    attendu(/Gauche fait\s: 12 kg × 20/.test(vue.resume ?? '') && /gauche fait, droite à faire/.test(vue.statut ?? '') && vue.rir === '' && vue.douleur === '' && vue.badge === 'CÔTÉ DROIT', 'vue liste : ' + JSON.stringify(vue));
    // Faire maintenant sur CE même exercice pendant les 15 s : retour au côté droit en mode guidé, chrono conservé
    await toucher(page, `${carte} [data-action="exercise-do-now"]`);
    const e = await etape(page);
    s = await seanceDu(page, 'pull-a');
    attendu(e.guide && e.cote === 'CÔTÉ DROIT' && s.activeTimer?.kind === 'side-switch', 'pas ramené au côté droit : ' + JSON.stringify({ e, t: s.activeTimer?.kind }));
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    // Côté droit depuis la liste
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    const ouvert = await page.evaluate((c) => document.querySelector(`${c} details.f-exercise-detail`)?.open, carte);
    if (!ouvert) await toucher(page, `${carte} details.f-exercise-detail > summary`);
    await page.fill(`${ligne} [data-set-field="reps"]`, '18');
    await page.selectOption(`${ligne} [data-set-field="rir"]`, '1');
    await toucher(page, `${ligne} [data-action="toggle-set"]`);
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(400);
    const fin = await page.evaluate((l) => ({ resume: document.querySelector(`${l} .f-side-summary`)?.textContent, badge: !!document.querySelector(`${l} .side-badge`) }), ligne);
    attendu(/✓ Gauche 12 kg × 20 · ✓ Droite 12 kg × 18/.test(fin.resume ?? '') && !fin.badge, 'série faite mal affichée : ' + JSON.stringify(fin));
    // « ✓ Fait » : refus de la confirmation = série intacte
    setDialogues('refuser');
    await toucher(page, `${ligne} [data-action="toggle-set"]`);
    s = await seanceDu(page, 'pull-a');
    attendu(/Annuler la validation de la série 1 \(gauche 12 kg × 20, droite 12 kg × 18\)/.test(dialoguesVus.at(-1) ?? '') && s.exercises['pull-a-unilateral'].sets[0].done && s.exercises['pull-a-unilateral'].sets[0].sides.left.reps === 20, '« ✓ Fait » non protégé : ' + dialoguesVus.at(-1));
    return 'liste : « ✓ Gauche fait : 12 kg × 20 — droite à faire », statut « gauche fait, droite à faire », ressenti/douleur à indiquer ; Faire maintenant → côté droit ; « ✓ Fait » demande confirmation';
  });

  await scenario('S22 Bandeau « Revenir à l’étape en cours » : ne recouvre plus la variante ni les titres', async ({ page }) => {
    await demarrer(page, 'pull-a');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    const carte = '[data-exercise-card="pull-a-unilateral"]';
    await toucher(page, `${carte} details.f-exercise-detail > summary`);
    const problemes = [];
    for (let y = 0; y <= 2400; y += 60) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y); await wait(40);
      const r = await page.evaluate((c) => {
        const out = [];
        for (const el of [document.querySelector(`${c} [data-exercise-variant]`), document.querySelector(`${c} h3`)]) {
          if (!el) continue;
          const b = el.getBoundingClientRect(); if (b.bottom < 90 || b.top > innerHeight - 90) continue;
          const top = document.elementFromPoint(b.left + 10, b.top + b.height / 2);
          if (top && top.closest('.exec-resume-banner')) out.push(el.tagName + '@' + Math.round(b.top));
        }
        return out;
      }, carte);
      problemes.push(...r);
    }
    attendu(problemes.length === 0, 'recouvert par le bandeau : ' + problemes.join(', '));
    const bandeau = await page.evaluate(() => getComputedStyle(document.querySelector('.exec-resume-banner')).position);
    attendu(bandeau === 'static', 'bandeau encore collant : ' + bandeau);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]').catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '.exec-resume-banner');
    attendu((await etape(page)).guide, 'le bandeau ne ramène plus à l’étape');
    return 'sélecteur de variante et titres jamais sous le bandeau sur 2400 px de défilement ; bandeau à sa place, toujours utilisable';
  });

  await scenario('S23 Séance restée ouverte d’un autre jour : l’accueil propose « Terminer et garder mes séries » ou « Reprendre »', async ({ page }) => {
    const modele = await modeleSeance(page, 'pull-a');
    const ex = modele.exerciseOrder[0];
    // Le lundi précédent (Pull A a lieu le lundi) : une séance réellement possible.
    const hier = await page.evaluate(() => { const d = new Date(); const recul = ((d.getDay() + 6) % 7) || 7; d.setDate(d.getDate() - recul); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const ouverte = JSON.parse(JSON.stringify(modele));
    Object.assign(ouverte, { id: `${hier}:pull-a`, date: hier, startedAt: Date.now() - 20 * 3600e3, updatedAt: Date.now() - 19 * 3600e3, endedAt: null, execution: { ...(ouverte.execution ?? {}), active: true } });
    ouverte.exercises[ex].sets[0] = { ...ouverte.exercises[ex].sets[0], done: true, weightKg: 50, reps: 8, rir: 2, technique: 'good', pain: 0, completedAt: Date.now() - 19.5 * 3600e3 };
    ouverte.exercises[ex].sets[1] = { ...ouverte.exercises[ex].sets[1], done: true, weightKg: 50, reps: 7, rir: 1, technique: 'good', pain: 0, completedAt: Date.now() - 19.4 * 3600e3 };
    await ecrireBase(page, { sessions: [ouverte] });
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    const accueil = await page.evaluate(() => ({ tab: document.querySelector('.bottom-nav [aria-current="page"]')?.dataset.tab, texte: document.querySelector('.f-stale-session')?.textContent.replace(/\s+/g, ' ') }));
    attendu(accueil.tab === 'home' && /restée ouverte/.test(accueil.texte ?? '') && /2 séries déjà validées/.test(accueil.texte ?? ''), 'accueil : ' + JSON.stringify(accueil));
    await toucher(page, '.f-stale-session [data-action="stale-finish"]');
    const s = (await lireBase(page)).sessions.find((x) => x.id === ouverte.id);
    attendu(s.endedAt && s.status === 'INCOMPLETE' && s.exercises[ex].sets.filter((x) => x.done).length === 2 && s.execution.active === false, 'séance mal terminée : ' + JSON.stringify({ e: s.endedAt, st: s.status }));
    const parasites = (await lireBase(page)).sessions.filter((x) => x.id !== ouverte.id && x.endedAt && !x.exercises[ex].sets.some((y) => y.done));
    attendu(parasites.length === 0, 'une autre séance a été terminée par erreur : ' + parasites.map((x) => x.id).join(','));
    const apres = await page.evaluate(() => ({ banniere: !!document.querySelector('.f-stale-session'), statut: document.querySelector('.f-top-status')?.textContent.trim(), tab: document.querySelector('.bottom-nav [aria-current="page"]')?.dataset.tab }));
    attendu(!apres.banniere && !/En séance/.test(apres.statut) && apres.tab === 'home', 'après : ' + JSON.stringify(apres));
    return `séance d’hier ouverte → accueil « ${accueil.texte.slice(0, 60)}… » → terminée (INCOMPLETE), 2 séries gardées, plus « En séance »`;
  });

  await scenario('S24 Décharge (semaine 7 du programme) : annoncée clairement dans la liste et le mode guidé ; réglage du début ne touche pas l’historique', async ({ page }) => {
    const jour = await aujourdHuiIso(page);
    const lundi = await page.evaluate(() => { const d = new Date(); const shift = d.getDay() === 0 ? -6 : 1 - d.getDay(); d.setDate(d.getDate() + shift - 42); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const modele = await modeleSeance(page, 'pull-a');
    const terminee = JSON.parse(JSON.stringify(modele));
    Object.assign(terminee, { id: '2026-08-31:pull-a', date: '2026-08-31', startedAt: Date.parse('2026-08-31T18:00:00'), endedAt: Date.parse('2026-08-31T19:00:00'), status: 'COMPLETE', weekIndex: 3, planWeekIndex: 3 });
    await ecrireBase(page, { profil: { programStartDate: lundi }, sessions: [terminee] });
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    await allerJour(page, 'pull-a');
    const liste = await page.evaluate(() => ({ banniere: document.querySelector('.f-deload-banner')?.textContent.replace(/\s+/g, ' '), plan: document.querySelector('[data-exercise-card="pull-a-lat-pronation"] .exercise-plan')?.textContent.replace(/\s+/g, ' '), visible: window.__visible(document.querySelector('.f-deload-banner') ?? document.body).ok }));
    attendu(/Semaine 7 du programme · Décharge/.test(liste.banniere ?? '') && /2 × \(décharge, au lieu de 3\)/.test(liste.plan ?? ''), 'décharge non annoncée : ' + JSON.stringify(liste));
    await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    const guide = await page.evaluate(() => document.querySelector('.f-deload-inline')?.textContent ?? '');
    attendu(/Semaine de décharge : 2 séries au lieu de 3/.test(guide), 'mode guidé muet sur la décharge : ' + guide);
    // Changer le début du programme : la séance du jour suit, la séance terminée garde sa semaine
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '.bottom-nav [data-tab="tools"]');
    await toucher(page, '.f-tool[data-action="forge-open"][data-section="forge-profile"]');
    await page.fill('[data-profile-field="programStartDate"]', jour);
    await page.evaluate(() => document.querySelector('[data-profile-field="programStartDate"]').dispatchEvent(new Event('change', { bubbles: true }))); await wait(800);
    const base = await lireBase(page);
    const t = base.sessions.find((x) => x.id === '2026-08-31:pull-a'), c = base.sessions.find((x) => x.id === `${jour}:pull-a`);
    attendu(t.weekIndex === 3 && t.planWeekIndex === 3 && c.weekIndex === 1, 'réglage : ' + JSON.stringify({ t: t.weekIndex, c: c?.weekIndex }));
    return 'bandeau « Semaine 7 du programme · Décharge », carte « 2 × (décharge, au lieu de 3) », mode guidé « 2 séries au lieu de 3 » ; début changé → séance du jour semaine 1, séance terminée toujours semaine 3';
  });

  // ================================================================ 3.6.3 — défauts trouvés par la relecture
  async function seanceGuideeAvecTravail(page, dayId, faits) {
    const jour = await aujourdHuiIso(page);
    const modele = await modeleSeance(page, dayId);
    const s0 = JSON.parse(JSON.stringify(modele));
    s0.startedAt = Date.now() - 3600e3; s0.updatedAt = Date.now(); s0.endedAt = null;
    s0.execution = { ...(s0.execution ?? {}), active: true };
    for (const [id, n] of Object.entries(faits))
      s0.exercises[id].sets = s0.exercises[id].sets.map((set, k) => k < n ? { ...set, done: true, weightKg: 20, reps: 12, rir: 2, technique: 'good', pain: 0, completedAt: Date.now() - 1800e3 } : set);
    await ecrireBase(page, { sessions: [s0] });
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    return { jour, modele: s0 };
  }

  await scenario('S25 Après la dernière série du dernier exercice : le cardio démarre (le repos avant l’exercice suivant ne bloque pas)', async ({ page }) => {
    const day = 'pull-a';
    const modele = await modeleSeance(page, day);
    const faits = {};
    for (const id of modele.exerciseOrder) if (id !== 'pull-a-incline-walk') faits[id] = modele.exercises[id].sets.length;
    faits['pull-a-hammer'] = modele.exercises['pull-a-hammer'].sets.length - 1;
    await seanceGuideeAvecTravail(page, day, faits);
    await allerJour(page, day); await page.evaluate(() => window.scrollTo(0, 0));
    if (await page.evaluate(() => !!document.querySelector('[data-action="exec-enter"]'))) await toucher(page, '[data-action="exec-enter"]');
    if (await page.evaluate(() => !!document.querySelector('[data-action="exec-resume"]'))) await toucher(page, '[data-action="exec-resume"]');
    let e = await etape(page);
    attendu(/Curl marteau/.test(e.titre ?? ''), 'pas sur la dernière série du curl marteau : ' + JSON.stringify(e));
    await saisirEtValider(page, { kg: 12, reps: 12 });
    let s = await seanceDu(page, day);
    attendu(s.activeTimer?.kind === 'transition', 'pas de repos avant le cardio : ' + JSON.stringify(s.activeTimer));
    await toucher(page, '[data-action="exec-start-cardio"]');
    s = await seanceDu(page, day);
    const toast = await page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
    attendu(s.activeTimer?.kind === 'cardio' && !/déjà en cours/.test(toast), 'cardio refusé : ' + JSON.stringify({ t: s.activeTimer?.kind, toast }));
    return 'dernière série du curl marteau → repos avant l’exercice suivant → « DÉMARRER » le cardio : le repos est clos, le cardio tourne';
  });

  await scenario('S26 Séance menée depuis la liste, « Faire maintenant » : la série de l’exercice choisi, pas l’échauffement général ni les activations', async ({ page }) => {
    await seanceGuideeAvecTravail(page, 'pull-a', { 'pull-a-lat-pronation': 2 });
    await ecrireBase(page, {});
    await page.evaluate(async () => {
      const db = await new Promise((res) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); });
      const t = db.transaction('sessions', 'readwrite'); const st = t.objectStore('sessions');
      const all = await new Promise((r) => { const g = st.getAll(); g.onsuccess = () => r(g.result); });
      for (const x of all) if (x.startedAt && !x.endedAt) { x.execution = { ...(x.execution ?? {}), active: false }; st.put(x); }
      await new Promise((r) => { t.oncomplete = r; }); db.close();
    });
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    await allerJour(page, 'pull-a');
    await toucher(page, '[data-exercise-card="pull-a-reverse-pecdeck"] [data-action="exercise-do-now"]');
    const e = await etape(page);
    const s = await seanceDu(page, 'pull-a');
    attendu(e.guide && /Reverse pec-deck/.test(e.titre ?? '') && e.serie === 'Série 1 sur 3', 'écran après Faire maintenant : ' + JSON.stringify(e));
    attendu(s.warmup.general.skipped !== true && s.warmup.general.done !== true, 'l’échauffement a été marqué passé à la place de l’utilisateur');
    return 'séance commencée dans la liste → Faire maintenant Reverse pec-deck → « Série 1 sur 3 » directement, échauffement non marqué';
  });

  await scenario('S27 Échauffement demandé pendant le repos avant l’exercice suivant : la montée avance ; charge tapée prioritaire sur le pré-remplissage', async ({ page }) => {
    // Historique : rowing appuyé 50 kg le 01/09 → pré-remplissage à 50 kg.
    const modele = await modeleSeance(page, 'pull-a');
    const passe = JSON.parse(JSON.stringify(modele));
    Object.assign(passe, { id: '2026-09-01:pull-a', date: '2026-09-01', startedAt: Date.parse('2026-09-01T18:00:00'), endedAt: Date.parse('2026-09-01T19:00:00'), status: 'COMPLETE', weekIndex: 1, planWeekIndex: 1 });
    passe.exercises['pull-a-chest-row'].sets = passe.exercises['pull-a-chest-row'].sets.map(() => ({ id: 'p' + Math.random(), done: true, weightKg: 50, reps: 8, rir: 2, technique: 'good', pain: 0, completedAt: Date.parse('2026-09-01T18:30:00') }));
    await ecrireBase(page, { sessions: [passe] });
    await page.reload({ waitUntil: 'load' }); await wait(2200);
    await demarrer(page, 'pull-a');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    // Terminer le tirage pronation → repos avant l'exercice suivant (rowing)
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="pull-a-lat-pronation"] [data-action="exercise-do-now"]');
    for (let k = 0; k < 3; k++) { await saisirEtValider(page, { kg: 60, reps: 8 }); if (k < 2) await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(300); }
    let s = await seanceDu(page, 'pull-a');
    attendu(s.activeTimer?.kind === 'transition', 'pas de repos avant l’exercice suivant');
    let e = await etape(page);
    if (!/Rowing poitrine/.test(e.titre ?? '')) { await toucher(page, '.f-exec-tools [data-action="exec-show-program"]'); await toucher(page, '[data-exercise-card="pull-a-chest-row"] [data-action="exercise-do-now"]'); }
    const prerempli = await page.evaluate(() => document.querySelector('[data-exec-field="weightKg"]').value);
    await page.fill('[data-exec-field="weightKg"]', '70');
    await toucher(page, '.exec-work [data-action="exec-start-ramps"]');
    const rampeA = await page.evaluate(() => document.querySelector('.exec-ramp .exec-huge')?.textContent);
    attendu(/35 kg/.test(rampeA ?? ''), `montée calculée sur le pré-remplissage (${prerempli}) au lieu de 70 kg : ${rampeA}`);
    await toucher(page, '.exec-ramp [data-action="exec-validate-ramp"]');
    s = await seanceDu(page, 'pull-a');
    const toast = await page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
    attendu(s.activeTimer?.kind === 'ramp-rest' && !/déjà en cours/.test(toast), 'repos de montée refusé : ' + JSON.stringify({ t: s.activeTimer?.kind, toast }));
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    const rampeB = await page.evaluate(() => document.querySelector('.exec-ramp .exec-huge')?.textContent);
    attendu(/50 kg|49/.test(rampeB ?? ''), 'étape B non affichée : ' + rampeB);
    return `pré-rempli ${prerempli} kg, tapé 70 → montée A ${rampeA}, B ${rampeB} ; « SÉRIE FAITE » pendant le repos avant l’exercice suivant : repos de montée lancé`;
  });

  await scenario('S28 Séance du jour en cours + ancienne séance restée ouverte : « En séance » et « Reprendre » mènent à la séance du jour, chrono conservé', async ({ page }) => {
    const modele = await modeleSeance(page, 'pull-a');
    const ex = modele.exerciseOrder[0];
    const lundiPasse = await page.evaluate(() => { const d = new Date(); const recul = ((d.getDay() + 6) % 7) || 7; d.setDate(d.getDate() - recul); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const ouverte = JSON.parse(JSON.stringify(modele));
    Object.assign(ouverte, { id: `${lundiPasse}:pull-a`, date: lundiPasse, startedAt: Date.now() - 170 * 3600e3, updatedAt: Date.now() - 168 * 3600e3, endedAt: null, execution: { active: true } });
    ouverte.exercises[ex].sets[0] = { ...ouverte.exercises[ex].sets[0], done: true, weightKg: 50, reps: 8, rir: 2, technique: 'good', pain: 0 };
    await ecrireBase(page, { sessions: [ouverte] });
    await page.reload({ waitUntil: 'load' }); await wait(2200);
    await demarrer(page, 'push-a'); await jusquASerie(page); await saisirEtValider(page, { kg: 80, reps: 8 });
    const avant = (await seanceDu(page, 'push-a')).activeTimer;
    attendu(avant?.kind === 'work-rest', 'pas de repos sur la séance du jour');
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '.bottom-nav [data-tab="home"]');
    const statut = await page.evaluate(() => document.querySelector('.f-top-status')?.textContent.trim());
    await toucher(page, '.f-top-status');
    const e = await etape(page);
    const push = await seanceDu(page, 'push-a');
    const old = (await lireBase(page)).sessions.find((x) => x.id === ouverte.id);
    attendu(/En séance/.test(statut) && e.guide && /Développé incliné Smith/.test(e.titre ?? ''), '« En séance » mène ailleurs : ' + JSON.stringify({ statut, e }));
    attendu(push.activeTimer?.kind === 'work-rest' && push.activeTimer.startedAt === avant.startedAt, 'chrono du jour perdu');
    attendu(old.exercises[ex].sets.filter((x) => x.done).length === 1 && !old.endedAt, 'ancienne séance modifiée');
    return '« En séance » → séance du jour (Smith), repos conservé ; ancienne séance intacte';
  });

  await scenario('S29 Liste unilatérale : ressenti du côté droit laissé à « Je ne sais pas » → la série garde le RIR connu, jamais 0', async ({ page }) => {
    await demarrer(page, 'pull-a');
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    await passerActivations(page);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    const carte = '[data-exercise-card="pull-a-unilateral"]';
    await toucher(page, `${carte} details.f-exercise-detail > summary`);
    const ligne = `${carte} [data-set-row][data-set="0"]`;
    await page.fill(`${ligne} [data-set-field="weightKg"]`, '12'); await page.fill(`${ligne} [data-set-field="reps"]`, '12');
    await page.selectOption(`${ligne} [data-set-field="rir"]`, '2');
    await toucher(page, `${ligne} [data-action="toggle-set"]`);
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(400);
    if (await page.evaluate(() => !!document.querySelector('.execution'))) await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    if (!(await page.evaluate((c) => document.querySelector(`${c} details.f-exercise-detail`)?.open, carte))) await toucher(page, `${carte} details.f-exercise-detail > summary`);
    await page.fill(`${ligne} [data-set-field="reps"]`, '11');
    await toucher(page, `${ligne} [data-action="toggle-set"]`);
    const set = (await seanceDu(page, 'pull-a')).exercises['pull-a-unilateral'].sets[0];
    attendu(set.done && set.rir === 2 && set.sides.right.rir === null, 'RIR enregistré : ' + JSON.stringify({ rir: set.rir, droite: set.sides?.right?.rir }));
    return 'gauche RIR 2, droite « Je ne sais pas » → série RIR 2 (et non 0)';
  });

  await scenario('S30 Séance faite en décharge, figée par la mise à jour, puis « Annuler la séance » : elle revient au programme (3 séries, charges normales)', async ({ page }) => {
    const modele = await modeleSeance(page, 'pull-a');
    // Date du Pull A de la semaine affichée (et non « aujourd'hui ») : le scénario ne dépend plus du jour où il tourne.
    const jour = modele.date;
    const ex = modele.exerciseOrder[0];
    const enCours = JSON.parse(JSON.stringify(modele));
    Object.assign(enCours, { id: `${jour}:pull-a`, date: jour, weekIndex: 7, startedAt: Date.now() - 1800e3, endedAt: null, updatedAt: Date.now(), execution: { ...(enCours.execution ?? {}), active: false } });
    enCours.exercises[ex].sets = [0, 1].map((k) => ({ id: 'x' + k, done: k === 0, weightKg: 60, reps: k === 0 ? 8 : null, rir: k === 0 ? 4 : null, technique: 'good', pain: 0, restActualSec: null, completedAt: k === 0 ? Date.now() - 600e3 : null }));
    const ancienne = JSON.parse(JSON.stringify(modele));
    Object.assign(ancienne, { id: '2026-09-01:pull-a', date: '2026-09-01', weekIndex: 5, startedAt: Date.parse('2026-09-01T18:00:00'), endedAt: Date.parse('2026-09-01T19:20:00'), status: 'COMPLETE' });
    ancienne.exercises[ex].sets = [0, 1, 2].map((k) => ({ id: 'y' + k, done: true, weightKg: 70, reps: 8, rir: 1, technique: 'good', pain: 0, restActualSec: 120, completedAt: Date.parse('2026-09-01T18:30:00') }));
    await ecrireBase(page, { profil: { startDate: '2026-08-05', programVersion: 'transformation-12s' }, supprimerChampsProfil: ['programStartDate'], sessions: [enCours, ancienne] });
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    let c = await seanceDu(page, 'pull-a');
    attendu(c.planWeekIndex === 7, 'la séance commencée n’a pas été figée');
    await allerJour(page, 'pull-a'); await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '.session-actions [data-action="cancel-session"]');
    c = (await lireBase(page)).sessions.find((x) => x.id === `${jour}:pull-a`);
    const carte = await page.evaluate((id) => ({ plan: document.querySelector(`[data-exercise-card="${id}"] .exercise-plan`)?.textContent.replace(/\s+/g, ' '), banniere: !!document.querySelector('.f-deload-banner') }), ex);
    attendu(!('planWeekIndex' in c) && c.weekIndex === 2 && c.exercises[ex].sets.length >= 3 && !carte.banniere && /^3 ×/.test(carte.plan ?? ''), 'séance annulée encore en décharge : ' + JSON.stringify({ w: c.weekIndex, p: c.planWeekIndex, n: c.exercises[ex].sets.length, carte }));
    attendu(c.exercises[ex].sets.every((x) => !x.done) && c.exercises[ex].sets.every((x) => x.weightKg === null || x.weightKg >= 70), 'charges après annulation : ' + JSON.stringify(c.exercises[ex].sets.map((x) => x.weightKg)));
    return `après annulation : semaine ${c.weekIndex}, ${c.exercises[ex].sets.length} séries, charges ${JSON.stringify(c.exercises[ex].sets.map((x) => x.weightKg))}`;
  });

  await scenario('S31 Séance neuve : « Faire maintenant » dès « Commencer » garde l’échauffement et les activations, puis l’exercice choisi', async ({ page }) => {
    await demarrer(page, 'pull-a');
    attendu(/ÉCHAUFFEMENT/.test((await etape(page)).eyebrow ?? ''), 'pas d’échauffement au départ');
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="pull-a-chest-row"] [data-action="exercise-do-now"]');
    const msg = await page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
    let e = await etape(page);
    attendu(/ÉCHAUFFEMENT/.test(e.eyebrow ?? '') && /juste après l’échauffement/.test(msg), 'échauffement supprimé ou message trompeur : ' + JSON.stringify({ e, msg }));
    await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(450);
    attendu(/ACTIVATION/.test((await etape(page)).eyebrow ?? ''), 'activations supprimées');
    await passerActivations(page);
    e = await etape(page);
    attendu(/Rowing poitrine appuyée/.test(e.titre ?? '') && e.serie === 'Série 1 sur 3', 'l’exercice choisi ne suit pas l’échauffement : ' + JSON.stringify(e));
    return 'Faire maintenant dès le départ → échauffement (message « juste après l’échauffement ») → activations → Rowing appuyé Série 1 sur 3';
  });

  await scenario('S32 Séance figée par la mise à jour : dévalider puis revalider la seule série ne la fait plus basculer en décharge', async ({ page }) => {
    const modele = await modeleSeance(page, 'pull-a');
    // Date du Pull A de la semaine affichée (et non « aujourd'hui ») : le scénario ne dépend plus du jour où il tourne.
    const jour = modele.date;
    const ex = modele.exerciseOrder[0];
    const enCours = JSON.parse(JSON.stringify(modele));
    Object.assign(enCours, { id: `${jour}:pull-a`, date: jour, weekIndex: 7, startedAt: Date.now() - 1800e3, endedAt: null, updatedAt: Date.now(), execution: { ...(enCours.execution ?? {}), active: false } });
    enCours.exercises[ex].sets = [0, 1].map((k) => ({ id: 'x' + k, done: k === 0, weightKg: 60, reps: k === 0 ? 8 : null, rir: k === 0 ? 4 : null, technique: 'good', pain: 0, restActualSec: null, completedAt: k === 0 ? Date.now() - 600e3 : null }));
    enCours.exercises[ex].autoSeed = { loadKg: 60, sources: ['2026-08-31:pull-a'], sets: [0, 1] };
    const historique = JSON.parse(JSON.stringify(modele));
    Object.assign(historique, { id: '2026-08-31:pull-a', date: '2026-08-31', weekIndex: 5, planWeekIndex: 5, startedAt: Date.parse('2026-08-31T18:00:00'), endedAt: Date.parse('2026-08-31T19:00:00'), status: 'COMPLETE' });
    historique.exercises[ex].sets = [0, 1, 2].map((k) => ({ id: 'h' + k, done: true, weightKg: 70, reps: 8, rir: 1, technique: 'good', pain: 0, completedAt: Date.parse('2026-08-31T18:30:00') }));
    await ecrireBase(page, { profil: { startDate: '2026-08-05', programVersion: 'transformation-12s' }, supprimerChampsProfil: ['programStartDate'], sessions: [enCours, historique] });
    await page.reload({ waitUntil: 'load' }); await wait(2500);
    attendu((await seanceDu(page, 'pull-a')).planWeekIndex === 7, 'pas figée');
    await allerJour(page, 'pull-a');
    const carte = `[data-exercise-card="${ex}"]`;
    await toucher(page, `${carte} details.f-exercise-detail > summary`);
    await toucher(page, `${carte} [data-set-row][data-set="0"] [data-action="toggle-set"]`);
    let c = (await lireBase(page)).sessions.find((x) => x.id === `${jour}:pull-a`);
    attendu(!('planWeekIndex' in c) && c.weekIndex === 2, 'dévalidation : ' + JSON.stringify({ w: c.weekIndex, p: c.planWeekIndex }));
    const charges = c.exercises[ex].sets.map((x) => x.weightKg);
    attendu(charges[0] === 60 && c.exercises[ex].sets[0].reps === 8 && charges.slice(1).every((kg) => kg >= 70), 'charge réellement soulevée remplacée ou séries libres non recalculées : ' + JSON.stringify(charges));
    if (!(await page.evaluate((k) => document.querySelector(`${k} details.f-exercise-detail`)?.open, carte))) await toucher(page, `${carte} details.f-exercise-detail > summary`);
    await page.fill(`${carte} [data-set-row][data-set="0"] [data-set-field="weightKg"]`, '72');
    await page.fill(`${carte} [data-set-row][data-set="0"] [data-set-field="reps"]`, '8');
    await toucher(page, `${carte} [data-set-row][data-set="0"] [data-action="toggle-set"]`);
    c = (await lireBase(page)).sessions.find((x) => x.id === `${jour}:pull-a`);
    const vue = await page.evaluate((k) => ({ plan: document.querySelector(`${k} .exercise-plan`)?.textContent.replace(/\s+/g, ' '), banniere: !!document.querySelector('.f-deload-banner') }), carte);
    attendu(c.weekIndex === 2 && !('planWeekIndex' in c) && /^3 ×/.test(vue.plan ?? '') && !vue.banniere, 'revalidation : ' + JSON.stringify({ w: c.weekIndex, p: c.planWeekIndex, vue }));
    return `figée (7) → dévalidée : semaine 2, charges ${JSON.stringify(charges)} (60 kg soulevés gardés) → revalidée 72 kg × 8 : reste en semaine 2, 3 séries, sans décharge`;
  });

  // ---------------------------------------------------------------- 3.6.4 : retours du 15/09 (écran de série)
  await scenario('S33 Parcours du 15/09 : accueil → démarrer → échauffement → série 1 lisible sans défiler, RIR introuvable impossible, annuler → série 1', async ({ page }) => {
    // Zones de l'iPhone réel simulées (heure en haut, barre d'accueil en bas) : Chrome n'en a pas.
    const zones = () => page.addStyleTag({ content: ':root{--safe-top:59px!important;--safe-bottom:34px!important}' });
    await zones();
    await toucher(page, '[data-action="forge-open"][data-tab="training"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '[data-action="start-session"]');
    for (let i = 0; i < 25; i++) {
      const e = await page.evaluate(() => ({ t: !!document.querySelector('.timer-overlay [data-action="timer-skip"]'), w: !!document.querySelector('[data-action="exec-skip-general-warmup"]'), a: !!document.querySelector('[data-action="exec-validate-activation"]'), s: !!document.querySelector('.exec-work [data-exec-field="reps"]') }));
      if (e.s && !e.t) break;
      if (e.t) await toucher(page, '.timer-overlay [data-action="timer-skip"]');
      else if (e.w) await toucher(page, '[data-action="exec-skip-general-warmup"]');
      else if (e.a) await toucher(page, '[data-action="exec-validate-activation"]');
      else await wait(300);
    }
    await zones();
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(200);
    // À l'arrivée, SANS défiler : série, charge, répétitions, RIR et bouton valider réellement visibles.
    const arrivee = await page.evaluate(() => ({
      serie: document.querySelector('.f-set-caption')?.firstChild?.textContent?.trim(),
      charge: window.__visible(document.querySelector('.exec-work [data-exec-field="weightKg"]')).ok,
      reps: window.__visible(document.querySelector('.exec-work [data-exec-field="reps"]')).ok,
      rir: window.__visible(document.querySelector('.exec-work [data-exec-field="rir"][data-value="2"]')),
      rirLibelle: /RIR/.test(document.querySelector('.f-rir-choice')?.textContent ?? ''),
      valider: window.__visible(document.querySelector('[data-action="exec-validate-set"]')).ok,
      pastilles: [...document.querySelectorAll('.f-set-steps li')].map((li) => li.className + ':' + li.textContent),
      repsVide: document.querySelector('.exec-work [data-exec-field="reps"]').value === '' && document.querySelector('.exec-work [data-exec-field="reps"]').placeholder === '—',
    }));
    attendu(arrivee.serie === 'Série 1 sur 4' && arrivee.charge && arrivee.reps && arrivee.rir.ok && arrivee.rirLibelle && arrivee.valider, 'série 1 pas entièrement visible à l’arrivée : ' + JSON.stringify(arrivee));
    attendu(arrivee.pastilles.join() === 'is-current:1,:2,:3,:4' && arrivee.repsVide, 'la série 1 paraît déjà faite ou un chiffre grisé fait croire à une saisie : ' + JSON.stringify(arrivee));
    // Rien ne défile derrière l'heure : le haut de l'écran est couvert.
    await page.evaluate(() => window.scrollTo(0, 500)); await wait(200);
    // Le cache de la zone de l'heure ne capte pas les touches (pointer-events:none) : on vérifie son rendu calculé.
    const haut = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.app-shell'), '::before'); const h = getComputedStyle(document.querySelector('.exec-header')); const opaque = /^rgb\(/.test(c.backgroundColor); return c.position === 'fixed' && c.top === '0px' && parseFloat(c.height) >= 59 && opaque && Number(c.zIndex) > Number(h.zIndex) ? 'ok' : 'contenu visible derrière l’heure : ' + JSON.stringify({ p: c.position, t: c.top, h: c.height, bg: c.backgroundColor, z: c.zIndex }); });
    attendu(haut === 'ok', haut);
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(150);
    // Comme Julien : 2 kg, 7 répétitions (au doigt avec + depuis le champ vide), technique propre et douleur 1, sans RIR.
    await page.fill('.exec-work [data-exec-field="weightKg"]', '2');
    const repsPlus = '.exec-work .f-value-cell:nth-child(2) [data-action="forge-step"]:not([data-delta^="-"])';
    await toucher(page, repsPlus);
    attendu(await page.evaluate(() => document.querySelector('.exec-work [data-exec-field="reps"]').value) === '6', 'le premier + sur un champ vide doit partir du bas de la fourchette (6)');
    await toucher(page, repsPlus);
    await toucher(page, '.exec-work .f-feedback-details > summary');
    await toucher(page, '.exec-work [data-exec-field="pain"][data-value="1"]');
    await toucher(page, '[data-action="exec-validate-set"]'); await wait(600);
    const bloque = await page.evaluate(() => ({
      message: document.querySelector('.f-rir-choice + .f-field-error')?.textContent ?? null,
      messageVisible: window.__visible(document.querySelector('.f-field-error')).ok,
      casesVisibles: window.__visible(document.querySelector('.f-rir-choice [data-value="2"]')).ok,
      bandeau: !!document.querySelector('.toast:not(.hidden)') && getComputedStyle(document.querySelector('.toast')).opacity !== '0' && (document.querySelector('.toast').textContent || '').length > 0,
      entete: window.__visible(document.querySelector('.exec-day')).ok,
    }));
    let s = await seanceDu(page, 'push-a');
    const log = s.exercises[s.exerciseOrder?.[0] ?? Object.keys(s.exercises)[0]];
    attendu(!log.sets[0].done && /RIR/.test(bloque.message ?? '') && bloque.messageVisible && bloque.casesVisibles && !bloque.bandeau && bloque.entete, 'RIR manquant mal signalé : ' + JSON.stringify(bloque));
    await toucher(page, '.f-rir-choice [data-exec-field="rir"][data-value="2"]');
    attendu(await page.evaluate(() => !document.querySelector('.f-field-error') && !document.querySelector('.is-missing')), 'le signalement ne disparaît pas après avoir choisi le RIR');
    await toucher(page, '[data-action="exec-validate-set"]'); await wait(500);
    s = await seanceDu(page, 'push-a');
    const l2 = s.exercises[s.exerciseOrder?.[0] ?? Object.keys(s.exercises)[0]];
    attendu(l2.sets[0].done && l2.sets[0].weightKg === 2 && l2.sets[0].reps === 7 && l2.sets[0].rir === 2 && l2.sets[0].pain === 1, 'série 1 mal enregistrée : ' + JSON.stringify(l2.sets[0]));
    const apres = await page.evaluate(() => ({ chrono: !!document.querySelector('.timer-overlay'), pastilles: [...document.querySelectorAll('.f-set-steps li')].map((li) => li.className + ':' + li.textContent).join(), charge: window.__visible(document.querySelector('.exec-work [data-exec-field="weightKg"]')).ok }));
    attendu(apres.chrono && apres.pastilles === 'is-done:✓,is-current:2,:3,:4' && apres.charge, 'après la série 1 : ' + JSON.stringify(apres));
    // Annuler la séance (menu ⋯) puis recommencer : on repart bien de la série 1.
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    await toucher(page, '.f-exec-menu');
    await toucher(page, '.sheet [data-action="cancel-session"]'); await wait(600);
    s = await seanceDu(page, 'push-a');
    attendu(!s.startedAt && Object.values(s.exercises).every((x) => x.sets.every((z) => !z.done)), 'annulation incomplète');
    if (!(await page.evaluate(() => !!document.querySelector('[data-action="start-session"]')))) await toucher(page, '[data-action="forge-open"][data-tab="training"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await toucher(page, '[data-action="start-session"]');
    await jusquASerie(page);
    const relance = await page.evaluate(() => ({ serie: document.querySelector('.f-set-caption')?.firstChild?.textContent?.trim(), pastilles: [...document.querySelectorAll('.f-set-steps li')].map((li) => li.className + ':' + li.textContent).join(), bouton: document.querySelector('[data-action="exec-validate-set"]')?.textContent.trim() }));
    attendu(relance.serie === 'Série 1 sur 4' && relance.pastilles === 'is-current:1,:2,:3,:4' && /série 1/.test(relance.bouton), 'après annulation : ' + JSON.stringify(relance));
    return `arrivée : série 1 + RIR + valider visibles sans défiler ; RIR manquant signalé sur les cases (pas de bandeau) ; 2 kg × 7 · RIR 2 · douleur 1 enregistrés ; annulation → ${relance.serie}`;
  });

  await scenario('S34 Messages de fin de série dans le chrono, jamais par-dessus l’en-tête ; série suivante non coupée', async ({ page }) => {
    await page.addStyleTag({ content: ':root{--safe-top:59px!important;--safe-bottom:34px!important}' });
    await demarrer(page, 'push-a'); await jusquASerie(page);
    await page.addStyleTag({ content: ':root{--safe-top:59px!important;--safe-bottom:34px!important}' });
    await saisirEtValider(page, { kg: 15, reps: 12, rir: 1 }); await wait(400);
    const v = await page.evaluate(() => ({
      note: document.querySelector('.timer-overlay .f-timer-note')?.textContent ?? null,
      bandeau: (() => { const t = document.querySelector('.toast'); return !!t && !t.classList.contains('hidden') && (t.textContent || '').trim().length > 0; })(),
      entete: window.__visible(document.querySelector('.exec-day')).ok,
      caption: window.__visible(document.querySelector('.f-set-caption')).ok,
      charge: window.__visible(document.querySelector('.exec-work [data-exec-field="weightKg"]')).ok,
    }));
    attendu(/12 répétitions/.test(v.note ?? '') && !v.bandeau && v.entete && v.caption && v.charge, 'message ou série suivante mal placés : ' + JSON.stringify(v));
    await toucher(page, '.timer-overlay [data-action="timer-skip"]');
    attendu(await page.evaluate(() => !document.querySelector('.f-timer-note')), 'note restée après la fin du chrono');
    return 'note « 12 répétitions… » dans le chrono, en-tête et série 2 visibles';
  });

  console.log('\nRESUME ' + JSON.stringify({ total: resultats.length, ok: resultats.filter((r) => r.ok).length }));
  srv.kill(); process.exit(resultats.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.log('ECHEC', e.stack?.slice(0, 600)); process.exit(1); });
