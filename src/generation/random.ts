import { hashString } from "../utils.js";

export interface RandomSource {
  next(): number;
  integer(minimum: number, maximum: number): number;
  pick<T>(values: readonly T[]): T;
  shuffle<T>(values: readonly T[]): T[];
}

export function createRandom(seed: string): RandomSource {
  let state = hashString(seed) || 0x9e3779b9;
  const next = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    integer(minimum, maximum) {
      return Math.floor(next() * (maximum - minimum + 1)) + minimum;
    },
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) throw new Error("Cannot pick from an empty collection");
      return values[Math.floor(next() * values.length)]!;
    },
    shuffle<T>(values: readonly T[]): T[] {
      const result = [...values];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const other = Math.floor(next() * (index + 1));
        [result[index], result[other]] = [result[other]!, result[index]!];
      }
      return result;
    },
  };
}
