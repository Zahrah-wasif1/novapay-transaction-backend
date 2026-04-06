@echo off
echo Setting up Redis for NovaPay Backend...
echo.

echo Checking if Redis is already running...
netstat -an | findstr ":6379" >nul
if %errorlevel% == 0 (
    echo Redis is already running on port 6379
    goto :test_redis
)

echo Redis is not running. Attempting to start Redis...

REM Try to start Redis service if it exists
sc query redis >nul 2>&1
if %errorlevel% == 0 (
    echo Starting Redis service...
    net start redis
    goto :test_redis
)

REM Try to find redis-server.exe in common locations
set REDIS_FOUND=0
if exist "C:\Program Files\Redis\redis-server.exe" (
    set REDIS_FOUND=1
    set REDIS_PATH="C:\Program Files\Redis\redis-server.exe"
)
if exist "C:\redis\redis-server.exe" (
    set REDIS_FOUND=1
    set REDIS_PATH="C:\redis\redis-server.exe"
)
if exist "redis-server.exe" (
    set REDIS_FOUND=1
    set REDIS_PATH="redis-server.exe"
)

if %REDIS_FOUND% == 1 (
    echo Starting Redis server...
    %REDIS_PATH%
    goto :test_redis
)

echo Redis not found. Please install Redis first:
echo.
echo Option 1: Download Redis for Windows
echo https://github.com/microsoftarchive/redis/releases
echo.
echo Option 2: Use Docker (if installed)
echo docker run -d -p 6379:6379 --name redis redis:7-alpine
echo.
echo Option 3: Use WSL (Windows Subsystem for Linux)
echo wsl --install
echo sudo apt-get update && sudo apt-get install redis-server
echo sudo systemctl start redis
echo.
goto :end

:test_redis
echo Testing Redis connection...
node check-redis.js

:end
echo.
echo Setup complete.
