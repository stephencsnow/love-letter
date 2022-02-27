import { Card, CardType, PlayerInfo, UserId } from "../api/types";

export function fail(message: string): never {
  throw new Error(message);
}

export function handContains(hand: Card[], cardType: CardType): boolean {
  return hand.filter((card) => card.type == cardType).length > 0;
}

export function allOtherPlayersAreShielded(
  players: PlayerInfo[],
  currentPlayerId: UserId
): boolean {
  return players
    .filter((player) => player.id !== currentPlayerId)
    .every((player) => player.isShielded);
}
