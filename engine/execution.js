// Mode Exécution — machine à états PURE.
// L'étape courante est DÉRIVÉE de l'état persisté : après un reload,
// un verrouillage ou un kill de la PWA, on retombe au même endroit.

import {
    activationSteps, computeRampSets, getRampProtocol, isActivationComplete, isGeneralWarmupDone,
    nextActivationStep, nextRampIndex, normalizeWarmupState, resolveReferenceLoad, rampsRequested,
} from './warmup.js';
import { targetRirForSet, currentSide } from './session.js';

export const STAGES = {
    GENERAL_WARMUP: 'GENERAL_WARMUP',
    ACTIVATION: 'ACTIVATION',
    RAMP_SET: 'RAMP_SET',
    WORK_SET: 'WORK_SET',
    SIDE_SWITCH: 'SIDE_SWITCH',
    REST: 'REST',
    CARDIO: 'CARDIO',
    RECOVERY: 'RECOVERY',
    NEEDS_REFERENCE_LOAD: 'NEEDS_REFERENCE_LOAD',
    SESSION_COMPLETE: 'SESSION_COMPLETE',
};

export function emptyExecutionState() {
    return { active: false, stage: null, exerciseId: null, setIndex: null, side: null, stepKey: null, updatedAt: 0 };
}

export function normalizeExecutionState(state) {
    return { ...emptyExecutionState(), ...(state && typeof state === 'object' ? state : {}) };
}

function variantOf(exercise, log) {
    return exercise.variants?.find((v) => v.id === log?.variantId) ?? exercise.variants?.[0] ?? null;
}

function workSetsDone(log, plan) {
    return (log?.sets ?? []).slice(0, plan.sets).filter((set) => set.done).length;
}

function workStarted(session) {
    return Object.values(session?.exercises ?? {}).some((log) => (log?.sets ?? []).some((set) => set?.done || set?.sides?.left?.done));
}

/** Ordre d'exécution : respecte l'ordre mémorisé de la séance. */
export function orderedExercises(day, session) {
    const byId = new Map(day.exercises.map((ex) => [ex.id, ex]));
    const order = Array.isArray(session?.exerciseOrder) && session.exerciseOrder.length
        ? session.exerciseOrder
        : day.exercises.map((ex) => ex.id);
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    for (const ex of day.exercises)
        if (!ordered.includes(ex))
            ordered.push(ex);
    return ordered;
}

/**
 * Étape courante du mode exécution, dérivée entièrement de la session.
 * ctx = { day, session, resolvePlan }
 */
