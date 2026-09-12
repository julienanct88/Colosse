// Rendu du Mode Exécution — une étape à la fois, pensé téléphone posé.
// Fonctions de RENDU pures : elles reçoivent l'étape et renvoient du HTML.
import { escapeHtml, formatClock } from './templates.js';
import { STAGES } from '../engine/execution.js';
import { GENERAL_WARMUP } from '../engine/warmup.js';
import { formatSeconds } from '../engine/session.js';

/** Un chrono tourne-t-il déjà pour cette étape ? */
const timerRunsFor = (ctx, exerciseId) => ctx?.session?.activeTimer?.context?.exerciseId === exerciseId;
/** Un chrono de ce type tourne-t-il ? (l'échauffement général n'a pas d'exerciseId) */
const timerRunsKind = (ctx, kind) => ctx?.session?.activeTimer?.kind === kind;

const rirScale = (target) => [0, 1, 2, 3, 4].map((v) => `<button type="button" class="chip-choice ${v === target ? 'is-target' : ''}" data-exec-field="rir" data-value="${v}">${v === 4 ? '4+' : v}</button>`).join('');
const painScale = () => [0, 1, 2, 3, 4].map((v) => `<button type="button" class="chip-choice ${v === 0 ? 'selected' : ''}" data-exec-field="pain" data-value="${v}">${v === 4 ? '4+' : v}</button>`).join('');

function header(day, progress, elapsedSec) {
    return `<div class="exec-header">
    <div class="exec-header__top"><span class="exec-day">${escapeHtml(day.name)}</span><span class="exec-clock" id="exec-elapsed">${formatClock(elapsedSec)}</span></div>
    <div class="exec-progress"><i style="width:${progress.percent}%"></i></div>
    <div class="exec-progress__label">${progress.done}/${progress.total} étapes · ${progress.percent} %</div>
  </div>`;
}

function shell(day, progress, elapsedSec, body) {
    return `<section class="execution" aria-live="polite">
    ${header(day, progress, elapsedSec)}
    ${body}
    <div class="exec-secondary">
      <button class="ghost-button" data-action="exec-show-program">Voir toute la séance</button>
      <button class="ghost-button" data-action="exec-menu">⋯</button>
    </div>
  </section>`;
}

export function renderExecution(step, ctx) {
    const { day, progress, elapsedSec } = ctx;
    let body = '';
    switch (step.stage) {
        case STAGES.GENERAL_WARMUP: body = renderGeneralWarmup(ctx); break;
        case STAGES.ACTIVATION: body = renderActivation(step); break;
        case STAGES.NEEDS_REFERENCE_LOAD: body = renderReferenceLoad(step); break;
        case STAGES.RAMP_SET: body = renderRampSet(step); break;
        case STAGES.WORK_SET: body = renderWorkSet(step, ctx); break;
        case STAGES.CARDIO: body = renderCardio(step, ctx); break;
        case STAGES.RECOVERY: body = renderRecovery(step, ctx); break;
        case STAGES.SESSION_COMPLETE: body = renderComplete(ctx); break;
        default: body = '<p class="empty-state">Étape inconnue.</p>';
    }
    return shell(day, progress, elapsedSec, body);
}

function renderGeneralWarmup(ctx) {
    return `<div class="exec-card exec-warmup">
    <span class="exec-eyebrow">ÉCHAUFFEMENT</span>
    <h2 class="exec-title">${escapeHtml(GENERAL_WARMUP.name)}</h2>
    <div class="exec-huge">${formatSeconds(GENERAL_WARMUP.durationSec)}</div>
    <div class="exec-meta"><span>${escapeHtml(GENERAL_WARMUP.speedKmh)} km/h</span><span>inclinaison ${escapeHtml(GENERAL_WARMUP.inclinePct)} %</span></div>
    <p class="exec-cue">${escapeHtml(GENERAL_WARMUP.cue)}</p>
    ${timerRunsKind(ctx, 'general-warmup')
        ? '<button class="exec-primary" disabled>CHRONO EN COURS</button>'
        : '<button class="exec-primary" data-action="exec-start-general-warmup">DÉMARRER</button>'}
    <button class="ghost-button" data-action="exec-skip-general-warmup">Passer l’échauffement</button>
  </div>`;
}

