// v3.6.0 — réorganisation libre des exercices (l'ordre dépend des machines).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findDay, findExercise, getExercisePlan } from '../program.js';
import {
    programOrder, normalizeOrder, pinCardioLast, pickSessionOrder, moveInOrder,
    deferExercise, isExercisePending, canReorder, REORDER_BLOCKING_TIMERS,
    computeExecutionStep, STAGES,
} from '../engine/execution.js';
import { emptyWarmupState, activationSteps } from '../engine/warmup.js';
import { createTimer } from '../engine/timer.js';
import { renderReorderPanel, renderExecMenu } from '../ui/execution.js';

const APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const planFor = (w) => (ex) => getExercisePlan(ex, w);

/** Séance prête à exécuter (échauffement et activation faits). */
function seance(dayId, { rampsFaites = [], setsFaits = {} } = {}) {
    const day = findDay(dayId);
    const exercises = {};
    for (const ex of day.exercises) {
        const plan = getExercisePlan(ex, 1);
        exercises[ex.id] = { exerciseId: ex.id, variantId: ex.variants?.[0]?.id ?? null, skipped: false,
            sets: Array.from({ length: plan.sets }, () => ({ done: false, weightKg: null, reps: null,
                rir: null, technique: 'good', pain: 0, restActualSec: null, completedAt: null })) };
    }
    const session = { id: `2026-09-14:${dayId}`, dayId, weekIndex: 1, startedAt: 1000, endedAt: null,
        exerciseOrder: programOrder(day), exercises, warmup: emptyWarmupState(),
        execution: { active: true }, activeTimer: null, orderCustomized: false };
    session.warmup.general = { done: true, skipped: false, durationSec: 360 };
    for (const st of activationSteps(day))
        session.warmup.activation[st.key] = { done: true };
    for (const id of rampsFaites)
        session.warmup.ramps[id] = { referenceLoadKg: 100, done: [true, true, true] };
    for (const [id, nb] of Object.entries(setsFaits))
        for (let i = 0; i < nb; i += 1) {
            session.exercises[id].sets[i].done = true;
            session.exercises[id].sets[i].reps = 8;
            session.exercises[id].sets[i].weightKg = 80;
        }
    return { day, session };
}

const pendingFor = (day, session, week = 1) => (id) => {
    const exercise = day.exercises.find((ex) => ex.id === id);
    return isExercisePending(exercise, session.exercises[id], getExercisePlan(exercise, week));
};

// ============================== 1-2. SÉANCE DU JOUR ≠ ORDRE PAR DÉFAUT

test('1. déplacer un exercice modifie session.exerciseOrder', () => {
    const { day, session } = seance('push-a');
    const avant = [...session.exerciseOrder];
    const apres = moveInOrder(session.exerciseOrder, 'push-a-lateral', -2, day);
    assert.notDeepEqual(apres, avant);
    assert.equal(apres.indexOf('push-a-lateral'), avant.indexOf('push-a-lateral') - 2);
    assert.equal(apres.length, avant.length, 'aucun exercice perdu');
    assert.deepEqual([...apres].sort(), [...avant].sort(), 'ce sont les mêmes exercices');
});

test('2. un déplacement n’écrit JAMAIS settings.dayOrders (garde structurelle)', () => {
    // Inventaire des sites d'écriture de dayOrders dans app.js : un seul autorisé.
    const lignes = APP.split('\n');
    const entete = /^ {4}(?:async )?([A-Za-z_$][\w$]*)\s*\(/;
    let methode = '(hors méthode)';
    const sites = [];
    lignes.forEach((ligne, index) => {
        const m = entete.exec(ligne);
        if (m)
            methode = m[1];
        if (/dayOrders(\[[^\]]*\])?\s*=[^=]/.test(ligne) || /dayOrders\[[^\]]*\]\s*=/.test(ligne))
            sites.push(`${methode} (app.js:${index + 1})`);
    });
    assert.deepEqual([...new Set(sites.map((s) => s.split(' ')[0]))], ['saveDefaultOrder'],
        'seul « Enregistrer comme ordre par défaut » écrit dayOrders');
    assert.ok(sites.length > 0, 'la garde doit réellement trouver les écritures');
    assert.doesNotMatch(APP, /Ordre mémorisé pour tous tes prochains/, 'plus de mémorisation automatique');
});

