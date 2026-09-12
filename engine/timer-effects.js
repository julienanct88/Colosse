// Effet métier de la fin d'un timer, appliqué à la SESSION. Fonction PURE.
//
// Règle d'or : on ne considère JAMAIS un timer comme traité avant d'avoir
// réellement appliqué son effet. Un timer qui expire pendant que l'app est
// fermée doit produire exactement le même état qu'un timer arrivé à zéro à
// l'écran — sinon l'échauffement, le cardio ou la récupération sont perdus.

import { timerOutcome } from './timer.js';
import { normalizeWarmupState } from './warmup.js';
import { formatSeconds } from './session.js';

const NO_OUTCOME = { kind: null, action: 'none' };

function cloneSession(session) {
    return JSON.parse(JSON.stringify(session));
}

/**
 * Applique l'effet métier du timer puis ferme le timer.
 * La session reçue n'est jamais modifiée : une nouvelle session est renvoyée.
 * @returns {{ session: object, outcome: object, message: string|null }}
 */
export function applyTimerOutcome(session, timer, now = Date.now()) {
    if (!session || !timer)
        return { session, outcome: NO_OUTCOME, message: null };

    const next = cloneSession(session);
    const outcome = timerOutcome(timer, now);
    let message = null;

    if (outcome.action === 'record-rest') {
        const set = next.exercises?.[outcome.context?.exerciseId]?.sets?.[outcome.context?.setIndex];
        // Seul le repos entre séries de travail est une donnée de séance.
        if (set && outcome.kind === 'work-rest')
            set.restActualSec = outcome.restActualSec;
    }
    else if (outcome.action === 'record-cardio') {
        const set = next.exercises?.[outcome.context?.exerciseId]?.sets?.[0];
        if (set) {
            // Une reprise ne fait JAMAIS regresser ce qui est deja acquis :
            // refaire un cardio deja accompli puis l'arreter au bout de 2 s ne
            // doit pas effacer les 10 minutes reellement faites.
            const acquiredSec = Number.isFinite(Number(set.reps)) ? Math.max(0, Number(set.reps)) : 0;
            const acquiredDone = set.done === true;
            set.reps = Math.max(acquiredSec, outcome.durationSec);
            set.weightKg = 0;
            set.done = outcome.complete || acquiredDone;
            set.completedAt = set.done ? (set.completedAt ?? now) : null;
        }
        if (!outcome.complete)
            message = outcome.kind === 'recovery'
                ? `Récupération arrêtée à ${formatSeconds(outcome.durationSec)} — étape incomplète.`
                : `Cardio arrêté à ${formatSeconds(outcome.durationSec)} — étape incomplète.`;
    }
    else if (outcome.action === 'complete-general-warmup') {
        const warmup = normalizeWarmupState(next.warmup);
        // Arrivé au bout : accompli. Interrompu avant : passé, jamais "done".
        warmup.general = outcome.complete
            ? { done: true, skipped: false, durationSec: outcome.durationSec }
            : { done: false, skipped: true, durationSec: outcome.durationSec };
        next.warmup = warmup;
        if (!outcome.complete)
            message = `Échauffement interrompu à ${formatSeconds(outcome.durationSec)} — enregistré comme passé.`;
    }
    // 'advance-side' et 'advance-activation' : l'étape suivante est DÉRIVÉE de
    // la session (côté gauche déjà validé -> côté droit). Rien à écrire :
    // fermer le timer suffit, et c'est ce qui rend le reload sûr.

    next.activeTimer = null;
    next.updatedAt = now;
    return { session: next, outcome, message };
}

/**
 * File d'attente des résolutions de timer : une seule à la fois.
 * Combinée au fait qu'une résolution met activeTimer à null, elle donne la
 * garantie « exactly once » : la deuxième résolution ne trouve plus rien à
 * appliquer. Sans elle, tick() et un clic peuvent se croiser et écrire deux fois.
 */
export function createTimerResolutionQueue() {
    let pending = null;
    return {
        get busy() {
            return pending !== null;
        },
        run(task) {
            const current = (pending ?? Promise.resolve())
                .catch(() => { /* un échec ne bloque pas la suite */ })
                .then(task);
            pending = current;
            const settle = () => { if (pending === current) pending = null; };
            return current.then((value) => { settle(); return value; }, (error) => { settle(); throw error; });
        },
    };
}
