const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  payloadHash: {
    type: String,
    required: true
  },
  transactionId: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'expired'],
    default: 'pending'
  },
  response: {
    type: mongoose.Schema.Types.Mixed
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// TTL index for automatic cleanup
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['transfer', 'payment', 'payroll', 'fx_transfer', 'refund', 'fee'],
    required: true
  },
  status: {
    type: String,
    enum: ['initiated', 'processing', 'completed', 'failed', 'reversed'],
    default: 'initiated'
  },
  amount: {
    type: mongoose.Decimal128,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    uppercase: true
  },
  sourceAccount: {
    type: String,
    required: true
  },
  destinationAccount: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    idempotencyKey: String,
    quoteId: String,
    fxRate: mongoose.Decimal128,
    originalAmount: mongoose.Decimal128,
    originalCurrency: String,
    payrollJobId: String,
    employeeId: String,
    employerId: String,
    processingAttempts: {
      type: Number,
      default: 0
    },
    lastError: String,
    completedAt: Date
  },
  fees: [{
    type: {
      type: String,
      enum: ['processing', 'fx', 'transfer', 'payroll'],
      required: true
    },
    amount: {
      type: mongoose.Decimal128,
      required: true
    },
    currency: {
      type: String,
      required: true
    },
    account: String
  }],
  ledgerEntries: [{
    entryId: String,
    type: {
      type: String,
      enum: ['DEBIT', 'CREDIT']
    },
    accountNumber: String,
    amount: mongoose.Decimal128,
    currency: String
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ sourceAccount: 1, createdAt: -1 });
transactionSchema.index({ destinationAccount: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ 'metadata.idempotencyKey': 1 });

// Virtual for amount as string
transactionSchema.virtual('amountString').get(function() {
  return this.amount.toString();
});

// Pre-save middleware
transactionSchema.pre('save', function(next) {
  if (this.isNew) {
    this.transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
  next();
});

// Instance methods
transactionSchema.methods.canRetry = function() {
  return this.status === 'failed' && (this.metadata.processingAttempts || 0) < 3;
};

transactionSchema.methods.incrementRetryAttempt = function(error) {
  this.metadata.processingAttempts = (this.metadata.processingAttempts || 0) + 1;
  this.metadata.lastError = error;
  this.updatedAt = new Date();
};

transactionSchema.methods.markCompleted = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  this.metadata.completedAt = new Date();
  this.updatedAt = new Date();
};

transactionSchema.methods.markFailed = function(error) {
  this.status = 'failed';
  this.metadata.lastError = error;
  this.updatedAt = new Date();
};

// Static methods for idempotency
transactionSchema.statics.checkIdempotency = async function(key, payloadHash) {
  const existingKey = await mongoose.model('IdempotencyKey').findOne({ key });
  
  if (!existingKey) {
    return { exists: false };
  }
  
  // Check if key has expired
  if (existingKey.expiresAt < new Date()) {
    await mongoose.model('IdempotencyKey').deleteOne({ key });
    return { exists: false, expired: true };
  }
  
  // Check payload hash for mismatch
  if (existingKey.payloadHash !== payloadHash) {
    throw new Error('Idempotency key exists but payload mismatch detected');
  }
  
  return {
    exists: true,
    transactionId: existingKey.transactionId,
    status: existingKey.status,
    response: existingKey.response
  };
};

transactionSchema.statics.createIdempotencyKey = async function(key, payloadHash, transactionId) {
  const expiresAt = new Date(Date.now() + (parseInt(process.env.IDEMPOTENCY_KEY_TTL) || 86400) * 1000);
  
  const idempotencyKey = new mongoose.model('IdempotencyKey')({
    key,
    payloadHash,
    transactionId,
    expiresAt
  });
  
  await idempotencyKey.save();
  return idempotencyKey;
};

transactionSchema.statics.updateIdempotencyResponse = async function(key, status, response) {
  await mongoose.model('IdempotencyKey').updateOne(
    { key },
    { 
      status,
      response,
      updatedAt: new Date()
    }
  );
};

// Static methods for transaction operations
transactionSchema.statics.findPendingTransactions = function() {
  return this.find({ 
    status: { $in: ['initiated', 'processing'] },
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
  });
};

transactionSchema.statics.findFailedTransactions = function() {
  return this.find({ 
    status: 'failed',
    'metadata.processingAttempts': { $lt: 3 },
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  });
};

transactionSchema.statics.getTransactionStats = async function(startDate, endDate) {
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
        totalAmount: { $sum: { $toDecimal: '$amount' } }
      }
    }
  ];

  const stats = await this.aggregate(pipeline);
  return stats.reduce((acc, stat) => {
    acc[stat._id] = {
      count: stat.count,
      totalAmount: stat.totalAmount.toString()
    };
    return acc;
  }, {});
};

// Cleanup method for expired idempotency keys
transactionSchema.statics.cleanupExpiredKeys = async function() {
  const result = await mongoose.model('IdempotencyKey').deleteMany({
    expiresAt: { $lt: new Date() }
  });
  
  return {
    deletedCount: result.deletedCount
  };
};

const IdempotencyKey = mongoose.model('IdempotencyKey', idempotencyKeySchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = { Transaction, IdempotencyKey };
