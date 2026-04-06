const mongoose = require('mongoose');
const { encryptSensitiveData, decryptSensitiveData } = require('../../../shared/utils/encryption');

const accountSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  accountNumber: {
    type: String,
    required: true,
    unique: true
  },
  accountType: {
    type: String,
    enum: ['individual', 'corporate', 'fee'],
    required: true
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    default: 'USD'
  },
  balance: {
    type: mongoose.Decimal128,
    required: true,
    default: 0.0,
    min: 0
  },
  availableBalance: {
    type: mongoose.Decimal128,
    required: true,
    default: 0.0,
    min: 0
  },
  frozenAmount: {
    type: mongoose.Decimal128,
    required: true,
    default: 0.0,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'frozen', 'closed', 'suspended'],
    default: 'active'
  },
  kycLevel: {
    type: String,
    enum: ['none', 'basic', 'enhanced'],
    default: 'none'
  },
  limits: {
    dailyTransactionLimit: {
      type: mongoose.Decimal128,
      default: 10000.00
    },
    monthlyTransactionLimit: {
      type: mongoose.Decimal128,
      default: 100000.00
    },
    dailyTransactionCount: {
      type: Number,
      default: 100
    }
  },
  metadata: {
    type: mongoose.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
accountSchema.index({ userId: 1, currency: 1 });
accountSchema.index({ status: 1 });
accountSchema.index({ createdAt: -1 });

// Virtual for daily transaction count reset
accountSchema.virtual('dailyStats').get(function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    today: today,
    transactionCount: this.dailyTransactionCount || 0,
    transactionVolume: this.dailyTransactionVolume || 0
  };
});

// Pre-save middleware for encryption
accountSchema.pre('save', function(next) {
  if (this.isModified('metadata.encrypted') && this.metadata.encrypted) {
    try {
      // Encrypt sensitive data before saving
      const sensitiveData = {
        firstName: this.metadata.encrypted.firstName,
        lastName: this.metadata.encrypted.lastName,
        email: this.metadata.encrypted.email,
        phone: this.metadata.encrypted.phone,
        address: this.metadata.encrypted.address
      };
      
      const { encrypted, encryptedDataKey } = encryptSensitiveData(sensitiveData);
      this.metadata.encrypted = encrypted;
      this.metadata.encryptedDataKey = encryptedDataKey;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Instance methods
accountSchema.methods.toSafeJSON = function() {
  const obj = this.toObject();
  
  // Remove sensitive encrypted data
  delete obj.metadata.encrypted;
  delete obj.metadata.encryptedDataKey;
  
  // Convert Decimal128 to string for JSON serialization
  if (obj.balance) obj.balance = obj.balance.toString();
  if (obj.availableBalance) obj.availableBalance = obj.availableBalance.toString();
  if (obj.frozenAmount) obj.frozenAmount = obj.frozenAmount.toString();
  if (obj.limits) {
    if (obj.limits.dailyTransactionLimit) obj.limits.dailyTransactionLimit = obj.limits.dailyTransactionLimit.toString();
    if (obj.limits.monthlyTransactionLimit) obj.limits.monthlyTransactionLimit = obj.limits.monthlyTransactionLimit.toString();
  }
  
  return obj;
};

accountSchema.methods.getDecryptedData = function() {
  if (!this.metadata.encrypted || !this.metadata.encryptedDataKey) {
    return {};
  }
  
  try {
    return decryptSensitiveData(this.metadata.encrypted, this.metadata.encryptedDataKey);
  } catch (error) {
    throw new Error('Failed to decrypt account data');
  }
};

accountSchema.methods.hasSufficientBalance = function(amount) {
  const available = parseFloat(this.availableBalance.toString());
  const requested = parseFloat(amount.toString());
  return available >= requested;
};

accountSchema.methods.freezeAmount = function(amount) {
  const currentFrozen = parseFloat(this.frozenAmount.toString());
  const currentAvailable = parseFloat(this.availableBalance.toString());
  const freezeAmount = parseFloat(amount.toString());
  
  if (currentAvailable < freezeAmount) {
    throw new Error('Insufficient available balance to freeze');
  }
  
  this.frozenAmount = currentFrozen + freezeAmount;
  this.availableBalance = currentAvailable - freezeAmount;
};

accountSchema.methods.unfreezeAmount = function(amount) {
  const currentFrozen = parseFloat(this.frozenAmount.toString());
  const currentAvailable = parseFloat(this.availableBalance.toString());
  const unfreezeAmount = parseFloat(amount.toString());
  
  if (currentFrozen < unfreezeAmount) {
    throw new Error('Cannot unfreeze more than frozen amount');
  }
  
  this.frozenAmount = currentFrozen - unfreezeAmount;
  this.availableBalance = currentAvailable + unfreezeAmount;
};

accountSchema.methods.debit = function(amount) {
  const currentBalance = parseFloat(this.balance.toString());
  const currentFrozen = parseFloat(this.frozenAmount.toString());
  const debitAmount = parseFloat(amount.toString());
  
  if (currentFrozen < debitAmount) {
    throw new Error('Insufficient frozen amount for debit');
  }
  
  this.frozenAmount = currentFrozen - debitAmount;
  this.balance = currentBalance - debitAmount;
};

accountSchema.methods.credit = function(amount) {
  const currentBalance = parseFloat(this.balance.toString());
  const currentAvailable = parseFloat(this.availableBalance.toString());
  const creditAmount = parseFloat(amount.toString());
  
  this.balance = currentBalance + creditAmount;
  this.availableBalance = currentAvailable + creditAmount;
};

// Static methods
accountSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId, status: 'active' });
};

accountSchema.statics.findByAccountNumber = function(accountNumber) {
  return this.findOne({ accountNumber, status: 'active' });
};

accountSchema.statics.findActiveAccounts = function() {
  return this.find({ status: 'active' });
};

module.exports = mongoose.model('Account', accountSchema);
