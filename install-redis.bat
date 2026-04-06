@echo off
echo Installing Redis for NovaPay Backend...
echo.

echo Downloading Redis for Windows...
powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/microsoftarchive/redis/releases/download/win-3.0.504/Redis-x64-3.0.504.msi' -OutFile 'Redis-x64-3.0.504.msi'}"

if exist "Redis-x64-3.0.504.msi" (
    echo Redis downloaded successfully!
    echo.
    echo Installing Redis...
    msiexec /i Redis-x64-3.0.504.msi /quiet /norestart
    
    echo Waiting for installation to complete...
    timeout /t 10 /nobreak
    
    echo Starting Redis service...
    net start redis
    
    if %errorlevel% == 0 (
        echo ✅ Redis installed and started successfully!
        echo 🎉 Your NovaPay backend should now connect to Redis.
    ) else (
        echo ⚠️  Redis installed but service start failed. Please start manually.
    )
    
    echo Testing Redis connection...
    node check-redis.js
    
) else (
    echo ❌ Failed to download Redis.
    echo.
    echo Please download manually from: https://github.com/microsoftarchive/redis/releases
    echo Download the latest .msi file and run it.
)

echo.
echo Installation complete.