test('3. l’ordre par défaut, lui, s’écrit bien sur demande explicite', () => {
    const corps = APP.slice(APP.indexOf('async saveDefaultOrder'), APP.indexOf('async restoreProgramOrder'));
    assert.match(corps, /confirm\(/, 'une confirmation est demandée');
    assert.match(corps, /dayOrders\[context\.day\.id\] = \[\.\.\.context\.session\.exerciseOrder\]/);
    assert.match(corps, /Ordre par défaut enregistré\./);
});

test('4. après reload, la séance garde SON ordre', () => {
    const { day } = seance('push-a');
    const ordrePerso = moveInOrder(programOrder(day), 'push-a-pushdown', -3, day);
    // Rechargement : on repart de la session persistée.
    const apresReload = pickSessionOrder({ sessionOrder: ordrePerso, preferredOrder: programOrder(day),
        orderCustomized: true, day });
    assert.deepEqual(apresReload, ordrePerso, 'l’ordre par défaut ne réécrase pas la séance en cours');
});

test('14. l’ordre par défaut s’applique à une NOUVELLE séance', () => {
    const day = findDay('push-a');
    const defaut = moveInOrder(programOrder(day), 'push-a-lateral', -3, day);
    const nouvelle = pickSessionOrder({ sessionOrder: [], preferredOrder: defaut, orderCustomized: false, day });
    assert.deepEqual(nouvelle, defaut);
    // …mais pas à une séance déjà personnalisée.
    const perso = moveInOrder(programOrder(day), 'push-a-pushdown', -1, day);
    assert.deepEqual(pickSessionOrder({ sessionOrder: perso, preferredOrder: defaut, orderCustomized: true, day }), perso);
});

// ============================== 5. LE MODE EXÉCUTION SUIT L'ORDRE

test('5. le Mode Exécution utilise le nouvel ordre immédiatement', () => {
    const { day, session } = seance('push-b');
    const dernier = session.exerciseOrder.filter((id) => !findExercise(id).warmupProtocol).at(-1);
    session.exerciseOrder = normalizeOrder([dernier, ...session.exerciseOrder.filter((id) => id !== dernier)], day);
    const step = computeExecutionStep({ day, session, resolvePlan: planFor(1) });
    assert.equal(step.exerciseId, dernier, 'la séance démarre par l’exercice remonté en premier');
    assert.equal(step.stage, STAGES.WORK_SET);
});

// ============================== 6-9. MACHINE OCCUPÉE

test('6. « faire plus tard » place l’exercice après les exercices incomplets', () => {
    const { day, session } = seance('push-a');
    const [a, b, c, d, e] = session.exerciseOrder;
    const resultat = deferExercise(session.exerciseOrder, b, { isPending: pendingFor(day, session), day });
    assert.equal(resultat.moved, true);
    assert.equal(resultat.order.indexOf(a), 0, 'A ne bouge pas');
    assert.ok(resultat.order.indexOf(b) > resultat.order.indexOf(e), 'B passe après les suivants');
    assert.equal(resultat.order.indexOf(c), 1);
    assert.equal(resultat.order.indexOf(d), 2);
    assert.equal(resultat.order.length, session.exerciseOrder.length);
});

test('7. « faire plus tard » ne marque RIEN comme passé', () => {
    const { day, session } = seance('push-a', { setsFaits: { 'push-a-chest-press': 2 } });
    const avant = JSON.parse(JSON.stringify(session.exercises));
    deferExercise(session.exerciseOrder, 'push-a-chest-press', { isPending: pendingFor(day, session), day });
    assert.deepEqual(session.exercises, avant, 'aucun log touché');
    assert.equal(session.exercises['push-a-chest-press'].skipped, false, 'jamais skipped');
});

test('8+9. un exercice à 2/4 séries déplacé garde ses 2 séries et reprend en 3/4', () => {
    const { day, session } = seance('push-a', { rampsFaites: ['push-a-incline-smith'], setsFaits: { 'push-a-incline-smith': 2 } });
    const plan = getExercisePlan(findExercise('push-a-incline-smith'), 1);
    assert.equal(plan.sets, 4);
    const resultat = deferExercise(session.exerciseOrder, 'push-a-incline-smith', { isPending: pendingFor(day, session), day });
    session.exerciseOrder = resultat.order;
    assert.equal(session.exercises['push-a-incline-smith'].sets.filter((s) => s.done).length, 2, '2 séries conservées');
    // On termine tout le reste : Colosse doit revenir sur l'exercice reporté.
    for (const id of session.exerciseOrder) {
        if (id === 'push-a-incline-smith')
            continue;
        const ex = findExercise(id);
        if (ex.kind === 'cardio') {
            session.exercises[id].sets[0].done = true;
            continue;
        }
        const p = getExercisePlan(ex, 1);
        session.exercises[id].sets.slice(0, p.sets).forEach((set) => { set.done = true; });
        session.warmup.ramps[id] = { referenceLoadKg: 100, done: [true, true, true] };
    }
    const step = computeExecutionStep({ day, session, resolvePlan: planFor(1) });
    assert.equal(step.exerciseId, 'push-a-incline-smith');
    assert.equal(step.stage, STAGES.WORK_SET, 'pas de rampes à refaire');
    assert.equal(step.setIndex, 2, 'reprise en SÉRIE 3/4');
    assert.equal(step.totalSets, 4);
});

// ============================== 10-11. ÉCHAUFFEMENTS

test('10. le protocole de montée en charge reste attaché à l’exercice', () => {
    const { day, session } = seance('push-a');
    const avant = day.exercises.map((ex) => `${ex.id}:${ex.warmupProtocol ?? '-'}`);
    session.exerciseOrder = deferExercise(session.exerciseOrder, 'push-a-incline-smith',
        { isPending: pendingFor(day, session), day }).order;
    const apres = day.exercises.map((ex) => `${ex.id}:${ex.warmupProtocol ?? '-'}`);
    assert.deepEqual(apres, avant, 'primary reste primary, secondary reste secondary');
    assert.equal(findExercise('push-a-incline-smith').warmupProtocol, 'primary');
    assert.equal(findExercise('push-a-chest-press').warmupProtocol, 'secondary');
});

test('11. une montée en charge déjà faite n’est pas refaite après déplacement', () => {
    const { day, session } = seance('push-a', { rampsFaites: ['push-a-incline-smith'] });
    session.exerciseOrder = normalizeOrder(['push-a-chest-press', ...session.exerciseOrder.filter((id) => id !== 'push-a-chest-press')], day);
    const step = computeExecutionStep({ day, session, resolvePlan: planFor(1) });
    assert.equal(step.exerciseId, 'push-a-chest-press', 'on commence par l’exercice remonté');
    // On boucle jusqu'au Smith : ses rampes doivent rester validées.
    assert.deepEqual(session.warmup.ramps['push-a-incline-smith'].done, [true, true, true]);
    const smith = { ...session, exerciseOrder: normalizeOrder(['push-a-incline-smith', ...session.exerciseOrder], day) };
    const stepSmith = computeExecutionStep({ day, session: smith, resolvePlan: planFor(1) });
    assert.equal(stepSmith.exerciseId, 'push-a-incline-smith');
    assert.equal(stepSmith.stage, STAGES.WORK_SET, 'rampes déjà faites : on va direct au travail');
});

// ============================== 12-13. CARDIO ET EXERCICES TERMINÉS

test('12. le cardio reste épinglé en dernier', () => {
    const day = findDay('pull-a');
    const cardio = day.exercises.find((ex) => ex.kind === 'cardio').id;
    // Quoi qu'on tente, il repasse à la fin.
    assert.equal(normalizeOrder([cardio, ...programOrder(day).filter((id) => id !== cardio)], day).at(-1), cardio);
    assert.equal(pinCardioLast([cardio, 'pull-a-hammer'], day).at(-1), cardio);
    assert.equal(moveInOrder(programOrder(day), cardio, -3, day).at(-1), cardio, '↑ ne le sort pas de la fin');
    const { session } = seance('pull-a');
    const refus = deferExercise(session.exerciseOrder, cardio, { isPending: () => true, day });
    assert.equal(refus.moved, false);
    assert.equal(refus.reason, 'cardio-pinned');
});

test('13. un exercice terminé n’est jamais réexécuté après réorganisation', () => {
    const { day, session } = seance('push-a', { rampsFaites: ['push-a-incline-smith'], setsFaits: { 'push-a-incline-smith': 4 } });
    // On remet l'exercice terminé en tête.
    session.exerciseOrder = normalizeOrder(['push-a-incline-smith', ...session.exerciseOrder.filter((id) => id !== 'push-a-incline-smith')], day);
    const step = computeExecutionStep({ day, session, resolvePlan: planFor(1) });
    assert.notEqual(step.exerciseId, 'push-a-incline-smith', 'terminé = ignoré pour l’étape suivante');
    assert.equal(session.exercises['push-a-incline-smith'].sets.filter((s) => s.done).length, 4, 'ses séries restent');
    assert.equal(isExercisePending(findExercise('push-a-incline-smith'), session.exercises['push-a-incline-smith'], getExercisePlan(findExercise('push-a-incline-smith'), 1)), false);
});

// ============================== 15. RESTAURATION

test('15. restaurer l’ordre du programme ne supprime aucune donnée', () => {
    const { day, session } = seance('push-a', { rampsFaites: ['push-a-incline-smith'], setsFaits: { 'push-a-incline-smith': 2, 'push-a-lateral': 1 } });
    session.exerciseOrder = deferExercise(session.exerciseOrder, 'push-a-incline-smith',
        { isPending: pendingFor(day, session), day }).order;
    const exercicesAvant = JSON.parse(JSON.stringify(session.exercises));
    const warmupAvant = JSON.parse(JSON.stringify(session.warmup));
    session.exerciseOrder = normalizeOrder(programOrder(day), day);
    assert.deepEqual(session.exerciseOrder, programOrder(day));
    assert.deepEqual(session.exercises, exercicesAvant, 'aucune série touchée');
    assert.deepEqual(session.warmup, warmupAvant, 'aucune montée en charge touchée');
});

// ============================== TIMER ET INTERFACE

test('réorganiser est interdit pendant repos, montée en charge et changement de côté', () => {
    assert.deepEqual(REORDER_BLOCKING_TIMERS, ['side-switch', 'work-rest', 'ramp-rest']);
    for (const kind of REORDER_BLOCKING_TIMERS)
        assert.equal(canReorder(createTimer(kind, 60, {}, 0)), false, `${kind} bloque`);
    for (const kind of ['general-warmup', 'activation-rest', 'cardio', 'recovery'])
        assert.equal(canReorder(createTimer(kind, 60, {}, 0)), true, `${kind} n’empêche pas`);
    assert.equal(canReorder(null), true);
});

test('le panneau bloqué affiche le message et aucune poignée', () => {
    const rows = [{ id: 'a', name: 'A', stateLabel: 'à faire', done: false, locked: false }];
    const bloque = renderReorderPanel({ dayName: 'Push A', rows, blocked: true });
    assert.match(bloque, /Termine ou passe le chrono avant de réorganiser\./);
    assert.doesNotMatch(bloque, /data-drag-handle/);
    const libre = renderReorderPanel({ dayName: 'Push A', rows, blocked: false });
    assert.match(libre, /data-drag-handle/);
});

test('le cardio n’a pas de poignée dans le panneau, les autres oui', () => {
    const rows = [
        { id: 'a', name: 'A', stateLabel: 'à faire', done: false, locked: false },
        { id: 'b', name: 'B', stateLabel: '2/4 séries', done: false, locked: false },
        { id: 'walk', name: 'Marche inclinée', stateLabel: 'fin de séance', done: false, locked: true },
    ];
    const html = renderReorderPanel({ dayName: 'Pull A', rows, blocked: false });
    assert.equal((html.match(/data-drag-handle/g) ?? []).length, 2, 'une poignée par exercice déplaçable');
    assert.equal((html.match(/data-drag-item/g) ?? []).length, 3);
    assert.match(html, /data-drag-locked="true"/);
    // Les flèches restent comme secours accessible.
    assert.equal((html.match(/data-action="move-exercise"/g) ?? []).length, 6);
    for (const action of ['reorder-close', 'reorder-save-default', 'reorder-restore'])
        assert.ok(html.includes(action), `${action} présent`);
});

test('le menu ⋯ propose réorganiser, faire plus tard et passer', () => {
    const menu = renderExecMenu({ canDefer: true, exerciseName: 'Chest press' });
    for (const action of ['exec-reorder', 'exec-defer', 'exec-skip', 'exec-menu-close'])
        assert.ok(menu.includes(`data-action="${action}"`), `${action} présent`);
    // Sur une étape cardio, « faire plus tard » disparaît (le cardio est épinglé).
    const sansDefer = renderExecMenu({ canDefer: false, exerciseName: null });
    assert.equal(sansDefer.includes('exec-defer'), false);
    assert.equal(sansDefer.includes('exec-skip'), false);
});

test('normalizeOrder répare un ordre corrompu sans rien perdre', () => {
    const day = findDay('push-a');
    const attendu = programOrder(day);
    assert.deepEqual(normalizeOrder(['inconnu', 'push-a-lateral', 'push-a-lateral'], day).length, attendu.length);
    assert.deepEqual([...normalizeOrder([], day)].sort(), [...attendu].sort());
    assert.deepEqual([...normalizeOrder(null, day)].sort(), [...attendu].sort());
    assert.equal(normalizeOrder(['inconnu', 'push-a-lateral'], day)[0], 'push-a-lateral');
});
