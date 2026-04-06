# NovaPay Transaction Backend - Architecture Decisions

## Overview

This document outlines the critical architectural decisions made to address the failures that occurred in the original NovaPay system and ensure robust, fault-tolerant financial processing.

## Core Problems Addressed

1. **Duplicate Disbursements**: No idempotency protection
2. **Incomplete Transfers**: Ledger imbalance after crashes
3. **Stale FX Rates**: Rate locking issues
4. **Database Performance**: Inefficient transaction history queries
5. **Lack of Monitoring**: No observability

## Architecture Decisions

### 1. Microservices Architecture

**Decision**: Implement microservices with clear boundaries and no shared databases.

**Rationale**:
- Isolation prevents cascading failures
- Independent scaling per service
- Clear ownership and responsibility
- Technology diversity possible

**Services**:
- Account Service: User wallet management
- Transaction Service: Money movement orchestration
- Ledger Service: Double-entry bookkeeping
- FX Service: Currency conversion with rate locking
- Payroll Service: Bulk disbursement processing
- Admin Service: Operations and monitoring

### 2. Double-Entry Ledger System

**Decision**: Implement strict double-entry bookkeeping where every debit has a corresponding credit.

**Implementation**:
```javascript
// Every transaction creates two entries
const ledgerResult = await LedgerEntry.createDoubleEntry({
  transactionId,
  debitAccount: sourceAccount,
  creditAccount: destinationAccount,
  amount,
  currency,
  description,
  category: 'transfer'
});
```

**Invariant Verification**:
```javascript
// Verify total debits equal total credits
const integrity = await LedgerEntry.verifyLedgerIntegrity();
// Returns: { isBalanced: true/false, imbalancedTransactions: [] }
```

**Benefits**:
- Money is never created or destroyed
- Easy to detect corruption
- Clear audit trail
- Regulatory compliance

### 3. Idempotency Implementation

**Decision**: Implement comprehensive idempotency to handle all retry scenarios.

## Idempotency Scenarios

### Scenario A: Same Key Arrives Twice
**Mechanism**: 
1. First request creates idempotency key record with payload hash
2. Second request finds existing key with same hash
3. Returns cached response, no processing occurs

**Database Level**:
```javascript
// Check idempotency first
const idempotencyCheck = await Transaction.checkIdempotency(key, payloadHash);
if (idempotencyCheck.exists) {
  return cachedResponse; // No database writes
}
```

### Scenario B: Three Identical Requests Within 100ms
**Mechanism**:
1. MongoDB unique index on idempotency key prevents duplicates
2. First request succeeds, others get duplicate key error
3. Application catches error and returns cached response

**Database Level**:
```javascript
// Unique index ensures atomicity
const idempotencyKey = new IdempotencyKey({
  key: uniqueKey,
  payloadHash,
  transactionId,
  expiresAt
});
// Second concurrent insert fails with duplicate key error
```

### Scenario C: Server Crashes After Debit, Before Credit
**Mechanism**:
1. Transaction uses MongoDB session for atomicity
2. Both ledger entries and account updates in single transaction
3. On recovery, pending transactions are detected and retried

**Database Level**:
```javascript
const session = await mongoose.startSession();
session.startTransaction();
try {
  // All operations in single transaction
  await sourceLedgerEntry.save({ session });
  await destLedgerEntry.save({ session });
  await sourceAccount.save({ session });
  await destAccount.save({ session });
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction(); // Rollback all changes
}
```

### Scenario D: Idempotency Key Expires After 24 Hours
**Mechanism**:
1. TTL index automatically removes expired keys
2. Client retries with expired key are treated as new requests
3. Clear error returned indicating key expiration

**Database Level**:
```javascript
// TTL index for automatic cleanup
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Check expiration
if (existingKey.expiresAt < new Date()) {
  await IdempotencyKey.deleteOne({ key });
  return { exists: false, expired: true };
}
```

### Scenario E: Payload Mismatch Detection
**Mechanism**:
1. Payload hash stored with idempotency key
2. Subsequent requests with same key but different payload detected
3. Clear error returned indicating mismatch

**Database Level**:
```javascript
// Compare payload hashes
if (existingKey.payloadHash !== payloadHash) {
  throw new Error('Idempotency key exists but payload mismatch detected');
}
```

### 4. FX Rate Locking

