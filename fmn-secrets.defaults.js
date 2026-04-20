/**
 * Valori sicuri di default (nessuna chiave nel repository).
 * Per Google Places in locale/produzione: aggiungi PRIMA di questo file uno script che imposta
 * window.FMN_GOOGLE_PLACES_API_KEY, oppure crea fmn-secrets.local.js da fmn-secrets.example.js
 * e inserisci in HTML <script src="fmn-secrets.local.js"></script> prima di fmn-secrets.defaults.js.
 */
(function () {
    if (typeof window === 'undefined') return;
    if (typeof window.FMN_GOOGLE_PLACES_API_KEY !== 'string') window.FMN_GOOGLE_PLACES_API_KEY = 'AIzaSyB2bF5bfueMy2Sl7YkLFGF0_OPptktLZTM';
    if (!Array.isArray(window.FMN_ADMIN_EMAILS)) window.FMN_ADMIN_EMAILS = [];
})();
