// v3.6.1 — la séance au centre : « Faire maintenant », transitions de chrono,
// brouillons isolés, vélo d'échauffement, démonstrations. Tests de COMPORTEMENT
// (fonctions pures et rendu réel) ; les parcours au doigt sont dans le banc
// d'interface (émulation iPhone 15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findDay, getExercisePlan } from '../program.js';
import { defaultProfile, makeSession } from '../defaults.js';
import {
    programOrder, isExercisePending, computeExecutionStep, STAGES,
    bringToFront, halfDoneUnilateral, executionChangeDecision,
} from '../engine/execution.js';
import { emptyWarmupState, activationSteps, WARMUP_EQUIPMENT, resolveWarmupEquipment } from '../engine/warmup.js';
import { applyTimerOutcome } from '../engine/timer-effects.js';
import { createTimer } from '../engine/timer.js';
import { draftKey, readDraft, saveDraft, removeDraft, pruneDrafts, pruneStoredDrafts, DRAFT_STORAGE_KEY } from '../ui/drafts.js';
import { demoSearch, renderDemoButton } from '../ui/forge.js';
import { renderExecution, renderExerciseSheet, renderReorderPanel } from '../ui/execution.js';

const planFor = (w) => (ex) => getExercisePlan(ex, w);

function seance(dayId, { setsFaits = {} } = {}) {
    const day = findDay(dayId);
    const exercises = {};
    for (const ex of day.exercises) {
        const plan = getExercisePlan(ex, 1);
        exercises[ex.id] = { exerciseId: ex.id, variantId: ex.variants?.[0]?.id ?? null, skipped: false,
            sets: Array.from({ length: plan.sets }, (_, i) => ({ done: i < (setsFaits[ex.id] ?? 0), weightKg: 50, reps: 8,
                rir: 2, technique: 'good', pain: 0, restActualSec: null, completedAt: null })) };
    }
    const warmup = emptyWarmupState();
    warmup.general = { done: true, skipped: false, durationSec: 480 };
    for (const st of activationSteps(day)) warmup.activation[st.key] = { done: true };
    return { id: `2026-09-14:${dayId}`, dayId, weekIndex: 1, startedAt: 1000, endedAt: null,
        exerciseOrder: programOrder(day), exercises, warmup, execution: { active: true }, activeTimer: null };
}
const pending = (session, day) => (id) => {
    const ex = day.exercises.find((e) => e.id === id);
    return isExercisePending(ex, session.exercises[id], getExercisePlan(ex, 1));
};

class Memoire {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
}

// ---------------------------------------------------------------- Faire maintenant

test('Faire maintenant : un exercice plus bas devient le prochain, rien d’autre ne bouge', () => {
    const day = findDay('push-a');
    const s = seance('push-a', { setsFaits: { 'push-a-incline-smith': 1 } });
    const avant = JSON.stringify(s.exercises);
    const r = bringToFront(s.exerciseOrder, 'push-a-triceps-overhead', { isPending: pending(s, day), day });
    assert.equal(r.moved, true);
    assert.equal(r.order[0], 'push-a-triceps-overhead');
    assert.deepEqual(r.order.filter((id) => id !== 'push-a-triceps-overhead'), s.exerciseOrder.filter((id) => id !== 'push-a-triceps-overhead'),
        'les autres exercices gardent leur ordre relatif');
    assert.equal(JSON.stringify(s.exercises), avant, 'aucune série, variante ni « passé » modifié');
    // Le moteur d'exécution démarre bien CET exercice.
    const step = computeExecutionStep({ day, session: { ...s, exerciseOrder: r.order }, resolvePlan: planFor(1) });
    assert.equal(step.exerciseId, 'push-a-triceps-overhead');
});

test('Faire maintenant : les exercices terminés gardent leur place', () => {
    const day = findDay('push-a');
    const s = seance('push-a', { setsFaits: { 'push-a-incline-smith': 4 } });
    const r = bringToFront(s.exerciseOrder, 'push-a-lateral', { isPending: pending(s, day), day });
    assert.equal(r.order[0], 'push-a-incline-smith', 'l’exercice terminé reste en tête');
    assert.equal(r.order[1], 'push-a-lateral');
});

