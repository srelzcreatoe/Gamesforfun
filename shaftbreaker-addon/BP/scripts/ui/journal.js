// @ts-check
// Spelunker's Field Journal: an evidence-based guide. Entries unlock through what the player actually
// experiences, so the mechanics are discovered rather than explained up front.
import { system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { getP } from "../ai/players.js";
import { learnedLines, abilities } from "../ai/memory.js";
import { guard } from "../core/util.js";

export const ENTRIES = {
  sighting: ["Something in the Dark", "I saw it standing at the edge of my light. Tall. Too thin. It didn't move until I looked away, and then it was somewhere else.\n\nIt prefers to watch. Most of the time, it only watches."],
  standoff: ["The Standoff", "It came close and just... stared. Every second I held its gaze it seemed to wind tighter. When I looked away, it was nearer.\n\nBacking away slowly sometimes works. Touching it never does."],
  hunt: ["The Scream", "It screamed and came for me on all those long limbs. It is faster than me in short bursts, then it has to slow down. Corners help. Dodging its lunge buys a few seconds."],
  escape: ["I Got Away", "It lost me. It searched the places I might have hidden, slowly, listening. Then it went quiet.\n\nI think it remembers how I escaped. I should not do the same thing twice."],
  wounded: ["It Can Bleed", "I hurt it badly enough that it fled, shrieking. It will come back healed. But it CAN be hurt, and it CAN be killed."],
  killed: ["It Is Dead", "I killed it. The tunnels are quiet. For now.\n\nI kept one of its claws. Holding it, I can feel when something like it is near."],
  died: ["It Killed Me", "It caught me. Afterwards it left me alone for a while, as if it had made its point."],
  tunnel: ["The Far End", "I dig long, straight tunnels. Today, when I turned around, it was crouched at the far end of one, watching me work.\n\nIf I walk toward it, it will either vanish or come for me. If I stare too long, it gets restless."],
  surface: ["Not Safe in Daylight", "I ran for the surface. It followed me out into the open. It doesn't like it up here - but it has learned that I run this way."],
  escort: ["The Silent Escort", "It followed me to the mouth of the cave and simply stood there, watching me leave."],
  territory: ["The Hollow", "The stone here is veined with blood. Things grow on the ceiling. No animals come here - they seem afraid of it.\n\nThis is its home. It is stronger here, and it comes sooner."],
  organ: ["The Organs", "The glowing organs in the walls pulse like a heart. When I broke one, the whole cavern screamed. It came for me furious.\n\nBut with fewer organs left, it seems weaker in this place. An Organ Muffler quiets one without breaking it."],
  pod: ["Watcher Pods", "The pods open when I get close. I'm sure they are listening. Whatever they hear, it hears."],
  dwelling: ["The Dwelling", "A nest of flesh and ribs, littered with bones and droppings. A great heart beats in the middle of it.\n\nIf I destroy that heart, I think it will never come back to this place. I also think it would come for me one last time."],
  dwelling_destroyed: ["The Heart Is Gone", "The heart of the Dwelling is destroyed. The area around it should be safe from it now.\n\nSomething far below is very, very angry."],
  final: ["The Last Confrontation", "It came for me with everything it had. This one does not stop, does not search, does not get bored."],
  moth: ["Grinning Moths", "Moths with faces like its face. They perch near me and stare. When they giggle, I think it knows where I am."],
  flare: ["Light Hurts It", "A Glowspore Flare made it recoil and back away. It won't work forever - it gets used to things."],
  lure: ["Rattlebones", "A thrown Rattlebone draws it away to investigate the noise. It learns. The same trick works less each time."],
  phantom: ["Was It There?", "I saw it. I KNOW I saw it. I looked again and there was nothing. The heartbeat in my ears did not stop."],
  torches: ["The Lights Go Out", "My torches went out, one by one, with nobody near them. It has noticed how much I rely on light."],
  doors: ["Doors", "I heard the door open. Then close. Then open again. It knows what doors are now."],
  scratches: ["Claw Marks", "Long scratches in the stone, at different heights. Some look like something tried to climb. They weren't there yesterday."],
};

/** @param {import("@minecraft/server").Player | undefined} pl @param {string} id */
export function unlock(pl, id) {
  if (!pl || !ENTRIES[id]) return;
  guard("unlock", () => {
    const p = getP(pl);
    if (p.profile.journal.includes(id)) return;
    p.profile.journal.push(id);
    p.profDirty = true;
    system.runTimeout(() => guard("jnote", () => {
      pl.onScreenDisplay.setActionBar("§8§oField Journal: " + ENTRIES[id][0]);
      pl.playSound("item.book.page_turn", { volume: 0.6 });
    }), 60);
  });
}

/** Shows a form, retrying while the player is busy (e.g. chat open). */
export function showForm(pl, form, cb, tries = 0) {
  form.show(pl).then((r) => {
    if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy && tries < 10) {
      system.runTimeout(() => showForm(pl, form, cb, tries + 1), 10);
      return;
    }
    guard("formCb", () => cb(r));
  }).catch(() => { /* ignore */ });
}

/** @param {import("@minecraft/server").Player} pl */
export function openJournal(pl) {
  const p = getP(pl);
  const prof = p.profile;
  const ids = prof.journal.filter((id) => ENTRIES[id]);
  const f = new ActionFormData().title("Spelunker's Field Journal");
  f.body(`Encounters: ${prof.enc}   Sightings: ${prof.sightings}   Standoffs: ${prof.standoffs}\nHunts survived: ${prof.escapes}   Deaths: ${prof.deaths}   Kills: ${prof.kills}\n\n` +
    (ids.length ? "Pages written from what you have seen:" : "The pages are empty. Go underground. Something is waiting to be written about."));
  f.button("§4What it has learned about you");
  for (const id of ids) f.button(ENTRIES[id][0]);
  showForm(pl, f, (r) => {
    if (r.canceled || r.selection === undefined) return;
    if (r.selection === 0) {
      const ab = abilities(p);
      const active = Object.entries(ab).filter(([, v]) => v > 0).map(([k]) => k).join(", ") || "none yet";
      const g = new ActionFormData().title("What it has learned").body(learnedLines(p).join("\n\n") + `\n\n§8Active adaptations: ${active}`).button("Back");
      showForm(pl, g, (r2) => { if (!r2.canceled) openJournal(pl); });
      return;
    }
    const id = ids[r.selection - 1];
    const g = new ActionFormData().title(ENTRIES[id][0]).body(ENTRIES[id][1]).button("Back");
    showForm(pl, g, (r2) => { if (!r2.canceled) openJournal(pl); });
  });
}
