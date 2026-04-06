#!/bin/bash

echo "🚀 NovaPay Redis Setup Script"
echo "============================="

# Check if Redis is already running
if redis-cli ping >/dev/null 2>&1; then
    echo "✅ Redis is already running!"
    echo "🎉 Your NovaPay backend should work without Redis errors now."
    exit 0
fi

echo "❌ Redis is not running. Setting up Redis..."

# Try different installation methods

# Method 1: Try Docker (most reliable)
if command -v docker >/dev/null 2>&1; then
    echo "🐳 Using Docker to start Redis..."
    docker run -d -p 6379:6379 --name novapay-redis redis:7-alpine
    
    if [ $? -eq 0 ]; then
        echo "✅ Redis container started successfully!"
        echo "⏳ Waiting for Redis to be ready..."
        sleep 3
        
        # Test connection
        if redis-cli ping >/dev/null 2>&1; then
            echo "🎉 Redis is ready! Your NovaPay backend should work now."
        else
            echo "⚠️  Redis started but connection test failed. Please check manually."
        fi
        exit 0
    fi
fi

# Method 2: Try local Redis installation
if command -v redis-server >/dev/null 2>&1; then
    echo "🔧 Starting local Redis server..."
    redis-server --daemonize yes
    
    if [ $? -eq 0 ]; then
        echo "✅ Local Redis server started!"
        sleep 2
        
        if redis-cli ping >/dev/null 2>&1; then
            echo "🎉 Redis is ready! Your NovaPay backend should work now."
        else
            echo "⚠️  Redis started but connection test failed."
        fi
        exit 0
    fi
fi

echo "❌ Could not start Redis automatically."
echo ""
echo "Please install Redis manually:"
echo ""
echo "📦 Option 1: Install Redis locally"
echo "   - macOS: brew install redis && brew services start redis"
echo "   - Ubuntu/Debian: sudo apt-get install redis-server && sudo systemctl start redis"
echo "   - Windows: Download from https://github.com/microsoftarchive/redis/releases"
echo ""
echo "🐳 Option 2: Use Docker"
echo "   docker run -d -p 6379:6379 --name novapay-redis redis:7-alpine"
echo ""
echo "🪟 Option 3: Use the provided setup-redis.bat script (Windows)"
echo "   setup-redis.bat"
echo ""
echo "After installing Redis, restart your NovaPay backend server."
