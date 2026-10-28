// Licence « Batch Pass » : le code d'activation est affiché par Stripe après paiement
// (message de confirmation du Payment Link). L'app ne contient que son empreinte SHA-256.
export const CONFIG = {
  // Lien Stripe Payment Link (à remplacer par le vrai lien, voir manual-actions.md)
  checkoutUrl: 'https://buy.stripe.com/REPLACE_WITH_PAYMENT_LINK',
  // SHA-256 du code d'activation (généré par tools/new-license-code.mjs)
  codeHashes: ['ea943d11a8e22e800c427ca10803acd61765ede3b0e08b14679d401efc58c6c8'],
  price: '€9',
};

const KEY = 'pubrescue.license';

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text.trim().toUpperCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function isValidCode(code) {
  if (!code || !code.trim()) return false;
  return CONFIG.codeHashes.includes(await sha256Hex(code));
}

export function loadLicense() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export async function hasLicense() {
  return isValidCode(loadLicense());
}

export async function activate(code) {
  if (!(await isValidCode(code))) return false;
  try { localStorage.setItem(KEY, code.trim().toUpperCase()); } catch { /* stockage indisponible : licence valable pour la session */ }
  return true;
}
