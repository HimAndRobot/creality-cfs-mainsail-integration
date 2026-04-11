Windows rapido

1. Entre na pasta:
   cd k1c-cfs-mini

2. Rode:
   powershell -ExecutionPolicy Bypass -File .\run-windows.ps1

3. Abra no navegador para conferir a API:
   http://127.0.0.1:8010/api/health

4. No Tampermonkey, use este URL para instalar o userscript:
   http://127.0.0.1:8010/tampermonkey.user.js

5. Abra o Mainsail:
   http://192.168.1.242:4409/

Observacao:
- O Windows precisa conseguir acessar a impressora em ws://192.168.1.242:9999
- O navegador que abre o Mainsail precisa conseguir acessar http://127.0.0.1:8010