test('Faire maintenant : refus explicites (terminé, déjà prochain, inconnu, cardio épinglé)', () => {
    const day = findDay('pull-a');
    const s = seance('pull-a');
    const premier = s.exerciseOrder[0];
    assert.equal(bringToFront(s.exerciseOrder, premier, { isPending: pending(s, day), day }).reason, 'already-next');
    assert.equal(bringToFront(s.exerciseOrder, 'inconnu', { isPending: pending(s, day), day }).reason, 'unknown-exercise');
    const cardio = bringToFront(s.exerciseOrder, 'pull-a-incline-walk', { isPending: pending(s, day), day });
    assert.equal(cardio.reason, 'cardio-pinned');
    assert.equal(cardio.order.at(-1), 'pull-a-incline-walk');
    const fini = seance('pull-a', { setsFaits: { [s.exerciseOrder[3]]: 9 } });
    assert.equal(bringToFront(fini.exerciseOrder, s.exerciseOrder[3], { isPending: pending(fini, day), day }).reason, 'not-pending');
});

test('Faire maintenant : un superset reste groupé', () => {
    const day = { id: 'x', exercises: [
        { id: 'a', kind: 'strength' }, { id: 'b', kind: 'strength', superset: 'S1' },
        { id: 'c', kind: 'strength', superset: 'S1' }, { id: 'd', kind: 'strength' }, { id: 'z', kind: 'cardio' },
    ] };
    const r = bringToFront(['a', 'b', 'c', 'd', 'z'], 'c', { isPending: () => true, day });
    assert.deepEqual(r.order, ['b', 'c', 'a', 'd', 'z']);
    const tout = bringToFront(['a', 'b', 'c', 'd', 'z'], 'd', { isPending: (id) => id === 'd', day });
    assert.deepEqual(tout.order, ['a', 'b', 'c', 'd', 'z'], 'plus rien à faire avant : reste avant le cardio');
});

// ---------------------------------------------------------------- Chrono pendant un changement d'exercice

test('Changement d’exercice : table des décisions, jamais de chrono réaffecté', () => {
    const names = { smith: 'Smith', lat: 'Latérales', bulg: 'Fentes' };
    const t = (kind, exerciseId) => createTimer(kind, 90, { exerciseId, setIndex: 0, sessionId: 's' }, 0);
    const d = (activeTimer, extra = {}) => executionChangeDecision({ activeTimer, targetExerciseId: 'lat', names, ...extra });
    assert.deepEqual([d(null).action, d(null).endTimer], ['proceed', false]);
    assert.equal(d(t('side-switch', 'bulg')).action, 'refuse');
    assert.match(d(t('side-switch', 'bulg')).message, /Fentes/);
    for (const kind of ['work-rest', 'ramp-rest', 'activation-rest']) {
        const r = d(t(kind, 'smith'));
        assert.deepEqual([r.action, r.endTimer], ['confirm', true], kind);
        assert.match(r.message, /durée réelle/);
    }
    for (const kind of ['cardio', 'recovery']) assert.deepEqual([d(t(kind, 'walk')).action, d(t(kind, 'walk')).endTimer], ['confirm', true]);
    assert.deepEqual([d(t('work-rest', 'lat')).action, d(t('work-rest', 'lat')).endTimer], ['proceed', false], 'même exercice : le repos continue');
    assert.deepEqual([d(t('general-warmup')).action, d(t('general-warmup')).reason, d(t('general-warmup')).endTimer], ['proceed', 'after-warmup', false]);
    const demi = d(null, { halfSetExerciseId: 'bulg' });
    assert.deepEqual([demi.action, demi.endTimer], ['confirm', false]);
    assert.equal(d(null, { halfSetExerciseId: 'lat' }).action, 'proceed');
});

test('Changement d’exercice : arrêter le repos enregistre la durée sur SA série, pas sur l’exercice choisi', () => {
    const s = seance('push-a', { setsFaits: { 'push-a-incline-smith': 1 } });
    const timer = createTimer('work-rest', 120, { exerciseId: 'push-a-incline-smith', setIndex: 0, sessionId: s.id }, 0);
    s.activeTimer = timer;
    const { session } = applyTimerOutcome(s, timer, 45_000);
    assert.equal(session.exercises['push-a-incline-smith'].sets[0].restActualSec, 45);
    assert.equal(session.exercises['push-a-lateral'].sets[0].restActualSec, null);
});

