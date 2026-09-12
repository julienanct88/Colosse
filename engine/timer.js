// Timer générique — fonctions PURES. Un seul moteur pour tous les usages.
// La vérité vient des timestamps absolus, jamais de setInterval.

export const TIMER_KINDS = [
    'general-warmup', 'activation-rest', 'ramp-rest',
    'side-switch', 'work-rest', 'cardio', 'recovery',
];

export const TIMER_LABELS = {
    'general-warmup': 'ÉCHAUFFEMENT',
    'activation-rest': 'TRANSITION',
    'ramp-rest': 'REPOS (montée en charge)',
    'side-switch': 'CHANGEMENT DE CÔTÉ',
    'work-rest': 'REPOS',
    cardio: 'CARDIO',
    recovery: 'RÉCUPÉRATION',
};

export function timerLabel(kind) {
    return TIMER_LABELS[kind] ?? 'MINUTEUR';
}

/** Crée un état de timer sérialisable. */
export function createTimer(kind, totalSec, context = {}, now = Date.now()) {
    const total = Math.max(1, Math.round(Number(totalSec) || 0));
    return {
        kind,
        label: timerLabel(kind),
        totalSec: total,
        startedAt: now,
        endsAt: now + total * 1000,
        paused: false,
        pausedRemainingSec: null,
        completedHandled: false,
        context,
    };
}

/** Secondes restantes. Fonctionne après un reload grâce aux timestamps absolus. */
export function remainingSeconds(timer, now = Date.now()) {
    if (!timer)
        return 0;
    if (timer.paused)
        return Math.max(0, Math.round(Number(timer.pausedRemainingSec) || 0));
    return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

export function isExpired(timer, now = Date.now()) {
    return !!timer && !timer.paused && now >= timer.endsAt;
}

/** Le timer a expiré pendant que l'app était fermée et n'a pas encore été traité. */
export function needsCompletion(timer, now = Date.now()) {
    return isExpired(timer, now) && !timer.completedHandled;
}

export function markCompleted(timer) {
    return timer ? { ...timer, completedHandled: true } : timer;
}

export function pauseTimer(timer, now = Date.now()) {
    if (!timer || timer.paused)
        return timer;
    return { ...timer, paused: true, pausedRemainingSec: remainingSeconds(timer, now) };
}

export function resumeTimer(timer, now = Date.now()) {
    if (!timer || !timer.paused)
        return timer;
    const remaining = Math.max(1, Math.round(Number(timer.pausedRemainingSec) || 0));
    return { ...timer, paused: false, pausedRemainingSec: null, startedAt: now, endsAt: now + remaining * 1000 };
}

/** Ajoute (ou retire) des secondes, en pause comme en marche. */
export function adjustTimer(timer, deltaSec, now = Date.now()) {
    if (!timer)
        return timer;
    if (timer.paused) {
        const next = Math.max(1, (Number(timer.pausedRemainingSec) || 0) + deltaSec);
        return { ...timer, pausedRemainingSec: next, totalSec: Math.max(1, timer.totalSec + deltaSec) };
    }
    const remaining = Math.max(1, remainingSeconds(timer, now) + deltaSec);
    return { ...timer, endsAt: now + remaining * 1000, totalSec: Math.max(1, timer.totalSec + deltaSec) };
}

/** Durée réellement écoulée (utile pour le cardio arrêté avant la fin). */
export function elapsedSeconds(timer, now = Date.now()) {
    if (!timer)
        return 0;
    return Math.max(0, timer.totalSec - remainingSeconds(timer, now));
}

/**
 * Effet métier de la fin d'un timer, selon son kind.
 * Ne jamais écrire restActualSec aveuglément pour tous les timers.
 */
export function timerOutcome(timer, now = Date.now()) {
    if (!timer)
        return { kind: null, action: 'none' };
    const elapsed = elapsedSeconds(timer, now);
    switch (timer.kind) {
        case 'work-rest':
        case 'ramp-rest':
            return { kind: timer.kind, action: 'record-rest', restActualSec: elapsed, context: timer.context };
        case 'cardio':
        case 'recovery':
            return {
                kind: timer.kind, action: 'record-cardio', durationSec: elapsed,
                complete: elapsed >= timer.totalSec, context: timer.context,
            };
        case 'general-warmup':
            // Un échauffement interrompu n'est JAMAIS considéré comme accompli.
            return {
                kind: timer.kind, action: 'complete-general-warmup', durationSec: elapsed,
                complete: elapsed >= timer.totalSec, context: timer.context,
            };
        case 'side-switch':
            return { kind: timer.kind, action: 'advance-side', context: timer.context };
        case 'activation-rest':
            return { kind: timer.kind, action: 'advance-activation', context: timer.context };
        default:
            return { kind: timer.kind, action: 'none', context: timer.context };
    }
}
