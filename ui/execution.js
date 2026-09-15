// Rendu du Mode Exécution — une étape à la fois, pensé téléphone posé.
// Fonctions de RENDU pures : elles reçoivent l'étape et renvoient du HTML.
import { escapeHtml, formatClock } from './templates.js';
import { STAGES } from '../engine/execution.js';
import { GENERAL_WARMUP, WARMUP_EQUIPMENT, resolveWarmupEquipment } from '../engine/warmup.js';
import { formatSeconds } from '../engine/session.js';
import { icon, demoSearch, renderDemoButton, variantDisplay, normalizeSearch } from './forge.js';

/** Un chrono tourne-t-il déjà pour cette étape ? */
const timerRunsFor = (ctx, exerciseId) => ctx?.session?.activeTimer?.context?.exerciseId === exerciseId;
/** Un chrono de ce type tourne-t-il ? (l'échauffement général n'a pas d'exerciseId) */
const timerRunsKind = (ctx, kind) => ctx?.session?.activeTimer?.kind === kind;

const rirScale = (target) => [0, 1, 2, 3, 4, 5, 6].map((v) => `<button type="button" class="chip-choice ${v === target ? 'is-target' : ''}" data-exec-field="rir" data-value="${v}" aria-pressed="false" aria-label="${v === 6 ? '6 répétitions ou plus' : `${v} répétition${v > 1 ? 's' : ''} encore possible${v > 1 ? 's' : ''}`}">${v === 6 ? '6+' : v}</button>`).join('');
const painScale = () => Array.from({ length: 11 }, (_, v) => `<button type="button" class="chip-choice ${v === 0 ? 'selected' : ''}" data-exec-field="pain" data-value="${v}" aria-pressed="${v === 0}" aria-label="Douleur ${v} sur 10">${v}</button>`).join('');

function header(day, progress, elapsedSec, ctxUpdate = false) {
    return `<div class="exec-header">
    <div class="exec-header__top"><button class="f-exec-back" data-action="exec-show-program" aria-label="Revenir au programme sans terminer la séance">${icon('back')}</button><div class="f-exec-context"><span class="exec-day">${escapeHtml(day.name)}</span><span class="exec-clock"><span id="exec-elapsed">${formatClock(elapsedSec)}</span> · séance en cours</span></div><button class="f-exec-menu ${ctxUpdate ? 'has-update' : ''}" data-action="exec-menu" aria-label="Options de la séance${ctxUpdate ? ' — mise à jour disponible' : ''}">${icon('dots')}</button></div>
    <div class="exec-progress"><i style="width:${progress.percent}%"></i></div>
    <div class="exec-progress__label"><span>${progress.done}/${progress.total} étapes</span><span>${progress.percent} %</span></div>
  </div>
  <div class="f-exec-tools">
    <button class="f-exec-tool" data-action="exec-show-program">${icon('list')}<span>Tous les exercices</span></button>
    <button class="f-exec-tool" data-action="exec-reorder">${icon('tune')}<span>Modifier l’ordre</span></button>
  </div>`;
}

/** Variante réellement choisie pour cet exercice dans la séance. */
function variantFor(ctx, exercise) {
    const id = ctx?.session?.exercises?.[exercise?.id]?.variantId;
    return exercise?.variants?.find((v) => v.id === id) ?? exercise?.variants?.[0] ?? null;
}
function variantText(variant) {
    return variantDisplay(variant);
}
/** Consulter la fiche ou lancer la recherche de démonstration : ne modifie rien. */
function exerciseHelp(ctx, exercise, extraContext) {
    const variant = variantFor(ctx, exercise);
    return `<div class="f-help-row">
      <button class="f-help-button" data-action="exercise-view" data-exercise="${escapeHtml(exercise.id)}">${icon('note')}<span>Voir l’exercice</span></button>
      ${renderDemoButton(demoSearch({ name: exercise.name, variantLabel: variant?.label ?? '', context: extraContext }))}
    </div>`;
}
function nextUp(ctx) {
    const next = ctx?.nextExercise;
    return next ? `<p class="f-next-up">Ensuite : <strong>${escapeHtml(next.name)}</strong>${next.variantLabel && !normalizeSearch(next.name).includes(normalizeSearch(next.variantLabel)) ? ` <span>· ${escapeHtml(next.variantLabel)}</span>` : ''}</p>` : '';
}

