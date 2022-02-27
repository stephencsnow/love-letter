import { CardType, UserId } from "../api/types";
import { drawCard, eliminatePlayer } from "./behavior";
import { getCardValue } from "./cards";
import { InternalState } from "./impl";
import { getHand, getPlayer } from "./state";

export function resolveGuard(
  state: InternalState,
  selectedPlayerId: UserId,
  guardGuess: CardType
) {
  if (getHand(state, selectedPlayerId)[0].type == guardGuess) {
    eliminatePlayer(state, selectedPlayerId);
  }
}

export function resolveBaron(
  state: InternalState,
  userId: UserId,
  selectedPlayerId: UserId
) {
  const actorCardValue = getCardValue(getHand(state, userId)[0]);
  const targetCardValue = getCardValue(getHand(state, selectedPlayerId)[0]);

  if (actorCardValue == targetCardValue) {
    // nothing in case of tie
    return;
  }

  actorCardValue > targetCardValue
    ? eliminatePlayer(state, selectedPlayerId)
    : eliminatePlayer(state, userId);
}

export function resolveHandmaid(state: InternalState, userId: UserId) {
  getPlayer(state, userId).isShielded = true;
}

export function resolvePrince(state: InternalState, selectedPlayerId: UserId) {
  const hand = getHand(state, selectedPlayerId);

  const discardedCard = hand.pop()!;
  state.discard.push(discardedCard);

  if (discardedCard.type == CardType.PRINCESS) {
    eliminatePlayer(state, selectedPlayerId);
  } else {
    drawCard(state, selectedPlayerId);
  }
}

export function resolveKing(
  state: InternalState,
  userId: UserId,
  selectedPlayerId: UserId
) {
  const actorHand = getHand(state, userId);
  const targetHand = getHand(state, selectedPlayerId);
  const actorCard = actorHand.pop()!;
  const targetCard = targetHand.pop()!;

  actorHand.push(targetCard);
  targetHand.push(actorCard);
}

export function resolvePrincess(state: InternalState, userId: UserId) {
  eliminatePlayer(state, userId);
}
