// Pont JavaScript <-> moteur WebAssembly (libmspub). Aucune donnée ne quitte la machine.
export function convertPub(mod, bytes) {
  if (!bytes || bytes.length === 0) return { status: 'unsupported', events: [] };
  const ptr = mod._malloc(bytes.length);
  try {
    mod.HEAPU8.set(bytes, ptr);
    const out = mod._pub_convert(ptr, bytes.length);
    try { return JSON.parse(mod.UTF8ToString(out)); }
    finally { mod._pub_free(out); }
  } catch (e) {
    return { status: 'error', events: [], message: String(e) };
  } finally {
    mod._free(ptr);
  }
}
