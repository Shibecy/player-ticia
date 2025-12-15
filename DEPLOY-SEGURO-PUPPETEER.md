# 🚀 Deploy Seguro - Puppeteer Otimizado

## ⚠️ IMPORTANTE - Leia Antes de Deploy

Esta versão usa Puppeteer baseado na lógica do **Manus.ia**, mas com **otimizações agressivas** para não travar o servidor.

## 🔧 Otimizações Implementadas

1. **Dockerfile minimalista**: Só instala Chromium (sem bibliotecas extras)
2. **--single-process**: Usa menos memória
3. **Timeout curto**: 10 segundos (vs 15s)
4. **Fecha browser**: Após cada análise
5. **Processa 1 por vez**: Não paraleliza

## 📋 Comandos de Deploy

### Passo 1: Backup
```bash
ssh -i seu-certificado.pem ubuntu@54.86.64.173

# Fazer backup do estado atual
cd ~
cp -r player-ticia player-ticia-backup-$(date +%Y%m%d)
```

### Passo 2: Atualizar Código
```bash
cd ~/player-ticia
git pull
```

### Passo 3: Build (VAI DEMORAR ~5min)
```bash
# Parar container atual
docker compose down

# Build com cache limpo
docker compose build --no-cache

# IMPORTANTE: Monitorar uso de memória durante build
# Se travar, cancele com Ctrl+C
```

### Passo 4: Iniciar e Monitorar
```bash
# Iniciar
docker compose up -d

# Monitorar logs EM TEMPO REAL
docker compose logs -f player

# Em outro terminal, monitorar recursos
docker stats player-ticia
```

## ✅ Sinais de Sucesso

Você deve ver nos logs:
```
✓ Tabelas do BoaDica criadas no banco de dados
✓ Rotas do BoaDica configuradas
✓ Job agendado: Todo dia às 8:00
```

## ❌ Sinais de Problema

Se ver isso, **CANCELE IMEDIATAMENTE**:
- Container reiniciando continuamente
- Uso de memória > 500MB
- CPU > 80% por mais de 2 minutos
- Erro "Cannot find module"

**Como cancelar:**
```bash
docker compose down
cd ~/player-ticia-backup-YYYYMMDD
docker compose up -d
```

## 🧪 Testar o Scraper

Depois de confirmar que está rodando:

1. Acesse: http://player.tiecia.com.br:8080/public/boadica-dashboard.html
2. Clique em "Executar Análise Agora"
3. Monitore os logs:
```bash
docker compose logs -f player
```

Você deve ver:
```
🚀 Iniciando análise BoaDica (Puppeteer Otimizado)...
🌐 Inicializando browser...
[1/1]
   Acessando: https://boadica.com.br/produtos/p144528
   ✓ Produto XPTO
   ✓ 15 ofertas encontradas
✓ Browser fechado
✅ Análise concluída!
```

## 🆘 Se Travar Novamente

1. **Pare imediatamente**:
```bash
docker compose down
```

2. **Volte para backup**:
```bash
cd ~/player-ticia-backup-YYYYMMDD
docker compose up -d
```

3. **Me avise** - Vou implementar a solução manual

## 📊 Monitoramento Contínuo

Mantenha um terminal aberto com:
```bash
watch -n 5 'docker stats player-ticia --no-stream'
```

Valores seguros:
- **CPU**: < 50%
- **Memória**: < 400MB
- **Status**: Up

## 💡 Alternativas se Falhar

Se o Puppeteer travar novamente, temos 3 opções:

**Opção A**: Interface manual (você adiciona preços manualmente - 5min/semana)

**Opção B**: Script Python local (roda no seu PC e envia para servidor via API)

**Opção C**: Servidor separado só para scraping (mais complexo)

Boa sorte! 🍀
