@echo off
chcp 65001 >nul
title Controle Financeiro
color 0B

set "PROJETO=%~dp0"

echo.
echo  ===========================================================
echo    CONTROLE FINANCEIRO - versao local
echo  ===========================================================
echo.
echo    Use esta versao so para testes no proprio computador.
echo    Para uso do dia a dia, acesse pelo navegador:
echo.
echo      https://controle-financeiro-five-swart.vercel.app
echo.
echo  ===========================================================
echo.
echo    Iniciando...
echo    Vao abrir duas janelas pretas. NAO FECHE enquanto usar.
echo.

if not exist "%PROJETO%backend\node_modules" (
    echo    Primeira execucao: instalando o servidor...
    pushd "%PROJETO%backend"
    call npm install --silent
    popd
)

if not exist "%PROJETO%frontend\node_modules" (
    echo    Primeira execucao: instalando o site...
    pushd "%PROJETO%frontend"
    call npm install --silent
    popd
)

echo    [1/2] Ligando o servidor...
start "Controle Financeiro - SERVIDOR (nao feche)" cmd /k "cd /d "%PROJETO%backend" && npm start"

echo    [2/2] Ligando o site...
start "Controle Financeiro - SITE (nao feche)" cmd /k "cd /d "%PROJETO%frontend" && npm run dev"

echo.
echo    Aguardando ficar pronto...
timeout /t 10 /nobreak >nul

start http://localhost:5173

echo.
echo  ===========================================================
echo.
echo    Abriu em:  http://localhost:5173
echo.
echo    Esta janela pode ser fechada. As outras duas, nao.
echo.
pause
