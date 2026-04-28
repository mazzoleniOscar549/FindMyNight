// ─────────────────────────────────────────────────────────────────────────────
// FINDMYNIGHT — mappa ottimizzata per velocità di caricamento locali
// Sostituisce il blocco da "MAPPA REALE" in poi nel file originale.
// ─────────────────────────────────────────────────────────────────────────────

// Funzionalità (desktop): card statiche sempre aperte, niente toggle.
// Nota: su desktop il CSS disabilita il click sul <summary>, quindi questa parte
// deve girare anche se Firebase non è configurato.
(function () {
    try {
        var mqDesktop = window.matchMedia('(min-width: 1025px)');
        function applyDesktopStaticFeatures() {
            if (!mqDesktop.matches) return;
            document.querySelectorAll('#features details.feature-card').forEach(function (d) {
                d.open = true;
                var summary = d.querySelector('summary');
                if (summary && !summary.__fmnDesktopStaticBound) {
                    summary.__fmnDesktopStaticBound = true;
                    summary.addEventListener('click', function (e) { e.preventDefault(); });
                }
            });
        }
        applyDesktopStaticFeatures();
        mqDesktop.addEventListener('change', applyDesktopStaticFeatures);
    } catch { /* ignore */ }
})();

// Firebase è opzionale: se manca la config, non blocchiamo tutto il resto del sito.
let db = null;
try {
    if (!window.FMN_FIREBASE_CONFIG || !window.firebase) {
        console.warn('[FindMyNight] Firebase config non trovata: continuo senza dati Firestore.');
    } else {
        if (!firebase.apps || !firebase.apps.length) {
            firebase.initializeApp(window.FMN_FIREBASE_CONFIG);
        }
        db = firebase.firestore();
    }
} catch (e) {
    console.warn('[FindMyNight] Errore inizializzazione Firebase: continuo senza Firestore.', e && e.message ? e.message : e);
    db = null;
}

const fbVenueData = new Map();
let nearReviews = [];
const sponsoredVenues = [];

function normalizeName(name) {
    return (name || '').toLowerCase()
        .replace(/[àáâã]/g, 'a').replace(/[èéê]/g, 'e')
        .replace(/[ìíî]/g, 'i').replace(/[òóô]/g, 'o')
        .replace(/[ùúû]/g, 'u')
        .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function loadFirebaseVenues() {
    if (!db) return;
    db.collection('venues').onSnapshot(
        (snapshot) => {
            fbVenueData.clear();
            snapshot.forEach((doc) => {
                const d = doc.data() || {};
                const merged = { ...d, venueId: doc.id };
                const kId = normalizeName(doc.id);
                const nm = d.name != null && String(d.name).trim() ? String(d.name).trim() : '';
                const kName = normalizeName(nm || doc.id);
                fbVenueData.set(kId, merged);
                if (kName !== kId) fbVenueData.set(kName, merged);
            });
            if (clubsData.length) {
                enrichClubsWithFirebase(clubsData);
                renderSidebar(clubsForSidebar(clubsData));
                loadAndRenderUserReviews();
                loadAndRenderGoogleReviews();
                const openPopup = document.getElementById('clubDetailPopup');
                if (openPopup && openPopup.style.display !== 'none') {
                    const activeName = document.getElementById('popupName')?.textContent;
                    const match = clubsData.find(c => c.name === activeName);
                    if (match) showClubDetails(match);
                }
            }
        },
        (err) => {
            console.warn('[FindMyNight] Firebase non raggiungibile, uso stime locali.', err.message);
        }
    );

    db.collection('sponsoredVenues').where('active', '==', true).onSnapshot(
        (snapshot) => {
            sponsoredVenues.length = 0;
            snapshot.forEach(doc => sponsoredVenues.push({ id: doc.id, ...doc.data() }));
            if (clubsData.length) renderSidebar(clubsForSidebar(clubsData));
        },
        (err) => {
            console.warn('[FindMyNight] Sponsored venues non disponibili.', err.message);
        }
    );
}

function starsFromNum(n) {
    const v = Math.max(1, Math.min(5, Math.round(Number(n) || 0)));
    return '★'.repeat(v) + '☆'.repeat(5 - v);
}

async function loadAndRenderUserReviews() {
    const grid = document.getElementById('userReviewsGrid');
    const hint = document.getElementById('userReviewsHint');
    if (!grid || !hint) return;

    if (!db) {
        grid.innerHTML = '';
        hint.textContent = 'Recensioni community non disponibili (Firebase non configurato).';
        return;
    }

    hint.textContent = 'Carico recensioni della community…';
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 1.35rem;">
        <div style="width:30px;height:30px;border:3px solid rgba(168,85,247,0.2);border-top-color:#a855f7;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;"></div>
      </div>
    `;

    try {
        const snap = await db.collection('reviews')
            .orderBy('createdAt', 'desc')
            .limit(12)
            .get();
        const reviews = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));

        if (!reviews.length) {
            grid.innerHTML = '';
            hint.textContent = 'Ancora nessuna recensione inviata dal sito.';
            return;
        }

        const shown = reviews.slice(0, 9);
        grid.innerHTML = shown.map((r) => {
            const venueName = escapeHtml(r.venueName || r.venueId || 'Locale');
            const nick = r.nickname ? escapeHtml(r.nickname) : 'Anonimo';
            const rating = starsFromNum(r.rating || 0);
            const text = r.text ? escapeHtml(r.text) : '';
            const when = (() => {
                const ts = r && r.createdAt;
                const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
                return d ? d.toLocaleDateString('it-IT') : '';
            })();
            return `
              <div class="review-card">
                <div class="review-top">
                  <div class="review-venue">${venueName}</div>
                  <div class="review-rating">${rating}</div>
                </div>
                <div class="review-meta">${nick}${when ? ` · ${when}` : ''}</div>
                ${text ? `<div class="review-text">${text}</div>` : `<div class="review-empty">Solo valutazione</div>`}
              </div>
            `;
        }).join('');
        hint.textContent = `${shown.length} recensioni (community)`;
    } catch (e) {
        grid.innerHTML = '';
        hint.textContent = `Errore nel caricare recensioni community: ${e && e.message ? e.message : e}`;
    }
}

async function loadAndRenderGoogleReviews() {
    const grid = document.getElementById('googleReviewsGrid');
    const hint = document.getElementById('googleReviewsHint');
    if (!grid || !hint) return;

    const isPending = (clubsData || []).some(c => c.ratingsPending);
    if (isPending) {
        hint.textContent = 'Carico recensioni API Google…';
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 1.35rem;">
            <div style="width:30px;height:30px;border:3px solid rgba(168,85,247,0.2);border-top-color:#a855f7;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto;"></div>
          </div>
        `;
        return;
    }

    const allReviews = [];
    for (const c of (clubsData || [])) {
        if (c.googleReviews && Array.isArray(c.googleReviews)) {
            for (const rev of c.googleReviews) {
                allReviews.push({ ...rev, venueName: c.name });
            }
        }
    }

    if (!allReviews.length) {
        grid.innerHTML = '';
        hint.textContent = 'Nessuna recensione trovata tramite API Google.';
        return;
    }

    allReviews.sort((a, b) => (b.time || 0) - (a.time || 0));
    const shown = allReviews.slice(0, 9);
    grid.innerHTML = shown.map((r) => {
        const when = r.time ? new Date(r.time * 1000).toLocaleDateString('it-IT') : '';
        const nick = r.author_name ? escapeHtml(r.author_name) : 'Anonimo';
        const venueName = escapeHtml(r.venueName || 'Locale');
        const rating = starsFromNum(r.rating || 0);
        const text = r.text ? escapeHtml(r.text) : '';
        return `
          <div class="review-card">
            <div class="review-top">
              <div class="review-venue">${venueName}</div>
              <div class="review-rating">${rating}</div>
            </div>
            <div class="review-meta">${nick}${when ? ` · ${when}` : ''}</div>
            ${text ? `<div class="review-text">${text}</div>` : `<div class="review-empty">Solo valutazione</div>`}
          </div>
        `;
    }).join('');
    hint.textContent = `${shown.length} recensioni (Google API)`;
}

function enrichClubsWithFirebase(clubs) {
    clubs.forEach(club => {
        const keyName = normalizeName(club.name);
        let fb = fbVenueData.get(keyName) || null;
        if (!fb && club.id != null) {
            fb = fbVenueData.get(normalizeName(String(club.id))) || null;
        }
        club.firebaseData = fb;
        if (club.firebaseData && typeof club.firebaseData.affluenzaPct === 'number') {
            club.crowdPercent = club.firebaseData.affluenzaPct;
            const pct = club.crowdPercent;
            club.crowdText = pct >= 85 ? 'Tutto esaurito 🔴'
                : pct >= 65 ? 'Affollato 🟠'
                    : pct >= 40 ? 'Vivace 🟡'
                        : 'Tranquillo 🟢';
        } else if (club.firebaseData) {
            const fbInner = club.firebaseData;
            const fbAperto = fbInner.aperto !== false;
            if (fbAperto && !isNightclubAutoClosedNow(club)) {
                club.crowdText = 'Non impostata';
                club.crowdPercent = null;
            }
        } else {
            club.crowdText = 'Non impostata';
            club.crowdPercent = null;
        }

        if (fb && fb.isBar === true) {
            club.isBar = true;
        } else if (club.isBar == null && !isNightclub(club)) {
            club.isBar = true;
        }
    });
}

const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
        if (e.isIntersecting) {
            e.target.style.opacity = '1';
            e.target.style.transform = 'translateY(0)';
        }
    });
}, { threshold: 0.1 });
document.querySelectorAll('.step, .plan-card, .stat-item').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
});

// ─────────────────────────────────────────────────────────────────────────────
// COSTANTI E STATO GLOBALE
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CENTER = { lat: 41.8719, lng: 12.5674 };
// Prefer kumi first (often more reliable than overpass-api.de)
const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
];
const OVERPASS_MAX_RESULTS = 100;
const GOOGLE_PLACES_MAX_RESULTS = 72;
const MAP_MAX_VENUES_SHOWN = 60;
const GOOGLE_ENRICH_MAX_CLUBS = 40;
const SAME_AREA_GPS_VS_PLACE_KM = 14;
const MERGE_GPS_SECOND_QUERY_MAX_KM = 200;
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

const GOOGLE_PLACES_API_KEY =
    typeof window !== 'undefined' && typeof window.FMN_GOOGLE_PLACES_API_KEY === 'string'
        ? window.FMN_GOOGLE_PLACES_API_KEY.trim()
        : '';

