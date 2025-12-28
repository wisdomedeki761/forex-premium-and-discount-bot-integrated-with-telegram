import aiClient from './ai.js';
import logger from '../utils/logger.js';

/**
 * Zone Analysis AI Client
 * Specialized AI analysis for premium/discount zones
 */
class ZoneAnalysisAI {
  constructor() {
    this.maxRetries = 3;
    this.probabilityThresholds = {
      high: 0.8,
      medium: 0.6,
      low: 0.4
    };
  }

  /**
   * Analyze zones and pick highest probability setups
   */
  async analyzeZones(zonesData) {
    try {
      logger.info(`🤖 Starting AI analysis of ${zonesData.length} zones`);

      // Format data for AI
      const formattedData = this.formatZonesForAI(zonesData);

      // Create AI prompt
      const prompt = this.createAnalysisPrompt(formattedData, zonesData.length);

      // Get AI response
      const aiResponse = await this.getAIResponse(prompt);

      if (!aiResponse) {
        logger.error('No AI response received');
        return null;
      }

      // Parse and validate AI response
      const analysisResult = this.parseAIResponse(aiResponse, zonesData);

      if (analysisResult) {
        logger.success(`✅ AI analysis complete: ${analysisResult.picks.length} picks selected`);
        return analysisResult;
      } else {
        logger.warn('Failed to parse AI response, using fallback analysis');
        return this.fallbackAnalysis(zonesData);
      }

    } catch (error) {
      logger.error('Error in zone analysis:', error.message);
      return this.fallbackAnalysis(zonesData);
    }
  }

  /**
   * Format zone data for AI consumption
   */
  formatZonesForAI(zonesData) {
    let formatted = '';

    zonesData.forEach((zone, index) => {
      formatted += `\n=== ZONE ${index + 1}: ${zone.symbol} (${zone.zoneType.toUpperCase()}) ===\n`;

      // Basic zone info
      formatted += `Entry Price: $${zone.entryPrice.toFixed(5)}\n`;
      formatted += `Zone Type: ${zone.zoneType}\n`;
      formatted += `Exchange: ${zone.exchange}\n`;

      // Multi-timeframe analysis
      if (zone.multiTimeframe) {
        formatted += `\nMULTI-TIMEFRAME ANALYSIS:\n`;

        if (zone.multiTimeframe['1H']) {
          const h1 = zone.multiTimeframe['1H'];
          formatted += `1H Trend: ${h1.analysis.trend} | Volatility: ${(h1.analysis.volatility * 100).toFixed(2)}%\n`;
          formatted += `1H Volume: ${h1.analysis.volumeTrend} | Range: $${h1.analysis.priceRange.low.toFixed(5)} - $${h1.analysis.priceRange.high.toFixed(5)}\n`;
        }

        if (zone.multiTimeframe['4H']) {
          const h4 = zone.multiTimeframe['4H'];
          formatted += `4H Trend: ${h4.analysis.trend} | Strength: ${h4.analysis.trend}\n`;
        }

        if (zone.multiTimeframe['1D']) {
          const d1 = zone.multiTimeframe['1D'];
          formatted += `Daily Trend: ${d1.analysis.trend}\n`;
        }
      }

      // Advanced indicators
      if (zone.indicators) {
        formatted += `\nTECHNICAL INDICATORS:\n`;

        if (zone.indicators.calculated) {
          const calc = zone.indicators.calculated;
          formatted += `Bollinger Position: ${calc.bollingerBands.position.toFixed(2)} std dev\n`;
          formatted += `ATR: ${(calc.atr * 100).toFixed(2)}% | ADX: ${calc.adx.toFixed(1)}\n`;
          formatted += `Trend Strength: ${calc.trendStrength}\n`;
        }

        if (zone.indicators.alphaVantage) {
          const av = zone.indicators.alphaVantage;
          if (av.rsi14) formatted += `RSI: ${av.rsi14.toFixed(2)}\n`;
          if (av.macd?.macd) formatted += `MACD: ${av.macd.macd.toFixed(5)}\n`;
        }
      }

      // Market structure
      if (zone.marketStructure) {
        formatted += `\nMARKET STRUCTURE:\n`;
        formatted += `Overall Trend: ${zone.marketStructure.trend}\n`;
        formatted += `Structure Strength: ${zone.marketStructure.structureStrength}\n`;

        if (zone.marketStructure.swingHighs.length > 0) {
          const recentHigh = Math.max(...zone.marketStructure.swingHighs.map(h => h.price));
          formatted += `Recent Swing High: $${recentHigh.toFixed(5)}\n`;
        }

        if (zone.marketStructure.swingLows.length > 0) {
          const recentLow = Math.min(...zone.marketStructure.swingLows.map(l => l.price));
          formatted += `Recent Swing Low: $${recentLow.toFixed(5)}\n`;
        }
      }

      // Fundamental factors
      if (zone.fundamental) {
        formatted += `\nFUNDAMENTAL FACTORS:\n`;

        if (zone.fundamental.currencyAnalysis) {
          const curr = zone.fundamental.currencyAnalysis;
          formatted += `Pair Type: ${curr.pairType} | Major Pair: ${curr.isMajorPair}\n`;
        }

        if (zone.fundamental.economicCalendar && zone.fundamental.economicCalendar.length > 0) {
          formatted += `Economic Events Today: ${zone.fundamental.economicCalendar.length}\n`;
          const highImpact = zone.fundamental.economicCalendar.filter(e => e.impact === 'high').length;
          if (highImpact > 0) formatted += `High Impact Events: ${highImpact}\n`;
        }
      }

      // Bot state
      if (zone.botState) {
        formatted += `\nBOT STATE:\n`;
        formatted += `Current State: ${zone.botState.state}\n`;
        if (zone.botState.lastPnL) formatted += `Last P&L: ${zone.botState.lastPnL}%\n`;
        if (zone.botState.consecutiveWins) formatted += `Win Streak: ${zone.botState.consecutiveWins}\n`;
      }

      formatted += `\n`;
    });

    return formatted;
  }

