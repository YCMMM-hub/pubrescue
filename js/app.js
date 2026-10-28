// PubRescue — conversion locale de fichiers Microsoft Publisher (.pub) en PDF.
// Gratuit : un fichier à la fois. Batch Pass : dossiers entiers + ZIP.
import createEngine from '../engine/pubengine.mjs';
import { convertPub } from './engine.js';
import { buildModel, renderPdf } from './render.js';
import { zipSync } from '../vendor/fflate.js';
import { CONFIG, hasLicense, activate } from './license.js';
import { track } from './track.js';
import { metafileToPng } from './metafile.js';

const $ = sel => document.querySelector(sel);
const state = { files: [], licensed: false, engine: null };

const enginePromise = createEngine().then(m => (state.engine = m));

// Conversion des images non PNG/JPEG : WMF/EMF via metafile.js, BMP/GIF via le navigateur ; TIFF ignorée.
async function convertImage(mime, bytes, w, h) {
  if (/wmf|emf/i.test(mime)) { try { return await metafileToPng(mime, bytes, w, h); } catch { return null; } }
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } catch { return null; }
}

const baseName = f => (f.relPath || f.name).replace(/\.pub$/i, '');
const human = n => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function addFiles(list) {
  const incoming = [...list].filter(f => /\.pub$/i.test(f.name));
  const skipped = list.length - incoming.length;
  let freeSlot = true; // version gratuite : le premier fichier de chaque dépôt est converti
  for (const f of incoming) {
    const relPath = f.webkitRelativePath || f.name;
    if (state.files.some(x => x.relPath === relPath && x.size === f.size)) continue;
    const status = state.licensed || freeSlot ? 'waiting' : 'locked';
    freeSlot = false;
    state.files.push({ file: f, name: f.name, relPath, size: f.size, status, pdf: null, note: status === 'locked' ? 'Included in the Batch Pass' : '' });
  }
  $('#skipped').textContent = skipped > 0 ? `${skipped} file(s) ignored: only .pub files are converted.` : '';
  if (state.files.some(f => f.status === 'locked')) track('batch-locked');
  render();
  convertAll();
}

async function convertOne(item) {
  item.status = 'working'; render();
  await enginePromise;
  try {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const res = convertPub(state.engine, bytes);
    if (res.status === 'unsupported') throw new Error('Not a Publisher file, or a version we cannot read yet.');
    if (res.status !== 'ok') throw new Error('This file could not be read (damaged, or a layout we do not support yet).');
    const { bytes: pdf, report } = await renderPdf(buildModel(res.events), { convertImage, title: baseName(item) });
    item.pdf = pdf;
    item.status = 'done';
    const notes = [`${report.pages} page${report.pages > 1 ? 's' : ''}`];
    if (report.imagesSkipped) notes.push(`${report.imagesSkipped} image(s) in an old format skipped`);
    if (report.charsReplaced) notes.push(`${report.charsReplaced} special character(s) simplified`);
    item.note = notes.join(' · ');
    track(state.licensed ? 'batch-convert' : 'free-convert');
  } catch (e) {
    item.status = 'error';
    item.note = e.message;
    track('convert-error');
  }
  render();
}

let running = false;
async function convertAll() {
  if (running) return;
  running = true;
  for (const item of state.files) if (item.status === 'waiting') await convertOne(item);
  running = false;
}

function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadAll() {
  const done = state.files.filter(f => f.status === 'done');
  if (!done.length) return;
  if (!state.licensed) { openPaywall(); return; }
  const entries = {};
  for (const f of done) entries[`${baseName(f)}.pdf`] = f.pdf;
  download('publisher-files-pdf.zip', zipSync(entries, { level: 0 }), 'application/zip');
}

function openPaywall() { $('#paywall').hidden = false; $('#code').focus(); track('paywall-open'); }

function unlockAll() {
  for (const f of state.files) if (f.status === 'locked') { f.status = 'waiting'; f.note = ''; }
  render();
  convertAll();
}

