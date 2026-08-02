const { chromium } = require('/Users/julien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const appUrl = pathToFileURL(path.resolve(__dirname, '..', 'colosse-app.html')).href;

async function clickExact(page, name) {
  await page.getByRole('button', { name }).click();
}

async function fillProfile(page, options) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Bienvenue dans Colosse', { exact: true }).waitFor({ timeout: 30000 });

  await page.locator('label').filter({ hasText: 'PRÉNOM OU PSEUDO' }).locator('input').fill(options.name);
  await page.locator('label').filter({ hasText: 'ÂGE' }).locator('input').fill(String(options.age));
  await clickExact(page, options.sex || 'Homme');
  await clickExact(page, 'Continuer');

  await page.getByRole('spinbutton', { name: 'TAILLE (CM)', exact: true }).fill(String(options.height));
  await page.getByRole('spinbutton', { name: /POIDS ACTUEL/ }).fill(String(options.weight));
  await clickExact(page, 'Continuer');

  await clickExact(page, options.goal);
  await clickExact(page, options.shape);
  await clickExact(page, 'Continuer');

  await clickExact(page, options.level);
  await clickExact(page, options.activity);
  await clickExact(page, `${options.days} jours`);
  await clickExact(page, `${options.duration} min`);
  await clickExact(page, 'Salle de sport');
  await clickExact(page, options.constraint || 'Aucune');
  await clickExact(page, 'Continuer');
  await page.getByText(`${options.days} séances réellement calibrées à ${options.duration} min`, { exact: false }).waitFor();
  await clickExact(page, 'Créer mon profil');
  await page.getByText('v36-beta', { exact: false }).waitFor();
}

async function newPage(browser, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/service worker|supabase|ERR_FILE_NOT_FOUND/i.test(message.text())) errors.push(message.text());
  });
  return { context, page };
}

(async () => {
  const errors = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });

  try {
    const short = await newPage(browser, errors);
    await fillProfile(short.page, {
      name: 'Test Reprise', age: 38, height: 182, weight: 92,
      goal: 'Perdre du gras', shape: 'Surtout au niveau du ventre',
      level: 'Je reprends', activity: 'Faible', days: 3, duration: 30
    });
    await short.page.getByText('4 exercices · ≈ 30 min', { exact: false }).waitFor();
    const startCheck = await short.page.evaluate(() => ({
      startDate: JSON.parse(localStorage.getItem('colosse-profile-v1')).startDate,
      visibleText: document.body.innerText
    }));
    if (startCheck.startDate === '2026-08-03' && !startCheck.visibleText.includes('3 août')) throw new Error('Le profil commence le 3 août mais l’interface affiche encore la semaine précédente.');
    await short.page.getByRole('button', { name: /Coach/ }).click();
    await short.page.getByText('TON PLAN DE LA SEMAINE', { exact: true }).waitFor();
    await short.page.getByText('3×25 min', { exact: true }).waitFor();
    await short.page.screenshot({ path: '/tmp/colosse-v36-3x30-coach.png', fullPage: true });

    await short.page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('colosse-coach-v2'));
      state.testMarker = 'keep-me';
      localStorage.setItem('colosse-coach-v2', JSON.stringify(state));
      localStorage.removeItem('colosse-profile-v1');
    });
    await short.page.reload({ waitUntil: 'domcontentloaded' });
    await short.page.getByText('JULIEN', { exact: false }).first().waitFor();
    const migration = await short.page.evaluate(() => ({
      marker: JSON.parse(localStorage.getItem('colosse-coach-v2')).testMarker,
      profile: JSON.parse(localStorage.getItem('colosse-profile-v1')).id
    }));
    if (migration.marker !== 'keep-me' || migration.profile !== 'julien') throw new Error('La migration Julien a altéré les données existantes.');
    await short.context.close();

    const long = await newPage(browser, errors);
    await fillProfile(long.page, {
      name: 'Test Muscle', age: 31, height: 190, weight: 88,
      goal: 'Prendre du muscle', shape: 'Déjà musclé, définition à améliorer',
      level: 'Intermédiaire', activity: 'Active', days: 5, duration: 60,
      constraint: 'Épaule'
    });
    await long.page.getByText('6 exercices · ≈ 60 min', { exact: false }).waitFor();
    await long.page.getByRole('button', { name: /Coach/ }).click();
    await long.page.getByText('5 séances réellement calibrées à 60 min', { exact: false }).waitFor();
    await long.page.getByRole('button', { name: /Séance/ }).click();
    await long.page.locator('button').filter({ hasText: 'Épaules' }).first().click();
    await long.page.getByText('Presse épaules guidée prise neutre · amplitude indolore', { exact: true }).waitFor();
    await long.page.getByText('PROGRAMME ADAPTÉ', { exact: true }).waitFor();
    await long.page.screenshot({ path: '/tmp/colosse-v36-5x60-epaule.png', fullPage: true });
    await long.context.close();

    const medical = await newPage(browser, errors);
    await fillProfile(medical.page, {
      name: 'Test Médical', age: 45, height: 175, weight: 82,
      goal: 'Recomposition', shape: 'Silhouette plutôt équilibrée',
      level: 'Débutant', activity: 'Modérée', days: 4, duration: 45,
      constraint: 'Restriction médicale'
    });
    await medical.page.getByText('VALIDATION PROFESSIONNELLE REQUISE', { exact: true }).waitFor();
    await medical.page.screenshot({ path: '/tmp/colosse-v36-medical.png', fullPage: true });
    await medical.context.close();

    if (errors.length) throw new Error(`Erreurs navigateur:\n${errors.join('\n')}`);
    console.log('OK — profils 3×30, 5×60, contrainte épaule, restriction médicale et migration Julien validés.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
