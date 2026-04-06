const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Account = require('../models/Account');
const logger = require('../../../shared/utils/logger');
const { encryptSensitiveData } = require('../../../shared/utils/encryption');
const { validateAccountCreation, validateAccountUpdate } = require('../validators/accountValidator');

const router = express.Router();

router.post('/', async (req, res) => {
  const requestId = req.requestId;
  const { userId, accountType, currency, initialBalance, metadata } = req.body;

  try {
    const { error } = validateAccountCreation(req.body);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    const existingAccount = await Account.findOne({ userId, currency });
    if (existingAccount) {
      return res.status(409).json({
        error: 'Account already exists for this user and currency',
        requestId
      });
    }

    const accountNumber = `ACC_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    let accountMetadata = metadata || {};
    if (metadata && typeof metadata === 'object') {
      const sensitiveFields = ['firstName', 'lastName', 'email', 'phone', 'address'];
      const sensitiveData = {};
      const plainMetadata = {};

      Object.entries(metadata).forEach(([key, value]) => {
        if (sensitiveFields.includes(key)) {
          sensitiveData[key] = value;
        } else {
          plainMetadata[key] = value;
        }
      });

      if (Object.keys(sensitiveData).length > 0) {
        try {
          const { encrypted, encryptedDataKey } = encryptSensitiveData(sensitiveData);
          accountMetadata = {
            ...plainMetadata,
            encrypted,
            encryptedDataKey
          };
        } catch (encryptionError) {
          logger.warn('Metadata encryption failed; storing plaintext metadata', {
            requestId,
            error: encryptionError.message
          });
          accountMetadata = { ...metadata };
        }
      } else {
        accountMetadata = { ...plainMetadata };
      }
    }

    const account = new Account({
      userId,
      accountNumber,
      accountType,
      currency,
      balance: initialBalance || 0,
      availableBalance: initialBalance || 0,
      metadata: accountMetadata
    });

    await account.save();

    logger.info('Account created', {
      requestId,
      userId,
      accountNumber,
      accountType,
      currency
    });

    res.status(201).json({
      message: 'Account created successfully',
      account: account.toSafeJSON(),
      requestId
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Account already exists for this user and currency',
        requestId
      });
    }

    logger.error('Failed to create account', {
      requestId,
      error: error.message,
      userId,
      accountType
    });

    res.status(500).json({
      error: 'Failed to create account',
      requestId
    });
  }
});

router.get('/user/:userId', async (req, res) => {
  const requestId = req.requestId;
  const { userId } = req.params;

  try {
    const accounts = await Account.find({ userId, status: 'active' });
    
    if (!accounts || accounts.length === 0) {
      return res.status(404).json({
        error: 'No active accounts found for this user',
        requestId
      });
    }

    const safeAccounts = accounts.map(account => account.toSafeJSON());

    res.json({
      accounts: safeAccounts,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get user accounts', {
      requestId,
      error: error.message,
      userId
    });

    res.status(500).json({
      error: 'Failed to retrieve accounts',
      requestId
    });
  }
});

router.get('/:accountNumber', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;

  try {
    const account = await Account.findOne({ accountNumber, status: 'active' });
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        requestId
      });
    }

    res.json({
      account: account.toSafeJSON(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to get account', {
      requestId,
      error: error.message,
      accountNumber
    });

    res.status(500).json({
      error: 'Failed to retrieve account',
      requestId
    });
  }
});

router.get('/:accountNumber/balance', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;

  try {
    const account = await Account.findOne({ 
      accountNumber, 
      status: 'active' 
    }).select('balance availableBalance frozenAmount currency');
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        requestId
      });
    }

    res.json({
      accountNumber,
      balance: account.balance.toString(),
      availableBalance: account.availableBalance.toString(),
      frozenAmount: account.frozenAmount.toString(),
      currency: account.currency,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get account balance', {
      requestId,
      error: error.message,
      accountNumber
    });

    res.status(500).json({
      error: 'Failed to retrieve balance',
      requestId
    });
  }
});

router.put('/:accountNumber', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const updates = req.body;

  try {
    const { error } = validateAccountUpdate(updates);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    const account = await Account.findOne({ accountNumber });
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        requestId
      });
    }

    const allowedUpdates = ['status', 'kycLevel', 'limits', 'metadata'];
    const actualUpdates = {};
    
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        actualUpdates[field] = updates[field];
      }
    });

    Object.assign(account, actualUpdates);
    await account.save();

    logger.info('Account updated', {
      requestId,
      accountNumber,
      updates: Object.keys(actualUpdates)
    });

    res.json({
      message: 'Account updated successfully',
      account: account.toSafeJSON(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to update account', {
      requestId,
      error: error.message,
      accountNumber
    });

    res.status(500).json({
      error: 'Failed to update account',
      requestId
    });
  }
});

router.post('/:accountNumber/freeze', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const { amount, reason } = req.body;

  try {
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        error: 'Valid freeze amount is required',
        requestId
      });
    }

    const account = await Account.findOne({ 
      accountNumber, 
      status: 'active' 
    });
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        requestId
      });
    }

    try {
      account.freezeAmount(amount);
      await account.save();

      logger.info('Amount frozen', {
        requestId,
        accountNumber,
        amount,
        reason
      });

      res.json({
        message: 'Amount frozen successfully',
        accountNumber,
        frozenAmount: account.frozenAmount.toString(),
        availableBalance: account.availableBalance.toString(),
        requestId
      });

    } catch (freezeError) {
      return res.status(400).json({
        error: freezeError.message,
        requestId
      });
    }

  } catch (error) {
    logger.error('Failed to freeze amount', {
      requestId,
      error: error.message,
      accountNumber,
      amount
    });

    res.status(500).json({
      error: 'Failed to freeze amount',
      requestId
    });
  }
});

router.post('/:accountNumber/unfreeze', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const { amount, reason } = req.body;

  try {
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        error: 'Valid unfreeze amount is required',
        requestId
      });
    }

    const account = await Account.findOne({ 
      accountNumber, 
      status: 'active' 
    });
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        requestId
      });
    }

    try {
      account.unfreezeAmount(amount);
      await account.save();

      logger.info('Amount unfrozen', {
        requestId,
        accountNumber,
        amount,
        reason
      });

      res.json({
        message: 'Amount unfrozen successfully',
        accountNumber,
        frozenAmount: account.frozenAmount.toString(),
        availableBalance: account.availableBalance.toString(),
        requestId
      });

    } catch (unfreezeError) {
      return res.status(400).json({
        error: unfreezeError.message,
        requestId
      });
    }

  } catch (error) {
    logger.error('Failed to unfreeze amount', {
      requestId,
      error: error.message,
      accountNumber,
      amount
    });

    res.status(500).json({
      error: 'Failed to unfreeze amount',
      requestId
    });
  }
});

router.post('/:accountNumber/deposit', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const { amount, currency } = req.body;

  try {
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        error: 'Deposit amount must be greater than zero',
        requestId
      });
    }

    const account = await Account.findOne({ accountNumber, status: 'active' });
    if (!account) {
      return res.status(404).json({
        error: 'Account not found or inactive',
        requestId
      });
    }

    if (currency && currency.toUpperCase() !== account.currency) {
      return res.status(400).json({
        error: 'Deposit currency must match account currency',
        requestId
      });
    }

    account.credit(amount);
    await account.save();

    logger.info('Account funded', {
      requestId,
      accountNumber,
      amount,
      currency: account.currency
    });

    res.json({
      message: 'Account funded successfully',
      accountNumber,
      balance: account.balance.toString(),
      availableBalance: account.availableBalance.toString(),
      requestId
    });
  } catch (error) {
    logger.error('Failed to deposit into account', {
      requestId,
      error: error.message,
      accountNumber,
      amount
    });

    res.status(500).json({
      error: 'Failed to deposit amount',
      requestId
    });
  }
});

router.get('/:accountNumber/statement', async (req, res) => {
  const requestId = req.requestId;
  const { accountNumber } = req.params;
  const { startDate, endDate, page = 1, limit = 50 } = req.query;

  try {
    const account = await Account.findOne({ 
      accountNumber, 
      status: 'active' 
    });
    
    if (!account) {
      return res.status(404).json({
        error: 'Account not found',
        requestId
      });
    }

    const LedgerEntry = require('../models/Ledger');
    const statement = await LedgerEntry.getTransactionHistory(
      { accountNumber, startDate, endDate, page, limit }
    );

    res.json({
      account: account.toSafeJSON(),
      statement,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get account statement', {
      requestId,
      error: error.message,
      accountNumber
    });

    res.status(500).json({
      error: 'Failed to retrieve statement',
      requestId
    });
  }
});

module.exports = router;
