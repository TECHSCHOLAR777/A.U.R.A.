/**
 * Contextual Bandit Engine for AURA
 * Offline-first, Zero-PII, epsilon-greedy linear reward model.
 */

class BanditEngine {
  constructor() {
    this.epsilon = 0.1; // 10% exploration
    this.learningRate = 0.05; // SGD learning rate
    this.weights = {}; // Format: { "variantId_featureKey": weight }
  }

  /**
   * Initialize the engine with locally stored weights.
   * @param {Object} storedWeights 
   */
  loadWeights(storedWeights) {
    if (storedWeights) {
      this.weights = { ...storedWeights };
    }
  }

  /**
   * Get the current weights.
   * @returns {Object}
   */
  getWeights() {
    return this.weights;
  }

  /**
   * Extract boolean/categorical features from the context vector.
   * @param {Object} context - { ageMix: string, materials: string, domain: string }
   * @returns {Array<string>} list of feature keys
   */
  extractFeatures(context) {
    return [
      `ageMix:${context.ageMix || 'none'}`,
      `materials:${context.materials || 'none'}`,
      `domain:${context.domain || 'none'}`,
      `bias:1` // Bias term
    ];
  }

  /**
   * Predict the expected reward for a variant given the context.
   * @param {string} variantId 
   * @param {Array<string>} features 
   * @returns {number} expected reward
   */
  predictReward(variantId, features) {
    let score = 0;
    for (const feature of features) {
      const key = `${variantId}_${feature}`;
      score += this.weights[key] || 0;
    }
    return score;
  }

  /**
   * Choose the best variant using epsilon-greedy logic.
   * @param {Array<string>} variantIds 
   * @param {Object} context 
   * @returns {string} The chosen variantId
   */
  chooseVariant(variantIds, context) {
    if (!variantIds || variantIds.length === 0) return null;

    // Explore: random variant
    if (Math.random() < this.epsilon) {
      const randomIndex = Math.floor(Math.random() * variantIds.length);
      return variantIds[randomIndex];
    }

    // Exploit: best variant
    const features = this.extractFeatures(context);
    let bestVariant = variantIds[0];
    let maxReward = -Infinity;

    for (const variantId of variantIds) {
      const expectedReward = this.predictReward(variantId, features);
      if (expectedReward > maxReward) {
        maxReward = expectedReward;
        bestVariant = variantId;
      }
    }

    return bestVariant;
  }

  /**
   * Derive dynamic context from active session state.
   */
  getDynamicContext() {
    const activity = (window.MOCK && window.MOCK.eceActivity) || {};
    const domain = activity["targeted domain"] || activity.domain || 'general';
    const materialsArray = activity["required materials"] || activity.materials || ['none'];
    const materials = Array.isArray(materialsArray) ? materialsArray.join(',') : materialsArray;

    const roomState = window.SESSION || {};
    const ageMix = roomState.ageMix || 'mixed';

    return { ageMix, materials, domain };
  }

  /**
   * Update weights using Stochastic Gradient Descent based on the observed reward.
   * @param {string} variantId 
   * @param {number} reward - 1 for success/tapped-ok, 0 for failure/skip
   * @param {Object} [context] - Optional override. If not provided, dynamic context is used.
   * @returns {Object} The updated weights (for persisting)
   */
  async updateWeights(variantId, reward, context = null) {
    if (!context) {
      context = this.getDynamicContext();
    }
    const features = this.extractFeatures(context);
    const prediction = this.predictReward(variantId, features);
    const error = reward - prediction; // SGD error

    for (const feature of features) {
      const key = `${variantId}_${feature}`;
      const currentWeight = this.weights[key] || 0;
      // Linear SGD update rule: w = w + lr * error * x (where x=1 for present features)
      this.weights[key] = currentWeight + this.learningRate * error;
    }

    // Persist to Dexie and Queue for Sync
    if (typeof window.AURA_DB !== 'undefined') {
      await window.AURA_DB.saveBanditWeights(this.weights);
      
      // Enforce Zero-PII rule: Only anonymous context and weights logic. No child identifiers.
      const syncPayload = {
        op: 'bandit_sync',
        variant: variantId,
        context: context,
        error: error,
        timestamp: new Date().toISOString()
      };
      
      await window.AURA_DB.queue(syncPayload);
    }

    return this.weights;
  }
}

// Expose globally
window.AURA_BANDIT = new BanditEngine();
