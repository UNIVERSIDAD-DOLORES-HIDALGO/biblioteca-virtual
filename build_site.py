"""Genera index.html a partir de biblioteca_results.json.

Uso:  python build_site.py
Cada entrada del JSON: {titulo, archivo_pdf, archivo_portada, categoria}.
La página es estática y sin dependencias externas; si falta una portada,
el onerror de la imagen la cambia por una tarjeta con el título.
"""
import html
import json
import re
import unicodedata
from collections import OrderedDict

DATOS = 'biblioteca_results.json'
SALIDA = 'index.html'


def ancla(texto):
    s = unicodedata.normalize('NFKD', texto).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def main():
    libros = json.load(open(DATOS, encoding='utf-8'))
    cats = OrderedDict()
    for l in sorted(libros, key=lambda x: (x['categoria'], x['titulo'].lower())):
        cats.setdefault(l['categoria'], []).append(l)
    total = len(libros)

    toc = '\n'.join(
        f'      <a class="chip" href="#{ancla(c)}">{html.escape(c)} <span>{len(ls)}</span></a>'
        for c, ls in cats.items())

    secciones = []
    for c, ls in cats.items():
        tarjetas = []
        for l in ls:
            t = html.escape(l['titulo'])
            tarjetas.append(
                f'        <a class="libro" href="{html.escape(l["archivo_pdf"])}" target="_blank" rel="noopener" data-t="{t.lower()}">\n'
                f'          <div class="portada"><img src="{html.escape(l["archivo_portada"])}" alt="" loading="lazy" '
                f'onerror="this.parentNode.classList.add(\'sin\');this.remove()"><span class="ph">{t}</span></div>\n'
                f'          <p>{t}</p>\n'
                f'        </a>')
        secciones.append(
            f'    <section id="{ancla(c)}">\n'
            f'      <h2>{html.escape(c)} <span class="count">{len(ls)}</span></h2>\n'
            f'      <div class="grid">\n' + '\n'.join(tarjetas) + '\n      </div>\n'
            f'    </section>')

    pagina = PLANTILLA.replace('{{TOTAL}}', str(total)).replace('{{NCATS}}', str(len(cats))) \
        .replace('{{TOC}}', toc).replace('{{SECCIONES}}', '\n'.join(secciones))
    open(SALIDA, 'w', encoding='utf-8', newline='\n').write(pagina)
    print(f'{SALIDA}: {total} documentos, {len(cats)} categorías')


PLANTILLA = '''<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Biblioteca Virtual UDHI</title>
<meta name="description" content="Biblioteca Virtual de la Universidad Dolores Hidalgo — {{TOTAL}} documentos en {{NCATS}} categorías.">
<style>
  :root {
    --azul: #0b3d66;
    --azul-claro: #1a6fb0;
    --fondo: #f7f9fb;
    --texto: #1c2b36;
    --borde: #dbe3ea;
    --gris: #6b7c88;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 5rem; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    margin: 0;
    background: var(--fondo);
    color: var(--texto);
    line-height: 1.45;
  }
  header {
    background: var(--azul);
    color: #fff;
    padding: 2.5rem 1rem 2rem;
    text-align: center;
  }
  header h1 { margin: 0 0 0.4rem; font-size: 1.9rem; }
  header p { margin: 0; opacity: 0.9; font-size: 0.95rem; }
  .barra {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--fondo);
    border-bottom: 1px solid var(--borde);
    padding: 0.8rem 1rem;
  }
  .barra input {
    display: block;
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding: 0.7rem 1rem;
    font-size: 1rem;
    border: 1px solid var(--borde);
    border-radius: 999px;
    background: #fff;
    color: var(--texto);
  }
  main { max-width: 1200px; margin: 0 auto; padding: 1.2rem 1rem 2rem; }
  nav.toc { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
  .chip {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: 999px;
    padding: 0.35rem 0.8rem;
    font-size: 0.88rem;
    color: var(--azul-claro);
    text-decoration: none;
  }
  .chip:hover { border-color: var(--azul-claro); }
  .chip span, .count { color: var(--gris); font-size: 0.85em; font-weight: normal; }
  section { margin-bottom: 2.2rem; }
  section h2 {
    color: var(--azul);
    border-bottom: 2px solid #e3ecf3;
    padding-bottom: 0.4rem;
    font-size: 1.25rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1.2rem 1rem;
  }
  .libro { color: var(--texto); text-decoration: none; display: block; min-width: 0; }
  .portada {
    aspect-ratio: 3 / 4;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(11, 61, 102, 0.08);
    transition: transform 0.15s, box-shadow 0.15s;
    position: relative;
  }
  .libro:hover .portada { transform: translateY(-3px); box-shadow: 0 6px 16px rgba(11, 61, 102, 0.18); }
  .portada img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .ph { display: none; }
  .portada.sin {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.8rem;
    background: linear-gradient(160deg, var(--azul), var(--azul-claro));
  }
  .portada.sin .ph { display: block; color: #fff; font-weight: 600; text-align: center; font-size: 0.9rem; }
  .libro p {
    margin: 0.5rem 0 0;
    font-size: 0.86rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .libro:hover p { color: var(--azul-claro); }
  .oculto { display: none !important; }
  #vacio { text-align: center; color: var(--gris); padding: 2rem 0; }
  footer { text-align: center; color: var(--gris); font-size: 0.85rem; padding: 2rem 1rem 3rem; }
  @media (max-width: 480px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
    header h1 { font-size: 1.5rem; }
  }
</style>
</head>
<body id="top">
<header>
  <h1>Biblioteca Virtual UDHI</h1>
  <p>Universidad Dolores Hidalgo — {{TOTAL}} documentos en {{NCATS}} categorías</p>
</header>
<div class="barra">
  <input id="q" type="search" placeholder="Buscar por título…" aria-label="Buscar por título">
</div>
<main>
  <nav class="toc">
{{TOC}}
  </nav>
{{SECCIONES}}
  <p id="vacio" class="oculto">Ningún documento coincide con la búsqueda.</p>
</main>
<footer>
  Biblioteca Virtual UDHI · biblioteca.udhi.edu.mx
</footer>
<script>
  (function () {
    var q = document.getElementById('q');
    var libros = document.querySelectorAll('.libro');
    var secciones = document.querySelectorAll('main section');
    var toc = document.querySelector('nav.toc');
    var vacio = document.getElementById('vacio');
    function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
    libros.forEach(function (l) { l.dataset.n = norm(l.dataset.t); });
    q.addEventListener('input', function () {
      var t = norm(q.value.trim()), hay = 0;
      libros.forEach(function (l) { var ok = !t || l.dataset.n.indexOf(t) > -1; l.classList.toggle('oculto', !ok); });
      secciones.forEach(function (s) {
        var n = s.querySelectorAll('.libro:not(.oculto)').length; hay += n;
        s.classList.toggle('oculto', n === 0);
      });
      toc.classList.toggle('oculto', !!t);
      vacio.classList.toggle('oculto', hay > 0);
    });
  })();
</script>
</body>
</html>
'''

if __name__ == '__main__':
    main()
