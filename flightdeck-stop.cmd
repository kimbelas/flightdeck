@echo off



REM Stop core and the deck. Panes close with core; the SESSIONS THEY WERE ATTACHED TO KEEP RUNNING



REM - killing an attach never stops a session (RESEARCH.md F.2.6), which is the whole reason a pane



REM is safe to close.



REM



REM Core drops its token file on a CLEAN shutdown -- but this script is taskkill /F, which runs

REM no handler, so it drops the token itself. A token left behind with nothing listening costs

REM every statusline render 51 ms instead of 0.10 ms (RESEARCH.md F.3.3).







setlocal EnableDelayedExpansion



echo.



echo   stopping Flightdeck







for %%P in (4950 4949) do (



  set FOUND=0



  REM Any bind address, not just loopback: stopping means stopping whatever holds the port, and

  REM a server that wrongly bound 0.0.0.0 is exactly the one that most needs stopping (G.6).

  for /f "tokens=5" %%A in ('netstat -ano -p TCP ^| findstr /r /c:"LISTENING" ^| findstr /r /c:":%%P  *0\.0\.0\.0"') do (



    taskkill /PID %%A /T /F >nul 2>&1



    set FOUND=1



  )



  if "!FOUND!"=="1" (echo   stopped  127.0.0.1:%%P) else (echo   -        127.0.0.1:%%P was not running)



)







node "%~dp0scripts\drop-token.ts" >nul 2>&1
if exist "%LOCALAPPDATA%\flightdeck\token" (echo   -        token file could not be removed) else (echo   dropped  the core token)

echo.



exit /b 0



