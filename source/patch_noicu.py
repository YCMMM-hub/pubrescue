#!/usr/bin/env python3
"""Retire la dépendance ICU de libmspub 0.1.4 pour la compilation WebAssembly.

ICU ne sert qu'à 3 endroits :
- appendCharacters() : décodage du texte -> remplacé par un décodeur natif
  (UTF-16LE pour Publisher 2000+, windows-1252 pour les anciens fichiers, latin-1 sinon) ;
- getCalculatedEncoding() : détection d'encodage des fichiers Publisher 97/98 -> windows-1252 ;
- fillLocale() : langue/pays (métadonnées seulement) -> ignoré.
Usage : python3 patch_noicu.py <dossier source libmspub>
"""
import re, sys, pathlib

src = pathlib.Path(sys.argv[1]) / "src" / "lib"

# 1) libmspub_utils.cpp : décodeur sans ICU
p = src / "libmspub_utils.cpp"
s = p.read_text()
s = s.replace("#include <unicode/ucnv.h>\n", "").replace("#include <unicode/utypes.h>\n", "")
start = s.index("void appendCharacters(librevenge::RVNGString &text, const std::vector<unsigned char> &characters,")
end = s.index("bool stillReading(")
s = s[:start] + r'''void appendCharacters(librevenge::RVNGString &text, const std::vector<unsigned char> &characters,
                      const char *encoding)
{
  // Décodeur natif (sans ICU) : UTF-16LE, windows-1252, sinon latin-1.
  static const uint32_t cp1252[32] =
  {
    0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0xFFFD, 0x017D, 0xFFFD,
    0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178
  };
  if (characters.empty())
    return;
  if (encoding && strcmp(encoding, "UTF-16LE") == 0)
  {
    for (size_t i = 0; i + 1 < characters.size(); i += 2)
    {
      uint32_t u = characters[i] | (uint32_t(characters[i + 1]) << 8);
      if (u >= 0xd800 && u < 0xdc00 && i + 3 < characters.size())
      {
        uint32_t l = characters[i + 2] | (uint32_t(characters[i + 3]) << 8);
        if (l >= 0xdc00 && l < 0xe000)
        {
          u = (u - 0xd800) * 0x400 + (l - 0xdc00) + 0x10000;
          i += 2;
        }
      }
      _appendUCS4(text, u);
    }
    return;
  }
  const bool is1252 = !encoding || strcmp(encoding, "windows-1252") == 0;
  for (unsigned char c : characters)
  {
    uint32_t u = c;
    if (is1252 && c >= 0x80 && c < 0xa0)
      u = cp1252[c - 0x80];
    _appendUCS4(text, u);
  }
}

''' + s[end:]
if "#include <cstring>" not in s:
    s = "#include <cstring>\n" + s
p.write_text(s)

# 2) MSPUBCollector.cpp : pas de détection ICU, pas de locale ICU
p = src / "MSPUBCollector.cpp"
s = p.read_text()
s = s.replace("#include <unicode/ucsdet.h>\n", "").replace("#include <unicode/uloc.h>\n", "")
a = s.index("  // for older versions of PUB, see if we can get ICU to tell us the encoding.")
b = s.index("csd_fail:")
b = s.index("}", s.index('return "windows-1252";', b))
s = s[:a] + '  return "windows-1252"; // sans ICU : encodage par défaut des anciens fichiers\n' + s[b:]
a = s.index("void fillLocale(librevenge::RVNGPropertyList &props, const unsigned lcid)")
b = s.index("} // anonymous namespace", a)
s = s[:a] + "void fillLocale(librevenge::RVNGPropertyList &, const unsigned)\n{\n}\n\n" + s[b:]
p.write_text(s)

leftover = [str(f) for f in src.glob("*.*") if re.search(r"unicode/|ucnv_|ucsdet_|uloc_", f.read_text(errors="ignore"))]
if leftover:
    sys.exit(f"ICU encore présent dans : {leftover}")
print("libmspub patché : ICU retiré")
