# Integração do Monitoramento BoaDica

## Arquivos Criados

1. **boadica-scraper.js** - Módulo principal de scraping
2. **boadica-routes.js** - Rotas API e job agendado
3. **public/boadica-dashboard.html** - Dashboard visual (será criado)

## Como Integrar no server.js

Adicione estas linhas no seu **server.js**, logo após a inicialização do banco de dados:

```javascript
// Importar módulo do BoaDica
import { setupBoadicaRoutes } from './boadica-routes.js';

// ... seu código existente ...

// Depois de configurar o Express e antes de app.listen():
setupBoadicaRoutes(app, db);
```

### Exemplo completo de onde adicionar:

```javascript
// No início do arquivo, junto com outros imports:
import { setupBoadicaRoutes } from './boadica-routes.js';

// ... todo seu código do server.js ...

// Depois das rotas existentes, antes do app.listen():
app.use(express.json()); // Se ainda não tiver

// Configurar rotas do BoaDica
setupBoadicaRoutes(app, db);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Instalar Dependências

```bash
cd /c/Users/Usuario/Documents/player-ticia-repo
npm install
```

## APIs Disponíveis

### 1. Status do Monitoramento
```bash
GET /api/boadica/status
```

Retorna:
```json
{
  "success": true,
  "total_produtos": 150,
  "alertas_pendentes": 12,
  "ultima_atualizacao": "2025-12-15 10:30:00"
}
```

### 2. Executar Análise Manual
```bash
POST /api/boadica/executar
```

Retorna:
```json
{
  "sucesso": true,
  "processados": 150,
  "comMinhasLojas": 45,
  "alertasGerados": 12,
  "tempoTotal": "180.50"
}
```

### 3. Listar Alertas
```bash
GET /api/boadica/alertas
GET /api/boadica/alertas?nao_visualizados=true
```

Retorna:
```json
{
  "success": true,
  "total": 12,
  "alertas": [
    {
      "id": 1,
      "produto_id": "154982",
      "nome_produto": "Mouse Gamer RGB",
      "meu_preco": 89.90,
      "melhor_preco": 79.90,
      "diferenca": 10.00,
      "percentual": 12.51,
      "minhas_lojas": "TI e CIA Centro",
      "data_alerta": "2025-12-15 08:00:00",
      "visualizado": 0
    }
  ]
}
```

### 4. Marcar Alertas como Visualizados
```bash
POST /api/boadica/alertas/visualizar
Content-Type: application/json

{
  "ids": [1, 2, 3]
}
```

### 5. Histórico de Preços
```bash
GET /api/boadica/produto/154982/historico
GET /api/boadica/produto/154982/historico?dias=7
```

### 6. Relatório Completo
```bash
GET /api/boadica/relatorio
```

## Job Agendado

O sistema executa automaticamente **todo dia às 8:00** (horário de Brasília):

- Busca todos os produtos do BoaDica
- Extrai preços de todas as lojas
- Identifica produtos das suas lojas (TI e CIA Centro, TI e CIA Itaipu)
- Compara preços e gera alertas quando você não está com o melhor preço
- Salva tudo no banco de dados SQLite

## Dashboard Web

Após integrar, acesse:
```
http://localhost:8080/boadica-dashboard.html
```

O dashboard mostra:
- Status do monitoramento
- Alertas de produtos onde você está perdendo
- Histórico de preços
- Botão para executar análise manual

## Configuração das Lojas

Para alterar os nomes das suas lojas, edite o arquivo **boadica-scraper.js**:

```javascript
const MINHAS_LOJAS = ['TI e CIA Centro', 'TI e CIA Itaipu'];
```

## Alterar Horário do Job

Para mudar o horário da execução automática, edite o arquivo **boadica-routes.js**:

```javascript
// Formato: 'minuto hora * * *'
cron.schedule('0 8 * * *', async () => {
  // Todo dia às 8:00
});

// Exemplos:
// '0 9 * * *'  - Todo dia às 9:00
// '30 8 * * *' - Todo dia às 8:30
// '0 8,18 * * *' - Todo dia às 8:00 e 18:00
// '0 */6 * * *' - A cada 6 horas
```

## Estrutura do Banco de Dados

### Tabela: boadica_produtos
- produto_id (TEXT) - ID do produto no BoaDica
- nome (TEXT) - Nome do produto
- url (TEXT) - URL do produto
- ultima_atualizacao (TEXT) - Data da última atualização

### Tabela: boadica_precos
- produto_id (TEXT) - ID do produto
- loja (TEXT) - Nome da loja
- preco (REAL) - Preço
- eh_minha_loja (INTEGER) - 1 se for sua loja, 0 caso contrário
- data_captura (TEXT) - Data/hora da captura

### Tabela: boadica_alertas
- produto_id (TEXT) - ID do produto
- nome_produto (TEXT) - Nome do produto
- meu_preco (REAL) - Seu melhor preço
- melhor_preco (REAL) - Melhor preço do mercado
- diferenca (REAL) - Diferença em R$
- percentual (REAL) - Diferença percentual
- minhas_lojas (TEXT) - Suas lojas que tem o produto
- data_alerta (TEXT) - Data/hora do alerta
- visualizado (INTEGER) - 0 = não visualizado, 1 = visualizado

## Testando

1. Inicie o servidor:
```bash
cd /c/Users/Usuario/Documents/player-ticia-repo
npm start
```

2. Teste a API:
```bash
# Status
curl http://localhost:8080/api/boadica/status

# Executar análise manual
curl -X POST http://localhost:8080/api/boadica/executar

# Ver alertas
curl http://localhost:8080/api/boadica/alertas
```

## Logs

O sistema gera logs no console:
- `🔍 Buscando lista de produtos...` - Iniciando busca
- `✓ Encontrados X produtos` - Produtos encontrados
- `[X/Y] Processando...` - Progresso
- `✅ Análise concluída!` - Análise finalizada
- `⏰ [CRON] Executando análise diária...` - Job automático
- `🚨 [CRON] X novos alertas gerados!` - Alertas novos

## Problemas Comuns

### "Nenhum produto encontrado"
- Verifique se o site está acessível
- A estrutura HTML pode ter mudado - ajuste os seletores em `boadica-scraper.js`

### Preços não estão sendo extraídos
- Inspecione o HTML do site manualmente
- Ajuste os seletores CSS no método `extrairInfoProduto()`

### Job não está executando
- Verifique se o timezone está correto
- Confirme que o servidor ficou rodando

## Melhorias Futuras

- [ ] Notificações por email quando houver alertas
- [ ] Webhook para integrar com Telegram/WhatsApp
- [ ] Gráficos de evolução de preços
- [ ] Comparação com média do mercado
- [ ] Sugestão automática de preço ideal
