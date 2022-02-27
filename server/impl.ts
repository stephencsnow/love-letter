import { Methods, Context } from "./.hathora/methods";
import { Response } from "../api/base";
import {
  CardType,
  Card,
  PlayerInfo,
  PlayerState,
  UserId,
  Event,
  IJoinGameRequest,
  IStartGameRequest,
  IPlayCardRequest,
  IDrawCardMethodRequest,
  EventType,
  GameState,
} from "../api/types";
import { resolveEvent } from "./event";
import { createDeck, getCardValue } from "./cards";
import { getHand, getPlayer } from "./state";
import {
  createPlayer,
  drawCard,
  handleRoundEnd,
  maybeSetGameWinner,
  updateActivePlayer,
} from "./behavior";
import { allOtherPlayersAreShielded } from "./utils";
import { validateCardSelection, validateRequest } from "./validation";
import {
  resolveBaron,
  resolveGuard,
  resolveHandmaid,
  resolveKing,
  resolvePrince,
  resolvePrincess,
} from "./card-mechanics";

export type InternalState = {
  drawPile: Card[];
  discard: Card[];
  hands: Map<UserId, Card[]>;
  players: PlayerInfo[];
  activePlayer?: UserId;
  winner?: UserId;
  events: Event[];
  playerEventLogs: Map<UserId, string[]>;
  gameState: GameState;
  burntCard?: Card;
};

export class Impl implements Methods<InternalState> {
  initialize(userId: UserId, ctx: Context): InternalState {
    return {
      players: [],
      activePlayer: undefined,
      hands: new Map(),
      winner: undefined,
      drawPile: [],
      discard: [],
      events: [],
      playerEventLogs: new Map(),
      gameState: GameState.WAITING_TO_START_GAME,
    };
  }
  joinGame(
    state: InternalState,
    userId: UserId,
    ctx: Context,
    request: IJoinGameRequest
  ): Response {
    state.players.push(createPlayer(userId));
    state.hands.set(userId, []);
    state.playerEventLogs.set(userId, []);
    return Response.ok();
  }
  startGame(
    state: InternalState,
    userId: UserId,
    ctx: Context,
    request: IStartGameRequest
  ): Response {
    if (state.gameState == GameState.MID_ROUND) {
      return Response.error("Cannot perform this action at this time.");
    }
    if (state.players.length < 2) {
      return Response.error("At least 2 players required");
    }
    if (state.players.length > 4) {
      return Response.error("At most 4 players");
    }

    const deck = ctx.chance.shuffle(createDeck() as Card[]);
    state.burntCard = deck.pop()!;
    state.players.forEach((player) => {
      state.hands.set(player.id, [deck.pop()!]);
      player.isActive = true;
      player.isShielded = false;
    });
    state.drawPile = deck;
    state.discard = [];
    resolveEvent(state, { type: EventType.ROUND_START });

    if (state.winner) {
      // last round's winner goes first
      state.activePlayer = state.winner;
    } else {
      state.activePlayer = ctx.chance.pickone(state.players).id;
    }
    resolveEvent(state, { type: EventType.TURN });

    state.winner = undefined;
    state.gameState = GameState.MID_ROUND;

    return Response.ok();
  }
  drawCardMethod(
    state: InternalState,
    userId: UserId,
    ctx: Context,
    request: IDrawCardMethodRequest
  ): Response {
    if (state.activePlayer !== userId) {
      return Response.error("Not your turn");
    } else if (state.hands.get(userId)!.length !== 1) {
      return Response.error("Already drawn for this turn");
    }

    drawCard(state, userId);

    return Response.ok();
  }
  playCard(
    state: InternalState,
    userId: UserId,
    ctx: Context,
    request: IPlayCardRequest
  ): Response {
    if (state.activePlayer !== userId) {
      return Response.error("Not your turn");
    } else if (state.hands.get(userId)!.length !== 2) {
      return Response.error("Can only play if you hold 2 cards");
    }

    let error;
    error = validateCardSelection(request.card, state.hands.get(userId)!);
    if (error) {
      return error;
    }
    const selectedPlayer =
      request.player != null ? getPlayer(state, request.player) : undefined;
    error = validateRequest(
      request.card.type,
      state.players,
      userId,
      selectedPlayer,
      request.guardGuess
    );
    if (error) {
      return error;
    }

    const playerHand = getHand(state, userId);
    const cardIndex = playerHand.findIndex(
      (card) => card.type == request.card.type
    );
    const playedCard = playerHand.splice(cardIndex, 1)[0];
    state.discard.push(playedCard);

    // resolve card action
    if (
      allOtherPlayersAreShielded(state.players, userId) &&
      (request.card.type == CardType.GUARD ||
        request.card.type == CardType.PRIEST ||
        request.card.type == CardType.BARON ||
        request.card.type == CardType.KING)
    ) {
      // no-op
    } else {
      switch (playedCard.type) {
        case CardType.GUARD:
          resolveGuard(state, selectedPlayer!.id, request.guardGuess!);
          break;
        case CardType.PRIEST:
          break; // log only
        case CardType.BARON:
          resolveBaron(state, userId, selectedPlayer!.id);
          break;
        case CardType.HANDMAID:
          resolveHandmaid(state, userId);
          break;
        case CardType.PRINCE:
          resolvePrince(state, selectedPlayer!.id);
          break;
        case CardType.KING:
          resolveKing(state, userId, selectedPlayer!.id);
          break;
        case CardType.COUNTESS:
          break; // log only
        case CardType.PRINCESS:
          resolvePrincess(state, userId);
      }
    }

    resolveEvent(state, {
      actor: userId,
      target: selectedPlayer ? selectedPlayer.id : undefined,
      actorCard: playedCard,
      targetCard: selectedPlayer
        ? state.hands.get(selectedPlayer.id)![0]
        : undefined,
      guardGuess: request.guardGuess,
      type: EventType.PLAY,
    });

    maybeSetGameWinner(state);
    if (state.winner) {
      handleRoundEnd(state);
    } else {
      updateActivePlayer(state);
    }

    return Response.ok();
  }
  getUserState(state: InternalState, userId: UserId): PlayerState {
    return {
      players: state.players,
      activePlayer: state.activePlayer,
      winner: state.winner,
      eventLog: state.playerEventLogs.get(userId) || [],
      hand: state.hands.get(userId) || [],
      drawPileSize: state.drawPile.length,
      gameState: state.gameState,
    };
  }
}
