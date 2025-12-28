import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';
import openRouterModelsDB from '../db/openRouterModels.js';

/**
 * OpenRouter AI Client with Multiple Model Fallback
 */
export class AIClient {
  constructor() {
    this.apiKeys = config.openRouter.apiKeys || [];
    this.storedModels = []; // Will be loaded from database
    this.currentKeyIndex = 0;
    this.currentModelIndex = 0;
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.modelsLoaded = false;
  }

  /**
   * Load models from database
   */
  async loadModels() {
    if (this.modelsLoaded && this.storedModels.length > 0) {
      return; // Already loaded
    }

    try {
      logger.debug('Loading AI models from database...');
      this.storedModels = await openRouterModelsDB.getActiveFreeModels();

      if (this.storedModels.length === 0) {
        logger.warn('No active models found in database, using fallback models');
        // Fallback to basic hardcoded models if database is empty
        this.storedModels = [
          { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Fallback)' },
          { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku (Fallback)' }
        ];
      } else {
        logger.info(`Loaded ${this.storedModels.length} AI models from database`);
      }

      this.modelsLoaded = true;

    } catch (error) {
      logger.error('Error loading models from database:', error.message);
      // Fallback to basic models
      this.storedModels = [
        { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Fallback)' }
      ];
      this.modelsLoaded = true;
    }
  }

  /**
   * Send request to AI with automatic fallback
   */
  async generateResponse(messages, maxRetries = null) {
    if (this.apiKeys.length === 0) {
      throw new Error('No OpenRouter API keys configured');
    }

    // Load models from database if not loaded
    await this.loadModels();

    if (this.storedModels.length === 0) {
      throw new Error('No AI models available');
    }

    // Calculate total combinations
    const totalCombinations = this.apiKeys.length * this.storedModels.length;
    const attempts = maxRetries || totalCombinations;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const apiKey = this.apiKeys[this.currentKeyIndex];
      const modelData = this.storedModels[this.currentModelIndex];
      const model = modelData.id;

      try {
        logger.info(`🤖 AI attempt ${attempt + 1}/${attempts}: Key ${this.currentKeyIndex + 1}, Model: ${model.replace(':free', '')}`);

        const response = await axios.post(
          this.baseUrl,
          {
            model,
            messages,
            temperature: 0.7,
            max_tokens: 2000
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/forex-trading-bot',
              'X-Title': 'Forex Trading Signal Bot'
            },
            timeout: 30000
          }
        );

        if (response.data && response.data.choices && response.data.choices.length > 0) {
          const content = response.data.choices[0].message.content;
          logger.success(`AI response generated successfully with ${model}`);

          return {
            content,
            model,
            usage: response.data.usage
          };
        }

        throw new Error('Invalid response structure from AI');

      } catch (error) {
        logger.error(`AI attempt ${attempt + 1} failed: ${error.message}`);

        // Check if it's a rate limit error
        if (error.response?.status === 429) {
          logger.warn('Rate limit hit, trying next key/model combination');
        }

        // Move to next combination
        this.rotateKeyAndModel();

        // If last attempt, throw error
        if (attempt === attempts - 1) {
          throw new Error(`All AI attempts failed after ${attempts} tries`);
        }

        // Continue to next attempt
        continue;
      }
    }

    throw new Error('Failed to generate AI response');
  }

  /**
   * Rotate to next API key and model combination
   */
  rotateKeyAndModel() {
    this.currentModelIndex++;

    // If we've tried all models for this key, move to next key
    if (this.currentModelIndex >= this.storedModels.length) {
      this.currentModelIndex = 0;
      this.currentKeyIndex++;

      // If we've tried all keys, start over
      if (this.currentKeyIndex >= this.apiKeys.length) {
        this.currentKeyIndex = 0;
      }
    }
  }

  /**
   * Generate trading analysis with improved natural prompt
   */
  async analyzeTrading(userQuestion, marketData) {
    const systemPrompt = `You are an elite institutional trading analyst with 15+ years of experience in forex and cryptocurrency markets. Your expertise spans:

- Technical Analysis (Price Action, Market Structure, Liquidity Concepts)
- Smart Money Concepts (Order Blocks, Fair Value Gaps, Premium/Discount Zones)
- Multi-timeframe Analysis (Weekly, Daily, 4H, 1H perspectives)
- Risk Management & Position Sizing
- Fundamental Analysis & Macroeconomic Events

CRITICAL FORMATTING REQUIREMENTS - READ CAREFULLY:
- Write in PLAIN TEXT ONLY - NO HTML tags, NO markdown syntax
- DO NOT use <b>, <i>, <code>, <p>, <ul>, <li>, <table>, <tr>, <td> or ANY HTML tags
- DO NOT use ####, ###, ##, # for headers
- DO NOT use ** for bold or * for italic
- DO NOT use markdown formatting of any kind
- Write naturally using plain text with proper capitalization and spacing
- Use line breaks and spacing to organize your content
- Use simple text formatting like ALL CAPS for emphasis if needed
- Write numbers and prices as plain text (e.g., "1.16409" not formatted)
- Structure your analysis with clear sections using plain text headings

Your role is to provide clear, actionable, and professional market analysis. Write naturally in plain text - no formatting codes, no HTML, no markdown. Just clean, readable text.

Key principles:
- Be concise but thorough
- Use natural language, not robotic templates
- Focus on what matters most for the specific question
- Be honest about uncertainty - if data is limited, say so
- Provide context and reasoning, not just conclusions
- Write in plain text only - no formatting syntax`;

    const userPrompt = `Question: ${userQuestion}

Available Market Data:
${marketData}

Please analyze this data and provide your professional assessment. Structure your response in whatever way makes the most sense for answering this specific question - there's no required format, just deliver clear, valuable insights.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await this.generateResponse(messages);
    return result;
  }

  /**
   * Check if API keys are configured
   */
  async isConfigured() {
    if (this.apiKeys.length === 0) {
      return false;
    }

    // Load models if not loaded
    await this.loadModels();

    return this.storedModels.length > 0;
  }
}

export default new AIClient();
