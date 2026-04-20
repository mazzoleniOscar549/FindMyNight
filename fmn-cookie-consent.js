/**
 * Banner cookie FindMyNight: "Solo necessari" vs "Accetto anche le statistiche" (Google Analytics).
 * Richiede nel DOM #cookieBanner, #cookieEssentialBtn, #cookieStatsBtn.
 */
(function () {
    var KEY_COOKIE = 'fmn_cookie_consent';
    var KEY_STATS = 'fmn_analytics_consent';

    function hideBanner(banner) {
        if (banner) banner.classList.remove('visible');
    }

    function persistAndMaybeLoadGa(allowStats) {
        try {
            localStorage.setItem(KEY_COOKIE, 'accepted');
            localStorage.setItem(KEY_STATS, allowStats ? 'yes' : 'no');
        } catch (e) { /* ignore */ }
        if (allowStats && typeof window.fmnLoadGoogleAnalytics === 'function') {
            window.fmnLoadGoogleAnalytics();
        }
    }

    function init() {
        var banner = document.getElementById('cookieBanner');
        if (!banner) return;

        try {
            if (localStorage.getItem(KEY_COOKIE)) return;
        } catch (e) {
            return;
        }

        banner.classList.add('visible');

        var btnEss = document.getElementById('cookieEssentialBtn');
        var btnStats = document.getElementById('cookieStatsBtn');
        var legacy = document.getElementById('cookieAcceptBtn');

        if (btnEss && btnStats) {
            btnEss.addEventListener('click', function () {
                persistAndMaybeLoadGa(false);
                hideBanner(banner);
            });
            btnStats.addEventListener('click', function () {
                persistAndMaybeLoadGa(true);
                hideBanner(banner);
            });
        } else if (legacy) {
            legacy.addEventListener('click', function () {
                persistAndMaybeLoadGa(false);
                hideBanner(banner);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
