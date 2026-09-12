// Logique de séance — fonctions PURES, testables sans DOM ni IndexedDB.
// Extraites de app.js pour que les tests portent sur le comportement réel.

/** Décalage du jour dans une semaine qui commence le lundi. Dimanche = +6, jamais -1. */
export function weekdayOffset(weekday) {
    return weekday === 0 ? 6 : weekday - 1;
}

/** Un exercice passé (skipped) ne compte AUCUNE série réalisée. */
export function countSessionSets(session, day, resolvePlan) {
    let done = 0;
    let total = 0;
    let skipped = 0;
    for (const exercise of day.exercises) {
        const plan = resolvePlan(exercise);
        const log = session?.exercises?.[exercise.id];
        if (!log)
            continue;
        total += plan.sets;
        if (log.skipped) {
            skipped += 1;
            continue; // done += 0
        }
        done += log.sets.slice(0, plan.sets).filter((set) => set.done).length;
    }
    return { done, total, skipped, complete: total > 0 && done >= total && skipped === 0 };
}

export function isSessionComplete(session, day, resolvePlan) {
    return countSessionSets(session, day, resolvePlan).complete;
}

/**
 * Compte les séances de MUSCULATION terminées.
 * La récupération est exclue : elle ne fait jamais monter le compteur.
 */
export function countCompletedStrengthSessions(days, findSession, resolvePlan) {
    return days
        .filter((day) => day.kind !== 'recovery')
        .filter((day) => {
            const session = findSession(day);
            if (!session)
                return false;
            // Le resolver reçoit la SESSION : une séance de décharge (S7) est
            // évaluée avec son propre weekIndex, pas celui de la semaine affichée.
            return isSessionComplete(session, day, (exercise) => resolvePlan(exercise, session));
        }).length;
}

/** RIR cible de LA série en cours (section 13). */
export function targetRirForSet(plan, setIndex) {
    return plan?.rirBySet?.[setIndex] ?? plan?.targetRir ?? 1;
}

/** Une série est-elle validable ? Dépend du loadMode de la variante. */
export function isSetValid(set, plan, variant) {
    const amount = Number(set?.reps);
    if (!(amount > 0))
        return { valid: false, reason: plan?.metric === 'seconds' ? 'duration_required' : 'reps_required' };
    const loadMode = variant?.loadMode ?? 'external';
    if (loadMode === 'external' && !(Number(set?.weightKg) > 0))
        return { valid: false, reason: 'load_required' };
    return { valid: true, reason: null };
}

/** Une série compte-t-elle dans l'historique de prescription ? */
export function countsForHistory(set, variant) {
    if (!set?.done || !(Number(set.reps) > 0))
        return false;
    const loadMode = variant?.loadMode ?? 'external';
    if (loadMode === 'bodyweight')
        return true;               // charge externe 0 autorisée
    if (loadMode === 'assistance')
        return Number(set.weightKg) >= 0; // l'assistance peut atteindre 0 (= plus d'aide)
    return Number(set.weightKg) > 0;
}

/** Étapes d'une série unilatérale : gauche -> changement -> droite -> repos. */
export const SIDE_STEPS = ['left', 'switch', 'right', 'rest'];
export function nextSideStep(current) {
    const i = SIDE_STEPS.indexOf(current);
    return i === -1 || i === SIDE_STEPS.length - 1 ? SIDE_STEPS[0] : SIDE_STEPS[i + 1];
}
export function sideStepDuration(step, plan) {
    if (step === 'switch')
        return plan?.sideSwitchSec ?? 0;
    if (step === 'rest')
        return plan?.roundRestSec ?? plan?.restSec ?? 0;
    return 0;
}
export function sideStepLabel(step) {
    return { left: 'CÔTÉ GAUCHE', switch: 'CHANGEMENT DE CÔTÉ', right: 'CÔTÉ DROIT', rest: 'REPOS' }[step] ?? '';
}

