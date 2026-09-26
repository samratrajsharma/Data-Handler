@echo off
REM Batch wrapper, for the same reason run.cmd exists: a .ps1 extracted from a
REM downloaded ZIP carries the Mark of the Web, and Windows refuses to run it
REM ("is not digitally signed"). A .cmd is not subject to that, and can start
REM PowerShell with the policy bypassed for this one process only — nothing
REM about the machine's settings is changed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1" %*