function renderActivation(step) {
    const a = step.activation;
    return `<div class="exec-card">
    <span class="exec-eyebrow">ACTIVATION — ne compte pas comme série</span>
    <h2 class="exec-title">${escapeHtml(a.name)}</h2>
    ${a.side ? `<div class="exec-side ${a.side}">${a.side === 'left' ? 'CÔTÉ GAUCHE' : 'CÔTÉ DROIT'}</div>` : ''}
    <div class="exec-huge exec-huge--sm">${escapeHtml(a.detail)}</div>
    ${a.tempo ? `<div class="exec-meta"><span>tempo ${escapeHtml(a.tempo)}</span></div>` : ''}
    <button class="exec-primary" data-action="exec-validate-activation" data-step="${escapeHtml(a.key)}" data-rest="${a.restSec ?? 0}">VALIDÉ</button>
  </div>`;
}

function renderReferenceLoad(step) {
    return `<div class="exec-card">
    <span class="exec-eyebrow">MONTÉE EN CHARGE</span>
    <h2 class="exec-title">${escapeHtml(step.exercise.name)}</h2>
    <p class="exec-cue">Quelle charge de travail veux-tu tester aujourd’hui ?</p>
    <label class="exec-input"><span>Charge (kg)</span>
      <input type="number" inputmode="decimal" min="0" step="0.25" id="exec-reference-load" placeholder="0"/>
    </label>
    <button class="exec-primary" data-action="exec-set-reference" data-exercise="${step.exerciseId}">VALIDER LA CHARGE</button>
  </div>`;
}

function renderRampSet(step) {
    const r = step.ramp;
    return `<div class="exec-card exec-ramp">
    <span class="exec-eyebrow">ÉCHAUFFEMENT — ne compte pas dans les séries de travail</span>
    <h2 class="exec-title">${escapeHtml(step.exercise.name)}</h2>
    <div class="exec-sub">Montée en charge ${escapeHtml(r.key)} · ${Math.round(r.pct * 100)} %</div>
    <div class="exec-huge">${r.loadKg} kg</div>
    <div class="exec-meta"><span>${r.reps} répétitions</span><span>repos ${formatClock(r.restSec)}</span></div>
    <button class="exec-primary" data-action="exec-validate-ramp" data-exercise="${step.exerciseId}" data-index="${step.setIndex}" data-rest="${r.restSec}">SÉRIE FAITE</button>
  </div>`;
}