/** Formatage d'une durée en mm:ss (pour les exercices mesurés en secondes). */
export function formatSeconds(totalSec) {
    const s = Math.max(0, Math.round(Number(totalSec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Statut de fin de séance (section 10 de l'audit). */
export function finishStatus(count) {
    return count.complete
        ? { status: 'COMPLETE', message: 'Séance validée.' }
        : { status: 'INCOMPLETE', message: `Séance enregistrée comme INCOMPLÈTE — ${count.done}/${count.total} séries réalisées.` };
}

/**
 * Agrégation d'une série unilatérale (audit v3.5.1).
 * Le côté fort ne doit jamais masquer le côté faible.
 *   reps      = minimum des deux côtés
 *   rir       = marge la plus faible (le plus dur)
 *   technique = dégradée si UN SEUL côté l'est
 *   douleur   = maximum des deux côtés
 * Rétrocompatible : une série sans `sides` est renvoyée telle quelle.
 */
export function aggregateSides(set) {
    const sides = set?.sides;
    if (!sides || !sides.left?.done || !sides.right?.done)
        return null;
    const num = (v, fallback = null) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
    const lr = num(sides.left.reps), rr = num(sides.right.reps);
    const lRir = num(sides.left.rir), rRir = num(sides.right.rir);
    const lPain = num(sides.left.pain, 0), rPain = num(sides.right.pain, 0);
    return {
        reps: lr !== null && rr !== null ? Math.min(lr, rr) : (lr ?? rr),
        rir: lRir !== null && rRir !== null ? Math.min(lRir, rRir) : (lRir ?? rRir),
        technique: sides.left.technique === 'degraded' || sides.right.technique === 'degraded' ? 'degraded' : 'good',
        pain: Math.max(lPain ?? 0, rPain ?? 0),
    };
}

/** Côté à exécuter maintenant pour une série unilatérale. */
export function currentSide(set) {
    if (set?.sides?.left?.done && !set.sides.right?.done)
        return 'right';
    return 'left';
}

/** Les deux côtés ont-ils été réalisés ? */
export function bothSidesDone(set) {
    return !!(set?.sides?.left?.done && set?.sides?.right?.done);
}

/**
 * Clôture d'une séance. Déterministe : aucun timer ne survit, le mode exécution
 * est désactivé. Renvoie une nouvelle session, ne modifie pas l'originale.
 */
export function closeSession(session, { now = Date.now(), status = 'INCOMPLETE' } = {}) {
    if (!session)
        return session;
    return {
        ...session,
        endedAt: now,
        status,
        activeTimer: null,
        execution: { ...(session.execution ?? {}), active: false, stage: null, updatedAt: now },
        updatedAt: now,
    };
}

/**
 * Changement de variante : l'exercice repart de zéro. Les séries faites sur
 * l'ancienne machine ne sont jamais conservées (charges et incréments diffèrent).
 */
export function resetExerciseLogForVariant(log, variantId, setCount, createSet) {
    return {
        ...(log ?? {}),
        variantId,
        skipped: false,
        sets: Array.from({ length: Math.max(0, Number(setCount) || 0) }, () => createSet()),
    };
}

/**
 * Règle des exercices chronométrés (cardio, récupération) : accompli UNIQUEMENT
 * si la durée réellement enregistrée atteint la durée prescrite.
 * Aucune validation à la main, jamais.
 */
export function timedExerciseStatus(recordedSec, prescribedSec, validated = undefined) {
    const num = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };
    const recorded = num(recordedSec);
    const prescribed = num(prescribedSec);
    // La durée atteint-elle la consigne ? C'est la condition nécessaire.
    const reaches = prescribed > 0 && recorded >= prescribed;
    // `validated` = ce qui est réellement enregistré (set.done). Omis : on ne
    // juge que la durée. Fourni : les deux doivent être d'accord, sinon
    // l'étape n'est pas accomplie (donnée héritée, ou chrono rallongé et
    // arrêté avant la fin).
    const done = reaches && (validated === undefined ? true : validated === true);
    // Donnée antérieure à v3.5.3 : étape validée à la main, sans durée. On ne
    // réécrit pas l'historique — l'affichage reste aligné sur les compteurs,
    // mais il dit qu'aucune durée n'a été chronométrée.
    const legacy = validated === true && !reaches;
    const started = recorded > 0;
    return {
        recordedSec: recorded,
        prescribedSec: prescribed,
        reaches,
        done,
        legacy,
        started,
        partial: started && !done && !legacy,
        label: done
            ? `${formatSeconds(recorded)} réalisé`
            : legacy
                ? 'validé sans chrono'
                : started
                    ? `${formatSeconds(recorded)} / ${formatSeconds(prescribed)} — incomplet`
                    : formatSeconds(prescribed),
        actionLabel: done || legacy ? '↻ Refaire' : started ? '↻ Reprendre' : '▶ Démarrer',
    };
}

/**
 * Actions autorisées sur un exercice chronométré. Il n'en existe que deux :
 * lancer le chrono, ou arrêter celui qui tourne. Aucune ne valide l'étape.
 */
export function timedExerciseActions(status, running = false) {
    if (running)
        return [{ action: 'finish-cardio', label: '■ Arrêter le chrono', style: 'secondary' }];
    return [{ action: 'start-cardio', label: status?.actionLabel ?? '▶ Démarrer', style: 'primary' }];
}

/**
 * Demande d'arrêt d'un exercice chronométré.
 * Sans chrono en cours pour CET exercice, il n'y a rien à arrêter : on refuse.
 * C'est ce refus qui interdit de valider un cardio sans l'avoir fait.
 */
export function timedStopRequest(activeTimer, exerciseId) {
    if (activeTimer && activeTimer.context?.exerciseId === exerciseId)
        return { action: 'resolve-timer', kind: activeTimer.kind };
    return { action: 'refuse', reason: 'no-active-timer' };
}
