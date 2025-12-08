/**
 * Calculate Exponential Moving Average
 * @param {number[]} prices - Array of prices
 * @param {number} period - EMA period
 * @returns {number[]} Array of EMA values
 */
export function calculateEMA(prices, period) {
  if (prices.length < period) {
    return [];
  }

  const emaValues = [];
  const multiplier = 2 / (period + 1);

  // Calculate initial SMA
  const initialSMA = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
  emaValues.push(initialSMA);

  // Calculate EMA for remaining values
  for (let i = period; i < prices.length; i++) {
    const ema = (prices[i] - emaValues[emaValues.length - 1]) * multiplier + emaValues[emaValues.length - 1];
    emaValues.push(ema);
  }

  return emaValues;
}

/**
 * Get latest EMA value
 * @param {number[]} prices - Array of prices
 * @param {number} period - EMA period
 * @returns {number|null} Latest EMA value
 */
export function getLatestEMA(prices, period) {
  const emaValues = calculateEMA(prices, period);
  return emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
}

export default {
  calculateEMA,
  getLatestEMA
};
