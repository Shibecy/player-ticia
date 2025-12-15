/**
 * Módulo de Scraping do BoaDica
 * Monitora preços dos produtos das lojas TI e CIA
 */

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const MINHAS_LOJAS = ['TI e CIA Centro', 'TI e CIA Itaipu'];
const BASE_URL = 'https://boadica.com.br';

export class BoadicaScraper {
  constructor(db) {
    this.db = db;
    this.initDatabase();
  }

  /**
   * Inicializa tabelas no banco de dados
   */
  initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS boadica_produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id TEXT NOT NULL UNIQUE,
        nome TEXT NOT NULL,
        url TEXT NOT NULL,
        ultima_atualizacao TEXT DEFAULT (datetime('now', 'localtime'))
      );

      CREATE TABLE IF NOT EXISTS boadica_precos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id TEXT NOT NULL,
        loja TEXT NOT NULL,
        preco REAL NOT NULL,
        eh_minha_loja INTEGER DEFAULT 0,
        data_captura TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (produto_id) REFERENCES boadica_produtos(produto_id)
      );

      CREATE TABLE IF NOT EXISTS boadica_alertas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produto_id TEXT NOT NULL,
        nome_produto TEXT NOT NULL,
        meu_preco REAL NOT NULL,
        melhor_preco REAL NOT NULL,
        diferenca REAL NOT NULL,
        percentual REAL NOT NULL,
        minhas_lojas TEXT NOT NULL,
        data_alerta TEXT DEFAULT (datetime('now', 'localtime')),
        visualizado INTEGER DEFAULT 0
      );
    `);

    console.log('✓ Tabelas do BoaDica criadas no banco de dados');
  }

  /**
   * Busca HTML de uma URL
   */
  async fetchPage(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      console.error(`Erro ao buscar ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Extrai preço de um texto
   */
  extrairPreco(texto) {
    try {
      const numero = texto.replace(/[^\d,.]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
      return parseFloat(numero) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Busca lista de produtos do arquivo produtos-monitorados.json
   */
  async obterListaProdutos() {
    console.log('🔍 Carregando lista de produtos monitorados...');

    try {
      const fs = await import('fs/promises');
      const fileContent = await fs.readFile('./produtos-monitorados.json', 'utf-8');
      const config = JSON.parse(fileContent);

      const produtos = config.produtos || [];
      console.log(`✓ ${produtos.length} produtos configurados para monitoramento`);

      return produtos;
    } catch (error) {
      console.error('⚠️  Erro ao ler produtos-monitorados.json:', error.message);
      console.log('💡 Crie o arquivo produtos-monitorados.json com seus produtos');
      return [];
    }
  }

  /**
   * Extrai informações de um produto
   */
  async extrairInfoProduto(url) {
    const html = await this.fetchPage(url);
    if (!html) return null;

    const dom = new JSDOM(html);
    const document = dom.window.document;

    const produtoInfo = {
      url,
      produtoId: url.match(/p(\d+)/)?.[1] || '',
      nome: '',
      ofertas: []
    };

    // Nome do produto
    const titulo = document.querySelector('h1') ||
                   document.querySelector('.produto-titulo') ||
                   document.querySelector('[class*="title"]');

    if (titulo) {
      produtoInfo.nome = titulo.textContent.trim();
    }

    // Buscar containers de ofertas
    const containers = [
      ...document.querySelectorAll('[class*="oferta"]'),
      ...document.querySelectorAll('[class*="preco"]'),
      ...document.querySelectorAll('[class*="loja"]'),
      ...document.querySelectorAll('.card'),
      ...document.querySelectorAll('[class*="item"]')
    ];

    for (const container of containers) {
      try {
        // Tentar encontrar loja
        const lojaElem = container.querySelector('[class*="loja"]') ||
                        container.querySelector('[class*="store"]') ||
                        container.querySelector('[class*="shop"]');

        const loja = lojaElem ? lojaElem.textContent.trim() : '';

        // Tentar encontrar preço
        const precoElem = container.querySelector('[class*="preco"]') ||
                         container.querySelector('[class*="price"]') ||
                         container.querySelector('[class*="valor"]');

        const precoText = precoElem ? precoElem.textContent.trim() : '';
        const preco = this.extrairPreco(precoText);

        if (loja && preco > 0) {
          const ehMinhaLoja = MINHAS_LOJAS.some(minhaLoja =>
            loja.toLowerCase().includes(minhaLoja.toLowerCase())
          );

          produtoInfo.ofertas.push({
            loja,
            preco,
            ehMinhaLoja
          });
        }
      } catch (error) {
        continue;
      }
    }

    return produtoInfo.ofertas.length > 0 ? produtoInfo : null;
  }

  /**
   * Salva produto no banco de dados
   */
  salvarProduto(produto) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO boadica_produtos (produto_id, nome, url, ultima_atualizacao)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
    `);

    stmt.run(produto.produtoId, produto.nome, produto.url);
  }

  /**
   * Salva preços no banco de dados
   */
  salvarPrecos(produtoId, ofertas) {
    const stmt = this.db.prepare(`
      INSERT INTO boadica_precos (produto_id, loja, preco, eh_minha_loja)
      VALUES (?, ?, ?, ?)
    `);

    for (const oferta of ofertas) {
      stmt.run(produtoId, oferta.loja, oferta.preco, oferta.ehMinhaLoja ? 1 : 0);
    }
  }

  /**
   * Analisa competitividade e gera alertas
   */
  analisarCompetitividade(produto) {
    const minhasOfertas = produto.ofertas.filter(o => o.ehMinhaLoja);
    if (minhasOfertas.length === 0) return;

    const meuMelhorPreco = Math.min(...minhasOfertas.map(o => o.preco));
    const melhorPreco = Math.min(...produto.ofertas.map(o => o.preco));

    if (meuMelhorPreco > melhorPreco) {
      const diferenca = meuMelhorPreco - melhorPreco;
      const percentual = (diferenca / melhorPreco) * 100;

      const stmt = this.db.prepare(`
        INSERT INTO boadica_alertas (produto_id, nome_produto, meu_preco, melhor_preco, diferenca, percentual, minhas_lojas)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        produto.produtoId,
        produto.nome,
        meuMelhorPreco,
        melhorPreco,
        diferenca,
        percentual,
        minhasOfertas.map(o => o.loja).join(', ')
      );
    }
  }

  /**
   * Executa análise completa
   */
  async executarAnalise() {
    console.log('\n🚀 Iniciando análise de preços BoaDica...');
    const inicio = Date.now();

    try {
      // 1. Buscar lista de produtos
      const urlsProdutos = await this.obterListaProdutos();

      if (urlsProdutos.length === 0) {
        console.log('⚠️  Nenhum produto encontrado');
        return {
          sucesso: false,
          mensagem: 'Nenhum produto encontrado'
        };
      }

      // 2. Processar cada produto
      let processados = 0;
      let comMinhasLojas = 0;
      let alertasGerados = 0;

      for (const [index, url] of urlsProdutos.entries()) {
        console.log(`   [${index + 1}/${urlsProdutos.length}] Processando...`);

        const produto = await this.extrairInfoProduto(url);

        if (produto) {
          this.salvarProduto(produto);
          this.salvarPrecos(produto.produtoId, produto.ofertas);

          const temMinhasLojas = produto.ofertas.some(o => o.ehMinhaLoja);
          if (temMinhasLojas) {
            comMinhasLojas++;
            this.analisarCompetitividade(produto);
          }

          processados++;
        }

        // Delay para não sobrecarregar o servidor
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // 3. Contar alertas gerados
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as total
        FROM boadica_alertas
        WHERE datetime(data_alerta) > datetime('now', '-1 hour')
      `);

      alertasGerados = countStmt.get().total;

      const tempoTotal = ((Date.now() - inicio) / 1000).toFixed(2);

      console.log('\n✅ Análise concluída!');
      console.log(`   Produtos processados: ${processados}`);
      console.log(`   Com minhas lojas: ${comMinhasLojas}`);
      console.log(`   Alertas gerados: ${alertasGerados}`);
      console.log(`   Tempo total: ${tempoTotal}s`);

      return {
        sucesso: true,
        processados,
        comMinhasLojas,
        alertasGerados,
        tempoTotal
      };

    } catch (error) {
      console.error('❌ Erro na análise:', error);
      return {
        sucesso: false,
        mensagem: error.message
      };
    }
  }

  /**
   * Obtém relatório de alertas
   */
  obterAlertas(apenasNaoVisualizados = false) {
    let sql = `
      SELECT * FROM boadica_alertas
      WHERE 1=1
    `;

    if (apenasNaoVisualizados) {
      sql += ` AND visualizado = 0`;
    }

    sql += ` ORDER BY diferenca DESC`;

    const stmt = this.db.prepare(sql);
    return stmt.all();
  }

  /**
   * Marcar alertas como visualizados
   */
  marcarAlertasVisualizados(ids) {
    const stmt = this.db.prepare(`
      UPDATE boadica_alertas
      SET visualizado = 1
      WHERE id IN (${ids.map(() => '?').join(',')})
    `);

    stmt.run(...ids);
  }

  /**
   * Obtém histórico de preços de um produto
   */
  obterHistoricoPrecos(produtoId, dias = 30) {
    const stmt = this.db.prepare(`
      SELECT * FROM boadica_precos
      WHERE produto_id = ?
        AND datetime(data_captura) > datetime('now', '-${dias} days')
      ORDER BY data_captura DESC
    `);

    return stmt.all(produtoId);
  }
}
