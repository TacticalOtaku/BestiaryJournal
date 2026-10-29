# Findings for the implementation (collected while building the variant C templates)

Things the mockups surfaced about the module itself. Each needs a decision or a fix when the redesign lands.

## Open questions for the user

- **Sidebar button location.** The code hooks `renderJournalDirectory` and ru.json says «во вкладке Журнал»; the brief
  assumed Actors. Keep Journal, or move/duplicate to Actors?
- **Share «Нечего» / «Обмен выключен»** are notifications today; the templates show them as dialog states.

## Localisation

- New keys used by the templates: a «Сбросить знание» title, confirm hints («Актёры мира останутся на месте…»,
  «Сбрасываются и заблокированные попытки…»).

## Behaviour gaps spotted

- Import file errors (not JSON, foreign module, empty) are only a notification; the templates show them inside the
  import dialog with «Выбрать другой файл».
- Bulk import sources: the real code offers world actors and compendiums; the templates also show world folders
  (decide whether to add folder sources).