// ▶ QUI INCOLLI FIX #1
(function injectPreconnects() {
    const preconnectDomains = [
        'https://maps.googleapis.com',
        'https://maps.gstatic.com',
        'https://overpass-api.de',
        'https://overpass.kumi.systems',
    ];
    const head = document.head;
    preconnectDomains.forEach((href) => {
        if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = href;
        link.crossOrigin = 'anonymous';
        head.prepend(link);
    });
    ['https://maps.googleapis.com', 'https://maps.gstatic.com'].forEach((href) => {
        if (document.querySelector(`link[rel="dns-prefetch"][href="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'dns-prefetch';
        link.href = href;
        head.prepend(link);
    });
})();

/*COSTANTI*/
const _overpassRateLimit = new Map();
const OVERPASS_429_BACKOFF_MS = 60000;
const OVERPASS_FAIL_BASE_BACKOFF_MS = 15000;
const OVERPASS_FAIL_MAX_BACKOFF_MS = 120000;
const OVERPASS_INFLIGHT = new Map(); // cache promises by (center,radius)

function isOverpassEndpointThrottled(endpoint) {
    const entry = _overpassRateLimit.get(endpoint);
    if (!entry) return false;
    if (Date.now() < entry.until) return true;
    _overpassRateLimit.delete(endpoint);
    return false;
}

function markOverpassEndpoint429(endpoint) {
    const prev = _overpassRateLimit.get(endpoint);
    const fails = prev && Number.isFinite(prev.fails) ? prev.fails + 1 : 1;
    const backoff = Math.min(
        OVERPASS_FAIL_MAX_BACKOFF_MS,
        OVERPASS_429_BACKOFF_MS * Math.pow(2, Math.min(3, fails - 1))
    );
    _overpassRateLimit.set(endpoint, { until: Date.now() + backoff, fails });
    console.warn(`[FMN] Overpass 429 su ${endpoint}`);
}

function markOverpassEndpointFail(endpoint, reason) {
    try {
        const prev = _overpassRateLimit.get(endpoint);
        const fails = prev && Number.isFinite(prev.fails) ? prev.fails + 1 : 1;
        const backoff = Math.min(
            OVERPASS_FAIL_MAX_BACKOFF_MS,
            OVERPASS_FAIL_BASE_BACKOFF_MS * Math.pow(2, Math.min(3, fails - 1))
        );
        _overpassRateLimit.set(endpoint, { until: Date.now() + backoff, fails });
        console.warn(`[FMN] Overpass fail (${fails}) su ${endpoint}${reason ? `: ${reason}` : ''}`);
    } catch {
        /* ignore */
    }
}

/**/ 


let leafletMap;
let leafletMarkers = [];
let clubsData = [];
let tempSearchMarker = null;
let userLocation = null;
let manualCenter = null;
let userLocationMarker = null;
let currentRadiusKm = 12;
let discoveryCenter = null;
let discoveryRetryCount = 0;
let gpsRetryCount = 0;
let loadClubsRunId = 0;

// ─── FIX #5: AbortController per fetch Overpass obsolete ──────────────────────
let overpassAbortController = null;

const LAST_LOCATION_KEY = 'fmn_last_location';
const LAST_LOCATION_TTL_MS = 30 * 60 * 1000;
const FMN_MAP_FOCUS_KEY = 'fmn_map_focus';
const FMN_MAP_FOCUS_TTL_MS = 24 * 60 * 60 * 1000;

function persistMapFocusForLocali(payload) {
    try {
        const type = payload && payload.type === 'place' ? 'place' : 'gps';
        const lat = payload && Number(payload.lat);
        const lng = payload && Number(payload.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const label = typeof (payload && payload.label) === 'string' ? payload.label.slice(0, 160) : '';
        localStorage.setItem(FMN_MAP_FOCUS_KEY, JSON.stringify({ ts: Date.now(), type, lat, lng, label }));
    } catch { /* ignore */ }
}

function saveLastLocation(loc) {
    try {
        if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
        localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat: loc.lat, lng: loc.lng, ts: Date.now() }));
        persistMapFocusForLocali({ type: 'gps', lat: loc.lat, lng: loc.lng, label: 'La tua posizione' });
    } catch { /* ignore */ }
}

function peekLastLocationForWarmStart() {
    try {
        const raw = localStorage.getItem(LAST_LOCATION_KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || !Number.isFinite(o.lat) || !Number.isFinite(o.lng) || !o.ts) return null;
        if (Date.now() - o.ts > LAST_LOCATION_TTL_MS) return null;
        return { lat: o.lat, lng: o.lng };
    } catch {
        return null;
    }
}

const ITALY_DISCOVERY_CENTERS = [
    { label: 'Milano', lat: 45.4642, lng: 9.1900 },
    { label: 'Torino', lat: 45.0703, lng: 7.6869 },
    { label: 'Genova', lat: 44.4056, lng: 8.9463 },
    { label: 'Venezia', lat: 45.4408, lng: 12.3155 },
    { label: 'Bologna', lat: 44.4949, lng: 11.3426 },
    { label: 'Firenze', lat: 43.7696, lng: 11.2558 },
    { label: 'Roma', lat: 41.9028, lng: 12.4964 },
    { label: 'Napoli', lat: 40.8518, lng: 14.2681 },
    { label: 'Bari', lat: 41.1171, lng: 16.8719 },
    { label: 'Catania', lat: 37.5079, lng: 15.0830 },
    { label: 'Palermo', lat: 38.1157, lng: 13.3615 },
    { label: 'Cagliari', lat: 39.2238, lng: 9.1217 }
];

function pickDiscoveryCenter() {
    const c = ITALY_DISCOVERY_CENTERS[Math.floor(Math.random() * ITALY_DISCOVERY_CENTERS.length)];
    return { lat: c.lat, lng: c.lng, label: c.label };
}

function kmBetween(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const q = s1 * s1 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(q));
}

function starsFromRating(rating) {
    if (rating == null) return '—';
    const full = Math.floor(rating);
    const half = (rating - full) >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function debounce(fn, waitMs) {
    let t;
    return (...args) => {
        window.clearTimeout(t);
        t = window.setTimeout(() => fn(...args), waitMs);
    };
}

function normalizeText(s) {
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function osmVenueDisplayName(tags) {
    if (!tags || typeof tags !== 'object') return 'Locale';
    const pick = (...keys) => {
        for (const k of keys) {
            const v = (tags[k] ?? '').toString().trim();
            if (v) return v;
        }
        return '';
    };
    let base = pick('official_name', 'alt_name', 'operator', 'brand', 'name', 'name:it') || 'Locale';
    const city = pick('addr:city', 'addr:town', 'addr:village', 'addr:hamlet');
    if (city && base !== 'Locale') {
        const bN = normalizeText(base);
        const cN = normalizeText(city);
        if (cN && !bN.includes(cN)) {
            base = `${base} di ${city}`;
        }
    }
    return base;
}

function osmVenueAddressFromTags(tags) {
    if (!tags || typeof tags !== 'object') return '';
    const t = (k) => (tags[k] ?? '').toString().trim();
    const full = t('addr:full');
    if (full) return full;
    const street = [t('addr:street'), t('addr:housenumber')].filter(Boolean).join(' ').trim();
    const contactStreet = t('contact:street');
    const road = street || contactStreet;
    const city = t('addr:city') || t('addr:town') || t('addr:village') || t('addr:hamlet') || t('contact:city');
    const place = t('addr:place') || t('addr:suburb') || t('addr:neighbourhood');
    const pc = t('addr:postcode');
    const prov = t('addr:province');
    const locality = [pc, city || place].filter(Boolean).join(' ').trim();
    let tail = locality;
    if (prov && tail && !tail.includes(`(${prov})`)) tail = `${tail} (${prov})`;
    else if (prov && !tail) tail = `(${prov})`;
    if (road && tail) return `${road}, ${tail}`;
    if (road) return road;
    if (tail) return tail;
    return place || '';
}

function escapeHtml(s) {
    return (s || '').toString()
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function buildGoogleDirectionsLink(lat, lng, name) {
    const q = encodeURIComponent(name ? `${name}` : `${lat},${lng}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

function buildAppleMapsLink(lat, lng, name) {
    const q = encodeURIComponent(name ? `${name}` : `${lat},${lng}`);
    return `https://maps.apple.com/?q=${q}&ll=${lat},${lng}`;
}

const mapsChooserState = { lat: null, lng: null, name: '' };
let mapsChooserEscapeHandler = null;

function closeMapsChooserModal() {
    const modal = document.getElementById('mapsChooserModal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (mapsChooserEscapeHandler) {
        document.removeEventListener('keydown', mapsChooserEscapeHandler);
        mapsChooserEscapeHandler = null;
    }
}

function openInMapsChooser(lat, lng, name) {
    mapsChooserState.lat = lat;
    mapsChooserState.lng = lng;
    mapsChooserState.name = name || 'Destinazione';
    const modal = document.getElementById('mapsChooserModal');
    const venueEl = document.getElementById('mapsChooserVenue');
    if (!modal) {
        window.open(buildGoogleDirectionsLink(lat, lng, mapsChooserState.name), '_blank', 'noopener,noreferrer');
        return;
    }
    if (venueEl) venueEl.textContent = mapsChooserState.name;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    mapsChooserEscapeHandler = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); closeMapsChooserModal(); }
    };
    document.addEventListener('keydown', mapsChooserEscapeHandler);
    const gBtn = document.getElementById('mapsChooserGoogle');
    if (gBtn) gBtn.focus();
}

function wireMapsChooserModal() {
    const backdrop = document.getElementById('mapsChooserBackdrop');
    const closeBtn = document.getElementById('mapsChooserClose');
    const cancelBtn = document.getElementById('mapsChooserCancel');
    const googleBtn = document.getElementById('mapsChooserGoogle');
    const appleBtn = document.getElementById('mapsChooserApple');
    const openAndClose = (url) => { closeMapsChooserModal(); window.open(url, '_blank', 'noopener,noreferrer'); };
    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            const { lat, lng, name } = mapsChooserState;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            openAndClose(buildGoogleDirectionsLink(lat, lng, name));
        });
    }
    if (appleBtn) {
        appleBtn.addEventListener('click', () => {
            const { lat, lng, name } = mapsChooserState;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            openAndClose(buildAppleMapsLink(lat, lng, name));
        });
    }
    [backdrop, closeBtn, cancelBtn].forEach((el) => { if (el) el.addEventListener('click', () => closeMapsChooserModal()); });
}

function getSearchCenter() {
    if (manualCenter && userLocation) {
        const d = kmBetween(manualCenter, userLocation);
        if (d <= SAME_AREA_GPS_VS_PLACE_KM) return userLocation;
    }
    return manualCenter || userLocation || discoveryCenter || DEFAULT_CENTER;
}

function getVenueListReferenceCenter() {
    if (manualCenter && userLocation) {
        const d = kmBetween(manualCenter, userLocation);
        if (d > SAME_AREA_GPS_VS_PLACE_KM) return manualCenter;
    }
    return getSearchCenter();
}

function mergeClubListsById(a, b) {
    const map = new Map();
    (a || []).forEach((c) => { if (c && c.id != null) map.set(c.id, c); });
    (b || []).forEach((c) => { if (c && c.id != null && !map.has(c.id)) map.set(c.id, c); });
    return [...map.values()];
}

function recomputeClubDistancesFrom(clubs, ref) {
    if (!ref || !clubs) return clubs;
    return clubs.map((c) => ({ ...c, distanceKm: kmBetween(ref, { lat: c.lat, lng: c.lng }) }));
}

function filterClubsWithinRadius(clubs, radiusKm) {
    const rk = Number(radiusKm);
    if (!Number.isFinite(rk) || rk <= 0) return clubs || [];
    const limit = Math.max(1, rk * 1.12 + 0.4);
    return (clubs || []).filter((c) => {
        const d = Number(c && c.distanceKm);
        return Number.isFinite(d) ? d <= limit : true;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE OVERPASS
// ─────────────────────────────────────────────────────────────────────────────

const OVERPASS_CACHE_TTL_MS = 30 * 60 * 1000;

// ─── FIX #1: Cache in memoria (Map) per accesso istantaneo senza JSON.parse ───
const overpassMemCache = new Map(); // key → { ts, data }

function overpassCacheKey(center, radiusMeters) {
    return `fmn_overpass_${center.lat.toFixed(3)}_${center.lng.toFixed(3)}_${radiusMeters}`;
}

function getOverpassCache(center, radiusMeters) {
    const key = overpassCacheKey(center, radiusMeters);

    // Controlla prima la cache in memoria (istantanea)
    const mem = overpassMemCache.get(key);
    if (mem) {
        if (Date.now() - mem.ts <= OVERPASS_CACHE_TTL_MS) return mem.data;
        overpassMemCache.delete(key);
    }

    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts > OVERPASS_CACHE_TTL_MS) {
            localStorage.removeItem(key);
            return null;
        }
        // Popola la cache in memoria per i prossimi accessi
        overpassMemCache.set(key, { ts: cached.ts, data: cached.data });
        return cached.data;
    } catch { return null; }
}

function setOverpassCache(center, radiusMeters, data) {
    const key = overpassCacheKey(center, radiusMeters);
    overpassMemCache.set(key, { ts: Date.now(), data });
    try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* quota exceeded */ }
}