export function computeExecutionStep({ day, session, resolvePlan }) {
    const warmup = normalizeWarmupState(session?.warmup);
    const exercises = orderedExercises(day, session);

    // Journée de récupération : pas d'échauffement musculation.
    if (day.kind === 'recovery') {
        for (const exercise of exercises) {
            const log = session?.exercises?.[exercise.id];
            if (!log?.sets?.[0]?.done)
                return { stage: STAGES.RECOVERY, exercise, exerciseId: exercise.id, setIndex: 0, side: null,
                         stepKey: `recovery:${exercise.id}`, durationSec: exercise.durationSec ?? 0 };
        }
        return { stage: STAGES.SESSION_COMPLETE, stepKey: 'complete' };
    }

    // Une fois des séries validées (séance menée depuis la liste par exemple), l'échauffement général et les
    // activations ne s'imposent plus. Séance neuve : ils restent les premières étapes (avec « Passer »).
    const warmupDeferred = workStarted(session);
    if (!warmupDeferred && !isGeneralWarmupDone(warmup))
        return { stage: STAGES.GENERAL_WARMUP, stepKey: 'general-warmup', exercise: null, exerciseId: null, setIndex: null, side: null };

    if (!warmupDeferred && !isActivationComplete(warmup, day)) {
        const step = nextActivationStep(warmup, day);
        return { stage: STAGES.ACTIVATION, activation: step, stepKey: `activation:${step.key}`,
                 exercise: null, exerciseId: null, setIndex: null, side: step.side };
    }

    for (const exercise of exercises) {
        const log = session?.exercises?.[exercise.id];
        if (!log || log.skipped)
            continue;

        if (exercise.kind === 'cardio') {
            if (!log.sets?.[0]?.done)
                return { stage: STAGES.CARDIO, exercise, exerciseId: exercise.id, setIndex: 0, side: null,
                         stepKey: `cardio:${exercise.id}`, durationSec: exercise.durationSec ?? 0 };
            continue;
        }

        const plan = resolvePlan(exercise);
        const done = workSetsDone(log, plan);
        if (done >= plan.sets)
            continue;

        // Montée en charge : PROPOSÉE sur la première série, faite seulement si demandée.
        // « Faire maintenant » mène donc toujours directement aux séries de travail.
        const variant = variantOf(exercise, log);
        let rampOffer = null;
        if (exercise.warmupProtocol && done === 0) {
            const protocol = getRampProtocol(exercise) ?? [];
            if (rampsRequested(warmup, exercise.id, protocol.length)) {
                const demandee = warmup.ramps[exercise.id];
                // Charge indiquée au moment de demander l'échauffement : prioritaire sur le pré-remplissage.
                const reference = resolveReferenceLoad({
                    firstWorkSetLoadKg: demandee?.requested === true && Number(demandee.referenceLoadKg) > 0 ? demandee.referenceLoadKg : log.sets?.[0]?.weightKg,
                    prescriptionLoadKg: log.prescription?.loadKg,
                    storedReferenceKg: warmup.ramps[exercise.id]?.referenceLoadKg,
                });
                const ramps = reference.needsInput ? [] : computeRampSets(exercise, reference.loadKg, variant?.incrementKg ?? 2.5);
                const rampIndex = nextRampIndex(warmup, exercise.id, ramps);
                if (rampIndex >= 0)
                    return { stage: STAGES.RAMP_SET, exercise, exerciseId: exercise.id, setIndex: rampIndex, side: null,
                             stepKey: `ramp:${exercise.id}:${rampIndex}`, ramp: ramps[rampIndex], ramps,
                             referenceLoadKg: reference.loadKg, plan };
            }
            const entry = warmup.ramps[exercise.id];
            const allDone = protocol.length > 0 && protocol.every((_, index) => !!entry?.done?.[index]);
            if (protocol.length && !entry?.skipped && !allDone)
                rampOffer = { count: protocol.length };
        }

        const setIndex = done;
        const set = log.sets[setIndex];
        const side = plan.perSide ? currentSide(set) : null;
        return {
            stage: STAGES.WORK_SET, exercise, exerciseId: exercise.id, setIndex, side,
            stepKey: `work:${exercise.id}:${setIndex}:${side ?? 'both'}`,
            plan, variant, targetRir: targetRirForSet(plan, setIndex),
            totalSets: plan.sets, rampOffer,
        };
    }

    return { stage: STAGES.SESSION_COMPLETE, stepKey: 'complete', exercise: null, exerciseId: null, setIndex: null, side: null };
}

export function isExecutionComplete(ctx) {
    return computeExecutionStep(ctx).stage === STAGES.SESSION_COMPLETE;
}

/**
 * Avancement global : étapes obligatoires réalisées / total.
 * Les séries de montée en charge SONT des étapes du mode exécution (option A)
 * — mais elles n'entrent jamais dans le nombre de séries de travail, le
 * tonnage, l'e1RM ni le volume d'hypertrophie : ce compteur est le seul
 * endroit où elles sont comptées.
 */
