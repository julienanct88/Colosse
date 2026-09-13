// Mise à jour réelle : version en ligne précédente → nouvelle version, même origine, puis hors ligne.
// ÉMULATION iPhone 15 dans Chrome headless — pas un vrai iPhone. Données de test uniquement.
const { serveur, lancer, toucher, wait } = require('./banc.cjs');
const { execSync } = require('child_process'); const crypto = require('crypto');
// Usage : node tests-ui/maj.cjs <dossier version en ligne actuelle> <dossier nouvelle version>
const ANCIENNE = process.argv[2], NOUVELLE = process.argv[3];
if (!ANCIENNE || !NOUVELLE) { console.log('usage : node tests-ui/maj.cjs <ancienne> <nouvelle>'); process.exit(1); }
const fsx = require('fs');
const lireCache = (dir) => fsx.readFileSync(dir + '/sw.js', 'utf8').match(/CACHE_VERSION = '([^']+)'/)[1];
const ANCIEN_CACHE = lireCache(ANCIENNE), NOUVEAU_CACHE = lireCache(NOUVELLE);
const NOUVELLE_VERSION = fsx.readFileSync(NOUVELLE + '/defaults.js', 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const B = require('os').tmpdir(), SITE = B + '/colosse-site-maj', PORT = 8870, URL = `http://127.0.0.1:${PORT}/colosse-app.html`;
setTimeout(() => { console.log('WATCHDOG'); process.exit(2); }, 400000);
const etapes = []; const note = (ok, t) => { etapes.push({ ok, t }); console.log((ok ? 'OK ' : 'KO ') + t); if (!ok) throw new Error(t); };
const empreinte = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const x = indexedDB.open('colosse-adaptive-db'); x.onsuccess = () => res(x.result); x.onerror = () => rej(x.error); });
  const out = {};
  for (const s of [...db.objectStoreNames].sort()) out[s] = await new Promise((r) => { const t = db.transaction(s, 'readonly'); const g = t.objectStore(s).getAll(); g.onsuccess = () => r(g.result); });
  db.close(); return JSON.stringify(out);
});
const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
(async () => {
  execSync(`rm -rf "${SITE}" && cp -R "${ANCIENNE}" "${SITE}" && find "${SITE}" -type f -exec touch {} +`);
  let srv = await serveur(SITE, PORT);
  const env = await lancer(); const { page, ctx, erreurs } = env;
  try {
    await page.goto(URL, { waitUntil: 'load' }); await wait(2500);
    await page.reload({ waitUntil: 'load' }); await wait(2000);
    const avantCaches = await page.evaluate(async () => ({ caches: await caches.keys(), ctrl: !!navigator.serviceWorker.controller }));
    note(avantCaches.ctrl && avantCaches.caches.includes(ANCIEN_CACHE), `version précédente installée (${ANCIEN_CACHE}, service worker actif) : ` + avantCaches.caches.join(','));
    // Données de test dans l'ancienne version : check-in + séance commencée avec une série validée
    await toucher(page, '.bottom-nav [data-tab="training"]');
    await toucher(page, '[data-action="select-day"][data-day="push-a"]');
    await toucher(page, '[data-action="start-session"]');
    for (let i = 0; i < 40; i++) {
      const e = await page.evaluate(() => ({ timer: !!document.querySelector('.timer-overlay [data-action="timer-skip"]'), warm: !!document.querySelector('[data-action="exec-skip-general-warmup"]'), act: !!document.querySelector('[data-action="exec-validate-activation"]'), ref: !!document.querySelector('#exec-reference-load'), ramp: !!document.querySelector('[data-action="exec-validate-ramp"]'), serie: !!document.querySelector('[data-exec-field="reps"]') }));
      if (e.serie && !e.timer) break;
      const sel = e.timer ? '.timer-overlay [data-action="timer-skip"]' : e.warm ? '[data-action="exec-skip-general-warmup"]' : e.act ? '[data-action="exec-validate-activation"]' : e.ramp ? '[data-action="exec-validate-ramp"]' : null;
      if (e.ref) { await page.fill('#exec-reference-load', '80'); await page.evaluate(() => document.querySelector('[data-action="exec-set-reference"]').click()); }
      else if (sel) await page.evaluate((s) => document.querySelector(s).click(), sel);
      await wait(400);
    }
    await page.fill('[data-exec-field="weightKg"]', '80'); await page.fill('[data-exec-field="reps"]', '8');
    await page.evaluate(() => document.querySelector('[data-exec-field="rir"][data-value="2"]').click());
    await page.evaluate(() => document.querySelector('[data-action="exec-validate-set"]').click()); await wait(700);
    await page.evaluate(() => document.querySelector('.timer-overlay [data-action="timer-skip"]')?.click()); await wait(700);
    const e1 = await empreinte(page); const d1 = JSON.parse(e1);
    note(d1.sessions.some((s) => s.exercises['push-a-incline-smith'].sets[0].done), `données de test créées dans la version précédente (empreinte ${h(e1)})`);
    // Publication simulée de la nouvelle version sur la MÊME adresse
    execSync(`rsync -a --delete --exclude .git "${NOUVELLE}/" "${SITE}/" && find "${SITE}" -type f -exec touch {} +`);
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    let banniere = false;
    for (let i = 0; i < 40 && !banniere; i++) { await wait(500); banniere = await page.evaluate(() => { const b = document.getElementById('update-banner'); return !!b && !b.classList.contains('hidden'); }); }
    note(banniere, 'bannière « Nouvelle version disponible » affichée sans rechargement forcé');
    const e2 = await empreinte(page); note(e1 === e2, 'aucune donnée modifiée par le simple téléchargement de la mise à jour');
    const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null);
    await toucher(page, '#update-banner [data-action="reload-update"]');
    await nav; await wait(3000);
    const apres = await page.evaluate(async () => ({ caches: await caches.keys(), version: (await (await fetch('./defaults.js')).text()).match(/APP_VERSION = '([^']+)'/)?.[1], drafts: (await fetch('./ui/drafts.js')).ok, outils: !!document.querySelector('.f-exec-tools [data-action="exec-show-program"]'), serie: document.body.innerText.match(/Série \d+ sur \d+/)?.[0] }));
    note(apres.caches.length === 1 && apres.caches[0] === NOUVEAU_CACHE, 'ancien cache supprimé, nouveau cache seul : ' + apres.caches.join(','));
    note(apres.version === NOUVELLE_VERSION && apres.drafts, `fichiers servis = nouvelle version ${NOUVELLE_VERSION}`);
    note(apres.outils && apres.serie === 'Série 2 sur 4', `séance reprise dans la nouvelle interface au bon endroit (${apres.serie}, « Tous les exercices » présent)`);
    const e3 = await empreinte(page); note(e1 === e3, `données strictement identiques après mise à jour (empreinte ${h(e3)})`);
    // Hors ligne : serveur arrêté + réseau coupé
    await page.fill('[data-exec-field="reps"]', '7');
    srv.kill(); await ctx.setOffline(true); await wait(500);
    await page.reload({ waitUntil: 'load' }); await wait(3000);
    const hl = await page.evaluate(() => ({ serie: document.body.innerText.match(/Série \d+ sur \d+/)?.[0], reps: document.querySelector('[data-exec-field="reps"]')?.value }));
    note(hl.serie === 'Série 2 sur 4' && hl.reps === '7', `hors ligne : l’app s’ouvre, séance au bon endroit, saisie non validée récupérée (${JSON.stringify(hl)})`);
    await toucher(page, '.f-exec-tools [data-action="exec-show-program"]');
    await toucher(page, '[data-exercise-card="push-a-lateral"] [data-action="exercise-view"]');
    await toucher(page, '.f-exercise-sheet [data-action="exercise-sheet-close"]');
    await toucher(page, '.bottom-nav [data-tab="weight"]'); await toucher(page, '.bottom-nav [data-tab="history"]'); await toucher(page, '.bottom-nav [data-tab="tools"]');
    const e4 = await empreinte(page);
    const diff = (a, b, chemin = '') => { if (JSON.stringify(a) === JSON.stringify(b)) return []; if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return [chemin + ' : ' + JSON.stringify(a)?.slice(0, 60) + ' → ' + JSON.stringify(b)?.slice(0, 60)]; return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diff(a[k], b[k], chemin + '/' + k)); };
    const ecarts = diff(JSON.parse(e3), JSON.parse(e4));
    console.log('   écarts : ' + JSON.stringify(ecarts));
    note(ecarts.every((x) => /^\/settings\/0\/value\/currentTab |^\/meta\/\d+\/value |^\/settings\/0\/updatedAt/.test(x)), 'hors ligne : navigation complète ; seules les préférences d’onglet changent (aucune donnée d’entraînement modifiée)');
    note(erreurs.length === 0, 'aucune erreur JavaScript' + (erreurs.length ? ' : ' + erreurs.join(' | ') : ''));
  } catch (err) { if (!etapes.some((x) => !x.ok)) console.log('ECHEC ' + String(err.stack || err).slice(0, 400)); }
  finally { await ctx.close().catch(() => {}); try { srv.kill(); } catch {} }
  console.log('RESUME ' + JSON.stringify({ total: etapes.length, ok: etapes.filter((x) => x.ok).length }));
    process.exit(etapes.length > 0 && etapes.every((x) => x.ok) ? 0 : 1);
})();
