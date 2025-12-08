/**
 * Calculate RSI (Relative Strength Index)
 * @param {number[]} prices - Array of prices
 * @param {number} period - RSI period
 * @returns {number[]} Array of RSI values
 */
export function calculateRSI(prices, period) {
  if (prices.length < period + 1) {
    return [];
  }

  const rsiValues = [];

  for (let i = period; i < prices.length; i++) {
    const slice = prices.slice(i - period, i + 1);
    let gains = 0;
    let losses = 0;

    for (let j = 1; j < slice.length; j++) {
      const change = slice[j] - slice[j - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    rsiValues.push(rsi);
  }

  return rsiValues;
}

/**
 * Calculate Stochastic RSI
 * @param {number[]} prices - Array of prices
 * @param {number} rsiPeriod - RSI period
 * @param {number} stochPeriod - Stochastic period
 * @param {number} kPeriod - %K smoothing period
 * @param {number} dPeriod - %D smoothing period
 * @returns {{k: number[], d: number[]}} K and D values
 */
export function calculateStochasticRSI(prices, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
  const rsiValues = calculateRSI(prices, rsiPeriod);

  if (rsiValues.length < stochPeriod) {
    return { k: [], d: [] };
  }

  const stochRsiValues = [];

  // Calculate Stochastic RSI
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const rsiSlice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const minRsi = Math.min(...rsiSlice);
    const maxRsi = Math.max(...rsiSlice);

    const stochRsi = maxRsi === minRsi ? 0 : ((rsiValues[i] - minRsi) / (maxRsi - minRsi)) * 100;
    stochRsiValues.push(stochRsi);
  }

  // Calculate %K (SMA of Stochastic RSI)
  const kValues = [];
  for (let i = kPeriod - 1; i < stochRsiValues.length; i++) {
    const kSlice = stochRsiValues.slice(i - kPeriod + 1, i + 1);
    const k = kSlice.reduce((sum, val) => sum + val, 0) / kPeriod;
    kValues.push(k);
  }

  // Calculate %D (SMA of %K)
  const dValues = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    const dSlice = kValues.slice(i - dPeriod + 1, i + 1);
    const d = dSlice.reduce((sum, val) => sum + val, 0) / dPeriod;
    dValues.push(d);
  }

  return { k: kValues, d: dValues };
}

/**
 * Get latest Stochastic RSI K and D values
 * @param {number[]} prices - Array of prices
 * @param {number} rsiPeriod - RSI period
 * @param {number} stochPeriod - Stochastic period
 * @param {number} kPeriod - %K smoothing period
 * @param {number} dPeriod - %D smoothing period
 * @returns {{k: number, d: number}|null} Latest K and D values
 */
export function getLatestStochRSI(prices, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
  const { k, d } = calculateStochasticRSI(prices, rsiPeriod, stochPeriod, kPeriod, dPeriod);

  if (k.length === 0 || d.length === 0) {
    return null;
  }

  return {
    k: k[k.length - 1],
    d: d[d.length - 1]
  };
}

export default {
  calculateRSI,
  calculateStochasticRSI,
  getLatestStochRSI
};