function shell(day, progress, elapsedSec, body, updateAvailable = false) {
    return `<section class="execution">
    ${header(day, progress, elapsedSec, updateAvailable)}
    ${body}
    <div class="exec-secondary">
      <button class="ghost-button" data-action="exec-show-program">${icon('list')} Exercices</button>
      <button class="ghost-button" data-action="forge-notes">${icon('note')} Notes</button>
      <button class="ghost-button" data-action="exec-menu">${icon('tune')} Options</button>
    </div>
  </section>`;
}

export function renderExecution(step, ctx) {
    const { day, progress, elapsedSec } = ctx;
    let body = '';
    switch (step.stage) {
        case STAGES.GENERAL_WARMUP: body = renderGeneralWarmup(ctx); break;
        case STAGES.ACTIVATION: body = renderActivation(step, ctx); break;
        case STAGES.NEEDS_REFERENCE_LOAD: body = renderReferenceLoad(step, ctx); break;
        case STAGES.RAMP_SET: body = renderRampSet(step, ctx); break;
        case STAGES.WORK_SET: body = renderWorkSet(step, ctx); break;
        case STAGES.CARDIO: body = renderCardio(step, ctx); break;
        case STAGES.RECOVERY: body = renderRecovery(step, ctx); break;
        case STAGES.SESSION_COMPLETE: body = renderComplete(ctx); break;
        default: body = '<p class="empty-state">Étape inconnue.</p>';
    }
    return shell(day, progress, elapsedSec, body, !!ctx.updateAvailable);
}

function renderGeneralWarmup(ctx) {
    const general = ctx?.session?.warmup?.general;
    const preferred = ctx?.preferredWarmupEquipment ?? null;
    const choisi = resolveWarmupEquipment(general, preferred);
    const option = WARMUP_EQUIPMENT[choisi];
    const enCours = timerRunsKind(ctx, 'general-warmup');
    const bouton = (id) => `<button type="button" class="f-equipment-choice ${id === choisi ? 'is-selected' : ''}" data-action="warmup-equipment" data-equipment="${id}" aria-pressed="${id === choisi}" ${enCours ? 'disabled' : ''}>${escapeHtml(WARMUP_EQUIPMENT[id].label)}</button>`;
    return `<div class="exec-card exec-warmup">
    <span class="exec-eyebrow">ÉCHAUFFEMENT GÉNÉRAL — ne compte pas comme série</span>
    <div class="f-equipment" role="group" aria-label="Matériel d’échauffement">${bouton('bike')}${bouton('treadmill')}</div>
    ${preferred === choisi
        ? `<p class="f-equipment-note">${icon('check')} ${escapeHtml(option.label)} : ton choix habituel</p>`
        : `<button type="button" class="text-button f-equipment-remember" data-action="warmup-equipment-default" data-equipment="${choisi}">Mémoriser « ${escapeHtml(option.label)} » pour les prochaines séances</button>`}
    <h2 class="exec-title">${escapeHtml(option.name)}</h2>
    <div class="exec-huge">${formatSeconds(option.durationSec ?? GENERAL_WARMUP.durationSec)}</div>
    <div class="exec-meta">${option.details.map((d) => `<span>${escapeHtml(d)}</span>`).join('')}</div>
    <p class="exec-cue">${escapeHtml(option.cue)}</p>
    ${renderDemoButton(demoSearch({ name: option.name === 'Vélo' ? 'vélo' : option.name, context: option.demoQuery }))}
    ${nextUp(ctx)}
    ${enCours
        ? '<button class="exec-primary" disabled>CHRONO EN COURS</button>'
        : `<button class="exec-primary" data-action="exec-start-general-warmup" data-equipment="${choisi}">DÉMARRER</button>`}
    <button class="ghost-button" data-action="exec-skip-general-warmup">Passer l’échauffement</button>
  </div>`;
}

