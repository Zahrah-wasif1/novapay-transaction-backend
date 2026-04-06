const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Transaction, IdempotencyKey } = require('../models/Transaction');
const Account = require('../../account-service/models/Account');
const LedgerEntry = require('../../ledger-service/models/Ledger');
const logger = require('../../../shared/utils/logger');

const router = express.Router();

function createPayloadHash(payload) {
  const sortedPayload = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('sha256').update(sortedPayload).digest('hex');
}

router.post('/transfer', async (req, res) => {
  const requestId = req.requestId;
  const {
    idempotencyKey,
    sourceAccount,
    destinationAccount,
    amount,
    currency,
    description
  } = req.body;

  try {
    const { error } = validateTransfer(req.body);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    const payloadHash = createPayloadHash({
      sourceAccount,
      destinationAccount,
      amount,
      currency,
      description
    });

    const idempotencyCheck = await Transaction.checkIdempotency(idempotencyKey, payloadHash);
    
    if (idempotencyCheck.exists) {
      logger.info('Idempotent request detected', {
        requestId,
        idempotencyKey,
        transactionId: idempotencyCheck.transactionId,
        status: idempotencyCheck.status
      });

      return res.status(200).json({
        message: 'Transaction already processed',
        transactionId: idempotencyCheck.transactionId,
        status: idempotencyCheck.status,
        response: idempotencyCheck.response,
        requestId
      });
    }

    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    await Transaction.createIdempotencyKey(idempotencyKey, payloadHash, transactionId);

    const result = await processTransfer({
      transactionId,
      sourceAccount,
      destinationAccount,
      amount,
      currency,
      description,
      requestId
    });

    await Transaction.updateIdempotencyResponse(
      idempotencyKey,
      'completed',
      result
    );

    logger.info('Transfer completed successfully', {
      requestId,
      transactionId,
      sourceAccount,
      destinationAccount,
      amount,
      currency
    });

    res.status(201).json({
      message: 'Transfer completed successfully',
      transaction: result,
      requestId
    });

  } catch (error) {
    logger.error('Transfer failed', {
      requestId,
      error: error.message,
      sourceAccount,
      destinationAccount,
      amount,
      currency
    });

    if (idempotencyKey) {
      await Transaction.updateIdempotencyResponse(
        idempotencyKey,
        'failed',
        { error: error.message }
      );
    }

    res.status(500).json({
      error: error.message,
      requestId
    });
  }
});

async function processTransfer(transferData) {
  const { transactionId, sourceAccount, destinationAccount, amount, currency, description, requestId } = transferData;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sourceAcc = await Account.findOne({ accountNumber: sourceAccount, status: 'active' }).session(session);
    const destAcc = await Account.findOne({ accountNumber: destinationAccount, status: 'active' }).session(session);

    if (!sourceAcc || !destAcc) {
      throw new Error('One or both accounts not found or inactive');
    }

    if (sourceAcc.currency !== currency || destAcc.currency !== currency) {
      throw new Error('Currency mismatch between accounts and transaction');
    }

    if (!sourceAcc.hasSufficientBalance(amount)) {
      throw new Error('Insufficient balance in source account');
    }

    sourceAcc.freezeAmount(amount);
    await sourceAcc.save({ session });

    const transaction = new Transaction({
      transactionId,
      type: 'transfer',
      amount,
      currency,
      sourceAccount,
      destinationAccount,
      description,
      metadata: { idempotencyKey: transferData.idempotencyKey }
    });

    await transaction.save({ session });

    const ledgerResult = await LedgerEntry.createDoubleEntry({
      transactionId,
      debitAccount: sourceAccount,
      creditAccount: destinationAccount,
      amount,
      currency,
      description,
      category: 'transfer'
    }, session);

    transaction.ledgerEntries = [
      {
        entryId: ledgerResult.debitEntry.entryId,
        type: 'DEBIT',
        accountNumber: sourceAccount,
        amount,
        currency
      },
      {
        entryId: ledgerResult.creditEntry.entryId,
        type: 'CREDIT',
        accountNumber: destinationAccount,
        amount,
        currency
      }
    ];

    transaction.markCompleted();
    await transaction.save({ session });

    await session.commitTransaction();

    return {
      transactionId,
      status: 'completed',
      amount: amount.toString(),
      currency,
      sourceAccount,
      destinationAccount,
      description,
      ledgerEntries: transaction.ledgerEntries,
      createdAt: transaction.createdAt
    };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

router.get('/:transactionId', async (req, res) => {
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

    res.json({
      transaction: {
        transactionId: transaction.transactionId,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount.toString(),
        currency: transaction.currency,
        sourceAccount: transaction.sourceAccount,
        destinationAccount: transaction.destinationAccount,
        description: transaction.description,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get transaction', {
      requestId,
      error: error.message,
      transactionId
    });

    res.status(500).json({
      error: 'Failed to retrieve transaction',
      requestId
    });
  }
});

router.get('/history/:accountNumber', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const { page = 1, limit = 50, status, type } = req.query;

  try {
    const query = {
      $or: [
        { sourceAccount: accountNumber },
        { destinationAccount: accountNumber }
      ]
    };

    if (status) query.status = status;
    if (type) query.type = type;

    const skip = (page - 1) * limit;
    
    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
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
      direction: txn.sourceAccount === accountNumber ? 'outgoing' : 'incoming',
      counterparty: txn.sourceAccount === accountNumber ? txn.destinationAccount : txn.sourceAccount,
      description: txn.description,
      createdAt: txn.createdAt,
      completedAt: txn.completedAt
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
    logger.error('Failed to get transaction history', {
      requestId,
      error: error.message,
      accountNumber
    });

    res.status(500).json({
      error: 'Failed to retrieve transaction history',
      requestId
    });
  }
});

router.post('/:transactionId/retry', async (req, res) => {
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

    transaction.incrementRetryAttempt('Manual retry requested');
    await transaction.save();

    logger.info('Transaction retry initiated', {
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
    logger.error('Failed to retry transaction', {
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

router.get('/stats/summary', async (req, res) => {
  const requestId = req.requestId;
  const { startDate, endDate } = req.query;

  try {
    const stats = await Transaction.getTransactionStats(startDate, endDate);
    
    res.json({
      stats,
      period: { startDate, endDate },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get transaction statistics', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to retrieve statistics',
      requestId
    });
  }
});

module.exports = router;