test('Série unilatérale à moitié faite : repérée, sinon rien', () => {
    const day = findDay('legs-a');
    const s = seance('legs-a');
    assert.equal(halfDoneUnilateral(s, day, planFor(1)), null);
    s.exercises['legs-a-bulgarian'].sets[0].done = false;
    s.exercises['legs-a-bulgarian'].sets[0].sides = { left: { done: true, reps: 12 } };
    assert.equal(halfDoneUnilateral(s, day, planFor(1)), 'legs-a-bulgarian');
    s.exercises['legs-a-bulgarian'].sets[0].sides.right = { done: true, reps: 11 };
    s.exercises['legs-a-bulgarian'].sets[0].done = true;
    assert.equal(halfDoneUnilateral(s, day, planFor(1)), null);
});

// ---------------------------------------------------------------- Brouillons

test('Brouillons : isolés par séance, exercice, variante, série et côté', () => {
    const st = new Memoire();
    const base = { sessionId: '2026-09-14:legs-a', exerciseId: 'legs-a-bulgarian', variantId: 'v1', setIndex: 0, side: 'left' };
    const cles = [base, { ...base, side: 'right' }, { ...base, setIndex: 1 }, { ...base, variantId: 'v2' },
        { ...base, exerciseId: 'legs-a-press' }, { ...base, sessionId: '2026-09-21:legs-a' }].map(draftKey);
    assert.equal(new Set(cles).size, cles.length);
    cles.forEach((k, i) => saveDraft(st, k, { fields: { reps: String(10 + i) }, choices: { rir: String(i % 5) } }, 1000));
    cles.forEach((k, i) => assert.equal(readDraft(st, k).fields.reps, String(10 + i)));
    removeDraft(st, cles[0]);
    assert.equal(readDraft(st, cles[0]), null);
    assert.equal(readDraft(st, cles[1]).fields.reps, '11', 'valider le gauche n’efface pas le brouillon droit');
});

test('Brouillons : même format de clé que l’écran de série rendu', () => {
    const day = findDay('push-a'); const ex = day.exercises[0];
    const session = makeSession(day.id, '2026-09-08', defaultProfile(new Date('2026-09-01')));
    const plan = getExercisePlan(ex, 1);
    const html = renderExecution({ stage: STAGES.WORK_SET, exercise: ex, exerciseId: ex.id, plan, variant: ex.variants[0], setIndex: 2, totalSets: plan.sets, targetRir: 2, side: null },
        { day, session, progress: { done: 0, total: 1, percent: 0 }, elapsedSec: 0, prescriptionLoadKg: 60, lastExposure: null });
    const cle = html.match(/data-forge-step="([^"]+)"/)[1];
    assert.equal(cle, draftKey({ sessionId: session.id, exerciseId: ex.id, variantId: session.exercises[ex.id].variantId, setIndex: 2, side: null }));
});

test('Brouillons : nettoyage (âge, séances terminées, plafond) sans jamais toucher d’autre clé', () => {
    const jour = 24 * 3600 * 1000, now = 100 * jour;
    const map = {
        '2026-09-14:push-a:ex:v:0:both': { fields: {}, choices: {}, updatedAt: now - jour },
        '2026-09-01:push-a:ex:v:0:both': { fields: {}, choices: {}, updatedAt: now - 8 * jour },
        '2026-09-13:legs-a:ex:v:0:left': { fields: {}, choices: {}, updatedAt: now - jour },
    };
    assert.deepEqual(Object.keys(pruneDrafts(map, null, now)).sort(), ['2026-09-13:legs-a:ex:v:0:left', '2026-09-14:push-a:ex:v:0:both']);
    assert.deepEqual(Object.keys(pruneDrafts(map, new Set(['2026-09-14:push-a']), now)), ['2026-09-14:push-a:ex:v:0:both']);
    const beaucoup = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`2026-09-14:push-a:ex:v:${i}:both`, { fields: {}, choices: {}, updatedAt: now - i }]));
    assert.equal(Object.keys(pruneDrafts(beaucoup, null, now)).length, 80);
    const st = new Memoire(); st.setItem('colosse-adaptive-v3-fallback', '{"sessions":[1]}'); st.setItem(DRAFT_STORAGE_KEY, JSON.stringify(map));
    pruneStoredDrafts(st, new Set(), now);
    assert.equal(st.getItem('colosse-adaptive-v3-fallback'), '{"sessions":[1]}');
    assert.deepEqual(JSON.parse(st.getItem(DRAFT_STORAGE_KEY)), {});
});