  /**
   * Create AI analysis prompt
   */
  createAnalysisPrompt(formattedData, zoneCount) {
    const pickCount = zoneCount >= 6 ? 2 : 1;

    return `You are an elite institutional trader specializing in premium/discount zone analysis with 15+ years of experience. You have a proven track record of identifying high-probability zone breakouts that lead to smooth, sustained moves.

ZONE ANALYSIS REQUEST:
${zoneCount} zones detected in the last hour. Analyze each zone and select the ${pickCount} pair(s) most likely to "play out smoothly" with high probability of success.

SELECTION CRITERIA (ranked by importance):

1. ZONE STRENGTH & SETUP QUALITY
   - EMA cascade alignment (20>38>62 for discount, 20<38<62 for premium)
   - Stochastic positioning (oversold <25 for discount, overbought >75 for premium)
   - Bollinger Band position (extreme positioning indicates stronger setups)
   - ATR volatility (moderate volatility preferred for smooth moves)

2. MULTI-TIMEFRAME CONFIRMATION
   - 4H and Daily trend alignment with 1H zone
   - Higher timeframe support/resistance levels
   - Volume confirmation across timeframes

3. MARKET STRUCTURE INTEGRITY
   - Clear swing points and trend structure
   - Strong market structure (not weak/choppy)
   - Order blocks and liquidity zones

4. TECHNICAL INDICATOR CONFLUENCE
   - RSI/MACD confirmation (not conflicting signals)
   - ADX trend strength (25+ preferred)
   - Volume trend (increasing preferred)

5. FUNDAMENTAL ALIGNMENT
   - No high-impact conflicting news/events
   - Currency strength analysis
   - Major pair preference for liquidity

6. RISK/REWARD PROFILE
   - Clear support/resistance targets
   - Reasonable stop loss levels
   - Minimum 1:2 reward-to-risk ratio

7. HISTORICAL PERFORMANCE FACTORS
   - Pair's historical zone success rate
   - Bot's recent performance with the pair
   - Consecutive wins/losses consideration

PROBABILITY SCORING SYSTEM:
- HIGH: 80%+ chance of smooth playout (2-4 hour timeframe)
- MEDIUM: 60-79% chance (4-8 hour timeframe)  
- LOW: 40-59% chance (8+ hour timeframe)

EXPECTED MOVE CALCULATION:
- Discount zones: Target = recent swing high + buffer
- Premium zones: Target = recent swing low - buffer
- Buffer = ATR * 1.5 (conservative) to ATR * 2.5 (aggressive)

TIMEFRAME ASSESSMENT:
- Scalp: 2-4 hours (high probability, smaller moves)
- Day: 4-8 hours (medium probability, moderate moves)
- Swing: 1-2 days (lower probability, larger moves)

${formattedData}

REQUIRED RESPONSE FORMAT (MANDATORY):
🎯 TOP PICKS:

1. PRIMARY: [SYMBOL] - [Brief 10-word reason]
   Probability: [HIGH/MEDIUM/LOW]
   Expected Move: [X.XX% to X.XX%]
   Timeframe: [2-4 hours / 4-8 hours / 1-2 days]

${pickCount === 2 ? `2. SECONDARY: [SYMBOL] - [Brief 10-word reason]
   Probability: [HIGH/MEDIUM/LOW]
   Expected Move: [X.XX% to X.XX%]
   Timeframe: [2-4 hours / 4-8 hours / 1-2 days]

` : ''}📊 ANALYSIS SUMMARY:
[2-3 sentence summary of market conditions and why these picks were selected]

⚠️ RISK FACTORS:
- [Risk factor 1]
- [Risk factor 2]
- [Risk factor 3]

💡 KEY INSIGHTS:
1. [Main technical insight]
2. [Main fundamental insight]
3. [Main risk management insight]

🎯 ENTRY/TARGET LEVELS:
1. Entry: $[X.XXXXX]
   Target: $[X.XXXXX] (Conservative) / $[X.XXXXX] (Aggressive)
   Stop Loss: $[X.XXXXX]
${pickCount === 2 ? `
2. Entry: $[X.XXXXX]
   Target: $[X.XXXXX] (Conservative) / $[X.XXXXX] (Aggressive)
   Stop Loss: $[X.XXXXX]` : ''}

Respond with ONLY the formatted analysis above. No additional text or explanations.`;
  }

