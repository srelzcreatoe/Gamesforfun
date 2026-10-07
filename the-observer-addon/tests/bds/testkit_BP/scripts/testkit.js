import { system } from "@minecraft/server";
import { runProto } from "./proto.js";
import { runSpeed } from "./speed.js";
import { runSuite, checkRecovery, interruptSetup, measureTps } from "./suite.js";

const fail = (tag) => (e) => console.warn(`[OTEST] FAIL ${tag}_crash ${e} ${e && e.stack}`);
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id === "otest:speed") runSpeed().catch(fail("speed"));
  if (ev.id === "otest:proto") runProto().catch(fail("proto"));
  if (ev.id === "otest:suite") runSuite(ev.message.trim() ? ev.message.trim().split(/[\s,]+/) : []).catch(fail("suite"));
  if (ev.id === "otest:tps") measureTps().catch(fail("tps"));
  if (ev.id === "otest:recovery") checkRecovery().catch(fail("recovery"));
  if (ev.id === "otest:interrupt") interruptSetup().catch(fail("interrupt"));
});
system.run(() => console.warn("[OTEST] testkit loaded"));
