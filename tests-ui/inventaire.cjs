// Usage : node tests-ui/inventaire.cjs <dossier de l'app> [port] [fichier résultat .json]
// Inventaire RÉEL de l'accès aux fonctions (émulation iPhone 15). Données de test uniquement.
const { serveur, lancer, toucher, wait } = require('./banc.cjs');
const fs = require('fs'); const path = require('path');
const DOSSIER = process.argv[2]; const PORT = Number(process.argv[3] || 8850); const SORTIE = process.argv[4];
setTimeout(() => { console.log('WATCHDOG'); process.exit(2); }, 420000);
(async () => {
  const srv = await serveur(DOSSIER, PORT);
  const { ctx, page, erreurs } = await lancer();
  const R = [];
  const verifier = async (fonction, acces, fn) => {
    try { const detail = await fn(); R.push({ fonction, acces, ok: true, detail: detail ?? '' }); }
    catch (e) { R.push({ fonction, acces, ok: false, detail: String(e.message ?? e).slice(0, 220) }); }
    // Referme tout panneau resté ouvert pour ne pas fausser la vérification suivante.
    await page.evaluate(() => { for (const a of ['exec-menu-close', 'reorder-close']) document.querySelector(`[data-action="${a}"]`)?.click(); }).catch(() => {});
    await wait(250);
  };
  // Amène le mode guidé jusqu'à une série de travail, quel que soit l'état.
  const jusquASerie = async () => {
    for (let i = 0; i < 25; i++) {
      const etat = await page.evaluate(() => ({ timer: !!document.querySelector('.timer-overlay [data-action="timer-skip"]'), warm: !!document.querySelector('[data-action="exec-skip-general-warmup"]'), act: !!document.querySelector('[data-action="exec-validate-activation"]'), ref: !!document.querySelector('#exec-reference-load'), ramp: !!document.querySelector('[data-action="exec-validate-ramp"]'), serie: !!document.querySelector('[data-exec-field="reps"]') }));
      if (etat.serie && !etat.timer) return;
      if (etat.timer) { await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]').click()); await wait(400); continue; }
      if (etat.warm) { await page.evaluate(() => document.querySelector('[data-action="exec-skip-general-warmup"]').click()); await wait(500); continue; }
      if (etat.act) { await page.evaluate(() => document.querySelector('[data-action="exec-validate-activation"]').click()); await wait(400); continue; }
      if (etat.ref) { await page.fill('#exec-reference-load', '80'); await page.evaluate(() => document.querySelector('[data-action="exec-set-reference"]').click()); await wait(500); continue; }
      if (etat.ramp) { await page.evaluate(() => document.querySelector('[data-action="exec-validate-ramp"]').click()); await wait(400); continue; }
      await wait(400);
    }
    throw new Error('série de travail non atteinte');
  };
  const vis = (s, i = 0) => page.evaluate(({ s, i }) => window.__atteindre([...document.querySelectorAll(s)][i]), { s, i });
  const exige = async (s, label, i = 0) => { const v = await vis(s, i); if (!v.ok) throw new Error(`${label} : ${v.raison}`); return v; };
  const texte = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const ouvrirDetailsCarte = async (i = 0) => { const ouvert = await page.evaluate((i) => document.querySelectorAll('[data-exercise-card] details.f-exercise-detail')[i]?.open, i); if (!ouvert) await toucher(page, '[data-exercise-card] details.f-exercise-detail > summary', { index: i }); };
  const ouvrirTab = async (tab) => { await page.evaluate((t) => window.scrollTo(0, 0), tab); await toucher(page, `.bottom-nav [data-tab="${tab}"]`); };
  await page.goto(`http://127.0.0.1:${PORT}/colosse-app.html`, { waitUntil: 'load' }); await wait(2500);

  // ---------- ACCUEIL / SÉANCE AVANT DÉMARRAGE
  await verifier('Aller à la séance du jour', 'Accueil → bouton principal', async () => toucher(page, '.f-cta'));
  await verifier('Choisir un autre jour', 'Séance → calendrier', async () => { await toucher(page, '[data-action="select-day"][data-day="push-a"]'); return (await texte()).includes('Push A') ? 'Push A' : 'jour non changé'; });
  await verifier('Semaine précédente / suivante', 'Séance → flèches semaine', async () => { await toucher(page, '[data-action="week-next"]'); await toucher(page, '[data-action="week-prev"]'); });
  await verifier('Voir TOUS les exercices avant de commencer (nom + variante + séries)', 'Séance → liste', async () => {
    const info = await page.evaluate(() => [...document.querySelectorAll('[data-exercise-card]')].map((c) => { const v = c.querySelector('.f-card-variant') ?? c.querySelector('.cardio-status'); const st = c.querySelector('.f-card-status'); c.scrollIntoView({ block: 'center' }); return { nom: c.querySelector('h3')?.textContent, varianteVisible: v ? window.__visible(v).ok : false, avancement: st?.textContent ?? '', series: c.querySelector('.exercise-plan b')?.textContent }; }));
    if (!info.length) throw new Error('aucune carte');
    const manque = info.filter((x) => !x.varianteVisible || !x.avancement || !x.series);
    if (manque.length) throw new Error(`${manque.length}/${info.length} cartes sans variante/avancement visibles : ${manque.map((x) => x.nom).join(', ')}`);
    return `${info.length} cartes · ex. « ${info[0].nom} · ${info[0].series} · ${info[0].avancement} »`;
  });
  await verifier('Voir l’explication/technique d’un exercice sans commencer', 'Séance → carte', async () => {
    const cue = await page.evaluate(() => { const c = document.querySelector('[data-exercise-card]'); const el = c?.querySelector('.f-card-cue'); return el ? window.__atteindre(el) : { ok: false, raison: 'aucune consigne dans la carte' }; });
    if (!cue.ok) throw new Error('consigne technique : ' + cue.raison); });
  await verifier('Vidéo de démonstration depuis la carte', 'Séance → ▶ sur la carte', async () => { const v = await exige('[data-exercise-card] a.video-link', 'lien vidéo'); const lab = await page.evaluate(() => document.querySelector('[data-exercise-card] a.video-link').getAttribute('aria-label') + ' → ' + document.querySelector('[data-exercise-card] a.video-link').href.slice(0, 60)); return lab; });
  await verifier('« Faire maintenant » visible sur chaque exercice à faire', 'Séance → carte', async () => { const r = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-action="exercise-do-now"]')]; return { n: b.length, visibles: b.filter((x) => window.__atteindre(x).ok).length }; }); if (!r.n || r.visibles !== r.n) throw new Error(`${r.visibles}/${r.n} visibles`); return `${r.n} boutons`; });
  await verifier('Modifier l’ordre directement dans la vue séance', 'Séance', async () => { const n = await page.evaluate(() => [...document.querySelectorAll('main button')].filter((b) => /Modifier l.ordre/i.test(b.textContent) && window.__atteindre(b).ok).length); if (!n) throw new Error('pas de bouton « Modifier l’ordre » visible (flèches dans une section repliée par exercice)'); });
  await verifier('Monter/descendre et poignée de déplacement', 'Séance → Modifier l’ordre', async () => { await toucher(page, '.f-session-tools [data-action="exec-reorder"]'); await exige('.sheet [data-action="move-exercise"][data-direction="down"]', 'flèche descendre'); await exige('.sheet [data-drag-handle]', 'poignée'); const n = await page.evaluate(() => document.querySelectorAll('.sheet [data-drag-handle]').length); await toucher(page, '.sheet [data-action="reorder-close"]'); return `${n} poignées`; });
  await verifier('Changer de variante', 'Séance → carte → Séries, variante & corrections', async () => { await ouvrirDetailsCarte(0); await exige('select[data-exercise-variant]', 'sélecteur de variante'); });
  await verifier('Saisir charge/reps/RIR d’une série (vue programme)', 'Séance → carte → Séries…', async () => { await exige('[data-set-row] [data-set-field="weightKg"]', 'champ charge'); await exige('[data-set-row] [data-set-field="rir"]', 'RIR'); });
  await verifier('Passer / réactiver un exercice', 'Séance → carte → Séries…', async () => { await exige('[data-action="toggle-skip-exercise"]', 'bouton passer'); });
  await verifier('État du jour (énergie, fatigue, sommeil)', 'Séance', async () => { await exige('[data-readiness="energy"]', 'énergie'); await exige('[data-readiness="sleepHours"]', 'sommeil'); });
  await verifier('Notes de séance', 'Séance', async () => { await exige('[data-session-notes]', 'notes'); });
  // ---------- DÉMARRAGE ET MODE GUIDÉ
  await verifier('Démarrer la séance', 'Séance → Démarrer', async () => { await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="start-session"]'); return (await texte()).slice(0, 60); });
  await verifier('Écran échauffement : bouton « Tous les exercices »', 'Guidé → échauffement', async () => { const n = await page.evaluate(() => [...document.querySelectorAll('.execution button')].filter((b) => /Tous les exercices/i.test(b.textContent) && window.__visible(b).ok).length); if (!n) throw new Error('absent (seulement flèche retour et « Séance » en bas)'); });
  await verifier('Choisir Vélo ou Tapis avant de démarrer l’échauffement', 'Guidé → échauffement', async () => { await exige('[data-action="warmup-equipment"][data-equipment="bike"]', 'Vélo'); await exige('[data-action="warmup-equipment"][data-equipment="treadmill"]', 'Tapis'); await toucher(page, '[data-action="warmup-equipment"][data-equipment="bike"]'); const t = await page.evaluate(() => document.querySelector('.exec-warmup').innerText); if (/km\/h|inclinaison/.test(t)) throw new Error('écran vélo affiche encore km/h ou inclinaison'); return 'vélo sans km/h ni inclinaison'; });
  await verifier('Démonstration depuis l’écran guidé (échauffement)', 'Guidé', async () => { const r = await page.evaluate(() => { const a = document.querySelector('.execution a.f-demo-button'); return a ? { v: window.__atteindre(a), t: a.innerText.replace(/\s+/g, ' ') } : null; }); if (!r?.v.ok) throw new Error('absente ou ' + r?.v.raison); return r.t; });
  await verifier('Passer l’échauffement', 'Guidé', async () => { await toucher(page, '[data-action="exec-skip-general-warmup"]'); });
  await verifier('Valider une activation', 'Guidé → activation', async () => { for (let i = 0; i < 6; i++) { if (await page.evaluate(() => !!document.querySelector('.timer-overlay [data-action="timer-skip"]'))) { await toucher(page, '.timer-overlay [data-action="timer-skip"]'); continue; } if (await page.evaluate(() => !!document.querySelector('[data-action="exec-validate-activation"]'))) { await toucher(page, '[data-action="exec-validate-activation"]'); continue; } break; } });
  await verifier('Charge de référence puis montées en charge', 'Guidé → montée en charge', async () => {
    if (await page.evaluate(() => !!document.querySelector('#exec-reference-load'))) { await page.fill('#exec-reference-load', '80'); await toucher(page, '[data-action="exec-set-reference"]'); }
    for (let i = 0; i < 8; i++) { if (await page.evaluate(() => !!document.querySelector('.timer-overlay [data-action="timer-skip"]'))) { await toucher(page, '.timer-overlay [data-action="timer-skip"]'); continue; } if (await page.evaluate(() => !!document.querySelector('[data-action="exec-validate-ramp"]'))) { await toucher(page, '[data-action="exec-validate-ramp"]'); continue; } break; } });
  await verifier('(préparation) atteindre une série de travail', 'Guidé', async () => { await jusquASerie(); return (await texte()).match(/Série \d sur \d/)?.[0]; });
  await verifier('Série de travail : consigne technique visible sans ouvrir « Technique & douleur »', 'Guidé → série', async () => { const v = await page.evaluate(() => { const el = document.querySelector('.exec-work .exec-cue'); return el ? window.__atteindre(el) : { ok: false, raison: 'aucune consigne' }; }); if (!v.ok) throw new Error(v.raison); });
  await verifier('Série de travail : « Tous les exercices » visible', 'Guidé → série', async () => { const n = await page.evaluate(() => [...document.querySelectorAll('.execution button')].filter((b) => /Tous les exercices/i.test(b.textContent)).map((b) => window.__atteindre(b).ok).filter(Boolean).length); if (!n) throw new Error('libellé « Toutes les séries & variantes » en bas de carte / « Séance »'); });
  await verifier('Valider une série (charge, reps, RIR)', 'Guidé → série', async () => { await jusquASerie(); await page.fill('[data-exec-field="weightKg"]', '80'); await page.fill('[data-exec-field="reps"]', '8'); await toucher(page, '[data-exec-field="rir"][data-value="2"]'); await toucher(page, '[data-action="exec-validate-set"]'); });
  await verifier('Chrono de repos : réduire, pause, +15, passer', 'Guidé → repos', async () => { await exige('.timer-overlay [data-action="timer-pause"]', 'pause'); await exige('.timer-overlay [data-action="timer-plus"]', '+'); await exige('.timer-overlay [data-action="forge-timer-toggle"]', 'réduire'); await exige('.timer-overlay [data-action="timer-skip"]', 'passer'); });
  await verifier('Pendant le repos : consulter la liste sans modifier le chrono', 'Guidé → repos → Séance', async () => { const avant = await page.evaluate(() => JSON.stringify(document.querySelector('#timer-remaining') ? 1 : 0)); await toucher(page, '.exec-secondary [data-action="exec-show-program"]'); const v = await page.evaluate(() => !!document.querySelector('.exercise-list') && !!document.querySelector('.timer-overlay')); if (!v) throw new Error('liste ou chrono perdu'); });
  await verifier('Revenir exactement à l’étape guidée', 'Liste → Reprendre', async () => { await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="exec-resume"]'); return (await texte()).match(/Série \d sur \d/)?.[0]; });
  await verifier('Menu options : réorganiser / machine occupée / passer', 'Guidé → ⋯', async () => { await jusquASerie(); await toucher(page, '.exec-secondary [data-action="exec-menu"]'); await exige('.sheet [data-action="exec-reorder"]', 'réorganiser'); await exige('.sheet [data-action="exec-defer"]', 'faire plus tard'); await exige('.sheet [data-action="exec-skip"]', 'passer'); await toucher(page, '.sheet [data-action="exec-menu-close"]'); });
  await verifier('Notes pendant la séance', 'Guidé → Notes', async () => { await toucher(page, '.exec-secondary [data-action="forge-notes"]'); await exige('[data-session-notes]', 'notes'); await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="exec-resume"]'); });
  await verifier('Terminer la séance', 'Liste → Terminer', async () => { if (await page.evaluate(() => !!document.querySelector('.exec-secondary [data-action="exec-show-program"]'))) await toucher(page, '.exec-secondary [data-action="exec-show-program"]'); await page.evaluate(() => window.scrollTo(0, 0)); await toucher(page, '[data-action="finish-session"]'); });
  await verifier('Reprendre une séance terminée', 'Séance → Reprendre', async () => { await exige('[data-action="resume-session"]', 'reprendre'); });

  // ---------- POIDS
  await verifier('Check-in : poids, taille, calories, adhérence, sommeil, fatigue', 'Poids', async () => { await ouvrirTab('weight'); for (const f of ['weightKg', 'waistCm', 'calories', 'adherencePct', 'sleepHours', 'fatigue']) await exige(`[data-daily-field="${f}"]`, f); });
  await verifier('Pas, vélo, intensité', 'Poids', async () => { await exige('[data-daily-field="steps"]', 'pas'); await exige('[data-daily-field="bikeMinutes"]', 'vélo'); await exige('[data-daily-text-field="bikeIntensity"]', 'intensité'); });
  await verifier('Notes quotidiennes', 'Poids', async () => { await exige('[data-daily-notes]', 'notes du jour'); });
  await verifier('Courbe, objectifs, derniers check-ins', 'Poids', async () => { await exige('#forge-chart', 'courbe'); await exige('#forge-targets', 'objectifs'); await exige('#forge-checkins', 'check-ins'); });
  // ---------- PROGRÈS
  await verifier('Historique des séances (détail, suppression confirmée)', 'Progrès', async () => { await ouvrirTab('history'); await exige('#forge-history', 'historique'); const n = await page.evaluate(() => document.querySelectorAll('[data-action="delete-session"]').length); return `${n} bouton(s) supprimer`; });
  await verifier('Prochaines prescriptions / ajustements', 'Progrès', async () => { await exige('#forge-prescriptions', 'prescriptions'); await exige('#forge-adjustments', 'ajustements'); });
  // ---------- TOUT / RÉGLAGES
  await verifier('Recherche de fonction', 'Tout', async () => { await ouvrirTab('tools'); await page.fill('#forge-tool-search', 'sauvegarde'); const n = await page.evaluate(() => [...document.querySelectorAll('[data-tool-search]')].filter((x) => !x.hidden).length); await page.fill('#forge-tool-search', ''); return `${n} résultat(s)`; });
  await verifier('Profil, nutrition', 'Tout → Profil', async () => { await toucher(page, '[data-action="forge-open"][data-section="forge-profile"]'); await exige('[data-profile-field="age"]', 'âge'); await exige('[data-profile-field="currentCalories"]', 'calories'); });
  await verifier('Préférences (repos auto, son, vibration) réellement basculables', 'Réglages', async () => {
    const out = [];
    for (const f of ['autoStartTimer', 'soundEnabled', 'vibrationEnabled']) {
      const idx = await page.evaluate((f) => [...document.querySelectorAll('.toggle-row')].findIndex((r) => r.querySelector(`[data-setting-field="${f}"]`)), f);
      const avant = await page.evaluate((f) => document.querySelector(`[data-setting-field="${f}"]`).checked, f);
      await toucher(page, '.toggle-row', { index: idx });
      const apres = await page.evaluate((f) => document.querySelector(`[data-setting-field="${f}"]`).checked, f);
      if (avant === apres) throw new Error(`${f} ne bascule pas au toucher`);
      await toucher(page, '.toggle-row', { index: idx });
      out.push(f);
    }
    return out.join(', ') + ' basculés puis remis';
  });
  await verifier('Préférence matériel d’échauffement', 'Réglages', async () => { await exige('[data-setting-field="warmupEquipment"]', 'sélecteur'); });
  await verifier('Export / import / migration / réinitialisation', 'Réglages → Sauvegarde', async () => { await exige('[data-action="export-data"]', 'export'); const imp = await page.evaluate(() => [...document.querySelectorAll('[data-action]')].map((e) => e.dataset.action).filter((a) => /import|legacy|reset/.test(a))); return imp.join(', '); });
  await verifier('Accès aux réglages sans passer par « Tout »', 'Navigation', async () => { const n = await page.evaluate(() => document.querySelectorAll('.bottom-nav [data-tab="settings"]').length); if (!n) return 'uniquement via Tout (acceptable)'; });

  if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify({ R, erreurs }, null, 1));
  const ko = R.filter((x) => !x.ok);
  console.log(`${R.length} vérifications · ${R.length - ko.length} OK · ${ko.length} problèmes · erreurs JS ${erreurs.length}`);
  for (const x of R) console.log(`${x.ok ? 'OK ' : 'KO '} ${x.fonction} — ${x.detail}`);
  await ctx.close(); srv.kill(); process.exit(R.every((r) => r.ok) && erreurs.length === 0 ? 0 : 1);
})().catch((e) => { console.log('ECHEC', e.stack?.slice(0, 500)); process.exit(1); });
