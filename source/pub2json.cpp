// pub2json : lit un fichier Microsoft Publisher (.pub) avec libmspub et sérialise
// le flux de dessin librevenge en JSON (pages, formes, texte, images en base64).
// La mise en page du texte et la génération du PDF sont faites côté JavaScript.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include <librevenge/librevenge.h>
#include <librevenge-stream/librevenge-stream.h>
#include <libmspub/libmspub.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

using namespace librevenge;

namespace
{

void esc(std::string &o, const char *s)
{
  o += '"';
  for (const unsigned char *p = reinterpret_cast<const unsigned char *>(s); *p; ++p)
  {
    const unsigned char c = *p;
    switch (c)
    {
    case '"': o += "\\\""; break;
    case '\\': o += "\\\\"; break;
    case '\n': o += "\\n"; break;
    case '\r': o += "\\r"; break;
    case '\t': o += "\\t"; break;
    default:
      if (c < 0x20)
      {
        char b[8];
        snprintf(b, sizeof b, "\\u%04x", c);
        o += b;
      }
      else
        o += static_cast<char>(c);
    }
  }
  o += '"';
}

void plist(std::string &o, const RVNGPropertyList &pl);

void pvec(std::string &o, const RVNGPropertyListVector &v)
{
  o += '[';
  for (unsigned long i = 0; i < v.count(); ++i)
  {
    if (i) o += ',';
    plist(o, v[i]);
  }
  o += ']';
}

void plist(std::string &o, const RVNGPropertyList &pl)
{
  o += '{';
  bool first = true;
  RVNGPropertyList::Iter it(pl);
  for (it.rewind(); it.next();)
  {
    if (!first) o += ',';
    first = false;
    esc(o, it.key());
    o += ':';
    if (it.child())
      pvec(o, *it.child());
    else if (it())
      esc(o, it()->getStr().cstr());
    else
      o += "null";
  }
  o += '}';
}

class JsonGenerator : public RVNGDrawingInterface
{
public:
  std::string out;
  bool first = true;

  void ev(const char *name, const RVNGPropertyList *pl = nullptr, const char *text = nullptr)
  {
    out += first ? "\n" : ",\n";
    first = false;
    out += "{\"t\":";
    esc(out, name);
    if (pl)
    {
      out += ",\"p\":";
      plist(out, *pl);
    }
    if (text)
    {
      out += ",\"s\":";
      esc(out, text);
    }
    out += '}';
  }

#define EV(NAME) void NAME(const RVNGPropertyList &p) override { ev(#NAME, &p); }
#define EV0(NAME) void NAME() override { ev(#NAME); }
  EV(startDocument) EV0(endDocument) EV(setDocumentMetaData) EV(defineEmbeddedFont)
  EV(startPage) EV0(endPage) EV(startMasterPage) EV0(endMasterPage)
  EV(setStyle) EV(startLayer) EV0(endLayer) EV(startEmbeddedGraphics) EV0(endEmbeddedGraphics)
  EV(openGroup) EV0(closeGroup)
  EV(drawRectangle) EV(drawEllipse) EV(drawPolygon) EV(drawPolyline) EV(drawPath)
  EV(drawGraphicObject) EV(drawConnector)
  EV(startTextObject) EV0(endTextObject)
  EV(startTableObject) EV(openTableRow) EV0(closeTableRow) EV(openTableCell) EV0(closeTableCell)
  EV(insertCoveredTableCell) EV0(endTableObject)
  EV0(insertTab) EV0(insertSpace) EV0(insertLineBreak) EV(insertField)
  EV(openOrderedListLevel) EV(openUnorderedListLevel) EV0(closeOrderedListLevel) EV0(closeUnorderedListLevel)
  EV(openListElement) EV0(closeListElement)
  EV(defineParagraphStyle) EV(openParagraph) EV0(closeParagraph)
  EV(defineCharacterStyle) EV(openSpan) EV0(closeSpan)
  EV(openLink) EV0(closeLink)
#undef EV
#undef EV0
  void insertText(const RVNGString &text) override { ev("insertText", nullptr, text.cstr()); }
};

char *dupString(const std::string &s)
{
  char *r = static_cast<char *>(malloc(s.size() + 1));
  if (r) memcpy(r, s.c_str(), s.size() + 1);
  return r;
}

} // anonymous namespace

extern "C" {

// Renvoie une chaîne JSON allouée par malloc (à libérer avec free) :
// {"status":"ok"|"unsupported"|"error","events":[...]}
EMSCRIPTEN_KEEPALIVE char *pub_convert(const unsigned char *data, int len)
{
  try
  {
    RVNGStringStream input(data, static_cast<unsigned>(len));
    if (!libmspub::MSPUBDocument::isSupported(&input))
      return dupString("{\"status\":\"unsupported\",\"events\":[]}");
    input.seek(0, RVNG_SEEK_SET);
    JsonGenerator gen;
    const bool ok = libmspub::MSPUBDocument::parse(&input, &gen);
    return dupString(std::string("{\"status\":\"") + (ok ? "ok" : "error") + "\",\"events\":[" + gen.out + "\n]}");
  }
  catch (...)
  {
    return dupString("{\"status\":\"error\",\"events\":[]}");
  }
}

EMSCRIPTEN_KEEPALIVE void pub_free(char *p) { free(p); }

} // extern "C"

#ifndef __EMSCRIPTEN__
// Version native pour les tests : pub2json fichier.pub > sortie.json
int main(int argc, char **argv)
{
  if (argc < 2) { fprintf(stderr, "usage: pub2json file.pub\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror(argv[1]); return 2; }
  std::string buf;
  char tmp[65536];
  size_t n;
  while ((n = fread(tmp, 1, sizeof tmp, f)) > 0) buf.append(tmp, n);
  fclose(f);
  char *r = pub_convert(reinterpret_cast<const unsigned char *>(buf.data()), static_cast<int>(buf.size()));
  fputs(r, stdout);
  pub_free(r);
  return 0;
}
#endif
