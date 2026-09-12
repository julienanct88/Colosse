// Mode Exécution — machine à états PURE.
// L'étape courante est DÉRIVÉE de l'état persisté : après un reload,
// un verrouillage ou un kill de la PWA, on retombe au même endroit.

import {
    activationSteps, computeRampSets, getRampProtocol, isActivationComplete, isGeneralWarmupDone,
    nextActivationStep, nextRampIndex, normalizeWarmupState, resolveReferenceLoad,
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

    if (!isGeneralWarmupDone(warmup))
        return { stage: STAGES.GENERAL_WARMUP, stepKey: 'general-warmup', exercise: null, exerciseId: null, setIndex: null, side: null };

    if (!isActivationComplete(warmup, day)) {
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

        // Montée en charge avant la première série de travail.
        const variant = variantOf(exercise, log);
        if (exercise.warmupProtocol && done === 0) {
            const reference = resolveReferenceLoad({
                firstWorkSetLoadKg: log.sets?.[0]?.weightKg,
                prescriptionLoadKg: log.prescription?.loadKg,
                storedReferenceKg: warmup.ramps[exercise.id]?.referenceLoadKg,
            });
            if (reference.needsInput)
                return { stage: STAGES.NEEDS_REFERENCE_LOAD, exercise, exerciseId: exercise.id, setIndex: null,
                         side: null, stepKey: `reference:${exercise.id}` };
            const ramps = computeRampSets(exercise, reference.loadKg, variant?.incrementKg ?? 2.5);
            const rampIndex = nextRampIndex(warmup, exercise.id, ramps);
            if (rampIndex >= 0)
                return { stage: STAGES.RAMP_SET, exercise, exerciseId: exercise.id, setIndex: rampIndex, side: null,
                         stepKey: `ramp:${exercise.id}:${rampIndex}`, ramp: ramps[rampIndex], ramps,
                         referenceLoadKg: reference.loadKg };
        }

        const setIndex = done;
        const set = log.sets[setIndex];
        const side = plan.perSide ? currentSide(set) : null;
        return {
            stage: STAGES.WORK_SET, exercise, exerciseId: exercise.id, setIndex, side,
            stepKey: `work:${exercise.id}:${setIndex}:${side ?? 'both'}`,
            plan, variant, targetRir: targetRirForSet(plan, setIndex),
            totalSets: plan.sets,
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
        total += 1;
        if (isGeneralWarmupDone(warmup))
            done += 1;
        const steps = activationSteps(day);
        total += steps.length;
        done += steps.filter((s) => warmup.activation[s.key]).length;
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
        const ramps = getRampProtocol(exercise) ?? [];
        total += ramps.length + plan.sets;
        if (log?.skipped)
            continue;
        const rampsDone = warmup.ramps[exercise.id]?.done ?? [];
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
