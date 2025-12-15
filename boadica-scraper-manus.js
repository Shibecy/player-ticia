/**
 * BoaDica Scraper - Versão baseada no Manus.ia
 * Adaptação da lógica Python para Node.js
 *
 * Estratégia: Extrai texto renderizado e faz parsing com regex
 */

import fetch from 'node-fetch';

const MINHAS_LOJAS = ['TI e CIA Centro', 'TI e CIA Itaipu', 'TI E CIA'];

export class BoadicaScraperManus {
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
   * Extrai nome do produto do texto
   * Baseado em: _extrair_nome_produto do Python
   */
  extrairNomeProduto(texto) {
    const linhas = texto.split('\n');

    for (let i = 0; i < linhas.length - 1; i++) {
      const linha = linhas[i].trim();
      const proxima = linhas[i + 1].trim();

      // Procura por padrão "Marca / Modelo" seguido de "De R$"
      if (linha.includes('/') && proxima.includes('De R$')) {
        return linha;
      }
    }

    return 'Produto não identificado';
  }

  /**
   * Extrai faixa de preço
   * Baseado em: _extrair_faixa_preco do Python
   */
  extrairFaixaPreco(texto) {
    // Procura por: De R$ X,XX a R$ Y,YY
    const match = texto.match(/De\s+R\$\s+([\d,]+)\s+a\s+R\$\s+([\d,]+)/);

    if (match) {
      return {
        minimo: `R$ ${match[1]}`,
        maximo: `R$ ${match[2]}`
      };
    }

    return { minimo: 'N/A', maximo: 'N/A' };
  }

  /**
   * Extrai preço numérico de um texto
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
   * Coleta informações da loja olhando para trás
   * Baseado em: _coletar_info_loja do Python
   */
  coletarInfoLoja(linhas, indicePreco) {
    const info = {
      nome: '',
      endereco: '',
      telefones: '',
      referencia: ''
    };

    // Procurar nas 10 linhas anteriores
    const inicio = Math.max(0, indicePreco - 10);

    for (let j = indicePreco - 1; j >= inicio; j--) {
      const linha = linhas[j].trim();

      // Pular linhas vazias ou muito curtas
      if (!linha || linha.length < 3) continue;

      // Pular "BOX"
      if (linha === 'BOX') continue;

      // Pular "Preços para..."
      if (linha.startsWith('Preços para')) break;

      // Telefones: contém parênteses e números
      if (!info.telefones && linha.includes('(') && linha.includes(')') && /\d{4,}/.test(linha)) {
        info.telefones = linha;
        continue;
      }

      // Endereço: contém hífen e estado (RJ, SP, etc)
      if (!info.endereco && linha.includes(' - ') && /\/\s*[A-Z]{2}\s*$/.test(linha)) {
        info.endereco = linha;
        continue;
      }

      // Referência: linha entre endereço e telefone
      if (info.endereco && !info.referencia && !info.telefones) {
        if (linha.length > 15 && linha !== linha.toUpperCase()) {
          info.referencia = linha;
          continue;
        }
      }

      // Nome da loja: geralmente antes do endereço
      if (info.endereco && !info.nome) {
        if (linha.length < 50) {
          info.nome = linha;
        }
      }
    }

    // Se não encontrou endereço, não é válido
    if (!info.endereco) return null;

    // Se não encontrou nome, usar parte do endereço
    if (!info.nome) {
      info.nome = info.endereco.split('-')[0].trim();
    }

    return info;
  }

  /**
   * Extrai lojas e preços do texto
   * Baseado em: _extrair_lojas do Python
   */
  extrairLojas(texto) {
    const lojas = [];
    const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];

      // Procurar por preços (formato R$ XX,XX)
      if (/^R\$\s+[\d,]+$/.test(linha)) {
        const preco = linha;

        // Coletar informações da loja
        const lojaInfo = this.coletarInfoLoja(linhas, i);

        if (lojaInfo) {
          lojaInfo.preco = preco;
          lojaInfo.preco_numerico = this.extrairPreco(preco);

          // Verificar se é uma das minhas lojas
          lojaInfo.ehMinhaLoja = MINHAS_LOJAS.some(minhaLoja =>
            lojaInfo.nome.toUpperCase().includes(minhaLoja.toUpperCase())
          );

          lojas.push(lojaInfo);
        }
      }
    }

    // Ordenar por preço
    lojas.sort((a, b) => a.preco_numerico - b.preco_numerico);

    return lojas;
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
   * NOTA: Esta função não vai funcionar sem Puppeteer/Selenium
   * O texto precisa ser extraído APÓS o JavaScript carregar
   *
   * Por enquanto, retorna null e mostra mensagem explicativa
   */
  async extrairInfoProduto(url) {
    console.log(`   ⚠️  Extração automática requer Puppeteer`);
    console.log(`   💡 O BoaDica carrega dados via JavaScript`);
    console.log(`   💡 Solução: Usar interface manual (próxima implementação)`);
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
      stmt.run(produtoId, oferta.nome, oferta.preco_numerico, oferta.ehMinhaLoja ? 1 : 0);
    }
  }

  /**
   * Analisa competitividade e gera alertas
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
    console.log('\n🚀 Iniciando análise de preços BoaDica (Método Manus.ia)...');
    console.log('⚠️  ATENÇÃO: Extração automática requer Puppeteer');
    console.log('💡  Use a interface manual para adicionar preços');

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

      const tempoTotal = ((Date.now() - inicio) / 1000).toFixed(2);

      console.log('\n✅ Análise concluída!');
      console.log(`   Produtos processados: 0 (requer Puppeteer)`);
      console.log(`   Tempo total: ${tempoTotal}s`);

      return {
        sucesso: true,
        processados: 0,
        comMinhasLojas: 0,
        alertasGerados: 0,
        tempoTotal,
        mensagem: 'Use a interface manual para adicionar preços'
      };

    } catch (error) {
      console.error('❌ Erro na análise:', error);
      return {
        sucesso: false,
        mensagem: error.message
      };
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