export function executionProgress({ day, session, resolvePlan }) {
    const warmup = normalizeWarmupState(session?.warmup);
    let done = 0;
    let total = 0;
    if (day.kind !== 'recovery') {
        // Travail commencé sans échauffement : les étapes non faites ne sont plus dues (sinon jamais 100 %).
        const dues = !workStarted(session);
        const general = isGeneralWarmupDone(warmup);
        total += dues || general ? 1 : 0;
        if (general)
            done += 1;
        const steps = activationSteps(day);
        const faites = steps.filter((s) => warmup.activation[s.key]).length;
        total += dues ? steps.length : faites;
        done += faites;
    }
    for (const exercise of orderedExercises(day, session)) {
        const log = session?.exercises?.[exercise.id];
        if (exercise.kind === 'cardio') {
            total += 1;
            if (log?.sets?.[0]?.done)
                done += 1;
            continue;
        }
        const plan = resolvePlan(exercise);
        // Montée en charge facultative : elle n'entre dans l'avancement que si elle a été demandée ou faite.
        const ramps = getRampProtocol(exercise) ?? [];
        const rampsDone = warmup.ramps[exercise.id]?.done ?? [];
        const rampsCounted = rampsRequested(warmup, exercise.id, ramps.length) || ramps.some((_, index) => !!rampsDone[index]);
        total += (rampsCounted ? ramps.length : 0) + plan.sets;
        if (log?.skipped)
            continue;
        if (rampsCounted)
            done += ramps.filter((_, index) => !!rampsDone[index]).length;
        done += workSetsDone(log, plan);
    }
    return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** Libellé lisible de l'étape (pour l'UI et les tests). */
export function stageLabel(stage) {
    return {
        [STAGES.GENERAL_WARMUP]: 'Échauffement général',
        [STAGES.ACTIVATION]: 'Activation',
        [STAGES.RAMP_SET]: 'Montée en charge',
        [STAGES.WORK_SET]: 'Série de travail',
        [STAGES.SIDE_SWITCH]: 'Changement de côté',
        [STAGES.REST]: 'Repos',
        [STAGES.CARDIO]: 'Cardio',
        [STAGES.RECOVERY]: 'Récupération',
        [STAGES.NEEDS_REFERENCE_LOAD]: 'Charge de travail',
        [STAGES.SESSION_COMPLETE]: 'Séance terminée',
    }[stage] ?? stage;
}

// ---------------------------------------------------------------------------
// Réorganisation des exercices (l'ordre dépend des machines libres en salle).
// Tout est PUR : app.js ne fait qu'appeler et persister.
// ---------------------------------------------------------------------------

/** Pendant ces chronos, réorganiser casserait le contexte de l'étape en cours. */
export const REORDER_BLOCKING_TIMERS = ['side-switch', 'work-rest', 'ramp-rest'];

export function canReorder(activeTimer) {
    if (!activeTimer)
        return true;
    return !REORDER_BLOCKING_TIMERS.includes(activeTimer.kind);
}

/** Ordre d'origine du programme. */
export function programOrder(day) {
    return (day?.exercises ?? []).map((exercise) => exercise.id);
}

function cardioIds(day) {
    return new Set((day?.exercises ?? []).filter((exercise) => exercise.kind === 'cardio').map((exercise) => exercise.id));
}

/** Le cardio de fin de séance reste en dernier, quoi qu'il arrive. */
export function pinCardioLast(order, day) {
    const cardio = cardioIds(day);
    const list = Array.isArray(order) ? order : [];
    return [...list.filter((id) => !cardio.has(id)), ...list.filter((id) => cardio.has(id))];
}

/** Ordre valide : ids connus, sans doublon, exercices manquants ajoutés, cardio en dernier. */
export function normalizeOrder(order, day) {
    const valid = programOrder(day);
    const seen = new Set();
    const kept = [];
    for (const id of Array.isArray(order) ? order : []) {
        if (!valid.includes(id) || seen.has(id))
            continue;
        seen.add(id);
        kept.push(id);
    }
    for (const id of valid)
        if (!seen.has(id))
            kept.push(id);
    return pinCardioLast(kept, day);
}

/**
 * Quel ordre appliquer à une séance : le sien s'il a été personnalisé,
 * sinon l'ordre par défaut du jour (settings.dayOrders), sinon le programme.
 */
export function pickSessionOrder({ sessionOrder, preferredOrder, orderCustomized, day }) {
    const usePreferred = !orderCustomized && Array.isArray(preferredOrder) && preferredOrder.length > 0;
    return normalizeOrder(usePreferred ? preferredOrder : sessionOrder, day);
}

