# Changelog

## 1.7.1

- The catalog door also lists a series' episodes, for the author's other plugins (std 1.10.0)

## 1.7.0

- Anime on the Home: three rows tagged as anime, so Kino's «Anime» shelf fills: new episodes (Japanese animation with an episode out this week), popular anime series and anime films
- Only what plays: the Home leaves out the titles the repository's snapshot found missing on the site (home/available.json, one small request kept 3 hours); the anime rows show only titles checked to play, and the snapshot checks them first
- An anime title appears in its anime row only, so Kino files it as anime and not as a plain series

## 1.6.10

- Categorías: every genre tile now shows a picture (a well-known TMDB backdrop per genre, no extra requests)

## 1.6.9

- A rich Home that opens at once: a ready slider (TMDB backdrops and synopses) and at least 4 rows, from a snapshot in this repository refreshed every 6 hours (the site only as a fallback) (std 1.8.1)

## 1.6.8

- Back arrow instead of the X: leaving goes back to where you came from (std 1.7.1)

## 1.6.7

- Catalog door: Da-Video finds titles here (std 1.7.0)

## 1.6.6

- Kino's own settings form shows again in Ajustes (settingsIn both); Retry keeps the queued work (std 1.6.2)

## 1.6.5

- Back closes the search box (the screen declares onBack while searching) instead of the whole screen (std 1.6.1)

## 1.6.4

- Tabs load again: the previous version used a timer Kino does not have, so every tab failed; a tab Kino cut short now offers Retry (std 1.6.0)

## 1.6.3

- Back closes the search box instead of the screen; a tab that takes too long offers Retry instead of skeletons; fewer TMDB lookups per tick (std 1.6.0)

## 1.6.2

- The standard screen catches up: a hero from TMDB backdrops when the site has none, TMDB lookups three at a time, one card shape per rail, a row's English title (std 1.5.1)

## 1.6.1

- Cards get their TMDB id again and slides their title logo (std 1.3.0): std 1.1.0 had stopped every TMDB lookup.

## 1.6.0

- The standard xuper-plugin screen (src/std 1.1.0): one bar with the logo and the name, Buscar (the words go to Kino's own search) and Ajustes (Kino's own form of the settings, and the donation); a hero of slides; cards and slides open Kino's own title page. The plugin's own title and search pages are gone. apiVersion 30 (Kino 0.9.91).

