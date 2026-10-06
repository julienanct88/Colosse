// Banc de test iPhone 15 (ÉMULATION Chrome : 393×852, DPR 3, tactile). Pas un vrai iPhone.
// Prérequis : playwright-core (PLAYWRIGHT_CORE) et Google Chrome (CHROME).
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/usr/local/lib/node_modules/n8n/node_modules/playwright-core');
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function serveur(dossier, port) {
  const script = path.join(os.tmpdir(), 'colosse-banc-serveur.py');
  fs.writeFileSync(script, `import http.server, sys, os\nclass H(http.server.SimpleHTTPRequestHandler):\n    def end_headers(self):\n        self.send_header('Cache-Control','no-store')\n        super().end_headers()\n    def log_message(self,*a): pass\nos.chdir(sys.argv[2])\nhttp.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1])),H).serve_forever()\n`);
  const p = spawn('python3', [script, String(port), dossier], { stdio: 'ignore' }); await wait(1000); return p;
}
async function lancer(profil) {
  const dir = profil ?? fs.mkdtempSync(path.join(os.tmpdir(), 'colosse-banc-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = ctx.pages()[0] ?? await ctx.newPage(); page.setDefaultTimeout(20000);
  const erreurs = []; page.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) erreurs.push(String(e).slice(0, 200)); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    // Outils d'inspection injectés : visibilité RÉELLE (dans l'écran, non recouvert).
    window.__visible = (el) => {
      if (!el || !el.isConnected) return { ok: false, raison: 'absent' };
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return { ok: false, raison: 'masqué' };
      if (el.closest('details:not([open])') && !el.closest('summary')) return { ok: false, raison: 'replié' };
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return { ok: false, raison: 'taille nulle' };
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return { ok: false, raison: 'hors écran', r };
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      if (!top || !(top === el || el.contains(top))) return { ok: false, raison: 'recouvert par ' + (top?.className || top?.tagName), r };
      return { ok: true, taille: [Math.round(r.width), Math.round(r.height)] };
    };
    // Faire défiler jusqu'à l'élément comme un pouce, puis vérifier.
    window.__atteindre = (el) => { if (!el) return { ok: false, raison: 'absent' }; el.scrollIntoView({ block: 'center', inline: 'nearest' }); return window.__visible(el); };
  });
  return { ctx, page, erreurs, dir };
}
// Clic « au doigt » : l'élément doit être réellement visible, sinon échec explicite.
async function toucher(page, selecteur, { index = 0 } = {}) {
  // Démarrage lent de l'app (machine chargée) : on attend la présence de l'élément avant de le juger absent.
  await page.waitForSelector(selecteur, { state: 'attached', timeout: 8000 }).catch(() => {});
  const res = await page.evaluate(({ s, i }) => { const el = [...document.querySelectorAll(s)][i]; const v = window.__atteindre(el); return { v, texte: el?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) }; }, { s: selecteur, i: index });
  await wait(150);
  const v2 = await page.evaluate(({ s, i }) => window.__visible([...document.querySelectorAll(s)][i]), { s: selecteur, i: index });
  if (!v2.ok) throw new Error(`NON UTILISABLE « ${selecteur} » (${res.texte ?? ''}) : ${v2.raison}`);
  const box = await page.evaluate(({ s, i }) => { const r = [...document.querySelectorAll(s)][i].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, { s: selecteur, i: index });
  await page.touchscreen.tap(box.x, box.y);
  await wait(450);
  return res.texte;
}
module.exports = { serveur, lancer, toucher, wait };
