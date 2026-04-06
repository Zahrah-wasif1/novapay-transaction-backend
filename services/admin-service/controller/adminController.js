const express = require('express');
const { Transaction, IdempotencyKey } = require('../../transaction-service/models/Transaction');
const Account = require('../../account-service/models/Account');
const LedgerEntry = require('../../ledger-service/models/Ledger');
const PayrollJob = require('../../payroll-service/models/PayrollJob');
const FXQuote = require('../../payroll-service/models/FXQuote');
const logger = require('../../../shared/utils/logger');

const router = express.Router();

// Dashboard overview
router.get('/dashboard', async (req, res) => {
  const requestId = req.requestId;

  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get various statistics
    const [
      totalAccounts,
      activeAccounts,
      totalTransactions,
      todayTransactions,
      totalPayrollJobs,
      activePayrollJobs,
      ledgerIntegrity,
      pendingTransactions
    ] = await Promise.all([
      Account.countDocuments(),
      Account.countDocuments({ status: 'active' }),
      Transaction.countDocuments(),
      Transaction.countDocuments({ createdAt: { $gte: today } }),
      PayrollJob.countDocuments(),
      PayrollJob.countDocuments({ status: { $in: ['queued', 'processing'] } }),
      LedgerEntry.verifyLedgerIntegrity(),
      Transaction.findPendingTransactions()
    ]);

    // Get transaction stats for today
    const todayStats = await Transaction.getTransactionStats(today.toISOString(), now.toISOString());
    
    // Get account balances summary
    const balanceStats = await Account.aggregate([
      { $match: { status: 'active' } },
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          totalBalance: { $sum: { $toDecimal: '$balance' } },
          totalFrozen: { $sum: { $toDecimal: '$frozenAmount' } }
        }
      }
    ]);

    res.json({
      dashboard: {
        accounts: {
          total: totalAccounts,
          active: activeAccounts,
          inactive: totalAccounts - activeAccounts
        },
        transactions: {
          total: totalTransactions,
          today: todayTransactions,
          pending: pendingTransactions.length,
          stats: todayStats
        },
        payroll: {
          totalJobs: totalPayrollJobs,
          activeJobs: activePayrollJobs
        },
        ledger: {
          isBalanced: ledgerIntegrity.isBalanced,
          imbalancedTransactions: ledgerIntegrity.imbalancedTransactions.length,
          totalChecked: ledgerIntegrity.totalChecked
        },
        balances: balanceStats.reduce((acc, stat) => {
          acc[stat._id] = {
            count: stat.count,
            totalBalance: stat.totalBalance.toString(),
            totalFrozen: stat.totalFrozen.toString()
          };
          return acc;
        }, {})
      },
      timestamp: now.toISOString(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to get admin dashboard', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve dashboard data',
      requestId
    });
  }
});

// Get system health
router.get('/health', async (req, res) => {
  const requestId = req.requestId;

  try {
    const healthChecks = {
      database: await checkDatabaseHealth(),
      redis: await checkRedisHealth(),
      ledger: await checkLedgerHealth(),
      transactions: await checkTransactionHealth(),
      payroll: await checkPayrollHealth()
    };

    const overallHealth = Object.values(healthChecks).every(check => check.status === 'healthy');

    res.json({
      status: overallHealth ? 'healthy' : 'degraded',
      checks: healthChecks,
      timestamp: new Date().toISOString(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to get system health', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      status: 'unhealthy',
      error: 'Failed to retrieve system health',
      requestId
    });
  }
});

// Get failed transactions
router.get('/transactions/failed', async (req, res) => {
  const requestId = req.requestId;
  const { page = 1, limit = 20, retryable } = req.query;

  try {
    const query = { status: 'failed' };
    if (retryable === 'true') {
      query['metadata.processingAttempts'] = { $lt: 3 };
    }

    const skip = (page - 1) * limit;
    
    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Transaction.countDocuments(query)
    ]);

    const formattedTransactions = transactions.map(txn => ({
      transactionId: txn.transactionId,
      type: txn.type,
      status: txn.status,
      amount: txn.amount.toString(),
      currency: txn.currency,
      sourceAccount: txn.sourceAccount,
      destinationAccount: txn.destinationAccount,
      description: txn.description,
      processingAttempts: txn.metadata.processingAttempts || 0,
      lastError: txn.metadata.lastError,
      canRetry: txn.metadata.processingAttempts < 3,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt
    }));

    res.json({
      transactions: formattedTransactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get failed transactions', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve failed transactions',
      requestId
    });
  }
});