**Decision**: Implement time-locked quotes with 60-second TTL and single-use enforcement.

**Implementation**:
```javascript
// Create quote with locked rate
const quote = await FXQuote.createQuote({
  sourceCurrency,
  targetCurrency,
  sourceAmount,
  exchangeRate: currentRate,
  userId
});

// Quote expires after 60 seconds
expiresAt: new Date(Date.now() + 60 * 1000)
```

**Single-Use Enforcement**:
```javascript
// Mark quote as used when processing transfer
await quote.markAsUsed(transactionId);

// Prevent reuse
if (quote.transactionId) {
  throw new Error('Quote has already been used');
}
```

**Provider Failure Handling**:
```javascript
try {
  const rateData = await FXQuote.getExchangeRate(sourceCurrency, targetCurrency);
} catch (error) {
  throw new Error('FX provider unavailable - cannot process transfer');
}
```

### 5. BullMQ for Payroll Processing

**Decision**: Use BullMQ with concurrency control per employer account.

**Why Better Than Locking**:
- No database lock contention
- Automatic retry and failure handling
- Progress tracking and resumption
- Horizontal scaling possible

**Concurrency Control**:
```javascript
const worker = new Worker('payroll-processing', processor, {
  limiter: {
    max: 1,                    // Only one job per employer
    duration: 1000,
    groupKey: (job) => job.data.employerId  // Group by employer
  }
});
```

**Benefits for 14,000 Credits**:
- No long-running database locks
- Process in batches with checkpoints
- Automatic retry on failures
- Real-time progress tracking

### 6. Field-Level Encryption

**Decision**: Implement envelope encryption with two-key hierarchy.

**Implementation**:
```javascript
// Master key from environment
const masterKey = deriveMasterKey();

// Generate unique data key per record
const dataKey = generateDataKey();
const encryptedDataKey = encryptDataKey(dataKey);

// Encrypt fields with data key
const encrypted = encryptField(sensitiveData, dataKey);
```

**Security Benefits**:
- Raw data never in database
- Compromise limits to single record
- Key rotation possible
- Compliance with data protection laws

### 7. Database Optimization

**Decision**: Implement proper indexing and query optimization.

**Transaction History Optimization**:
```javascript
// Compound indexes for common queries
transactionSchema.index({ sourceAccount: 1, createdAt: -1 });
transactionSchema.index({ destinationAccount: 1, createdAt: -1 });

// Pagination instead of cursor-based
const transactions = await Transaction.find(query)
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);
```

### 8. Comprehensive Monitoring

**Decision**: Implement full observability stack.

**Metrics (Prometheus)**:
- Transaction throughput and latency
- Ledger invariant violations (critical alert)
- System resource usage
- Error rates by service

**Logging (Winston)**:
- Structured JSON logs
- Request tracing across services
- No sensitive data in logs

**Tracing (Jaeger)**:
- End-to-end transaction traces
- Performance bottleneck identification
- Failure scenario analysis

## Critical Alert: Ledger Invariant Violations

```javascript
// Alert if any violations exist
const integrity = await LedgerEntry.verifyLedgerIntegrity();
if (!integrity.isBalanced) {
  // Trigger immediate alert
  alertManager.sendCriticalAlert('Ledger invariant violations detected!', {
    violations: integrity.imbalancedTransactions
  });
}
```

## Tradeoffs Made

1. **Performance vs. Consistency**: Chose strong consistency for financial data
2. **Complexity vs. Reliability**: Added complexity for idempotency and atomicity
3. **Storage vs. Query Speed**: Additional indexes increase storage but improve performance
4. **Microservice Overhead**: Added network latency for better isolation

## Before Production

1. **Load Testing**: Verify 1000+ TPS capability
2. **Security Audit**: Penetration testing and code review
3. **Disaster Recovery**: Backup and restore procedures
4. **Regulatory Compliance**: Financial regulations review
5. **Performance Tuning**: Database and application optimization
6. **Monitoring Enhancement**: More granular alerts and dashboards

## Conclusion

The redesigned NovaPay system addresses all original failures through:
- Strong idempotency guarantees
- Atomic double-entry ledger
- Time-locked FX rates
- Optimized database operations
- Comprehensive monitoring
- Field-level encryption

This architecture provides a solid foundation for a reliable, scalable financial processing system.