function renderActivation(step, ctx) {
    const a = step.activation;
    return `<div class="exec-card">
    <span class="exec-eyebrow">ACTIVATION — ne compte pas comme série</span>
    <h2 class="exec-title">${escapeHtml(a.name)}</h2>
    ${a.side ? `<div class="exec-side ${a.side}">${a.side === 'left' ? 'CÔTÉ GAUCHE' : 'CÔTÉ DROIT'}</div>` : ''}
    <div class="exec-huge exec-huge--sm">${escapeHtml(a.detail)}</div>
    ${a.tempo ? `<div class="exec-meta"><span>tempo ${escapeHtml(a.tempo)}</span></div>` : ''}
    <div class="f-help-row">
      <button class="f-help-button" data-action="activation-view" data-step="${escapeHtml(a.key)}">${icon('note')}<span>Voir l’activation</span></button>
      ${renderDemoButton(demoSearch({ name: a.name, context: 'échauffement activation' }))}
    </div>
    ${nextUp(ctx)}
    <button class="exec-primary" data-action="exec-validate-activation" data-step="${escapeHtml(a.key)}" data-rest="${a.restSec ?? 0}">VALIDÉ</button>
  </div>`;
}

function renderReferenceLoad(step, ctx) {
    const variant = variantFor(ctx, step.exercise);
    return `<div class="exec-card">
    <span class="exec-eyebrow">MONTÉE EN CHARGE</span>
    <h2 class="exec-title">${escapeHtml(step.exercise.name)}</h2>
    ${variant ? `<p class="f-work-variant">${escapeHtml(variantText(variant))}</p>` : ''}
    ${step.exercise.coachingCue ? `<p class="exec-cue f-cue-visible">${escapeHtml(step.exercise.coachingCue)}</p>` : ''}
    ${exerciseHelp(ctx, step.exercise)}
    <p class="exec-cue">Quelle charge de travail veux-tu tester aujourd’hui ?</p>
    <label class="exec-input"><span>Charge (kg)</span>
      <input type="number" inputmode="decimal" min="0" step="0.25" id="exec-reference-load" placeholder="0"/>
    </label>
    <button class="exec-primary" data-action="exec-set-reference" data-exercise="${step.exerciseId}">VALIDER LA CHARGE</button>
  </div>`;
}

function renderRampSet(step, ctx) {
    const r = step.ramp;
    const variant = variantFor(ctx, step.exercise);
    return `<div class="exec-card exec-ramp">
    <span class="exec-eyebrow">ÉCHAUFFEMENT — ne compte pas dans les séries de travail</span>
    <h2 class="exec-title">${escapeHtml(step.exercise.name)}</h2>
    ${variant ? `<p class="f-work-variant">${escapeHtml(variantText(variant))}</p>` : ''}
    <div class="exec-sub">Montée en charge ${escapeHtml(r.key)} (${step.setIndex + 1}/${step.ramps?.length ?? 1}) · ${Math.round(r.pct * 100)} % · même mouvement, plus léger</div>
    ${step.plan ? `<p class="f-next-up">Ensuite : <strong>${step.plan.sets} séries × ${step.plan.repMin}–${step.plan.repMax} reps</strong> <span>· garde ${step.plan.targetRir} reps · repos ${formatClock(step.plan.restSec)}</span></p>` : ''}
    <div class="exec-huge">${r.loadKg} kg</div>
    <div class="exec-meta"><span>${r.reps} répétitions</span><span>repos ${formatClock(r.restSec)}</span></div>
    ${step.exercise.coachingCue ? `<p class="exec-cue f-cue-visible">${escapeHtml(step.exercise.coachingCue)}</p>` : ''}
    ${exerciseHelp(ctx, step.exercise)}
    <button class="exec-primary" data-action="exec-validate-ramp" data-exercise="${step.exerciseId}" data-index="${step.setIndex}" data-rest="${r.restSec}">SÉRIE FAITE</button>
    <button class="ghost-button f-skip-ramps" data-action="exec-skip-ramps" data-exercise="${step.exerciseId}">Aller directement aux séries</button>
  </div>`;
}

