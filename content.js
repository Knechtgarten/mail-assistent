// ============================================================================
// Knechtgarten Mail-Assistent v2 - Content-Script fuer Gmail.
//
// Setzt einen Button in die Toolbar jedes Compose-/Antwortfensters. Beim
// Verfassen zeigt das Panel Vorlagen-Chips + ein Freitextfeld; beim
// Antworten wird sofort automatisch ein Entwurf erstellt (kein Klick auf
// eine Vorlage noetig - die KI liest die eingehende Mail direkt).
//
// Kein Google-Login/OAuth noetig - die Erweiterung liest/schreibt nur die
// Gmail-Seite selbst, ruft sonst nur die eigene Supabase Edge Function auf.
//
// Wichtiger Hinweis fuer die Einrichtung: Gmails interne HTML-Struktur ist
// nicht offiziell dokumentiert und kann sich mit Google-Updates aendern -
// die Selektoren unten (aria-label "Nachrichtentext"/"Message Body",
// "Senden"/"Send", input[name=subjectbox]) sind seit Jahren stabil, aber
// nicht garantiert. Falls der Button irgendwo nicht erscheint, zuerst hier
// pruefen.
// ============================================================================

const KG_EDGE_URL = 'https://oalapdxinqlnzwxhyuzy.supabase.co/functions/v1/mail-assistent-draft';
const KG_ANON_KEY = 'sb_publishable_DoeD4uEnwemmnFu4AxE9uw_5lmQYc5P';

const KG_ICON_BLITZ = '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19"/>';
const KG_ICON_MIC = '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v3"/>';