test('Brouillons : stockage corrompu ou indisponible ne casse rien', () => {
    const st = new Memoire(); st.setItem(DRAFT_STORAGE_KEY, '{pas du json');
    assert.equal(readDraft(st, 'a'), null);
    const plein = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    assert.equal(saveDraft(plein, 'a', { fields: { reps: '8' } }), false);
    assert.equal(readDraft(null, 'a'), null);
});

// ---------------------------------------------------------------- Vélo d'échauffement

test('Vélo : préférence appliquée aux nouveaux échauffements seulement, jamais rétroactive', () => {
    assert.equal(resolveWarmupEquipment({ done: false, skipped: false }, 'bike'), 'bike');
    assert.equal(resolveWarmupEquipment({ done: false, skipped: false }, null), 'treadmill');
    assert.equal(resolveWarmupEquipment({ done: false, skipped: false }, 'rameur'), 'treadmill');
    assert.equal(resolveWarmupEquipment({ done: true, skipped: false, durationSec: 480 }, 'bike'), 'treadmill', 'ancien échauffement fait sur tapis');
    assert.equal(resolveWarmupEquipment({ done: false, skipped: true, equipment: 'bike' }, 'treadmill'), 'bike', 'choix noté sur la séance');
});

test('Vélo : la fin du chrono conserve le matériel noté, sans équivalence ni conversion', () => {
    const s = seance('push-a');
    s.warmup.general = { done: false, skipped: false, durationSec: 0, equipment: 'bike' };
    const timer = createTimer('general-warmup', 480, { sessionId: s.id, equipment: 'bike' }, 0);
    const fini = applyTimerOutcome(s, timer, 481_000).session.warmup.general;
    assert.deepEqual(fini, { done: true, skipped: false, durationSec: 480, equipment: 'bike' });
    const coupe = applyTimerOutcome(s, timer, 120_000).session.warmup.general;
    assert.deepEqual(coupe, { done: false, skipped: true, durationSec: 120, equipment: 'bike' });
    const ancien = seance('push-a'); ancien.warmup.general = { done: false, skipped: false, durationSec: 0 };
    assert.equal('equipment' in applyTimerOutcome(ancien, timer, 481_000).session.warmup.general, false);
});

function ecranEchauffement(general, preferred, activeTimer = null) {
    const day = findDay('push-a');
    const session = { ...seance('push-a'), activeTimer };
    session.warmup.general = general;
    return renderExecution({ stage: STAGES.GENERAL_WARMUP }, { day, session, progress: { done: 0, total: 1, percent: 0 }, elapsedSec: 0, preferredWarmupEquipment: preferred });
}

test('Vélo : écran sans vitesse ni inclinaison, tapis inchangé, choix figé pendant le chrono', () => {
    const velo = ecranEchauffement({ done: false, skipped: false }, 'bike');
    const zoneVelo = velo.slice(velo.indexOf('exec-warmup'), velo.indexOf('exec-secondary'));
    assert.match(zoneVelo, /Vélo/);
    assert.doesNotMatch(zoneVelo, /km\/h|inclinaison/);
    assert.match(zoneVelo, /data-equipment="bike" aria-pressed="true"/);
    const tapis = ecranEchauffement({ done: false, skipped: false }, null);
    assert.match(tapis, /km\/h/);
    assert.match(tapis, /data-action="warmup-equipment-default"/);
    const pendant = ecranEchauffement({ done: false, skipped: false, equipment: 'bike' }, 'bike', createTimer('general-warmup', 480, {}, 0));
    assert.equal((pendant.match(/data-action="warmup-equipment"[^>]*disabled/g) ?? []).length, 2);
    assert.ok(WARMUP_EQUIPMENT.bike.durationSec === WARMUP_EQUIPMENT.treadmill.durationSec, 'même durée prescrite');
});

