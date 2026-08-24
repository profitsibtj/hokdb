import { LanePosition } from "./types";
import laneTop from "./assets/lane-top.png";
import laneJungle from "./assets/lane-jungle.png";
import laneMid from "./assets/lane-mid.png";
import laneCarry from "./assets/lane-carry.png";
import laneSupport from "./assets/lane-support.png";
import laneFlex from "./assets/lane-flex.png";

// The actual in-game lane-select icons (confirmed against a screenshot of HOK's own "Prapilih
// Lane" screen - crossed swords/leaf/flame/wing/hook shapes), originally sourced from Liquipedia's
// asset CDN where they're used to mark player roles in esports team roster tables, but downloaded
// and bundled locally (src/assets) since liquipedia.net rejects hotlinked <img> requests from any
// other origin. Liquipedia names them after the MOBA-generic role terms (Top/Carry/Support) rather
// than HOK's own lane names, hence the mismatch between the object keys here and the file names.
// "Flex" (roster-only label, see LANE_POSITIONS in types.ts) uses Liquipedia's own generic
// "Fill" role icon (a six-point asterisk) - same source as the 5 real lanes above, just its own
// separate file rather than reusing one of theirs.
export const LANE_ICON_URLS: Record<LanePosition, string> = {
  "Clash Lane": laneTop,
  "Jungle": laneJungle,
  "Mid Lane": laneMid,
  "Farm Lane": laneCarry,
  "Roam": laneSupport,
  "Flex": laneFlex
};