function renderWorkSet(step, ctx) {
    const { exercise, plan, setIndex, totalSets, targetRir, side } = step;
    const log = ctx.session.exercises[exercise.id];
    const set = log?.sets?.[setIndex] ?? {};
    const load = set.weightKg ?? ctx.prescriptionLoadKg ?? '';
    const amountLabel = plan.metric === 'seconds' ? 'Durée · secondes' : 'Répétitions';
    const rangeLabel = plan.metric === 'seconds'
        ? `${formatSeconds(plan.repMin)}–${formatSeconds(plan.repMax)}`
        : `${plan.repMin}–${plan.repMax} reps`;
    const needsLoad = (step.variant?.loadMode ?? 'external') === 'external';
    const increment = Number(step.variant?.incrementKg) > 0 ? Number(step.variant.incrementKg) : 0.25;
    const order = ctx.session.exerciseOrder ?? ctx.day.exercises.map(ex => ex.id);
    const position = Math.max(0, order.indexOf(exercise.id)) + 1;
    const key = `${ctx.session.id}:${exercise.id}:${log.variantId}:${setIndex}:${side ?? 'both'}`;
    // Champ vide = tiret (jamais un chiffre grisé qui ressemble à une valeur déjà saisie) ; le premier
    // appui sur − ou + part de la valeur de départ (bas de la fourchette pour les répétitions).
    const stepper = (field, label, value, start, delta, inputmode) => `<div class="f-value-cell"><label><span class="f-value-label">${label}</span><input type="number" inputmode="${inputmode}" min="0" step="${field === 'weightKg' ? '0.25' : '1'}" data-exec-field="${field}" value="${escapeHtml(String(value))}" placeholder="—" data-start="${escapeHtml(String(start))}" aria-label="${label}"/></label><div class="f-stepper"><button type="button" data-action="forge-step" data-delta="-${delta}" aria-label="Diminuer ${label} de ${delta}">${icon('minus')}</button><button type="button" data-action="forge-step" data-delta="${delta}" aria-label="Augmenter ${label} de ${delta}">${icon('plus')}</button></div></div>`;
    const doneCount = log.sets.slice(0, totalSets).filter((s) => s.done).length;
    // Pastilles numérotées : ✓ = série validée, contour = série en cours. Jamais une barre pleine
    // pour la série en cours (elle se lisait « série 1 déjà faite »).
    const steps = Array.from({ length: totalSets }, (_, i) => {
        const done = !!log.sets[i]?.done;
        const current = !done && i === setIndex;
        return `<li class="${done ? 'is-done' : current ? 'is-current' : ''}" aria-label="Série ${i + 1} ${done ? 'validée' : current ? 'en cours' : 'à faire'}">${done ? '✓' : i + 1}</li>`;
    }).join('');
    return `<div class="exec-card exec-work" data-forge-step="${escapeHtml(key)}">
    <div class="f-work-kicker">EXERCICE ${String(position).padStart(2,'0')} / ${String(order.length).padStart(2,'0')}<span>${doneCount}/${totalSets} séries validées</span></div>
    <h2 class="exec-title">${escapeHtml(exercise.name)}</h2>
    <p class="f-work-variant">${escapeHtml(step.variant ? variantText(step.variant) : 'Variante du programme')}${needsLoad ? '' : ' · poids du corps'}</p>
    ${plan.deload && Number(exercise.sets) > totalSets ? `<p class="f-deload-inline">Semaine de décharge : ${totalSets} série${totalSets > 1 ? 's' : ''} au lieu de ${exercise.sets}, charges allégées.</p>` : ''}
    ${step.rampOffer ? `<div class="f-ramp-offer"><span>Échauffement conseillé\u00a0: ${step.rampOffer.count} séries légères<small>calculées sur ta charge</small></span><button type="button" class="ghost-button" data-action="exec-start-ramps" data-exercise="${exercise.id}">Faire l’échauffement</button></div>` : ''}
    ${side ? `<div class="exec-side ${side}">${side === 'left' ? 'CÔTÉ GAUCHE' : 'CÔTÉ DROIT'}</div>` : ''}
    ${side === 'right' && log?.sets?.[setIndex]?.sides?.left?.done ? `<p class="f-side-summary">✓ Gauche fait\u00a0: ${escapeHtml(String(log.sets[setIndex].sides.left.weightKg ?? 0))} kg × ${escapeHtml(String(log.sets[setIndex].sides.left.reps ?? '?'))}</p>` : ''}
    <div class="f-work-panel">
      <div class="f-set-caption">Série ${setIndex + 1} sur ${totalSets}<ol class="f-set-steps">${steps}</ol></div>
      <div class="exec-fields ${needsLoad ? '' : 'single'}">
        ${needsLoad ? stepper('weightKg', 'Charge · kg', load, '0', increment, 'decimal') : ''}
        ${stepper('reps', amountLabel, set.reps ?? '', plan.repMin, plan.metric === 'seconds' ? 5 : 1, 'numeric')}
      </div>
      <div class="exec-choice f-rir-choice"><span><span><b>RIR</b> · répétitions encore possibles</span><small class="rir-target">cible ${targetRir}</small></span><div class="chip-row" data-exec-group="rir" aria-label="RIR réellement ressenti">${rirScale(targetRir)}</div></div>
      <p class="f-last-exposure">${icon('clock')}<span>${escapeHtml(rangeLabel)} · repos ${formatClock(plan.restSec)}${plan.tempo ? ` · tempo ${escapeHtml(plan.tempo)}` : ''} — ${ctx.lastExposure ? `Dernière exposition : ${escapeHtml(ctx.lastExposure)}` : 'Première exposition : calibre ta charge prudemment.'}</span></p>
    </div>
    <details class="f-feedback-details" data-forge-detail="feedback:${escapeHtml(key)}">
      <summary>Technique & douleur · facultatif (propre, 0 par défaut)</summary>
      <div>
        <div class="exec-choice"><span>Qualité du mouvement</span><div class="chip-row" data-exec-group="technique">
          <button type="button" class="chip-choice selected" data-exec-field="technique" data-value="good" aria-pressed="true">Propre</button>
          <button type="button" class="chip-choice" data-exec-field="technique" data-value="degraded" aria-pressed="false">Dégradée</button>
        </div></div>
        <div class="exec-choice"><span>Douleur · 0 = aucune, 10 = maximale</span><div class="chip-row" data-exec-group="pain">${painScale()}</div></div>
      </div>
    </details>
    <div class="f-work-actions"><button class="exec-primary" data-action="exec-validate-set" data-exercise="${exercise.id}" data-set="${setIndex}">
      ${side ? `Valider le côté ${side === 'left' ? 'gauche' : 'droit'}` : `Valider la série ${setIndex + 1}`} ${icon('check')}
    </button></div>
    ${exercise.coachingCue ? `<p class="exec-cue f-cue-visible">${escapeHtml(exercise.coachingCue)}</p>` : ''}
    ${exerciseHelp(ctx, exercise)}
    <button class="ghost-button" data-action="exec-show-program" data-exercise="${exercise.id}">${icon('list')} Séries, variante & corrections de cet exercice</button>
  </div>`;
}