// ---------------------------------------------------------------- Démonstrations et fiches

test('Démonstration : une RECHERCHE nommée comme telle, variante incluse, aucune adresse inventée', () => {
    const d = demoSearch({ name: 'Soulevé de terre roumain', variantLabel: 'Haltères' });
    assert.equal(d.label, 'Rechercher une démonstration');
    assert.match(d.hint, /Recherche YouTube/);
    const url = new URL(d.url);
    assert.equal(url.origin + url.pathname, 'https://www.youtube.com/results');
    assert.match(url.searchParams.get('search_query'), /Soulevé de terre roumain Haltères/);
    assert.doesNotMatch(demoSearch({ name: 'Développé incliné Smith', variantLabel: 'Smith' }).terms, /Smith Smith/);
    const a = renderDemoButton(d);
    assert.match(a, /target="_blank"/); assert.match(a, /rel="noopener noreferrer"/);
});

test('Chaque étape du mode guidé offre « Tous les exercices », « Modifier l’ordre » et l’aide au mouvement', () => {
    const day = findDay('legs-a'); const ex = day.exercises.find((e) => e.id === 'legs-a-bulgarian');
    const session = seance('legs-a'); const plan = getExercisePlan(ex, 1);
    const ctx = { day, session, progress: { done: 0, total: 1, percent: 0 }, elapsedSec: 0, prescriptionLoadKg: 20, lastExposure: null, nextExercise: { name: 'Leg extension' } };
    const etapes = {
        echauffement: { stage: STAGES.GENERAL_WARMUP },
        activation: { stage: STAGES.ACTIVATION, activation: { key: 'k', name: 'Pont fessier', sets: 1, reps: 10 } },
        reference: { stage: STAGES.NEEDS_REFERENCE_LOAD, exercise: ex, exerciseId: ex.id, variant: ex.variants[0] },
        rampe: { stage: STAGES.RAMP_SET, exercise: ex, exerciseId: ex.id, variant: ex.variants[0], setIndex: 0, ramp: { weightKg: 10, reps: 8, restSec: 60, percent: 50 }, totalRamps: 2 },
        serie: { stage: STAGES.WORK_SET, exercise: ex, exerciseId: ex.id, plan, variant: ex.variants[0], setIndex: 0, totalSets: plan.sets, targetRir: 2, side: 'left' },
    };
    for (const [nom, step] of Object.entries(etapes)) {
        let html;
        try { html = renderExecution(step, ctx); } catch (e) { assert.fail(`${nom} : ${e.message}`); }
        assert.match(html, /data-action="exec-show-program"[^>]*>[^<]*(<[^>]+>[^<]*)*Tous les exercices/, nom);
        assert.match(html, /data-action="exec-reorder"/, nom);
        assert.match(html, /Rechercher une démonstration/, nom);
        if (nom !== 'echauffement') assert.match(html, /data-action="(exercise|activation)-view"/, nom);
    }
    const serie = renderExecution(etapes.serie, ctx);
    const cue = serie.indexOf('f-cue-visible');
    assert.ok(cue > 0 && cue < serie.indexOf('<details class="f-feedback-details"'), 'consigne visible, hors « Technique & douleur »');
});

test('Fiche d’exercice : consulter, faire maintenant, fermer — et rappel que la séance ne change pas', () => {
    const html = renderExerciseSheet({ eyebrow: 'EXERCICE', title: 'Leg extension', subtitle: 'Machine', status: 'À faire', planLines: ['3 séries'], cue: 'Contrôle', tempo: null, tempoHelp: null, lastExposure: null, demo: demoSearch({ name: 'Leg extension' }), doNow: true, exerciseId: 'legs-a-leg-ext' });
    assert.match(html, /data-action="exercise-do-now" data-exercise="legs-a-leg-ext"/);
    assert.match(html, /data-action="exercise-sheet-close"/);
    assert.match(html, /ne modifie pas ta séance/);
    assert.doesNotMatch(renderExerciseSheet({ title: 'X', demo: demoSearch({ name: 'X' }), doNow: false, exerciseId: 'x' }), /exercise-do-now/);
});

