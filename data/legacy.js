import { addDays, isoDate, uid } from '../engine/math.js';
import { findExercise, TRAINING_DAYS } from '../program.js';
/*
 * A legacy exercise is mapped to the closest current movement pattern. The raw
 * export is always archived, so no information is destroyed when an old
 * movement has no exact equivalent in the current programme.
 */
const LEGACY_EXERCISE_MAP = {
    pa1: 'push-a-chest-press', pa2: 'push-a-incline', pa3: 'push-b-chest', pa4: 'push-a-fly', pa5: 'push-a-triceps-overhead', pa6: 'push-b-triceps',
    la1: 'legs-b-rdl', la_ld: 'pull-a-pulldown', la2: 'pull-b-tbar', la3: 'pull-a-onearm', la4: 'pull-a-ezcurl', la5: 'pull-a-hammer', la7: 'pull-a-reardelt',
    qa1: 'legs-a-squat', qa2: 'legs-b-press', qa4: 'legs-a-curl', qa5: 'legs-a-calves', qa6: 'push-a-abs', qa7: 'legs-a-abs',
    pb1: 'push-b-shoulder', pb3: 'push-a-lateral', pb_lat_c: 'push-b-lateral', pb6: 'push-b-chest', pb5: 'push-a-triceps-overhead', pb7: 'push-b-fly',
    lb1: 'pull-a-pulldown', lb2: 'pull-b-pulldown', lb3: 'pull-b-tbar', lb4: 'pull-b-curl', lb5: 'pull-b-preacher', lb6: 'pull-a-ezcurl', lb7: 'pull-b-reardelt',
    qb1: 'legs-a-squat', qb2: 'legs-a-hipthrust', qb3: 'legs-b-curl', qb4: 'legs-a-bulgarian', qb5: 'legs-b-calves', qb6: 'push-a-abs', qb7: 'legs-b-abs',
    fpp1: 'push-a-chest-press', fpp2: 'push-a-fly', fpp3: 'push-b-shoulder', fpp4: 'push-a-lateral', fpp5: 'pull-a-reardelt', fpp6: 'push-b-triceps', fpp7: 'push-a-abs', fpp8: 'legs-a-abs',
    fpq1: 'legs-b-press', fpq3: 'legs-a-curl', fpq4: 'legs-a-calves', fpq5: 'push-a-abs', fpq6: 'legs-b-abs',
    fpu1: 'pull-a-pulldown', fpu2: 'pull-b-tbar', fpu3: 'pull-a-row', fpu4: 'pull-b-preacher', fpu5: 'pull-b-reardelt', fpu6: 'push-a-abs', fpu7: 'legs-a-abs',
    fph1: 'legs-a-squat', fph2: 'legs-b-curl', fph4: 'legs-b-calves', fph5: 'push-a-abs', fph6: 'legs-b-abs',
    r5p1: 'push-a-chest-press', r5p2: 'push-a-fly', r5p3: 'push-b-shoulder', r5p4: 'push-a-lateral', r5p5: 'push-b-triceps',
    r5t1: 'pull-a-pulldown', r5t2: 'pull-b-tbar', r5t3: 'pull-b-preacher', r5t4: 'pull-a-reardelt', r5t5: 'push-a-abs',
    r5l1: 'legs-b-press', r5l2: 'legs-a-hipthrust', r5l3: 'legs-a-curl', r5l5: 'legs-a-calves', r5l6: 'push-a-abs',
    r5u1: 'push-a-incline', r5u2: 'pull-a-row', r5u3: 'pull-a-pulldown', r5u4: 'push-b-fly', r5u5: 'push-a-lateral', r5u6: 'pull-b-reardelt',
    r5w1: 'legs-b-rdl', r5w2: 'legs-a-bulgarian', r5w3: 'legs-b-curl', r5w4: 'legs-b-calves', r5w5: 'pull-a-ezcurl', r5w6: 'push-b-triceps', r5w7: 'push-a-abs',
};
/* Default variants are used only when the v2 export does not contain a
 * selected variant. They prevent a pec-deck history, for example, from being
 * attributed to a cable fly merely because that is the first v3 option. */
