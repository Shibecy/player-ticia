/**
 * BoaDica Scraper - Puppeteer Otimizado
 * Baseado na lógica do Manus.ia (Python/Selenium)
 *
 * OTIMIZAÇÕES:
 * - Reutiliza mesma instância do browser
 * - Processa 1 produto por vez
 * - Timeout curto (10s)
 * - Fecha browser após cada análise
 * - Usa menos recursos
 */

import puppeteer from 'puppeteer';

const MINHAS_LOJAS = ['TI e CIA Centro', 'TI e CIA Itaipu', 'TI E CIA'];

export class BoadicaScraperPuppeteerOtimizado {
  constructor(db) {
    this.db = db;
    this.browser = null;
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
   * Inicializa browser (só quando necessário)
   */
  async initBrowser() {
    if (this.browser) return this.browser;

    console.log('🌐 Inicializando browser...');

    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--single-process', // IMPORTANTE: Usa menos memória
        '--no-zygote'
      ],
      // Limitar recursos
      timeout: 10000
    });

    return this.browser;
  }

  /**
   * Fecha browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('✓ Browser fechado');
    }
  }

  /**
   * Extrai nome do produto do texto (baseado no Manus.ia)
   */
  extrairNomeProduto(texto) {
    const linhas = texto.split('\n');

    for (let i = 0; i < linhas.length - 1; i++) {
      const linha = linhas[i].trim();
      const proxima = linhas[i + 1].trim();

      if (linha.includes('/') && proxima.includes('De R$')) {
        return linha;
      }
    }

    return 'Produto não identificado';
  }

  /**
   * Extrai preço numérico
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
   * Coleta informações da loja (baseado no Manus.ia)
   */
  coletarInfoLoja(linhas, indicePreco) {
    const info = {
      nome: '',
      endereco: '',
      telefones: ''
    };

    const inicio = Math.max(0, indicePreco - 10);

    for (let j = indicePreco - 1; j >= inicio; j--) {
      const linha = linhas[j].trim();

      if (!linha || linha.length < 3) continue;
      if (linha === 'BOX') continue;
      if (linha.startsWith('Preços para')) break;

      // Telefones
      if (!info.telefones && linha.includes('(') && linha.includes(')') && /\d{4,}/.test(linha)) {
        info.telefones = linha;
        continue;
      }

      // Endereço
      if (!info.endereco && linha.includes(' - ') && /\/\s*[A-Z]{2}\s*$/.test(linha)) {
        info.endereco = linha;
        continue;
      }

      // Nome da loja
      if (info.endereco && !info.nome && linha.length < 50) {
        info.nome = linha;
      }
    }

    if (!info.endereco) return null;

    if (!info.nome) {
      info.nome = info.endereco.split('-')[0].trim();
    }

    return info;
  }

  /**
   * Extrai lojas do texto (baseado no Manus.ia)
   */
  extrairLojas(texto) {
    const lojas = [];
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Procurar por preços (formato R$ XX,XX)
      if (/^R\$\s+[\d,]+$/.test(linha)) {
        const lojaInfo = this.coletarInfoLoja(linhas, i);

        if (lojaInfo) {
          lojaInfo.preco = linha;
          lojaInfo.preco_numerico = this.extrairPreco(linha);
          lojaInfo.ehMinhaLoja = MINHAS_LOJAS.some(minhaLoja =>
            lojaInfo.nome.toUpperCase().includes(minhaLoja.toUpperCase())
          );

          lojas.push(lojaInfo);
        }
      }
    }

    lojas.sort((a, b) => a.preco_numerico - b.preco_numerico);
    return lojas;
  }

  /**
   * Extrai informações de um produto (MÉTODO PRINCIPAL)
   */
  async extrairInfoProduto(url) {
    let page = null;

    try {
      const browser = await this.initBrowser();
      page = await browser.newPage();

      // Configurações da página
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

      // Timeout de 10 segundos (metade do Manus.ia)
      page.setDefaultTimeout(10000);

      console.log(`   Acessando: ${url}`);

      // Navegar até a página
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 10000
      });

      // Aguardar 3 segundos (igual ao Manus.ia)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // EXTRAIR TODO O TEXTO DA PÁGINA (igual ao Manus.ia linha 49)
      const pageText = await page.evaluate(() => document.body.innerText);

      // Fechar página imediatamente
      await page.close();
      page = null;

      // Processar texto (igual ao Manus.ia)
      const produtoInfo = {
        url,
        produtoId: url.match(/p(\d+)/)?.[1] || '',
        nome: this.extrairNomeProduto(pageText),
        lojas: this.extrairLojas(pageText)
      };

      if (produtoInfo.nome && produtoInfo.lojas.length > 0) {
        console.log(`   ✓ ${produtoInfo.nome}`);
        console.log(`   ✓ ${produtoInfo.lojas.length} ofertas encontradas`);
        return produtoInfo;
      }

      console.log(`   ⚠️  Nenhuma oferta encontrada`);
      return null;

    } catch (error) {
      console.error(`   ❌ Erro: ${error.message}`);
      if (page) await page.close();
      return null;
    }
  }

  /**
   * Busca lista de produtos
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
   * Salva produto no banco
   */
  salvarProduto(produto) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO boadica_produtos (produto_id, nome, url, ultima_atualizacao)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
    `);

    stmt.run(produto.produtoId, produto.nome, produto.url);
  }

  /**
   * Salva preços no banco
   */
  salvarPrecos(produtoId, lojas) {
    const stmt = this.db.prepare(`
      INSERT INTO boadica_precos (produto_id, loja, preco, eh_minha_loja)
      VALUES (?, ?, ?, ?)
    `);

    for (const loja of lojas) {
      stmt.run(produtoId, loja.nome, loja.preco_numerico, loja.ehMinhaLoja ? 1 : 0);
    }
  }

  /**
   * Analisa competitividade
   */
  analisarCompetitividade(produto) {
    const minhasOfertas = produto.lojas.filter(o => o.ehMinhaLoja);
    if (minhasOfertas.length === 0) return;

    const meuMelhorPreco = Math.min(...minhasOfertas.map(o => o.preco_numerico));
    const melhorPreco = Math.min(...produto.lojas.map(o => o.preco_numerico));

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
        minhasOfertas.map(o => o.nome).join(', ')
      );
    }
  }

  /**
   * Executa análise completa
   */
  async executarAnalise() {
    console.log('\n🚀 Iniciando análise BoaDica (Puppeteer Otimizado)...');
    const inicio = Date.now();

    try {
      const urlsProdutos = await this.obterListaProdutos();

      if (urlsProdutos.length === 0) {
        console.log('⚠️  Nenhum produto encontrado');
        return { sucesso: false, mensagem: 'Nenhum produto encontrado' };
      }

      let processados = 0;
      let comMinhasLojas = 0;

      for (const [index, url] of urlsProdutos.entries()) {
        console.log(`\n[${index + 1}/${urlsProdutos.length}]`);

        const produto = await this.extrairInfoProduto(url);

        if (produto) {
          this.salvarProduto(produto);
          this.salvarPrecos(produto.produtoId, produto.lojas);

          const temMinhasLojas = produto.lojas.some(o => o.ehMinhaLoja);
          if (temMinhasLojas) {
            comMinhasLojas++;
            this.analisarCompetitividade(produto);
          }

          processados++;
        }

        // Delay entre produtos
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // IMPORTANTE: Fechar browser ao terminar
      await this.closeBrowser();

      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as total
        FROM boadica_alertas
        WHERE datetime(data_alerta) > datetime('now', '-1 hour')
      `);

      const alertasGerados = countStmt.get().total;
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
      await this.closeBrowser();
      console.error('❌ Erro na análise:', error);
      return { sucesso: false, mensagem: error.message };
    }
  }

  // Métodos auxiliares
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
