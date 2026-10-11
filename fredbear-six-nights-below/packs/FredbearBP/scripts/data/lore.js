// Lore set pieces added in 1.3 (positions shared by the build plan, the
// command-block modules and the script). Local coordinates.

// 153 - the sealed 1983 birthday party in the old diner (CAM 20). The candles
// on the cake relight at the start of every night (module night.begin) and go
// out on every reset (night.end).
export const PARTY = Object.freeze({
  table: Object.freeze([44, 90, 54, 91]), // x1, z1, x2, z2 (slab table at the diner floor level)
  cake: Object.freeze([49, -8, 90]),
  candles: Object.freeze([[46, -8, 91], [52, -8, 91]]),
  stools: Object.freeze([[45, 89], [48, 89], [51, 89], [53, 89], [45, 92], [48, 92], [51, 92], [53, 92]]),
  presents: Object.freeze(/** @type {[number, number, string][]} */ ([[44, 93, 'red_wool'], [46, 93, 'yellow_wool'], [53, 93, 'lime_wool']])),
  banner: 'HAPPY 8TH\nBIRTHDAY\n- C. -\nAug 19, 1983',
});

// 156 - children's names scratched into the west wall of Fredbear's chamber.
// After night 6 the player's own name is added on NAME_SIGN (written by the script).
export const NAME_WALL = Object.freeze({
  x: 17, // signs stand in the first interior column and face east (wall at x 16)
  header: Object.freeze({ y: -5, z: 36, text: 'HE KNOWS\nEVERY CHILD\nBY NAME' }),
  names: Object.freeze(/** @type {[number, number, string][]} */ ([
    [-8, 30, 'TIMMY'], [-6, 31, 'SARA K.'], [-8, 32, 'J.R.'], [-6, 33, 'LUCY'],
    [-8, 34, 'ANDY'], [-6, 35, 'MIA'], [-8, 38, 'BEN'], [-6, 39, 'KAT'],
    [-8, 40, 'DEV'], [-6, 41, 'ROSE'], [-8, 42, 'LEO'], [-6, 37, 'NINA'],
  ])),
});
export const NAME_SIGN = Object.freeze({ x: 17, y: -7, z: 36 });

// 170 - 1987 construction crew graffiti in the west maintenance tunnel.
export const GRAFFITI = Object.freeze(/** @type {[string, number, number, string][]} */ ([
  ['w', 76, 2, "§4DON'T SEAL\n§4HIM IN"],
  ['e', 80, 2, '§4we can hear\n§4the music box\n§4from here'],
  ['w', 92, 1, '§4he sings\n§4at night'],
  ['e', 95, 2, '§4WHO ORDERED\n§4THE GRAY\n§4BEAR?'],
  ['w', 100, 2, '§4something\n§4scratches in\n§4the ducts'],
  ['e', 103, 1, '§4- crew, Oct 1987 -\n§4we never\n§4finished it'],
]));

// 157 - the 1987 security tapes, played on the office monitor (TAPE DECK).
// [camera, ticks, title, subtitle, echo node (a golden figure on that feed) | null]
export const TAPE = Object.freeze(/** @type {[string, number, string, string, string | null][]} */ ([
  ['C07', 80, '§7TAPE 3 · OCT 9 1987', '§f02:14 AM · the guard walks the west hall', null],
  ['C12', 80, '§702:31 AM', '§fsomething golden at the end of the east hall', 'EH_N'],
  ['C16', 70, '§702:47 AM', '§fthe old diner stage is empty', null],
  ['C17', 80, '§702:58 AM', '§fscratching under the office', 'SUB_N'],
  ['C13', 70, '§703:00 AM', '§4the hatch is pulled up from below', null],
  ['C01', 70, '§7TAPE ENDS', '§fThe guard was never found.', null],
]));
/** The tapes play once the 1987 clipping (night 5) has been unlocked. */
export const TAPE_UNLOCK_NIGHT = 5;
