const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    index: true
  },
  entryId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  accountNumber: {
    type: String,
    required: true,
    index: true
  },
  entryType: {
    type: String,
    enum: ['DEBIT', 'CREDIT'],
    required: true
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
  balanceBefore: {
    type: mongoose.Decimal128,
    required: true
  },
  balanceAfter: {
    type: mongoose.Decimal128,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['transfer', 'payment', 'fee', 'refund', 'payroll', 'fx_settlement', 'correction'],
    required: true
  },
  referenceId: {
    type: String,
    index: true
  },
  metadata: {
    fxRate: mongoose.Decimal128,
    originalAmount: mongoose.Decimal128,
    originalCurrency: String,
    quoteId: String,
    payrollJobId: String,
    employeeId: String,
    employerId: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  processedAt: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pending', 'processed', 'failed', 'reversed'],
    default: 'pending'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for performance
ledgerEntrySchema.index({ transactionId: 1, entryType: 1 });
ledgerEntrySchema.index({ accountNumber: 1, createdAt: -1 });
ledgerEntrySchema.index({ createdAt: -1 });
ledgerEntrySchema.index({ status: 1, createdAt: -1 });
ledgerEntrySchema.index({ category: 1, createdAt: -1 });

// Virtual for amount as string
ledgerEntrySchema.virtual('amountString').get(function() {
  return this.amount.toString();
});

// Pre-save middleware
ledgerEntrySchema.pre('save', function(next) {
  if (this.isNew) {
    this.entryId = `LED_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  next();
});

// Static methods for ledger operations
ledgerEntrySchema.statics.createDoubleEntry = async function(transactionData, session = null) {
  let ownSession = false;

  if (!session) {
    session = await mongoose.startSession();
    session.startTransaction();
    ownSession = true;
  }

  try {
    const {
      transactionId,
      debitAccount,
      creditAccount,
      amount,
      currency,
      description,
      category,
      metadata = {}
    } = transactionData;

    // Get current balances
    const Account = mongoose.model('Account');
    const debitAcc = await Account.findOne({ accountNumber: debitAccount }).session(session);
    const creditAcc = await Account.findOne({ accountNumber: creditAccount }).session(session);

    if (!debitAcc || !creditAcc) {
      throw new Error('One or both accounts not found');
    }

    // Create debit entry
    const debitEntry = new this({
      transactionId,
      accountNumber: debitAccount,
      entryType: 'DEBIT',
      amount,
      currency,
      balanceBefore: debitAcc.balance,
      balanceAfter: new mongoose.Types.Decimal128(
        (parseFloat(debitAcc.balance.toString()) - parseFloat(amount.toString())).toString()
      ),
      description,
      category,
      metadata
    });

    // Create credit entry
    const creditEntry = new this({
      transactionId,
      accountNumber: creditAccount,
      entryType: 'CREDIT',
      amount,
      currency,
      balanceBefore: creditAcc.balance,
      balanceAfter: new mongoose.Types.Decimal128(
        (parseFloat(creditAcc.balance.toString()) + parseFloat(amount.toString())).toString()
      ),
      description,
      category,
      metadata
    });

    // Save both entries
    await debitEntry.save({ session });
    await creditEntry.save({ session });

    // Update account balances
    debitAcc.debit(amount);
    creditAcc.credit(amount);
    
    await debitAcc.save({ session });
    await creditAcc.save({ session });

    // Mark entries as processed
    debitEntry.status = 'processed';
    debitEntry.processedAt = new Date();
    creditEntry.status = 'processed';
    creditEntry.processedAt = new Date();
    
    await debitEntry.save({ session });
    await creditEntry.save({ session });

    if (ownSession) {
      await session.commitTransaction();
    }
    
    return {
      debitEntry,
      creditEntry,
      debitAccount: debitAcc,
      creditAccount: creditAcc
    };
  } catch (error) {
    if (ownSession) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (ownSession) {
      session.endSession();
    }
  }
};

ledgerEntrySchema.statics.verifyLedgerIntegrity = async function() {
  try {
    const pipeline = [
      {
        $group: {
          _id: '$transactionId',
          totalDebits: {
            $sum: {
              $cond: [{ $eq: ['$entryType', 'DEBIT'] }, { $toDecimal: '$amount' }, 0]
            }
          },
          totalCredits: {
            $sum: {
              $cond: [{ $eq: ['$entryType', 'CREDIT'] }, { $toDecimal: '$amount' }, 0]
            }
          },
          entries: { $push: '$$ROOT' }
        }
      },
      {
        $addFields: {
          balance: { $subtract: ['$totalDebits', '$totalCredits'] }
        }
      },
      {
        $match: {
          balance: { $ne: 0 }
        }
      }
    ];

    const imbalancedTransactions = await this.aggregate(pipeline);
    
    return {
      isBalanced: imbalancedTransactions.length === 0,
      imbalancedTransactions,
      totalChecked: await this.countDocuments()
    };
  } catch (error) {
    throw new Error(`Ledger integrity check failed: ${error.message}`);
  }
};

ledgerEntrySchema.statics.getAccountBalance = async function(accountNumber, currency = null) {
  const matchCondition = { accountNumber };
  if (currency) {
    matchCondition.currency = currency;
  }

  const pipeline = [
    { $match: matchCondition },
    {
      $group: {
        _id: null,
        totalDebits: {
          $sum: {
            $cond: [{ $eq: ['$entryType', 'DEBIT'] }, { $toDecimal: '$amount' }, 0]
          }
        },
        totalCredits: {
          $sum: {
            $cond: [{ $eq: ['$entryType', 'CREDIT'] }, { $toDecimal: '$amount' }, 0]
          }
        }
      }
    },
    {
      $addFields: {
        balance: { $subtract: ['$totalCredits', '$totalDebits'] }
      }
    }
  ];

  const result = await this.aggregate(pipeline);
  return result.length > 0 ? result[0].balance.toString() : '0';
};

ledgerEntrySchema.statics.getTransactionHistory = async function(filters = {}, options = {}) {
  const {
    accountNumber,
    transactionId,
    category,
    startDate,
    endDate,
    page = 1,
    limit = 50
  } = filters;

  const query = {};
  
  if (accountNumber) query.accountNumber = accountNumber;
  if (transactionId) query.transactionId = transactionId;
  if (category) query.category = category;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const skip = (page - 1) * limit;
  
  const [entries, total] = await Promise.all([
    this.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    this.countDocuments(query)
  ]);

  return {
    entries,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