function render() {
  const list = $('#files');
  list.replaceChildren(...state.files.map(item => {
    const li = document.createElement('li');
    li.className = `file ${item.status}`;
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: item.relPath });
    const meta = Object.assign(document.createElement('span'), { className: 'meta', textContent: `${human(item.size)}${item.note ? ' · ' + item.note : ''}` });
    const status = Object.assign(document.createElement('span'), { className: 'status', textContent: { waiting: 'Waiting', working: 'Converting…', done: 'Ready', error: 'Failed', locked: 'Locked' }[item.status] });
    li.append(name, meta, status);
    if (item.status === 'done') {
      const b = Object.assign(document.createElement('button'), { className: 'btn small', textContent: 'Download PDF' });
      b.onclick = () => { download(`${item.name.replace(/\.pub$/i, '')}.pdf`, item.pdf, 'application/pdf'); track('pdf-download'); };
      li.append(b);
    } else if (item.status === 'locked') {
      const b = Object.assign(document.createElement('button'), { className: 'btn small ghost', textContent: 'Unlock' });
      b.onclick = openPaywall;
      li.append(b);
    }
    return li;
  }));
  const done = state.files.filter(f => f.status === 'done').length;
  const failed = state.files.filter(f => f.status === 'error').length;
  const locked = state.files.filter(f => f.status === 'locked').length;
  $('#summary').textContent = state.files.length ? `${done} converted · ${failed} failed${locked ? ` · ${locked} waiting for the Batch Pass` : ''}` : '';
  const unlock = $('#unlock-all');
  unlock.hidden = locked === 0;
  unlock.textContent = `Convert all ${locked + done} files — Batch Pass ${CONFIG.price}`;
  const all = $('#download-all');
  all.hidden = !state.licensed || done < 2;
  all.textContent = `Download all ${done} as ZIP`;
  $('#license-state').textContent = state.licensed ? 'Batch Pass active on this browser.' : '';
}

function init() {
  document.querySelectorAll('.price-copy').forEach(n => { n.textContent = CONFIG.price; });
  for (const id of ['buy', 'paywall-buy']) {
    const a = $(`#${id}`);
    // Tant que le lien Stripe n'est pas configuré, renvoyer vers le support plutôt qu'une page Stripe introuvable
    a.href = CONFIG.checkoutUrl.includes('REPLACE_WITH') ? 'mailto:nouvellesentreprises.avs@gmail.com?subject=PubRescue%20Batch%20Pass' : CONFIG.checkoutUrl;
    a.addEventListener('click', () => track('checkout-click'));
  }
  $('#have-code').onclick = openPaywall;
  $('#unlock-all').onclick = openPaywall;
  $('#pick').onchange = e => addFiles(e.target.files);
  $('#pick-folder').onchange = e => addFiles(e.target.files);
  $('#download-all').onclick = downloadAll;
  $('#close-paywall').onclick = () => { $('#paywall').hidden = true; };
  $('#activate').onsubmit = async e => {
    e.preventDefault();
    const ok = await activate($('#code').value);
    $('#code-msg').textContent = ok ? 'Batch Pass activated. Thank you!' : 'This code is not valid. Check for typos, or contact support.';
    if (ok) { state.licensed = true; $('#paywall').hidden = true; track('activate-ok'); unlockAll(); }
  };
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async e => addFiles(await filesFromDrop(e.dataTransfer)));
  // Ouverture via « Ouvrir avec » (app installée, file_handlers)
  if ('launchQueue' in window) window.launchQueue.setConsumer(async p => addFiles(await Promise.all(p.files.map(h => h.getFile()))));
  hasLicense().then(v => { state.licensed = v; render(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
}

// Dépôt de dossiers entiers (sous-dossiers conservés dans le ZIP)
async function filesFromDrop(dt) {
  const out = [];
  const walk = (entry, path) => new Promise(resolve => {
    if (entry.isFile) entry.file(f => { Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name }); out.push(f); resolve(); }, () => resolve());
    else if (entry.isDirectory) {
      const reader = entry.createReader(); const all = [];
      const read = () => reader.readEntries(async ents => { if (!ents.length) { for (const en of all) await walk(en, path + entry.name + '/'); resolve(); } else { all.push(...ents); read(); } }, () => resolve());
      read();
    } else resolve();
  });
  const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  for (const en of entries) await walk(en, '');
  return out;
}

init();