// Get pending transactions
router.get('/transactions/pending', async (req, res) => {
  const requestId = req.requestId;
  const { page = 1, limit = 20 } = req.query;

  try {
    const transactions = await Transaction.findPendingTransactions();
    
    const formattedTransactions = transactions.map(txn => ({
      transactionId: txn.transactionId,
      type: txn.type,
      status: txn.status,
      amount: txn.amount.toString(),
      currency: txn.currency,
      sourceAccount: txn.sourceAccount,
      destinationAccount: txn.destinationAccount,
      description: txn.description,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt
    }));

    res.json({
      transactions: formattedTransactions,
      count: formattedTransactions.length,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get pending transactions', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve pending transactions',
      requestId
    });
  }
});

// Force retry transaction
router.post('/transactions/:transactionId/retry', async (req, res) => {
  const requestId = req.requestId;
  const { transactionId } = req.params;

  try {
    const transaction = await Transaction.findOne({ transactionId });
    
    if (!transaction) {
      return res.status(404).json({
        error: 'Transaction not found',
        requestId
      });
    }

    if (!transaction.canRetry()) {
      return res.status(400).json({
        error: 'Transaction cannot be retried',
        requestId
      });
    }

    // Reset transaction status for retry
    transaction.status = 'initiated';
    transaction.incrementRetryAttempt('Admin manual retry');
    await transaction.save();

    logger.info('Transaction retry forced by admin', {
      requestId,
      transactionId,
      attemptCount: transaction.metadata.processingAttempts
    });

    res.json({
      message: 'Transaction retry initiated',
      transactionId,
      attemptCount: transaction.metadata.processingAttempts,
      requestId
    });

  } catch (error) {
    logger.error('Failed to force retry transaction', {
      requestId,
      error: error.message,
      transactionId
    });

    res.status(500).json({
      error: 'Failed to retry transaction',
      requestId
    });
  }
});

// Get system metrics
router.get('/metrics', async (req, res) => {
  const requestId = req.requestId;
  const { period = '24h' } = req.query;

  try {
    let startDate;
    const endDate = new Date();
    
    switch (period) {
      case '1h':
        startDate = new Date(endDate.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    }

    // Get transaction metrics
    const transactionMetrics = await getTransactionMetrics(startDate, endDate);
    
    // Get payroll metrics
    const payrollMetrics = await getPayrollMetrics(startDate, endDate);
    
    // Get FX metrics
    const fxMetrics = await getFXMetrics(startDate, endDate);

    res.json({
      period,
      metrics: {
        transactions: transactionMetrics,
        payroll: payrollMetrics,
        fx: fxMetrics
      },
      generatedAt: endDate.toISOString(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to get system metrics', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve system metrics',
      requestId
    });
  }
});

// Cleanup expired data
router.post('/cleanup', async (req, res) => {
  const requestId = req.requestId;
  const { dryRun = false } = req.body;

  try {
    const cleanupResults = {
      expiredIdempotencyKeys: await cleanupExpiredIdempotencyKeys(dryRun),
      expiredFXQuotes: await cleanupExpiredFXQuotes(dryRun),
      oldPayrollJobs: await cleanupOldPayrollJobs(dryRun)
    };

    logger.info('System cleanup completed', {
      requestId,
      dryRun,
      results: cleanupResults
    });

    res.json({
      message: dryRun ? 'Cleanup simulation completed' : 'Cleanup completed',
      dryRun,
      results: cleanupResults,
      requestId
    });

  } catch (error) {
    logger.error('Failed to perform system cleanup', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to perform cleanup',
      requestId
    });
  }
});

// Get audit log
router.get('/audit', async (req, res) => {
  const requestId = req.requestId;
  const { 
    page = 1, 
    limit = 50, 
    startDate, 
    endDate,
    category,
    userId 
  } = req.query;

  try {
    // This would typically query a dedicated audit log collection
    // For now, we'll simulate with transaction and ledger data
    
    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    
    // Get recent transactions and ledger entries as audit trail
    const [transactions, ledgerEntries] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.floor(limit / 2))
        .lean(),
      LedgerEntry.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.floor(limit / 2))
        .lean()
    ]);

    const auditEntries = [
      ...transactions.map(txn => ({
        id: txn.transactionId,
        type: 'transaction',
        action: txn.type,
        status: txn.status,
        amount: txn.amount.toString(),
        currency: txn.currency,
        user: txn.metadata?.userId || 'system',
        timestamp: txn.createdAt,
        details: {
          sourceAccount: txn.sourceAccount,
          destinationAccount: txn.destinationAccount,
          description: txn.description
        }
      })),
      ...ledgerEntries.map(entry => ({
        id: entry.entryId,
        type: 'ledger',
        action: entry.entryType,
        status: entry.status,
        amount: entry.amount.toString(),
        currency: entry.currency,
        user: 'system',
        timestamp: entry.createdAt,
        details: {
          accountNumber: entry.accountNumber,
          transactionId: entry.transactionId,
          category: entry.category,
          description: entry.description
        }
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      auditEntries: auditEntries.slice(0, limit),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: auditEntries.length,
        pages: Math.ceil(auditEntries.length / limit)
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get audit log', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve audit log',
      requestId
    });
  }
});

