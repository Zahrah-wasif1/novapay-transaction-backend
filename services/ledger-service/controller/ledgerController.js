const express = require('express');
const LedgerEntry = require('../models/Ledger');
const Account = require('../../account-service/models/Account');
const logger = require('../../../shared/utils/logger');

const router = express.Router();

// Get ledger entry by ID
router.get('/entries/:entryId', async (req, res) => {
  const requestId = req.requestId;
  const { entryId } = req.params;

  try {
    const entry = await LedgerEntry.findOne({ entryId });
    
    if (!entry) {
      return res.status(404).json({
        error: 'Ledger entry not found',
        requestId
      });
    }

    res.json({
      entry: {
        entryId: entry.entryId,
        transactionId: entry.transactionId,
        accountNumber: entry.accountNumber,
        entryType: entry.entryType,
        amount: entry.amount.toString(),
        currency: entry.currency,
        balanceBefore: entry.balanceBefore.toString(),
        balanceAfter: entry.balanceAfter.toString(),
        description: entry.description,
        category: entry.category,
        status: entry.status,
        createdAt: entry.createdAt,
        processedAt: entry.processedAt
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get ledger entry', {
      requestId,
      error: error.message,
      entryId
    });

    res.status(500).json({
      error: 'Failed to retrieve ledger entry',
      requestId
    });
  }
});

// Get transaction ledger entries
router.get('/transactions/:transactionId', async (req, res) => {
  const requestId = req.requestId;
  const { transactionId } = req.params;

  try {
    const entries = await LedgerEntry.find({ transactionId }).sort({ createdAt: 1 });
    
    if (!entries || entries.length === 0) {
      return res.status(404).json({
        error: 'No ledger entries found for this transaction',
        requestId
      });
    }

    const formattedEntries = entries.map(entry => ({
      entryId: entry.entryId,
      accountNumber: entry.accountNumber,
      entryType: entry.entryType,
      amount: entry.amount.toString(),
      currency: entry.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      description: entry.description,
      category: entry.category,
      status: entry.status,
      createdAt: entry.createdAt,
      processedAt: entry.processedAt
    }));

    res.json({
      transactionId,
      entries: formattedEntries,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get transaction ledger entries', {
      requestId,
      error: error.message,
      transactionId
    });

    res.status(500).json({
      error: 'Failed to retrieve ledger entries',
      requestId
    });
  }
});

// Get account ledger entries
router.get('/accounts/:accountNumber', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const { 
    page = 1, 
    limit = 50, 
    startDate, 
    endDate, 
    category,
    entryType 
  } = req.query;

  try {
    const filters = {
      accountNumber,
      startDate,
      endDate,
      page: parseInt(page),
      limit: parseInt(limit),
      ...(category && { category }),
      ...(entryType && { entryType })
    };

    const result = await LedgerEntry.getTransactionHistory(filters);

    const formattedEntries = result.entries.map(entry => ({
      entryId: entry.entryId,
      transactionId: entry.transactionId,
      entryType: entry.entryType,
      amount: entry.amount.toString(),
      currency: entry.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      description: entry.description,
      category: entry.category,
      status: entry.status,
      createdAt: entry.createdAt,
      processedAt: entry.processedAt,
      metadata: entry.metadata
    }));

    res.json({
      accountNumber,
      entries: formattedEntries,
      pagination: result.pagination,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get account ledger entries', {
      requestId,
      error: error.message,
      accountNumber
    });

    res.status(500).json({
      error: 'Failed to retrieve ledger entries',
      requestId
    });
  }
});

// Verify ledger integrity
router.get('/integrity/check', async (req, res) => {
  const requestId = req.requestId;

  try {
    const integrityResult = await LedgerEntry.verifyLedgerIntegrity();
    
    logger.info('Ledger integrity check completed', {
      requestId,
      isBalanced: integrityResult.isBalanced,
      totalChecked: integrityResult.totalChecked,
      imbalancedCount: integrityResult.imbalancedTransactions.length
    });

    res.json({
      integrity: {
        isBalanced: integrityResult.isBalanced,
        totalTransactionsChecked: integrityResult.totalChecked,
        imbalancedTransactions: integrityResult.imbalancedTransactions,
        timestamp: new Date().toISOString()
      },
      requestId
    });

  } catch (error) {
    logger.error('Ledger integrity check failed', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to perform ledger integrity check',
      requestId
    });
  }
});

// Get account balance from ledger
router.get('/accounts/:accountNumber/balance', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const { currency } = req.query;

  try {
    const balance = await LedgerEntry.getAccountBalance(accountNumber, currency);
    
    res.json({
      accountNumber,
      balance,
      currency: currency || 'all',
      calculatedAt: new Date().toISOString(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to calculate account balance', {
      requestId,
      error: error.message,
      accountNumber,
      currency
    });

    res.status(500).json({
      error: 'Failed to calculate account balance',
      requestId
    });
  }
});

