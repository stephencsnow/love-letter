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
  IDrawCardRequest,
  Action,
} from "../api/types";

type InternalPlayerInfo = PlayerInfo;
type InternalState = {
  drawPile: Card[];
  discard: Card[];
  hands: Map<UserId, Card[]>;
  players: PlayerInfo[];
  activePlayer?: UserId;
  winner?: UserId;
  events: Event[];
  playerEventLogs: Map<UserId, string[]>;
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
    if (state.players.length < 2) {
      return Response.error("At least 2 players required");
    } else if (state.players.length > 4) {
      return Response.error("At most 4 players");
    }

    const deck = ctx.chance.shuffle(createDeck() as Card[]);
    const burnt_card = deck.pop();
    state.players.forEach((player) => {
      state.hands.set(player.id, [deck.pop()!]);
    });
    state.drawPile = deck;
    state.activePlayer = ctx.chance.pickone(state.players).id;

    return Response.ok();
  }
  drawCard(
    state: InternalState,
    userId: UserId,
    ctx: Context,
    request: IDrawCardRequest
  ): Response {
    if (state.activePlayer !== userId) {
      return Response.error("Not your turn");
    } else if (state.hands.get(userId)!.length !== 1) {
      return Response.error("Already drawn for this turn");
    }

    const drawnCard = state.drawPile.pop()!;
    state.hands.get(userId)!.push(drawnCard);

    resolveEvent(
      {
        actor: userId,
        action: Action.DRAW,
        actorCard: drawnCard,
      },
      state
    );

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
      request.player !== undefined
        ? state.players.find((player) => player.id == request.player)
        : undefined;
    error = validateSelectedPlayer(
      request.card.type,
      state.players,
      userId,
      selectedPlayer
    );
    if (error) {
      return error;
    }

    const cardIndex = state.hands
      .get(userId)!
      .findIndex((card) => card.type == request.card.type);
    const playedCard = state.hands.get(userId)!.splice(cardIndex, 1)[0];
    state.discard.push(playedCard);

    resolveEvent(
      {
        actor: userId,
        target: selectedPlayer ? selectedPlayer.id : undefined,
        actorCard: playedCard,
        targetCard: selectedPlayer
          ? state.hands.get(selectedPlayer.id)![0]
          : undefined,
        guess: request.guessed,
        action: Action.PLAY,
      },
      state
    );

    updateActivePlayer(state);

    return Response.ok();
  }
  getUserState(state: InternalState, userId: UserId): PlayerState {
    return {
      players: state.players,
      activePlayer: state.activePlayer,
      winner: state.winner,
      eventLog: state.playerEventLogs.get(userId) || [],
      hand: state.hands.get(userId) || [],
    };
  }
}

function createPlayer(id: UserId): InternalPlayerInfo {
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

function validateSelectedPlayer(
  cardType: CardType,
  players: PlayerInfo[],
  currentPlayerId: UserId,
  selectedPlayer?: PlayerInfo
): ErrorResponse | null {
  switch (cardType) {
    case CardType.GUARD:
    case CardType.PRIEST:
    case CardType.BARON:
    case CardType.KING:
      if (!selectedPlayer) {
        return Response.error("Must select other player.");
      } else if (
        !allOtherPlayersAreShielded(players, currentPlayerId) &&
        selectedPlayer.id == currentPlayerId
      ) {
        return Response.error("Must select other player.");
      }
      break;
    case CardType.HANDMAID:
      if (!selectedPlayer || selectedPlayer.id !== currentPlayerId) {
        return Response.error("Must select self.");
      }
      break;
    case CardType.PRINCE:
      if (!selectedPlayer) {
        return Response.error("Must select player.");
      }
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

function resolveEvent(event: Event, state: InternalState) {
  state.playerEventLogs.forEach((log, userId) => {
    log.push(messageForEvent(event, userId));
  });
}

function messageForEvent(event: Event, userId: UserId): string {
  switch (event.action) {
    case Action.DRAW:
      if (event.actor == userId) {
        return `You drew a ${cardNameTitleCase(event.actorCard)}.`;
      } else {
        return `${event.actor} drew a card.`;
      }
    case Action.PLAY:
      return `${event.actor} played a card.`; // TODO
  }
  return "";
}

function cardNameTitleCase(card: Card): string {
  const cardNameAllCaps = CardType[card.type];
  return cardNameAllCaps[0] + cardNameAllCaps.substring(1).toLowerCase();
}

function getWinner(state: InternalState): UserId | null {
  const activePlayers = state.players.filter((player) => player.isActive);
  return activePlayers.length == 1 ? activePlayers[0].id : null;
}

function updateActivePlayer(state: InternalState) {
  const activePlayers = state.players.filter((player) => player.isActive);
  const currentPlayerIndex = activePlayers.findIndex(
    (player) => player.id == state.activePlayer
  );
  const nextPlayerIndex = (currentPlayerIndex + 1) % activePlayers.length;
  state.activePlayer = activePlayers.at(nextPlayerIndex)!.id;
}
