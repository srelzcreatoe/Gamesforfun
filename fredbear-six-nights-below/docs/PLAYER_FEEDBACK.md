# Player feedback (open)

Notes from the map owner's in-game playthrough (campaign completed through night 6). Saved for later; nothing has been
changed for these yet.

## 1. Too few strobe charges

The strobe felt risky because there are too few charges.

* Current (`scripts/core/config.js`, `nights.*.strobeCharges`): night 4: 3, night 5: 3, night 6: 4, plus 2 at 5 AM
  (`finale.extraCharges`). A completed pre-shift task gives +1.
* Fredbear's attempts per night (`maxAttempts`): night 4: 2, night 5: 3, night 6: 4, plus 2 in the finale. On nights 5 and 6
  there is no spare charge, so a single stun or misfire means one attempt cannot be repelled.
* Idea when this is picked up: +1 to +2 charges on nights 4-6. The back-wall charge lamps only show 0-4 (`pwr.charges_4` =
  "4+"), so the lamps may need more steps if charges go above 4.

## 2. Fredbear always breaks down the doors and hatch

* Current behaviour (`scripts/core/ai/fredbear.js`): a closed door or hatch on its own never stops him. At the end of the
  music-box telegraph a closed barrier is forced (W2), then jammed open (W3). The only way to send him away is the strobe while
  the barrier is closed or jammed. With no charges left, every attempt ends with the barrier broken.
* This is how it was designed, but in play it reads as "he always breaks through". Options to weigh later: let a closed
  barrier sometimes hold him off, give longer forcing windows, make the "use the STROBE" moment clearer, or rely on fix 1
  (more charges) alone.