function kgSvg(pfad, groesse) {
  groesse = groesse || 13;
  return `<svg width="${groesse}" height="${groesse}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${pfad}</svg>`;
}
function kgEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function kgRufeApiAuf(payload) {
  const res = await fetch(KG_EDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KG_ANON_KEY },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Serverfehler (${res.status})`);
  return data;
}

// Gmail zeigt die eingeloggte Adresse im Konto-Symbol oben rechts (Tooltip/
// aria-label enthaelt die Mailadresse). Fallback: irgendeine
// @knechtgarten.ch-Adresse auf der Seite suchen.
function kgHoleMitarbeiterEmail() {
  const kontoEl = document.querySelector('a[aria-label*="Google-Konto"], a[aria-label*="Google Account"], a[aria-label*="Account"]');
  if (kontoEl) {
    const treffer = (kontoEl.getAttribute('aria-label') || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (treffer) return treffer[0];
  }
  const treffer = document.body.innerText.match(/[\w.+-]+@knechtgarten\.ch/);
  return treffer ? treffer[0] : 'unbekannt@knechtgarten.ch';
}

// ----------------------------------------------------------------------------
// Erkennung neuer Compose-/Antwortfenster
// ----------------------------------------------------------------------------
console.log('[Mail-Assistent] content.js geladen, Beobachter aktiv.');

const kgBeobachter = new MutationObserver(() => {
  document.querySelectorAll('div[g_editable="true"][role="textbox"], div[aria-label*="Nachrichtentext" i], div[aria-label*="Message Body" i]').forEach(body => {
    if (body.dataset.kgDone) return;
    // Gmail haelt teils versteckte Entwurfsfelder auch in der Listenansicht im
    // DOM (z.B. fuer Autosave) - ohne Sichtbarkeitspruefung wuerde dort faelsch-
    // licherweise auch ein Button erscheinen. offsetParent ist null bei
    // display:none/nicht gerendert.
    if (body.offsetParent === null) return;
    const container = kgFindeContainer(body);
    const toolbar = container ? kgFindeToolbar(container) : null;
    if (!container) { console.log('[Mail-Assistent] Textfeld gefunden, aber keinen Senden-Button in den Elternelementen entdeckt.', body); return; }
    if (!toolbar) { console.log('[Mail-Assistent] Senden-Button gefunden, aber keine passende Symbolleiste.', body); return; }
    body.dataset.kgDone = '1';
    console.log('[Mail-Assistent] Fenster erkannt, Button wird eingefuegt.', { body, container, toolbar });
    kgInitialisiere(body, container, toolbar);
  });
});
kgBeobachter.observe(document.body, { childList: true, subtree: true });

const KG_SEND_SELEKTOR = '[aria-label*="Senden" i], [aria-label*="Send" i], [data-tooltip*="Senden" i], [data-tooltip*="Send" i]';

function kgFindeContainer(bodyEl) {
  let el = bodyEl.parentElement;
  for (let i = 0; i < 25 && el; i++) {
    if (el.querySelector(KG_SEND_SELEKTOR)) return el;
    el = el.parentElement;
  }
  return null;
}
function kgFindeToolbar(container) {
  const sendBtn = container.querySelector(KG_SEND_SELEKTOR);
  if (!sendBtn) return null;
  let row = sendBtn;
  for (let i = 0; i < 4 && row.parentElement; i++) {
    if (row.parentElement.children.length >= 2) return row.parentElement;
    row = row.parentElement;
  }
  return sendBtn.parentElement;
}

// ----------------------------------------------------------------------------
// Aufbau von Button + Panel pro Fenster
// ----------------------------------------------------------------------------
function kgInitialisiere(bodyEl, container, toolbar) {
  // "container" reicht oft nicht bis zum Betreff-Feld hoch (das liegt in
  // einer eigenen Zeile ueber der Toolbar) - darum hier auf der ganzen Seite
  // suchen. Ein sichtbares Betreff-Feld gibt es nur beim Verfassen einer
  // neuen Mail, nicht beim Antworten (dort ist "Betreff" standardmaessig
  // ausgeblendet).
  const subjectbox = document.querySelector('input[name="subjectbox"]');
  const istVerfassen = !!subjectbox && subjectbox.offsetParent !== null;

  const button = document.createElement('span');
  button.className = 'kg-btn';
  button.innerHTML = kgSvg(KG_ICON_BLITZ) + 'Mail-Assistent';
  toolbar.appendChild(button);

  // Panel wird VOR dem Mailtext-Feld eingefuegt (wie Googles eigene "Hilf mir
  // schreiben"-Box) - also dort, wo man zu tippen beginnt, oberhalb der
  // Signatur (die steht am Ende von bodyEl). Als normaler Teil des Inhalts,
  // nicht als schwebendes Overlay, damit es beim Wachsen die Sende-Leiste
  // nicht verdeckt und stattdessen die normale Seiten-Bildlaufleiste zum
  // Scrollen verwendet wird. bodyEl.insertAdjacentElement ist immer sicher,
  // da bodyEl selbst garantiert im DOM haengt.
  const panel = document.createElement('div');
  panel.className = 'kg-panel';
  panel.innerHTML = '<div class="kg-scroll"></div>';
  bodyEl.insertAdjacentElement('beforebegin', panel);

  // Gmail haengt am Mailtext-Bereich einen Klick-Handler, der bei jedem Klick
  // versucht, den Fokus zurueck auf das Editierfeld zu holen - da unser Panel
  // jetzt ein direktes Geschwister von bodyEl ist, schnappt sich das sonst
  // auch Klicks in unsere Eingabefelder. Events hier abfangen, bevor sie zu
  // Gmails Handlern hochblubbern.
  ['mousedown', 'click'].forEach(ev => panel.addEventListener(ev, e => e.stopPropagation()));

  const zustand = { offen: false, aktuellerEntwurf: null, aktuelleVorlageId: null, mailInhalt: null, panel, button };

  button.addEventListener('click', async () => {
    zustand.offen = !zustand.offen;
    panel.classList.toggle('kg-show', zustand.offen);
    button.classList.toggle('kg-on', zustand.offen);
    if (zustand.offen && !panel.dataset.geladen) {
      panel.dataset.geladen = '1';
      if (istVerfassen) await kgZeigeVerfassenChips(panel, bodyEl, zustand);
      else await kgStarteAntworten(panel, bodyEl, container, zustand);
    }
  });
}

function kgSchliessePanel(zustand) {
  zustand.offen = false;
  zustand.panel.classList.remove('kg-show');
  zustand.button.classList.remove('kg-on');
}

// ----------------------------------------------------------------------------
// Verfassen: Vorlagen-Chips + Freitextfeld
// ----------------------------------------------------------------------------
async function kgZeigeVerfassenChips(panel, bodyEl, zustand) {
  const scroll = panel.querySelector('.kg-scroll');
  scroll.innerHTML = '<div class="kg-lade">Lade Vorlagen …</div>';
  let vorlagen = [];
  try {
    const res = await kgRufeApiAuf({ modus: 'liste-verfassen' });
    vorlagen = res.vorlagen || [];
  } catch (e) { /* Chips bleiben dann einfach leer */ }

  // Express: eine einfache Vorlage ohne [Platzhalter] braucht keine KI - die
  // gibt es sowieso nur 1:1 wieder. Dann sofort einfuegen statt auf einen
  // API-Aufruf zu warten (spart 2-4 Sekunden und Kosten).
  const KG_PLATZHALTER_REGEX = /\[[^\]]+\]/;
  const istExpress = (v) => v.typ === 'einfach' && v.inhalt && !KG_PLATZHALTER_REGEX.test(v.inhalt);

  scroll.innerHTML = `
    <div class="kg-chips">${vorlagen.map(v => `<span class="kg-chip${istExpress(v) ? ' kg-chip-express' : ''}" data-id="${v.id}" title="${istExpress(v) ? 'Express - wird sofort eingefuegt' : ''}">${istExpress(v) ? kgSvg(KG_ICON_BLITZ, 11) : ''}${kgEscape(v.titel)}</span>`).join('')}</div>
    <div class="kg-row">
      <textarea class="kg-textarea" rows="1" placeholder="Eigene Stichworte oder Anweisung … (Enter zum Erstellen)"></textarea>
      <button class="kg-micbtn" title="Diktieren">${kgSvg(KG_ICON_MIC)}</button>
    </div>
    <div class="kg-chat-bereich"></div>`;

  const chatBereich = scroll.querySelector('.kg-chat-bereich');
  const textarea = scroll.querySelector('.kg-textarea');
  kgSchuetzeFokus(textarea);

  scroll.querySelectorAll('.kg-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const vorlage = vorlagen.find(v => v.id === chip.dataset.id);
      if (vorlage && istExpress(vorlage)) {
        // Express: kein KI-Aufruf noetig (kein Platzhalter zum Ausfuellen),
        // aber trotzdem als Entwurf im Chat zeigen statt blind einzufuegen -
        // so bleibt die Moeglichkeit zum Nachbessern vor dem Uebernehmen.
        zustand.aktuellerEntwurf = vorlage.inhalt;
        zustand.aktuelleVorlageId = vorlage.id;
        kgZeigeEntwurf(chatBereich, bodyEl, zustand);
      } else {
        kgGeneriere({ modus: 'verfassen', vorlageId: chip.dataset.id }, chatBereich, bodyEl, zustand);
      }
    });
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      if (zustand.aktuellerEntwurf) {
        kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung: text, richtung: 'verfassen', vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, text);
      } else {
        kgGeneriere({ modus: 'verfassen', stichworte: text }, chatBereich, bodyEl, zustand);
      }
      textarea.value = '';
    }
  });
  kgAktiviereMikrofon(scroll.querySelector('.kg-micbtn'), textarea);
}

// ----------------------------------------------------------------------------
// Antworten: sofort automatisch Entwurf/Rueckfrage anhand der eingehenden
// Mail erstellen - keine Chips.
// ----------------------------------------------------------------------------
function kgHoleMailInhalt(bodyEl, container) {
  // 1. Manche Antwortfenster haben den zitierten Verlauf direkt im Editierfeld
  //    (blockquote/.gmail_quote). Falls nicht (Gmail klappt das oft erst nach
  //    Klick auf "..." auf), 2. stattdessen die zuletzt angezeigte Nachricht
  //    im Thread darueber suchen (Gmail-Klasse "a3s" fuer den reinen
  //    Nachrichtentext - seit Jahren stabil, aber nicht offiziell dokumentiert).
  const zitat = bodyEl.querySelector('blockquote, .gmail_quote');
  let text = ((zitat ? zitat.textContent : '') || '').trim();
  if (!text) {
    const nachrichten = Array.from(document.querySelectorAll('div.a3s.aiL, div.a3s'))
      .filter(el => el !== bodyEl && !el.contains(bodyEl) && !bodyEl.contains(el));
    for (let i = nachrichten.length - 1; i >= 0; i--) {
      const t = (nachrichten[i].textContent || '').trim();
      if (t) { text = t; break; }
    }
  }
  if (!text) text = (bodyEl.textContent || '').trim();
  return text || '(kein Mailinhalt gefunden)';
}

// Absender der Mail, auf die geantwortet wird - fuer den Express-Pfad bei
// internen Mails (@knechtgarten.ch). Gmail markiert den Absender-Namen mit
// einem "email"-Attribut (aehnlich stabil wie die "a3s"-Klasse oben).
function kgHoleAbsenderEmail(bodyEl) {
  const kandidaten = Array.from(document.querySelectorAll('[email]'))
    .filter(el => el !== bodyEl && !el.contains(bodyEl) && !bodyEl.contains(el));
  for (let i = kandidaten.length - 1; i >= 0; i--) {
    const email = kandidaten[i].getAttribute('email');
    if (email && email.includes('@')) return email;
  }
  return null;
}

async function kgStarteAntworten(panel, bodyEl, container, zustand) {
  const scroll = panel.querySelector('.kg-scroll');
  scroll.innerHTML = '<div class="kg-chat-bereich"><div class="kg-lade">Lese Mail und erstelle Entwurf …</div></div>';
  const chatBereich = scroll.querySelector('.kg-chat-bereich');
  zustand.mailInhalt = kgHoleMailInhalt(bodyEl, container);
  const absender = kgHoleAbsenderEmail(bodyEl);
  const istIntern = !!absender && absender.toLowerCase().endsWith('@knechtgarten.ch');

  try {
    const data = await kgRufeApiAuf({ modus: 'antworten', mailInhalt: zustand.mailInhalt, intern: istIntern, mitarbeiterEmail: kgHoleMitarbeiterEmail() });
    chatBereich.innerHTML = '';
    if (data.aktion === 'entwurf') {
      zustand.aktuellerEntwurf = data.text;
      kgZeigeEntwurf(chatBereich, bodyEl, zustand);
    } else if (data.aktion === 'rueckfrage') {
      kgZeigeRueckfrage(chatBereich, data, bodyEl, zustand);
    }
  } catch (e) {
    chatBereich.innerHTML = `<div class="kg-lade" style="color:#B4655F;">Fehler: ${kgEscape(e.message)}</div>`;
  }
}

// ----------------------------------------------------------------------------
// Gemeinsame Bausteine: KI-Aufruf mit Ladeanzeige, Entwurf/Rueckfrage anzeigen
// ----------------------------------------------------------------------------
async function kgGeneriere(payload, chatBereich, bodyEl, zustand, nutzerNachricht) {
  // Ladeanzeige moeglichst im Chat-Verlauf zeigen (falls schon vorhanden),
  // damit sie an der richtigen Stelle im Scroll-Bereich erscheint.
  const ziel = chatBereich.querySelector('.kg-verlauf') || chatBereich;
  const lade = document.createElement('div');
  lade.className = 'kg-lade';
  lade.textContent = 'Erstelle Entwurf …';
  ziel.appendChild(lade);
  ziel.scrollTop = ziel.scrollHeight;
  try {
    const data = await kgRufeApiAuf({ ...payload, mailInhalt: payload.mailInhalt ?? zustand.mailInhalt, mitarbeiterEmail: kgHoleMitarbeiterEmail() });
    lade.remove();
    if (data.aktion === 'entwurf') {
      zustand.aktuellerEntwurf = data.text;
      if (payload.vorlageId) zustand.aktuelleVorlageId = payload.vorlageId;
      kgZeigeEntwurf(chatBereich, bodyEl, zustand, nutzerNachricht);
    } else if (data.aktion === 'rueckfrage') {
      kgZeigeRueckfrage(chatBereich, data, bodyEl, zustand);
    }
  } catch (e) {
    lade.style.color = '#B4655F';
    lade.textContent = 'Fehler: ' + e.message;
  }
}

let kgNachbesserCache = null;
async function kgLadeNachbesserButtons(container, onClick) {
  if (!kgNachbesserCache) {
    try { kgNachbesserCache = (await kgRufeApiAuf({ modus: 'liste-nachbessern' })).buttons || []; }
    catch (e) { kgNachbesserCache = []; }
  }
  container.innerHTML = kgNachbesserCache.map(b => `<span class="kg-chip" data-anweisung="${kgEscape(b.anweisung)}">${kgEscape(b.titel)}</span>`).join('');
  container.querySelectorAll('.kg-chip').forEach(chip => chip.addEventListener('click', () => onClick(chip.dataset.anweisung)));
}

function kgZeigeEntwurf(chatBereich, bodyEl, zustand, nutzerNachricht) {
  // Chat-Verlauf: jede Version bleibt sichtbar (hoch-/runterscrollbar) statt
  // die vorherige zu ersetzen - so laesst sich bei Bedarf auch zu einer
  // frueheren Version zurueckkehren. Aufbau (Verlauf + Nachbessern-Zeile +
  // Uebernehmen-Button) wird nur beim allerersten Entwurf erstellt, danach
  // wird nur noch in den Verlauf hinein ergaenzt.
  let verlauf = chatBereich.querySelector('.kg-verlauf');

  if (!verlauf) {
    // Sobald ein Entwurf steht, braucht es das urspruengliche "Eigene
    // Stichworte"-Feld oben nicht mehr (Nachbessern passiert ab jetzt ueber
    // das Feld im Chat-Verlauf) - sonst wirkt es wie ein zweites,
    // ueberfluessiges leeres Feld.
    const obereZeile = chatBereich.closest('.kg-scroll')?.querySelector(':scope > .kg-row');
    if (obereZeile) obereZeile.style.display = 'none';

    chatBereich.insertAdjacentHTML('beforeend', `
      <div class="kg-verlauf"></div>
      <div class="kg-quickchips kg-quick-nachbessern"></div>
      <div class="kg-followuprow">
        <input type="text" placeholder="Nachbessern oder eigene Anweisung…">
        <button class="kg-micbtn" title="Diktieren">${kgSvg(KG_ICON_MIC)}</button>
      </div>`);
    verlauf = chatBereich.querySelector('.kg-verlauf');

    kgLadeNachbesserButtons(chatBereich.querySelector('.kg-quick-nachbessern'), (anweisung) => {
      kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung, vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, anweisung);
    });

    const input = chatBereich.querySelector('.kg-followuprow input');
    kgSchuetzeFokus(input);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const text = input.value.trim();
        kgGeneriere({ modus: 'nachbessern', aktuellerEntwurf: zustand.aktuellerEntwurf, anweisung: text, vorlageId: zustand.aktuelleVorlageId }, chatBereich, bodyEl, zustand, text);
        input.value = '';
      }
    });
    kgAktiviereMikrofon(chatBereich.querySelector('.kg-followuprow .kg-micbtn'), input);
  }

  if (nutzerNachricht) {
    verlauf.insertAdjacentHTML('beforeend', `<div class="kg-msg kg-user"><div class="kg-bubble">${kgEscape(nutzerNachricht)}</div></div>`);
  }

  // Bisherige "aktuelle" Markierung entfernen - es gibt immer nur eine
  // hervorgehobene (aktive) Version, alle aelteren werden dezenter.
  verlauf.querySelectorAll('.kg-msg.kg-ai.kg-aktuell').forEach(el => el.classList.remove('kg-aktuell'));

  // Eigene, unveraenderliche Kopie des Texts fuer DIESE Bubble - falls spaeter
  // weiter nachgebessert wird, soll "Diese Version verwenden" trotzdem noch
  // genau diesen (aelteren) Stand einfuegen koennen.
  const dieserText = zustand.aktuellerEntwurf;
  const aiDiv = document.createElement('div');
  aiDiv.className = 'kg-msg kg-ai kg-aktuell';
  aiDiv.innerHTML = `<div class="kg-bubble">${kgEscape(dieserText)}</div><button class="kg-diese-version">In Mail übernehmen</button>`;
  verlauf.appendChild(aiDiv);
  aiDiv.querySelector('.kg-diese-version').addEventListener('click', () => {
    zustand.aktuellerEntwurf = dieserText;
    kgUebernehmeInMail(bodyEl, dieserText);
    kgSchliessePanel(zustand);
  });

  verlauf.scrollTop = verlauf.scrollHeight;
}

function kgZeigeRueckfrage(chatBereich, data, bodyEl, zustand) {
  const div = document.createElement('div');
  div.className = 'kg-msg kg-frage';
  div.innerHTML = `<div class="kg-bubble">${kgEscape(data.frage)}</div>
    <div class="kg-answers">${data.antworten.map(a => `<span class="kg-answer" data-label="${kgEscape(a.label)}">${kgEscape(a.label)}</span>`).join('')}</div>`;
  chatBereich.appendChild(div);
  div.querySelectorAll('.kg-answer').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelectorAll('.kg-answer').forEach(b => b.classList.remove('kg-picked'));
      btn.classList.add('kg-picked');
      zustand.aktuelleVorlageId = data.vorlageId;
      kgGeneriere({ modus: 'rueckfrage-antwort', vorlageId: data.vorlageId, antwortLabel: btn.dataset.label }, chatBereich, bodyEl, zustand, btn.dataset.label);
    });
  });
}

// ----------------------------------------------------------------------------
// Entwurf ins Mailfeld uebernehmen - eigenen Text vor einem evtl. zitierten
// Verlauf einfuegen, das Zitat selbst bleibt unveraendert stehen.
// ----------------------------------------------------------------------------
function kgUebernehmeInMail(bodyEl, text) {
  bodyEl.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  const zitat = bodyEl.querySelector('blockquote, .gmail_quote');
  try {
    range.setStart(bodyEl, 0);
    if (zitat) range.setEndBefore(zitat); else range.selectNodeContents(bodyEl);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text + '\n\n');
  } catch (e) {
    // Falls die Bereichs-Auswahl fehlschlaegt (z.B. ungewohnte Gmail-Struktur):
    // Text einfach am aktuellen Cursor einfuegen, nichts loeschen.
    document.execCommand('insertText', false, text + '\n\n');
  }
}

// ----------------------------------------------------------------------------
// Fokus-Schutz: Gmails Mailtext-Feld holt sich bei einem Blur-Ereignis oft
// sofort wieder selbst den Fokus zurueck (z.B. um den Cursor "an Ort und
// Stelle" zu halten) - das faengt auch Klicks in unsere Eingabefelder ab,
// weil unser Panel direkt daneben im DOM sitzt. Fokus einen Tick spaeter
// (nach Gmails eigener Reaktion) erneut erzwingen.
// ----------------------------------------------------------------------------
function kgSchuetzeFokus(el) {
  el.addEventListener('mousedown', () => {
    setTimeout(() => el.focus(), 0);
  });
}

// ----------------------------------------------------------------------------
// Mikrofon (Web Speech API) - diktiert direkt ins uebergebene Feld.
// ----------------------------------------------------------------------------
function kgAktiviereMikrofon(button, feld) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { button.style.display = 'none'; return; }
  const erkennung = new SpeechRecognition();
  erkennung.lang = 'de-CH';
  erkennung.interimResults = false;
  let laeuft = false;
  button.addEventListener('click', () => { laeuft ? erkennung.stop() : erkennung.start(); });
  erkennung.addEventListener('start', () => { laeuft = true; button.classList.add('kg-recording'); });
  erkennung.addEventListener('end', () => { laeuft = false; button.classList.remove('kg-recording'); });
  erkennung.addEventListener('error', () => { laeuft = false; button.classList.remove('kg-recording'); });
  erkennung.addEventListener('result', (e) => {
    const text = Array.from(e.results).map(r => r[0].transcript).join(' ');
    feld.value = (feld.value ? feld.value + ' ' : '') + text;
  });
}
