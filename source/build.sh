#!/usr/bin/env bash
# Compile libmspub (sans ICU) + librevenge + pub2json en WebAssembly.
# Prérequis : brew install emscripten
# Sortie : ../app/engine/pubengine.mjs (wasm intégré, module ES)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
B="$ROOT/.build/wasm"; P="$B/prefix"; OUT="$ROOT/../app/engine"
export EM_CACHE="${EM_CACHE:-$HOME/.emscripten_cache}"
mkdir -p "$EM_CACHE/sysroot/lib/pkgconfig" "$B" "$OUT"
# le package.json du produit est en "type": "module" : les binaires de test de configure doivent rester CommonJS
echo '{"type":"commonjs"}' > "$B/package.json"
embuilder build boost_headers zlib >/dev/null

cd "$B"
[ -f librevenge-0.0.5.tar.bz2 ] || curl -sSLO https://dev-www.libreoffice.org/src/librevenge-0.0.5.tar.bz2
[ -f libmspub-0.1.5.tar.xz ] || curl -sSLO https://dev-www.libreoffice.org/src/libmspub-0.1.5.tar.xz
rm -rf librevenge-0.0.5 libmspub-0.1.5
tar xjf librevenge-0.0.5.tar.bz2 && tar xJf libmspub-0.1.5.tar.xz

FLAGS="-O2 -fwasm-exceptions -sUSE_BOOST_HEADERS=1 -sUSE_ZLIB=1"

cd librevenge-0.0.5
emconfigure ./configure --prefix="$P" --disable-shared --enable-static --disable-generators --disable-tests \
  --disable-werror --without-docs CXXFLAGS="$FLAGS" CFLAGS="$FLAGS" ZLIB_CFLAGS=" " ZLIB_LIBS=" " > "$B/librevenge.cfg.log"
emmake make -j8 install > "$B/librevenge.make.log"
cd ..

cd libmspub-0.1.5
python3 "$ROOT/patch_noicu.py" .
emconfigure ./configure --prefix="$P" --disable-shared --enable-static --disable-tools --disable-werror --without-docs \
  CXXFLAGS="$FLAGS" REVENGE_CFLAGS="-I$P/include/librevenge-0.0" REVENGE_LIBS="-L$P/lib -lrevenge-0.0" \
  ICU_CFLAGS=" " ICU_LIBS=" " ZLIB_CFLAGS=" " ZLIB_LIBS=" " > "$B/libmspub.cfg.log"
emmake make -j8 install > "$B/libmspub.make.log"
cd ..

em++ -std=c++17 $FLAGS "$ROOT/pub2json.cpp" -I"$P/include/librevenge-0.0" -I"$P/include/libmspub-0.1" \
  "$P/lib/libmspub-0.1.a" "$P/lib/librevenge-stream-0.0.a" "$P/lib/librevenge-0.0.a" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_pub_convert,_pub_free,_malloc,_free -sEXPORTED_RUNTIME_METHODS=UTF8ToString,HEAPU8 \
  -o "$OUT/pubengine.mjs"
ls -la "$OUT/pubengine.mjs"
