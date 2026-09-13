// Brouillons de saisie du mode guidé : charge, répétitions, RIR, technique,
// douleur tapés mais PAS encore validés. Ils ne touchent jamais les séries :
// rien n'est compté comme réalisé tant que l'utilisateur n'a pas validé.
//
// Clé = séance : exercice : variante : série : côté. Deux variantes, deux côtés
// ou deux séries n'écrasent donc jamais le brouillon l'un de l'autre.

export const DRAFT_STORAGE_KEY = 'colosse-brouillons-v1';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_DRAFTS = 80;

export function draftKey({ sessionId, exerciseId, variantId, setIndex, side }) {
    return `${sessionId}:${exerciseId}:${variantId ?? 'variante'}:${setIndex}:${side ?? 'both'}`;
}

function lire(storage) {
    try {
        const brut = storage?.getItem(DRAFT_STORAGE_KEY);
        const map = brut ? JSON.parse(brut) : {};
        return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    }
    catch {
        return {};
    }
}
function ecrire(storage, map) {
    try {
        storage?.setItem(DRAFT_STORAGE_KEY, JSON.stringify(map));
        return true;
    }
    catch {
        return false; // stockage plein ou indisponible : la saisie reste à l'écran
    }
}

export function readDraft(storage, key) {
    return lire(storage)[key] ?? null;
}

/** Enregistre un brouillon. `draft` = { fields: {...}, choices: {...} } */
export function saveDraft(storage, key, draft, now = Date.now()) {
    const map = lire(storage);
    map[key] = { fields: { ...(draft?.fields ?? {}) }, choices: { ...(draft?.choices ?? {}) }, updatedAt: now };
    return ecrire(storage, pruneDrafts(map, null, now));
}

export function removeDraft(storage, key) {
    const map = lire(storage);
    if (!(key in map))
        return false;
    delete map[key];
    return ecrire(storage, map);
}

/**
 * Nettoyage : brouillons trop vieux, séances qui n'existent plus ou sont
 * terminées (si `liveSessionIds` est fourni), et plafond de taille.
 */
export function pruneDrafts(map, liveSessionIds = null, now = Date.now()) {
    const entrees = Object.entries(map ?? {})
        .filter(([key, value]) => value && now - (Number(value.updatedAt) || 0) <= MAX_AGE_MS)
        .filter(([key]) => !liveSessionIds || liveSessionIds.has(key.split(':').slice(0, 2).join(':')))
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
        .slice(0, MAX_DRAFTS);
    return Object.fromEntries(entrees);
}

export function pruneStoredDrafts(storage, liveSessionIds, now = Date.now()) {
    const avant = lire(storage);
    const apres = pruneDrafts(avant, liveSessionIds, now);
    if (Object.keys(apres).length !== Object.keys(avant).length)
        ecrire(storage, apres);
    return apres;
}
