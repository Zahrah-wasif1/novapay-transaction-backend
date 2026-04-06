const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
require('dotenv').config();

const logger = require('./shared/utils/logger');
const { connectDB } = require('./shared/config/database');
const { initializeRedis } = require('./shared/config/redis');
const { initializeMetrics } = require('./shared/config/metrics');

const AccountService = require('./services/account-service');
const TransactionService = require('./services/transaction-service');
const LedgerService = require('./services/ledger-service');
const PayrollService = require('./services/payroll-service');
const AdminService = require('./services/admin-service');

const app = express();
const server = createServer(app);

app.use(helmet());

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use(limiter);

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || require('uuid').v4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  
  logger.info('Incoming request', {
    requestId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    requestId: req.requestId
  });
});

app.get('/metrics', async (req, res) => {
  try {
    const { register } = require('./src/config/metrics');
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    logger.error('Error generating metrics', { error: error.message });
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

app.use('/api/accounts', AccountService);
app.use('/api/transactions', TransactionService);
app.use('/api/ledger', LedgerService);
app.use('/api', PayrollService);
app.use('/api/admin', AdminService);

app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    requestId: req.requestId,
    error: error.message,
    stack: error.stack
  });
  
  res.status(error.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    requestId: req.requestId
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    requestId: req.requestId
  });
});

async function startServer() {
  try {
    await connectDB();
    
    try {
      await initializeRedis();
    } catch (redisError) {
      logger.warn('Redis connection failed, continuing without Redis', {
        error: redisError.message
      });
    }
    
    initializeMetrics();
    
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
      logger.info(`NovaPay Transaction Backend started on port ${PORT}`, {
        port: PORT,
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version || '1.0.0'
      });
    });
    
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await mongoose.connection.close();
      logger.info('Database connection closed');
      
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  });
}

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

if (require.main === module) {
  startServer();
}

module.exports = { app, server };