  /**
   * Get AI response with retry logic
   */
  async getAIResponse(prompt) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`AI analysis attempt ${attempt}/${this.maxRetries}`);

        const messages = [
          {
            role: 'system',
            content: 'You are an elite institutional trader specializing in forex and crypto zone analysis. Provide clear, actionable analysis in the exact format requested. Focus on high-probability setups with smooth playout potential.'
          },
          {
            role: 'user',
            content: prompt
          }
        ];

        const response = await aiClient.generateResponse(messages, 5); // Allow AI client to try 5 model/key combinations

        if (response && response.content) {
          return response.content;
        }

      } catch (error) {
        logger.warn(`AI analysis attempt ${attempt} failed:`, error.message);

        if (attempt === this.maxRetries) {
          throw new Error(`AI analysis failed after ${this.maxRetries} attempts`);
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return null;
  }

  /**
   * Parse AI response into structured data
   */
  parseAIResponse(aiResponse, zonesData) {
    try {
      const result = {
        picks: [],
        summary: '',
        riskFactors: [],
        insights: [],
        levels: []
      };

      // Extract picks
      const pickMatches = aiResponse.match(/(\d+)\.\s+(PRIMARY|SECONDARY):\s+([A-Z]+).*?-\s*(.*?)\n\s*Probability:\s*(HIGH|MEDIUM|LOW).*?\n\s*Expected Move:\s*(.*?)\n\s*Timeframe:\s*(.*?)(?=\n\n|\n\d+\.|$)/gs);

      if (pickMatches) {
        pickMatches.forEach(match => {
          const lines = match.split('\n').map(line => line.trim());
          const symbolMatch = match.match(/(PRIMARY|SECONDARY):\s+([A-Z]+)/);
          const probMatch = match.match(/Probability:\s*(HIGH|MEDIUM|LOW)/);
          const moveMatch = match.match(/Expected Move:\s*(.*)/);
          const timeMatch = match.match(/Timeframe:\s*(.*)/);

          if (symbolMatch && probMatch) {
            const symbol = symbolMatch[2];
            const zoneData = zonesData.find(z => z.symbol === symbol);

            result.picks.push({
              symbol,
              zoneType: zoneData?.zoneType || 'unknown',
              probability: probMatch[1],
              expectedMove: moveMatch ? moveMatch[1] : 'Unknown',
              timeframe: timeMatch ? timeMatch[1] : 'Unknown',
              entryPrice: zoneData?.entryPrice || 0
            });
          }
        });
      }

      // Extract summary
      const summaryMatch = aiResponse.match(/📊 ANALYSIS SUMMARY:\s*\n(.*?)(?=\n\n⚠️|\n⚠️|$)/s);
      if (summaryMatch) {
        result.summary = summaryMatch[1].trim();
      }

      // Extract risk factors
      const riskMatch = aiResponse.match(/⚠️ RISK FACTORS:\s*\n(.*?)(?=\n\n💡|\n💡|$)/s);
      if (riskMatch) {
        result.riskFactors = riskMatch[1].split('\n')
          .map(line => line.replace(/^- /, '').trim())
          .filter(line => line.length > 0);
      }

      // Extract insights
      const insightMatch = aiResponse.match(/💡 KEY INSIGHTS:\s*\n(.*?)(?=\n\n🎯|\n🎯|$)/s);
      if (insightMatch) {
        result.insights = insightMatch[1].split('\n')
          .map(line => line.replace(/^\d+\. /, '').trim())
          .filter(line => line.length > 0);
      }

      // Extract entry/target levels
      const levelsMatch = aiResponse.match(/🎯 ENTRY\/TARGET LEVELS:\s*\n(.*?)$/s);
      if (levelsMatch) {
        const levelsText = levelsMatch[1];
        const levelBlocks = levelsText.split(/\d+\.\s+/).filter(block => block.trim());

        levelBlocks.forEach(block => {
          const entryMatch = block.match(/Entry:\s*\$([0-9.]+)/);
          const targetMatch = block.match(/Target:\s*\$([0-9.]+).*?\/\s*\$([0-9.]+)/);
          const stopMatch = block.match(/Stop Loss:\s*\$([0-9.]+)/);

          if (entryMatch) {
            result.levels.push({
              entryPrice: parseFloat(entryMatch[1]),
              targetPrice: targetMatch ? parseFloat(targetMatch[1]) : null,
              aggressiveTarget: targetMatch ? parseFloat(targetMatch[2]) : null,
              stopLoss: stopMatch ? parseFloat(stopMatch[1]) : null
            });
          }
        });
      }

      // Validate result has required data
      if (result.picks.length === 0) {
        logger.warn('No valid picks found in AI response');
        return null;
      }

      return result;

    } catch (error) {
      logger.error('Error parsing AI response:', error.message);
      return null;
    }
  }

  /**
   * Fallback analysis when AI fails
   */
  fallbackAnalysis(zonesData) {
    logger.info('Using fallback analysis for zones');

    // Simple scoring based on available data
    const scoredZones = zonesData.map(zone => {
      let score = 0;
      let reasons = [];

      // Zone strength scoring
      if (zone.indicators?.calculated) {
        const calc = zone.indicators.calculated;

        // Bollinger position (extreme = better)
        if (Math.abs(calc.bollingerBands.position) > 2) {
          score += 2;
          reasons.push('Extreme Bollinger position');
        }

        // ADX strength
        if (calc.adx > 25) {
          score += 1.5;
          reasons.push('Strong trend (ADX > 25)');
        }

        // ATR (moderate preferred)
        const normalizedAtr = calc.atr;
        if (normalizedAtr > 0.005 && normalizedAtr < 0.02) {
          score += 1;
          reasons.push('Moderate volatility');
        }
      }

      // Multi-timeframe alignment
      if (zone.multiTimeframe) {
        const h1Trend = zone.multiTimeframe['1H']?.analysis?.trend;
        const h4Trend = zone.multiTimeframe['4H']?.analysis?.trend;
        const d1Trend = zone.multiTimeframe['1D']?.analysis?.trend;

        if (h1Trend === h4Trend && h4Trend === d1Trend) {
          score += 2;
          reasons.push('Multi-timeframe alignment');
        }
      }

      // Market structure
      if (zone.marketStructure) {
        if (zone.marketStructure.structureStrength === 'strong') {
          score += 1.5;
          reasons.push('Strong market structure');
        }
      }

      // Fundamental (prefer major pairs, avoid high-impact news)
      if (zone.fundamental?.currencyAnalysis?.isMajorPair) {
        score += 1;
        reasons.push('Major pair (high liquidity)');
      }

      if (zone.fundamental?.economicCalendar) {
        const highImpactEvents = zone.fundamental.economicCalendar.filter(e => e.impact === 'high').length;
        if (highImpactEvents === 0) {
          score += 0.5;
          reasons.push('No high-impact news');
        }
      }

      return {
        ...zone,
        score,
        reasons,
        probability: score >= 4 ? 'HIGH' : score >= 2.5 ? 'MEDIUM' : 'LOW'
      };
    });

    // Sort by score and pick top zones
    scoredZones.sort((a, b) => b.score - a.score);
    const pickCount = zonesData.length >= 6 ? 2 : 1;
    const topPicks = scoredZones.slice(0, pickCount);

    return {
      picks: topPicks.map(pick => ({
        symbol: pick.symbol,
        zoneType: pick.zoneType,
        probability: pick.probability,
        expectedMove: '1.5% - 3.0%', // Conservative estimate
        timeframe: pick.probability === 'HIGH' ? '2-4 hours' : '4-8 hours',
        entryPrice: pick.entryPrice,
        score: pick.score,
        reasons: pick.reasons
      })),
      summary: `Fallback analysis selected ${pickCount} zone(s) based on technical strength scoring. AI analysis unavailable.`,
      riskFactors: [
        'AI analysis unavailable - using basic technical scoring',
        'Limited fundamental analysis',
        'No advanced pattern recognition'
      ],
      insights: [
        'Selected based on Bollinger extremes and trend alignment',
        'Prioritized major pairs with strong market structure',
        'Conservative profit targets due to limited analysis'
      ],
      isFallback: true
    };
  }
}

export default new ZoneAnalysisAI();