function getOverpassCacheFiltered(center, radiusMeters) {
    const wantKm = radiusMeters / 1000;
    try {
        const localiPre = getLocaliPageOverpassCache(center, 28000);
        if (Array.isArray(localiPre) && localiPre.length > 0) {
            const mapped = mapOsmElementsToClubs(localiPre, center);
            const filtered = mapped.filter((club) => {
                const dk = typeof club.distanceKm === 'number' ? club.distanceKm : kmBetween(center, { lat: club.lat, lng: club.lng });
                return dk <= wantKm * 1.08 + 0.35;
            });
            if (filtered.length) return filtered;
        }
    } catch { /* ignore */ }

    const tryRadii = [radiusMeters, 28000, 30000, 35000, 40000, 45000, 50000, 22000, 20000, 18000, 15000, 12000];
    const seen = new Set();
    for (const r of tryRadii) {
        if (seen.has(r)) continue;
        seen.add(r);
        const data = getOverpassCache(center, r);
        if (!data || !data.length) continue;
        const filtered = data.filter((club) => {
            const dk = typeof club.distanceKm === 'number' ? club.distanceKm : kmBetween(center, { lat: club.lat, lng: club.lng });
            return dk <= wantKm * 1.08 + 0.35;
        });
        if (filtered.length) return filtered;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH OVERPASS — FIX #1 + #2: vero parallelo, timeout aggressivo, abort
// ─────────────────────────────────────────────────────────────────────────────

async function fetchClubsOverpassAnyEndpoint(center, radiusMeters, signal) {
    const cached = getOverpassCacheFiltered(center, radiusMeters);
    if (cached) return cached;

    // In-flight caching: avoid duplicate requests for same center/radius.
    const inflightKey = overpassCacheKey(center, radiusMeters);
    const inflight = OVERPASS_INFLIGHT.get(inflightKey);
    if (inflight) return inflight;

    // Sequential strategy: avoids firing requests to a down endpoint in parallel
    // (which would spam console with timeouts).
    const promise = (async () => {
        const endpointsToTry = OVERPASS_ENDPOINTS.filter((ep) => !isOverpassEndpointThrottled(ep));
        const list = endpointsToTry.length ? endpointsToTry : OVERPASS_ENDPOINTS;

        let results = [];
        for (let i = 0; i < list.length; i++) {
            const ep = list[i];
            try {
                const timeoutMs = i === 0 ? 9000 : 15000;
                const r = await fetchNightclubsFromOverpass({ endpoint: ep, center, radiusMeters, signal, timeoutMs });
                if (Array.isArray(r) && r.length > 0) { results = r; break; }
            } catch {
                // continue
            }
            if (signal && signal.aborted) return [];
        }

        if (Array.isArray(results) && results.length) {
            setOverpassCache(center, radiusMeters, results);
        }
        return results || [];
    })();

    OVERPASS_INFLIGHT.set(inflightKey, promise);
    try {
        return await promise;
    } finally {
        OVERPASS_INFLIGHT.delete(inflightKey);
    }
}

function isOsmVenueLikelyClosed(tags) {
    if (!tags || typeof tags !== 'object') return false;
    const g = (k) => (tags[k] ?? '').toString().trim().toLowerCase();
    if (g('abandoned') === 'yes' || g('abandoned') === 'true' || g('abandoned') === '1') return true;
    if (g('demolished') === 'yes') return true;
    if (g('ruined') === 'yes') return true;
    if (g('removed') === 'yes') return true;
    if (tags['disused:amenity'] || tags['disused:leisure'] || tags['disused:shop']) return true;
    if (tags['was:amenity'] || tags['was:leisure']) return true;
    if (tags['end_date']) return true;
    const op = g('operational_status');
    if (op && /abandon|closed|defunct|demolish|inactive|dismantl|ceased|razed|vacant|disus/.test(op)) return true;
    return false;
}

function mapOsmElementsToClubs(elements, center) {
    const elementsFiltered = (elements || []).filter((el) => !isOsmVenueLikelyClosed(el.tags || {}));
    return elementsFiltered.map((el) => {
        const tags = el.tags || {};
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) return null;
        const name = osmVenueDisplayName(tags);
        const address = osmVenueAddressFromTags(tags);
        const distanceKm = kmBetween(center, { lat, lng });
        const amen = String(tags.amenity || '').toLowerCase();
        const clubTag = String(tags.club || '').toLowerCase();
        const isBar = amen === 'bar' && clubTag !== 'nightclub';
        return {
            id: `${el.type}/${el.id}`,
            name,
            address,
            lat,
            lng,
            distanceKm,
            ratingText: '—',
            starsText: '—',
            crowdText: '—',
            crowdPercent: 0,
            ageText: '—',
            source: 'OSM',
            osmAmenity: tags.amenity || '',
            osmLeisure: tags.leisure || '',
            osmClub: tags.club || '',
            isBar
        };
    }).filter(Boolean)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, OVERPASS_MAX_RESULTS);
}
async function fetchNightclubsFromOverpass({ endpoint, center, radiusMeters, signal, timeoutMs = 9000 }) {
    if (isOverpassEndpointThrottled(endpoint)) {
        throw new Error(`Overpass endpoint in backoff: ${endpoint}`);
    }

    const lat = Number(center.lat);
    const lng = Number(center.lng);
    const r = Math.max(1000, Math.min(50000, Math.round(radiusMeters)));

    // Wider query: many venues are mapped as ways/relations or via club/leisure tags
    const query = `
      [out:json][timeout:10];
      (
        node["amenity"="nightclub"](around:${r},${lat},${lng});
        way["amenity"="nightclub"](around:${r},${lat},${lng});
        relation["amenity"="nightclub"](around:${r},${lat},${lng});

        node["club"="nightclub"](around:${r},${lat},${lng});
        way["club"="nightclub"](around:${r},${lat},${lng});
        relation["club"="nightclub"](around:${r},${lat},${lng});

        node["leisure"="nightclub"](around:${r},${lat},${lng});
        way["leisure"="nightclub"](around:${r},${lat},${lng});
        relation["leisure"="nightclub"](around:${r},${lat},${lng});

        node["leisure"="dancing"](around:${r},${lat},${lng});
        way["leisure"="dancing"](around:${r},${lat},${lng});
        relation["leisure"="dancing"](around:${r},${lat},${lng});

        node["amenity"="music_venue"](around:${r},${lat},${lng});
        way["amenity"="music_venue"](around:${r},${lat},${lng});
        relation["amenity"="music_venue"](around:${r},${lat},${lng});

        node["amenity"="bar"]["club"="nightclub"](around:${r},${lat},${lng});
        way["amenity"="bar"]["club"="nightclub"](around:${r},${lat},${lng});
        relation["amenity"="bar"]["club"="nightclub"](around:${r},${lat},${lng});
      );
      out center tags;
    `.replace(/\\s+/g, ' ').trim();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
        res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: new URLSearchParams({ data: query }),
            signal: controller.signal
        });
    } catch (e) {
        // Network errors / timeouts should temporarily remove the endpoint from rotation
        const msg = e && e.name === 'AbortError' ? 'timeout' : (e && e.message ? e.message : String(e));
        markOverpassEndpointFail(endpoint, msg);
        throw e;
    } finally {
        clearTimeout(timer);
    }

    if (res.status === 429) {
        markOverpassEndpoint429(endpoint);
        throw new Error(`Overpass 429`);
    }

    if (!res.ok) {
        if (res.status >= 500 || res.status === 0) {
            markOverpassEndpointFail(endpoint, `http_${res.status}`);
        }
        throw new Error(`Overpass HTTP ${res.status}`);
    }

    const json = await res.json();
    return mapOsmElementsToClubs(json.elements || [], center);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED VENUES
// ─────────────────────────────────────────────────────────────────────────────

