const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const FXQuote = require('../models/FXQuote');
const Account = require('../../account-service/models/Account');
const { Transaction } = require('../../transaction-service/models/Transaction');
const LedgerEntry = require('../../ledger-service/models/Ledger');
const logger = require('../../../shared/utils/logger');
const { validateQuoteRequest, validateInternationalTransfer } = require('../validators/fxValidator');

const router = express.Router();

// Create FX quote with 60-second TTL
router.post('/quote', async (req, res) => {
  const requestId = req.requestId;
  const {
    sourceCurrency,
    targetCurrency,
    sourceAmount,
    userId
  } = req.body;

  try {
    // Validate input
    const { error } = validateQuoteRequest(req.body);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    // Get current exchange rate
    const rateData = await FXQuote.getExchangeRate(sourceCurrency, targetCurrency);
    
    // Create quote
    const quote = await FXQuote.createQuote({
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      exchangeRate: rateData.rate,
      userId,
      metadata: {
        provider: rateData.source,
        providerQuoteId: rateData.quoteId
      }
    });

    logger.info('FX quote created', {
      requestId,
      quoteId: quote.quoteId,
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      exchangeRate: rateData.rate,
      userId
    });

    res.status(201).json({
      quote: {
        quoteId: quote.quoteId,
        sourceCurrency: quote.sourceCurrency,
        targetCurrency: quote.targetCurrency,
        sourceAmount: quote.sourceAmount.toString(),
        targetAmount: quote.targetAmount.toString(),
        exchangeRate: quote.exchangeRate.toString(),
        expiresAt: quote.expiresAt,
        timeRemaining: quote.timeRemaining,
        userId
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to create FX quote', {
      requestId,
      error: error.message,
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      userId
    });

    res.status(500).json({
      error: error.message,
      requestId
    });
  }
});

// Get quote details
router.get('/quote/:quoteId', async (req, res) => {
  const requestId = req.requestId;
  const { quoteId } = req.params;
  const { userId } = req.query;

  try {
    const quote = await FXQuote.findValidQuote(quoteId, userId);
    
    if (!quote) {
      return res.status(404).json({
        error: 'Quote not found, expired, or already used',
        requestId
      });
    }

    res.json({
      quote: {
        quoteId: quote.quoteId,
        sourceCurrency: quote.sourceCurrency,
        targetCurrency: quote.targetCurrency,
        sourceAmount: quote.sourceAmount.toString(),
        targetAmount: quote.targetAmount.toString(),
        exchangeRate: quote.exchangeRate.toString(),
        expiresAt: quote.expiresAt,
        timeRemaining: quote.timeRemaining,
        status: quote.status
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get FX quote', {
      requestId,
      error: error.message,
      quoteId
    });

    res.status(500).json({
      error: 'Failed to retrieve quote',
      requestId
    });
  }
});

// Execute international transfer using quote
router.post('/transfers/international', async (req, res) => {
  const requestId = req.requestId;
  const {
    idempotencyKey,
    sourceAccount,
    destinationAccount,
    amount,
    sourceCurrency,
    targetCurrency,
    quoteId,
    description
  } = req.body;

  try {
    // Validate input
    const { error } = validateInternationalTransfer(req.body);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    // Create payload hash for idempotency
    const payloadHash = crypto.createHash('sha256')
      .update(JSON.stringify({
        sourceAccount,
        destinationAccount,
        amount,
        sourceCurrency,
        targetCurrency,
        quoteId,
        description
      }))
      .digest('hex');

    // Check idempotency
    const idempotencyCheck = await Transaction.checkIdempotency(idempotencyKey, payloadHash);
    
    if (idempotencyCheck.exists) {
      logger.info('Idempotent FX transfer request detected', {
        requestId,
        idempotencyKey,
        transactionId: idempotencyCheck.transactionId,
        status: idempotencyCheck.status
      });

      return res.status(200).json({
        message: 'Transfer already processed',
        transactionId: idempotencyCheck.transactionId,
        status: idempotencyCheck.status,
        response: idempotencyCheck.response,
        requestId
      });
    }

    // Validate quote
    const quote = await FXQuote.findOne({ quoteId, status: 'active' });
    
    if (!quote) {
      return res.status(400).json({
        error: 'Invalid or expired quote',
        requestId
      });
    }

    if (quote.isExpired) {
      await quote.markAsExpired();
      return res.status(400).json({
        error: 'Quote has expired',
        requestId
      });
    }

    if (quote.transactionId) {
      return res.status(400).json({
        error: 'Quote has already been used',
        requestId
      });
    }

    // Normalize currencies and amounts for comparison
    const normalizedSourceCurrency = sourceCurrency.toUpperCase();
    const normalizedTargetCurrency = targetCurrency.toUpperCase();
    const quoteSourceAmount = parseFloat(quote.sourceAmount.toString());
    const transferAmount = parseFloat(amount);

    if (quote.sourceCurrency.toUpperCase() !== normalizedSourceCurrency || 
        quote.targetCurrency.toUpperCase() !== normalizedTargetCurrency ||
        quoteSourceAmount !== transferAmount) {
      return res.status(400).json({
        error: 'Quote details do not match transfer parameters',
        requestId
      });
    }

    // Create idempotency key record
    const transactionId = `FXN_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    await Transaction.createIdempotencyKey(idempotencyKey, payloadHash, transactionId);

    // Process international transfer
    const result = await processInternationalTransfer({
      transactionId,
      sourceAccount,
      destinationAccount,
      amount,
      sourceCurrency,
      targetCurrency,
      quoteId,
      quote,
      description,
      requestId
    });

    // Mark quote as used
    await quote.markAsUsed(transactionId);

    // Update idempotency record with successful response
    await Transaction.updateIdempotencyResponse(
      idempotencyKey,
      'completed',
      result
    );

    logger.info('International transfer completed', {
      requestId,
      transactionId,
      sourceAccount,
      destinationAccount,
      amount,
      sourceCurrency,
      targetCurrency,
      quoteId,
      exchangeRate: quote.exchangeRate.toString()
    });

    res.status(201).json({
      message: 'International transfer completed successfully',
      transfer: result,
      requestId
    });

  } catch (error) {
    logger.error('International transfer failed', {
      requestId,
      error: error.message,
      sourceAccount,
      destinationAccount,
      amount,
      sourceCurrency,
      targetCurrency,
      quoteId
    });

    // Update idempotency record with error
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

// Internal international transfer processing
async function processInternationalTransfer(transferData) {
  const {
    transactionId,
    sourceAccount,
    destinationAccount,
    amount,
    sourceCurrency,
    targetCurrency,
    quoteId,
    quote,
    description,
    requestId
  } = transferData;

  const normalizedSourceCurrency = sourceCurrency.toUpperCase();
  const normalizedTargetCurrency = targetCurrency.toUpperCase();
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate accounts
    const sourceAcc = await Account.findOne({ accountNumber: sourceAccount, status: 'active' }).session(session);
    const destAcc = await Account.findOne({ accountNumber: destinationAccount, status: 'active' }).session(session);

    if (!sourceAcc || !destAcc) {
      throw new Error('One or both accounts not found or inactive');
    }

    // Validate source account currency matches transfer source currency
    if (sourceAcc.currency.toUpperCase() !== normalizedSourceCurrency) {
      throw new Error('Source account currency must match transfer source currency');
    }

    // Check sufficient balance in source account
    if (!sourceAcc.hasSufficientBalance(amount)) {
      throw new Error('Insufficient balance in source account');
    }

    // Freeze amount in source account
    sourceAcc.freezeAmount(amount);
    await sourceAcc.save({ session });

    // Create transaction record
    const transaction = new Transaction({
      transactionId,
      type: 'fx_transfer',
      amount,
      currency: sourceCurrency,
      sourceAccount,
      destinationAccount,
      description,
      metadata: {
        idempotencyKey: transferData.idempotencyKey,
        quoteId,
        fxRate: quote.exchangeRate,
        originalAmount: quote.targetAmount,
        originalCurrency: targetCurrency
      }
    });

    await transaction.save({ session });

    // Create ledger entries for source account (debit)
    const sourceLedgerEntry = new LedgerEntry({
      transactionId,
      accountNumber: sourceAccount,
      entryType: 'DEBIT',
      amount,
      currency: sourceCurrency,
      balanceBefore: sourceAcc.balance,
      balanceAfter: new mongoose.Types.Decimal128(
        (parseFloat(sourceAcc.balance.toString()) - parseFloat(amount)).toString()
      ),
      description,
      category: 'fx_settlement',
      metadata: {
        fxRate: quote.exchangeRate,
        originalAmount: quote.targetAmount,
        originalCurrency: targetCurrency,
        quoteId
      }
    });

    // Create ledger entry for destination account (credit with converted amount)
    const destLedgerEntry = new LedgerEntry({
      transactionId,
      accountNumber: destinationAccount,
      entryType: 'CREDIT',
      amount: quote.targetAmount,
      currency: targetCurrency,
      balanceBefore: destAcc.balance,
      balanceAfter: new mongoose.Types.Decimal128(
        (parseFloat(destAcc.balance.toString()) + parseFloat(quote.targetAmount.toString())).toString()
      ),
      description,
      category: 'fx_settlement',
      metadata: {
        fxRate: quote.exchangeRate,
        originalAmount: amount,
        originalCurrency: sourceCurrency,
        quoteId
      }
    });

    // Save ledger entries
    await sourceLedgerEntry.save({ session });
    await destLedgerEntry.save({ session });

    // Update account balances
    sourceAcc.debit(amount);
    destAcc.credit(quote.targetAmount);
    
    await sourceAcc.save({ session });
    await destAcc.save({ session });

    // Mark ledger entries as processed
    sourceLedgerEntry.status = 'processed';
    sourceLedgerEntry.processedAt = new Date();
    destLedgerEntry.status = 'processed';
    destLedgerEntry.processedAt = new Date();
    
    await sourceLedgerEntry.save({ session });
    await destLedgerEntry.save({ session });

    // Update transaction with ledger entry IDs
    transaction.ledgerEntries = [
      {
        entryId: sourceLedgerEntry.entryId,
        type: 'DEBIT',
        accountNumber: sourceAccount,
        amount,
        currency: sourceCurrency
      },
      {
        entryId: destLedgerEntry.entryId,
        type: 'CREDIT',
        accountNumber: destinationAccount,
        amount: quote.targetAmount,
        currency: targetCurrency
      }
    ];

    transaction.markCompleted();
    await transaction.save({ session });

    await session.commitTransaction();

    return {
      transactionId,
      status: 'completed',
      sourceAmount: amount,
      sourceCurrency,
      targetAmount: quote.targetAmount.toString(),
      targetCurrency,
      exchangeRate: quote.exchangeRate.toString(),
      sourceAccount,
      destinationAccount,
      description,
      quoteId,
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

// Get FX rates
router.get('/rates', async (req, res) => {
  const requestId = req.requestId;
  const { sourceCurrency, targetCurrency } = req.query;

  try {
    if (!sourceCurrency || !targetCurrency) {
      return res.status(400).json({
        error: 'Both sourceCurrency and targetCurrency are required',
        requestId
      });
    }

    const rateData = await FXQuote.getExchangeRate(sourceCurrency, targetCurrency);
    
    res.json({
      sourceCurrency,
      targetCurrency,
      exchangeRate: rateData.rate,
      timestamp: rateData.timestamp,
      provider: rateData.source,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get FX rates', {
      requestId,
      error: error.message,
      sourceCurrency,
      targetCurrency
    });

    res.status(500).json({
      error: error.message,
      requestId
    });
  }
});

// Get user's quote history
router.get('/quotes/history/:userId', async (req, res) => {
  const requestId = req.requestId;
  const { userId } = req.params;
  const { page = 1, limit = 20, status } = req.query;

  try {
    const query = { userId };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    
    const [quotes, total] = await Promise.all([
      FXQuote.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      FXQuote.countDocuments(query)
    ]);

    const formattedQuotes = quotes.map(quote => ({
      quoteId: quote.quoteId,
      sourceCurrency: quote.sourceCurrency,
      targetCurrency: quote.targetCurrency,
      sourceAmount: quote.sourceAmount.toString(),
      targetAmount: quote.targetAmount.toString(),
      exchangeRate: quote.exchangeRate.toString(),
      status: quote.status,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      usedAt: quote.usedAt,
      transactionId: quote.transactionId
    }));

    res.json({
      quotes: formattedQuotes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get quote history', {
      requestId,
      error: error.message,
      userId
    });

    res.status(500).json({
      error: 'Failed to retrieve quote history',
      requestId
    });
  }
});

module.exports = router;
