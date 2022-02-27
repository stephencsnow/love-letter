import { Card, CardType } from "../api/types";

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

export function cardNameTitleCase(card: Card): string {
  const cardNameAllCaps = CardType[card.type];
  return cardNameAllCaps[0] + cardNameAllCaps.substring(1).toLowerCase();
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let [cardType, details] of CARD_DETAILS) {
    for (let i = 0; i < details.numInDeck; i++) {
      deck.push({ type: cardType });
    }
  }
  return deck;
}

export function getCardValue(card: Card): number {
  return CARD_DETAILS.get(card.type)!.value;
}