/** Déplacement d'un cran (boutons ↑ ↓). */
export function moveInOrder(order, exerciseId, offset, day) {
    const list = normalizeOrder(order, day);
    const from = list.indexOf(exerciseId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= list.length)
        return list;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return normalizeOrder(next, day);
}

/**
 * « Machine occupée — faire plus tard » : l'exercice passe APRÈS tous ceux qui
 * restent à faire. Il n'est JAMAIS marqué skipped, il ne perd aucune série.
 * `isPending(id)` = il reste du travail sur cet exercice.
 */
export function deferExercise(order, exerciseId, { isPending, day }) {
    const list = normalizeOrder(order, day);
    if (!list.includes(exerciseId))
        return { order: list, moved: false, reason: 'unknown-exercise' };
    const cardio = cardioIds(day);
    if (cardio.has(exerciseId))
        return { order: list, moved: false, reason: 'cardio-pinned' };
    const rest = list.filter((id) => id !== exerciseId);
    const lastPending = [...rest].reverse().find((id) => !cardio.has(id) && isPending(id));
    if (lastPending === undefined)
        return { order: list, moved: false, reason: 'nothing-else-pending' };
    const at = rest.indexOf(lastPending);
    rest.splice(at + 1, 0, exerciseId);
    return { order: normalizeOrder(rest, day), moved: true, reason: null };
}

/** Il reste du travail sur cet exercice ? (ni terminé, ni passé) */
export function isExercisePending(exercise, log, plan) {
    if (!log || log.skipped)
        return false;
    if (exercise?.kind === 'cardio')
        return !log.sets?.[0]?.done;
    return workSetsDone(log, plan) < plan.sets;
}

// ---------------------------------------------------------------------------
// « Faire maintenant » : choisir le prochain exercice. PUR, par l'ordre seul :
// aucune série n'est touchée, rien n'est passé, la variante ne change pas.
// ---------------------------------------------------------------------------

/**
 * Place l'exercice (et son groupe de superset éventuel) juste avant le premier
 * exercice encore à faire. Les exercices terminés gardent leur place, le
 * cardio de fin reste épinglé.
 */
export function bringToFront(order, exerciseId, { isPending, day }) {
    const list = normalizeOrder(order, day);
    const exercise = (day?.exercises ?? []).find((item) => item.id === exerciseId);
    if (!exercise || !list.includes(exerciseId))
        return { order: list, moved: false, reason: 'unknown-exercise' };
    if (exercise.kind === 'cardio')
        return { order: list, moved: false, reason: 'cardio-pinned' };
    if (!isPending(exerciseId))
        return { order: list, moved: false, reason: 'not-pending' };
    const cardio = new Set((day?.exercises ?? []).filter((item) => item.kind === 'cardio').map((item) => item.id));
    const group = exercise.superset
        ? list.filter((id) => (day.exercises.find((item) => item.id === id)?.superset) === exercise.superset)
        : [exerciseId];
    const rest = list.filter((id) => !group.includes(id));
    let at = rest.findIndex((id) => !cardio.has(id) && isPending(id));
    if (at < 0) {
        const firstCardio = rest.findIndex((id) => cardio.has(id));
        at = firstCardio < 0 ? rest.length : firstCardio;
    }
    const next = normalizeOrder([...rest.slice(0, at), ...group, ...rest.slice(at)], day);
    const moved = next.join('|') !== list.join('|');
    return { order: next, moved, reason: moved ? null : 'already-next' };
}

/** Exercice unilatéral dont une série est à moitié faite (gauche validée, droite à faire). */
export function halfDoneUnilateral(session, day, resolvePlan) {
    for (const exercise of day?.exercises ?? []) {
        const plan = exercise.kind === 'cardio' ? null : resolvePlan(exercise);
        if (!plan?.perSide)
            continue;
        const sets = (session?.exercises?.[exercise.id]?.sets ?? []).slice(0, plan.sets);
        if (sets.some((set) => !set.done && set.sides?.left?.done && !set.sides?.right?.done))
            return exercise.id;
    }
    return null;
}