function hashClubSeed(club) {
    const s = `${club && club.id != null ? club.id : ''}|${club && club.name ? club.name : ''}|${club && club.lat != null ? club.lat : ''}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function fmnVenueShowsPublishedEntryOnly(club) {
    const n = normalizeText(club && club.name ? club.name : '');
    const id = String(club && club.id != null ? club.id : '').toLowerCase();
    if (!n && !id) return false;
    if (id.includes('life-club-rovetta') || n.includes('life club') || (n.includes('life') && n.includes('rovetta'))) return true;
    if (id.includes('bar-da-spicchio') || n.includes('bar da spicchio') || (n.includes('spicchio') && n.includes('bar'))) return true;
    if (id.includes('piccolo-bar') || n.includes('piccolo bar')) return true;
    return false;
}

function lookupPublishedVenuePrices(club) {
    const n = normalizeText(club && club.name ? club.name : '');
    if (!n) return null;
    if (n.includes('life club') || (n.includes('life') && n.includes('rovetta'))) return { entryEuro: 15, drinkEuro: 10 };
    if (n.includes('oronero') || n.includes('oro nero')) return { entryEuro: 12, drinkEuro: 10 };
    if (n.includes('setai')) return { entryEuro: 12, drinkEuro: 8 };
    if (n.includes('vog club') || (n.includes('vog') && n.includes('seriate'))) return { entryEuro: 15, drinkEuro: 10 };
    if (n.includes('open space') || n.includes('openspace')) return { entryEuro: 15, drinkEuro: 10 };
    if (n.includes('piccolo bar')) return { entryEuro: 0, drinkEuro: 8 };
    if (n.includes('bar da spicchio') || (n.includes('spicchio') && n.includes('bar'))) return { entryEuro: 0, drinkEuro: 8 };
    return null;
}

function formatProssimoEventoDisplay(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') { const t = raw.trim(); if (!t || t === '—' || t === '-') return ''; return t; }
    if (typeof raw.toDate === 'function') {
        try { const d = raw.toDate(); if (Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; }
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const d = new Date(raw); if (Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    const s = String(raw).trim(); return s && s !== '—' ? s : '';
}

function isNightclub(club) {
    // Explicit override for known venues (seed ids may vary: seed:, seedbg:, osm ids)
    const rawId = String(club && club.id != null ? club.id : '').toLowerCase();
    if (rawId.includes('life-club-rovetta')) return true;
    const am = (club && club.osmAmenity ? String(club.osmAmenity) : '').toLowerCase();
    const cl = (club && club.osmClub ? String(club.osmClub) : '').toLowerCase();
    const le = (club && club.osmLeisure ? String(club.osmLeisure) : '').toLowerCase();
    if (am === 'nightclub' || cl === 'nightclub' || le === 'nightclub' || le === 'dancing') return true;
    const n = normalizeText(club && club.name ? club.name : '');
    if (n.includes('life club') || n.includes('amnesia') || n.includes('vog club') || n.includes('setai') || n.includes('open space') || n.includes('bolgia') || n.includes('oro nero')) return true;
    const gTypes = Array.isArray(club && club.googlePlaceTypes) ? club.googlePlaceTypes : [];
    // Google types can be noisy (some bars get tagged as night_club). If this venue
    // is explicitly marked as bar in our model, do not flip it to nightclub just
    // because of Google types.
    if (gTypes.includes('night_club')) return club && club.isBar ? false : true;
    return false;
}

function isNightclubAutoClosedNow(club) {
    if (!isNightclub(club)) return false;
    const hour = new Date().getHours();
    return hour >= 6 && hour < 21;
}

function deriveVibeDetails(club) {
    const published = lookupPublishedVenuePrices(club);
    const publishedEntryOk = fmnVenueShowsPublishedEntryOnly(club) && published && typeof published.entryEuro === 'number';
    const autoClosed = isNightclubAutoClosedNow(club);
    const strOk = (s) => typeof s === 'string' && s.trim().length > 0;
    const fb = club.firebaseData || null;

    if (fb) {
        const fbAperto = fb.aperto != null ? fb.aperto : true;
        const hasAff = typeof fb.affluenzaPct === 'number' && Number.isFinite(fb.affluenzaPct) && fb.affluenzaPct >= 0 && fb.affluenzaPct <= 100;
        const rawProssimo = fb.dataProssimoEvento ?? fb.prossimoEventoData ?? fb.eventoData ?? null;
        let crowdPct; let affluenzaNonImpostata = false;
        if (autoClosed) { crowdPct = 0; }
        else if (!fbAperto) { crowdPct = 0; }
        else if (hasAff) { crowdPct = Math.round(fb.affluenzaPct); }
        else { crowdPct = null; affluenzaNonImpostata = true; }

        const hasIngressPartner = typeof fb.ingresso === 'number' && Number.isFinite(fb.ingresso);
        let entryEuro = null; let entryNonImpostato = true;
        if (hasIngressPartner) { entryEuro = fb.ingresso; entryNonImpostato = false; }
        else if (publishedEntryOk) { entryEuro = published.entryEuro; entryNonImpostato = false; }

        const hasDrinkPartner = typeof fb.drinkEuro === 'number' && Number.isFinite(fb.drinkEuro);
        let drinkEuro = null; let drinkNonImpostato = !hasDrinkPartner;
        if (hasDrinkPartner) { drinkEuro = fb.drinkEuro; drinkNonImpostato = false; }

        return {
            crowdPct, affluenzaNonImpostata,
            entryEuro, entryNonImpostato,
            drinkEuro, drinkNonImpostato,
            ageRange: strOk(fb.ageRange) ? fb.ageRange.trim() : null,
            ageNonImpostato: !strOk(fb.ageRange),
            music: strOk(fb.musica) ? fb.musica.trim() : null,
            musicNonImpostato: !strOk(fb.musica),
            peak: fb.picco != null && String(fb.picco).trim() ? String(fb.picco).trim() : null,
            piccoNonImpostato: !fb.picco || !String(fb.picco).trim(),
            eventoNome: fb.eventoNome || null,
            prossimoEventoLabel: formatProssimoEventoDisplay(rawProssimo),
            aperto: autoClosed ? false : fbAperto,
            isBar: fb.isBar === true,
            isLive: fb.isBar !== true
        };
    }

    let crowdPct = null; let affluenzaNonImpostataFb = true;
    if (autoClosed) { crowdPct = 0; affluenzaNonImpostataFb = false; }
    else if (typeof club.crowdPercent === 'number' && club.crowdPercent > 0 && club.crowdPercent <= 100) {
        crowdPct = Math.round(club.crowdPercent); affluenzaNonImpostataFb = false;
    }
    let entryEuro = null; let entryNonImpostato = true;
    if (publishedEntryOk) { entryEuro = published.entryEuro; entryNonImpostato = false; }

    return {
        crowdPct: autoClosed ? 0 : crowdPct, affluenzaNonImpostata: affluenzaNonImpostataFb,
        entryEuro, entryNonImpostato, drinkEuro: null, drinkNonImpostato: true,
        ageRange: null, ageNonImpostato: true, music: null, musicNonImpostato: true,
        peak: null, piccoNonImpostato: true, eventoNome: null, prossimoEventoLabel: '',
        aperto: autoClosed ? false : true, isBar: false, isLive: false
    };
}

function hideClubDetailsPopup() {
    const popup = document.getElementById('clubDetailPopup');
    if (popup) popup.style.display = 'none';
}

function detailPopupOpenDisplay() {
    return window.matchMedia('(max-width: 768px)').matches ? 'grid' : 'block';
}

function showClubDetails(club) {
    const popup = document.getElementById('clubDetailPopup');
    const nameEl = document.getElementById('popupName');
    const affEl = document.getElementById('popupAffluenza');
    const ingEl = document.getElementById('popupIngresso');
    const drinkEl = document.getElementById('popupDrink');
    const etaEl = document.getElementById('popupEta');
    const musEl = document.getElementById('popupMusica');
    const piccoEl = document.getElementById('popupPicco');
    const prossimoEl = document.getElementById('popupProssimoEvento');
    const dirEl = document.getElementById('popupDirections');

    const vibe = deriveVibeDetails(club);
    const fbPop = club.firebaseData || null;
    const showPopupAff = mapCardShows(fbPop, 'affluenza');
    const affRow = affEl && affEl.closest('.popup-row');
    if (affRow) affRow.style.display = showPopupAff ? '' : 'none';

    nameEl.textContent = club.name || 'Locale';
    if (!vibe.aperto) { affEl.textContent = 'Chiuso'; affEl.style.color = '#fca5a5'; }
    else if (vibe.affluenzaNonImpostata) { affEl.textContent = 'Non impostata'; affEl.style.color = 'rgba(136, 128, 168, 0.95)'; }
    else { affEl.textContent = `${vibe.crowdPct}%`; affEl.style.color = ''; }

    ingEl.textContent = vibe.entryNonImpostato ? 'Non impostato' : (vibe.entryEuro === 0 ? 'Gratis' : `${vibe.entryEuro}€`);
    ingEl.style.color = vibe.entryNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
    drinkEl.textContent = vibe.drinkNonImpostato ? 'Non impostato' : `${vibe.drinkEuro}€`;
    drinkEl.style.color = vibe.drinkNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
    etaEl.textContent = vibe.ageNonImpostato ? 'Non impostata' : vibe.ageRange;
    etaEl.style.color = vibe.ageNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
    musEl.textContent = vibe.musicNonImpostato
        ? (vibe.eventoNome ? `Serata: ${vibe.eventoNome}` : 'Non impostata')
        : (vibe.eventoNome ? `${vibe.music} · Serata: ${vibe.eventoNome}` : vibe.music);
    musEl.style.color = (vibe.musicNonImpostato && !vibe.eventoNome) ? 'rgba(136, 128, 168, 0.95)' : '';
    piccoEl.textContent = vibe.piccoNonImpostato ? 'Non impostato' : vibe.peak;
    piccoEl.style.color = vibe.piccoNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
    if (prossimoEl) {
        const pe = (vibe.prossimoEventoLabel && String(vibe.prossimoEventoLabel).trim()) ? String(vibe.prossimoEventoLabel).trim() : '';
        prossimoEl.textContent = pe || 'Non impostata';
        prossimoEl.style.color = pe ? '' : 'rgba(136, 128, 168, 0.95)';
    }

    let liveBadge = popup.querySelector('.fmn-live-badge');
    if (!liveBadge) {
        liveBadge = document.createElement('span');
        liveBadge.className = 'fmn-live-badge';
        liveBadge.style.cssText = 'font-size:0.68rem;font-weight:700;letter-spacing:0.08em;border-radius:999px;padding:0.18rem 0.6rem;margin-left:0.5rem;vertical-align:middle;';
        nameEl.after(liveBadge);
    }
    if (!vibe.aperto) {
        liveBadge.textContent = '● CHIUSO'; liveBadge.style.color = '#fca5a5';
        liveBadge.style.background = 'rgba(239,68,68,0.12)'; liveBadge.style.border = '0.5px solid rgba(239,68,68,0.35)';
        liveBadge.style.display = 'inline';
    } else if (vibe.isBar) {
        liveBadge.textContent = '● APERTO'; liveBadge.style.color = '#cbd5e1';
        liveBadge.style.background = 'rgba(148,163,184,0.12)'; liveBadge.style.border = '0.5px solid rgba(148,163,184,0.35)';
        liveBadge.style.display = 'inline';
    } else if (vibe.isLive) {
        liveBadge.textContent = '● LIVE'; liveBadge.style.color = '#4ade80';
        liveBadge.style.background = 'rgba(74,222,128,0.12)'; liveBadge.style.border = '0.5px solid rgba(74,222,128,0.35)';
        liveBadge.style.display = 'inline';
    } else {
        liveBadge.style.display = 'none';
    }

    dirEl.dataset.lat = String(club.lat);
    dirEl.dataset.lng = String(club.lng);
    dirEl.dataset.name = String(club.name || 'Locale');
    popup.style.display = detailPopupOpenDisplay();
    requestSyncClubDetailPopupDock();
}

let fmnDetailDockRaf = 0;
function syncClubDetailPopupDock() {
    if (!window.matchMedia('(min-width: 769px)').matches) {
        document.documentElement.style.removeProperty('--fmn-detail-right');
        document.documentElement.style.removeProperty('--fmn-detail-bottom');
        return;
    }
    const shell = document.querySelector('.map-shell');
    if (!shell) return;
    const r = shell.getBoundingClientRect();
    const right = Math.max(10, Math.round(window.innerWidth - r.right + 16));
    const bottom = Math.max(10, Math.round(window.innerHeight - r.bottom + 16));
    document.documentElement.style.setProperty('--fmn-detail-right', `${right}px`);
    document.documentElement.style.setProperty('--fmn-detail-bottom', `${bottom}px`);
}
function requestSyncClubDetailPopupDock() {
    if (fmnDetailDockRaf) return;
    fmnDetailDockRaf = requestAnimationFrame(() => { fmnDetailDockRaf = 0; syncClubDetailPopupDock(); });
}
window.addEventListener('scroll', requestSyncClubDetailPopupDock, { passive: true });
window.addEventListener('resize', requestSyncClubDetailPopupDock, { passive: true });

(function setupCloseMapCardWhenLeavingMap() {
    const mapSection = document.getElementById('map');
    if (!mapSection || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            const pop = document.getElementById('clubDetailPopup');
            if (!pop || pop.style.display === 'none') continue;
            if (e.isIntersecting && e.intersectionRatio >= 0.05) continue;
            hideClubDetailsPopup();
        }
    }, { root: null, threshold: [0, 0.02, 0.05, 0.1], rootMargin: '-40px 0px -24px 0px' });
    io.observe(mapSection);
})();

function setActiveCard(cardEl) {
    document.querySelectorAll('.club-card').forEach(c => c.classList.remove('active'));
    cardEl.classList.add('active');
}

function clearMarkers() {
    if (!leafletMap) { leafletMarkers = []; return; }
    leafletMarkers.forEach(m => m.remove());
    leafletMarkers = [];
}

function renderMarkers(clubs) {
    if (!leafletMap) return;
    clearMarkers();
    clubs.forEach(addMarkerForClub);
}

function setTempSearchMarker(lat, lng, label) {
    if (!leafletMap) return;
    if (tempSearchMarker) tempSearchMarker.remove();
    tempSearchMarker = L.marker([lat, lng]).addTo(leafletMap);
    if (label) tempSearchMarker.bindPopup(escapeHtml(label)).openPopup();
}

function geocodeScoreResult(r) {
    const cls = (r.class || '').toLowerCase();
    const typ = (r.type || '').toLowerCase();
    if (cls === 'place' && (typ === 'city' || typ === 'town')) return 0;
    if (cls === 'place' && typ === 'municipality') return 1;
    if (cls === 'boundary' && typ === 'administrative') return 2;
    if (cls === 'place' && (typ === 'village' || typ === 'hamlet' || typ === 'suburb')) return 3;
    if (cls === 'place') return 5;
    return 50;
}

// ─── FIX geocoding: cache in memoria + localStorage ───────────────────────────
const geocodeMemCache = new Map();

function isLikelyInItaly(lat, lng) {
    const la = Number(lat), lo = Number(lng);
    // BBox “larga” Italia (include isole). Serve solo a evitare cache palesemente sbagliate.
    return Number.isFinite(la) && Number.isFinite(lo) && la >= 35.0 && la <= 47.8 && lo >= 6.0 && lo <= 19.5;
}

async function geocodeItaly(query) {
    const q = (query || '').trim();
    if (!q) return null;
    const key = `fmn_geocode_it_${normalizeText(q)}`;

    if (geocodeMemCache.has(key)) return geocodeMemCache.get(key);

    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const o = JSON.parse(raw);
            if (o && Number.isFinite(o.lat) && Number.isFinite(o.lng) && isLikelyInItaly(o.lat, o.lng) && o.ts && (Date.now() - o.ts) < (14 * 24 * 60 * 60 * 1000)) {
                const result = { lat: Number(o.lat), lng: Number(o.lng), label: String(o.label || q) };
                geocodeMemCache.set(key, result);
                return result;
            }
        }
    } catch { /* ignore */ }

    const url = `${NOMINATIM_ENDPOINT}?format=json&limit=5&countrycodes=it&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Geocoding non disponibile');
    const data = await res.json();
    if (!data || !data.length) return null;

    const best = data.reduce((prev, curr) => geocodeScoreResult(curr) < geocodeScoreResult(prev) ? curr : prev);
    const out = { lat: Number(best.lat), lng: Number(best.lon), label: best.display_name };
    if (!isLikelyInItaly(out.lat, out.lng)) return null;
    geocodeMemCache.set(key, out);
    try { localStorage.setItem(key, JSON.stringify({ ...out, ts: Date.now() })); } catch { /* ignore */ }
    return out;
}

