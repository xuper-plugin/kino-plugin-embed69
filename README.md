# Embed 69 — plugin de Kino

Películas y series en **latino, castellano o subtituladas**, a través de [embed69.org](https://embed69.org), con el catálogo de
TMDB. Necesita Kino 0.9.55 o posterior.

Es la misma fuente que el plugin **Latino** trae entre las suyas (`src/sources/embed69.js` allá); este plugin va solo, con sus
propios extractores (StreamWish, VidHide y Voe).

## Instalar

En Kino: **Plugins ▸ Agregar un plugin ▸ Kino**, y pega la dirección de este repositorio.

## Qué trae

- **Inicio** con quince filas de TMDB (populares, en cines, próximos estrenos, mejor valoradas, series en emisión, películas por
  género y anime). Cada título lleva sus géneros, así el Inicio de Kino lo archiva en la fila de cada género.
- **Categorías** con los géneros de TMDB (películas y series), **búsqueda** y **episodios**.
- **Copias por idioma y servidor.** El sitio ofrece cada título en latino, castellano y subtitulado, en hasta tres servidores. El
  primero que abre se reproduce y los demás quedan en el menú **Servidor** (hasta ocho), sin abrirlos de antemano.
- **Idioma preferido** (ajuste): latino (por defecto), castellano o subtitulado; los otros dos van después. Dentro de cada idioma,
  primero StreamWish, luego VidHide y al final Voe.
- **Subtítulos y duración** que el propio reproductor del servidor revela, cuando los trae.
- **Descargas** sin conexión en el teléfono.
- Textos en español e inglés.

## Notas

- **Voe** sirve el video desde un dominio que cambia y pide "confirma que eres humano" a una petición normal, por eso solo abre
  con el navegador oculto de Kino (el manifest pide `browser`; se muestra en rojo al instalar). Sin él, esa copia no abre.
- **VidHide** responde lento a veces: si no contesta a tiempo, se salta.
- Kino muestra en rojo que el plugin "puede reproducir video desde cualquier servidor": los reproductores sirven desde CDN que
  cambian (`streamHosts: "any"`).
- Que haya o no un título depende del sitio, no del plugin.

## Desarrollo

```
npm run build                       # empaqueta src/ en plugin.js (esbuild)
node --test test/plugin.test.mjs    # sin red: un embed69.org simulado, con su prueba de trabajo y sus enlaces AES reales
node sdk/validate.mjs .             # el manifest, como lo revisa Kino
```

`plugin.js` está generado desde `src/`: edita `src/` y vuelve a empaquetar. `sdk/` y `contract.json` son el kit de pruebas abierto
de Kino (Apache-2.0). Usa este plugin con contenido que tengas derecho a ver.