/**
 * Changer d'exercice en cours de séance : que faire du chrono actif ?
 * Aucun chrono n'est jamais réaffecté à un autre exercice.
 * - 'proceed'  : rien ne s'y oppose ;
 * - 'confirm'  : possible, mais la transition doit être acceptée (message) ;
 * - 'refuse'   : impossible pour l'instant (message).
 * `endTimer` indique qu'il faut arrêter le chrono (sa durée réelle est enregistrée).
 */
export function executionChangeDecision({ activeTimer, targetExerciseId, halfSetExerciseId = null, names = {} }) {
    const nom = (id) => names[id] ?? 'l’exercice en cours';
    // L'exercice du chrono lui-même (ex. pendant les 15 s entre les deux bras) : on y retourne, le chrono continue.
    if (activeTimer && activeTimer.kind !== 'transition' && activeTimer.context?.exerciseId === targetExerciseId)
        return { action: 'proceed', endTimer: false, reason: 'same-exercise', message: null };
    if (activeTimer?.kind === 'side-switch')
        return { action: 'refuse', endTimer: false, reason: 'side-switch',
            message: `Termine d’abord le côté droit de ${nom(activeTimer.context?.exerciseId)} (ou passe le chrono), puis choisis un autre exercice.` };
    // Repos entre deux exercices : on passe directement à celui qu'on a choisi.
    if (activeTimer?.kind === 'transition')
        return { action: 'proceed', endTimer: true, reason: 'transition', message: null };
    if (activeTimer && ['work-rest', 'ramp-rest', 'activation-rest'].includes(activeTimer.kind))
        return { action: 'confirm', endTimer: true, reason: 'rest-running',
            message: `Un repos est en cours${activeTimer.context?.exerciseId ? ` après ${nom(activeTimer.context.exerciseId)}` : ''}. Il sera arrêté maintenant (sa durée réelle est enregistrée) pour passer à ${nom(targetExerciseId)}. Continuer ?` };
    if (activeTimer && ['cardio', 'recovery'].includes(activeTimer.kind))
        return { action: 'confirm', endTimer: true, reason: 'timed-running',
            message: `${activeTimer.kind === 'recovery' ? 'La récupération' : 'Le cardio'} en cours sera arrêté à sa durée réelle et restera incomplet. Passer à ${nom(targetExerciseId)} ?` };
    if (halfSetExerciseId && halfSetExerciseId !== targetExerciseId)
        return { action: 'confirm', endTimer: false, reason: 'half-set',
            message: `${nom(halfSetExerciseId)} a une série commencée (côté gauche fait). Elle restera à reprendre au côté droit. Passer à ${nom(targetExerciseId)} ?` };
    // L'échauffement général peut continuer : l'exercice choisi viendra juste après.
    return { action: 'proceed', endTimer: false, reason: activeTimer?.kind === 'general-warmup' ? 'after-warmup' : null, message: null };
}

/**
 * Chrono à lancer après une série validée (3.6.3).
 * - série suivante à faire sur cet exercice → 'work-rest' (repos entre séries, durée réelle enregistrée) ;
 * - dernière série de l'exercice et un autre exercice reste à faire → 'transition'
 *   (repos avant l'exercice suivant : jamais enregistré comme repos de série) ;
 * - sinon (fin de séance, superset en cours) → aucun chrono.
 * Durée : repos de l'exercice (après les deux côtés pour un unilatéral), comme l'annonce la consigne.
 */
export function restAfterSetDecision({ plan, setIndex, isLastOfSuperset = true, inSuperset = false, maxSupersetSets = null, nextExercise = null }) {
    const restSec = plan?.perSide ? (plan.roundRestSec ?? plan.restSec) : plan?.restSec;
    const sets = inSuperset ? (maxSupersetSets ?? plan.sets) : plan.sets;
    if (inSuperset && !isLastOfSuperset)
        return { kind: null, durationSec: 0 };
    if (setIndex < sets - 1)
        return { kind: 'work-rest', durationSec: restSec };
    if (nextExercise)
        return { kind: 'transition', durationSec: restSec, nextExerciseId: nextExercise.id, nextName: nextExercise.name };
    return { kind: null, durationSec: 0 };
}
