# Changelog

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

