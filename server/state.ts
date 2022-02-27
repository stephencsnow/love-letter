import { Card, PlayerInfo, UserId } from "../api/types";
import { InternalState } from "./impl";

export function getHand(state: InternalState, userId: UserId): Card[] {
  return state.hands.get(userId)!;
}

export function getPlayer(state: InternalState, userId: UserId): PlayerInfo {
  return state.players.find((player) => player.id == userId)!;
}