test('Réorganiser pendant un chrono : explication et arrêt explicite proposé, jamais silencieux', () => {
    const bloque = renderReorderPanel({ dayName: 'Legs A', rows: [], blocked: true, blockedMessage: 'Repos en cours après Smith : il sera arrêté.' });
    assert.match(bloque, /Repos en cours après Smith/);
    assert.match(bloque, /data-action="reorder-end-timer"/);
    assert.doesNotMatch(renderReorderPanel({ dayName: 'Legs A', rows: [], blocked: true }), /reorder-end-timer/);
});

test('Variante affichée en français, sans répétition du matériel ni du nom', async () => {
    const { variantDisplay } = await import('../ui/forge.js');
    assert.equal(variantDisplay({ label: 'Haltères', equipment: 'dumbbell' }), 'Haltères');
    assert.equal(variantDisplay({ label: 'Presse 45°', equipment: 'machine' }), 'Presse 45° · machine');
    assert.equal(variantDisplay({ label: 'Corde', equipment: 'cable' }), 'Corde · poulie');
    assert.equal(variantDisplay({ label: 'Barre', equipment: 'barbell' }), 'Barre');
    const day = findDay('legs-a');
    const html = renderExecution({ stage: STAGES.GENERAL_WARMUP }, { day, session: seance('legs-a'), progress: { done: 0, total: 1, percent: 0 }, elapsedSec: 0, nextExercise: { name: 'Hack squat', variantLabel: 'Hack squat' } });
    assert.match(html, /Ensuite : <strong>Hack squat<\/strong><\/p>/);
    for (const d of ['push-a', 'legs-a', 'legs-b', 'pull-a'])
        for (const ex of findDay(d).exercises)
            for (const v of ex.variants ?? []) assert.doesNotMatch(variantDisplay(v), /dumbbell|barbell|cable/, `${ex.id}/${v.id}`);
});

// ---------------------------------------------------------------- 3.6.2 : annuler une séance commencée

test('Annuler une séance : elle redevient au programme, variantes/ordre/notes conservés, original intact', async () => {
    const { cancelSession, cancelSessionSummary, cancelSessionMessage } = await import('../engine/session.js');
    const { makeSet } = await import('../defaults.js');
    const s = seance('legs-a', { setsFaits: { 'legs-a-hack': 2 } });
    s.date = '2026-09-14'; s.startedAt = 1_000; s.status = 'INCOMPLETE'; s.notes = 'genou ok'; s.readiness = { energy: 4, fatigue: 1, sleepHours: 7 };
    s.exercises['legs-a-press'].variantId = 'autre-variante'; s.exercises['legs-a-press'].skipped = true;
    s.exercises['legs-a-bulgarian'].sets[0].sides = { left: { done: true, reps: 12 } };
    s.warmup.ramps = { 'legs-a-hack': { referenceLoadKg: 100, done: [true] } };
    s.exerciseOrder = [...s.exerciseOrder].reverse(); s.orderCustomized = true;
    s.activeTimer = createTimer('work-rest', 120, { exerciseId: 'legs-a-hack', setIndex: 1, sessionId: s.id }, 0);
    const avant = JSON.stringify(s);
    const r = cancelSession(s, { now: 5_000, createSet: makeSet });
    assert.equal(JSON.stringify(s), avant, 'la séance d’origine n’est pas modifiée');
    assert.deepEqual([r.startedAt, r.endedAt, r.activeTimer, r.execution.active, 'status' in r], [null, null, null, false, false]);
    assert.deepEqual(r.warmup, { general: { done: false, skipped: false, durationSec: 0 }, activation: {}, ramps: {} });
    for (const [id, log] of Object.entries(r.exercises)) {
        assert.equal(log.skipped, false, id);
        assert.equal(log.sets.length, s.exercises[id].sets.length, id);
        assert.ok(log.sets.every((set) => !set.done && set.reps === null && !set.sides && set.completedAt === null), id);
    }
    assert.deepEqual([r.id, r.date, r.dayId, r.notes, r.exercises['legs-a-press'].variantId, r.orderCustomized], [s.id, '2026-09-14', 'legs-a', 'genou ok', 'autre-variante', true]);
    assert.deepEqual(r.readiness, s.readiness);
    assert.deepEqual(r.exerciseOrder, s.exerciseOrder);
    // Ce qui est annoncé avant confirmation
    const sum = cancelSessionSummary(s);
    assert.deepEqual([sum.sets, sum.sides, sum.skipped, sum.timer], [2, 1, 1, true]);
    assert.match(cancelSessionMessage(sum, 'Legs A'), /2 séries validées ; 1 série commencée \(un côté\)/);
    assert.match(cancelSessionMessage(sum, 'Legs A'), /« Terminer »/);
    const vierge = (dayId) => { const v = seance(dayId); v.startedAt = 1; v.warmup = emptyWarmupState(); for (const log of Object.values(v.exercises)) log.sets.forEach((set) => { set.reps = null; set.rir = null; }); return v; };
    const vide = vierge('pull-a');
    assert.match(cancelSessionMessage(cancelSessionSummary(vide), 'Pull A'), /Rien n’a été fait/);
    const saisie = vierge('pull-a'); saisie.exercises[saisie.exerciseOrder[0]].sets[0].reps = 9;
    assert.match(cancelSessionMessage(cancelSessionSummary(saisie), 'Pull A'), /1 saisie non validée/);
});

