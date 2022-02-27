import { Event, EventType, PlayerInfo, UserId } from "../api/types";
import { cardNameTitleCase } from "./cards";
import { InternalState } from "./impl";
import { fail } from "./utils";

export function resolveEvent(state: InternalState, event: Event) {
  state.playerEventLogs.forEach((log, userId) => {
    log.push(messageForEvent(state, event, userId));
  });
}

function messageForEvent(
  state: InternalState,
  event: Event,
  userId: UserId
): string {
  switch (event.type) {
    case EventType.DRAW:
      if (event.actor == userId) {
        return `You drew a ${cardNameTitleCase(event.actorCard!)}.`;
      } else {
        return `${event.actor} drew a card.`;
      }
    case EventType.PLAY:
      return `${event.actor} played a card.`; // TODO
    case EventType.TURN:
      if (state.activePlayer == userId) {
        return "It's your turn!";
      } else {
        return `It's ${state.activePlayer}'s turn.`;
      }
    case EventType.ROUND_START:
      return `New round. Scores: ${scoreString(state)}`;
    case EventType.ROUND_END:
      // TODO: Victory details?
      if (state.winner == userId) {
        return "You won the round! The love letter has been delivered to the princess.";
      } else {
        return `${state.winner} won the round, you'll get 'em next time!`;
      }
    case EventType.GAME_END:
      return "TODO";
  }

  fail("Unexhaustive!");
}

function scoreString(state: InternalState): string {
  return state.players.reduce((acc: string, player: PlayerInfo) => {
    if (acc) {
      acc += ", ";
    }
    return acc + `${player.id}: ${player.points}pts`;
  }, "");
}
