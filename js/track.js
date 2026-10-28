// Mesure d'audience sans cookie (GoatCounter), uniquement sur le site web public.
// Jamais dans l'extension Chrome (code distant interdit par le Chrome Web Store) ni en local.
// Événements : free-convert, batch-locked, paywall-open, checkout-click, activate-ok, pdf-download, convert-error.
export const GOATCOUNTER = ''; // ex. 'https://pubrescue.goatcounter.com/count' — vide = désactivé

const enabled = () => GOATCOUNTER && location.protocol === 'https:' && !location.hostname.endsWith('localhost');

export function track(event) {
  if (!enabled()) return;
  try {
    const url = `${GOATCOUNTER}?p=${encodeURIComponent('/event/' + event)}&t=${encodeURIComponent(event)}&e=true&r=${encodeURIComponent(document.referrer)}`;
    navigator.sendBeacon ? navigator.sendBeacon(url) : fetch(url, { method: 'POST', keepalive: true, mode: 'no-cors' });
  } catch { /* la mesure ne doit jamais bloquer l'outil */ }
}

export function trackPageview() {
  if (!enabled()) return;
  try {
    const url = `${GOATCOUNTER}?p=${encodeURIComponent(location.pathname)}&r=${encodeURIComponent(document.referrer)}`;
    navigator.sendBeacon ? navigator.sendBeacon(url) : fetch(url, { method: 'POST', keepalive: true, mode: 'no-cors' });
  } catch { /* idem */ }
}

trackPageview();