function applySearchFilter(query) {
    const q = normalizeText(query).trim();
    const visible = !q ? [...clubsData] : clubsData.filter(c => {
        const name = normalizeText(c.name);
        const addr = normalizeText(c.address);
        return name.includes(q) || addr.includes(q);
    });
    renderMarkers(visible);
    renderSidebar(visible);
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE PLACES
// ─────────────────────────────────────────────────────────────────────────────

function loadGoogleMapsPlacesIfNeeded() {
    if (!GOOGLE_PLACES_API_KEY) return Promise.resolve(null);
    if (window.google && window.google.maps) return Promise.resolve(window.google);
    return new Promise((resolve, reject) => {
        const existing = document.getElementById('googleMapsJsFmn');
        if (existing) {
            const done = () => {
                if (window.google && window.google.maps) resolve(window.google);
                else reject(new Error('Google Maps JS non pronto'));
            };
            if (window.google && window.google.maps) { done(); return; }
            existing.addEventListener('load', done);
            existing.addEventListener('error', () => reject(new Error('Google Maps JS non caricato')));
            return;
        }
        const cbName = '__fmnInitGoogleMapsCb_' + Math.random().toString(36).slice(2, 10);
        window[cbName] = () => {
            try {
                if (window.google && window.google.maps && window.google.maps.places) resolve(window.google);
                else reject(new Error('Google Maps JS non pronto (callback)'));
            } finally { try { delete window[cbName]; } catch { window[cbName] = undefined; } }
        };
        const s = document.createElement('script');
        s.id = 'googleMapsJsFmn'; s.async = true; s.defer = true;
        // Add loading=async to follow Google best practice and remove console warning
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_PLACES_API_KEY)}&libraries=places&callback=${cbName}&loading=async`;
        s.onerror = () => { try { delete window[cbName]; } catch { window[cbName] = undefined; } reject(new Error('Google Maps JS non caricato')); };
        document.head.appendChild(s);
    });
}

let _placesLibPromise = null;

async function ensurePlacesLibrary() {
    if (!GOOGLE_PLACES_API_KEY) return null;
    const g = await loadGoogleMapsPlacesIfNeeded();
    if (!g || !g.maps || typeof g.maps.importLibrary !== 'function') return null;
    if (!_placesLibPromise) {
        _placesLibPromise = g.maps.importLibrary('places').catch((e) => {
            _placesLibPromise = null;
            throw e;
        });
    }
    const lib = await _placesLibPromise;
    return lib && lib.Place ? lib : null;
}

function placeDisplayName(p) {
    if (!p) return '';
    const dn = p.displayName;
    if (typeof dn === 'string') return dn;
    if (dn && typeof dn === 'object') {
        if (typeof dn.text === 'string') return dn.text;
        if (typeof dn.localizedText === 'string') return dn.localizedText;
    }
    return '';
}

function placeLatLng(p) {
    if (!p || !p.location) return null;
    const loc = p.location;
    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat: Number(lat), lng: Number(lng) };
}

// ─── FIX #3: arricchimento Google in batch paralleli invece di seriale ─────────
async function enrichClubsWithGoogleRatings(clubs) {
    const stripPending = (c, extra = {}) => ({ ...c, ratingsPending: false, ...extra });
    if (!GOOGLE_PLACES_API_KEY) return clubs.map((c) => stripPending(c));

    let lib = null;
    try { lib = await ensurePlacesLibrary(); } catch (e) { console.warn('Places library non disponibile:', e); }
    if (!lib || !lib.Place) {
        return clubs.map((c) => stripPending(c, {
            starsText: c.starsText === '…' ? '—' : (c.starsText || '—'),
            ratingText: (typeof c.ratingText === 'string' && c.ratingText.includes('aggiornamento')) ? '—' : (c.ratingText || '—')
        }));
    }

    async function enrichOneClub(club) {
        try {
            if (club.ratingsPending === false && club.starsText && club.starsText !== '—' && club.starsText !== '…'
                && typeof club.ratingText === 'string' && !club.ratingText.includes('aggiornamento')) {
                return stripPending(club);
            }
            const biasCenter = { lat: club.lat, lng: club.lng };
            const locationBias = { circle: { center: biasCenter, radius: 2800 } };
            const textQuery = [club.name, club.address].filter(Boolean).join(' ').trim() || String(club.name || 'Locale');

            // Only use Place.searchNearby (no legacy APIs, no searchText)
            const resp = await lib.Place.searchNearby({
                locationRestriction: { center: biasCenter, radius: 2800 },
                // Heuristic: search clubs first, then bars as fallback
                includedTypes: ['night_club'],
                maxResultCount: 5,
                language: 'it',
                region: 'IT',
                fields: ['id', 'displayName', 'location', 'rating', 'userRatingCount', 'types', 'reviews']
            });

            let places = resp && Array.isArray(resp.places) ? resp.places : [];
            if (!places.length) {
                const resp2 = await lib.Place.searchNearby({
                    locationRestriction: { center: biasCenter, radius: 2800 },
                    includedTypes: ['bar'],
                    maxResultCount: 5,
                    language: 'it',
                    region: 'IT',
                    fields: ['id', 'displayName', 'location', 'rating', 'userRatingCount', 'types', 'reviews']
                });
                places = resp2 && Array.isArray(resp2.places) ? resp2.places : [];
            }

            const qn = normalizeText(textQuery);
            const p0 = places
                .map((p) => ({ p, n: normalizeText(placeDisplayName(p)) }))
                .sort((a, b) => {
                    const aHit = a.n && qn && a.n.includes(qn) ? 0 : 1;
                    const bHit = b.n && qn && b.n.includes(qn) ? 0 : 1;
                    const ar = typeof a.p.rating === 'number' ? -a.p.rating : 0;
                    const br = typeof b.p.rating === 'number' ? -b.p.rating : 0;
                    return (aHit - bHit) || (ar - br);
                })[0]?.p || null;

            if (!p0) return stripPending(club, { ratingText: '—', starsText: '—', source: 'OSM' });

            const rating = typeof p0.rating === 'number' ? p0.rating : null;
            const total = typeof p0.userRatingCount === 'number' ? p0.userRatingCount : null;
            const ratingText = (rating != null && total != null) ? `${rating.toFixed(1)} (${total})` : (rating != null ? rating.toFixed(1) : '—');
            const starsText = rating != null ? starsFromRating(rating) : '—';
            const googlePlaceTypes = Array.isArray(p0.types) ? p0.types.slice() : (club.googlePlaceTypes || []);
            const googleReviews = Array.isArray(p0.reviews) ? p0.reviews : [];
            return stripPending(club, { ratingText, starsText, source: 'Google', googlePlaceTypes, googleReviews });
        } catch (err) {
            console.warn('Google rating locale:', club && club.name, err);
            return stripPending(club, { ratingText: '—', starsText: '—' });
        }
    }

    const BATCH_SIZE = 5; // 5 richieste in parallelo invece di 1 alla volta con gap artificiale
    const enrichLimit = Math.min(clubs.length, GOOGLE_ENRICH_MAX_CLUBS);
    const enriched = [];

    for (let i = 0; i < clubs.length; i += BATCH_SIZE) {
        const batchClubs = clubs.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batchClubs.map((club, idx) => {
                if (i + idx >= enrichLimit) return Promise.resolve(stripPending(club, { ratingText: '—', starsText: '—' }));
                return enrichOneClub(club);
            })
        );
        enriched.push(...batchResults);

        // Piccola pausa tra batch per non saturare le Places API (ridotta da 45ms×batch a 80ms ogni 5)
        if (i + BATCH_SIZE < enrichLimit) {
            await new Promise((r) => setTimeout(r, 80));
        }
    }

    return enriched;
}

async function fetchNightclubsFromGooglePlaces({ center, radiusMeters }) {
    if (!GOOGLE_PLACES_API_KEY) return null;
    let lib = null;
    try { lib = await ensurePlacesLibrary(); } catch (e) { console.warn('Google Places non disponibile:', e); return []; }
    if (!lib || !lib.Place) return [];

    const radius = Math.max(1000, Math.min(50000, radiusMeters));
    const locationRestriction = { center: { lat: center.lat, lng: center.lng }, radius };
    const baseFields = ['id', 'displayName', 'location', 'rating', 'userRatingCount', 'types'];

    const mergeById = (lists) => {
        const map = new Map();
        for (const list of lists) {
            const arr = list && Array.isArray(list.places) ? list.places : (Array.isArray(list) ? list : []);
            for (const p of arr) {
                const pid = p && p.id ? String(p.id) : '';
                if (!pid || map.has(pid)) continue;
                map.set(pid, p);
            }
        }
        return [...map.values()];
    };

    let pooled = [];
    try {
        const [clubsRes, barsRes] = await Promise.all([
            lib.Place.searchNearby({
                locationRestriction,
                includedTypes: ['night_club'],
                maxResultCount: 20,
                language: 'it',
                region: 'IT',
                fields: baseFields
            }),
            lib.Place.searchNearby({
                locationRestriction,
                includedTypes: ['bar'],
                maxResultCount: 20,
                language: 'it',
                region: 'IT',
                fields: baseFields
            })
        ]);
        pooled = mergeById([clubsRes, barsRes]);
    } catch (e) {
        console.warn('Place.searchNearby failed:', e);
    }

    if (!pooled.length) return [];

    return pooled.map((p) => {
        const ll = placeLatLng(p);
        if (!ll) return null;
        const rating = typeof p.rating === 'number' ? p.rating : null;
        const total = typeof p.userRatingCount === 'number' ? p.userRatingCount : null;
        const ratingText = (rating != null && total != null) ? `${rating.toFixed(1)} (${total})` : (rating != null ? rating.toFixed(1) : '—');
        const starsText = rating != null ? starsFromRating(rating) : '—';
        const gTypes = Array.isArray(p.types) ? p.types : [];
        const isBar = (gTypes.includes('bar') || gTypes.includes('pub')) && !gTypes.includes('night_club');
        return {
            id: `google:${String(p.id || placeDisplayName(p) || 'place')}`,
            name: placeDisplayName(p) || 'Locale',
            address: '',
            lat: ll.lat, lng: ll.lng, distanceKm: kmBetween(center, { lat: ll.lat, lng: ll.lng }),
            ratingText, starsText, ratingsPending: false,
            crowdText: '—', crowdPercent: 0, ageText: '—',
            source: 'Google', googlePlaceTypes: gTypes.slice(), isBar
        };
    }).filter(Boolean).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, GOOGLE_PLACES_MAX_RESULTS);
}

function addMarkerForClub(club) {
    if (!leafletMap) return;
    const isNc = isNightclub(club);
    const bubbleBg = isNc
        ? 'linear-gradient(135deg, #38bdf8, #2563eb)'
        : 'linear-gradient(135deg, #a855f7, #ec4899)';
    const stemBg = isNc ? 'rgba(56, 189, 248, 0.95)' : 'rgba(168, 85, 247, 0.9)';
    const dotBg = isNc ? 'rgba(56, 189, 248, 0.98)' : 'rgba(168, 85, 247, 0.95)';
    const dotShadow = isNc ? '0 0 0 6px rgba(56, 189, 248, 0.14)' : '0 0 0 6px rgba(168, 85, 247, 0.12)';
    const icon = L.divIcon({
        className: 'fmn-marker',
        html: `<div class="fmn-pin" data-fmn-type="${isNc ? 'nightclub' : 'venue'}"><div class="fmn-pin-bubble" style="background:${bubbleBg};box-shadow:0 8px 30px ${isNc ? 'rgba(37,99,235,0.35)' : 'rgba(168,85,247,0.45)'};">${escapeHtml(club.name || 'Locale')}</div><div class="fmn-pin-stem" style="background:${stemBg};"></div><div class="fmn-pin-dot" style="background:${dotBg};box-shadow:${dotShadow};"></div></div>`,
        iconSize: [1, 1], iconAnchor: [0, 0]
    });
    const marker = L.marker([club.lat, club.lng], { icon }).addTo(leafletMap);
    marker.on('click', () => { if (leafletMap) leafletMap.closePopup(); showClubDetails(club); });
    leafletMarkers.push(marker);
}

function mapCardShows(fb, key) {
    if (!fb || !fb.mapCard || typeof fb.mapCard !== 'object') return true;
    return fb.mapCard[key] !== false;
}

function clubStarsDisplayHtml(club) {
    if (club && club.ratingsPending) return '<span class="club-stars-loader" role="status" aria-label="Caricamento valutazioni"></span>';
    const raw = club && club.starsText;
    const rt = club && club.ratingText;
    const hasGoodText = typeof rt === 'string' && rt !== '—' && !rt.includes('aggiornamento');
    if (raw && raw !== '—' && raw !== '…') return `${escapeHtml(String(raw))}${hasGoodText ? ` <span>${escapeHtml(rt)}</span>` : ''}`;
    if (hasGoodText) return `<span class="club-stars-ratingtext">${escapeHtml(rt)}</span>`;
    return '<span class="club-stars-empty" aria-hidden="true">—</span>';
}

function sanitizePartnerStickerColor(c) {
    const s = String(c || '').trim();
    if (/^#([0-9a-fA-F]{6})$/.test(s)) return s.toLowerCase();
    if (/^#([0-9a-fA-F]{3})$/.test(s)) {
        const h = s.slice(1);
        return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
    }
    return '#c084fc';
}

function isMapSidebarMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function hideMapFetchLoading() {
    const el = document.getElementById('mapFetchStatus');
    if (!el) return;
    el.classList.remove('map-fetch-status--on');
    el.innerHTML = '';
    el.setAttribute('aria-hidden', 'true');
}

function showMapFetchLoading(hasActive) {
    const el = document.getElementById('mapFetchStatus');
    if (!el || !isMapSidebarMobileLayout()) return;
    const title = hasActive ? 'Carico i locali vicini…' : 'Carico locali in Italia…';
    const sub = hasActive ? 'Dati OpenStreetMap' : 'Scoperta casual · OSM';
    el.innerHTML = `<span class="map-fetch-spin" aria-hidden="true"></span><span><span class="map-fetch-line">${title}</span><span class="map-fetch-sub">${sub}</span></span>`;
    el.classList.add('map-fetch-status--on');
    el.setAttribute('aria-hidden', 'false');
}

let _fmnThirdPartyDeferred = false;

function loadDeferredThirdPartyScripts() {
    if (_fmnThirdPartyDeferred) return;
    _fmnThirdPartyDeferred = true;

    const defer = (fn) => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(fn, { timeout: 4000 });
        } else {
            setTimeout(fn, 2500);
        }
    };

    defer(() => {
        const existingGtm = document.querySelector('script[src*="googletagmanager.com/gtm"]');
        if (!existingGtm && window._fmnGtmId) {
            (function (w, d, s, l, i) {
                w[l] = w[l] || [];
                w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
                var f = d.getElementsByTagName(s)[0],
                    j = d.createElement(s),
                    dl = l !== 'dataLayer' ? '&l=' + l : '';
                j.async = true;
                j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
                f.parentNode.insertBefore(j, f);
            })(window, document, 'script', 'dataLayer', window._fmnGtmId);
        }

        defer(() => {
            const alreadyLoaded = document.querySelector(
                'script[src*="tidio"], script[src*="crisp.chat"], script[src*="intercom"], script[src*="tawk.to"]'
            );
            if (alreadyLoaded) return;

            // opzionale: aggiungi qui il tuo widget chat
        });
    });
}

function renderSidebar(clubs) {
    hideMapFetchLoading();
    const sidebar = document.querySelector('.map-sidebar');
    sidebar.innerHTML = '';

    if (!clubs.length) {
        sidebar.innerHTML = `
          <div class="club-card active" style="cursor:default;">
            <div class="club-card-header"><div class="club-name">Nessun locale trovato</div><div class="club-stars">—</div></div>
            <div class="club-meta">Prova a ricaricare o aumenta il raggio.</div>
            <div class="club-tags"><span class="tag tag-music">Discoteca</span></div>
          </div>`;
        return;
    }

    const center = getSearchCenter();
    const nearbySponsored = sponsoredVenues.filter(sv =>
        sv.lat && sv.lng && sv.radiusKm && kmBetween(center, { lat: sv.lat, lng: sv.lng }) <= sv.radiusKm
    );

    nearbySponsored.forEach(sv => {
        const card = document.createElement('div');
        card.className = 'club-card sponsored';
        const dkm = kmBetween(center, { lat: sv.lat, lng: sv.lng }).toFixed(1);
        card.innerHTML = `
          <div class="sponsored-label">✦ Suggerito dall'AI</div>
          <div class="club-card-header">
            <div class="club-name">${escapeHtml(sv.name || 'Locale')}</div>
            <div class="club-stars">—</div>
          </div>
          <div class="club-meta">${dkm} km${sv.address ? ' · ' + escapeHtml(sv.address) : ''}</div>
          <div class="club-tags">
            <span class="tag tag-ai">Suggerito AI</span>
            ${sv.tagline ? `<span class="tag tag-music">${escapeHtml(sv.tagline)}</span>` : ''}
          </div>`;
        card.addEventListener('click', () => {
            setActiveCard(card);
            if (leafletMap) leafletMap.setView([sv.lat, sv.lng], Math.max(14, leafletMap.getZoom()));
            if (sv.link) window.open(sv.link, '_blank', 'noopener');
        });
        sidebar.appendChild(card);
    });

    // ─── FIX rendering: usa DocumentFragment per un solo reflow DOM ────────────
    const fragment = document.createDocumentFragment();

    clubs.forEach((club) => {
        const card = document.createElement('div');
        const dkm = (typeof club.distanceKm === 'number' && Number.isFinite(club.distanceKm)) ? club.distanceKm.toFixed(1) : '—';
        const distMeta = dkm === '—' ? '—' : `${dkm} km`;
        const closed = isNightclubAutoClosedNow(club);
        const crowdPct = closed ? 0 : (typeof club.crowdPercent === 'number' ? club.crowdPercent : 0);
        const crowdLabel = closed
            ? '<span style="color:#fca5a5;font-weight:600;">Chiuso</span>'
            : (club.crowdText === 'Non impostata'
                ? '<span style="color:rgba(136,128,168,0.98);font-weight:500;">Non impostata</span>'
                : `<span style="color:#c084fc;font-weight:500;">${club.crowdText || '—'}</span>`);
        const fb = club.firebaseData || null;
        const showMapAff = mapCardShows(fb, 'affluenza');
        const showMapStickers = mapCardShows(fb, 'stickers');
        const showMapStars = mapCardShows(fb, 'stars');
        const fbAperto = fb ? (fb.aperto !== false) : true;
        const fbIsBar = (fb && fb.isBar === true) || club.isBar;
        const badgeHtml = closed
            ? ' <span style="font-size:0.62rem;font-weight:700;color:#fca5a5;background:rgba(239,68,68,0.12);border:0.5px solid rgba(239,68,68,0.3);border-radius:999px;padding:0.1rem 0.45rem;margin-left:0.3rem;letter-spacing:0.06em;">CHIUSO</span>'
            : (fbIsBar && fbAperto
                ? ' <span style="font-size:0.62rem;font-weight:700;color:#cbd5e1;background:rgba(148,163,184,0.12);border:0.5px solid rgba(148,163,184,0.3);border-radius:999px;padding:0.1rem 0.45rem;margin-left:0.3rem;letter-spacing:0.06em;">APERTO</span>'
                : (fbAperto
                    ? ' <span style="font-size:0.62rem;font-weight:700;color:#4ade80;background:rgba(74,222,128,0.12);border:0.5px solid rgba(74,222,128,0.3);border-radius:999px;padding:0.1rem 0.45rem;margin-left:0.3rem;letter-spacing:0.06em;">LIVE</span>'
                    : ''));

        const stickersRaw = (fb && Array.isArray(fb.stickers)) ? fb.stickers : [];
        const stickerHtmlParts = [];
        const addSticker = (label, cls) => stickerHtmlParts.push(`<span class="tag ${cls}">${label}</span>`);
        const addPartnerCustomSticker = (text, colorHex) => {
            const col = sanitizePartnerStickerColor(colorHex);
            const safe = escapeHtml(String(text || '').slice(0, 28));
            stickerHtmlParts.push(`<span class="tag" style="border:1px solid ${col};color:${col};background:rgba(255,255,255,0.04);">${safe}</span>`);
        };
        if (showMapStickers) {
            stickersRaw.slice(0, 4).forEach((item) => {
                if (item && typeof item === 'object' && !Array.isArray(item) && String(item.type) === 'custom') {
                    const tx = String(item.text || '').trim().slice(0, 28);
                    if (tx) addPartnerCustomSticker(tx, item.color); return;
                }
                const s = typeof item === 'string' ? item : '';
                if (s === 'nightclub') addSticker('Nightclub', 'tag-music');
                else if (s === 'free_entry') addSticker('Ingresso gratis', 'tag-free');
                else if (s === 'vip') addSticker('VIP', 'tag-music');
                else if (s === 'cocktail_bar') addSticker('Cocktail bar', 'tag-free');
                else if (s === 'techno') addSticker('Techno', 'tag-music');
                else if (s === 'house') addSticker('House', 'tag-music');
            });
            if (!stickerHtmlParts.length) {
                club.isBar ? addSticker('Bar', 'tag-free') : addSticker(club.seedTipo || 'Discoteca', 'tag-music');
                if (club.seedIngresso === 0) addSticker('Ingresso gratis', 'tag-free');
            }
        }

        const compactClass = (!showMapAff || !showMapStickers || !showMapStars) ? ' club-card--compact' : '';
        card.className = 'club-card' + compactClass;
        const addrRaw = (club.address && String(club.address).trim()) ? String(club.address).trim() : '';
        const metaBase = addrRaw ? `${escapeHtml(addrRaw)} · ${distMeta}` : distMeta;
        const metaLine = showMapAff ? `<div class="club-meta">${metaBase}</div>` : `<div class="club-meta">${metaBase}${badgeHtml}</div>`;
        const tagsBlock = stickerHtmlParts.length ? `<div class="club-tags">${stickerHtmlParts.join('')}</div>` : '';
        const crowdBlock = showMapAff
            ? `<div class="crowd-bar"><div class="crowd-fill" style="width:${crowdPct}%"></div></div>
               <div class="crowd-label"><span>Affluenza${badgeHtml}</span>${crowdLabel}</div>`
            : '';
        card.innerHTML = `
          <div class="club-card-header">
            <div class="club-name">${escapeHtml(club.name || 'Locale')}</div>
            ${showMapStars ? `<div class="club-stars">${clubStarsDisplayHtml(club)}</div>` : ''}
          </div>
          ${metaLine}${tagsBlock}${crowdBlock}`;

        card.addEventListener('click', () => {
            setActiveCard(card);
            if (leafletMap) {
                leafletMap.setView([club.lat, club.lng], Math.max(14, leafletMap.getZoom()));
            }
            showClubDetails(club);
        });
        fragment.appendChild(card);
    });

    sidebar.appendChild(fragment);
    loadDeferredThirdPartyScripts();
}

function clubsForSidebar(clubs) {
    // Seed venues are real nearby places used both as placeholders and as
    // additions when OSM data is incomplete. They should be visible in cards.
    return clubs || [];
}

function initMap() {
    const mapEl = document.getElementById('leafletMap');
    if (!mapEl) return;

    leafletMap = L.map(mapEl, { zoomControl: true, preferCanvas: true })
        .setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 6);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19
    }).addTo(leafletMap);

    // ─── FIX #4: warm-start unificato — una sola chiamata a loadClubs ─────────
    function requestUserLocation(preferGpsAsSearchCenter = false) {
        if (!('geolocation' in navigator)) return;
        if (!window.isSecureContext) { console.warn('Geolocation richiede HTTPS/localhost.'); return; }

        function applyPosition(pos, preferForCenter) {
            const prevLocForReload = userLocation;
            const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            userLocation = here;
            discoveryCenter = null;
            discoveryRetryCount = 0;
            gpsRetryCount = 0;
            saveLastLocation(here);

            if (userLocationMarker) { userLocationMarker.remove(); userLocationMarker = null; }
            userLocationMarker = L.circleMarker([here.lat, here.lng], {
                radius: 6, weight: 2, color: '#22d3ee', fillColor: '#06b6d4', fillOpacity: 0.85
            }).addTo(leafletMap).bindPopup('Sei qui');
            userLocationMarker.on('click', () => openInMapsChooser(here.lat, here.lng, 'La tua posizione'));

            if (!manualCenter && leafletMap) {
                leafletMap.flyTo([here.lat, here.lng], 13, { duration: 0.75, easeLinearity: 0.25 });
            }

            const useGpsAsCenter = preferGpsAsSearchCenter || !manualCenter;
            if (!useGpsAsCenter) return;

            if (preferGpsAsSearchCenter) {
                currentRadiusKm = 5;
                try {
                    const rr = document.getElementById('radiusKmRange');
                    const rp = document.getElementById('radiusKmPill');
                    if (rr) rr.value = '5';
                    if (rp) rp.textContent = '5 km';
                } catch { /* ignore */ }
            }

            manualCenter = null;
            if (tempSearchMarker) { tempSearchMarker.remove(); tempSearchMarker = null; }

            const skipClubReload = Boolean(
                prevLocForReload && !preferGpsAsSearchCenter && kmBetween(prevLocForReload, here) < 0.12
            );
            if (!skipClubReload) loadClubs();
        }

        const fastOpts = preferGpsAsSearchCenter
            ? { enableHighAccuracy: false, timeout: 4000, maximumAge: 300000 }
            : { enableHighAccuracy: false, timeout: 7000, maximumAge: 180000 };

        navigator.geolocation.getCurrentPosition((pos) => {
            applyPosition(pos, preferGpsAsSearchCenter);
            if (!preferGpsAsSearchCenter) return;
            // Refine pass in background (non blocca)
            navigator.geolocation.getCurrentPosition(
                (pos2) => applyPosition(pos2, true),
                () => { /* ignore */ },
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
            );
        }, (err) => {
            console.warn('Geolocation non disponibile:', err && err.message ? err.message : err);
            loadClubs();
        }, fastOpts);
    }

    window.__requestUserLocationAuto = () => requestUserLocation(true);
    window.__requestUserLocation = () => requestUserLocation(true);
    requestSyncClubDetailPopupDock();
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED VENUES E BG PACK
// ─────────────────────────────────────────────────────────────────────────────

const SEED_VENUES = [
    { id: 'life-club-rovetta', name: 'Life Club Rovetta', query: 'Life Club Via Vogno Rovetta', lat: 45.8741, lng: 9.9717, address: 'Via Vogno 7, 24020 Rovetta (BG)' },
    { id: 'bar-da-spicchio-clusone', name: 'Bar Da Spicchio', query: 'Bar Spicchio Via Nuova 12 Rovetta', lat: 45.8917564, lng: 9.9853276, address: 'Via Nuova 12, 24020 Rovetta (BG)', tipo: 'Locale', ingresso: 0 },
    { id: 'piccolo-bar-clusone', name: 'Piccolo Bar', query: 'Piccolo Bar Via Sales 2 Clusone', lat: 45.8831737, lng: 9.9343768, address: 'Via Sales 2, 24023 Clusone (BG)', tipo: 'Locale', ingresso: 0 },
    { id: 'piccolo-bar-2-clusone', name: 'Piccolo Bar 2.0', query: 'Piccolo Bar 2.0 Via Luigi Carrara 1 Clusone', lat: 45.8877922, lng: 9.9329784, address: 'Via Luigi Carrara 1, 24023 Clusone (BG)', tipo: 'Locale', ingresso: 0 }
];

const BG_PACK_KEY = 'fmn_seed_pack_bg_v1';
const BG_PACK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const BG_CENTER = { lat: 45.6983, lng: 9.6773 };

function getBgPack() {
    try {
        const raw = localStorage.getItem(BG_PACK_KEY);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || !Array.isArray(o.items) || !o.ts) return null;
        if (Date.now() - o.ts > BG_PACK_TTL_MS) return null;
        return o.items;
    } catch { return null; }
}

function setBgPack(items) {
    try {
        if (!Array.isArray(items) || !items.length) return;
        localStorage.setItem(BG_PACK_KEY, JSON.stringify({ ts: Date.now(), items }));
    } catch { /* ignore */ }
}

function isNearBergamo(center) {
    try {
        if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return false;
        return kmBetween(center, BG_CENTER) <= 28;
    } catch { return false; }
}

async function prefetchBgPackIfNeeded(center) {
    if (!isNearBergamo(center)) return;
    if (getBgPack()) return;

    // ✅ AGGIUNTO
    const allThrottled = OVERPASS_ENDPOINTS.every(ep => isOverpassEndpointThrottled(ep));
    if (allThrottled) return;

    try {
        const clubs = await fetchClubsOverpassAnyEndpoint(BG_CENTER, 42000);
        if (!Array.isArray(clubs) || !clubs.length) return;

        const slim = clubs.slice(0, 140).map((c) => ({
            id: `seedbg:${String(c.id || '')}`,
            name: c.name || 'Locale',
            address: c.address || '',
            lat: c.lat,
            lng: c.lng,
            ratingText: '—',
            starsText: '—',
            crowdText: 'Non impostata',
            crowdPercent: null,
            ageText: '—',
            source: 'Seed',
            osmAmenity: c.osmAmenity || '',
            osmClub: c.osmClub || '',
            osmLeisure: c.osmLeisure || '',
            isBar: Boolean(c.isBar)
        })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));

        setBgPack(slim);

    } catch {
        /* ignore */
    }
}

const LOCALI_PREFETCH_RADIUS_M = 28000;

function localiPageOverpassCacheKey(center, radiusMeters) {
    return `fmn_loc_overpass_${Number(center.lat).toFixed(3)}_${Number(center.lng).toFixed(3)}_${radiusMeters}`;
}

function getLocaliPageOverpassCache(center, radiusMeters) {
    try {
        const key = localiPageOverpassCacheKey(center, radiusMeters);
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts > OVERPASS_CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
        return cached.data;
    } catch { return null; }
}

function setLocaliPageOverpassCache(center, radiusMeters, data) {
    try {
        localStorage.setItem(localiPageOverpassCacheKey(center, radiusMeters), JSON.stringify({ ts: Date.now(), data }));
    } catch { /* quota */ }
}

async function fetchLocaliStyleOverpassElements(endpoint, center, radiusMeters) {
    if (isOverpassEndpointThrottled(endpoint)) {
        throw new Error(`Overpass endpoint in backoff: ${endpoint}`);
    }
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) throw new Error('Coordinate non valide');
    const lat = Number(center.lat); const lng = Number(center.lng);
    const r = Math.max(1000, Math.min(50000, Math.round(radiusMeters)));
    const query = `
      [out:json][timeout:25];
      (
  node["amenity"="nightclub"](around:${r},${lat},${lng});
  way["amenity"="nightclub"](around:${r},${lat},${lng});
  relation["amenity"="nightclub"](around:${r},${lat},${lng});

  node["amenity"="bar"](around:${r},${lat},${lng});
  way["amenity"="bar"](around:${r},${lat},${lng});
  relation["amenity"="bar"](around:${r},${lat},${lng});

  node["amenity"="pub"](around:${r},${lat},${lng});
  way["amenity"="pub"](around:${r},${lat},${lng});
  relation["amenity"="pub"](around:${r},${lat},${lng});
);
      out center tags;
    `.replace(/\s+/g, ' ').trim();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
        res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: new URLSearchParams({ data: query }),
            signal: controller.signal
        });
    } catch (e) {
        const msg = e && e.name === 'AbortError' ? 'timeout' : (e && e.message ? e.message : String(e));
        markOverpassEndpointFail(endpoint, msg);
        throw e;
    } finally { clearTimeout(timeout); }
    if (!res.ok) {
        if (res.status === 429) markOverpassEndpoint429(endpoint);
        else if (res.status >= 500 || res.status === 0) markOverpassEndpointFail(endpoint, `http_${res.status}`);
        throw new Error(`Overpass HTTP ${res.status}`);
    }
    const json = await res.json();
    return (json.elements || []).filter((el) => !isOsmVenueLikelyClosed(el.tags || {}));
}

async function prefetchLocaliOverpassForCenter(center) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
    const r = LOCALI_PREFETCH_RADIUS_M;
    if (getLocaliPageOverpassCache(center, r)) return;
    const eps = OVERPASS_ENDPOINTS.filter((ep) => !isOverpassEndpointThrottled(ep));
    for (const ep of (eps.length ? eps : OVERPASS_ENDPOINTS)) {
        try {
            const els = await fetchLocaliStyleOverpassElements(ep, center, r);
            if (Array.isArray(els) && els.length) { setLocaliPageOverpassCache(center, r, els); return; }
        } catch { /* prova endpoint successivo */ }
    }
}

// Sostituisci scheduleLocaliOverpassPrefetch con questa versione
function scheduleLocaliOverpassPrefetch(center) {
    const allThrottled = OVERPASS_ENDPOINTS.every(ep => isOverpassEndpointThrottled(ep));
    if (allThrottled) return; // non spammare se siamo già in backoff
    const run = () => { prefetchLocaliOverpassForCenter(center).catch(() => {}); };
    setTimeout(run, 800); // aumenta il delay da 180ms a 800ms
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 5000 });
}

function fetchSeedPlacesWithinRadius(center, radiusKm) {
    const results = [];
    const rk = Number(radiusKm);
    const seedMaxKm = Number.isFinite(rk) ? Math.max(1, rk * 1.12 + 0.35) : 1;

    if (isNearBergamo(center)) {
        const bg = getBgPack();
        if (Array.isArray(bg) && bg.length) {
            for (const seed of bg) {
                const d = kmBetween(center, { lat: seed.lat, lng: seed.lng });
                if (d > seedMaxKm) continue;
                results.push({ ...seed, distanceKm: d, seedTipo: seed.isBar ? 'Locale' : (seed.seedTipo || null), seedIngresso: seed.seedIngresso ?? null });
            }
        }
    }

    for (const seed of SEED_VENUES) {
        const d = kmBetween(center, { lat: seed.lat, lng: seed.lng });
        if (d > seedMaxKm) continue;
        results.push({
            id: `seed:${seed.id}`, name: seed.name, address: seed.address || '',
            lat: seed.lat, lng: seed.lng, distanceKm: d,
            ratingText: '—', starsText: '—', crowdText: 'Non impostata', crowdPercent: null, ageText: '—',
            source: 'Seed', osmAmenity: seed.tipo ? '' : 'nightclub', osmClub: '',
            seedTipo: seed.tipo || null, seedIngresso: seed.ingresso ?? null
        });
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD CLUBS — versione ottimizzata
// ─────────────────────────────────────────────────────────────────────────────

async function loadClubs() {
    const runId = ++loadClubsRunId;

    // ─── FIX #5: annulla le fetch Overpass del runId precedente ───────────────
    if (overpassAbortController) {
        overpassAbortController.abort();
    }
    overpassAbortController = new AbortController();
    const signal = overpassAbortController.signal;

    const sidebar = document.querySelector('.map-sidebar');
    const hasActive = Boolean(getSearchCenter() && (manualCenter || userLocation));
    const mobileMap = isMapSidebarMobileLayout();

    if (sidebar) {
        if (mobileMap) {
            sidebar.innerHTML = `<div class="map-sidebar-load-placeholder" aria-hidden="true"><span class="map-sidebar-load-dot"></span><span class="map-sidebar-load-dot"></span><span class="map-sidebar-load-dot"></span></div>`;
            showMapFetchLoading(hasActive);
        } else {
            hideMapFetchLoading();
            sidebar.innerHTML = `
              <div class="club-card active" style="cursor:default;text-align:center;">
                <div class="club-name" style="font-size:0.85rem;">Caricamento locali…</div>
                <div style="margin:0.8rem 0;"><div style="width:28px;height:28px;border:3px solid rgba(168,85,247,0.2);border-top-color:#a855f7;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto;"></div></div>
                <div class="club-meta">${hasActive ? 'Cerco i locali più vicini a te' : 'Ti mostro locali casuali in Italia'}</div>
              </div>`;
        }
    }

    try {
        const isDiscoveryMode = !manualCenter && !userLocation;
        const isGpsMode = Boolean(userLocation) && !manualCenter;

        if (isDiscoveryMode && !discoveryCenter) {
            discoveryCenter = pickDiscoveryCenter();
            if (leafletMap && discoveryCenter) leafletMap.setView([discoveryCenter.lat, discoveryCenter.lng], 11);
            currentRadiusKm = Math.max(currentRadiusKm, 22);
        }

        const radiusMeters = Math.max(1000, Math.min(100000, Math.round(currentRadiusKm * 1000)));
        const centerPrimary = getSearchCenter();
        const listRef = getVenueListReferenceCenter();

        // Warm-up seed pack early (non-blocking) so nearby searches (es. Bergamo) show instantly
        try { prefetchBgPackIfNeeded(listRef); } catch { /* ignore */ }

        // Mostra cache istantanea se disponibile
        const cachedInstant = getOverpassCacheFiltered(centerPrimary, radiusMeters);
        if (cachedInstant && cachedInstant.length && runId === loadClubsRunId) {
            clubsData = filterClubsWithinRadius(
                recomputeClubDistancesFrom(cachedInstant, listRef), currentRadiusKm
            ).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, MAP_MAX_VENUES_SHOWN);
            enrichClubsWithFirebase(clubsData);
            renderMarkers(clubsData);
            renderSidebar(clubsForSidebar(clubsData));
        }

        // Seed come placeholder immediato mentre Overpass risponde
        const seedInstant = fetchSeedPlacesWithinRadius(listRef, currentRadiusKm)
            .sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 18);
        if (seedInstant.length && !cachedInstant) {
            clubsData = seedInstant;
            enrichClubsWithFirebase(clubsData);
            renderMarkers(clubsData);
            renderSidebar(clubsForSidebar(clubsData));
        }

        const applyOverpassClubsAndRender = async (rawClubs, radiusMetersUsed) => {
            if (runId !== loadClubsRunId || !rawClubs || !rawClubs.length) return;

            let mergedClubs = rawClubs.slice();
            const seed = fetchSeedPlacesWithinRadius(listRef, currentRadiusKm);
            for (const s of seed) {
                const exists = mergedClubs.some(c =>
                    normalizeText(c.name) === normalizeText(s.name) ||
                    kmBetween({ lat: c.lat, lng: c.lng }, { lat: s.lat, lng: s.lng }) < 0.15
                );
                if (!exists) mergedClubs.push(s);
            }
            mergedClubs = filterClubsWithinRadius(
                recomputeClubDistancesFrom(mergedClubs, listRef), currentRadiusKm
            ).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, MAP_MAX_VENUES_SHOWN);

            // Merge GPS secondario se luogo lontano
            const dPlaceGpsMerge = (manualCenter && userLocation) ? kmBetween(manualCenter, userLocation) : 0;
            if (manualCenter && userLocation && dPlaceGpsMerge > SAME_AREA_GPS_VS_PLACE_KM && dPlaceGpsMerge < MERGE_GPS_SECOND_QUERY_MAX_KM) {
                try {
                    const nearMe = await fetchClubsOverpassAnyEndpoint(userLocation, radiusMetersUsed, signal);
                    if (runId !== loadClubsRunId) return;
                    if (nearMe && nearMe.length) {
                        mergedClubs = filterClubsWithinRadius(
                            recomputeClubDistancesFrom(mergeClubListsById(mergedClubs, nearMe), listRef),
                            currentRadiusKm
                        ).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, MAP_MAX_VENUES_SHOWN);
                    }
                } catch { /* merge facoltativo */ }
            }

            const wantsAutoRatings = Boolean(GOOGLE_PLACES_API_KEY);
            clubsData = mergedClubs.map((c) => wantsAutoRatings
                ? { ...c, ratingsPending: true, ratingText: 'Recensioni in aggiornamento…', starsText: '…', source: c.source || 'OSM' }
                : { ...c, ratingsPending: false, ratingText: c.ratingText ?? '—', starsText: c.starsText ?? '—' }
            );

            enrichClubsWithFirebase(clubsData);
            renderMarkers(clubsData);
            renderSidebar(clubsForSidebar(clubsData));
            loadAndRenderUserReviews();
            loadAndRenderGoogleReviews();

            // Rating Google in background
            if (wantsAutoRatings) {
                enrichClubsWithGoogleRatings(clubsData)
                    .then((enriched) => {
                        if (runId !== loadClubsRunId) return;
                        clubsData = enriched;
                        enrichClubsWithFirebase(clubsData);
                        renderMarkers(clubsData);
                        renderSidebar(clubsForSidebar(clubsData));
                        loadAndRenderUserReviews();
                        loadAndRenderGoogleReviews();
                    })
                    .catch((err) => {
                        console.warn('Arricchimento Google:', err);
                        if (runId !== loadClubsRunId) return;
                        clubsData = clubsData.map((c) => ({
                            ...c, ratingsPending: false,
                            ratingText: (typeof c.ratingText === 'string' && c.ratingText.includes('aggiornamento')) ? '—' : (c.ratingText || '—'),
                            starsText: (c.starsText === '…' || c.starsText == null) ? '—' : c.starsText
                        }));
                        enrichClubsWithFirebase(clubsData);
                        renderMarkers(clubsData);
                        renderSidebar(clubsForSidebar(clubsData));
                    });
            }
        };

        let clubs = null;
        let lastErr = null;

        // Ensure only ONE Overpass request per loadClubs run (no parallel radii, no background "second fetch").
        if (!clubs) {
            clubs = await fetchClubsOverpassAnyEndpoint(centerPrimary, radiusMeters, signal);
        }
        if (runId !== loadClubsRunId) return;

        if (clubs && clubs.length) {
            if (!isGpsMode) await applyOverpassClubsAndRender(clubs, radiusMeters);
        } else {
            // Fallback Google Places
            try {
                const googleClubs = await fetchNightclubsFromGooglePlaces({ center: listRef, radiusMeters });
                if (googleClubs && googleClubs.length) clubs = googleClubs;
            } catch (e) { lastErr = e; }

            if (!clubs || !clubs.length) {
                if (isGpsMode && gpsRetryCount < 2) {
                    gpsRetryCount++;
                    currentRadiusKm = Math.max(currentRadiusKm, gpsRetryCount === 1 ? 25 : 40);
                    return loadClubs();
                }
                if (isDiscoveryMode && discoveryRetryCount < 2) {
                    discoveryRetryCount++;
                    discoveryCenter = pickDiscoveryCenter();
                    if (leafletMap && discoveryCenter) leafletMap.setView([discoveryCenter.lat, discoveryCenter.lng], 11);
                    currentRadiusKm = Math.max(currentRadiusKm, 35);
                    return loadClubs();
                }
                throw lastErr || new Error('Nessun locale trovato (prova ad aumentare il raggio).');
            }

            clubsData = filterClubsWithinRadius(recomputeClubDistancesFrom(clubs, listRef), currentRadiusKm);
            enrichClubsWithFirebase(clubsData);
            renderMarkers(clubsData);
            renderSidebar(clubsForSidebar(clubsData));
            loadAndRenderUserReviews();
            loadAndRenderGoogleReviews();
        }

        const prefetchCenter = userLocation || manualCenter;
        if (!isDiscoveryMode && prefetchCenter && clubsData && clubsData.length) {
            scheduleLocaliOverpassPrefetch(prefetchCenter);
        }
        prefetchBgPackIfNeeded(prefetchCenter);

    } catch (err) {
        if (runId !== loadClubsRunId) return; // abort silenzioso
        hideMapFetchLoading();
        const sidebar = document.querySelector('.map-sidebar');
        if (sidebar) {
            sidebar.innerHTML = `
              <div class="club-card active" style="cursor:default;">
                <div class="club-card-header"><div class="club-name">Mappa non disponibile per un attimo</div><div class="club-stars">—</div></div>
                <div class="club-meta">Controlla la connessione e aggiorna la pagina.</div>
                <div class="club-tags"><span class="tag tag-hot">Riprova</span></div>
              </div>`;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AVVIO APP
// ─────────────────────────────────────────────────────────────────────────────

function __fmnStartApp() {
    wireMapsChooserModal();
    initMap();
    (async () => {
        try {
            if (window.isSecureContext && 'geolocation' in navigator && typeof window.__requestUserLocationAuto === 'function') {
                let geoDenied = false;
                let alreadyGranted = false;
                try {
                    if (navigator.permissions?.query) {
                        const st = await navigator.permissions.query({ name: 'geolocation' });
                        if (st.state === 'denied') geoDenied = true;
                        if (st.state === 'granted') alreadyGranted = true;
                    }
                } catch { /* Safari */ }

                if (!geoDenied && alreadyGranted) {
                    // ─── FIX #4: warm-start con posizione salvata, poi GPS reale ──────
                    const warm = peekLastLocationForWarmStart();
                    if (warm && !manualCenter) {
                        userLocation = warm;
                        discoveryCenter = null;
                        currentRadiusKm = Math.max(currentRadiusKm, 18);
                        loadClubs(); // mostra subito, GPS aggiorna in background
                    }
                    window.__requestUserLocationAuto(); // raffina con GPS reale
                    return;
                }
                if (!geoDenied) {
                    window.__requestUserLocationAuto();
                }
            }
        } catch { /* ignore */ }

        if (!manualCenter && !userLocation) {
            discoveryCenter = pickDiscoveryCenter();
            if (leafletMap && discoveryCenter) leafletMap.setView([discoveryCenter.lat, discoveryCenter.lng], 11);
            currentRadiusKm = Math.max(currentRadiusKm, 18);
        } else {
            currentRadiusKm = Math.max(currentRadiusKm, 18);
        }
        loadClubs();
    })();
    loadFirebaseVenues();
    loadAndRenderUserReviews();
}

(function __fmnLazyInitMap() {
    const mapSection = document.getElementById('map');
    if (!mapSection || typeof IntersectionObserver === 'undefined') { __fmnStartApp(); return; }
    let started = false;
    const io = new IntersectionObserver((entries) => {
        if (started) return;
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            started = true;
            io.disconnect();
            __fmnStartApp();
            break;
        }
    }, { root: null, threshold: 0.01, rootMargin: '200px 0px' });
    io.observe(mapSection);
})();

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLI UI (ricerca, raggio, posizione, popup)
// ─────────────────────────────────────────────────────────────────────────────

const searchInput = document.getElementById('mapSearchInput');
const radiusRange = document.getElementById('radiusKmRange');
const radiusPill = document.getElementById('radiusKmPill');
const useCurrentLocationBtn = document.getElementById('mapUseCurrentLocationBtn');
const searchClear = document.getElementById('mapSearchClear');

if (searchInput) {
    // When user selects a place (Enter + geocode), the input becomes a "place label"
    // and must NOT keep filtering the cards by that string (es. "Clusone" would hide nearby towns).
    let placeMode = false;
    const onType = debounce(() => {
        if (placeMode) return;
        applySearchFilter(searchInput.value);
    }, 120);
    searchInput.addEventListener('input', () => {
        placeMode = false;
        onType();
    });
    searchInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const q = (searchInput.value || '').trim();
        if (!q) return;
        try {
            const place = await geocodeItaly(q);
            if (place) {
                placeMode = true;
                // Clear any text-filter immediately so cards can show nearby venues in other comuni.
                applySearchFilter('');
                if (leafletMap) leafletMap.flyTo([place.lat, place.lng], 13, { duration: 0.65, easeLinearity: 0.25 });
                setTempSearchMarker(place.lat, place.lng, place.label);
                manualCenter = { lat: place.lat, lng: place.lng };
                persistMapFocusForLocali({ type: 'place', lat: place.lat, lng: place.lng, label: place.label || q });
                loadClubs();
                return;
            }
        } catch { /* geocoding fallito */ }
        const qn = normalizeText(q);
        const byName = clubsData.filter(c => normalizeText(c.name).includes(qn));
        if (byName.length) {
            if (leafletMap) leafletMap.setView([byName[0].lat, byName[0].lng], 15);
            showClubDetails(byName[0]);
        }
    });
}

if (radiusRange) {
    const applyRadius = () => {
        const v = Number(radiusRange.value);
        currentRadiusKm = Number.isFinite(v) ? Math.max(1, Math.min(30, Math.round(v))) : 12;
        radiusRange.value = String(currentRadiusKm);
        if (radiusPill) radiusPill.textContent = `${currentRadiusKm} km`;
        loadClubs();
    };
    radiusRange.addEventListener('input', () => {
        const v = Number(radiusRange.value);
        const km = Number.isFinite(v) ? Math.max(1, Math.min(30, Math.round(v))) : 12;
        if (radiusPill) radiusPill.textContent = `${km} km`;
    });
    radiusRange.addEventListener('change', applyRadius);
}

if (searchClear && searchInput) {
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        applySearchFilter('');
        // reset place-mode so typing filters again
        // (scoped var exists only if searchInput block ran)
        manualCenter = null;
        if (tempSearchMarker) { tempSearchMarker.remove(); tempSearchMarker = null; }
        if (leafletMap) {
            if (userLocation) {
                leafletMap.setView([userLocation.lat, userLocation.lng], 13);
                persistMapFocusForLocali({ type: 'gps', lat: userLocation.lat, lng: userLocation.lng, label: 'La tua posizione' });
            } else {
                try { localStorage.removeItem(FMN_MAP_FOCUS_KEY); } catch { /* ignore */ }
                leafletMap.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);
            }
        }
        loadClubs();
    });
}

if (useCurrentLocationBtn) {
    useCurrentLocationBtn.addEventListener('click', () => {
        if (typeof window.__requestUserLocation === 'function') window.__requestUserLocation();
    });
}

const directionsBtn = document.getElementById('popupDirections');
if (directionsBtn) {
    directionsBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const lat = Number(directionsBtn.dataset.lat);
        const lng = Number(directionsBtn.dataset.lng);
        const name = directionsBtn.dataset.name || 'Destinazione';
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        openInMapsChooser(lat, lng, name);
    });
}

const popupDiscoClose = document.getElementById('popupDiscoClose');
if (popupDiscoClose) {
    popupDiscoClose.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hideClubDetailsPopup(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// MENU MOBILE
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    const nav = document.getElementById('siteNav');
    const btn = document.getElementById('navMenuBtn');
    const backdrop = document.getElementById('navMenuBackdrop');
    const list = document.getElementById('navMainList');
    if (!nav || !btn || !backdrop || !list) return;
    function setNavOpen(open) {
        nav.classList.toggle('nav-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Chiudi menu' : 'Apri menu');
        document.body.style.overflow = open ? 'hidden' : '';
    }
    btn.addEventListener('click', () => setNavOpen(!nav.classList.contains('nav-open')));
    backdrop.addEventListener('click', () => setNavOpen(false));
    list.querySelectorAll('a').forEach((a) => { a.addEventListener('click', () => setNavOpen(false)); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('nav-open')) setNavOpen(false); });
})();