function renderWorkSet(step, ctx) {
    const { exercise, plan, setIndex, totalSets, targetRir, side } = step;
    const log = ctx.session.exercises[exercise.id];
    const set = log?.sets?.[setIndex] ?? {};
    const load = set.weightKg ?? ctx.prescriptionLoadKg ?? '';
    const amountLabel = plan.metric === 'seconds' ? 'Durée (s)' : 'Répétitions';
    const rangeLabel = plan.metric === 'seconds'
        ? `${formatSeconds(plan.repMin)}–${formatSeconds(plan.repMax)}`
        : `${plan.repMin}–${plan.repMax} répétitions`;
    const needsLoad = (step.variant?.loadMode ?? 'external') === 'external';
    return `<div class="exec-card exec-work">
    <div class="exec-sub">${escapeHtml(exercise.name)}</div>
    <h2 class="exec-title">SÉRIE ${setIndex + 1} / ${totalSets}</h2>
    ${side ? `<div class="exec-side ${side}">${side === 'left' ? 'CÔTÉ GAUCHE' : 'CÔTÉ DROIT'}</div>` : ''}
    ${needsLoad ? `<div class="exec-huge">${load !== '' ? `${load} kg` : '—'}</div>` : '<div class="exec-huge exec-huge--sm">poids du corps</div>'}
    <div class="exec-meta"><span>${rangeLabel}</span><span>RIR cible ${targetRir}</span>${plan.tempo ? `<span>tempo ${escapeHtml(plan.tempo)}</span>` : ''}</div>
    ${ctx.lastExposure ? `<p class="exec-last">Dernière exposition : ${escapeHtml(ctx.lastExposure)}</p>` : ''}
    ${exercise.coachingCue ? `<p class="exec-cue">${escapeHtml(exercise.coachingCue)}</p>` : ''}
    <div class="exec-fields">
      ${needsLoad ? `<label class="exec-input"><span>Charge (kg)</span><input type="number" inputmode="decimal" min="0" step="0.25" data-exec-field="weightKg" value="${load}"/></label>` : ''}
      <label class="exec-input"><span>${amountLabel}</span><input type="number" inputmode="numeric" min="0" step="1" data-exec-field="reps" value="${set.reps ?? ''}" placeholder="${plan.repMin}"/></label>
    </div>
    <div class="exec-choice"><span>RIR réel <small class="rir-target">(cible ${targetRir})</small></span><div class="chip-row" data-exec-group="rir">${rirScale(targetRir)}</div></div>
    <div class="exec-choice"><span>Technique</span><div class="chip-row" data-exec-group="technique">
      <button type="button" class="chip-choice selected" data-exec-field="technique" data-value="good">PROPRE</button>
      <button type="button" class="chip-choice" data-exec-field="technique" data-value="degraded">DÉGRADÉE</button>
    </div></div>
    <div class="exec-choice"><span>Douleur</span><div class="chip-row" data-exec-group="pain">${painScale()}</div></div>
    <button class="exec-primary" data-action="exec-validate-set" data-exercise="${exercise.id}" data-set="${setIndex}">
      ${side ? `VALIDER ${side === 'left' ? 'CÔTÉ GAUCHE' : 'CÔTÉ DROIT'}` : 'VALIDER LA SÉRIE'}
    </button>
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
export function renderExecMenu({ canDefer, exerciseName }) {
    return `<div class="sheet-backdrop" data-action="exec-menu-close"></div>
  <section class="sheet exec-menu-sheet" role="dialog" aria-label="Options de la séance">
    <button class="sheet-item" data-action="exec-reorder">↕&nbsp;&nbsp;Réorganiser les exercices</button>
    ${canDefer ? `<button class="sheet-item" data-action="exec-defer">⏭&nbsp;&nbsp;Machine occupée — faire plus tard</button>` : ''}
    ${exerciseName ? `<button class="sheet-item sheet-item--danger" data-action="exec-skip">✕&nbsp;&nbsp;Passer ${escapeHtml(exerciseName)}</button>` : ''}
    <button class="sheet-item sheet-item--muted" data-action="exec-menu-close">Annuler</button>
  </section>`;
}

/**
 * Panneau « RÉORGANISER ».
 * rows = [{ id, name, stateLabel, done, pending, locked }]
 */
export function renderReorderPanel({ dayName, rows, blocked }) {
    if (blocked) {
        return `<div class="sheet-backdrop" data-action="reorder-close"></div>
    <section class="sheet reorder-panel" role="dialog" aria-label="Réorganiser les exercices">
      <div class="reorder-head"><h2>RÉORGANISER</h2><button class="sheet-close" data-action="reorder-close" aria-label="Fermer">✕</button></div>
      <p class="reorder-hint">Termine ou passe le chrono avant de réorganiser.</p>
      <div class="reorder-actions"><button class="primary-button" data-action="reorder-close">FERMER</button></div>
    </section>`;
    }
    return `<div class="sheet-backdrop" data-action="reorder-close"></div>
  <section class="sheet reorder-panel" role="dialog" aria-label="Réorganiser les exercices">
    <div class="reorder-head"><h2>RÉORGANISER</h2><button class="sheet-close" data-action="reorder-close" aria-label="Fermer">✕</button></div>
    <p class="reorder-hint">Maintiens ☰ et fais glisser. Cet ordre ne vaut que pour la séance du jour.</p>
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
