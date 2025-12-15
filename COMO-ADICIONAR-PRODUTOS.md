# 📝 Como Adicionar Produtos para Monitoramento

## Arquivo: produtos-monitorados.json

Edite o arquivo **produtos-monitorados.json** e adicione as URLs dos produtos que você vende no BoaDica.

## Formato:

```json
{
  "produtos": [
    "https://boadica.com.br/produtos/p121235",
    "https://boadica.com.br/produtos/p154982",
    "https://boadica.com.br/produtos/p999999"
  ]
}
```

## Como Adicionar:

### 1. Abrir o arquivo

```bash
# No servidor
nano ~/player-ticia/produtos-monitorados.json

# Ou editar localmente e fazer push
```

### 2. Adicionar URLs

Cada linha deve ter a URL completa do produto:

```json
{
  "produtos": [
    "https://boadica.com.br/produtos/p121235",
    "https://boadica.com.br/produtos/p154982",
    "https://boadica.com.br/produtos/p200000",
    "https://boadica.com.br/produtos/p300000"
  ]
}
```

**⚠️ Importante:**
- Mantenha as vírgulas entre as linhas
- A última linha NÃO tem vírgula
- Cada URL deve estar entre aspas

### 3. Salvar e fazer deploy

**Se editar localmente:**

```bash
# No Windows
cd /c/Users/Usuario/Documents/player-ticia-repo
git add produtos-monitorados.json
git commit -m "Update monitored products list"
git push

# No servidor
ssh ubuntu@54.86.64.173
cd ~/player-ticia
git pull
docker compose restart player
```

**Se editar direto no servidor:**

```bash
# Salvar o arquivo (Ctrl+O, Enter, Ctrl+X)
# Reiniciar o container
docker compose restart player
```

### 4. Testar

Acesse o dashboard e clique em "Executar Análise Agora":
http://player.tiecia.com.br:8080/public/boadica-dashboard.html

## Como Encontrar as URLs dos Seus Produtos

### Opção 1: Manualmente
1. Acesse https://boadica.com.br
2. Navegue pelas categorias
3. Quando encontrar um produto seu, copie a URL
4. Adicione no arquivo JSON

### Opção 2: Buscar no BoaDica
Se o BoaDica tem uma área de lojista:
1. Faça login na sua conta
2. Veja a lista de produtos cadastrados
3. Copie as URLs

## Exemplo Completo

```json
{
  "produtos": [
    "https://boadica.com.br/produtos/p121235",
    "https://boadica.com.br/produtos/p154982",
    "https://boadica.com.br/produtos/p200001",
    "https://boadica.com.br/produtos/p200002",
    "https://boadica.com.br/produtos/p200003",
    "https://boadica.com.br/produtos/p200004",
    "https://boadica.com.br/produtos/p200005"
  ]
}
```

## Verificar no Servidor

Para ver quantos produtos estão configurados:

```bash
# Ver o arquivo
cat ~/player-ticia/produtos-monitorados.json

# Contar produtos
cat ~/player-ticia/produtos-monitorados.json | grep -c "boadica.com.br"

# Ver logs
docker compose logs player | grep "produtos configurados"
```

## Adicionar Muitos Produtos de Uma Vez

Se você tem uma lista grande, pode usar um script Python:

```python
import json

# Sua lista de IDs de produtos
ids = [121235, 154982, 200001, 200002, 200003]

# Gerar URLs
produtos = [f"https://boadica.com.br/produtos/p{id}" for id in ids]

# Salvar no JSON
with open('produtos-monitorados.json', 'w') as f:
    json.dump({"produtos": produtos}, f, indent=2)

print(f"✓ {len(produtos)} produtos adicionados!")
```

## Remover Produtos

Para parar de monitorar um produto, simplesmente remova a linha do JSON.

## Dicas

- Comece com 5-10 produtos para testar
- Depois adicione mais conforme necessário
- O sistema vai rodar automaticamente todo dia às 8:00
- Você pode executar manualmente a qualquer momento pelo dashboard
