import './pwa.js';
import { APP_VERSION, defaultSnapshot, emptyDailyLog, makeExerciseLog, makeSession, makeSet, } from './defaults.js';
import { clearAllData, deleteSession, loadSnapshot, saveAdjustment, saveDailyLog, saveProfile, saveSession, saveSettings, saveSnapshot, storageMode, } from './data/database.js';
import { defaultDayForDate, findDay, findExercise, getExercisePlan, getTrainingPhase, TRAINING_DAYS, } from './program.js';
import { nextPrescription, prescriptionFromHistory, suggestNextSet, summarizeSession, } from './engine/progression.js';
import { estimateSessionDuration, remainingSessionSeconds, trimSuggestions, } from './engine/duration.js';
import { analyzeWeightTrend, macrosForCalories, targetWeight, weeklyTargets, } from './engine/weight.js';
import { analyzeRecovery, analyzeStrengthTrend, } from './engine/recovery.js';
import { activityGoalLabel, activityModeLabel, activityProgress, activitySummary, } from './engine/activity.js';
import { addDays, isoDate, startOfWeek, uid, weekIndexFromStart, } from './engine/math.js';
import { decisionMeta, escapeHtml, formatClock, formatDateFr, formatKg, numberInputValue, pct, sparklineSvg, } from './ui/templates.js';
const YOUTUBE_SEARCH = 'https://www.youtube.com/results?search_query=';
function parseNumber(value) {
    const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}
