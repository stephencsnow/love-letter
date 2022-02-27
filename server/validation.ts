import { ErrorResponse, Response } from "../api/base";
import { Card, CardType, PlayerInfo, UserId } from "../api/types";
import { allOtherPlayersAreShielded, handContains } from "./utils";

export function validateCardSelection(
  card: Card,
  playerHand: Card[]
): ErrorResponse | null {
  if (!handContains(playerHand, card.type)) {
    return Response.error("Cannot play card you don't have");
  }
  if (
    (card.type == CardType.PRINCE || card.type == CardType.KING) &&
    handContains(playerHand, CardType.COUNTESS)
  ) {
    return Response.error("Must play Countess if you possess Prince or King");
  }
  return null;
}

export function validateRequest(
  cardType: CardType,
  players: PlayerInfo[],
  currentPlayerId: UserId,
  selectedPlayer?: PlayerInfo,
  guardGuess?: CardType
): ErrorResponse | null {
  switch (cardType) {
    case CardType.GUARD:
      if (guardGuess == null) {
        return Response.error("Must provide guess if playing Guard.");
      }
      if (guardGuess == CardType.GUARD) {
        return Response.error("Cannot guess guard.");
      }
    case CardType.PRIEST:
    case CardType.BARON:
    case CardType.KING:
      if (!selectedPlayer) {
        return Response.error("Must select player.");
      }
      if (!selectedPlayer.isActive) {
        return Response.error("Must select active player.");
      }
      if (selectedPlayer.isShielded) {
        return Response.error("Cannot select player with Handmaiden effect.");
      }
      if (
        !allOtherPlayersAreShielded(players, currentPlayerId) &&
        selectedPlayer.id == currentPlayerId
      ) {
        return Response.error("Must select other player.");
      }
      break;
    case CardType.PRINCE:
      if (!selectedPlayer) {
        return Response.error("Must select player.");
      }
      if (!selectedPlayer.isActive) {
        return Response.error("Must select active player.");
      }
      if (selectedPlayer.isShielded) {
        return Response.error("Cannot select player with Handmaiden effect.");
      }
      break;
    case CardType.HANDMAID:
    case CardType.COUNTESS:
    case CardType.PRINCESS:
      if (selectedPlayer) {
        return Response.error("Cannot select player.");
      }
  }
  return null;
}
