# Research DC and skills resolve across collections like reveal thresholds

A GM can set the research DC and the allowed skills per collection entry, so one creature in two collections can
have two of each. The card and the GM's judgement of a roll both take, among the entries the player can see, the
lowest DC and every allowed skill. That is what a player could already get by rolling from the more lenient
collection, so the collection a roll comes from no longer matters. Same reasoning as docs/adr/0001; storage is
unchanged.

## Consequences

The DC counts as set by the GM when the lowest one was; the skills count as set only when every entry sets them,
since a skill derived from the creature type would give the type away.