test('Annuler une séance : seuls ses brouillons sont supprimés', async () => {
    const { removeSessionDrafts } = await import('../ui/drafts.js');
    const st = new Memoire();
    const k = (sessionId, i) => draftKey({ sessionId, exerciseId: 'ex', variantId: 'v', setIndex: i, side: null });
    saveDraft(st, k('2026-09-14:pull-a', 0), { fields: { reps: '8' } }, 1);
    saveDraft(st, k('2026-09-14:pull-a', 1), { fields: { reps: '7' } }, 1);
    saveDraft(st, k('2026-09-14:pull-ab', 0), { fields: { reps: '6' } }, 1);
    saveDraft(st, k('2026-09-15:push-a', 0), { fields: { reps: '5' } }, 1);
    assert.equal(removeSessionDrafts(st, '2026-09-14:pull-a'), true);
    assert.equal(readDraft(st, k('2026-09-14:pull-a', 0)), null);
    assert.equal(readDraft(st, k('2026-09-14:pull-a', 1)), null);
    assert.equal(readDraft(st, k('2026-09-14:pull-ab', 0)).fields.reps, '6', 'préfixe voisin intact');
    assert.equal(readDraft(st, k('2026-09-15:push-a', 0)).fields.reps, '5');
    assert.equal(removeSessionDrafts(st, 'inexistante'), false);
});

test('Annuler une séance est proposé dans le menu du mode guidé', async () => {
    const { renderExecMenu } = await import('../ui/execution.js');
    assert.match(renderExecMenu({ canDefer: false, exerciseName: null }), /data-action="cancel-session"[^>]*>[^<]*Annuler la séance/);
});


test('Annuler : la confirmation annonce aussi échauffement, rampes, exercices passés et chrono en cours, avec la date', async () => {
    const { cancelSessionSummary, cancelSessionMessage } = await import('../engine/session.js');
    const base = () => { const v = seance('recovery'); v.startedAt = 1; v.warmup = emptyWarmupState(); for (const log of Object.values(v.exercises)) log.sets.forEach((set) => { set.reps = null; set.done = false; }); return v; };
    const cas = [
        [(v) => { v.activeTimer = createTimer('recovery', 2400, { exerciseId: Object.keys(v.exercises)[0], setIndex: 0, sessionId: v.id }, 0); }, /le chrono en cours \(Récup, 25:00\) : la durée déjà faite ne sera pas enregistrée/],
        [(v) => { v.warmup.general = { done: true, skipped: false, durationSec: 480 }; }, /l’échauffement déjà fait/],
        [(v) => { v.warmup.ramps = { a: { referenceLoadKg: 100, done: [true] }, b: { referenceLoadKg: 60, done: [] } }; }, /2 montées en charge/],
        [(v) => { Object.values(v.exercises)[0].skipped = true; }, /1 exercice passé \(redeviendra à faire\)/],
    ];
    for (const [preparer, attendu] of cas) {
        const v = base(); preparer(v);
        const msg = cancelSessionMessage(cancelSessionSummary(v), 'Récupération', { dateLabel: 'lundi 14 septembre', timerLabel: v.activeTimer ? 'Récup, 25:00' : '' });
        assert.doesNotMatch(msg, /Rien n’a été fait/, msg);
        assert.match(msg, attendu, msg);
        assert.match(msg, /du lundi 14 septembre/);
        assert.match(msg, /« Terminer »/);
    }
});

