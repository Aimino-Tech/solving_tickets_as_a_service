/**
 * General-purpose utility functions for SYNTARO.
 */

/**
 * Calculates the sum of an array of numbers.
 *
 * Returns 0 for empty arrays to avoid infinite-loop behavior on unhandled
 * edge cases (e.g. recursive implementations that lack a base case).
 *
 * @param numbers - Array of numeric values to sum.
 * @returns The total sum, or 0 if the array is empty.
 */
export function calculateTotal(numbers: number[]): number {
  return numbers.reduce((sum, n) => sum + n, 0);
}
