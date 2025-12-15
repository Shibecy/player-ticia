# 🚀 Instalação Rápida - Monitoramento BoaDica

## ✅ Integração Concluída!

A integração no **server.js** já está pronta! Agora só precisa instalar e rodar.

---

## 1. Instalar Dependências

```bash
cd /c/Users/Usuario/Documents/player-ticia-repo
npm install
```

## 2. Reiniciar o Servidor

### Com Docker (Produção):
```bash
cd /c/Users/Usuario/Documents/player-ticia-repo
docker-compose down
docker-compose build
docker-compose up -d
```

### Sem Docker (Desenvolvimento):
```bash
npm start
```

## 3. Acessar o Dashboard

O dashboard estará disponível em:

🌐 **https://player.tiecia.com.br/boadica-dashboard.html**

Ou localmente durante testes:
🏠 **http://localhost:8080/boadica-dashboard.html**

---

## 🎯 APIs Disponíveis

Todas rodando no mesmo domínio **player.tiecia.com.br**:

```
GET  https://player.tiecia.com.br/api/boadica/status
POST https://player.tiecia.com.br/api/boadica/executar
GET  https://player.tiecia.com.br/api/boadica/alertas
POST https://player.tiecia.com.br/api/boadica/alertas/visualizar
GET  https://player.tiecia.com.br/api/boadica/relatorio
```

---

## ⏰ Execução Automática

✅ O sistema vai rodar automaticamente **todo dia às 8:00** (horário de Brasília)
✅ Vai monitorar os preços de todos os produtos do BoaDica
✅ Vai te alertar quando você não estiver com o melhor preço
✅ Tudo salvo no mesmo banco SQLite do player (**./data/mvp.db**)

---

## 🧪 Testar

### Via Browser:
1. Acesse https://player.tiecia.com.br/boadica-dashboard.html
2. Clique em "Executar Análise Agora"
3. Aguarde a análise completar
4. Veja os alertas gerados

### Via API (curl):
```bash
# Status
curl https://player.tiecia.com.br/api/boadica/status

# Executar análise manual
curl -X POST https://player.tiecia.com.br/api/boadica/executar

# Ver alertas
curl https://player.tiecia.com.br/api/boadica/alertas
```

---

## 📂 Arquivos Criados

- `boadica-scraper.js` - Módulo de scraping
- `boadica-routes.js` - Rotas e job agendado
- `public/boadica-dashboard.html` - Dashboard visual
- `package.json` - Atualizado com novas dependências

---

## 🎨 Dashboard

O dashboard mostra:
- 📊 Total de produtos monitorados
- 🔴 Alertas pendentes
- 💰 Economia possível ajustando preços
- 📅 Última atualização
- 🔄 Botão para executar análise manual
- ✅ Marcar alertas como visualizados
- 🔍 Filtros: Todos, Pendentes, Visualizados

---

## ⚙️ Configurações

### Alterar lojas monitoradas
Edite o arquivo **boadica-scraper.js** (linha 8):
```javascript
const MINHAS_LOJAS = ['TI e CIA Centro', 'TI e CIA Itaipu'];
```

### Alterar horário do job automático
Edite o arquivo **boadica-routes.js** (linha ~180):
```javascript
// Formato: 'minuto hora * * *'
cron.schedule('0 8 * * *', async () => {
  // Roda às 8:00
});

// Exemplos:
// '0 9 * * *'      - Todo dia às 9:00
// '30 8 * * *'     - Todo dia às 8:30
// '0 8,18 * * *'   - Às 8:00 e 18:00
// '0 */6 * * *'    - A cada 6 horas
```

---

## 🔍 Logs

Quando o servidor iniciar, você verá:

```
╔════════════════════════════════════════╗
║  🎵 Player TI&CIA Server Running      ║
║  📡 Port: 8080                        ║
║  📁 Music: ./music                     ║
║  🗄️  Database: ./data/mvp.db           ║
║                                        ║
║  🔐 Admin: /admin                      ║
║  📊 Overview: /admin/overview          ║
║  🎛️  Console: /admin/tracks            ║
║                                        ║
║  🎯 BoaDica: /boadica-dashboard.html   ║
║  📊 API: /api/boadica/*                ║
║  ⏰ Auto: Todo dia às 8:00             ║
╚════════════════════════════════════════╝
```

E durante a execução:
```
⏰ [CRON] Executando análise diária do BoaDica...
🔍 Buscando lista de produtos...
✓ Encontrados 150 produtos
   [1/150] Processando...
✅ Análise concluída!
   Produtos processados: 150
   Com minhas lojas: 45
   Alertas gerados: 12
🚨 [CRON] 12 novos alertas gerados!
```

---

## 📖 Documentação Completa

Veja **INTEGRACAO-BOADICA.md** para:
- Detalhes de todas as APIs
- Estrutura do banco de dados
- Troubleshooting
- Melhorias futuras

---

## ✅ Pronto!

Agora seu servidor já está monitorando os preços automaticamente!

🌐 Dashboard: **https://player.tiecia.com.br/boadica-dashboard.html**
