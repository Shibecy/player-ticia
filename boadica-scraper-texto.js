/**
 * BoaDica Scraper - Versão Texto
 * Baseado na abordagem do Manus.ia - extrai dados do texto renderizado
 *
 * Como funciona:
 * 1. Busca a página com fetch (obtém HTML inicial)
 * 2. O Angular embute os dados em scripts JSON-LD ou data attributes
 * 3. Extraímos esses dados estruturados ao invés de executar JavaScript
 */

import fetch from 'node-fetch';

const MINHAS_LOJAS = ['TI e CIA Centro', 'TI e CIA Itaipu'];

export class BoadicaScraperTexto {
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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
   * Extrai dados estruturados do HTML (JSON-LD, data attributes, etc)
   */
  extrairDadosEstruturados(html) {
    const dados = {
      nome: '',
      ofertas: []
    };

    // 1. Tentar extrair JSON-LD (dados estruturados que o Angular pode incluir)
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        if (jsonData.name) {
          dados.nome = jsonData.name;
        }
        if (jsonData.offers) {
          // Processar ofertas se existirem no JSON-LD
          const offers = Array.isArray(jsonData.offers) ? jsonData.offers : [jsonData.offers];
          for (const offer of offers) {
            if (offer.seller && offer.price) {
              dados.ofertas.push({
                loja: offer.seller.name || offer.seller,
                preco: parseFloat(offer.price),
                ehMinhaLoja: MINHAS_LOJAS.some(m => offer.seller.name?.includes(m))
              });
            }
          }
        }
      } catch (e) {
        console.log('   Erro ao parsear JSON-LD, tentando outros métodos...');
      }
    }

    // 2. Tentar extrair de meta tags Open Graph
    if (!dados.nome) {
      const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
      if (ogTitleMatch) {
        dados.nome = ogTitleMatch[1];
      }
    }

    // 3. Tentar extrair título da página
    if (!dados.nome) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        dados.nome = titleMatch[1].replace(' - BoaDica', '').trim();
      }
    }

    return dados;
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
      return [];
    }
  }

  /**
   * Extrai informações de um produto
   */
  async extrairInfoProduto(url) {
    const html = await this.fetchPage(url);
    if (!html) return null;

    const produtoInfo = {
      url,
      produtoId: url.match(/p(\d+)/)?.[1] || '',
      nome: '',
      ofertas: []
    };

    // Tentar extrair dados estruturados
    const dados = this.extrairDadosEstruturados(html);
    produtoInfo.nome = dados.nome;
    produtoInfo.ofertas = dados.ofertas;

    if (produtoInfo.nome && produtoInfo.ofertas.length > 0) {
      console.log(`   ✓ ${produtoInfo.nome}`);
      console.log(`   ✓ ${produtoInfo.ofertas.length} ofertas encontradas`);
      return produtoInfo;
    }

    console.log(`   ⚠️  Dados não encontrados no HTML inicial`);
    console.log(`   💡 O BoaDica carrega dados via JavaScript após o carregamento`);
    console.log(`   💡 Solução: Adicione os preços manualmente ou aguarde implementação com Puppeteer otimizado`);

    return null;
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
    console.log('\n🚀 Iniciando análise de preços BoaDica (Extração de Dados Estruturados)...');
    const inicio = Date.now();

    try {
      const urlsProdutos = await this.obterListaProdutos();

      if (urlsProdutos.length === 0) {
        console.log('⚠️  Nenhum produto encontrado');
        return {
          sucesso: false,
          mensagem: 'Nenhum produto encontrado'
        };
      }

      let processados = 0;
      let comMinhasLojas = 0;
      let alertasGerados = 0;

      for (const [index, url] of urlsProdutos.entries()) {
        console.log(`\n[${index + 1}/${urlsProdutos.length}] ${url}`);

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

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

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

  // Métodos auxiliares (copiar do scraper original)
  obterAlertas(apenasNaoVisualizados = false) {
    let sql = `SELECT * FROM boadica_alertas WHERE 1=1`;
    if (apenasNaoVisualizados) sql += ` AND visualizado = 0`;
    sql += ` ORDER BY diferenca DESC`;
    return this.db.prepare(sql).all();
  }

  marcarAlertasVisualizados(ids) {
    const stmt = this.db.prepare(`
      UPDATE boadica_alertas SET visualizado = 1
      WHERE id IN (${ids.map(() => '?').join(',')})
    `);
    stmt.run(...ids);
  }

  obterHistoricoPrecos(produtoId, dias = 30) {
    return this.db.prepare(`
      SELECT * FROM boadica_precos
      WHERE produto_id = ? AND datetime(data_captura) > datetime('now', '-${dias} days')
      ORDER BY data_captura DESC
    `).all(produtoId);
  }
}
