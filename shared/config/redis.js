const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;
let bullmqRedis = null;

async function initializeRedis() {
  try {
    // First check if Redis is available by testing connection
    const testRedis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      connectTimeout: 2000,
      commandTimeout: 1000,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryDelayOnFailover: 0,
      reconnectOnError: () => false
    });

    // Add error handler to prevent unhandled errors
    testRedis.on('error', () => {}); // Silent error handler for test

    try {
      await testRedis.connect();
      await testRedis.ping();
      await testRedis.disconnect();
      
      // Redis is available, create full clients
      redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        retryDelayOnFailover: 0, // Disable failover retries
        enableReadyCheck: false,
        maxRetriesPerRequest: 0, // Disable retries to prevent spam
        lazyConnect: true,
        // Add better error handling
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 3000,
        commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT) || 2000,
        retryDelayOnClusterDown: 0, // Disable cluster down retries
        family: 4,
        keepAlive: 30000,
        // Disable automatic reconnect to prevent spam
        autoResendUnfulfilledCommands: false,
        autoResubscribe: false,
        // Completely disable reconnect
        reconnectOnError: () => false,
        maxRetriesPerRequest: 0
      });

      bullmqRedis = new Redis({
        host: process.env.BULLMQ_REDIS_HOST || process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.BULLMQ_REDIS_PORT) || parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.BULLMQ_REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined,
        retryDelayOnFailover: 0, // Disable failover retries
        enableReadyCheck: false,
        maxRetriesPerRequest: 0, // Disable retries to prevent spam
        lazyConnect: true,
        // Add better error handling
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 3000,
        commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT) || 2000,
        retryDelayOnClusterDown: 0, // Disable cluster down retries
        family: 4,
        keepAlive: 30000,
        // Disable automatic reconnect to prevent spam
        autoResendUnfulfilledCommands: false,
        autoResubscribe: false,
        // Completely disable reconnect
        reconnectOnError: () => false,
        maxRetriesPerRequest: 0
      });

      // Handle all error events to prevent unhandled errors
      redisClient.on('error', (error) => {
        logger.warn('Redis client error (handled)', { error: error.message });
      });

      bullmqRedis.on('error', (error) => {
        logger.warn('BullMQ Redis client error (handled)', { error: error.message });
      });

      redisClient.on('disconnect', () => {
        logger.warn('Redis client disconnected (handled)');
      });

      bullmqRedis.on('disconnect', () => {
        logger.warn('BullMQ Redis client disconnected (handled)');
      });

      redisClient.on('close', () => {
        logger.warn('Redis client connection closed (handled)');
      });

      bullmqRedis.on('close', () => {
        logger.warn('BullMQ Redis client connection closed (handled)');
      });

      // Try to connect
      await redisClient.connect();
      await bullmqRedis.connect();

      logger.info('Connected to Redis', {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      });
      
    } catch (testError) {
      logger.warn('Redis connection failed, continuing without Redis', { 
        error: testError.message 
      });
      // Don't create Redis clients at all if not available
    }
    
  } catch (error) {
    logger.warn('Failed to initialize Redis, continuing without Redis', { error: error.message });
    // Don't throw the error, just continue without Redis
  }
}

function getRedisClient() {
  if (!redisClient) {
    // Return a mock client instead of throwing error
    return new MockRedisClient();
  }
  return redisClient;
}

function getBullMQRedis() {
  if (!bullmqRedis) {
    // Return a mock client instead of throwing error
    return new MockRedisClient();
  }
  return bullmqRedis;
}

// Mock Redis client for when Redis is not available
class MockRedisClient {
  constructor() {
    this.status = 'ready';
  }

  async connect() {
    return Promise.resolve();
  }

  async disconnect() {
    return Promise.resolve();
  }

  async quit() {
    return Promise.resolve('OK');
  }

  async get(key) {
    return null;
  }

  async set(key, value, ...args) {
    return 'OK';
  }

  async del(key) {
    return 1;
  }

  async exists(key) {
    return 0;
  }

  async expire(key, seconds) {
    return 1;
  }

  on(event, handler) {
    // Mock event handler
  }

  once(event, handler) {
    // Mock event handler
  }
}

// Check if Redis is available
function isRedisAvailable() {
  return redisClient && bullmqRedis && 
         redisClient.status === 'ready' && 
         bullmqRedis.status === 'ready';
}

module.exports = {
  initializeRedis,
  getRedisClient,
  getBullMQRedis,
  isRedisAvailable,
  MockRedisClient
};
