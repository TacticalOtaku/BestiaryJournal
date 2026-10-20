# Findings for the implementation (collected while building the variant C templates)

Things the mockups surfaced about the module itself. Each needs a decision or a fix when the redesign lands.

## Open questions for the user

- **Family of an unknown creature.** A player sees the family tab / group of a tier-0 creature (e.g. «Порождения
  глубин» for the Аболет), which hints at what it is. Options: show as now, or move unknown creatures into a neutral
  «Неопознанные» group for players.

- **Research panel hints at hidden data.** The DC shown to a player is derived from CR when the GM set none, and the
  auto skill from the creature type. A player who does not know CR or type can infer them («Сл 18» ⇒ CR ≈ 21,
  «Религия» ⇒ нежить/небожитель/исчадие). Options: keep, or show DC/skill only when the CR/type block is open (or when
  the GM set them explicitly).

- **Sidebar button location.** The code hooks `renderJournalDirectory` and ru.json says «во вкладке Журнал»; the brief
  assumed Actors. Keep Journal, or move/duplicate to Actors?
- **Share «Нечего» / «Обмен выключен»** are notifications today; the templates show them as dialog states.

## Localisation

- New keys used by the templates: a «Сбросить знание» title, confirm hints («Актёры мира останутся на месте…»,
  «Сбрасываются и заблокированные попытки…»).

- `ru.json` summaries use fixed word forms («{sections} коллекций», «{count} существ»). Russian needs plural forms
  (1 коллекция, 2 коллекции, 5 коллекций). Add a plural helper and keys.

## Behaviour gaps spotted

- Import file errors (not JSON, foreign module, empty) are only a notification; the templates show them inside the
  import dialog with «Выбрать другой файл».
- `exportCreatureEntry` shows no notification after export.
- Foundry `DialogV2.confirm` buttons say «Да» / «Нет»; the templates name the action («Заменить всё» / «Отмена»).
- Bulk import sources: the real code offers world actors and compendiums; the templates also show world folders
  (decide whether to add folder sources).
