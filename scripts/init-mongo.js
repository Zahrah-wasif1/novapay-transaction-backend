// MongoDB initialization script
db = db.getSiblingDB('novapay');

// Create application user
db.createUser({
  user: 'novapay_user',
  pwd: 'novapay_password',
  roles: [
    {
      role: 'readWrite',
      db: 'novapay'
    }
  ]
});

// Create collections with indexes
db.createCollection('accounts');
db.createCollection('transactions');
db.createCollection('idempotencykeys');
db.createCollection('ledgerentries');
db.createCollection('fxquotes');
db.createCollection('payrolljobs');

// Create indexes for accounts
db.accounts.createIndex({ "userId": 1, "currency": 1 });
db.accounts.createIndex({ "accountNumber": 1 }, { unique: true });
db.accounts.createIndex({ "status": 1 });
db.accounts.createIndex({ "createdAt": -1 });

// Create indexes for transactions
db.transactions.createIndex({ "transactionId": 1 }, { unique: true });
db.transactions.createIndex({ "status": 1, "createdAt": -1 });
db.transactions.createIndex({ "sourceAccount": 1, "createdAt": -1 });
db.transactions.createIndex({ "destinationAccount": 1, "createdAt": -1 });
db.transactions.createIndex({ "type": 1, "createdAt": -1 });
db.transactions.createIndex({ "metadata.idempotencyKey": 1 });

// Create indexes for idempotency keys
db.idempotencykeys.createIndex({ "key": 1 }, { unique: true });
db.idempotencykeys.createIndex({ "expiresAt": 1 }, { expireAfterSeconds: 0 });

// Create indexes for ledger entries
db.ledgerentries.createIndex({ "transactionId": 1, "entryType": 1 });
db.ledgerentries.createIndex({ "accountNumber": 1, "createdAt": -1 });
db.ledgerentries.createIndex({ "createdAt": -1 });
db.ledgerentries.createIndex({ "status": 1, "createdAt": -1 });
db.ledgerentries.createIndex({ "category": 1, "createdAt": -1 });

// Create indexes for FX quotes
db.fxquotes.createIndex({ "quoteId": 1 }, { unique: true });
db.fxquotes.createIndex({ "expiresAt": 1 }, { expireAfterSeconds: 3600 });
db.fxquotes.createIndex({ "status": 1, "expiresAt": 1 });
db.fxquotes.createIndex({ "userId": 1, "status": 1 });
db.fxquotes.createIndex({ "sourceCurrency": 1, "targetCurrency": 1, "status": 1 });

// Create indexes for payroll jobs
db.payrolljobs.createIndex({ "jobId": 1 }, { unique: true });
db.payrolljobs.createIndex({ "employerId": 1, "status": 1 });
db.payrolljobs.createIndex({ "status": 1, "createdAt": -1 });
db.payrolljobs.createIndex({ "scheduling.scheduledFor": 1, "status": 1 });
db.payrolljobs.createIndex({ "processing.startedAt": 1 });

print('NovaPay database initialized successfully');
