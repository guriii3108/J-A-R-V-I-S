/**
 * Seeded pseudo-random number generator for deterministic results
 * Uses a simple LCG (Linear Congruential Generator)
 */

export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
  }

  /**
   * Returns a pseudo-random number between 0 (inclusive) and 1 (exclusive)
   */
  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /**
   * Returns a pseudo-random number between min and max
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Returns a pseudo-random integer between min (inclusive) and max (inclusive)
   */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}
