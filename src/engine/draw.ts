/** FMJD Annex 1, articles 6.1–6.4. Counts include the real game history. */
import { boardToFen, type Pos, type Move } from './core';
export interface DrawState {
  repetitions: Map<string, number>;
  kingOnlyPlies: number;
  endingLimit: 0 | 5 | 16;
  endingWhite: number;
  endingBlack: number;
}
export function endingLimit(pos: Pos): 0 | 5 | 16 {
  let wm = 0,
    wk = 0,
    bm = 0,
    bk = 0;
  for (const v of pos.b) {
    if (v === 1) wm++;
    if (v === 2) wk++;
    if (v === -1) bm++;
    if (v === -2) bk++;
  }
  const vsKing = (men: number, kings: number, otherMen: number, otherKings: number): 0 | 5 | 16 => {
    if (otherMen !== 0 || otherKings !== 1 || kings < 1) return 0;
    if (men + kings <= 2) return 5;
    if (men + kings === 3) return 16;
    return 0;
  };
  return vsKing(wm, wk, bm, bk) || vsKing(bm, bk, wm, wk);
}
export function initialDraw(pos: Pos): DrawState {
  return {
    repetitions: new Map([[boardToFen(pos.b, pos.side), 1]]),
    kingOnlyPlies: 0,
    endingLimit: endingLimit(pos),
    endingWhite: 0,
    endingBlack: 0,
  };
}
export function advanceDraw(state: DrawState, before: Pos, move: Move, after: Pos): DrawState {
  const irreversible = move.captures.length > 0 || Math.abs(before.b[move.from]) === 1;
  const repetitions = irreversible ? new Map<string, number>() : new Map(state.repetitions);
  const key = boardToFen(after.b, after.side);
  repetitions.set(key, (repetitions.get(key) ?? 0) + 1);
  const limit = endingLimit(after);
  const sameEnding = limit !== 0 && limit === state.endingLimit;
  return {
    repetitions,
    kingOnlyPlies: irreversible ? 0 : state.kingOnlyPlies + 1,
    endingLimit: limit,
    endingWhite: sameEnding ? state.endingWhite + (before.side === 1 ? 1 : 0) : 0,
    endingBlack: sameEnding ? state.endingBlack + (before.side === -1 ? 1 : 0) : 0,
  };
}
export function drawReason(pos: Pos, state: DrawState): string | null {
  if ((state.repetitions.get(boardToFen(pos.b, pos.side)) ?? 0) >= 3)
    return 'Троекратное повторение позиции';
  if (state.kingOnlyPlies >= 50) return '25 ходов каждой стороны без хода простой и без взятия';
  if (state.endingLimit && Math.min(state.endingWhite, state.endingBlack) >= state.endingLimit)
    return `${state.endingLimit} ходов каждой стороны в ограниченном окончании`;
  return null;
}
export function drawFromPositions(positions: Pos[], moves: Move[]): DrawState {
  let state = initialDraw(positions[0]);
  for (let i = 0; i < moves.length; i++)
    state = advanceDraw(state, positions[i], moves[i], positions[i + 1]);
  return state;
}
/** Exact history context prevents reusing a TT value from a different draw state. */
export function drawKey(state: DrawState): string {
  return `${state.kingOnlyPlies}/${state.endingLimit}/${state.endingWhite}/${state.endingBlack}/${[
    ...state.repetitions,
  ]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(';')}`;
}