// Get ledger statistics
router.get('/stats', async (req, res) => {
  const requestId = req.requestId;
  const { startDate, endDate, category } = req.query;

  try {
    const matchCondition = {};
    if (startDate && endDate) {
      matchCondition.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    if (category) {
      matchCondition.category = category;
    }

    const pipeline = [
      { $match: matchCondition },
      {
        $group: {
          _id: {
            entryType: '$entryType',
            category: '$category',
            currency: '$currency'
          },
          count: { $sum: 1 },
          totalAmount: { $sum: { $toDecimal: '$amount' } }
        }
      },
      {
        $group: {
          _id: {
            entryType: '$_id.entryType',
            category: '$_id.category'
          },
          currencies: {
            $push: {
              currency: '$_id.currency',
              count: '$count',
              totalAmount: '$totalAmount'
            }
          },
          totalCount: { $sum: '$count' }
        }
      },
      {
        $group: {
          _id: '$_id.entryType',
          categories: {
            $push: {
              category: '$_id.category',
              currencies: '$currencies',
              totalCount: '$totalCount'
            }
          },
          totalTransactions: { $sum: '$totalCount' }
        }
      }
    ];

    const stats = await LedgerEntry.aggregate(pipeline);

    const formattedStats = stats.reduce((acc, stat) => {
      acc[stat._id] = {
        totalTransactions: stat.totalTransactions,
        categories: stat.categories
      };
      return acc;
    }, {});

    res.json({
      stats: formattedStats,
      period: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to get ledger statistics', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve ledger statistics',
      requestId
    });
  }
});

// Search ledger entries
router.post('/search', async (req, res) => {
  const requestId = req.requestId;
  const {
    accountNumbers,
    transactionIds,
    categories,
    entryTypes,
    startDate,
    endDate,
    page = 1,
    limit = 50
  } = req.body;

  try {
    const query = {};
    
    if (accountNumbers && accountNumbers.length > 0) {
      query.accountNumber = { $in: accountNumbers };
    }
    
    if (transactionIds && transactionIds.length > 0) {
      query.transactionId = { $in: transactionIds };
    }
    
    if (categories && categories.length > 0) {
      query.category = { $in: categories };
    }
    
    if (entryTypes && entryTypes.length > 0) {
      query.entryType = { $in: entryTypes };
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    
    const [entries, total] = await Promise.all([
      LedgerEntry.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LedgerEntry.countDocuments(query)
    ]);

    const formattedEntries = entries.map(entry => ({
      entryId: entry.entryId,
      transactionId: entry.transactionId,
      accountNumber: entry.accountNumber,
      entryType: entry.entryType,
      amount: entry.amount.toString(),
      currency: entry.currency,
      balanceBefore: entry.balanceBefore.toString(),
      balanceAfter: entry.balanceAfter.toString(),
      description: entry.description,
      category: entry.category,
      status: entry.status,
      createdAt: entry.createdAt,
      processedAt: entry.processedAt
    }));

    res.json({
      entries: formattedEntries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      searchCriteria: {
        accountNumbers,
        transactionIds,
        categories,
        entryTypes,
        startDate,
        endDate
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to search ledger entries', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to search ledger entries',
      requestId
    });
  }
});

// Create correction entry (admin only)
router.post('/corrections', async (req, res) => {
  const requestId = req.requestId;
  const {
    originalTransactionId,
    correctionAmount,
    currency,
    accountNumber,
    reason,
    entryType
  } = req.body;

  try {
    if (!['DEBIT', 'CREDIT'].includes(entryType)) {
      return res.status(400).json({
        error: 'entryType must be either DEBIT or CREDIT',
        requestId
      });
    }

    // Get account and current balance
    const account = await Account.findOne({ accountNumber, status: 'active' });
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found or inactive',
        requestId
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create correction transaction ID
      const correctionTransactionId = `COR_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      // Create ledger entry for correction
      const correctionEntry = new LedgerEntry({
        transactionId: correctionTransactionId,
        accountNumber,
        entryType,
        amount: correctionAmount,
        currency,
        balanceBefore: account.balance,
        balanceAfter: entryType === 'DEBIT' 
          ? new mongoose.Types.Decimal128(
              (parseFloat(account.balance.toString()) - parseFloat(correctionAmount.toString())).toString()
            )
          : new mongoose.Types.Decimal128(
              (parseFloat(account.balance.toString()) + parseFloat(correctionAmount.toString())).toString()
            ),
        description: `Correction: ${reason}`,
        category: 'correction',
        metadata: {
          originalTransactionId,
          correctionReason: reason,
          correctedBy: req.user?.userId || 'system'
        }
      });

      await correctionEntry.save({ session });

      // Update account balance
      if (entryType === 'DEBIT') {
        account.debit(correctionAmount);
      } else {
        account.credit(correctionAmount);
      }
      
      await account.save({ session });

      // Mark correction entry as processed
      correctionEntry.status = 'processed';
      correctionEntry.processedAt = new Date();
      await correctionEntry.save({ session });

      await session.commitTransaction();

      logger.info('Ledger correction created', {
        requestId,
        correctionTransactionId,
        originalTransactionId,
        accountNumber,
        entryType,
        amount: correctionAmount.toString(),
        currency,
        reason
      });

      res.status(201).json({
        message: 'Correction entry created successfully',
        correction: {
          transactionId: correctionTransactionId,
          entryId: correctionEntry.entryId,
          accountNumber,
          entryType,
          amount: correctionAmount.toString(),
          currency,
          balanceBefore: correctionEntry.balanceBefore.toString(),
          balanceAfter: correctionEntry.balanceAfter.toString(),
          reason,
          createdAt: correctionEntry.createdAt
        },
        requestId
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    logger.error('Failed to create correction entry', {
      requestId,
      error: error.message,
      originalTransactionId,
      accountNumber
    });

    res.status(500).json({
      error: 'Failed to create correction entry',
      requestId
    });
  }
});

module.exports = router;