test('Annuler n’est jamais proposé sur une séance déjà enregistrée puis rouverte', async () => {
    const { canCancelSession } = await import('../engine/session.js');
    const { renderExecMenu } = await import('../ui/execution.js');
    assert.equal(canCancelSession({ startedAt: 1, endedAt: null }), true);
    assert.equal(canCancelSession({ startedAt: null, endedAt: null }), false, 'pas commencée');
    assert.equal(canCancelSession({ startedAt: 1, endedAt: 2 }), false, 'terminée');
    assert.equal(canCancelSession({ startedAt: 1, endedAt: null, status: 'COMPLETE' }), false, 'rouverte (statut conservé)');
    assert.equal(canCancelSession({ startedAt: 1, endedAt: null, reopenedAt: 3 }), false, 'rouverte (ancienne séance sans statut)');
    assert.equal(canCancelSession(null), false);
    assert.doesNotMatch(renderExecMenu({ canDefer: true, exerciseName: 'X', canCancel: false }), /cancel-session/);
});

test('Annuler : durée du chrono exacte après pause/reprise ; anciennes séances rouvertes protégées ; pré-remplissage automatique reconnu', async () => {
    const { canCancelSession, onlyAutoSeeded, LEGACY_REOPEN_GUARD_MS } = await import('../engine/session.js');
    const { pauseTimer, resumeTimer, elapsedSeconds } = await import('../engine/timer.js');
    // Chrono : 12 min faites, pause 10 min, reprise, 5 s → 12:05 (et non 0:05)
    let t = createTimer('cardio', 1200, {}, 0);
    t = pauseTimer(t, 720_000); t = resumeTimer(t, 1_320_000);
    assert.equal(elapsedSeconds(t, 1_325_000), 725);
    // Garde des données anciennes
    const fait = { a: { sets: [{ done: true }] } }, vierge = { a: { sets: [{ done: false }] } };
    assert.equal(canCancelSession({ startedAt: LEGACY_REOPEN_GUARD_MS - 86_400_000, endedAt: null, exercises: fait }), false, 'ancienne séance avec séries : pas d’annulation');
    assert.equal(canCancelSession({ startedAt: LEGACY_REOPEN_GUARD_MS - 86_400_000, endedAt: null, exercises: vierge }), true, 'ancienne séance vide : annulable');
    assert.equal(canCancelSession({ startedAt: LEGACY_REOPEN_GUARD_MS + 36_000_000, endedAt: null, exercises: fait }), true, 'séance commencée aujourd’hui : annulable');
    // Pré-remplissage automatique
    const log = (sets) => ({ sets });
    assert.equal(onlyAutoSeeded(log([{ weightKg: 22.5, reps: null, done: false }, { weightKg: 22.5, reps: null, done: false }]), 22.5), true);
    assert.equal(onlyAutoSeeded(log([{ weightKg: 22.5, reps: null, done: false }, { weightKg: 30, reps: null, done: false }]), 22.5), false, 'charge tapée à la main');
    assert.equal(onlyAutoSeeded(log([{ weightKg: 22.5, reps: 10, done: false }]), 22.5), false, 'répétitions saisies');
    assert.equal(onlyAutoSeeded(log([{ weightKg: null, reps: null, done: false }]), 22.5), false, 'rien de pré-rempli');
    assert.equal(onlyAutoSeeded(log([{ weightKg: 22.5, reps: null, done: true }]), 22.5), false, 'série faite');
    assert.equal(onlyAutoSeeded(log([{ weightKg: 22.5, reps: null, done: false }]), 0), false, 'pas de prescription');
});
