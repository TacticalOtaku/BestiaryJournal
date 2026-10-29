# Bestiary Journal

A bestiary for the GM and players in which each player sees a creature only as far as their knowledge of it goes.

## Language

### Bestiary structure

**Creature**:
One dnd5e actor tracked by the bestiary, identified by its UUID wherever it appears.
_Avoid_: monster, actor (when the bestiary meaning is intended)

**Collection** («Коллекция»):
A named group of creatures, shown as a tile in the library.
_Avoid_: section, tile section

**Collection entry**:
One creature's place in one collection, with the GM's settings for it there. A creature can have entries in several collections.
_Avoid_: creature entry, record

**Family** («Семейство»):
A group of entries inside one collection.

### Knowledge

**Knowledge tier** («Ступень»):
How much one player knows about one creature: Unknown, Rumors, Studied or Mastered. It belongs to the player and the creature, not to a collection.
_Avoid_: level, research level

**Block**:
One piece of a creature's card that is revealed as a whole, such as its name, CR or actions.

**Reveal threshold**:
The knowledge tier from which a block, or a single item in it, is shown to players. «Только мастеру» means no tier reveals it.
_Avoid_: block tier, visibility level

**Viewer**:
Whoever a page is built for: the GM, one player, the GM previewing as a player, or the party.

**Party**:
All players taken together, used for what may be posted publicly. The party knows a creature only as far as its least-informed player does.

**Knowledge lens**:
What one viewer knows about one creature: the viewer's knowledge tier read against the creature's reveal thresholds. Every page asks the lens what to show.
_Avoid_: visibility check, show function
