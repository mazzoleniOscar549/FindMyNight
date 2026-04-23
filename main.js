if (!window.FMN_FIREBASE_CONFIG) {
            throw new Error('FindMyNight: carica fmn-firebase-public.js prima di questo script.');
        }
        firebase.initializeApp(window.FMN_FIREBASE_CONFIG);
        const db = firebase.firestore();

        /**
         * Mappa normalizzata-name → dati live dal bot Telegram / dashboard.
         * Struttura documento Firestore (collezione "venues"):
         *
         *   venues/{venueId}
         *     name:          "Amnesia"          // nome leggibile
         *     eventoNome:    "Follia"            // nome serata (bot: /serata Follia – techno – 10€)
         *     affluenzaPct:  70                  // 0–100 (bot: /affluenza 70%)
         *     ingresso:      10                  // € (0 = gratis)
         *     drinkEuro:     8
         *     musica:        "Techno"
         *     picco:         "01:00"
         *     ageRange:      "18–24"
         *     aperto:        true
         *     dataProssimoEvento: "2026-04-20" | <Timestamp>  // opzionale: prossima data evento
         *     aggiornatoAt:  <Timestamp>         // auto dal bot
         *
         * Il venueId è una slug del nome, es. "amnesia", "vog-club".
         * Il bot Telegram aggiorna i campi sopra; il sito li legge in tempo reale.
         */
        const fbVenueData = new Map(); // normalizedName → dati Firestore
        let nearReviews = [];

        /**
         * Locali sponsorizzati (collezione Firestore "sponsoredVenues").
         * Ogni documento ha:
         *   name:       "Bolgia"                  // nome leggibile
         *   lat:        45.6841                    // coordinate del locale
         *   lng:        9.6632
         *   radiusKm:   30                         // raggio entro cui mostrare il suggerimento
         *   address:    "Via Monte Grappa 4, Osio Sopra (BG)"
         *   tagline:    "La migliore techno di Bergamo"  // testo promozionale breve
         *   link:       "https://..."              // link opzionale
         *   active:     true                       // disattivabile senza cancellare
         */
        const sponsoredVenues = []; // array di oggetti dal Firestore

        function normalizeName(name) {
            return (name || '').toLowerCase()
                .replace(/[àáâã]/g, 'a').replace(/[èéê]/g, 'e')
                .replace(/[ìíî]/g, 'i').replace(/[òóô]/g, 'o')
                .replace(/[ùúû]/g, 'u')
                .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        }

        /** Avvia listener real-time su Firestore: aggiorna fbVenueData e ri-renderizza. */
        function loadFirebaseVenues() {
            db.collection('venues').onSnapshot(
                (snapshot) => {
                    // Ricostruzione completa: evita chiavi obsolete se cambia `name` e permette
                    // match sia su `venues/{id}` (slug) sia sul campo `name` (es. OSM vs dashboard).
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
                        renderSidebar(clubsData);
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
                    if (clubsData.length) renderSidebar(clubsData);
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

        /**
         * Arricchisce ogni club con i dati live di Firebase (se disponibili).
         * Aggiunge club.firebaseData = {...} oppure null.
         */
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
        document.querySelectorAll('.feature-card, .step, .plan-card, .stat-item').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(el);
        });

        // ─────────────────────────────────────────────────────────────────────────────
        // MAPPA REALE: Discoteche in Italia (OpenStreetMap + Overpass + Leaflet)
        // ─────────────────────────────────────────────────────────────────────────────

        const DEFAULT_CENTER = { lat: 41.8719, lng: 12.5674 };
        const OVERPASS_ENDPOINTS = [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
            'https://overpass.openstreetmap.fr/api/interpreter',
            'https://overpass.openstreetmap.ru/api/interpreter'
        ];
        // Quanti locali mostrare (Overpass può restituirne molti di più nel raggio).
        const OVERPASS_MAX_RESULTS = 100;
        const GOOGLE_PLACES_MAX_RESULTS = 72;
        const MAP_MAX_VENUES_SHOWN = 60;
        const GOOGLE_ENRICH_MAX_CLUBS = 40;
        /** Sotto questa distanza (km) tra GPS e luogo digitato, i risultati usano il GPS (stessa zona). */
        const SAME_AREA_GPS_VS_PLACE_KM = 14;
        /** Oltre SAME_AREA e sotto questo limite, uniamo anche i locali intorno al GPS. */
        const MERGE_GPS_SECOND_QUERY_MAX_KM = 200;
        const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

        // RECENSIONI AUTOMATICHE (reali) — serve una fonte ufficiale.
        // Opzione pronta: Google Places API (inserisci una key e abilita i servizi).
        // Nota: in produzione è meglio chiamare Google da backend (non esporre key nel browser).
        const GOOGLE_PLACES_API_KEY =
            typeof window !== 'undefined' && typeof window.FMN_GOOGLE_PLACES_API_KEY === 'string'
                ? window.FMN_GOOGLE_PLACES_API_KEY.trim()
                : '';

        let leafletMap;
        let leafletMarkers = [];
        let clubsData = [];
        let tempSearchMarker = null;
        let userLocation = null; // {lat,lng} se l'utente dà il permesso
        let manualCenter = null; // {lat,lng} quando cerchi un paese (Clusone, Rovetta, ...)
        let userLocationMarker = null; // marker Leaflet “sei qui” (evita duplicati al ripremere 📍)
        let currentRadiusKm = 12;
        let discoveryCenter = null; // {lat,lng,label} usato quando non c'è posizione né ricerca
        let discoveryRetryCount = 0;
        let gpsRetryCount = 0;

        const LAST_LOCATION_KEY = 'fmn_last_location';
        const LAST_LOCATION_TTL_MS = 30 * 60 * 1000; // 30 minuti
        /** Condiviso con locali.html: ultimo centro “luogo cercato” vs GPS così Locali riusa la stessa area senza ricaricare da zero. */
        const FMN_MAP_FOCUS_KEY = 'fmn_map_focus';
        const FMN_MAP_FOCUS_TTL_MS = 24 * 60 * 60 * 1000;

        function persistMapFocusForLocali(payload) {
            try {
                const type = payload && payload.type === 'place' ? 'place' : 'gps';
                const lat = payload && Number(payload.lat);
                const lng = payload && Number(payload.lng);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                const label = typeof (payload && payload.label) === 'string' ? payload.label.slice(0, 160) : '';
                localStorage.setItem(FMN_MAP_FOCUS_KEY, JSON.stringify({
                    ts: Date.now(),
                    type,
                    lat,
                    lng,
                    label
                }));
            } catch { /* ignore */ }
        }

        function saveLastLocation(loc) {
            try {
                if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
                localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat: loc.lat, lng: loc.lng, ts: Date.now() }));
                persistMapFocusForLocali({ type: 'gps', lat: loc.lat, lng: loc.lng, label: 'La tua posizione' });
            } catch { /* ignore */ }
        }

        /** Ultima posizione salvata (stesso TTL del salvataggio) per eventuali riusi futuri. */
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

        // “Discovery” veloce: una città casuale in Italia (niente geolocalizzazione richiesta)
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
            // Compatibile anche con browser che non supportano \p{Diacritic}
            return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }

        /** Nome mostrato per un POI OSM: tag più descrittivi prima di `name` breve; comune con " di …" se serve. */
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
            const city =
                t('addr:city') ||
                t('addr:town') ||
                t('addr:village') ||
                t('addr:hamlet') ||
                t('contact:city');
            const place = t('addr:place') || t('addr:suburb') || t('addr:neighbourhood');
            const pc = t('addr:postcode');
            const prov = t('addr:province');
            const locality = [pc, city || place].filter(Boolean).join(' ').trim();
            let tail = locality;
            if (prov && tail && !tail.includes(`(${prov})`)) {
                tail = `${tail} (${prov})`;
            } else if (prov && !tail) {
                tail = `(${prov})`;
            }
            if (road && tail) return `${road}, ${tail}`;
            if (road) return road;
            if (tail) return tail;
            return place || '';
        }

        function escapeHtml(s) {
            return (s || '').toString()
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function buildGoogleMapsDirectionsLink(lat, lng, name) {
            const q = encodeURIComponent(name ? `${name}` : `${lat},${lng}`);
            return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=`;
        }

        function buildAppleMapsLink(lat, lng, name) {
            const q = encodeURIComponent(name ? `${name}` : `${lat},${lng}`);
            return `https://maps.apple.com/?q=${q}&ll=${lat},${lng}`;
        }

        function buildGoogleDirectionsLink(lat, lng, name) {
            const q = encodeURIComponent(name ? `${name}` : `${lat},${lng}`);
            return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
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
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    closeMapsChooserModal();
                }
            };
            document.addEventListener('keydown', mapsChooserEscapeHandler);
            const gBtn = document.getElementById('mapsChooserGoogle');
            if (gBtn) gBtn.focus();
        }

        function wireMapsChooserModal() {
            const modal = document.getElementById('mapsChooserModal');
            const backdrop = document.getElementById('mapsChooserBackdrop');
            const closeBtn = document.getElementById('mapsChooserClose');
            const cancelBtn = document.getElementById('mapsChooserCancel');
            const googleBtn = document.getElementById('mapsChooserGoogle');
            const appleBtn = document.getElementById('mapsChooserApple');
            const openAndClose = (url) => {
                closeMapsChooserModal();
                window.open(url, '_blank', 'noopener,noreferrer');
            };
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
            [backdrop, closeBtn, cancelBtn].forEach((el) => {
                if (el) el.addEventListener('click', () => closeMapsChooserModal());
            });
        }

        /**
         * Centro usato per Overpass / Google (locali “vicini a…”).
         * Se hai digitato un paese ma sei quasi nello stesso punto, usa il GPS (più preciso).
         * Se il luogo è lontano, resta il luogo cercato; loadClubs aggiunge anche un giro intorno a te.
         */
        function getSearchCenter() {
            if (manualCenter && userLocation) {
                const d = kmBetween(manualCenter, userLocation);
                if (d <= SAME_AREA_GPS_VS_PLACE_KM) return userLocation;
            }
            return manualCenter || userLocation || discoveryCenter || DEFAULT_CENTER;
        }

        /** Centro “tema” per ordinare le distanze in lista (luogo cercato se lontano, altrimenti getSearchCenter). */
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
            (b || []).forEach((c) => {
                if (c && c.id != null && !map.has(c.id)) map.set(c.id, c);
            });
            return [...map.values()];
        }

        function recomputeClubDistancesFrom(clubs, ref) {
            if (!ref || !clubs) return clubs;
            return clubs.map((c) => ({
                ...c,
                distanceKm: kmBetween(ref, { lat: c.lat, lng: c.lng })
            }));
        }

        const OVERPASS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minuti

        function overpassCacheKey(center, radiusMeters) {
            return `fmn_overpass_${center.lat.toFixed(3)}_${center.lng.toFixed(3)}_${radiusMeters}`;
        }

        function getOverpassCache(center, radiusMeters) {
            try {
                const key = overpassCacheKey(center, radiusMeters);
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                const cached = JSON.parse(raw);
                if (Date.now() - cached.ts > OVERPASS_CACHE_TTL_MS) {
                    localStorage.removeItem(key);
                    return null;
                }
                return cached.data;
            } catch { return null; }
        }

        /** Cache da altro raggio (es. prefetch 28 km) filtrata al raggio attuale — evita round-trip Overpass. */
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
            const tryRadii = [
                radiusMeters,
                28000, 30000, 35000, 40000, 45000, 50000,
                22000, 20000, 18000, 15000, 12000
            ];
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

        function setOverpassCache(center, radiusMeters, data) {
            try {
                const key = overpassCacheKey(center, radiusMeters);
                localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
            } catch { /* quota exceeded — ignore */ }
        }

        async function fetchClubsOverpassAnyEndpoint(center, radiusMeters) {
            const cached = getOverpassCacheFiltered(center, radiusMeters);
            if (cached) return cached;

            const tryParallel = async () => {
                try {
                    return await Promise.any(
                        OVERPASS_ENDPOINTS.map((ep) =>
                            fetchNightclubsFromOverpass({ endpoint: ep, center, radiusMeters }).then((r) =>
                                Array.isArray(r) && r.length > 0 ? r : Promise.reject(new Error('empty'))
                            )
                        )
                    );
                } catch {
                    return null;
                }
            };

            let result = await tryParallel();
            if (result && result.length) {
                setOverpassCache(center, radiusMeters, result);
                return result;
            }

            await new Promise((r) => setTimeout(r, 120));
            const shuffled = [...OVERPASS_ENDPOINTS].sort(() => Math.random() - 0.5);
            for (const ep of shuffled) {
                try {
                    const r = await fetchNightclubsFromOverpass({ endpoint: ep, center, radiusMeters });
                    if (Array.isArray(r) && r.length) {
                        setOverpassCache(center, radiusMeters, r);
                        return r;
                    }
                } catch {
                    /* prova prossimo mirror Overpass */
                }
            }
            return null;
        }

        function hashClubSeed(club) {
            const s = `${club && club.id != null ? club.id : ''}|${club && club.name ? club.name : ''}|${club && club.lat != null ? club.lat : ''}`;
            let h = 2166136261;
            for (let i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return h >>> 0;
        }

        /**
         * Solo per alcuni locali: mostriamo il prezzo d’ingresso da fonti pubbliche (listino/eventi).
         * Resto delle card = "non impostato" finché il locale non è partner con dati su Firebase.
         */
        function fmnVenueShowsPublishedEntryOnly(club) {
            const n = normalizeText(club && club.name ? club.name : '');
            const id = String(club && club.id != null ? club.id : '').toLowerCase();
            if (!n && !id) return false;
            if (id.includes('life-club-rovetta') || n.includes('life club') || (n.includes('life') && n.includes('rovetta'))) return true;
            if (id.includes('bar-da-spicchio') || n.includes('bar da spicchio') || (n.includes('spicchio') && n.includes('bar'))) return true;
            if (id.includes('piccolo-bar') || n.includes('piccolo bar')) return true;
            return false;
        }

        /**
         * Prezzi indicativi da pagine pubbliche (siti locali, eventi collegati, ecc.).
         * Variano per serata: aggiornare se il locale cambia listino.
         */
        function lookupPublishedVenuePrices(club) {
            const n = normalizeText(club && club.name ? club.name : '');
            if (!n) return null;
            if (n.includes('life club') || (n.includes('life') && n.includes('rovetta'))) {
                return { entryEuro: 15, drinkEuro: 10 };
            }
            if (n.includes('oronero') || n.includes('oro nero')) {
                return { entryEuro: 12, drinkEuro: 10 };
            }
            if (n.includes('setai')) {
                return { entryEuro: 12, drinkEuro: 8 };
            }
            if (n.includes('vog club') || (n.includes('vog') && n.includes('seriate'))) {
                return { entryEuro: 15, drinkEuro: 10 };
            }
            if (n.includes('open space') || n.includes('openspace')) {
                return { entryEuro: 15, drinkEuro: 10 };
            }
            if (n.includes('piccolo bar')) {
                return { entryEuro: 0, drinkEuro: 8 };
            }
            if (n.includes('bar da spicchio') || (n.includes('spicchio') && n.includes('bar'))) {
                return { entryEuro: 0, drinkEuro: 8 };
            }
            return null;
        }

        /** Testo data prossimo evento da Firebase (stringa, Timestamp o ms). Vuoto se assente. */
        function formatProssimoEventoDisplay(raw) {
            if (raw == null) return '';
            if (typeof raw === 'string') {
                const t = raw.trim();
                if (!t || t === '—' || t === '-') return '';
                return t;
            }
            if (typeof raw.toDate === 'function') {
                try {
                    const d = raw.toDate();
                    if (Number.isNaN(d.getTime())) return '';
                    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
                } catch {
                    return '';
                }
            }
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                const d = new Date(raw);
                if (Number.isNaN(d.getTime())) return '';
                return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
            }
            const s = String(raw).trim();
            return s && s !== '—' ? s : '';
        }

        /** Discoteca = amenity nightclub, club nightclub, leisure nightclub/dancing. Bar e pub non contano. */
        function isNightclub(club) {
            const am = (club && club.osmAmenity ? String(club.osmAmenity) : '').toLowerCase();
            const cl = (club && club.osmClub ? String(club.osmClub) : '').toLowerCase();
            const le = (club && club.osmLeisure ? String(club.osmLeisure) : '').toLowerCase();
            if (am === 'nightclub' || cl === 'nightclub' || le === 'nightclub' || le === 'dancing') return true;
            const n = normalizeText(club && club.name ? club.name : '');
            if (n.includes('life club') || n.includes('amnesia') || n.includes('vog club') || n.includes('setai') || n.includes('open space') || n.includes('bolgia') || n.includes('oro nero')) return true;
            const gTypes = Array.isArray(club && club.googlePlaceTypes) ? club.googlePlaceTypes : [];
            if (gTypes.includes('night_club')) return true;
            return false;
        }

        /** Tra le 06:00 e le 21:00 le discoteche sono automaticamente chiuse. */
        function isNightclubAutoClosedNow(club) {
            if (!isNightclub(club)) return false;
            const hour = new Date().getHours();
            return hour >= 6 && hour < 21;
        }

        /**
         * Restituisce i dettagli da mostrare nel popup/card.
         * Senza dati partner su Firebase: valori “non impostato”, tranne ingresso per i locali in
         * fmnVenueShowsPublishedEntryOnly + lookupPublishedVenuePrices (Life Club, Piccolo Bar, Bar Da Spicchio, ecc.).
         */
        function deriveVibeDetails(club) {
            const published = lookupPublishedVenuePrices(club);
            const publishedEntryOk = fmnVenueShowsPublishedEntryOnly(club) && published && typeof published.entryEuro === 'number';

            const autoClosed = isNightclubAutoClosedNow(club);

            const strOk = (s) => typeof s === 'string' && s.trim().length > 0;

            // ── Dati live da Firebase (bot Telegram / dashboard partner) ──
            const fb = club.firebaseData || null;
            if (fb) {
                const fbAperto = fb.aperto != null ? fb.aperto : true;
                const hasAff = typeof fb.affluenzaPct === 'number'
                    && Number.isFinite(fb.affluenzaPct)
                    && fb.affluenzaPct >= 0
                    && fb.affluenzaPct <= 100;
                const rawProssimo = fb.dataProssimoEvento ?? fb.prossimoEventoData ?? fb.eventoData ?? null;

                let crowdPct;
                let affluenzaNonImpostata = false;
                if (autoClosed) {
                    crowdPct = 0;
                } else if (!fbAperto) {
                    crowdPct = 0;
                } else if (hasAff) {
                    crowdPct = Math.round(fb.affluenzaPct);
                } else {
                    crowdPct = null;
                    affluenzaNonImpostata = true;
                }

                const hasIngressPartner = typeof fb.ingresso === 'number' && Number.isFinite(fb.ingresso);
                let entryEuro = null;
                let entryNonImpostato = true;
                if (hasIngressPartner) {
                    entryEuro = fb.ingresso;
                    entryNonImpostato = false;
                } else if (publishedEntryOk) {
                    entryEuro = published.entryEuro;
                    entryNonImpostato = false;
                }

                const hasDrinkPartner = typeof fb.drinkEuro === 'number' && Number.isFinite(fb.drinkEuro);
                let drinkEuro = null;
                let drinkNonImpostato = !hasDrinkPartner;
                if (hasDrinkPartner) {
                    drinkEuro = fb.drinkEuro;
                    drinkNonImpostato = false;
                }

                const ageNonImpostato = !strOk(fb.ageRange);
                const ageRange = ageNonImpostato ? null : fb.ageRange.trim();

                const musicNonImpostato = !strOk(fb.musica);
                const music = musicNonImpostato ? null : fb.musica.trim();

                const picStr = fb.picco != null ? String(fb.picco).trim() : '';
                const piccoNonImpostato = !picStr;
                const peak = picStr || null;

                const isBarVenue = fb.isBar === true;
                return {
                    crowdPct,
                    affluenzaNonImpostata,
                    entryEuro,
                    entryNonImpostato,
                    drinkEuro,
                    drinkNonImpostato,
                    ageRange,
                    ageNonImpostato,
                    music,
                    musicNonImpostato,
                    peak,
                    piccoNonImpostato,
                    eventoNome: fb.eventoNome || null,
                    prossimoEventoLabel: formatProssimoEventoDisplay(rawProssimo),
                    aperto: autoClosed ? false : fbAperto,
                    isBar: isBarVenue,
                    isLive: !isBarVenue
                };
            }

            // ── Nessun documento Firebase: niente stime casuali (affluenza/prezzi/musica) ──
            let crowdPct = null;
            let affluenzaNonImpostataFb = true;
            if (autoClosed) {
                crowdPct = 0;
                affluenzaNonImpostataFb = false;
            } else if (typeof club.crowdPercent === 'number' && club.crowdPercent > 0 && club.crowdPercent <= 100) {
                crowdPct = Math.round(club.crowdPercent);
                affluenzaNonImpostataFb = false;
            }

            let entryEuro = null;
            let entryNonImpostato = true;
            if (publishedEntryOk) {
                entryEuro = published.entryEuro;
                entryNonImpostato = false;
            }

            return {
                crowdPct: autoClosed ? 0 : crowdPct,
                affluenzaNonImpostata: affluenzaNonImpostataFb,
                entryEuro,
                entryNonImpostato,
                drinkEuro: null,
                drinkNonImpostato: true,
                ageRange: null,
                ageNonImpostato: true,
                music: null,
                musicNonImpostato: true,
                peak: null,
                piccoNonImpostato: true,
                eventoNome: null,
                prossimoEventoLabel: '',
                aperto: autoClosed ? false : true,
                isBar: false,
                isLive: false
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
            if (!vibe.aperto) {
                affEl.textContent = 'Chiuso';
                affEl.style.color = '#fca5a5';
            } else if (vibe.affluenzaNonImpostata) {
                affEl.textContent = 'Non impostata';
                affEl.style.color = 'rgba(136, 128, 168, 0.95)';
            } else {
                affEl.textContent = `${vibe.crowdPct}%`;
                affEl.style.color = '';
            }
            ingEl.textContent = vibe.entryNonImpostato
                ? 'Non impostato'
                : (vibe.entryEuro === 0 ? 'Gratis' : `${vibe.entryEuro}€`);
            ingEl.style.color = vibe.entryNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
            drinkEl.textContent = vibe.drinkNonImpostato ? 'Non impostato' : `${vibe.drinkEuro}€`;
            drinkEl.style.color = vibe.drinkNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
            etaEl.textContent = vibe.ageNonImpostato ? 'Non impostata' : vibe.ageRange;
            etaEl.style.color = vibe.ageNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
            if (vibe.musicNonImpostato) {
                musEl.textContent = vibe.eventoNome ? `Serata: ${vibe.eventoNome}` : 'Non impostata';
            } else {
                musEl.textContent = vibe.eventoNome ? `${vibe.music} · Serata: ${vibe.eventoNome}` : vibe.music;
            }
            musEl.style.color = (vibe.musicNonImpostato && !vibe.eventoNome) ? 'rgba(136, 128, 168, 0.95)' : '';
            piccoEl.textContent = vibe.piccoNonImpostato ? 'Non impostato' : vibe.peak;
            piccoEl.style.color = vibe.piccoNonImpostato ? 'rgba(136, 128, 168, 0.95)' : '';
            if (prossimoEl) {
                const pe = (vibe.prossimoEventoLabel && String(vibe.prossimoEventoLabel).trim())
                    ? String(vibe.prossimoEventoLabel).trim()
                    : '';
                prossimoEl.textContent = pe || 'Non impostata';
                prossimoEl.style.color = pe ? '' : 'rgba(136, 128, 168, 0.95)';
            }

            // Badge LIVE
            let liveBadge = popup.querySelector('.fmn-live-badge');
            if (!liveBadge) {
                liveBadge = document.createElement('span');
                liveBadge.className = 'fmn-live-badge';
                liveBadge.style.cssText = 'font-size:0.68rem;font-weight:700;letter-spacing:0.08em;border-radius:999px;padding:0.18rem 0.6rem;margin-left:0.5rem;vertical-align:middle;';
                nameEl.after(liveBadge);
            }
            if (!vibe.aperto) {
                liveBadge.textContent = '● CHIUSO';
                liveBadge.style.color = '#fca5a5';
                liveBadge.style.background = 'rgba(239,68,68,0.12)';
                liveBadge.style.border = '0.5px solid rgba(239,68,68,0.35)';
                liveBadge.style.display = 'inline';
            } else if (vibe.isBar) {
                liveBadge.textContent = '● APERTO';
                liveBadge.style.color = '#cbd5e1';
                liveBadge.style.background = 'rgba(148,163,184,0.12)';
                liveBadge.style.border = '0.5px solid rgba(148,163,184,0.35)';
                liveBadge.style.display = 'inline';
            } else if (vibe.isLive) {
                liveBadge.textContent = '● LIVE';
                liveBadge.style.color = '#4ade80';
                liveBadge.style.background = 'rgba(74,222,128,0.12)';
                liveBadge.style.border = '0.5px solid rgba(74,222,128,0.35)';
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
            fmnDetailDockRaf = requestAnimationFrame(() => {
                fmnDetailDockRaf = 0;
                syncClubDetailPopupDock();
            });
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
            }, {
                root: null,
                threshold: [0, 0.02, 0.05, 0.1],
                rootMargin: '-40px 0px -24px 0px'
            });
            io.observe(mapSection);
        })();

        function setActiveCard(cardEl) {
            document.querySelectorAll('.club-card').forEach(c => c.classList.remove('active'));
            cardEl.classList.add('active');
        }

        function clearMarkers() {
            leafletMarkers.forEach(m => m.remove());
            leafletMarkers = [];
        }

        function renderMarkers(clubs) {
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

        async function geocodeItaly(query) {
            const q = (query || '').trim();
            if (!q) return null;
            const url = `${NOMINATIM_ENDPOINT}?format=json&limit=5&countrycodes=it&q=${encodeURIComponent(q)}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error('Geocoding non disponibile');
            const data = await res.json();
            if (!data || !data.length) return null;

            const best = data.reduce((prev, curr) =>
                geocodeScoreResult(curr) < geocodeScoreResult(prev) ? curr : prev
            );
            return { lat: Number(best.lat), lng: Number(best.lon), label: best.display_name };
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

        // GOOGLE PLACES (client-side senza CORS): usiamo Maps JavaScript API + PlacesService
        let googlePlacesService = null;

        function loadGoogleMapsPlacesIfNeeded() {
            if (!GOOGLE_PLACES_API_KEY) return Promise.resolve(null);
            if (window.google && window.google.maps && window.google.maps.places) return Promise.resolve(window.google);

            return new Promise((resolve, reject) => {
                const existing = document.getElementById('googleMapsJsFmn');
                if (existing) {
                    const done = () => {
                        if (window.google && window.google.maps && window.google.maps.places) resolve(window.google);
                        else reject(new Error('Google Maps JS non pronto'));
                    };
                    if (window.google && window.google.maps && window.google.maps.places) {
                        done();
                        return;
                    }
                    existing.addEventListener('load', done);
                    existing.addEventListener('error', () => reject(new Error('Google Maps JS non caricato')));
                    return;
                }

                const cbName = '__fmnInitGoogleMapsCb_' + Math.random().toString(36).slice(2, 10);
                window[cbName] = () => {
                    try {
                        if (window.google && window.google.maps && window.google.maps.places) resolve(window.google);
                        else reject(new Error('Google Maps JS non pronto (callback)'));
                    } finally {
                        try { delete window[cbName]; } catch { window[cbName] = undefined; }
                    }
                };

                const s = document.createElement('script');
                s.id = 'googleMapsJsFmn';
                s.async = true;
                s.defer = true;
                s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_PLACES_API_KEY)}&libraries=places&callback=${cbName}`;
                s.onerror = () => {
                    try { delete window[cbName]; } catch { window[cbName] = undefined; }
                    reject(new Error('Google Maps JS non caricato'));
                };
                document.head.appendChild(s);
            });
        }

        async function ensurePlacesService() {
            if (googlePlacesService) return googlePlacesService;
            const g = await loadGoogleMapsPlacesIfNeeded();
            if (!g || !g.maps || !g.maps.places) return null;
            const div = document.createElement('div');
            div.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;top:-9999px;';
            document.body.appendChild(div);
            const dummyMap = new g.maps.Map(div, { center: { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng }, zoom: 6 });
            googlePlacesService = new g.maps.places.PlacesService(dummyMap);
            return googlePlacesService;
        }

        function placesFindPlaceId(service, club) {
            return new Promise((resolve) => {
                const center = { lat: club.lat, lng: club.lng };
                const q = String(club.name || 'Locale').trim() || 'Locale';
                const req = {
                    query: q,
                    location: center,
                    radius: 3000
                };
                const tryFindPlace = () => {
                    if (typeof service.findPlaceFromQuery !== 'function') {
                        resolve(null);
                        return;
                    }
                    try {
                    service.findPlaceFromQuery({
                        query: q,
                        fields: ['place_id', 'name'],
                        locationBias: { center, radius: 2800 }
                    }, (res2, st2) => {
                        if (st2 === window.google.maps.places.PlacesServiceStatus.OK && res2 && res2.length) {
                            const p0 = res2[0];
                            const pid = (p0 && p0.place_id) || (p0 && p0.placeId != null ? String(p0.placeId) : null);
                            resolve(pid || null);
                            return;
                        }
                        resolve(null);
                    });
                } catch {
                    resolve(null);
                }
                };
                service.textSearch(req, (results, status) => {
                    if (status === window.google.maps.places.PlacesServiceStatus.OK && results && results.length) {
                        resolve(results[0].place_id || null);
                        return;
                    }
                    tryFindPlace();
                });
            });
        }

        function placesGetDetails(service, placeId) {
            return new Promise((resolve) => {
                service.getDetails({ placeId, fields: ['rating', 'user_ratings_total', 'types', 'reviews'] }, (place, status) => {
                    if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) {
                        resolve(null);
                        return;
                    }
                    resolve(place);
                });
            });
        }

        async function enrichClubsWithGoogleRatings(clubs) {
            const stripPending = (c, extra = {}) => ({ ...c, ratingsPending: false, ...extra });
            if (!GOOGLE_PLACES_API_KEY) {
                return clubs.map((c) => stripPending(c));
            }
            let service = null;
            try {
                service = await ensurePlacesService();
            } catch (e) {
                console.warn('PlacesService non disponibile:', e);
            }
            if (!service) {
                return clubs.map((c) => stripPending(c, {
                    starsText: c.starsText === '…' ? '—' : (c.starsText || '—'),
                    ratingText: (typeof c.ratingText === 'string' && c.ratingText.includes('aggiornamento'))
                        ? '—'
                        : (c.ratingText || '—')
                }));
            }

            const enriched = [];
            const GAP_MS = 45;

            async function enrichOneClub(club) {
                try {
                    if (club.ratingsPending === false
                        && club.starsText && club.starsText !== '—' && club.starsText !== '…'
                        && typeof club.ratingText === 'string' && !club.ratingText.includes('aggiornamento')) {
                        return stripPending(club);
                    }
                    const placeId = await placesFindPlaceId(service, club);
                    if (!placeId) {
                        return stripPending(club, { ratingText: '—', starsText: '—', source: 'OSM' });
                    }
                    const details = await placesGetDetails(service, placeId);
                    const rating = details && typeof details.rating === 'number' ? details.rating : null;
                    const total = details && typeof details.user_ratings_total === 'number' ? details.user_ratings_total : null;
                    const ratingText = (rating != null && total != null) ? `${rating.toFixed(1)} (${total})` : (rating != null ? rating.toFixed(1) : '—');
                    const starsText = (rating != null) ? starsFromRating(rating) : '—';
                    const googlePlaceTypes = (details && Array.isArray(details.types)) ? details.types.slice() : (club.googlePlaceTypes || []);
                    const googleReviews = (details && Array.isArray(details.reviews)) ? details.reviews : [];
                    return stripPending(club, { ratingText, starsText, source: 'Google', googlePlaceTypes, googleReviews });
                } catch (err) {
                    console.warn('Google rating locale:', club && club.name, err);
                    return stripPending(club, { ratingText: '—', starsText: '—' });
                }
            }

            const enrichLimit = Math.min(clubs.length, GOOGLE_ENRICH_MAX_CLUBS);
            for (let i = 0; i < clubs.length; i++) {
                const club = clubs[i];
                if (i >= GOOGLE_ENRICH_MAX_CLUBS) {
                    enriched.push(stripPending(club, { ratingText: '—', starsText: '—' }));
                    continue;
                }
                enriched.push(await enrichOneClub(club));
                if (i < enrichLimit - 1) {
                    await new Promise((r) => setTimeout(r, GAP_MS));
                }
            }

            return enriched;
        }

        async function fetchNightclubsFromGooglePlaces({ center, radiusMeters }) {
            if (!GOOGLE_PLACES_API_KEY) return null;
            let service = null;
            try {
                service = await ensurePlacesService();
            } catch (e) {
                console.warn('Google Places non disponibile:', e);
                return [];
            }
            if (!service) return [];

            const location = new window.google.maps.LatLng(center.lat, center.lng);
            const radius = Math.max(1000, Math.min(50000, radiusMeters));
            const denied = (st) => st === 'REQUEST_DENIED' || st === 'OVER_QUERY_LIMIT';
            const OK = window.google.maps.places.PlacesServiceStatus.OK;

            const runNearby = (opts) => new Promise((resolve) => {
                service.nearbySearch(opts, (res, status) => {
                    if (denied(status)) {
                        console.warn('Places nearbySearch (chiave/API):', status);
                        resolve(null);
                        return;
                    }
                    if (status !== OK || !res) {
                        resolve([]);
                        return;
                    }
                    resolve(res);
                });
            });

            const [nearbyResults, barResultsRaw] = await Promise.all([
                runNearby({
                    location,
                    radius,
                    type: 'night_club',
                    keyword: 'discoteca club'
                }),
                runNearby({
                    location,
                    radius,
                    type: 'bar'
                })
            ]);
            if (nearbyResults === null || barResultsRaw === null) {
                return [];
            }

            const mergeByPlaceId = (lists) => {
                const map = new Map();
                for (const list of lists) {
                    if (!Array.isArray(list)) continue;
                    for (const p of list) {
                        const pid = p && p.place_id;
                        if (!pid || map.has(pid)) continue;
                        map.set(pid, p);
                    }
                }
                return [...map.values()];
            };

            let pooled = mergeByPlaceId([nearbyResults, barResultsRaw]);
            let textResults = [];
            if (!pooled.length) {
                textResults = await new Promise((resolve) => {
                    service.textSearch({
                        location,
                        radius,
                        query: 'discoteca nightclub bar'
                    }, (res, status) => {
                        if (denied(status)) {
                            console.warn('Places textSearch (chiave/API):', status);
                            resolve(null);
                            return;
                        }
                        if (status !== OK || !res) {
                            console.warn('Places textSearch status:', status);
                            resolve([]);
                            return;
                        }
                        resolve(res);
                    });
                });
                if (!Array.isArray(textResults)) {
                    return [];
                }
                pooled = textResults;
            }
            if (!pooled.length) {
                return [];
            }

            const clubs = pooled
                .map((p) => {
                    const loc = p.geometry && p.geometry.location;
                    if (!loc) return null;
                    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
                    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
                    if (lat == null || lng == null) return null;

                    const rating = typeof p.rating === 'number' ? p.rating : null;
                    const total = typeof p.user_ratings_total === 'number' ? p.user_ratings_total : null;
                    const ratingText = (rating != null && total != null) ? `${rating.toFixed(1)} (${total})` : (rating != null ? rating.toFixed(1) : '—');
                    const starsText = (rating != null) ? starsFromRating(rating) : '—';
                    const gTypes = Array.isArray(p.types) ? p.types : [];
                    const isBar = (gTypes.includes('bar') || gTypes.includes('pub')) && !gTypes.includes('night_club');

                    return {
                        id: `google:${p.place_id || p.name}`,
                        name: p.name || 'Locale',
                        address: (p.vicinity || p.formatted_address || ''),
                        lat,
                        lng,
                        distanceKm: kmBetween(center, { lat, lng }),
                        ratingText,
                        starsText,
                        ratingsPending: false,
                        crowdText: '—',
                        crowdPercent: 0,
                        ageText: '—',
                        source: 'Google',
                        googlePlaceTypes: gTypes.slice(),
                        isBar
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.distanceKm - b.distanceKm)
                .slice(0, GOOGLE_PLACES_MAX_RESULTS);

            return clubs;
        }

        function addMarkerForClub(club) {
            const icon = L.divIcon({
                className: 'fmn-marker',
                html: `
                  <div class="fmn-pin">
                    <div class="fmn-pin-bubble">${escapeHtml(club.name || 'Locale')}</div>
                    <div class="fmn-pin-stem"></div>
                    <div class="fmn-pin-dot"></div>
                  </div>
                `,
                iconSize: [1, 1],
                iconAnchor: [0, 0]
            });

            const marker = L.marker([club.lat, club.lng], { icon }).addTo(leafletMap);
            marker.on('click', () => {
                if (leafletMap) leafletMap.closePopup();
                showClubDetails(club);
            });

            leafletMarkers.push(marker);
        }

        function mapCardShows(fb, key) {
            if (!fb || !fb.mapCard || typeof fb.mapCard !== 'object') return true;
            return fb.mapCard[key] !== false;
        }

        function clubStarsDisplayHtml(club) {
            if (club && club.ratingsPending) {
                return '<span class="club-stars-loader" role="status" aria-label="Caricamento valutazioni"></span>';
            }
            const raw = club && club.starsText;
            const rt = club && club.ratingText;
            const hasGoodText = typeof rt === 'string' && rt !== '—' && !rt.includes('aggiornamento');
            if (raw && raw !== '—' && raw !== '…') {
                return `${escapeHtml(String(raw))}${hasGoodText ? ` <span>${escapeHtml(rt)}</span>` : ''}`;
            }
            if (hasGoodText) {
                return `<span class="club-stars-ratingtext">${escapeHtml(rt)}</span>`;
            }
            return '<span class="club-stars-empty" aria-hidden="true">—</span>';
        }

        /** Colore sticker partner (solo hex sicuro per CSS) */
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

        function renderSidebar(clubs) {
            hideMapFetchLoading();
            const sidebar = document.querySelector('.map-sidebar');
            sidebar.innerHTML = '';

            if (!clubs.length) {
                sidebar.innerHTML = `
                  <div class="club-card active" style="cursor:default;">
                    <div class="club-card-header">
                      <div class="club-name">Nessun locale trovato</div>
                      <div class="club-stars">—</div>
                    </div>
                    <div class="club-meta">Prova a ricaricare o aumenta il raggio.</div>
                    <div class="club-tags">
                      <span class="tag tag-music">Discoteca</span>
                    </div>
                  </div>
                `;
                return;
            }

            // Locali sponsorizzati visibili per questa zona (entro il raggio configurato)
            const center = getSearchCenter();
            const nearbySponsored = sponsoredVenues.filter(sv =>
                sv.lat && sv.lng && sv.radiusKm &&
                kmBetween(center, { lat: sv.lat, lng: sv.lng }) <= sv.radiusKm
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
                  </div>
                `;

                card.addEventListener('click', () => {
                    setActiveCard(card);
                    if (leafletMap) leafletMap.setView([sv.lat, sv.lng], Math.max(14, leafletMap.getZoom()));
                    if (sv.link) window.open(sv.link, '_blank', 'noopener');
                });

                sidebar.appendChild(card);
            });

            clubs.forEach((club) => {
                const card = document.createElement('div');
                const dkm = (typeof club.distanceKm === 'number' && Number.isFinite(club.distanceKm))
                    ? club.distanceKm.toFixed(1)
                    : '—';
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
                    stickerHtmlParts.push(
                        `<span class="tag" style="border:1px solid ${col};color:${col};background:rgba(255,255,255,0.04);">${safe}</span>`
                    );
                };
                if (showMapStickers) {
                    stickersRaw.slice(0, 4).forEach((item) => {
                        if (item && typeof item === 'object' && !Array.isArray(item) && String(item.type) === 'custom') {
                            const tx = String(item.text || '').trim().slice(0, 28);
                            if (tx) addPartnerCustomSticker(tx, item.color);
                            return;
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
                        if (club.isBar) {
                            addSticker('Bar', 'tag-free');
                        } else {
                            addSticker(club.seedTipo || 'Discoteca', 'tag-music');
                        }
                        if (club.seedIngresso === 0) addSticker('Ingresso gratis', 'tag-free');
                    }
                }
                const compactClass = (!showMapAff || !showMapStickers || !showMapStars) ? ' club-card--compact' : '';
                card.className = 'club-card' + compactClass;
                const addrRaw = (club.address && String(club.address).trim()) ? String(club.address).trim() : '';
                const addrHtml = addrRaw ? escapeHtml(addrRaw) : '';
                const metaBase = addrHtml ? `${addrHtml} · ${distMeta}` : distMeta;
                const metaLine = showMapAff
                    ? `<div class="club-meta">${metaBase}</div>`
                    : `<div class="club-meta">${metaBase}${badgeHtml}</div>`;
                const tagsBlock = stickerHtmlParts.length
                    ? `<div class="club-tags">${stickerHtmlParts.join('')}</div>`
                    : '';
                const crowdBlock = showMapAff
                    ? `<div class="crowd-bar">
                    <div class="crowd-fill" style="width:${crowdPct}%"></div>
                  </div>
                  <div class="crowd-label">
                    <span>Affluenza${badgeHtml}</span>
                    ${crowdLabel}
                  </div>`
                    : '';
                card.innerHTML = `
                  <div class="club-card-header">
                    <div class="club-name">${escapeHtml(club.name || 'Locale')}</div>
                    ${showMapStars ? `<div class="club-stars">${clubStarsDisplayHtml(club)}</div>` : ''}
                  </div>
                  ${metaLine}
                  ${tagsBlock}
                  ${crowdBlock}
                `;

                card.addEventListener('click', () => {
                    setActiveCard(card);
                    leafletMap.setView([club.lat, club.lng], Math.max(14, leafletMap.getZoom()));
                    showClubDetails(club);
                });

                sidebar.appendChild(card);
            });
        }

        function initMap() {
            const mapEl = document.getElementById('leafletMap');
            if (!mapEl) return;

            leafletMap = L.map(mapEl, {
                zoomControl: true,
                preferCanvas: true
            }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 6);

            // Tile scure per mantenere lo stile del sito
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap &copy; CARTO',
                maxZoom: 19
            }).addTo(leafletMap);

            // Marker posizione utente (se permessa)
            // preferGpsAsSearchCenter=true (tap “Usa la posizione attuale” o avvio dopo consenso): forza GPS come centro ricerca e stessa precisione del pulsante.
            // false: se hai già scelto un luogo con la ricerca, non sovrascrivere (solo aggiorna marker se useGpsAsCenter è false).
            function requestUserLocation(preferGpsAsSearchCenter = false) {
                if (!('geolocation' in navigator)) return;

                // Geolocation richiede HTTPS o localhost: se apri il file con doppio click (file://) spesso fallisce.
                if (!window.isSecureContext) {
                    // Non blocchiamo: il sito resta usabile con la vista predefinita.
                    console.warn('Geolocation richiede HTTPS/localhost (secure context).');
                    return;
                }

                navigator.geolocation.getCurrentPosition((pos) => {
                    const prevLocForReload = userLocation;
                    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    userLocation = here;
                    discoveryCenter = null;
                    discoveryRetryCount = 0;
                    gpsRetryCount = 0;
                    saveLastLocation(here);

                    if (userLocationMarker) {
                        userLocationMarker.remove();
                        userLocationMarker = null;
                    }
                    userLocationMarker = L.circleMarker([here.lat, here.lng], {
                        radius: 6,
                        weight: 2,
                        color: '#22d3ee',
                        fillColor: '#06b6d4',
                        fillOpacity: 0.85
                    }).addTo(leafletMap).bindPopup('Sei qui');

                    userLocationMarker.on('click', () => openInMapsChooser(here.lat, here.lng, 'La tua posizione'));

                    // Aggiorna la vista mappa senza scrollare la pagina (evita di “tirare su” l’utente dalle altre sezioni).
                    if (!manualCenter && leafletMap) {
                        leafletMap.flyTo([here.lat, here.lng], 13, { duration: 0.75, easeLinearity: 0.25 });
                    }

                    const useGpsAsCenter = preferGpsAsSearchCenter || !manualCenter;
                    if (!useGpsAsCenter) {
                        return;
                    }

                    manualCenter = null;
                    if (tempSearchMarker) {
                        tempSearchMarker.remove();
                        tempSearchMarker = null;
                    }

                    const skipClubReload = Boolean(
                        prevLocForReload
                        && !preferGpsAsSearchCenter
                        && kmBetween(prevLocForReload, here) < 0.12
                    );
                    if (!skipClubReload) {
                        loadClubs();
                    }
                }, (err) => {
                    console.warn('Geolocation non disponibile:', err && err.message ? err.message : err);
                    loadClubs();
                }, preferGpsAsSearchCenter
                    ? { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
                    : { enableHighAccuracy: false, timeout: 7000, maximumAge: 180000 });
            }

            // Stesso comportamento del pulsante “Usa la posizione attuale” (anche subito dopo il consenso al prompt).
            window.__requestUserLocationAuto = () => requestUserLocation(true);
            // “Usa la posizione attuale”: forza il centro ricerca sul GPS (mostra prompt se necessario)
            window.__requestUserLocation = () => requestUserLocation(true);

            requestSyncClubDetailPopupDock();
        }

        /** OSM elements → stessi oggetti “club” della mappa (anche da cache prefetch locali / fmn_loc_*). */
        function mapOsmElementsToClubs(elements, center) {
            const elementsFiltered = (elements || []).filter((el) => !isOsmVenueLikelyClosed(el.tags || {}));
            return elementsFiltered.map((el) => {
                const tags = el.tags || {};
                const lat = el.lat ?? el.center?.lat;
                const lng = el.lon ?? el.center?.lon;
                if (lat == null || lng == null) return null;
                const name = osmVenueDisplayName(tags);
                const address = osmVenueAddressFromTags(tags);
                const ratingText = '—';
                const crowdText = '—';
                const crowdPercent = 0;
                const ageText = '—';
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
                    ratingText,
                    starsText: '—',
                    crowdText,
                    crowdPercent,
                    ageText,
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

        async function fetchNightclubsFromOverpass({ endpoint, center, radiusMeters }) {
            // Solo filtri su tag esatti: le regex su name in grandi raggi mandano in timeout / 400 gli Overpass pubblici.
            if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
                throw new Error('Coordinate di ricerca non valide');
            }
            const lat = Number(center.lat);
            const lng = Number(center.lng);
            const r = Math.max(1000, Math.min(100000, Math.round(radiusMeters)));
            const query = `
              [out:json][timeout:22];
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
                node["amenity"="bar"]["name"](around:${r},${lat},${lng});
                way["amenity"="bar"]["name"](around:${r},${lat},${lng});
                relation["amenity"="bar"]["name"](around:${r},${lat},${lng});
              );
              out center tags;
            `.replace(/\s+/g, ' ').trim();

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 24000);
            let res;
            try {
                res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                    body: new URLSearchParams({ data: query }),
                    signal: controller.signal
                });
            } catch (e) {
                // "Failed to fetch" di solito è rete/CORS/estensione/adblock/endpoint giù
                throw new Error(`Failed to fetch (${endpoint})`);
            } finally {
                clearTimeout(timeout);
            }

            if (!res.ok) {
                let details = '';
                try {
                    const text = await res.text();
                    details = text ? ` — ${text.slice(0, 180).replace(/\s+/g, ' ')}` : '';
                } catch {
                    // ignore
                }
                throw new Error(`Overpass HTTP ${res.status} (${endpoint})${details}`);
            }
            const json = await res.json();
            return mapOsmElementsToClubs(json.elements || [], center);
        }

        // Locali noti spesso assenti o mal geocodificati su OSM — coordinate di riserva + query Nominatim.
        // Indirizzi verificati su directory / siti del locale; coordinate da geocoding OSM Nominatim (via/strada).
        const SEED_VENUES = [
            {
                id: 'life-club-rovetta',
                name: 'Life Club Rovetta',
                query: 'Life Club Via Vogno Rovetta',
                lat: 45.8741,
                lng: 9.9717,
                address: 'Via Vogno 7, 24020 Rovetta (BG)'
            },
            {
                id: 'bar-da-spicchio-clusone',
                name: 'Bar Da Spicchio',
                query: 'Bar Spicchio Via Nuova 12 Rovetta',
                lat: 45.8917564,
                lng: 9.9853276,
                address: 'Via Nuova 12, 24020 Rovetta (BG)',
                tipo: 'Locale',
                ingresso: 0
            },
            {
                id: 'piccolo-bar-clusone',
                name: 'Piccolo Bar',
                query: 'Piccolo Bar Via Sales 2 Clusone',
                lat: 45.8831737,
                lng: 9.9343768,
                address: 'Via Sales 2, 24023 Clusone (BG)',
                tipo: 'Locale',
                ingresso: 0
            },
            {
                id: 'piccolo-bar-2-clusone',
                name: 'Piccolo Bar 2.0',
                query: 'Piccolo Bar 2.0 Via Luigi Carrara 1 Clusone',
                lat: 45.8877922,
                lng: 9.9329784,
                address: 'Via Luigi Carrara 1, 24023 Clusone (BG)',
                tipo: 'Locale',
                ingresso: 0
            }
        ];

        /** Esclude da OSM luoghi marcati come chiusi/dismessi (es. Estasi abandoned=yes). */
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

        /**
         * Prefetch per locali.html: stessa chiave/cache di locali (fmn_loc_overpass_*), query Overpass allineata a locali.html.
         * Dopo il caricamento mappa con GPS o luogo cercato, in idle scarichiamo i risultati a 28 km così Locali non riparte da zero.
         */
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
                if (Date.now() - cached.ts > OVERPASS_CACHE_TTL_MS) {
                    localStorage.removeItem(key);
                    return null;
                }
                return cached.data;
            } catch {
                return null;
            }
        }

        function setLocaliPageOverpassCache(center, radiusMeters, data) {
            try {
                localStorage.setItem(
                    localiPageOverpassCacheKey(center, radiusMeters),
                    JSON.stringify({ ts: Date.now(), data })
                );
            } catch {
                /* quota */
            }
        }

        async function fetchLocaliStyleOverpassElements(endpoint, center, radiusMeters) {
            if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
                throw new Error('Coordinate non valide');
            }
            const lat = Number(center.lat);
            const lng = Number(center.lng);
            const r = Math.max(1000, Math.min(50000, Math.round(radiusMeters)));
            const query = `
              [out:json][timeout:25];
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
                node["amenity"="bar"]["name"](around:${r},${lat},${lng});
                way["amenity"="bar"]["name"](around:${r},${lat},${lng});
                relation["amenity"="bar"]["name"](around:${r},${lat},${lng});
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
            } finally {
                clearTimeout(timeout);
            }
            if (!res.ok) {
                throw new Error(`Overpass HTTP ${res.status}`);
            }
            const json = await res.json();
            return (json.elements || []).filter((el) => !isOsmVenueLikelyClosed(el.tags || {}));
        }

        async function prefetchLocaliOverpassForCenter(center) {
            if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
            const r = LOCALI_PREFETCH_RADIUS_M;
            if (getLocaliPageOverpassCache(center, r)) return;

            for (const ep of OVERPASS_ENDPOINTS) {
                try {
                    const els = await fetchLocaliStyleOverpassElements(ep, center, r);
                    if (Array.isArray(els) && els.length) {
                        setLocaliPageOverpassCache(center, r, els);
                        return;
                    }
                } catch {
                    /* prova endpoint successivo */
                }
            }
        }

        function scheduleLocaliOverpassPrefetch(center) {
            const run = () => {
                prefetchLocaliOverpassForCenter(center).catch(() => { });
            };
            setTimeout(run, 180);
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(run, { timeout: 3500 });
            }
        }

        function fetchSeedPlacesWithinRadius(center, radiusKm) {
            const results = [];
            const seedMaxKm = Math.max(radiusKm, 48);
            for (const seed of SEED_VENUES) {
                const d = kmBetween(center, { lat: seed.lat, lng: seed.lng });
                if (d > seedMaxKm) continue;
                results.push({
                    id: `seed:${seed.id}`,
                    name: seed.name,
                    address: seed.address || '',
                    lat: seed.lat,
                    lng: seed.lng,
                    distanceKm: d,
                    ratingText: '—',
                    starsText: '—',
                    crowdText: 'Non impostata',
                    crowdPercent: null,
                    ageText: '—',
                    source: 'Seed',
                    osmAmenity: seed.tipo ? '' : 'nightclub',
                    osmClub: '',
                    seedTipo: seed.tipo || null,
                    seedIngresso: seed.ingresso ?? null
                });
            }
            return results;
        }

        async function loadClubs() {
            const sidebar = document.querySelector('.map-sidebar');
            const hasActive = Boolean(getSearchCenter() && (manualCenter || userLocation));
            const mobileMap = isMapSidebarMobileLayout();

            if (sidebar) {
                if (mobileMap) {
                    sidebar.innerHTML = `
                        <div class="map-sidebar-load-placeholder" aria-hidden="true">
                            <span class="map-sidebar-load-dot"></span>
                            <span class="map-sidebar-load-dot"></span>
                            <span class="map-sidebar-load-dot"></span>
                        </div>`;
                    showMapFetchLoading(hasActive);
                } else {
                    hideMapFetchLoading();
                    sidebar.innerHTML = `
                  <div class="club-card active" style="cursor:default;text-align:center;">
                    <div class="club-name" style="font-size:0.85rem;">Caricamento locali…</div>
                    <div style="margin:0.8rem 0;">
                      <div style="width:28px;height:28px;border:3px solid rgba(168,85,247,0.2);border-top-color:#a855f7;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto;"></div>
                    </div>
                    <div class="club-meta">${hasActive ? 'Cerco i locali più vicini a te' : 'Ti mostro locali casuali in Italia'}</div>
                  </div>
                `;
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
                let clubs = null;
                let lastErr = null;
                const radiusMeters = Math.max(1000, Math.min(100000, Math.round(currentRadiusKm * 1000)));
                const centerPrimary = getSearchCenter();
                const listRef = getVenueListReferenceCenter();

                clubs = await fetchClubsOverpassAnyEndpoint(centerPrimary, radiusMeters);

                // Merge immediato dei seed locali (sincrono, zero latenza)
                if (clubs && clubs.length) {
                    const seed = fetchSeedPlacesWithinRadius(listRef, currentRadiusKm);
                    for (const s of seed) {
                        const exists = clubs.some(c => (normalizeText(c.name) === normalizeText(s.name)) || (kmBetween({ lat: c.lat, lng: c.lng }, { lat: s.lat, lng: s.lng }) < 0.15));
                        if (!exists) clubs.push(s);
                    }
                    clubs = recomputeClubDistancesFrom(clubs, listRef)
                        .sort((a, b) => a.distanceKm - b.distanceKm)
                        .slice(0, MAP_MAX_VENUES_SHOWN);

                    // Unisce i locali intorno al GPS (stesso flusso di prima) ma in await così la lista finale
                    // coincide con quella passata a enrich — evita race che faceva sparire rating o merge.
                    const dPlaceGpsMerge = (manualCenter && userLocation) ? kmBetween(manualCenter, userLocation) : 0;
                    if (manualCenter && userLocation
                        && dPlaceGpsMerge > SAME_AREA_GPS_VS_PLACE_KM
                        && dPlaceGpsMerge < MERGE_GPS_SECOND_QUERY_MAX_KM) {
                        try {
                            const nearMe = await fetchClubsOverpassAnyEndpoint(userLocation, radiusMeters);
                            if (nearMe && nearMe.length) {
                                const merged = mergeClubListsById(clubs, nearMe);
                                clubs = recomputeClubDistancesFrom(merged, listRef)
                                    .sort((a, b) => a.distanceKm - b.distanceKm)
                                    .slice(0, MAP_MAX_VENUES_SHOWN);
                            }
                        } catch (e) {
                            /* merge facoltativo: ignora */
                        }
                    }
                }

                // Se Overpass ha risposto, mostriamo subito i risultati
                if (clubs && clubs.length) {
                    const wantsAutoRatings = Boolean(GOOGLE_PLACES_API_KEY);
                    clubsData = clubs.map((c) => (wantsAutoRatings ? {
                        ...c,
                        ratingsPending: true,
                        ratingText: 'Recensioni in aggiornamento…',
                        starsText: '…',
                        source: c.source || 'OSM'
                    } : {
                        ...c,
                        ratingsPending: false,
                        ratingText: c.ratingText != null ? c.ratingText : '—',
                        starsText: c.starsText != null ? c.starsText : '—'
                    }));
                    enrichClubsWithFirebase(clubsData);
                    renderMarkers(clubsData);
                    renderSidebar(clubsData);
                    loadAndRenderUserReviews();
                    loadAndRenderGoogleReviews();

                    // In background: arricchisci con rating Google (sequenziale: PlacesService non regge bene il parallelismo)
                    if (wantsAutoRatings) {
                        enrichClubsWithGoogleRatings(clubsData)
                            .then((enriched) => {
                                clubsData = enriched;
                                enrichClubsWithFirebase(clubsData);
                                renderMarkers(clubsData);
                                renderSidebar(clubsData);
                                loadAndRenderUserReviews();
                                loadAndRenderGoogleReviews();
                            })
                            .catch((err) => {
                                console.warn('Arricchimento Google sulle card:', err);
                                clubsData = clubsData.map((c) => ({
                                    ...c,
                                    ratingsPending: false,
                                    ratingText: (typeof c.ratingText === 'string' && c.ratingText.includes('aggiornamento'))
                                        ? '—'
                                        : (c.ratingText || '—'),
                                    starsText: (c.starsText === '…' || c.starsText == null) ? '—' : c.starsText
                                }));
                                enrichClubsWithFirebase(clubsData);
                                renderMarkers(clubsData);
                                renderSidebar(clubsData);
                                loadAndRenderUserReviews();
                                loadAndRenderGoogleReviews();
                            });
                    }
                } else {
                    // Overpass vuoto: fallback Google Places (bloccante)
                    try {
                        const googleClubs = await fetchNightclubsFromGooglePlaces({ center: listRef, radiusMeters });
                        if (googleClubs && googleClubs.length) clubs = googleClubs;
                    } catch (e) {
                        lastErr = e;
                    }
                    if (!clubs || !clubs.length) {
                        if (isGpsMode && gpsRetryCount < 2) {
                            gpsRetryCount++;
                            // Allarga automaticamente il raggio: in molte zone OSM è “scarso” per nightlife nel raggio piccolo
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
                        throw lastErr || new Error('Nessun locale trovato in quest\'area (prova a ingrandire il raggio).');
                    }
                    clubsData = clubs;
                    enrichClubsWithFirebase(clubsData);
                    renderMarkers(clubsData);
                    renderSidebar(clubsData);
                    loadAndRenderUserReviews();
                    loadAndRenderGoogleReviews();
                }

                const prefetchCenter = userLocation || manualCenter;
                if (!isDiscoveryMode && prefetchCenter && clubsData && clubsData.length) {
                    scheduleLocaliOverpassPrefetch(prefetchCenter);
                }
            } catch (err) {
                hideMapFetchLoading();
                const sidebar = document.querySelector('.map-sidebar');
                sidebar.innerHTML = `
                  <div class="club-card active" style="cursor:default;">
                    <div class="club-card-header">
                      <div class="club-name">Mappa non disponibile per un attimo</div>
                      <div class="club-stars">—</div>
                    </div>
                    <div class="club-meta">Controlla la connessione e aggiorna la pagina. Se sei su rete instabile, i server dei dati mappa a volte rispondono in ritardo.</div>
                    <div class="club-tags">
                      <span class="tag tag-hot">Riprova</span>
                    </div>
                  </div>
                `;
            }
        }

        // Avvio (lazy map)
        function __fmnStartApp() {
            wireMapsChooserModal();
            initMap();
            (async () => {
                // HTTPS: chiedi subito la posizione (compare il prompt se il browser non ha ancora scelto).
                // Stessa logica del pulsante “Usa la posizione attuale” così, dopo il consenso, centro e ricerca coincidono con quel flusso.
                // Se è "prompt", nel frattempo carichiamo anche esempi Italia così la mappa non resta vuota mentre l’utente decide.
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
                        } catch {
                            /* Safari / permessi: proseguiamo senza alreadyGranted */
                        }
                        if (!geoDenied && alreadyGranted) {
                            const warm = peekLastLocationForWarmStart();
                            if (warm && !manualCenter) {
                                userLocation = warm;
                                discoveryCenter = null;
                                currentRadiusKm = Math.max(currentRadiusKm, 18);
                                loadClubs();
                            }
                            window.__requestUserLocationAuto();
                            return;
                        }
                        if (!geoDenied) {
                            window.__requestUserLocationAuto();
                        }
                    }
                } catch {
                    /* ignore */
                }

                if (!manualCenter && !userLocation) {
                    discoveryCenter = pickDiscoveryCenter();
                    if (leafletMap && discoveryCenter) {
                        leafletMap.setView([discoveryCenter.lat, discoveryCenter.lng], 11);
                    }
                    currentRadiusKm = Math.max(currentRadiusKm, 18);
                } else {
                    currentRadiusKm = Math.max(currentRadiusKm, 18);
                }
                loadClubs();
            })();
            loadFirebaseVenues(); // avvia listener real-time Firestore
            // Le recensioni community non dipendono dalla mappa: caricale subito.
            loadAndRenderUserReviews();
        }

        (function __fmnLazyInitMap() {
            const mapSection = document.getElementById('map');
            if (!mapSection || typeof IntersectionObserver === 'undefined') {
                __fmnStartApp();
                return;
            }
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

        // Ricerca: mentre scrivi filtra i locali; con INVIO cerca anche un indirizzo/luogo in Italia.
        const searchInput = document.getElementById('mapSearchInput');
        const radiusRange = document.getElementById('radiusKmRange');
        const radiusPill = document.getElementById('radiusKmPill');
        const useCurrentLocationBtn = document.getElementById('mapUseCurrentLocationBtn');
        const searchClear = document.getElementById('mapSearchClear');
        if (searchInput) {
            const onType = debounce(() => applySearchFilter(searchInput.value), 120);
            searchInput.addEventListener('input', onType);
            searchInput.addEventListener('keydown', async (e) => {
                if (e.key !== 'Enter') return;
                const q = (searchInput.value || '').trim();
                if (!q) return;

                // Geocoding: cerca prima la città/luogo, poi i locali caricati
                try {
                    const place = await geocodeItaly(q);
                    if (place) {
                        if (leafletMap) {
                            leafletMap.flyTo([place.lat, place.lng], 13, { duration: 0.65, easeLinearity: 0.25 });
                        }
                        setTempSearchMarker(place.lat, place.lng, place.label);
                        manualCenter = { lat: place.lat, lng: place.lng };
                        persistMapFocusForLocali({
                            type: 'place',
                            lat: place.lat,
                            lng: place.lng,
                            label: place.label || q
                        });
                        loadClubs();
                        return;
                    }
                } catch {
                    // geocoding fallito, proviamo match per nome locale
                }

                // Fallback: se il geocoding non trova nulla, cerca tra i locali caricati
                const qn = normalizeText(q);
                const byName = clubsData.filter(c => normalizeText(c.name).includes(qn));
                if (byName.length) {
                    const club = byName[0];
                    leafletMap.setView([club.lat, club.lng], 15);
                    showClubDetails(club);
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
                manualCenter = null;
                if (tempSearchMarker) {
                    tempSearchMarker.remove();
                    tempSearchMarker = null;
                }
                if (leafletMap) {
                    if (userLocation) {
                        leafletMap.setView([userLocation.lat, userLocation.lng], 13);
                        persistMapFocusForLocali({
                            type: 'gps',
                            lat: userLocation.lat,
                            lng: userLocation.lng,
                            label: 'La tua posizione'
                        });
                    } else {
                        try {
                            localStorage.removeItem(FMN_MAP_FOCUS_KEY);
                        } catch { /* ignore */ }
                        leafletMap.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13);
                    }
                }
                loadClubs();
            });
        }

        function triggerMapUserLocation() {
            if (typeof window.__requestUserLocation === 'function') window.__requestUserLocation();
        }

        if (useCurrentLocationBtn) {
            useCurrentLocationBtn.addEventListener('click', triggerMapUserLocation);
        }

        // Bottone "Apri su Maps" nel popup: scelta Apple/Google
        const directionsBtn = document.getElementById('popupDirections');
        if (directionsBtn) {
            directionsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const lat = Number(directionsBtn.dataset.lat);
                const lng = Number(directionsBtn.dataset.lng);
                const name = directionsBtn.dataset.name || 'Destinazione';
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                openInMapsChooser(lat, lng, name);
            });
        }

        const popupDiscoClose = document.getElementById('popupDiscoClose');
        if (popupDiscoClose) {
            popupDiscoClose.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                hideClubDetailsPopup();
            });
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // SEZIONE NOTE (INFO AGGIUNTIVE, NON CODICE) — come mi hai chiesto
        // ─────────────────────────────────────────────────────────────────────────────
        /*
          ✅ MEDIA RECENSIONI “REALE” (come farla davvero)
          - Le stelle che vedi qui sono "—" perché OpenStreetMap NON offre un rating verificato come Google.
          - Per avere una media reale servono fonti ufficiali con API, ad esempio:
            1) Google Places API (richiede API key + billing). Flusso tipico:
               - Text Search per trovare il place_id (nome + coordinate)
               - Place Details per leggere rating e user_ratings_total
               - Mostrare “4.3 (1284)” e calcolare medie in modo trasparente (es. media pesata).
            2) TripAdvisor / TheFork / altre piattaforme: spesso NON consentono uso libero dei rating via API.
          - Importante: evitare scraping (rischio legale + blocchi).

          ✅ RECENSIONI AUTOMATICHE (come funziona qui)
          - Ho aggiunto la logica per caricare automaticamente rating e numero recensioni da Google Places.
          - Per attivarla:
            - Imposta la chiave Google Places via fmn-secrets.local.js o inject prima di fmn-secrets.defaults.js (vedi fmn-secrets.example.js).
            - Se dal browser hai problemi di CORS, sposta la chiamata su backend e fai caching.
          - Senza chiave, il sito resta funzionante ma i rating rimangono "—".

          ✅ PERCHÉ LA “API” DI GOOGLE AI STUDIO NON FUNZIONA QUI
          - Google AI Studio crea chiavi per le API Gemini (AI), NON per Google Maps/Places.
          - Le recensioni/ratings dei luoghi arrivano da Google Maps Platform (Places API) tramite Google Cloud Console:
            - crea un progetto su Google Cloud
            - abilita Places API (o Places API (New) / Places)
            - abilita billing
            - genera una API key “Maps Platform”
          - Anche con la key corretta, dal browser potresti avere CORS: in produzione si fa da backend.

          ✅ COME POTRESTI ORGANIZZARE MEGLIO IL SITO (pagine/funzionalità)
          - Pagina “Locali” con filtri: genere musicale, budget, distanza, dress code, fascia età, parcheggio/navetta.
          - Pagina “Scheda locale” (URL dedicato): foto, eventi, lineup DJ, prezzi, recensioni, come arrivare, contatti.
          - Calendario eventi (venerdì/sabato/festivi) + notifiche “stasera in trend”.
          - “Gruppi serata”: crea gruppo, invita amici, split taxi, lista invitati.
          - “Partner/Owner dashboard”: gestione eventi, offerte, capienza, analytics, promo code.
          - “FAQ & Sicurezza”: linee guida, taxi/ride sharing, numeri utili, policy ingresso.

          ✅ AFFLUENZA (come capirla in modo realistico)
          - Check-in in-app + geofencing: conteggio anonimo di persone “dentro” un’area del locale.
          - Ingressi reali dal locale: integrazione con contapersone (turnstile / clicker) o dati biglietteria.
          - Prenotazioni tavoli/lista: proxy della domanda (non è sempre la presenza).
          - Wi‑Fi/Bluetooth counting: possibile ma molto delicato (privacy/GDPR) → serve anonimizzazione + consulenza legale.
          - Modello ibrido: (ingressi) + (check-in) + (storico stesso giorno meteo/eventi) → stima più accurata.

          ✅ ETÀ MEDIA (come stimarla)
          - Dato dichiarato (profilo utente, fascia d’età) aggregato e anonimizzato → “18–21 / 22–25 / 26–30 / 30+”.
          - Dato dal locale: età all’ingresso (se già controllata) SOLO in forma aggregata, senza salvare documenti.
          - Sondaggi post-serata (opt-in): “età + vibe + qualità musica”.
          - Nota: evitare riconoscimento facciale/analisi video per l’età (alto rischio privacy/legale).
        */

        // ─────────────────────────────────────────────────────────────────────────────
        // Menu mobile (hamburger)
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
            list.querySelectorAll('a').forEach((a) => {
                a.addEventListener('click', () => setNavOpen(false));
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && nav.classList.contains('nav-open')) setNavOpen(false);
            });
        })();

        