const LEGACY_DEFAULT_VARIANT = {
    pa1: 'machine-convergente', pa2: 'halteres', pa3: 'assisted-dips', pa4: 'cable-high', pa5: 'ez-overhead', pa6: 'rope-pushdown',
    la1: 'rdl-barbell', la_ld: 'neutral-pulldown', la2: 'tbar-b', la3: 'onearm-db', la4: 'ez-curl', la5: 'db-hammer', la7: 'facepull',
    qa1: 'smith-squat', qa2: 'legpress-high', qa4: 'lying-curl', qa5: 'standing-calf', qa6: 'cable-crunch', qa7: 'hanging-knee',
    pb1: 'shoulder-smith', pb3: 'db-lateral', pb_lat_c: 'cable-lateral-b', pb6: 'assisted-dips', pb5: 'rope-overhead', pb7: 'incline-pecdeck',
    lb1: 'pullup', lb2: 'wide-pulldown', lb3: 'tbar-b', lb4: 'incline-curl-b', lb5: 'preacher-db', lb6: 'ez-curl', lb7: 'rear-db-b',
    qb1: 'smith-squat', qb2: 'hip-barbell', qb3: 'lying-curl-b', qb4: 'bulgarian-db', qb5: 'seated-calf', qb6: 'cable-crunch', qb7: 'ab-wheel',
    fpp1: 'machine-convergente', fpp2: 'pec-deck', fpp3: 'shoulder-machine', fpp4: 'machine-lateral', fpp5: 'facepull', fpp6: 'rope-pushdown', fpp7: 'machine-crunch', fpp8: 'hanging-knee',
    fpq1: 'legpress-high', fpq3: 'lying-curl', fpq4: 'standing-calf', fpq5: 'cable-crunch', fpq6: 'ab-wheel',
    fpu1: 'neutral-pulldown', fpu2: 'cable-row-b', fpu3: 'chest-row-machine', fpu4: 'preacher-machine', fpu5: 'reverse-pecdeck-b', fpu6: 'cable-crunch', fpu7: 'hanging-knee',
    fph1: 'hack-squat', fph2: 'seated-curl-b', fph4: 'seated-calf', fph5: 'machine-crunch', fph6: 'ab-wheel',
    r5p1: 'machine-convergente', r5p2: 'pec-deck', r5p3: 'shoulder-machine', r5p4: 'machine-lateral', r5p5: 'rope-pushdown',
    r5t1: 'neutral-pulldown', r5t2: 'cable-row-b', r5t3: 'preacher-machine', r5t4: 'facepull', r5t5: 'machine-crunch',
    r5l1: 'legpress-high', r5l2: 'hip-machine', r5l3: 'lying-curl', r5l5: 'standing-calf', r5l6: 'cable-crunch',
    r5u1: 'machine-inclinee', r5u2: 'chest-row-machine', r5u3: 'neutral-pulldown', r5u4: 'low-high-cable', r5u5: 'machine-lateral', r5u6: 'reverse-pecdeck-b',
    r5w1: 'rdl-smith', r5w2: 'bulgarian-db', r5w3: 'seated-curl-b', r5w4: 'seated-calf', r5w5: 'machine-curl', r5w6: 'rope-pushdown', r5w7: 'cable-crunch',
};
const DAY_MAP = {
    pushA: { dayId: 'push-a', offset: 0 }, pullA: { dayId: 'pull-a', offset: 1 }, legsA: { dayId: 'legs-a', offset: 2 },
    pushB: { dayId: 'push-b', offset: 3 }, pullB: { dayId: 'pull-b', offset: 4 }, legsB: { dayId: 'legs-b', offset: 5 },
    fpPush: { dayId: 'push-a', offset: 0 }, fpQuad: { dayId: 'legs-a', offset: 1 }, fpPull: { dayId: 'pull-b', offset: 3 }, fpHinge: { dayId: 'legs-b', offset: 4 },
    r5push: { dayId: 'push-a', offset: 0 }, r5pull: { dayId: 'pull-a', offset: 1 }, r5legs: { dayId: 'legs-a', offset: 2 }, r5upper: { dayId: 'push-b', offset: 3 }, r5lower: { dayId: 'legs-b', offset: 4 },
};
function parseNullableNumber(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number.parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}
function parseLegacyTechnique(raw) {
    const value = raw?.technique ?? raw?.tech;
    if (value === 'good' || value === true)
        return 'good';
    if (value === 'degraded' || value === false)
        return 'degraded';
    return null;
}
function toSet(raw) {
    const reps = Number.parseInt(String(raw?.r ?? raw?.reps ?? ''), 10);
    const timestamp = Number(raw?.ts ?? raw?.completedAt);
    return {
        id: uid('legacy-set'),
        weightKg: parseNullableNumber(raw?.w ?? raw?.weightKg),
        reps: Number.isFinite(reps) ? reps : null,
        rir: parseNullableNumber(raw?.rir),
        done: raw?.d === true || raw?.done === true,
        technique: parseLegacyTechnique(raw),
        pain: parseNullableNumber(raw?.pain),
        restActualSec: parseNullableNumber(raw?.restActualSec ?? raw?.restActual),
        completedAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
    };
}
function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function resolveLegacyVariant(exercise, legacyExerciseId, rawVariant) {
    const requested = normalizeText(rawVariant);
    if (requested) {
        const exact = exercise.variants.find((variant) => normalizeText(variant.id) === requested || normalizeText(variant.label) === requested);
        if (exact)
            return exact.id;
        const aliases = {
            'barre libre': ['barre'], barre: ['barre'], 'barre ez': ['ez'],
            halteres: ['haltere'], haltere: ['haltere'], smith: ['smith'],
            machine: ['machine'], 'machine convergente': ['machine', 'convergente'],
            'machine hack': ['hack'], 'machine hammer': ['machine'],
            't bar': ['tbar'], corde: ['corde'], poulie: ['poulie'],
            couche: ['allonge'], allonge: ['allonge'], assis: ['assis'],
            'prise neutre': ['neutre'], 'prise large': ['large'],
            'fentes arriere': ['bulgare'], bulgare: ['bulgare'],
        };
        const tokens = aliases[requested] ?? requested.split(' ').filter(Boolean);
        const scored = exercise.variants
            .map((variant) => {
            const haystack = `${normalizeText(variant.id)} ${normalizeText(variant.label)}`;
            const hits = tokens.filter((token) => haystack.includes(token)).length;
            return { variant, score: hits / Math.max(1, tokens.length) };
        })
            .sort((a, b) => b.score - a.score);
        if (scored[0] && scored[0].score >= 0.6)
            return scored[0].variant.id;
    }
    const preferredId = LEGACY_DEFAULT_VARIANT[legacyExerciseId];
    if (preferredId && exercise.variants.some((variant) => variant.id === preferredId))
        return preferredId;
    return exercise.variants[0].id;
}
export function convertLegacyState(raw, _profile) {
    const sessions = [];
    const dailyLogs = [];
    const epoch = new Date(2026, 1, 2);
    const weeks = raw?.wk ?? {};
    Object.entries(weeks).forEach(([weekKey, weekValue]) => {
        const weekNumber = Number.parseInt(weekKey, 10);
        if (!Number.isFinite(weekNumber) || !weekValue || typeof weekValue !== 'object')
            return;
        const weekStart = addDays(epoch, (weekNumber - 1) * 7);
        const ds = weekValue.ds ?? {};
        Object.entries(ds).forEach(([legacyDayKey, dayValue]) => {
            const dayMap = DAY_MAP[legacyDayKey];
            if (!dayMap || !dayValue || typeof dayValue !== 'object')
                return;
            const date = isoDate(addDays(weekStart, dayMap.offset));
            const exerciseLogs = {};
            Object.entries(dayValue).forEach(([legacyExerciseId, exerciseValue]) => {
                const mappedId = LEGACY_EXERCISE_MAP[legacyExerciseId];
                if (!mappedId || !exerciseValue || typeof exerciseValue !== 'object')
                    return;
                const sets = Array.isArray(exerciseValue.s) ? exerciseValue.s.map(toSet) : [];
                if (!sets.some((set) => set.done && (set.weightKg ?? 0) > 0 && (set.reps ?? 0) > 0))
                    return;
                const exerciseDef = findExercise(mappedId);
                if (!exerciseDef)
                    return;
                const variantId = resolveLegacyVariant(exerciseDef, legacyExerciseId, exerciseValue.variant);
                const existing = exerciseLogs[mappedId];
                if (existing) {
                    /* Never merge two mechanically different variants into one history.
                     * Keep the first deterministic mapping; the complete raw record remains
                     * available in archive.raw for manual audit. */
                    if (existing.variantId === variantId)
                        existing.sets.push(...sets);
                    return;
                }
                exerciseLogs[mappedId] = {
                    exerciseId: mappedId,
                    variantId,
                    sets,
                    skipped: false,
                };
            });
            if (!Object.keys(exerciseLogs).length)
                return;
            const now = Date.now();
            sessions.push({
                id: `legacy:${date}:${legacyDayKey}`,
                date,
                dayId: dayMap.dayId,
                weekIndex: weekNumber,
                startedAt: null,
                endedAt: null,
                notes: String(weekValue.nt ?? ''),
                readiness: { energy: 3, fatigue: 2, sleepHours: null },
                exercises: exerciseLogs,
                createdAt: now,
                updatedAt: now,
            });
        });
        const measures = weekValue.ms ?? {};
        const weight = parseNullableNumber(measures.poids);
        const waist = parseNullableNumber(measures.taille);
        if (weight !== null || waist !== null) {
            dailyLogs.push({
                date: isoDate(addDays(weekStart, 3)),
                weightKg: weight,
                waistCm: waist,
                calories: null,
                adherencePct: null,
                steps: null,
                sleepHours: null,
                fatigue: null,
                notes: 'Importé depuis Colosse v2.',
            });
        }
    });
    return {
        sessions,
        dailyLogs,
        archive: {
            importedAt: new Date().toISOString(),
            sourceKey: 'colosse-coach-v2',
            raw,
            convertedSessions: sessions.length,
        },
    };
}
export function currentExerciseIds() {
    return new Set(TRAINING_DAYS.flatMap((day) => day.exercises.map((exercise) => exercise.id)));
}
//# sourceMappingURL=legacy.js.map