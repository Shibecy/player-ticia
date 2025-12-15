# 🚀 Deploy para Servidor Ubuntu - 172.26.8.176

## Passo 1: Conectar ao Servidor

```bash
ssh ubuntu@172.26.8.176
```

## Passo 2: Verificar onde está o projeto

```bash
# Verificar se já existe
ls -la ~
ls -la /home/ubuntu

# Encontrar o projeto player
find ~ -name "player-ticia" -o -name "server.js" 2>/dev/null
```

## Passo 3: Enviar arquivos novos do Windows para o servidor

**Execute no Windows (Git Bash ou PowerShell):**

```bash
# Ir para o diretório do projeto
cd /c/Users/Usuario/Documents/player-ticia-repo

# Enviar os arquivos novos para o servidor
scp boadica-scraper.js ubuntu@172.26.8.176:~/player-ticia/
scp boadica-routes.js ubuntu@172.26.8.176:~/player-ticia/
scp package.json ubuntu@172.26.8.176:~/player-ticia/
scp server.js ubuntu@172.26.8.176:~/player-ticia/
scp public/boadica-dashboard.html ubuntu@172.26.8.176:~/player-ticia/public/

# Ou se o caminho for diferente, ajuste:
# scp boadica-scraper.js ubuntu@172.26.8.176:/caminho/do/projeto/
```

## Passo 4: No servidor, instalar dependências

**Execute no servidor Ubuntu:**

```bash
# Ir para o diretório do projeto
cd ~/player-ticia  # ou o caminho correto

# Instalar as novas dependências
npm install

# Verificar se instalou
npm list jsdom node-cron node-fetch
```

## Passo 5: Rebuild e reiniciar o Docker

```bash
# Parar os containers
docker-compose down

# Rebuild da imagem
docker-compose build

# Subir novamente
docker-compose up -d

# Ver os logs para confirmar
docker-compose logs -f
```

Você deve ver no log:

```
╔════════════════════════════════════════╗
║  🎵 Player TI&CIA Server Running      ║
║  📡 Port: 8080                        ║
║  ...                                   ║
║  🎯 BoaDica: /boadica-dashboard.html   ║
║  📊 API: /api/boadica/*                ║
║  ⏰ Auto: Todo dia às 8:00             ║
╚════════════════════════════════════════╝
✓ Rotas do BoaDica configuradas
✓ Job agendado: Todo dia às 8:00 (America/Sao_Paulo)
```

## Passo 6: Testar

### Pelo servidor:
```bash
# Status
curl http://localhost:8080/api/boadica/status

# Executar análise de teste
curl -X POST http://localhost:8080/api/boadica/executar
```

### Pelo navegador:
```
https://player.tiecia.com.br/boadica-dashboard.html
```

---

## Alternativa: Usar Git (Recomendado)

Se o projeto usa Git no servidor:

```bash
# No Windows, fazer commit e push
cd /c/Users/Usuario/Documents/player-ticia-repo
git add .
git commit -m "Add BoaDica monitoring system"
git push

# No servidor, fazer pull
ssh ubuntu@172.26.8.176
cd ~/player-ticia  # ou caminho correto
git pull
npm install
docker-compose down
docker-compose build
docker-compose up -d
```

---

## Troubleshooting

### Se der erro "Cannot find module"
```bash
# Reinstalar dependências
rm -rf node_modules package-lock.json
npm install
docker-compose build --no-cache
docker-compose up -d
```

### Ver logs de erro
```bash
docker-compose logs -f player
```

### Verificar se porta 8080 está aberta
```bash
sudo netstat -tlnp | grep 8080
```

### Verificar banco de dados
```bash
ls -la data/mvp.db
sqlite3 data/mvp.db "SELECT name FROM sqlite_master WHERE type='table';"
```

Deve mostrar as novas tabelas:
- boadica_produtos
- boadica_precos
- boadica_alertas

---

## Rollback (se algo der errado)

```bash
# Voltar versão anterior
git checkout HEAD~1
docker-compose down
docker-compose build
docker-compose up -d
```
