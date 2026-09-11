@echo off
setlocal EnableDelayedExpansion
REM Start Flightdeck: core, the deck, and a window pointed at it (P2-T6).
REM
REM It runs the PRODUCTION build on purpose. `next dev` renders the deck and never hydrates - no
REM button works and no fetch is issued (RESEARCH.md G.3, open as P2-T6b). `next build` then
REM `next start` works completely, so that is what this does, and it rebuilds every time rather
REM than serving a stale bundle silently.
REM
REM Ports are never chosen dynamically. A second core would issue a second token and answer with a
REM stale session list, which is worse than not starting (SECURITY.md section 7 rule 1).

cd /d "%~dp0"
set CORE_PORT=4950
set UI_PORT=4949

echo.
echo   Flightdeck
echo   ----------

REM ---- core --------------------------------------------------------------------------------
call :port_busy %CORE_PORT%
if "!BUSY!"=="1" (
  echo   core     already running on 127.0.0.1:%CORE_PORT%
) else (
  echo   core     starting on 127.0.0.1:%CORE_PORT%
  start "flightdeck-core" /min cmd /c "node scripts\flightdeck-core.ts > .flightdeck-core.log 2>&1"
  call :wait_loopback %CORE_PORT% 30
  if "!LOOPBACK!"=="0" (
    echo   core     FAILED to bind 127.0.0.1:%CORE_PORT% - see .flightdeck-core.log
    exit /b 1
  )
)

REM ---- the deck ----------------------------------------------------------------------------
call :port_busy %UI_PORT%
if "!BUSY!"=="1" (
  echo   deck     already running on port %UI_PORT%
) else (
  echo   deck     building
  call npm run build >nul 2>&1
  if errorlevel 1 (
    echo   deck     BUILD FAILED - run "npm run build" to see why
    exit /b 1
  )
  echo   deck     starting on 127.0.0.1:%UI_PORT%
  start "flightdeck-deck" /min cmd /c "npm start > .flightdeck-deck.log 2>&1"
  call :wait_loopback %UI_PORT% 60
  if "!LOOPBACK!"=="0" (
    echo   deck     FAILED to bind 127.0.0.1:%UI_PORT% - see .flightdeck-deck.log
    echo            listening on 0.0.0.0 means the -H flag was lost - SEC-NET-1
    exit /b 1
  )
)

REM ---- the window --------------------------------------------------------------------------
REM --app gives a frameless window with no address bar, which is the closest a browser gets to a
REM desktop app without the Tauri shell DP3 deferred (DECISIONS.md D22).
set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if not exist "%EDGE%" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
if exist "%EDGE%" (
  start "" "%EDGE%" --app=http://127.0.0.1:%UI_PORT%/deck
  echo   window   Edge app window opened
) else (
  echo   window   Edge not found - open http://127.0.0.1:%UI_PORT%/deck yourself
)

echo.
echo   ready    http://127.0.0.1:%UI_PORT%/deck
echo   stop     flightdeck-stop.cmd
echo.
exit /b 0

REM ---- helpers -----------------------------------------------------------------------------

REM Is anything holding this port, on ANY address? Decides whether to start, because a server
REM bound to 0.0.0.0 still makes the port unusable.
:port_busy
set BUSY=0
for /f "tokens=*" %%L in ('netstat -ano -p TCP ^| findstr /r /c:"LISTENING" ^| findstr /r /c:":%~1  *0\.0\.0\.0"') do set BUSY=1
exit /b 0

REM Is it listening on LOOPBACK specifically? Decides whether the start SUCCEEDED. Deliberately
REM strict: `next start` defaults to 0.0.0.0 and put the deck on the LAN once already
REM (RESEARCH.md G.6, SEC-NET-1), so a regression must fail the start rather than be tolerated.
:loopback_up
set LOOPBACK=0
for /f "tokens=*" %%L in ('netstat -ano -p TCP ^| findstr /r /c:"LISTENING" ^| findstr /c:"127.0.0.1:%~1 "') do set LOOPBACK=1
exit /b 0

:wait_loopback
set /a TRIES=%~2
:wait_loop
call :loopback_up %~1
if "!LOOPBACK!"=="1" exit /b 0
set /a TRIES-=1
if !TRIES! LEQ 0 exit /b 0
REM ping is the only sleep every Windows has.
ping -n 2 127.0.0.1 >nul
goto wait_loop
