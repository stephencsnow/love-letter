import { Card, EventType, GameState, PlayerInfo, UserId } from "../api/types";
import { getCardValue } from "./cards";
import { resolveEvent } from "./event";
import { InternalState } from "./impl";
import { getHand, getPlayer } from "./state";

export function createPlayer(id: UserId): PlayerInfo {
  return {
    id,
    points: 0,
    isActive: true,
    isShielded: false,
  };
}

export function drawCard(state: InternalState, userId: string): Card {
  let drawnCard;
  if (state.drawPile.length == 0) {
    // Special condition in case a prince is used.
    drawnCard = state.burntCard!;
    state.burntCard = undefined;
  } else {
    drawnCard = state.drawPile.pop()!;
  }
  getHand(state, userId).push(drawnCard);

  resolveEvent(state, {
    actor: userId,
    type: EventType.DRAW,
    actorCard: drawnCard,
  });
  return drawnCard;
}

export function updateActivePlayer(state: InternalState) {
  const activePlayers = state.players.filter((player) => player.isActive);
  const currentPlayerIndex = activePlayers.findIndex(
    (player) => player.id == state.activePlayer
  );
  const nextPlayerIndex = (currentPlayerIndex + 1) % activePlayers.length;
  const nextPlayer = activePlayers.at(nextPlayerIndex)!;
  state.activePlayer = nextPlayer.id;
  nextPlayer.isShielded = false;

  resolveEvent(state, { type: EventType.TURN });
}

export function eliminatePlayer(state: InternalState, userId: UserId) {
  const player = getPlayer(state, userId);
  player.isActive = false;
  const hand = getHand(state, userId);
  if (hand.length != 0) {
    state.discard.push(hand.pop()!);
  }
}

export function maybeSetGameWinner(state: InternalState) {
  const winner = getWinner(state);
  if (winner) {
    state.winner = winner;
  }
}

function getWinner(state: InternalState): UserId | undefined {
  const activePlayers = state.players.filter((player) => player.isActive);
  if (activePlayers.length == 1) {
    return activePlayers[0].id;
  } else if (state.drawPile.length == 0) {
    // no cards remaining; must select winner
    const playersWithHighestCard = activePlayers
      .reduce((highest: [UserId, number][], player: PlayerInfo) => {
        const playerCardValue = getCardValue(getHand(state, player.id)[0]);
        if (highest.length == 0) {
          let newHighest: [UserId, number][] = [[player.id, playerCardValue]];
          return newHighest;
        }

        let highestCardValue = highest[0][1];
        if (playerCardValue == highestCardValue) {
          // tie
          highest.push([player.id, playerCardValue]);
          return highest;
        } else if (playerCardValue > highestCardValue) {
          // new highest
          let newHighest: [UserId, number][] = [[player.id, playerCardValue]];
          return newHighest;
        } else {
          // not highest, keep going
          return highest;
        }
      }, [])
      .map((entry) => entry[0]);

    // TODO: The true win condition is whichever player discard a higher point value in case of a tie
    return playersWithHighestCard[0];
  }

  return undefined;
}

export function handleRoundEnd(state: InternalState) {
  const winningPlayer = state.players.filter(
    (player) => player.id == state.winner
  )[0];
  winningPlayer.points += 1;
  state.gameState = GameState.WAITING_TO_START_ROUND;

  resolveEvent(state, {
    type: EventType.ROUND_END,
  });
}
