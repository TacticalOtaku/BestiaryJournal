import test from "node:test";
import assert from "node:assert/strict";

import { collectVisibleEncounterUuids } from "../scripts/foundry/encounter.js";

const bestiaryData = {
  sections: [
    {
      id: "caves",
      name: "Caves",
      creatures: [
        { uuid: "Actor.goblin" },
        { uuid: "Actor.ambusher" },
        { uuid: "Actor.invisible" },
        { uuid: "Actor.hero" },
      ],
    },
  ],
};

test("collectVisibleEncounterUuids skips hidden combatants, hidden tokens, non-NPCs, and untracked actors", () => {
  const combat = {
    combatants: [
      { actor: { type: "npc", uuid: "Actor.goblin" }, hidden: false, token: { hidden: false } },
      { actor: { type: "npc", uuid: "Actor.ambusher" }, hidden: true, token: { hidden: false } },
      { actor: { type: "npc", uuid: "Actor.invisible" }, hidden: false, token: { hidden: true } },
      { actor: { type: "character", uuid: "Actor.hero" }, hidden: false, token: { hidden: false } },
      { actor: { type: "npc", uuid: "Actor.stranger" }, hidden: false, token: { hidden: false } },
      {
        actor: { type: "npc", uuid: "Scene.1.Token.1.Actor.x" },
        hidden: false,
        token: { hidden: false, baseActor: { uuid: "Actor.goblin" } },
      },
    ],
  };

  assert.deepEqual([...collectVisibleEncounterUuids(combat, bestiaryData)], ["Actor.goblin"]);
});

test("collectVisibleEncounterUuids handles missing combat or empty combatants safely", () => {
  assert.deepEqual([...collectVisibleEncounterUuids(null, bestiaryData)], []);
  assert.deepEqual([...collectVisibleEncounterUuids({ combatants: [] }, bestiaryData)], []);
});
