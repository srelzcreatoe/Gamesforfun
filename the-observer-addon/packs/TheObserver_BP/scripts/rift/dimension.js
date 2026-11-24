// @ts-check
// The Rift (1.6.0): a dimension of its own. Registered at startup (the stable custom-dimension API: a void world,
// no experiments); everything in it — the dead woods, the church, the castle — is built by the add-on.
import { system, world } from "@minecraft/server";

export const RIFT_ID = "observer:rift";
let registered = false;
let failure = "";

system.beforeEvents.startup.subscribe((ev) => {
  try {
    ev.dimensionRegistry.registerCustomDimension(RIFT_ID);
    registered = true;
  } catch (e) {
    failure = String(e);
    console.warn(`[Observer] the rift could not be registered: ${e}`);
  }
});

/** Is the rift there (registered this session)? */
export const riftReady = () => registered;
/** Why not, if not. */
export const riftFailure = () => failure;
/** The rift dimension, or undefined. */
export function rift() {
  if (!registered) return undefined;
  try {
    return world.getDimension(RIFT_ID);
  } catch {
    return undefined;
  }
}
/** @param {{dimension:{id:string}}|undefined} e */
export const inRift = (e) => !!e && e.dimension?.id === RIFT_ID;