// Helper functions
async function checkDatabaseHealth() {
  try {
    await mongoose.connection.db.admin().ping();
    return { status: 'healthy', message: 'Database connection OK' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function checkRedisHealth() {
  try {
    const { getRedisClient } = require('../config/redis');
    const redis = getRedisClient();
    await redis.ping();
    return { status: 'healthy', message: 'Redis connection OK' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function checkLedgerHealth() {
  try {
    const integrity = await LedgerEntry.verifyLedgerIntegrity();
    return {
      status: integrity.isBalanced ? 'healthy' : 'unhealthy',
      message: integrity.isBalanced ? 'Ledger is balanced' : 'Ledger has imbalances',
      details: integrity
    };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function checkTransactionHealth() {
  try {
    const pending = await Transaction.findPendingTransactions();
    const failed = await Transaction.findFailedTransactions();
    
    return {
      status: 'healthy',
      message: `${pending.length} pending, ${failed.length} failed transactions`,
      details: { pending: pending.length, failed: failed.length }
    };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function checkPayrollHealth() {
  try {
    const active = await PayrollJob.findProcessingJobs();
    const queued = await PayrollJob.findQueuedJobs();
    
    return {
      status: 'healthy',
      message: `${active.length} processing, ${queued.length} queued jobs`,
      details: { processing: active.length, queued: queued.length }
    };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function getTransactionMetrics(startDate, endDate) {
  const stats = await Transaction.getTransactionStats(startDate, endDate);
  return stats;
}

async function getPayrollMetrics(startDate, endDate) {
  const stats = await PayrollJob.getJobStats(null, startDate, endDate);
  return stats;
}

async function getFXMetrics(startDate, endDate) {
  const stats = await FXQuote.getQuoteStats(startDate, endDate);
  return stats;
}

async function cleanupExpiredIdempotencyKeys(dryRun) {
  if (dryRun) {
    const count = await IdempotencyKey.countDocuments({
      expiresAt: { $lt: new Date() }
    });
    return { deletedCount: count };
  }
  
  return await Transaction.cleanupExpiredKeys();
}

async function cleanupExpiredFXQuotes(dryRun) {
  if (dryRun) {
    const count = await FXQuote.countDocuments({
      status: 'expired',
      createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    return { deletedCount: count };
  }
  
  return await FXQuote.cleanupExpiredQuotes();
}

async function cleanupOldPayrollJobs(dryRun) {
  if (dryRun) {
    const count = await PayrollJob.countDocuments({
      status: { $in: ['completed', 'cancelled'] },
      updatedAt: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
    });
    return { deletedCount: count };
  }
  
  return await PayrollJob.cleanupOldJobs();
}

module.exports = router;
