# PubRescue — open Microsoft Publisher (.pub) files as PDF, in your browser

Live: https://ycmmm-hub.github.io/pubrescue/

Files are converted locally in the browser (WebAssembly); nothing is uploaded.

## Source code
- `js/`, `css/`, `index.html`: the web app.
- `engine/pubengine.wasm`: libmspub 0.1.5 + librevenge compiled to WebAssembly.
- `source/`: build script (`build.sh`), the patch applied to libmspub/librevenge (`patch_noicu.py`, removes the ICU dependency), and the C++ bridge (`pub2json.cpp`). libmspub and librevenge are MPL 2.0; their source is available upstream (https://dev-www.libreoffice.org/src/) and the modifications are in `source/patch_noicu.py`.
- `source/extension/`: Chrome extension manifest and background script.

Third-party licences: `third-party-notices.html` and `licenses/`.

Not affiliated with Microsoft. Publisher is a trademark of Microsoft Corporation.