function renderCardio(step, ctx) {
    const ex = step.exercise;
    return `<div class="exec-card exec-cardio">
    <span class="exec-eyebrow">CARDIO</span>
    <h2 class="exec-title">${escapeHtml(ex.name)}</h2>
    <div class="exec-huge">${formatSeconds(step.durationSec)}</div>
    <div class="exec-meta">${ex.inclinePct ? `<span>inclinaison ${escapeHtml(String(ex.inclinePct))} %</span>` : ''}${ex.speedKmh ? `<span>vitesse ${escapeHtml(String(ex.speedKmh))}${/[0-9]/.test(String(ex.speedKmh)) ? ' km/h' : ''}</span>` : ''}</div>
    <p class="exec-cue">${escapeHtml(ex.coachingCue ?? '')}</p>
    ${timerRunsFor(ctx, ex.id)
        ? '<button class="exec-primary" disabled>CHRONO EN COURS</button>'
        : `<button class="exec-primary" data-action="exec-start-cardio" data-exercise="${ex.id}" data-duration="${step.durationSec}">DÉMARRER</button>`}
    <button class="f-help-button" data-action="exercise-view" data-exercise="${escapeHtml(ex.id)}">${icon('note')}<span>Voir l’exercice</span></button>
  </div>`;
}

function renderRecovery(step, ctx) {
    const ex = step.exercise;
    return `<div class="exec-card exec-cardio">
    <span class="exec-eyebrow">RÉCUPÉRATION ACTIVE</span>
    <h2 class="exec-title">${escapeHtml(ex.name)}</h2>
    <div class="exec-huge">${formatSeconds(step.durationSec)}</div>
    <p class="exec-cue">${escapeHtml(ex.coachingCue ?? '')}</p>
    ${timerRunsFor(ctx, ex.id)
        ? '<button class="exec-primary" disabled>CHRONO EN COURS</button>'
        : `<button class="exec-primary" data-action="exec-start-recovery" data-exercise="${ex.id}" data-duration="${step.durationSec}">DÉMARRER</button>`}
    <button class="f-help-button" data-action="exercise-view" data-exercise="${escapeHtml(ex.id)}">${icon('note')}<span>Voir l’exercice</span></button>
  </div>`;
}

