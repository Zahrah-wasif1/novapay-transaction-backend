const client = require('prom-client');
const logger = require('../utils/logger');

// Create a Registry
const register = new client.Registry();

// Add default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const transactionTotal = new client.Counter({
  name: 'transactions_total',
  help: 'Total number of transactions',
  labelNames: ['type', 'status', 'currency'],
  registers: [register]
});

const transactionAmount = new client.Histogram({
  name: 'transaction_amount',
  help: 'Transaction amounts',
  labelNames: ['type', 'currency'],
  buckets: [10, 50, 100, 500, 1000, 5000, 10000, 50000],
  registers: [register]
});

const transactionDuration = new client.Histogram({
  name: 'transaction_duration_seconds',
  help: 'Duration of transaction processing in seconds',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register]
});

const ledgerInvariantViolations = new client.Gauge({
  name: 'ledger_invariant_violations',
  help: 'Number of ledger invariant violations (should be 0)',
  registers: [register]
});

const activeAccounts = new client.Gauge({
  name: 'active_accounts_total',
  help: 'Number of active accounts',
  labelNames: ['currency'],
  registers: [register]
});

const payrollJobsTotal = new client.Counter({
  name: 'payroll_jobs_total',
  help: 'Total number of payroll jobs',
  labelNames: ['status'],
  registers: [register]
});

const payrollEmployeesProcessed = new client.Counter({
  name: 'payroll_employees_processed_total',
  help: 'Total number of payroll employees processed',
  labelNames: ['status'],
  registers: [register]
});

const fxQuotesTotal = new client.Counter({
  name: 'fx_quotes_total',
  help: 'Total number of FX quotes',
  labelNames: ['status', 'source_currency', 'target_currency'],
  registers: [register]
});

const databaseConnections = new client.Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections',
  registers: [register]
});

const redisConnections = new client.Gauge({
  name: 'redis_connections_active',
  help: 'Number of active Redis connections',
  registers: [register]
});

function initializeMetrics() {
  logger.info('Metrics initialized');
}

// Helper functions to record metrics
function recordHttpRequest(method, route, statusCode, duration) {
  const labels = { method, route, status_code: statusCode.toString() };
  httpRequestTotal.inc(labels);
  httpRequestDuration.observe(labels, duration / 1000); // Convert ms to seconds
}

function recordTransaction(type, status, currency, amount, duration) {
  transactionTotal.inc({ type, status, currency });
  transactionAmount.observe({ type, currency }, parseFloat(amount));
  transactionDuration.observe({ type }, duration / 1000);
}

function recordLedgerInvariantViolations(count) {
  ledgerInvariantViolations.set(count);
}

function recordActiveAccounts(currency, count) {
  activeAccounts.set({ currency }, count);
}

function recordPayrollJob(status) {
  payrollJobsTotal.inc({ status });
}

function recordPayrollEmployee(status) {
  payrollEmployeesProcessed.inc({ status });
}

function recordFXQuote(status, sourceCurrency, targetCurrency) {
  fxQuotesTotal.inc({ status, source_currency: sourceCurrency, target_currency: targetCurrency });
}

function recordDatabaseConnections(count) {
  databaseConnections.set(count);
}

function recordRedisConnections(count) {
  redisConnections.set(count);
}

module.exports = {
  register,
  initializeMetrics,
  recordHttpRequest,
  recordTransaction,
  recordLedgerInvariantViolations,
  recordActiveAccounts,
  recordPayrollJob,
  recordPayrollEmployee,
  recordFXQuote,
  recordDatabaseConnections,
  recordRedisConnections
};
