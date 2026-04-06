const Redis = require('ioredis');
require('dotenv').config();

async function checkRedisConnection() {
  console.log('Checking Redis connection...');
  
  const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 5000,
    commandTimeout: 3000,
    lazyConnect: true
  });

  try {
    await redisClient.connect();
    console.log('✅ Redis connection successful!');
    
    // Test basic operations
    await redisClient.set('test-key', 'test-value');
    const value = await redisClient.get('test-key');
    console.log('✅ Redis read/write test passed:', value);
    
    await redisClient.del('test-key');
    await redisClient.quit();
    
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    console.log('\nPossible solutions:');
    console.log('1. Install and start Redis locally:');
    console.log('   - Windows: Download Redis from GitHub or use WSL');
    console.log('   - Mac: brew install redis && brew services start redis');
    console.log('   - Linux: sudo apt-get install redis-server && sudo systemctl start redis');
    console.log('\n2. Use Docker (if Docker is installed):');
    console.log('   docker run -d -p 6379:6379 --name redis redis:7-alpine');
    console.log('\n3. Update .env file with correct Redis host/port/password');
    process.exit(1);
  }
}

checkRedisConnection();
