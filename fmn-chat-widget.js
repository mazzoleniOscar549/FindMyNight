/**
 * FindMyNight — widget assistenza FAQ (iniettato su tutte le pagine).
 * Classi/id prefissati fmn-faq- per non collidere con chat.html (#chatMessages, ecc.).
 */
(function () {
    if (document.getElementById('fmnFaqWidget')) return;

    var CONTACT_PAGE = 'contatti.html';
    var CONTACT_EMAIL = 'findmynight.it@gmail.com';

    var root = document.createElement('div');
    root.innerHTML =
        '<div class="fmn-faq-widget" id="fmnFaqWidget" aria-live="polite">' +
            '<div class="fmn-faq-panel" id="fmnFaqPanel" role="dialog" aria-label="Assistenza FindMyNight">' +
                '<div class="fmn-faq-head">' +
                    '<div>' +
                        '<div class="fmn-faq-head-title">' +
                            '<strong>Assistenza FindMyNight</strong>' +
                            '<span class="fmn-faq-head-badge">Automatico</span>' +
                        '</div>' +
                        '<span class="fmn-faq-head-desc">Risposte generate in pagina. Comunicazioni ufficiali: ' +
                        '<a href="' + CONTACT_PAGE + '">modulo contatti</a>.</span>' +
                    '</div>' +
                    '<button type="button" class="fmn-faq-close" id="fmnFaqClose" aria-label="Chiudi chat">×</button>' +
                '</div>' +
                '<div class="fmn-faq-messages" id="fmnFaqMessages"></div>' +
                '<div class="fmn-faq-quick" id="fmnFaqQuick"></div>' +
                '<div class="fmn-faq-input-row">' +
                    '<input type="text" id="fmnFaqInput" maxlength="500" placeholder="Chiedi informazioni su FindMyNight…" autocomplete="off" />' +
                    '<button type="button" class="fmn-faq-send" id="fmnFaqSend">Invia</button>' +
                '</div>' +
            '</div>' +
            '<button type="button" class="fmn-faq-toggle" id="fmnFaqToggle" aria-expanded="false" aria-controls="fmnFaqPanel" title="Apri assistenza">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
                '</svg>' +
            '</button>' +
        '</div>';
    document.body.appendChild(root.firstElementChild);

    var widget = document.getElementById('fmnFaqWidget');
    var toggle = document.getElementById('fmnFaqToggle');
    var closeBtn = document.getElementById('fmnFaqClose');
    var box = document.getElementById('fmnFaqMessages');
    var input = document.getElementById('fmnFaqInput');
    var sendBtn = document.getElementById('fmnFaqSend');
    var quick = document.getElementById('fmnFaqQuick');
    if (!widget || !toggle || !box || !quick) return;

    /** Spazio extra in basso quando il banner cookie è visibile (stesso id su tutte le pagine). */
    function syncFaqBottomExtra() {
        var banner = document.getElementById('cookieBanner');
        var extra = 0;
        if (banner && banner.classList.contains('visible')) {
            var h = banner.getBoundingClientRect().height;
            if (h > 0) extra = Math.ceil(h) + 14;
        }
        document.documentElement.style.setProperty('--fmn-faq-bottom-extra', extra + 'px');
    }

    syncFaqBottomExtra();
    if (typeof MutationObserver !== 'undefined') {
        var cookieEl = document.getElementById('cookieBanner');
        if (cookieEl) {
            new MutationObserver(syncFaqBottomExtra).observe(cookieEl, {
                attributes: true,
                attributeFilter: ['class']
            });
        }
    }
    window.addEventListener('resize', syncFaqBottomExtra, { passive: true });

    var CHIPS = [
        { t: 'Come funziona', q: 'come funziona' },
        { t: 'App e tempistiche', q: 'app quando disponibile' },
        { t: 'Area Partner', q: 'partner' },
        { t: 'Registrare un locale', q: 'locale' },
        { t: 'Privacy', q: 'privacy' },
        { t: 'Scrivere via email', q: 'email' }
    ];

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function mailtoHref() {
        return 'mailto:' + CONTACT_EMAIL;
    }

    function wantsAppOrTiming(q) {
        if (/di\s+appena|appena\s+possibl|il\s+prima\s+possibl|asap/i.test(q) && /(\bapp\b|applicazione|mobile|findmynight)/i.test(q)) return true;
        var timing = /(tra\s+quanto|quando\s+(esce|sarà|usc)|uscita|disponib|scaric|download|play\s*store|app\s*store|subito|presto)/i.test(q);
        var appish = /(\bapp\b|applicazione|mobile|findmynight)/i.test(q);
        if (timing && appish) return true;
        if (/\bapp\b/i.test(q) && /(quando|disponibil|tra\s+quanto|uscir|uscita|presto|subito|download|store)/i.test(q)) return true;
        if (/(tra\s+quanto|quando).*(disponibil|usc)/i.test(q) && appish) return true;
        return false;
    }

    function replyFor(text) {
        var q = String(text || '').toLowerCase().trim();
        if (!q) {
            return 'Inserisci una domanda nel campo sottostante oppure seleziona una delle scorciatoie suggerite.';
        }

        if (wantsAppOrTiming(q)) {
            return 'Al momento FindMyNight è pensato come <strong>sito web</strong> (mappa, locali, partner). Eventuali app native per iOS/Android sono in valutazione: non è possibile indicare una data certa. Resta aggiornato sui canali ufficiali oppure scrivi tramite <a href="' + CONTACT_PAGE + '">modulo contatti</a> o <a href="' + mailtoHref() + '">' + escapeHtml(CONTACT_EMAIL) + '</a> per urgenze o proposte.';
        }

        if (/come\s+funziona|cosa\s+è\s+findmynight|che\s+cos|come\s+usare\s+findmynight/i.test(q)) {
            return 'FindMyNight ti aiuta a <strong>scoprire locali notturni partner</strong>: sulla <a href="index.html#map">home</a> trovi la mappa; in <a href="locali.html">locali.html</a> l’elenco con filtri. I gestori aggiornano affluenza ed eventi dall’<a href="partner.html">Area Partner</a>. Le <a href="recensioni.html">recensioni</a> sono pubbliche (una per locale per dispositivo). Per richieste al team: <a href="' + CONTACT_PAGE + '">modulo contatti</a>.';
        }

        if (/partner|dashboard|locale.*gest/.test(q)) {
            return 'L’<strong>Area Partner</strong> è disponibile in <a href="partner.html">partner.html</a>. Da lì, con l’account associato al locale, è possibile aggiornare affluenza in tempo reale, sticker e recensioni.';
        }
        if (/registr|locale|discotec|club|venue/.test(q)) {
            return 'Per valutare l’inserimento di un nuovo locale sulla mappa, utilizza il <a href="' + CONTACT_PAGE + '">modulo contatti</a> selezionando «Registrare il mio locale». In alternativa: <a href="' + mailtoHref() + '">' + escapeHtml(CONTACT_EMAIL) + '</a>.';
        }
        if (/privacy|cookie|dati/.test(q)) {
            return 'Le informazioni sul trattamento dei dati sono nella <a href="privacy.html">Privacy Policy</a>. Il sito utilizza cookie essenziali e, dove applicabile, servizi Firebase per contenuti in tempo reale.';
        }
        if (/mail|email|contatt|scriv/.test(q)) {
            return 'Per contattare il team in modo strutturato si consiglia il <a href="' + CONTACT_PAGE + '">modulo contatti</a>. Per comunicazioni dirette: <a href="' + mailtoHref() + '">' + escapeHtml(CONTACT_EMAIL) + '</a>.';
        }
        if (/mappa|home|locali/.test(q)) {
            return 'La mappa interattiva è nella sezione dedicata della <a href="index.html#map">home</a>. L’elenco dei locali è consultabile in <a href="locali.html">locali.html</a>.';
        }
        if (/recension/.test(q)) {
            return 'Le recensioni pubbliche sono gestite in <a href="recensioni.html">recensioni.html</a>, con limite di una recensione per locale e per dispositivo.';
        }
        if (/ciao|hey|salve|buongiorno|buonasera/.test(q)) {
            return 'Buongiorno. Sono l’assistente informativo di FindMyNight. Posso indicarti come funziona il sito, tempistiche su eventuali app, Area Partner, privacy, mappa o contatti.';
        }
        return 'Non dispongo di una risposta dedicata a questa richiesta. Prova le scorciatoie (es. «Come funziona» o «App e tempistiche») oppure scrivi dal <a href="' + CONTACT_PAGE + '">modulo contatti</a>.';
    }

    function addBubble(html, who) {
        var div = document.createElement('div');
        div.className = 'fmn-faq-bubble fmn-faq-' + (who === 'user' ? 'user' : 'bot');
        div.innerHTML = html;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    function openChat() {
        syncFaqBottomExtra();
        widget.classList.add('fmn-faq-open');
        toggle.setAttribute('aria-expanded', 'true');
        if (input) input.focus();
    }
    function closeChat() {
        widget.classList.remove('fmn-faq-open');
        toggle.setAttribute('aria-expanded', 'false');
    }

    addBubble('Benvenuto in FindMyNight. Posso spiegare <strong>come funziona</strong> il sito, tempistiche su eventuali <strong>app</strong>, oppure orientarti su partner, mappa, privacy e contatti. Come posso aiutarti?', 'bot');

    function withTyping(fn) {
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.readOnly = true;
        window.setTimeout(function () {
            try { fn(); } finally {
                if (sendBtn) sendBtn.disabled = false;
                if (input) input.readOnly = false;
                if (input && widget.classList.contains('fmn-faq-open')) input.focus();
            }
        }, 260);
    }

    CHIPS.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'fmn-faq-chip';
        b.textContent = c.t;
        b.addEventListener('click', function () {
            addBubble(escapeHtml(c.t), 'user');
            withTyping(function () { addBubble(replyFor(c.q), 'bot'); });
        });
        quick.appendChild(b);
    });

    function sendUser() {
        if (!input) return;
        var t = input.value.trim();
        if (!t) return;
        input.value = '';
        addBubble(escapeHtml(t), 'user');
        withTyping(function () { addBubble(replyFor(t), 'bot'); });
    }

    toggle.addEventListener('click', function () {
        if (widget.classList.contains('fmn-faq-open')) closeChat();
        else openChat();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeChat);
    if (sendBtn) sendBtn.addEventListener('click', sendUser);
    if (input) input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); sendUser(); }
    });
})();