function renderComplete(ctx) {
    const { summary } = ctx;
    const incomplete = !summary.complete;
    return `<div class="exec-card exec-complete">
    <span class="exec-eyebrow">${incomplete ? 'SÉANCE INCOMPLÈTE' : 'SÉANCE TERMINÉE'}</span>
    <h2 class="exec-title">${escapeHtml(summary.dayName)}</h2>
    <ul class="exec-summary">
      <li><span>Durée</span><strong>${formatClock(summary.durationSec)}</strong></li>
      <li><span>Séries</span><strong>${summary.setsDone}/${summary.setsTotal}</strong></li>
      <li><span>Exercices</span><strong>${summary.exercisesDone}/${summary.exercisesTotal}</strong></li>
      ${summary.cardioSec ? `<li><span>Cardio</span><strong>${formatSeconds(summary.cardioSec)}</strong></li>` : ''}
      ${summary.skipped ? `<li><span>Exercices passés</span><strong>${summary.skipped}</strong></li>` : ''}
    </ul>
    <button class="exec-primary" data-action="exec-finish">${incomplete ? 'ENREGISTRER COMME INCOMPLÈTE' : 'VALIDER LA SÉANCE'}</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Réorganisation : feuille du menu ⋯ et panneau de tri. Rendu PUR.
// ---------------------------------------------------------------------------

/** Menu ⋯ du Mode Exécution. */
export function renderExecMenu({ canDefer, exerciseName, canCancel = true, updateAvailable = false }) {
    return `<div class="sheet-backdrop" data-action="exec-menu-close"></div>
  <section class="sheet exec-menu-sheet" role="dialog" aria-label="Options de la séance">
    ${updateAvailable ? '<button class="sheet-item f-menu-update" data-action="reload-update">⟳&nbsp;&nbsp;Mettre à jour Colosse (tes séries sont gardées)</button>' : ''}
    <button class="sheet-item" data-action="exec-reorder">↕&nbsp;&nbsp;Réorganiser les exercices</button>
    ${canDefer ? `<button class="sheet-item" data-action="exec-defer">⏭&nbsp;&nbsp;Machine occupée — faire plus tard</button>` : ''}
    ${exerciseName ? `<button class="sheet-item sheet-item--danger" data-action="exec-skip">✕&nbsp;&nbsp;Passer ${escapeHtml(exerciseName)}</button>` : ''}
    ${canCancel ? '<button class="sheet-item sheet-item--danger" data-action="cancel-session">↺&nbsp;&nbsp;Annuler la séance</button>' : ''}
    <button class="sheet-item sheet-item--muted" data-action="exec-menu-close">Fermer</button>
  </section>`;
}

/**
 * Panneau « RÉORGANISER ».
 * rows = [{ id, name, stateLabel, done, pending, locked }]
 */
export function renderReorderPanel({ dayName, rows, blocked, blockedMessage = null }) {
    if (blocked) {
        return `<div class="sheet-backdrop" data-action="reorder-close"></div>
    <section class="sheet reorder-panel" role="dialog" aria-label="Réorganiser les exercices">
      <div class="reorder-head"><h2>RÉORGANISER</h2><button class="sheet-close" data-action="reorder-close" aria-label="Fermer">✕</button></div>
      <p class="reorder-hint">Termine ou passe le chrono avant de réorganiser.</p>
      ${blockedMessage ? `<p class="reorder-hint">${escapeHtml(blockedMessage)}</p>` : ''}
      <div class="reorder-actions">
        ${blockedMessage ? '<button class="secondary-button" data-action="reorder-end-timer">Arrêter le chrono et modifier l’ordre</button>' : ''}
        <button class="primary-button" data-action="reorder-close">FERMER</button>
      </div>
    </section>`;
    }
    return `<div class="sheet-backdrop" data-action="reorder-close"></div>
  <section class="sheet reorder-panel" role="dialog" aria-label="Réorganiser les exercices">
    <div class="reorder-head"><h2>RÉORGANISER</h2><button class="sheet-close" data-action="reorder-close" aria-label="Fermer">✕</button></div>
    <p class="reorder-hint">Maintiens ☰ et fais glisser, ou utilise ↑ ↓. Cet ordre ne vaut que pour la séance du jour : les séries déjà faites sont conservées.</p>
    <ul class="reorder-list" data-drag-list="reorder">
      ${rows.map((row, index) => `<li class="reorder-row ${row.done ? 'is-done' : ''} ${row.locked ? 'is-locked' : ''}"
        data-drag-item="${escapeHtml(row.id)}" data-drag-locked="${row.locked ? 'true' : 'false'}">
        ${row.locked
            ? '<span class="reorder-handle is-locked" aria-hidden="true">·</span>'
            : '<span class="reorder-handle" data-drag-handle role="button" tabindex="0" aria-label="Déplacer">☰</span>'}
        <span class="reorder-name">${escapeHtml(row.name)}</span>
        <span class="reorder-state">${escapeHtml(row.stateLabel)}</span>
        <span class="reorder-arrows">
          <button data-action="move-exercise" data-exercise="${escapeHtml(row.id)}" data-direction="up" aria-label="Monter" ${index === 0 || row.locked ? 'disabled' : ''}>↑</button>
          <button data-action="move-exercise" data-exercise="${escapeHtml(row.id)}" data-direction="down" aria-label="Descendre" ${index === rows.length - 1 || row.locked ? 'disabled' : ''}>↓</button>
        </span>
      </li>`).join('')}
    </ul>
    <div class="reorder-actions">
      <button class="primary-button" data-action="reorder-close">TERMINER</button>
      <button class="ghost-button" data-action="reorder-save-default">Enregistrer comme ordre par défaut${dayName ? ` (${escapeHtml(dayName)})` : ''}</button>
      <button class="ghost-button" data-action="reorder-restore">Restaurer l’ordre du programme</button>
    </div>
  </section>`;
}

/**
 * Fiche d'un exercice ou d'une activation : CONSULTATION uniquement.
 * Fermer la fiche ramène exactement à l'écran précédent ; rien n'est validé.
 */
export function renderExerciseSheet(d) {
    return `<div class="sheet-backdrop" data-action="exercise-sheet-close"></div>
  <section class="sheet f-exercise-sheet" role="dialog" aria-label="${escapeHtml(d.title)}">
    <div class="reorder-head"><span class="exec-eyebrow">${escapeHtml(d.eyebrow)}</span><button class="sheet-close" data-action="exercise-sheet-close" aria-label="Fermer la fiche">✕</button></div>
    <h2 class="f-sheet-title">${escapeHtml(d.title)}</h2>
    ${d.subtitle ? `<p class="f-work-variant">${escapeHtml(d.subtitle)}</p>` : ''}
    ${d.status ? `<p class="f-sheet-status">${escapeHtml(d.status)}</p>` : ''}
    ${d.planLines?.length ? `<div class="exec-meta">${d.planLines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</div>` : ''}
    ${d.cue ? `<div class="f-sheet-block"><strong>Consignes essentielles</strong><p>${escapeHtml(d.cue)}</p></div>` : ''}
    ${d.tempoHelp ? `<div class="f-sheet-block"><strong>Tempo ${escapeHtml(d.tempo)}</strong><p>${escapeHtml(d.tempoHelp)}</p></div>` : ''}
    ${d.lastExposure ? `<div class="f-sheet-block"><strong>Dernière fois</strong><p>${escapeHtml(d.lastExposure)}</p></div>` : ''}
    ${d.demo ? renderDemoButton(d.demo, 'f-demo-wide') : ''}
    <p class="reorder-hint">Consulter cette fiche ne modifie pas ta séance.</p>
    <div class="reorder-actions">
      ${d.doNow ? `<button class="primary-button" data-action="exercise-do-now" data-exercise="${escapeHtml(d.exerciseId)}">Faire maintenant</button>` : ''}
      <button class="${d.doNow ? 'ghost-button' : 'primary-button'}" data-action="exercise-sheet-close">Fermer</button>
    </div>
  </section>`;
}
