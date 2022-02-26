import { Methods, Context } from "./.hathora/methods";
import { Response } from "../api/base";
import {
  CardType,
  Card,
  PlayerInfo,
  PlayerState,
  UserId,
  IJoinGameRequest,
  IStartGameRequest,
  IPlayCardRequest,
  IDrawCardRequest,
} from "../api/types";

type InternalPlayerInfo = PlayerInfo;
type InternalState = {
  deck: Card[];
  discard: Card[];
  hands: Map<UserId, Card[]>;
  players: PlayerInfo[];
  activePlayer: UserId;
  winner?: UserId;
};

export class Impl implements Methods<InternalState> {
  initialize(userId: UserId, ctx: Context): InternalState {
    return {
      players: [createPlayer(userId)],
      activePlayer: userId,
      hands: new Map(),
      winner: undefined,
      deck: [],
      discard: [],
    };
  }
  joinGame(state: InternalState, userId: UserId, ctx: Context, request: IJoinGameRequest): Response {
    state.players.push(createPlayer(userId));
    return Response.ok();
  }
  startGame(state: InternalState, userId: UserId, ctx: Context, request: IStartGameRequest): Response {
    return Response.error("Not implemented");
  }
  playCard(state: InternalState, userId: UserId, ctx: Context, request: IPlayCardRequest): Response {
    return Response.error("Not implemented");
  }
  drawCard(state: InternalState, userId: UserId, ctx: Context, request: IDrawCardRequest): Response {
    return Response.error("Not implemented");
  }
  getUserState(state: InternalState, userId: UserId): PlayerState {
    return state;
  }
}

function createPlayer(id: UserId): InternalPlayerInfo {
  return {
    id,
    points: 0,
    hand: [],
    isActive: false,
  }
}