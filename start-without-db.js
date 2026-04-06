/**
 * Start NovaPay server without external dependencies
 * This allows testing the API structure without MongoDB/Redis
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
require('dotenv').config();

const logger = require('./shared/utils/logger');

// Mock database and Redis for testing
const mockDB = {
  connected: false,
  collections: {},
  
  async connect() {
    this.connected = true;
    logger.info('Mock database connected');
  },
  
  collection(name) {
    if (!this.collections[name]) {
      this.collections[name] = new MockCollection();
    }
    return this.collections[name];
  }
};

class MockCollection {
  constructor() {
    this.data = [];
  }
  
  async findOne(query) {
    return this.data.find(item => 
      Object.keys(query).every(key => item[key] === query[key])
    );
  }
  
  async find(query) {
    return this.data.filter(item => 
      Object.keys(query).every(key => item[key] === query[key])
    );
  }
  
  async save() {
    // Mock save
    return this;
  }
}

const mockRedis = {
  connected: false,
  
  async connect() {
    this.connected = true;
    logger.info('Mock Redis connected');
  },
  
  isAvailable() {
    return this.connected;
  },
  
  getClient() {
    return this;
  }
};

// Override database and Redis connections
const originalConnectDB = require('./shared/config/database').connectDB;
const originalInitializeRedis = require('./shared/config/redis').initializeRedis;

require('./shared/config/database').connectDB = mockDB.connect.bind(mockDB);
require('./shared/config/redis').initializeRedis = mockRedis.connect.bind(mockRedis);
require('./shared/config/redis').isRedisAvailable = mockRedis.isAvailable.bind(mockRedis);
require('./shared/config/redis').getBullMQRedis = mockRedis.getClient.bind(mockRedis);

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
    userAgent: req.get('User-Agent')
  });
  
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: mockDB.connected ? 'connected' : 'disconnected',
        redis: mockRedis.connected ? 'connected' : 'disconnected'
      },
      requestId: req.requestId
    };
    
    res.status(200).json(health);
  } catch (error) {
    logger.error('Health check failed', { error: error.message, requestId: req.requestId });
    res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
      requestId: req.requestId
    });
  }
});

// Load services (they will use mock connections)
try {
  const AccountService = require('./services/account-service');
  const TransactionService = require('./services/transaction-service');
  const LedgerService = require('./services/ledger-service');
  const PayrollService = require('./services/payroll-service');
  const AdminService = require('./services/admin-service');

  app.use('/api/accounts', AccountService);
  app.use('/api/transactions', TransactionService);
  app.use('/api/ledger', LedgerService);
  app.use('/api', PayrollService);
  app.use('/api/admin', AdminService);

  logger.info('All services loaded successfully');
} catch (error) {
  logger.error('Failed to load services', { error: error.message });
}

// Error handling middleware
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
    // Initialize mock connections
    await mockDB.connect();
    await mockRedis.connect();
    
    const PORT = process.env.PORT || 8080;
    
    server.listen(PORT, () => {
      logger.info('NovaPay Transaction Backend started (Mock Mode)', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        mode: 'mock-database',
        requestId: 'startup'
      });
      
      console.log(`🚀 NovaPay API Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📝 API Documentation: Check NovaPay.postman_collection.json`);
      console.log(`⚠️  Running in MOCK MODE - No real database connections`);
    });
    
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Start the server
if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
