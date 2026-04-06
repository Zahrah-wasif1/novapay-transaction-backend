const mongoose = require('mongoose');

const fxQuoteSchema = new mongoose.Schema({
  quoteId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: () => `FXQ_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`
  },
  sourceCurrency: {
    type: String,
    required: true,
    uppercase: true
  },
  targetCurrency: {
    type: String,
    required: true,
    uppercase: true
  },
  sourceAmount: {
    type: mongoose.Decimal128,
    required: true,
    min: 0
  },
  targetAmount: {
    type: mongoose.Decimal128,
    required: true,
    min: 0
  },
  exchangeRate: {
    type: mongoose.Decimal128,
    required: true
  },
  rateTimestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 60 * 1000)
  },
  status: {
    type: String,
    enum: ['active', 'used', 'expired'],
    default: 'active'
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  transactionId: {
    type: String,
    index: true
  },
  metadata: {
    provider: {
      type: String,
      default: 'internal'
    },
    providerQuoteId: String,
    fee: mongoose.Decimal128,
    feeCurrency: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  usedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// TTL index for automatic cleanup of expired quotes
fxQuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 }); // Keep for 1 hour after expiry

// Compound indexes
fxQuoteSchema.index({ status: 1, expiresAt: 1 });
fxQuoteSchema.index({ userId: 1, status: 1 });
fxQuoteSchema.index({ sourceCurrency: 1, targetCurrency: 1, status: 1 });

// Virtuals
fxQuoteSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiresAt;
});

fxQuoteSchema.virtual('timeRemaining').get(function() {
  const now = new Date();
  const remaining = this.expiresAt - now;
  return Math.max(0, Math.floor(remaining / 1000)); // seconds remaining
});

// Pre-save middleware
fxQuoteSchema.pre('save', function(next) {
  if (this.isNew) {
    this.quoteId = `FXQ_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Set expiry to 60 seconds from now
    if (!this.expiresAt) {
      this.expiresAt = new Date(Date.now() + 60 * 1000);
    }
    
    // Set rate timestamp to now if not provided
    if (!this.rateTimestamp) {
      this.rateTimestamp = new Date();
    }
  }
  next();
});

// Instance methods
fxQuoteSchema.methods.isValid = function() {
  return this.status === 'active' && !this.isExpired && !this.transactionId;
};

fxQuoteSchema.methods.markAsUsed = function(transactionId) {
  this.status = 'used';
  this.transactionId = transactionId;
  this.usedAt = new Date();
  return this.save();
};

fxQuoteSchema.methods.markAsExpired = function() {
  this.status = 'expired';
  return this.save();
};

fxQuoteSchema.methods.extendExpiry = function(seconds) {
  this.expiresAt = new Date(Date.now() + seconds * 1000);
  return this.save();
};

// Static methods
fxQuoteSchema.statics.createQuote = async function(quoteData) {
  const {
    sourceCurrency,
    targetCurrency,
    sourceAmount,
    exchangeRate,
    userId,
    metadata = {}
  } = quoteData;

  // Calculate target amount
  const sourceAmountDecimal = parseFloat(sourceAmount.toString());
  const exchangeRateDecimal = parseFloat(exchangeRate.toString());
  const targetAmount = (sourceAmountDecimal * exchangeRateDecimal).toString();

  const quote = new this({
    sourceCurrency,
    targetCurrency,
    sourceAmount,
    targetAmount,
    exchangeRate,
    userId,
    metadata
  });

  await quote.save();
  return quote;
};

fxQuoteSchema.statics.findValidQuote = async function(quoteId, userId) {
  const quote = await this.findOne({ 
    quoteId,
    userId,
    status: 'active'
  });

  if (!quote) {
    return null;
  }

  if (quote.isExpired) {
    await quote.markAsExpired();
    return null;
  }

  return quote;
};

fxQuoteSchema.statics.getExchangeRate = async function(sourceCurrency, targetCurrency) {
  // In production, this would call external FX provider
  // For now, returning mock rates
  const mockRates = {
    'USD-EUR': 0.92,
    'EUR-USD': 1.09,
    'USD-GBP': 0.79,
    'GBP-USD': 1.27,
    'USD-JPY': 149.50,
    'JPY-USD': 0.0067,
    'EUR-GBP': 0.86,
    'GBP-EUR': 1.16
  };

  const pair = `${sourceCurrency}-${targetCurrency}`;
  const rate = mockRates[pair];

  if (!rate) {
    throw new Error(`Exchange rate not available for ${sourceCurrency} to ${targetCurrency}`);
  }

  return {
    rate,
    timestamp: new Date(),
    source: 'mock-provider'
  };
};

fxQuoteSchema.statics.cleanupExpiredQuotes = async function() {
  const result = await this.updateMany(
    {
      status: 'active',
      expiresAt: { $lt: new Date() }
    },
    {
      status: 'expired'
    }
  );

  return {
    updatedCount: result.modifiedCount
  };
};

fxQuoteSchema.statics.getQuoteStats = async function(startDate, endDate) {
  const matchCondition = {};
  if (startDate && endDate) {
    matchCondition.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const pipeline = [
    { $match: matchCondition },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalSourceAmount: { $sum: { $toDecimal: '$sourceAmount' } },
        totalTargetAmount: { $sum: { $toDecimal: '$targetAmount' } }
      }
    }
  ];

  const stats = await this.aggregate(pipeline);
  return stats.reduce((acc, stat) => {
    acc[stat._id] = {
      count: stat.count,
      totalSourceAmount: stat.totalSourceAmount.toString(),
      totalTargetAmount: stat.totalTargetAmount.toString()
    };
    return acc;
  }, {});
};

module.exports = mongoose.model('FXQuote', fxQuoteSchema);
