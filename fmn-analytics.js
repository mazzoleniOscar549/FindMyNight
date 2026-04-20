/**
 * Google Analytics 4 — caricamento solo se l’utente ha scelto "Accetto anche le statistiche"
 * (localStorage fmn_analytics_consent === 'yes'). ID = measurementId Firebase (G-4B41LWXFR3).
 *
 * Ordine come snippet Google: dataLayer + gtag() prima, poi script gtag/js, poi config.
 */
(function () {
    var GA_MEASUREMENT_ID = 'G-4B41LWXFR3';

    /**
     * Chi aveva solo il vecchio banner ("OK") ha fmn_cookie_consent senza fmn_analytics_consent:
     * mostra di nuovo il banner (rimuoviamo solo la chiave cookie) così può scegliere le statistiche.
     * Chi ha già fmn_analytics_consent = 'no' ha scelto in modo esplicito: non tocchiamo.
     */
    function migrateLegacyConsent() {
        try {
            if (localStorage.getItem('fmn_cookie_consent') === 'accepted'
                && localStorage.getItem('fmn_analytics_consent') === null) {
                localStorage.removeItem('fmn_cookie_consent');
            }
        } catch (e) { /* ignore */ }
    }

    function loadGoogleAnalytics() {
        if (window.__fmnGtagLoaded) return;
        window.__fmnGtagLoaded = true;

        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = gtag;

        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
        document.head.appendChild(script);

        gtag('js', new Date());
        gtag('config', GA_MEASUREMENT_ID, { send_page_view: true });
    }

    migrateLegacyConsent();

    try {
        if (localStorage.getItem('fmn_analytics_consent') === 'yes') {
            loadGoogleAnalytics();
        }
    } catch (e) { /* ignore */ }

    window.fmnLoadGoogleAnalytics = loadGoogleAnalytics;
})();
