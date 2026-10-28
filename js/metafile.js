// Rendu des images Windows Metafile (WMF/EMF : cliparts, bordures, traits) en PNG, dans le navigateur.
// Moteurs : WMFJS / EMFJS de rtf.js (MIT), chargés à la demande depuis vendor/ (aucun code distant).
const loading = {};
function loadScript(name) {
  if (globalThis[name]) return Promise.resolve();
  loading[name] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(`../vendor/${name}.bundle.min.js`, import.meta.url).href;
    s.onload = () => { try { globalThis[name].loggingEnabled?.(false); } catch { /* ignore */ } resolve(); };
    s.onerror = reject;
    document.head.append(s);
  });
  return loading[name];
}

export async function metafileToPng(mime, bytes, wPt, hPt) {
  const isEmf = /emf/i.test(mime), isWmf = /wmf/i.test(mime);
  if ((!isEmf && !isWmf) || typeof document === 'undefined') return null;
  const lib = isEmf ? 'EMFJS' : 'WMFJS';
  await loadScript(lib);
  const scale = 2;
  const W = Math.max(1, Math.min(4000, Math.round((wPt || 100) * scale)));
  const H = Math.max(1, Math.min(4000, Math.round((hPt || 100) * scale)));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const r = new globalThis[lib].Renderer(buf);
  const svg = isEmf
    ? r.render({ width: `${W}px`, height: `${H}px`, wExt: W, hExt: H, xExt: W, yExt: H, mapMode: 8 })
    : r.render({ width: `${W}px`, height: `${H}px`, xExt: W, yExt: H, mapMode: 8 });
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(W, H);
    c.getContext('2d').drawImage(img, 0, 0, W, H);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
