@echo off
REM Data Handler - Windows entry point.
REM
REM Double-click this file, or run  run.cmd  from a terminal.
REM
REM WHY THIS FILE EXISTS
REM Windows marks files extracted from a downloaded ZIP as untrusted, and
REM PowerShell refuses to run an untrusted .ps1 with:
REM
REM     run.ps1 cannot be loaded. The file ... is not digitally signed.
REM
REM Every user who downloads the ZIP hits that wall before anything else
REM happens. Batch files are NOT subject to PowerShell's execution policy, so
REM this wrapper starts run.ps1 with the policy bypassed for that one process
REM only. Nothing about the machine's settings is changed.
REM
REM All flags pass straight through:  run.cmd -Build   run.cmd -Fresh -Llm
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