function parseInteger(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function sessionDurationSeconds(session) {
    if (!session.startedAt)
        return 0;
    return Math.max(0, Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 1000));
}
function sessionTonnage(session) {
    return Math.round(Object.values(session.exercises).reduce((total, exercise) => {
        return total + exercise.sets.reduce((sum, set) => {
            if (!set.done || !set.weightKg || !set.reps)
                return sum;
            return sum + set.weightKg * set.reps;
        }, 0);
    }, 0));
}
export class ColosseApp {
    root;
    snapshot = defaultSnapshot();
    viewWeekStart = startOfWeek(new Date());
    timer = null;
    tickHandle = null;
    saveDebounce = null;
    toastHandle = null;
    wakeLock = null;
    installPrompt = null;
    constructor(root) {
        this.root = root;
    }
    async init() {
        this.root.innerHTML = '<div class="splash"><div class="splash-mark">C</div><strong>COLOSSE</strong><span>Préparation de ton programme…</span></div>';
        this.snapshot = await loadSnapshot();
        const todayDayId = defaultDayForDate().id;
        if (this.snapshot.settings.selectedDayId !== todayDayId) {
            this.snapshot.settings.selectedDayId = todayDayId;
            await saveSettings(this.snapshot.settings);
        }
        this.viewWeekStart = startOfWeek(new Date());
        await this.ensureCurrentSession();
        this.bindEvents();
        this.tickHandle = window.setInterval(() => this.tick(), 250);
        this.render();
    }
    bindEvents() {
        this.root.addEventListener('click', (event) => void this.handleClick(event));
        this.root.addEventListener('change', (event) => void this.handleChange(event));
        this.root.addEventListener('input', (event) => void this.handleInput(event));
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.installPrompt = event;
            this.render();
        });
        window.addEventListener('colosse-update', () => {
            this.showToast('Une mise à jour de Colosse est disponible.', 'info', 6000);
            const banner = document.getElementById('update-banner');
            banner?.classList.remove('hidden');
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.currentContext().session.startedAt && !this.currentContext().session.endedAt) {
                void this.acquireWakeLock();
            }
        });
    }
    dayDate(day) {
        return isoDate(addDays(this.viewWeekStart, day.weekday - 1));
    }
    currentDay() {
        return findDay(this.snapshot.settings.selectedDayId);
    }
    currentContext() {
        const day = this.currentDay();
        const date = this.dayDate(day);
        const weekIndex = weekIndexFromStart(this.snapshot.profile.startDate, date);
        let session = this.snapshot.sessions.find((item) => item.id === `${date}:${day.id}`);
        if (!session) {
            session = makeSession(day.id, date, this.snapshot.profile);
            this.snapshot.sessions.push(session);
        }
        this.syncSession(session, day, weekIndex);
        return { day, date, weekIndex, session };
    }
    async ensureCurrentSession() {
        const context = this.currentContext();
        this.seedSessionPrescriptions(context.session, context.day, context.date, context.weekIndex);
        await saveSession(context.session);
    }
    syncSession(session, day, weekIndex) {
        session.weekIndex = weekIndex;
        day.exercises.forEach((exercise) => {
            const plan = getExercisePlan(exercise, weekIndex);
            let log = session.exercises[exercise.id];
            if (!log) {
                log = makeExerciseLog(exercise.id, exercise.variants[0].id, plan.sets);
                session.exercises[exercise.id] = log;
            }
            if (!exercise.variants.some((variant) => variant.id === log.variantId))
                log.variantId = exercise.variants[0].id;
            while (log.sets.length < plan.sets)
                log.sets.push(makeSet());
            log.sets.forEach((set) => {
                if (set.technique !== 'good' && set.technique !== 'degraded' && set.technique !== null)
                    set.technique = null;
                if (set.pain !== null && !Number.isFinite(set.pain))
                    set.pain = null;
            });
        });
    }
    seedSessionPrescriptions(session, day, date, weekIndex) {
        const recoveryAlert = analyzeRecovery(this.snapshot.dailyLogs).alert;
        day.exercises.forEach((exercise) => {
            const log = session.exercises[exercise.id];
            const plan = getExercisePlan(exercise, weekIndex);
            if (!log || log.sets.some((set) => set.done || set.weightKg !== null || set.reps !== null))
                return;
            const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
            const history = this.exerciseHistory(exercise.id, log.variantId, date, session.id);
            const prescription = prescriptionFromHistory(history, plan, exercise, variant.incrementKg, recoveryAlert);
            if (prescription.loadKg > 0) {
                log.sets.slice(0, plan.sets).forEach((set) => { set.weightKg = prescription.loadKg; });
            }
        });
    }
    exerciseHistory(exerciseId, variantId, beforeDate, excludeSessionId = '') {
        return this.snapshot.sessions
            .filter((session) => session.id !== excludeSessionId && session.date < beforeDate)
            .sort((a, b) => a.date.localeCompare(b.date))
            .flatMap((session) => {
            const log = session.exercises[exerciseId];
            const exercise = findExercise(exerciseId);
            if (!log || !exercise || log.variantId !== variantId)
                return [];
            if (!log.sets.some((set) => set.done && Number(set.weightKg) > 0 && Number(set.reps) > 0))
                return [];
            return [{
                    date: session.date,
                    weekIndex: session.weekIndex,
                    sets: log.sets,
                    plan: getExercisePlan(exercise, session.weekIndex),
                    variantId,
                }];
        });
    }
    prescriptionFor(context, exercise, log) {
        const plan = getExercisePlan(exercise, context.weekIndex);
        const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
        const history = this.exerciseHistory(exercise.id, log.variantId, context.date, context.session.id);
        return prescriptionFromHistory(history, plan, exercise, variant.incrementKg, analyzeRecovery(this.snapshot.dailyLogs).alert);
    }
    activeSetCount(session, day) {
        let done = 0;
        let total = 0;
        day.exercises.forEach((exercise) => {
            const plan = getExercisePlan(exercise, session.weekIndex);
            const log = session.exercises[exercise.id];
            if (!log)
                return;
            total += plan.sets;
            if (log.skipped)
                done += plan.sets;
            else
                done += log.sets.slice(0, plan.sets).filter((set) => set.done).length;
        });
        return { done, total };
    }
    isSessionComplete(session, day) {
        const count = this.activeSetCount(session, day);
        return count.total > 0 && count.done >= count.total;
    }
    completedWeekSessions() {
        return TRAINING_DAYS.filter((day) => {
            const date = this.dayDate(day);
            const session = this.snapshot.sessions.find((item) => item.id === `${date}:${day.id}`);
            return session ? this.isSessionComplete(session, day) : false;
        }).length;
    }
    render() {
        const tab = this.snapshot.settings.currentTab;
        const page = tab === 'weight'
            ? this.renderWeightPage()
            : tab === 'history'
                ? this.renderHistoryPage()
                : tab === 'settings'
                    ? this.renderSettingsPage()
                    : this.renderTrainingPage();
        this.root.innerHTML = `
      <div class="app-shell">
        ${this.renderHeader()}
        <main class="page">${page}</main>
        ${this.renderNavigation()}
        <div id="toast" class="toast hidden" role="status"></div>
        ${this.renderTimerOverlay()}
        <div id="update-banner" class="update-banner hidden">
          <span>Nouvelle version disponible</span>
          <button data-action="reload-update">Installer</button>
        </div>
      </div>`;
        this.tick();
    }
    renderHeader() {
        const context = this.currentContext();
        const phase = getTrainingPhase(context.weekIndex);
        const macros = macrosForCalories(this.snapshot.profile.currentCalories, this.snapshot.profile.proteinG, this.snapshot.profile.fatG);
        return `
      <header class="topbar">
        <div>
          <div class="brand-row"><span class="brand-mark">C</span><span class="brand">COLOSSE</span><span class="version">v${APP_VERSION}</span></div>
          <div class="brand-sub">${escapeHtml(phase.name)} · ${macros.calories} kcal · ${macros.proteinG} g protéines</div>
        </div>
        <div class="topbar-score">
          <strong>${this.completedWeekSessions()}<small>/6</small></strong>
          <span>séances</span>
        </div>
      </header>`;
    }
    renderNavigation() {
        const active = this.snapshot.settings.currentTab;
        const items = [
            ['training', '◫', 'Séance'],
            ['weight', '⌁', 'Poids'],
            ['history', '↗', 'Historique'],
            ['settings', '⚙', 'Réglages'],
        ];
        return `<nav class="bottom-nav" aria-label="Navigation principale">
      ${items.map(([id, icon, label]) => `<button class="nav-item ${active === id ? 'active' : ''}" data-action="tab" data-tab="${id}"><span>${icon}</span><small>${label}</small></button>`).join('')}
    </nav>`;
    }
    renderTrainingPage() {
        const context = this.currentContext();
        const phase = getTrainingPhase(context.weekIndex);
        const target = weeklyTargets(this.snapshot.profile, 1, context.weekIndex)[0];
        const planned = estimateSessionDuration(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex), this.snapshot.profile.sessionLimitMinutes);
        const setCount = this.activeSetCount(context.session, context.day);
        const progress = setCount.total ? Math.round((setCount.done / setCount.total) * 100) : 0;
        const elapsed = sessionDurationSeconds(context.session);
        const completedCounts = {};
        context.day.exercises.forEach((exercise) => {
            const plan = getExercisePlan(exercise, context.weekIndex);
            const log = context.session.exercises[exercise.id];
            completedCounts[exercise.id] = log?.skipped ? plan.sets : (log?.sets.slice(0, plan.sets).filter((set) => set.done).length ?? 0);
        });
        const remaining = remainingSessionSeconds(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex), completedCounts);
        const projected = context.session.startedAt ? elapsed + remaining : planned.seconds;
        const limitSec = this.snapshot.profile.sessionLimitMinutes * 60;
        const trim = context.session.startedAt
            ? trimSuggestions(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex), completedCounts, Math.max(0, limitSec - elapsed))
            : { overBySec: 0, savedSeconds: 0, skipExerciseIds: [], message: '' };
        const complete = this.isSessionComplete(context.session, context.day);
        return `
      <section class="phase-card" style="--phase:${phase.color}">
        <div class="phase-top">
          <div><span class="eyebrow">SEMAINE ${context.weekIndex}</span><h1>${escapeHtml(phase.name)}</h1></div>
          <div class="weight-target"><span>cible fin de semaine</span><strong>${formatKg(target.targetWeightKg, 2)} kg</strong></div>
        </div>
        <p>${escapeHtml(phase.description)}</p>
        <div class="phase-metrics">
          <span><b>${planned.minutes} min</b> prévues</span>
          <span><b>${this.snapshot.profile.currentCalories}</b> kcal</span>
          <span><b>${this.snapshot.profile.bikeMinutesTarget} min vélo</b> activité</span>
        </div>
      </section>

      <section class="week-picker">
        <button class="icon-button" data-action="week-prev" aria-label="Semaine précédente">‹</button>
        <div><strong>${formatDateFr(isoDate(this.viewWeekStart), { day: 'numeric', month: 'short' })} – ${formatDateFr(isoDate(addDays(this.viewWeekStart, 6)), { day: 'numeric', month: 'short' })}</strong><button class="text-button" data-action="week-today">Cette semaine</button></div>
        <button class="icon-button" data-action="week-next" aria-label="Semaine suivante">›</button>
      </section>

      <section class="day-tabs" aria-label="Jours d’entraînement">
        ${TRAINING_DAYS.map((day) => {
            const date = this.dayDate(day);
            const session = this.snapshot.sessions.find((item) => item.id === `${date}:${day.id}`);
            const done = session ? this.isSessionComplete(session, day) : false;
            return `<button class="day-tab ${day.id === context.day.id ? 'active' : ''}" style="--day:${day.color}" data-action="select-day" data-day="${day.id}">
            <span>${day.name}</span><small>${formatDateFr(date, { weekday: 'short', day: 'numeric' })}</small>${done ? '<i>✓</i>' : ''}
          </button>`;
        }).join('')}
      </section>

      <section class="session-card ${complete ? 'complete' : ''}">
        <div class="session-heading">
          <div><span class="eyebrow">${escapeHtml(context.day.focus)}</span><h2>${escapeHtml(context.day.name)}</h2></div>
          <div class="session-progress"><strong>${progress}%</strong><span>${setCount.done}/${setCount.total} séries</span></div>
        </div>
        <div class="progress-track"><i style="width:${progress}%"></i></div>
        <div class="time-grid" aria-label="Durée de la séance">
          <div><span>Durée prévue</span><strong>${formatClock(planned.seconds)}</strong></div>
          <div><span>Temps passé</span><strong id="session-elapsed">${formatClock(elapsed)}</strong></div>
          <div class="${projected > limitSec ? 'danger' : ''}"><span>Durée estimée</span><strong id="session-projected">${formatClock(projected)}</strong></div>
        </div>
        <div class="session-actions">
          ${!context.session.startedAt ? '<button class="primary-button" data-action="start-session">▶ Démarrer la séance</button>' : !context.session.endedAt ? '<button class="secondary-button" data-action="finish-session">■ Terminer</button>' : '<button class="secondary-button" data-action="resume-session">↻ Reprendre</button>'}
          <a class="ghost-button" href="${YOUTUBE_SEARCH}${encodeURIComponent(context.day.focus + ' échauffement musculation')}" target="_blank" rel="noopener">Échauffement</a>
        </div>
        ${complete ? '<div class="complete-banner">Séance validée. La prochaine prescription est déjà calculée.</div>' : ''}
      </section>

      ${this.renderReadiness(context.session)}
      ${trim.skipExerciseIds.length ? this.renderTrimCard(trim.skipExerciseIds, trim.savedSeconds) : ''}
      <section class="exercise-list">
        ${context.day.exercises.map((exercise, index) => this.renderExerciseCard(context, exercise, index)).join('')}
      </section>
      <section class="notes-card card">
        <label for="session-notes">Notes de séance</label>
        <textarea id="session-notes" data-session-notes placeholder="Ressenti, congestion, douleurs, observations…">${escapeHtml(context.session.notes)}</textarea>
      </section>`;
    }
    renderReadiness(session) {
        return `<section class="readiness card">
      <div class="card-title"><div><span class="eyebrow">ÉTAT DU JOUR</span><h3>Récupération</h3></div><span class="subtle">Ces réponses évitent d’augmenter tes charges quand tu récupères mal.</span></div>
      <div class="readiness-grid">
        <label>Énergie<select data-readiness="energy">${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${session.readiness.energy === value ? 'selected' : ''}>${value}/5</option>`).join('')}</select></label>
        <label>Fatigue<select data-readiness="fatigue">${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${session.readiness.fatigue === value ? 'selected' : ''}>${value}/5</option>`).join('')}</select></label>
        <label>Sommeil<input type="number" min="0" max="14" step="0.25" data-readiness="sleepHours" value="${numberInputValue(session.readiness.sleepHours)}" placeholder="h"/></label>
      </div>
    </section>`;
    }
    renderTrimCard(exerciseIds, savedSeconds) {
        return `<section class="trim-card">
      <div><span class="eyebrow">MODE &lt; 60 MIN</span><strong>Retard détecté</strong><p>Supprime uniquement les bonus : ${exerciseIds.map((id) => escapeHtml(findExercise(id)?.shortName ?? id)).join(', ')}.</p></div>
      <button data-action="apply-trim" data-exercises="${exerciseIds.join(',')}">Gagner ${Math.ceil(savedSeconds / 60)} min</button>
    </section>`;
    }
    renderExerciseCard(context, exercise, index) {
        const plan = getExercisePlan(exercise, context.weekIndex);
        const log = context.session.exercises[exercise.id];
        const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
        const prescription = this.prescriptionFor(context, exercise, log);
        const meta = decisionMeta(prescription.decision);
        const activeSets = log.sets.slice(0, plan.sets);
        const doneSets = activeSets.filter((set) => set.done);
        const currentSummary = summarizeSession(activeSets, plan);
        const lastDoneIndex = activeSets.reduce((last, set, setIndex) => set.done ? setIndex : last, -1);
        const nextSet = lastDoneIndex >= 0 && lastDoneIndex < plan.sets - 1
            ? suggestNextSet(activeSets[lastDoneIndex], plan, exercise, variant.incrementKg)
            : null;
        const nextSession = doneSets.length === plan.sets
            ? nextPrescription(activeSets, this.exerciseHistory(exercise.id, log.variantId, context.date, context.session.id), plan, exercise, variant.incrementKg, analyzeRecovery(this.snapshot.dailyLogs).alert)
            : null;
        const targetText = prescription.status === 'CALIBRATION'
            ? 'Trouve ta charge de départ'
            : `${formatKg(prescription.loadKg)} kg × ${plan.repMin}–${plan.repMax}`;
        const displayedReason = prescription.status === 'CALIBRATION'
            ? `Commence prudemment : à la fin de la série, tu dois pouvoir faire encore ${plan.targetRir} répétitions.`
            : prescription.reason;
        const confidenceLabel = prescription.confidence === 'high'
            ? 'élevée'
            : prescription.confidence === 'medium'
                ? 'moyenne'
                : prescription.confidence === 'low'
                    ? 'faible'
                    : 'à établir';
        return `<article class="exercise-card ${log.skipped ? 'skipped' : ''}" style="--accent:${context.day.color}" data-exercise-card="${exercise.id}">
      <div class="exercise-head">
        <div class="exercise-index">${String(index + 1).padStart(2, '0')}</div>
        <div class="exercise-title">
          <div class="exercise-name-row"><h3>${escapeHtml(exercise.name)}</h3>${exercise.optional ? '<span class="badge">BONUS</span>' : ''}${exercise.superset ? `<span class="badge muted">SUPERSET ${escapeHtml(exercise.superset.split('-').at(-1) ?? '')}</span>` : ''}</div>
          <div class="exercise-plan"><b>${plan.sets} × ${plan.repMin}–${plan.repMax} reps</b><span>marge ${plan.targetRir} reps</span><span>repos ${formatClock(plan.restSec)}</span></div>
        </div>
        <a class="video-link" href="${YOUTUBE_SEARCH}${encodeURIComponent(exercise.name + ' technique musculation')}" target="_blank" rel="noopener" aria-label="Voir la technique">▶</a>
      </div>

      <div class="prescription ${meta.className}">
        <div><span>${meta.icon} ${meta.label}</span><strong>${targetText}</strong></div>
        <p>${escapeHtml(displayedReason)}</p>
        ${prescription.smoothedE1RM > 0 ? `<small>Force estimée ${formatKg(prescription.smoothedE1RM)} kg · fiabilité ${confidenceLabel}${prescription.averageRir !== null ? ` · marge moyenne ${formatKg(prescription.averageRir)} reps` : ''}</small>` : '<small>Après ta première série, Colosse ajustera la charge suivante.</small>'}
      </div>

      <div class="variant-row">
        <label>Variante
          <select data-exercise-variant="${exercise.id}">
            ${exercise.variants.map((item) => `<option value="${item.id}" ${item.id === log.variantId ? 'selected' : ''}>${escapeHtml(item.label)} · pas ${formatKg(item.incrementKg)} kg</option>`).join('')}
          </select>
        </label>
        ${exercise.variants.length > 1 ? '<span>Machine occupée ? Change ici : l’historique reste séparé.</span>' : ''}
      </div>

      <div class="set-table">
        <div class="set-help">Marge = nombre de répétitions que tu aurais encore pu faire.</div>
        <div class="set-head"><span>#</span><span>KG</span><span>REPS</span><span>MARGE</span><span>FORME</span><span>DOUL.</span><span>OK</span></div>
        ${activeSets.map((set, setIndex) => this.renderSetRow(exercise, set, setIndex, prescription, plan)).join('')}
      </div>

      ${nextSet && nextSet.action !== 'WAIT' ? `<div class="next-set ${nextSet.action === 'STOP_OR_SWAP' ? 'danger' : ''}"><div><span>SÉRIE ${lastDoneIndex + 2}</span><strong>${nextSet.loadKg ? `${formatKg(nextSet.loadKg)} kg` : 'Arrêt'} · ${plan.repMin}–${plan.repMax} reps · marge ${plan.targetRir}</strong><p>${escapeHtml(nextSet.label)}</p></div>${nextSet.loadKg ? `<button data-action="apply-next-load" data-exercise="${exercise.id}" data-set="${lastDoneIndex + 1}" data-load="${nextSet.loadKg}">Appliquer</button>` : ''}</div>` : ''}
      ${nextSession ? `<div class="next-session"><span>PROCHAINE EXPOSITION</span><strong>${formatKg(nextSession.loadKg)} kg · objectif ${nextSession.targetTotalReps} reps totales</strong><p>${escapeHtml(nextSession.reason)}</p></div>` : ''}
      <div class="cue"><span>COACHING</span><p>${escapeHtml(exercise.coachingCue)}</p></div>
      <div class="exercise-footer">
        <span>${currentSummary.totalReps || 0} reps · ${Math.round(activeSets.reduce((sum, set) => sum + (set.done ? Number(set.weightKg || 0) * Number(set.reps || 0) : 0), 0)).toLocaleString('fr-FR')} kg volume</span>
        <button class="text-button danger-text" data-action="toggle-skip-exercise" data-exercise="${exercise.id}">${log.skipped ? 'Réactiver' : 'Passer cet exercice'}</button>
      </div>
    </article>`;
    }
    renderSetRow(exercise, set, setIndex, prescription, plan) {
        const suggestedWeight = set.weightKg ?? (prescription.loadKg || null);
        const hit = set.done
            && Number(set.reps) >= plan.repMin
            && Number(set.reps) <= plan.repMax
            && set.technique === 'good'
            && Number(set.pain ?? 0) <= 3;
        return `<div class="set-row ${set.done ? 'done' : ''} ${hit ? 'hit' : ''}" data-set-row data-exercise="${exercise.id}" data-set="${setIndex}">
      <span class="set-number">${setIndex + 1}</span>
      <input type="number" inputmode="decimal" min="0" step="0.25" data-set-field="weightKg" value="${numberInputValue(suggestedWeight)}" placeholder="kg" aria-label="Charge série ${setIndex + 1}"/>
      <input type="number" inputmode="numeric" min="0" max="50" step="1" data-set-field="reps" value="${numberInputValue(set.reps)}" placeholder="reps" aria-label="Répétitions série ${setIndex + 1}"/>
      <select data-set-field="rir" aria-label="Répétitions encore possibles après la série ${setIndex + 1}"><option value="">—</option>${[0, 1, 2, 3, 4, 5, 6].map((value) => `<option value="${value}" ${set.rir === value ? 'selected' : ''}>${value}</option>`).join('')}</select>
      <select data-set-field="technique" aria-label="Technique série ${setIndex + 1}"><option value="" ${set.technique === null ? 'selected' : ''}>—</option><option value="good" ${set.technique === 'good' ? 'selected' : ''}>✓</option><option value="degraded" ${set.technique === 'degraded' ? 'selected' : ''}>△</option></select>
      <select data-set-field="pain" aria-label="Douleur série ${setIndex + 1}"><option value="" ${set.pain === null ? 'selected' : ''}>—</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => `<option value="${value}" ${set.pain === value ? 'selected' : ''}>${value}</option>`).join('')}</select>
      <button class="set-check" data-action="toggle-set" data-exercise="${exercise.id}" data-set="${setIndex}" aria-label="Valider série ${setIndex + 1}">${set.done ? '✓' : ''}</button>
      ${set.restActualSec ? `<small class="rest-actual">repos ${formatClock(set.restActualSec)}</small>` : ''}
    </div>`;
    }
    renderWeightPage() {
        const today = isoDate();
        const log = this.dailyLog(today);
        const recovery = analyzeRecovery(this.snapshot.dailyLogs);
        const strength = analyzeStrengthTrend(this.snapshot.sessions);
        const analysis = analyzeWeightTrend(this.snapshot.dailyLogs, this.snapshot.profile, this.snapshot.adjustments, { date: today, strengthAlert: strength.alert, recoveryAlert: recovery.alert });
        const currentWeek = weekIndexFromStart(this.snapshot.profile.startDate, today);
        const currentTarget = weeklyTargets(this.snapshot.profile, 1, currentWeek)[0];
        const targets = weeklyTargets(this.snapshot.profile, 8, currentWeek);
        const macros = macrosForCalories(this.snapshot.profile.currentCalories, this.snapshot.profile.proteinG, this.snapshot.profile.fatG);
        const chartStart = addDays(new Date(), -27);
        const targetPoints = Array.from({ length: 28 }, (_, index) => {
            const date = isoDate(addDays(chartStart, index));
            return { date, weight: targetWeight(this.snapshot.profile, date) };
        });
        const recentLogs = [...this.snapshot.dailyLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
        const activity = activityProgress(log, this.snapshot.profile);
        return `
      <section class="weight-hero">
        <div><span class="eyebrow">SUIVI DU POIDS</span><h1>${formatKg(analysis.currentAverageKg || log.weightKg, 2)} kg</h1><p>Ton poids moyen des 7 derniers jours. Colosse ajuste le plan d’après les 14 derniers jours.</p></div>
        <div class="weight-target"><span>cible dimanche</span><strong>${formatKg(currentTarget.targetWeightKg, 2)} kg</strong><small>${formatKg(currentTarget.toleranceLowKg, 2)} – ${formatKg(currentTarget.toleranceHighKg, 2)}</small></div>
      </section>

      <section class="macro-grid">
        <div><span>Calories</span><strong>${macros.calories}</strong><small>kcal/j</small></div>
        <div><span>Protéines</span><strong>${macros.proteinG}</strong><small>g/j</small></div>
        <div><span>Glucides</span><strong>${macros.carbsG}</strong><small>g/j</small></div>
        <div><span>Lipides</span><strong>${macros.fatG}</strong><small>g/j</small></div>
      </section>

      <section class="trend-card card status-${analysis.status.toLowerCase()}">
        <div class="card-title"><div><span class="eyebrow">BILAN COLOSSE</span><h2>${this.weightStatusLabel(analysis.status)}</h2></div><span class="status-pill">${analysis.samples} pesées</span></div>
        <p>${escapeHtml(analysis.reason)}</p>
        <div class="trend-metrics">
          <div><span>Perte observée</span><strong>${analysis.enoughData ? `${formatKg(analysis.observedLossKgPerWeek, 3)} kg/sem` : '—'}</strong></div>
          <div><span>Perte cible</span><strong>${formatKg(analysis.targetLossKgPerWeek, 3)} kg/sem</strong></div>
          <div><span>Adhérence</span><strong>${pct(analysis.adherencePct, 0)}</strong></div>
        </div>
        ${analysis.action === 'CALORIES' && analysis.calorieDelta !== 0 ? `<button class="primary-button" data-action="apply-calorie-adjustment">Appliquer ${analysis.calorieDelta > 0 ? '+' : ''}${analysis.calorieDelta} kcal → ${analysis.proposedCalories} kcal</button>` : ''}
        ${analysis.action === 'ACTIVITY' ? '<button class="primary-button" data-action="apply-activity-adjustment">Ajouter 5 min de vélo/jour</button>' : ''}
        ${(strength.alert || recovery.alert) ? `<div class="alert-strip"><strong>Récupération sous surveillance</strong><span>${escapeHtml([strength.alert ? strength.reason : '', ...recovery.reasons].filter(Boolean).join(' '))}</span></div>` : ''}
      </section>

      <section class="card chart-card">
        <div class="card-title"><div><span class="eyebrow">28 JOURS</span><h2>Poids réel vs trajectoire</h2></div><div class="chart-legend"><span class="actual">Réel</span><span class="target">Cible</span></div></div>
        ${sparklineSvg(this.snapshot.dailyLogs, targetPoints)}
      </section>

      <section class="card activity-card ${activity.complete ? 'complete' : ''}">
        <div class="card-title">
          <div><span class="eyebrow">ACTIVITÉ DU JOUR</span><h2>Pas, vélo ou les deux</h2></div>
          <span class="activity-status">${activity.complete ? '✓ Objectif atteint' : `${activity.percent}%`}</span>
        </div>
        <p class="activity-rule">${escapeHtml(activityGoalLabel(this.snapshot.profile))}</p>
        <div class="progress-track activity-progress"><i style="width:${activity.percent}%"></i></div>
        <div class="form-grid activity-fields">
          ${this.dailyField('steps', 'Pas mesurés par l’iPhone', 'pas', log.steps, '1', 0)}
          ${this.dailyField('bikeMinutes', 'Vélo', 'min', log.bikeMinutes, '1', 0, 240)}
          <label>Intensité du vélo
            <select data-daily-text-field="bikeIntensity">
              <option value="easy" ${log.bikeIntensity === 'easy' ? 'selected' : ''}>Facile</option>
              <option value="moderate" ${log.bikeIntensity === 'moderate' ? 'selected' : ''}>Modérée</option>
              <option value="vigorous" ${log.bikeIntensity === 'vigorous' ? 'selected' : ''}>Soutenue</option>
            </select>
          </label>
          <div class="activity-mode"><span>Mode détecté</span><strong>${activityModeLabel(log)}</strong><small>${activity.bikeMinutes ? `${activity.bikeEquivalentMinutes} min modérées comptées` : 'Saisie manuelle'}</small></div>
        </div>
        <p class="activity-help">Pas de vitesse imposée : modérée = tu peux parler, pas chanter ; soutenue = seulement quelques mots.</p>
      </section>

      <section class="card daily-form">
        <div class="card-title"><div><span class="eyebrow">AUJOURD’HUI · ${formatDateFr(today)}</span><h2>Check-in quotidien</h2></div><span class="subtle">2 minutes</span></div>
        <div class="form-grid">
          ${this.dailyField('weightKg', 'Poids', 'kg', log.weightKg, '0.05')}
          ${this.dailyField('waistCm', 'Tour de taille', 'cm', log.waistCm, '0.1')}
          ${this.dailyField('calories', 'Calories réelles', 'kcal', log.calories, '1')}
          ${this.dailyField('adherencePct', 'Adhérence', '%', log.adherencePct, '1', 0, 100)}
          ${this.dailyField('sleepHours', 'Sommeil', 'h', log.sleepHours, '0.25', 0, 14)}
          ${this.dailyField('fatigue', 'Fatigue', '/5', log.fatigue, '1', 1, 5)}
        </div>
        <label class="full-label">Notes<textarea data-daily-notes="${today}" placeholder="Faim, digestion, alcool, événement inhabituel…">${escapeHtml(log.notes)}</textarea></label>
      </section>

      <section class="card targets-card">
        <div class="card-title"><div><span class="eyebrow">TRAJECTOIRE</span><h2>Objectifs hebdomadaires</h2></div><span class="subtle">−${(this.snapshot.profile.weeklyLossRatePct * 100).toFixed(2)} %/sem</span></div>
        <div class="target-table">
          ${targets.map((target, index) => `<div class="target-row ${index === 0 ? 'current' : ''}"><span>S${target.weekIndex}<small>${formatDateFr(target.endDate, { day: 'numeric', month: 'short' })}</small></span><strong>${formatKg(target.targetWeightKg, 2)} kg</strong><small>${formatKg(target.toleranceLowKg, 2)}–${formatKg(target.toleranceHighKg, 2)}</small></div>`).join('')}
        </div>
      </section>

      <section class="card recent-checkins">
        <div class="card-title"><div><span class="eyebrow">DONNÉES</span><h2>Derniers check-ins</h2></div></div>
        ${recentLogs.length ? `<div class="log-list">${recentLogs.map((item) => `<div><span>${formatDateFr(item.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span><strong>${formatKg(item.weightKg, 2)} kg</strong><small>${item.adherencePct !== null ? `${item.adherencePct}%` : '—'} · ${activitySummary(item)}</small></div>`).join('')}</div>` : '<p class="empty-state">Aucune donnée quotidienne.</p>'}
      </section>`;
    }
    dailyField(field, label, unit, value, step, min, max) {
        return `<label>${escapeHtml(label)}<div class="input-unit"><input type="number" inputmode="decimal" step="${step}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} data-daily-field="${String(field)}" value="${numberInputValue(value)}"/><span>${escapeHtml(unit)}</span></div></label>`;
    }
    weightStatusLabel(status) {
        switch (status) {
            case 'ON_TRACK': return 'Trajectoire tenue';
            case 'TOO_SLOW': return 'Perte trop lente';
            case 'TOO_FAST': return 'Perte trop rapide';
            case 'ADHERENCE': return 'Exécution à corriger';
            case 'RECOVERY': return 'Récupération prioritaire';
            case 'ACTIVITY': return 'Augmente l’activité';
            case 'HOLD': return 'Maintien du plan';
            default: return 'Collecte des données';
        }
    }
    renderHistoryPage() {
        const sessions = [...this.snapshot.sessions]
            .filter((session) => Object.values(session.exercises).some((exercise) => exercise.sets.some((set) => set.done)))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30);
        const strength = analyzeStrengthTrend(this.snapshot.sessions);
        const selectedDay = this.currentDay();
        const previewDate = this.dayDate(selectedDay);
        const previewWeek = weekIndexFromStart(this.snapshot.profile.startDate, previewDate);
        const mockSession = this.snapshot.sessions.find((session) => session.id === `${previewDate}:${selectedDay.id}`)
            ?? makeSession(selectedDay.id, previewDate, this.snapshot.profile);
        this.syncSession(mockSession, selectedDay, previewWeek);
        const adjustments = [...this.snapshot.adjustments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
        return `
      <section class="history-hero">
        <div><span class="eyebrow">PROGRESSION</span><h1>${sessions.length} séances enregistrées</h1><p>${escapeHtml(strength.reason)}</p></div>
        <div class="strength-chip ${strength.alert ? 'danger' : ''}"><span>Force récente</span><strong>${strength.changePct >= 0 ? '+' : ''}${strength.changePct.toFixed(1)} %</strong></div>
      </section>

      <section class="card prescription-board">
        <div class="card-title"><div><span class="eyebrow">PROCHAINE SÉANCE · ${escapeHtml(selectedDay.name)}</span><h2>Charges prescrites</h2></div></div>
        <div class="prescription-list">
          ${selectedDay.exercises.map((exercise) => {
            const log = mockSession.exercises[exercise.id];
            const context = { day: selectedDay, date: previewDate, weekIndex: previewWeek, session: mockSession };
            const prescription = this.prescriptionFor(context, exercise, log);
            const meta = decisionMeta(prescription.decision);
            return `<div><span>${escapeHtml(exercise.shortName)}<small>${escapeHtml(exercise.variants.find((variant) => variant.id === log.variantId)?.label ?? '')}</small></span><strong>${prescription.loadKg > 0 ? `${formatKg(prescription.loadKg)} kg` : 'Calibration'}</strong><em class="${meta.className}">${meta.icon} ${meta.label}</em></div>`;
        }).join('')}
        </div>
      </section>

      <section class="card">
        <div class="card-title"><div><span class="eyebrow">JOURNAL</span><h2>Dernières séances</h2></div></div>
        ${sessions.length ? `<div class="session-history">${sessions.map((session) => this.renderHistorySession(session)).join('')}</div>` : '<p class="empty-state">Aucune séance terminée.</p>'}
      </section>

      <section class="card">
        <div class="card-title"><div><span class="eyebrow">NUTRITION</span><h2>Ajustements appliqués</h2></div></div>
        ${adjustments.length ? `<div class="adjustment-list">${adjustments.map((adjustment) => `<div><span>${formatDateFr(adjustment.date)}</span><strong>${adjustment.previousCalories} → ${adjustment.newCalories} kcal</strong><small>${escapeHtml(adjustment.reason)}</small></div>`).join('')}</div>` : '<p class="empty-state">Aucun ajustement calorique appliqué.</p>'}
      </section>

      ${this.snapshot.legacyArchive ? `<section class="legacy-card"><strong>Historique Colosse v2 importé</strong><span>${this.snapshot.legacyArchive.convertedSessions} séances converties et archive brute conservée.</span></section>` : ''}`;
    }
    renderHistorySession(session) {
        const day = findDay(session.dayId);
        const count = this.activeSetCount(session, day);
        const completion = count.total ? Math.round((count.done / count.total) * 100) : 0;
        const duration = sessionDurationSeconds(session);
        return `<details class="history-session">
      <summary><div><span>${formatDateFr(session.date, { weekday: 'long', day: 'numeric', month: 'short' })}</span><strong>${escapeHtml(day.name)} · ${completion}%</strong></div><div><span>${duration ? formatClock(duration) : '—'}</span><small>${(sessionTonnage(session) / 1000).toFixed(1)} t</small></div></summary>
      <div class="history-detail">
        ${day.exercises.map((exercise) => {
            const log = session.exercises[exercise.id];
            if (!log)
                return '';
            const done = log.sets.filter((set) => set.done && set.weightKg && set.reps);
            if (!done.length && !log.skipped)
                return '';
            return `<div><span>${escapeHtml(exercise.shortName)}</span><strong>${log.skipped ? 'Passé' : done.map((set) => `${formatKg(set.weightKg)}×${set.reps}@${set.rir ?? '?'}`).join(' · ')}</strong></div>`;
        }).join('')}
        ${session.notes ? `<p>${escapeHtml(session.notes)}</p>` : ''}
        <button class="text-button danger-text" data-action="delete-session" data-session="${escapeHtml(session.id)}">Supprimer cette séance</button>
      </div>
    </details>`;
    }
    renderSettingsPage() {
        const profile = this.snapshot.profile;
        const settings = this.snapshot.settings;
        return `
      <section class="settings-hero"><span class="eyebrow">CONFIGURATION</span><h1>Tes réglages Colosse</h1><p>Retrouve ici tes objectifs d’entraînement, de poids, d’activité et de nutrition.</p></section>

      <section class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">PROFIL</span><h2>Données de départ</h2></div></div>
        <div class="form-grid">
          ${this.profileField('age', 'Âge', profile.age, 'ans', '1', 18, 90)}
          ${this.profileField('heightCm', 'Taille', profile.heightCm, 'cm', '1', 130, 230)}
          ${this.profileField('startWeightKg', 'Poids de départ', profile.startWeightKg, 'kg', '0.1', 40, 250)}
          <label>Date de départ<div class="input-unit"><input type="date" data-profile-field="startDate" value="${escapeHtml(profile.startDate)}"/></div></label>
          ${this.profileField('weeklyLossRatePct', 'Perte / semaine', profile.weeklyLossRatePct * 100, '%', '0.05', 0.1, 1)}
          ${this.profileField('sessionLimitMinutes', 'Limite séance', profile.sessionLimitMinutes, 'min', '1', 40, 90)}
        </div>
      </section>

      <section class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">NUTRITION</span><h2>Garde-fous</h2></div></div>
        <div class="form-grid">
          ${this.profileField('currentCalories', 'Calories actuelles', profile.currentCalories, 'kcal', '50', 1500, 6000)}
          ${this.profileField('proteinG', 'Protéines', profile.proteinG, 'g', '5', 80, 350)}
          ${this.profileField('fatG', 'Lipides', profile.fatG, 'g', '5', 40, 200)}
          ${this.profileField('minimumCalories', 'Plancher', profile.minimumCalories, 'kcal', '50', 1500, 5000)}
          ${this.profileField('maximumCalories', 'Plafond', profile.maximumCalories, 'kcal', '50', 2000, 7000)}
          ${this.profileField('dailyStepTarget', 'Socle de pas', profile.dailyStepTarget, 'pas', '250', 1000, 20000)}
          ${this.profileField('stepsOnlyTarget', 'Objectif 100 % pas', profile.stepsOnlyTarget, 'pas', '250', 3000, 30000)}
          ${this.profileField('bikeMinutesTarget', 'Vélo modéré', profile.bikeMinutesTarget, 'min', '5', 5, 120)}
        </div>
        <p class="subtle-block settings-help">Colosse valide l’activité avec l’objectif de pas complet, ou avec le socle de pas accompagné du vélo.</p>
      </section>

      <section class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">EXPÉRIENCE</span><h2>Comportement de l’application</h2></div></div>
        <div class="toggle-list">
          ${this.settingToggle('autoStartTimer', 'Démarrer automatiquement le repos', settings.autoStartTimer)}
          ${this.settingToggle('soundEnabled', 'Signal sonore en fin de repos', settings.soundEnabled)}
          ${this.settingToggle('vibrationEnabled', 'Vibration en fin de repos', settings.vibrationEnabled)}
        </div>
        ${this.installPrompt ? '<button class="primary-button" data-action="install-app">Installer Colosse sur cet appareil</button>' : ''}
      </section>

      <section class="card settings-section">
        <div class="card-title"><div><span class="eyebrow">DONNÉES</span><h2>Sauvegarde et migration</h2></div><span class="status-pill">${storageMode()}</span></div>
        <p class="subtle-block">Les données restent sur cet appareil. Exporte régulièrement un JSON de sauvegarde.</p>
        <div class="data-actions">
          <button class="secondary-button" data-action="export-data">Exporter JSON</button>
          <button class="secondary-button" data-action="import-data">Importer JSON</button>
          <input id="import-file" type="file" accept="application/json,.json" hidden/>
        </div>
        ${this.snapshot.legacyArchive ? `<div class="legacy-note">Migration v2 : ${this.snapshot.legacyArchive.convertedSessions} séances converties le ${formatDateFr(this.snapshot.legacyArchive.importedAt.slice(0, 10))}.</div>` : '<div class="legacy-note">Aucune ancienne base détectée.</div>'}
        <button class="danger-button" data-action="reset-data">Effacer toutes les données</button>
      </section>

      <section class="about-card"><strong>Colosse Adaptive ${APP_VERSION}</strong><span>Moteur déterministe · IndexedDB · PWA hors ligne · aucune donnée envoyée à un serveur.</span></section>`;
    }
    profileField(field, label, value, unit, step, min, max) {
        return `<label>${escapeHtml(label)}<div class="input-unit"><input type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" data-profile-field="${String(field)}" value="${numberInputValue(value)}"/><span>${escapeHtml(unit)}</span></div></label>`;
    }
    settingToggle(field, label, checked) {
        return `<label class="toggle-row"><span>${escapeHtml(label)}</span><input type="checkbox" data-setting-field="${String(field)}" ${checked ? 'checked' : ''}/><i></i></label>`;
    }
    renderTimerOverlay() {
        if (!this.timer)
            return '';
        const remaining = this.timerRemainingSec();
        return `<div class="timer-overlay" role="dialog" aria-label="Chronomètre de repos">
      <div class="timer-label">REPOS</div>
      <strong id="timer-remaining">${formatClock(remaining)}</strong>
      <div class="timer-progress"><i id="timer-progress" style="width:${Math.max(0, Math.min(100, remaining / this.timer.totalSec * 100))}%"></i></div>
      <div class="timer-actions">
        <button data-action="timer-minus">−15 s</button>
        <button class="timer-pause" data-action="timer-pause">${this.timer.paused ? '▶' : 'Ⅱ'}</button>
        <button data-action="timer-plus">+15 s</button>
      </div>
      <button class="timer-skip" data-action="timer-skip">Passer le repos</button>
    </div>`;
    }
    async handleClick(event) {
        const actionElement = event.target.closest('[data-action]');
        if (!actionElement)
            return;
        const action = actionElement.dataset.action;
        switch (action) {
            case 'tab': {
                const tab = actionElement.dataset.tab;
                this.snapshot.settings.currentTab = tab;
                await saveSettings(this.snapshot.settings);
                this.render();
                break;
            }
            case 'week-prev':
                this.viewWeekStart = addDays(this.viewWeekStart, -7);
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'week-next':
                this.viewWeekStart = addDays(this.viewWeekStart, 7);
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'week-today':
                {
                    const today = new Date();
                    this.viewWeekStart = startOfWeek(today);
                    this.snapshot.settings.selectedDayId = defaultDayForDate(today).id;
                    await saveSettings(this.snapshot.settings);
                }
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'select-day':
                this.snapshot.settings.selectedDayId = actionElement.dataset.day ?? TRAINING_DAYS[0].id;
                await saveSettings(this.snapshot.settings);
                await this.ensureCurrentSession();
                this.render();
                break;
            case 'start-session':
                await this.startSession();
                break;
            case 'finish-session':
                await this.finishSession();
                break;
            case 'resume-session': {
                const context = this.currentContext();
                context.session.endedAt = null;
                context.session.updatedAt = Date.now();
                await saveSession(context.session);
                await this.acquireWakeLock();
                this.render();
                break;
            }
            case 'toggle-set':
                await this.toggleSet(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.set));
                break;
            case 'apply-next-load':
                await this.applyNextLoad(actionElement.dataset.exercise ?? '', Number(actionElement.dataset.set), Number(actionElement.dataset.load));
                break;
            case 'toggle-skip-exercise':
                await this.toggleSkipExercise(actionElement.dataset.exercise ?? '');
                break;
            case 'apply-trim':
                await this.applyTrim((actionElement.dataset.exercises ?? '').split(',').filter(Boolean));
                break;
            case 'timer-minus':
                this.adjustTimer(-15);
                break;
            case 'timer-plus':
                this.adjustTimer(15);
                break;
            case 'timer-pause':
                this.toggleTimerPause();
                this.render();
                break;
            case 'timer-skip':
                await this.closeRestTimer(false);
                this.render();
                break;
            case 'apply-calorie-adjustment':
                await this.applyCalorieAdjustment();
                break;
            case 'apply-activity-adjustment':
                this.snapshot.profile.bikeMinutesTarget = Math.min(60, this.snapshot.profile.bikeMinutesTarget + 5);
                await saveProfile(this.snapshot.profile);
                this.showToast(`Nouvel objectif : ${this.snapshot.profile.bikeMinutesTarget} min de vélo modéré.`, 'success');
                this.render();
                break;
            case 'delete-session':
                if (confirm('Supprimer définitivement cette séance ?')) {
                    const sessionId = actionElement.dataset.session ?? '';
                    await deleteSession(sessionId);
                    this.snapshot.sessions = this.snapshot.sessions.filter((session) => session.id !== sessionId);
                    this.render();
                }
                break;
            case 'export-data':
                this.exportData();
                break;
            case 'import-data':
                document.getElementById('import-file')?.click();
                break;
            case 'reset-data':
                await this.resetData();
                break;
            case 'install-app':
                await this.installApp();
                break;
            case 'reload-update':
                await this.applyServiceWorkerUpdate();
                break;
            default:
                break;
        }
    }
    async handleChange(event) {
        const target = event.target;
        if (target.id === 'import-file' && target instanceof HTMLInputElement && target.files?.[0]) {
            await this.importData(target.files[0]);
            return;
        }
        const readiness = target.dataset.readiness;
        if (readiness) {
            const context = this.currentContext();
            const value = parseNumber(target.value);
            if (readiness === 'sleepHours')
                context.session.readiness.sleepHours = value;
            else
                context.session.readiness[readiness] = Number(value ?? 0);
            context.session.updatedAt = Date.now();
            await saveSession(context.session);
            return;
        }
        const variantExerciseId = target.dataset.exerciseVariant;
        if (variantExerciseId) {
            await this.changeVariant(variantExerciseId, target.value);
            return;
        }
        const setField = target.dataset.setField;
        if (setField) {
            const row = target.closest('[data-set-row]');
            if (!row)
                return;
            this.updateSetField(row.dataset.exercise ?? '', Number(row.dataset.set), setField, target.value);
            await saveSession(this.currentContext().session);
            return;
        }
        const dailyField = target.dataset.dailyField;
        if (dailyField) {
            const log = this.dailyLog(isoDate());
            log[dailyField] = parseNumber(target.value);
            await saveDailyLog(log);
            this.render();
            return;
        }
        const dailyTextField = target.dataset.dailyTextField;
        if (dailyTextField) {
            const log = this.dailyLog(isoDate());
            log[dailyTextField] = target.value;
            await saveDailyLog(log);
            this.render();
            return;
        }
        const profileField = target.dataset.profileField;
        if (profileField) {
            await this.updateProfileField(profileField, target.value);
            return;
        }
        const settingField = target.dataset.settingField;
        if (settingField && target instanceof HTMLInputElement) {
            this.snapshot.settings[settingField] = target.checked;
            await saveSettings(this.snapshot.settings);
            this.render();
        }
    }
    async handleInput(event) {
        const target = event.target;
        if (target.dataset.sessionNotes !== undefined) {
            const context = this.currentContext();
            context.session.notes = target.value;
            context.session.updatedAt = Date.now();
            this.scheduleSnapshotSave();
        }
        if (target.dataset.dailyNotes) {
            const log = this.dailyLog(target.dataset.dailyNotes);
            log.notes = target.value;
            this.scheduleSnapshotSave();
        }
    }
    scheduleSnapshotSave() {
        if (this.saveDebounce !== null)
            window.clearTimeout(this.saveDebounce);
        this.saveDebounce = window.setTimeout(() => {
            void saveSnapshot(this.snapshot);
            this.saveDebounce = null;
        }, 500);
    }
    async startSession() {
        const context = this.currentContext();
        context.session.startedAt = Date.now();
        context.session.endedAt = null;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        await this.acquireWakeLock();
        this.render();
    }
    async finishSession() {
        await this.closeRestTimer(false);
        const context = this.currentContext();
        if (!context.session.startedAt)
            context.session.startedAt = Date.now();
        context.session.endedAt = Date.now();
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        await this.releaseWakeLock();
        this.showToast('Séance enregistrée. Les prochaines charges sont recalculées.', 'success');
        this.render();
    }
    readSetRow(exerciseId, setIndex) {
        const row = this.root.querySelector(`[data-set-row][data-exercise="${CSS.escape(exerciseId)}"][data-set="${setIndex}"]`);
        if (!row)
            return;
        row.querySelectorAll('[data-set-field]').forEach((field) => {
            this.updateSetField(exerciseId, setIndex, field.dataset.setField, field.value);
        });
    }
    updateSetField(exerciseId, setIndex, field, rawValue) {
        const context = this.currentContext();
        const set = context.session.exercises[exerciseId]?.sets[setIndex];
        if (!set)
            return;
        if (field === 'weightKg')
            set.weightKg = parseNumber(rawValue);
        else if (field === 'reps')
            set.reps = parseInteger(rawValue);
        else if (field === 'rir')
            set.rir = parseNumber(rawValue);
        else if (field === 'pain')
            set.pain = rawValue === '' ? null : Number(parseInteger(rawValue) ?? 0);
        else if (field === 'technique')
            set.technique = rawValue === '' ? null : rawValue === 'degraded' ? 'degraded' : 'good';
        context.session.updatedAt = Date.now();
    }
    async toggleSet(exerciseId, setIndex) {
        const context = this.currentContext();
        this.readSetRow(exerciseId, setIndex);
        const exercise = context.day.exercises.find((item) => item.id === exerciseId);
        const log = context.session.exercises[exerciseId];
        const set = log?.sets[setIndex];
        if (!exercise || !log || !set)
            return;
        if (set.done) {
            set.done = false;
            set.completedAt = null;
            set.restActualSec = null;
            context.session.updatedAt = Date.now();
            await saveSession(context.session);
            this.render();
            return;
        }
        if (!(Number(set.weightKg) > 0) || !(Number(set.reps) > 0) || set.rir === null || set.technique === null || set.pain === null) {
            this.showToast('Renseigne la charge, les répétitions, la marge, la forme et la douleur avant de valider.', 'error');
            return;
        }
        if (this.timer)
            await this.closeRestTimer(false);
        if (!context.session.startedAt) {
            context.session.startedAt = Date.now();
            context.session.endedAt = null;
            await this.acquireWakeLock();
        }
        set.done = true;
        set.completedAt = Date.now();
        context.session.updatedAt = Date.now();
        const plan = getExercisePlan(exercise, context.weekIndex);
        const variant = exercise.variants.find((item) => item.id === log.variantId) ?? exercise.variants[0];
        const suggestion = suggestNextSet(set, plan, exercise, variant.incrementKg);
        const nextSet = log.sets[setIndex + 1];
        if (nextSet && !nextSet.done && suggestion.loadKg > 0)
            nextSet.weightKg = suggestion.loadKg;
        await saveSession(context.session);
        if (Number(set.pain) >= 4)
            this.showToast('Douleur ≥ 4/10 : arrête cet exercice et choisis une variante indolore.', 'error', 6000);
        else if (set.technique === 'degraded')
            this.showToast('Technique dégradée : aucune hausse de charge ne sera autorisée.', 'info', 5000);
        if (this.snapshot.settings.autoStartTimer && this.shouldStartRest(exercise, setIndex, context)) {
            this.startRestTimer(exercise.id, setIndex, plan.restSec);
        }
        this.render();
    }
    shouldStartRest(exercise, setIndex, context) {
        const plan = getExercisePlan(exercise, context.weekIndex);
        if (!exercise.superset)
            return setIndex < plan.sets - 1;
        const group = context.day.exercises.filter((item) => item.superset === exercise.superset);
        const lastExercise = group.at(-1);
        const maxSets = Math.max(...group.map((item) => getExercisePlan(item, context.weekIndex).sets));
        return lastExercise?.id === exercise.id && setIndex < maxSets - 1;
    }
    async applyNextLoad(exerciseId, setIndex, loadKg) {
        const context = this.currentContext();
        const set = context.session.exercises[exerciseId]?.sets[setIndex];
        if (!set)
            return;
        set.weightKg = loadKg;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.render();
    }
    async changeVariant(exerciseId, variantId) {
        const context = this.currentContext();
        const exercise = context.day.exercises.find((item) => item.id === exerciseId);
        const log = context.session.exercises[exerciseId];
        if (!exercise || !log || !exercise.variants.some((variant) => variant.id === variantId))
            return;
        if (log.sets.some((set) => set.done) && !confirm('Changer de variante efface les séries de cet exercice pour éviter de mélanger les machines. Continuer ?')) {
            this.render();
            return;
        }
        const plan = getExercisePlan(exercise, context.weekIndex);
        log.variantId = variantId;
        log.sets = Array.from({ length: plan.sets }, () => makeSet());
        log.skipped = false;
        this.seedSessionPrescriptions(context.session, context.day, context.date, context.weekIndex);
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.render();
    }
    async toggleSkipExercise(exerciseId) {
        const context = this.currentContext();
        const log = context.session.exercises[exerciseId];
        if (!log)
            return;
        log.skipped = !log.skipped;
        log.skipReason = log.skipped ? 'Décision manuelle / contrainte de temps' : undefined;
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.render();
    }
    async applyTrim(exerciseIds) {
        const context = this.currentContext();
        exerciseIds.forEach((exerciseId) => {
            const log = context.session.exercises[exerciseId];
            if (log && !log.sets.some((set) => set.done)) {
                log.skipped = true;
                log.skipReason = 'Mode moins de 60 minutes';
            }
        });
        context.session.updatedAt = Date.now();
        await saveSession(context.session);
        this.showToast('Exercices bonus supprimés. Les mouvements prioritaires sont conservés.', 'success');
        this.render();
    }
    dailyLog(date) {
        let log = this.snapshot.dailyLogs.find((item) => item.date === date);
        if (!log) {
            log = emptyDailyLog(date);
            this.snapshot.dailyLogs.push(log);
            this.snapshot.dailyLogs.sort((a, b) => a.date.localeCompare(b.date));
        }
        return log;
    }
    async updateProfileField(field, rawValue) {
        if (field === 'startDate') {
            this.snapshot.profile.startDate = rawValue || isoDate();
            this.snapshot.sessions.forEach((session) => {
                session.weekIndex = weekIndexFromStart(this.snapshot.profile.startDate, session.date);
            });
        }
        else {
            const value = parseNumber(rawValue);
            if (value === null)
                return;
            if (field === 'weeklyLossRatePct')
                this.snapshot.profile.weeklyLossRatePct = value / 100;
            else
                this.snapshot.profile[field] = value;
        }
        await saveProfile(this.snapshot.profile);
        for (const session of this.snapshot.sessions)
            await saveSession(session);
        await this.ensureCurrentSession();
        this.render();
    }
    async applyCalorieAdjustment() {
        const recovery = analyzeRecovery(this.snapshot.dailyLogs);
        const strength = analyzeStrengthTrend(this.snapshot.sessions);
        const analysis = analyzeWeightTrend(this.snapshot.dailyLogs, this.snapshot.profile, this.snapshot.adjustments, { date: isoDate(), recoveryAlert: recovery.alert, strengthAlert: strength.alert });
        if (analysis.action !== 'CALORIES' || analysis.calorieDelta === 0)
            return;
        const adjustment = {
            id: uid('adjustment'),
            date: isoDate(),
            previousCalories: this.snapshot.profile.currentCalories,
            newCalories: analysis.proposedCalories,
            deltaCalories: analysis.calorieDelta,
            reason: analysis.reason,
        };
        this.snapshot.profile.currentCalories = analysis.proposedCalories;
        this.snapshot.adjustments.push(adjustment);
        await Promise.all([saveProfile(this.snapshot.profile), saveAdjustment(adjustment)]);
        this.showToast(`Calories mises à jour : ${analysis.proposedCalories} kcal/jour.`, 'success');
        this.render();
    }
    startRestTimer(exerciseId, setIndex, seconds) {
        this.timer = {
            exerciseId,
            setIndex,
            totalSec: seconds,
            startedAt: Date.now(),
            paused: false,
            pauseStartedAt: null,
            pausedMs: 0,
        };
    }
    timerElapsedMs() {
        if (!this.timer)
            return 0;
        const now = Date.now();
        const activePause = this.timer.paused && this.timer.pauseStartedAt ? now - this.timer.pauseStartedAt : 0;
        return Math.max(0, now - this.timer.startedAt - this.timer.pausedMs - activePause);
    }
    timerRemainingSec() {
        if (!this.timer)
            return 0;
        return Math.max(0, this.timer.totalSec - Math.floor(this.timerElapsedMs() / 1000));
    }
    adjustTimer(deltaSeconds) {
        if (!this.timer)
            return;
        this.timer.totalSec = Math.max(15, this.timer.totalSec + deltaSeconds);
        if (this.timerRemainingSec() <= 0)
            void this.closeRestTimer(true);
        else
            this.tick();
    }
    toggleTimerPause() {
        if (!this.timer)
            return;
        if (this.timer.paused) {
            if (this.timer.pauseStartedAt)
                this.timer.pausedMs += Date.now() - this.timer.pauseStartedAt;
            this.timer.paused = false;
            this.timer.pauseStartedAt = null;
        }
        else {
            this.timer.paused = true;
            this.timer.pauseStartedAt = Date.now();
        }
    }
    async closeRestTimer(notify) {
        if (!this.timer)
            return;
        const timer = this.timer;
        const elapsedSec = Math.max(0, Math.round(this.timerElapsedMs() / 1000));
        const context = this.currentContext();
        const set = context.session.exercises[timer.exerciseId]?.sets[timer.setIndex];
        if (set)
            set.restActualSec = elapsedSec;
        context.session.updatedAt = Date.now();
        this.timer = null;
        await saveSession(context.session);
        if (notify)
            this.notifyTimerEnd();
    }
    notifyTimerEnd() {
        if (this.snapshot.settings.vibrationEnabled) {
            try {
                navigator.vibrate?.([100, 60, 100, 60, 180]);
            }
            catch { /* ignored */ }
        }
        if (this.snapshot.settings.soundEnabled) {
            try {
                const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
                const context = new AudioContextCtor();
                [660, 880, 1100].forEach((frequency, index) => {
                    const oscillator = context.createOscillator();
                    const gain = context.createGain();
                    oscillator.connect(gain);
                    gain.connect(context.destination);
                    oscillator.frequency.value = frequency;
                    gain.gain.setValueAtTime(0.20, context.currentTime + index * 0.14);
                    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + index * 0.14 + 0.18);
                    oscillator.start(context.currentTime + index * 0.14);
                    oscillator.stop(context.currentTime + index * 0.14 + 0.22);
                });
            }
            catch { /* ignored */ }
        }
        this.showToast('Repos terminé. Série suivante.', 'success');
    }
    tick() {
        const sessionElapsed = document.getElementById('session-elapsed');
        const sessionProjected = document.getElementById('session-projected');
        if (sessionElapsed || sessionProjected) {
            const context = this.currentContext();
            const elapsed = sessionDurationSeconds(context.session);
            if (sessionElapsed)
                sessionElapsed.textContent = formatClock(elapsed);
            if (sessionProjected) {
                const completedCounts = {};
                context.day.exercises.forEach((exercise) => {
                    const plan = getExercisePlan(exercise, context.weekIndex);
                    const log = context.session.exercises[exercise.id];
                    completedCounts[exercise.id] = log?.skipped ? plan.sets : (log?.sets.slice(0, plan.sets).filter((set) => set.done).length ?? 0);
                });
                const remaining = remainingSessionSeconds(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex), completedCounts);
                const planned = estimateSessionDuration(context.day, (exercise) => getExercisePlan(exercise, context.weekIndex), this.snapshot.profile.sessionLimitMinutes);
                sessionProjected.textContent = formatClock(context.session.startedAt ? elapsed + remaining : planned.seconds);
            }
        }
        if (this.timer) {
            const remaining = this.timerRemainingSec();
            const timerText = document.getElementById('timer-remaining');
            const progress = document.getElementById('timer-progress');
            if (timerText)
                timerText.textContent = formatClock(remaining);
            if (progress)
                progress.style.width = `${Math.max(0, Math.min(100, remaining / this.timer.totalSec * 100))}%`;
            if (!this.timer.paused && remaining <= 0) {
                void this.closeRestTimer(true).then(() => this.render());
            }
        }
    }
    exportData() {
        const payload = clone(this.snapshot);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `colosse-adaptive-${isoDate()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }
    async importData(file) {
        try {
            const parsed = JSON.parse(await file.text());
            if (!parsed || !parsed.profile || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.dailyLogs)) {
                throw new Error('Structure de sauvegarde invalide.');
            }
            if (!confirm('Cette importation remplace toutes les données actuelles. Continuer ?'))
                return;
            await saveSnapshot(parsed);
            this.snapshot = await loadSnapshot();
            this.viewWeekStart = startOfWeek(new Date());
            await this.ensureCurrentSession();
            this.showToast('Sauvegarde restaurée.', 'success');
            this.render();
        }
        catch (error) {
            this.showToast(`Import impossible : ${error instanceof Error ? error.message : String(error)}`, 'error', 7000);
        }
    }
    async resetData() {
        if (!confirm('Effacer toutes les séances, pesées et réglages ? Cette action est définitive.'))
            return;
        await clearAllData();
        this.snapshot = defaultSnapshot();
        await saveSnapshot(this.snapshot);
        this.viewWeekStart = startOfWeek(new Date());
        await this.ensureCurrentSession();
        this.showToast('Base Colosse réinitialisée.', 'success');
        this.render();
    }
    async installApp() {
        if (!this.installPrompt)
            return;
        await this.installPrompt.prompt();
        await this.installPrompt.userChoice;
        this.installPrompt = null;
        this.render();
    }
    async applyServiceWorkerUpdate() {
        const registration = await navigator.serviceWorker?.getRegistration();
        if (registration?.waiting)
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        window.setTimeout(() => window.location.reload(), 300);
    }
    async acquireWakeLock() {
        try {
            const wakeLockApi = navigator.wakeLock;
            if (wakeLockApi && !this.wakeLock)
                this.wakeLock = await wakeLockApi.request('screen');
        }
        catch {
            this.wakeLock = null;
        }
    }
    async releaseWakeLock() {
        try {
            await this.wakeLock?.release();
        }
        catch { /* ignored */ }
        this.wakeLock = null;
    }
    showToast(message, type = 'info', duration = 3500) {
        window.clearTimeout(this.toastHandle ?? undefined);
        const toast = document.getElementById('toast');
        if (!toast) {
            console.log(message);
            return;
        }
        toast.textContent = message;
        toast.className = `toast ${type}`;
        this.toastHandle = window.setTimeout(() => toast.classList.add('hidden'), duration);
    }
}
const root = document.getElementById('app');
if (!root)
    throw new Error('Élément #app introuvable.');
const app = new ColosseApp(root);
void app.init().catch((error) => {
    console.error(error);
    root.innerHTML = `<div class="fatal"><strong>Colosse n’a pas pu démarrer.</strong><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><button onclick="location.reload()">Réessayer</button></div>`;
});
//# sourceMappingURL=app.js.map
