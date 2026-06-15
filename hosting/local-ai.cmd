@echo off
setlocal

set "INSTALL_DIR=%USERPROFILE%\local-ai"
if defined LOCAL_AI_DIR set "INSTALL_DIR=%LOCAL_AI_DIR%"
set "COMPOSE_FILE=%INSTALL_DIR%\docker-compose.release.yml"

if not exist "%COMPOSE_FILE%" (
  echo Local AI is not installed at %INSTALL_DIR%.
  echo Install it with: irm http://get.local-ai.run/install.ps1 ^| iex
  exit /b 1
)

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=help"

if /I "%ACTION%"=="start"   ( docker compose -f "%COMPOSE_FILE%" up -d & exit /b %errorlevel% )
if /I "%ACTION%"=="stop"    ( docker compose -f "%COMPOSE_FILE%" down & exit /b %errorlevel% )
if /I "%ACTION%"=="restart" ( docker compose -f "%COMPOSE_FILE%" restart & exit /b %errorlevel% )
if /I "%ACTION%"=="status"  ( docker compose -f "%COMPOSE_FILE%" ps & exit /b %errorlevel% )
if /I "%ACTION%"=="logs"    ( docker compose -f "%COMPOSE_FILE%" logs -f --tail=100 & exit /b %errorlevel% )
if /I "%ACTION%"=="help"    goto :help
if /I "%ACTION%"=="-h"      goto :help
if /I "%ACTION%"=="--help"  goto :help

echo Unknown command: %ACTION%
echo Run: local-ai help
exit /b 1

:help
echo Local AI - commands:
echo.
echo   local-ai start     Start Local AI
echo   local-ai stop      Stop Local AI
echo   local-ai restart   Restart Local AI
echo   local-ai status    Show running containers
echo   local-ai logs      Stream logs (press Ctrl+C to exit)
echo   local-ai help      Show this help
echo.
echo Open the app:  http://local-ai.localhost
echo To update:     open the app -^> Settings -^> Check for Update
exit /b 0
