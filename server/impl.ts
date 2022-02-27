import { Methods, Context } from "./.hathora/methods";
import { ErrorResponse, Response } from "../api/base";
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
import { readlink } from "fs";
import { getSyntheticLeadingComments } from "typescript";

type InternalState = {
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

const CARD_DETAILS: Map<CardType, { numInDeck: number; value: number }> =
  new Map([
    [CardType.GUARD, { numInDeck: 5, value: 1 }],
    [CardType.PRIEST, { numInDeck: 2, value: 2 }],
    [CardType.BARON, { numInDeck: 2, value: 3 }],
    [CardType.HANDMAID, { numInDeck: 2, value: 4 }],
    [CardType.PRINCE, { numInDeck: 2, value: 5 }],
    [CardType.KING, { numInDeck: 1, value: 6 }],
    [CardType.COUNTESS, { numInDeck: 1, value: 7 }],
    [CardType.PRINCESS, { numInDeck: 1, value: 8 }],
  ]);

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

function drawCard(state: InternalState, userId: string): Card {
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

function createPlayer(id: UserId): PlayerInfo {
  return {
    id,
    points: 0,
    isActive: true,
    isShielded: false,
  };
}

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let [cardType, details] of CARD_DETAILS) {
    for (let i = 0; i < details.numInDeck; i++) {
      deck.push({ type: cardType });
    }
  }
  return deck;
}

function maybeSetGameWinner(state: InternalState) {
  const winner = getWinner(state);
  if (winner) {
    state.winner = winner;
  }
}

function handleRoundEnd(state: InternalState) {
  const winningPlayer = state.players.filter(
    (player) => player.id == state.winner
  )[0];
  winningPlayer.points += 1;
  state.gameState = GameState.WAITING_TO_START_ROUND;

  resolveEvent(state, {
    type: EventType.ROUND_END,
  });
}

function validateCardSelection(
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

function handContains(hand: Card[], cardType: CardType): boolean {
  return hand.filter((card) => card.type == cardType).length > 0;
}

function validateRequest(
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

function allOtherPlayersAreShielded(
  players: PlayerInfo[],
  currentPlayerId: UserId
): boolean {
  return players
    .filter((player) => player.id !== currentPlayerId)
    .every((player) => player.isShielded);
}

function resolveEvent(state: InternalState, event: Event) {
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

function cardNameTitleCase(card: Card): string {
  const cardNameAllCaps = CardType[card.type];
  return cardNameAllCaps[0] + cardNameAllCaps.substring(1).toLowerCase();
}

function scoreString(state: InternalState): string {
  return state.players.reduce((acc: string, player: PlayerInfo) => {
    if (acc) {
      acc += ", ";
    }
    return acc + `${player.id}: ${player.points}pts`;
  }, "");
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

function updateActivePlayer(state: InternalState) {
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

function fail(message: string): never {
  throw new Error(message);
}

// Resolvers
function resolveGuard(
  state: InternalState,
  selectedPlayerId: UserId,
  guardGuess: CardType
) {
  if (getHand(state, selectedPlayerId)[0].type == guardGuess) {
    eliminatePlayer(state, selectedPlayerId);
  }
}

function resolveBaron(
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

function resolveHandmaid(state: InternalState, userId: UserId) {
  getPlayer(state, userId).isShielded = true;
}

function resolvePrince(state: InternalState, selectedPlayerId: UserId) {
  const hand = getHand(state, selectedPlayerId);

  const discardedCard = hand.pop()!;
  state.discard.push(discardedCard);

  if (discardedCard.type == CardType.PRINCESS) {
    eliminatePlayer(state, selectedPlayerId);
  } else {
    drawCard(state, selectedPlayerId);
  }
}

function resolveKing(
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

function resolvePrincess(state: InternalState, userId: UserId) {
  eliminatePlayer(state, userId);
}

function getHand(state: InternalState, userId: UserId): Card[] {
  return state.hands.get(userId)!;
}

function getPlayer(state: InternalState, userId: UserId): PlayerInfo {
  return state.players.find((player) => player.id == userId)!;
}

function eliminatePlayer(state: InternalState, userId: UserId) {
  const player = getPlayer(state, userId);
  player.isActive = false;
  const hand = getHand(state, userId);
  if (hand.length != 0) {
    state.discard.push(hand.pop()!);
  }
}

function getCardValue(card: Card): number {
  return CARD_DETAILS.get(card.type)!.value;
}
