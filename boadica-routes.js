/**
 * Rotas e Job Agendado para monitoramento do BoaDica
 */

import cron from 'node-cron';
import { BoadicaScraperPuppeteerOtimizado } from './boadica-scraper-puppeteer-otimizado.js';

export function setupBoadicaRoutes(app, db) {
  const scraper = new BoadicaScraperPuppeteerOtimizado(db);

  // ============ ROTAS API ============

  /**
   * GET /api/boadica/status
   * Retorna status do monitoramento
   */
  app.get('/api/boadica/status', (req, res) => {
    try {
      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM boadica_produtos) as total_produtos,
          (SELECT COUNT(DISTINCT produto_id) FROM boadica_alertas WHERE visualizado = 0) as produtos_perdendo,
          (SELECT MAX(ultima_atualizacao) FROM boadica_produtos) as ultima_atualizacao
      `).get();

      // Produtos ganhando = total de produtos - produtos com alertas
      const produtos_ganhando = stats.total_produtos - stats.produtos_perdendo;

      res.json({
        success: true,
        total_produtos: stats.total_produtos,
        produtos_perdendo: stats.produtos_perdendo,
        produtos_ganhando: produtos_ganhando,
        ultima_atualizacao: stats.ultima_atualizacao
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/boadica/executar
   * Executa análise manualmente
   */
  app.post('/api/boadica/executar', async (req, res) => {
    try {
      console.log('📊 Iniciando análise manual do BoaDica...');
      const resultado = await scraper.executarAnalise();

      res.json(resultado);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/boadica/alertas
   * Lista alertas de produtos com preço superior
   */
  app.get('/api/boadica/alertas', (req, res) => {
    try {
      const apenasNaoVisualizados = req.query.nao_visualizados === 'true';
      const alertas = scraper.obterAlertas(apenasNaoVisualizados);

      res.json({
        success: true,
        total: alertas.length,
        alertas
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/boadica/alertas/visualizar
   * Marca alertas como visualizados
   */
  app.post('/api/boadica/alertas/visualizar', (req, res) => {
    try {
      const { ids } = req.body;

      if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({
          success: false,
          error: 'IDs inválidos'
        });
      }

      scraper.marcarAlertasVisualizados(ids);

      res.json({
        success: true,
        message: `${ids.length} alertas marcados como visualizados`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/boadica/produto/:id/historico
   * Retorna histórico de preços de um produto
   */
  app.get('/api/boadica/produto/:id/historico', (req, res) => {
    try {
      const { id } = req.params;
      const dias = parseInt(req.query.dias) || 30;

      const historico = scraper.obterHistoricoPrecos(id, dias);

      res.json({
        success: true,
        produto_id: id,
        total: historico.length,
        historico
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/boadica/relatorio
   * Gera relatório completo
   */
  app.get('/api/boadica/relatorio', (req, res) => {
    try {
      // Estatísticas gerais
      const stats = db.prepare(`
        SELECT
          COUNT(DISTINCT p.produto_id) as total_produtos,
          COUNT(DISTINCT CASE WHEN pr.eh_minha_loja = 1 THEN p.produto_id END) as produtos_minhas_lojas,
          MAX(p.ultima_atualizacao) as ultima_atualizacao
        FROM boadica_produtos p
        LEFT JOIN boadica_precos pr ON p.produto_id = pr.produto_id
      `).get();

      // Alertas por categoria
      const alertasStats = db.prepare(`
        SELECT
          COUNT(*) as total_alertas,
          SUM(diferenca) as total_economia,
          AVG(percentual) as percentual_medio,
          COUNT(CASE WHEN visualizado = 0 THEN 1 END) as nao_visualizados
        FROM boadica_alertas
        WHERE datetime(data_alerta) > datetime('now', '-7 days')
      `).get();

      // Top 10 produtos perdendo
      const topPerdendo = db.prepare(`
        SELECT *
        FROM boadica_alertas
        WHERE datetime(data_alerta) > datetime('now', '-7 days')
        ORDER BY diferenca DESC
        LIMIT 10
      `).all();

      res.json({
        success: true,
        estatisticas: stats,
        alertas: alertasStats,
        top_perdendo: topPerdendo
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/boadica/produtos
   * Lista produtos monitorados
   */
  app.get('/api/boadica/produtos', async (req, res) => {
    try {
      const fs = await import('fs/promises');
      let config = { produtos: [] };

      try {
        const fileContent = await fs.readFile('./produtos-monitorados.json', 'utf-8');
        config = JSON.parse(fileContent);
      } catch (readError) {
        // Se o arquivo não existir, criar
        console.log('📝 Criando arquivo produtos-monitorados.json...');
        await fs.writeFile('./produtos-monitorados.json', JSON.stringify(config, null, 2));
      }

      res.json({
        success: true,
        produtos: config.produtos || []
      });
    } catch (error) {
      console.error('Erro em /api/boadica/produtos:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/boadica/produtos/adicionar
   * Adiciona novo produto para monitoramento
   */
  app.post('/api/boadica/produtos/adicionar', async (req, res) => {
    try {
      const { url } = req.body;

      if (!url || !url.includes('boadica.com.br/produtos/p')) {
        return res.status(400).json({
          success: false,
          error: 'URL inválida. Use o formato: https://boadica.com.br/produtos/pXXXXX'
        });
      }

      const fs = await import('fs/promises');
      let config = { produtos: [] };

      try {
        const fileContent = await fs.readFile('./produtos-monitorados.json', 'utf-8');
        config = JSON.parse(fileContent);
      } catch (readError) {
        // Se o arquivo não existir, criar
        console.log('📝 Criando arquivo produtos-monitorados.json...');
        await fs.writeFile('./produtos-monitorados.json', JSON.stringify(config, null, 2));
      }

      // Verificar se já existe
      if (config.produtos.includes(url)) {
        return res.status(400).json({
          success: false,
          error: 'Este produto já está sendo monitorado'
        });
      }

      // Adicionar
      config.produtos.push(url);

      // Salvar
      await fs.writeFile('./produtos-monitorados.json', JSON.stringify(config, null, 2));

      res.json({
        success: true,
        message: 'Produto adicionado com sucesso',
        total: config.produtos.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/boadica/produtos/remover
   * Remove produto do monitoramento
   */
  app.post('/api/boadica/produtos/remover', async (req, res) => {
    try {
      const { url } = req.body;

      const fs = await import('fs/promises');
      let config = { produtos: [] };

      try {
        const fileContent = await fs.readFile('./produtos-monitorados.json', 'utf-8');
        config = JSON.parse(fileContent);
      } catch (readError) {
        // Se o arquivo não existir, retornar erro
        return res.status(404).json({
          success: false,
          error: 'Arquivo de produtos não encontrado'
        });
      }

      // Remover
      config.produtos = config.produtos.filter(p => p !== url);

      // Salvar
      await fs.writeFile('./produtos-monitorados.json', JSON.stringify(config, null, 2));

      res.json({
        success: true,
        message: 'Produto removido com sucesso',
        total: config.produtos.length
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/boadica/custos/salvar
   * Salva/atualiza custo de um produto
   */
  app.post('/api/boadica/custos/salvar', (req, res) => {
    try {
      const { produto_id, custo, margem_minima } = req.body;

      if (!produto_id || !custo) {
        return res.status(400).json({
          success: false,
          error: 'produto_id e custo são obrigatórios'
        });
      }

      const stmt = db.prepare(`
        INSERT INTO boadica_custos (produto_id, custo, margem_minima)
        VALUES (?, ?, ?)
        ON CONFLICT(produto_id) DO UPDATE SET
          custo = excluded.custo,
          margem_minima = excluded.margem_minima,
          data_atualizacao = datetime('now', 'localtime')
      `);

      stmt.run(produto_id, parseFloat(custo), margem_minima || 15.0);

      res.json({
        success: true,
        message: 'Custo salvo com sucesso'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/boadica/custos/:produto_id
   * Busca custo de um produto
   */
  app.get('/api/boadica/custos/:produto_id', (req, res) => {
    try {
      const { produto_id } = req.params;

      const custo = db.prepare(`
        SELECT * FROM boadica_custos
        WHERE produto_id = ?
      `).get(produto_id);

      res.json({
        success: true,
        custo: custo || null
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/boadica/preco-sugerido
   * Calcula preço sugerido baseado no custo e concorrência
   */
  app.post('/api/boadica/preco-sugerido', (req, res) => {
    try {
      const { produto_id, custo } = req.body;

      if (!produto_id || !custo) {
        return res.status(400).json({
          success: false,
          error: 'produto_id e custo são obrigatórios'
        });
      }

      const custoNum = parseFloat(custo);
      const margemMinima = 15.0;

      // Preço mínimo com 15% de margem
      const precoMinimo = custoNum * (1 + margemMinima / 100);

      // Buscar melhor preço do mercado
      const melhorPrecoMercado = db.prepare(`
        SELECT MIN(preco) as melhor_preco
        FROM boadica_precos
        WHERE produto_id = ?
          AND eh_minha_loja = 0
          AND datetime(data_captura) > datetime('now', '-7 days')
      `).get(produto_id);

      let precoSugerido = precoMinimo;
      let estrategia = 'margem_minima';
      let aviso = null;

      if (melhorPrecoMercado && melhorPrecoMercado.melhor_preco) {
        const melhorPreco = melhorPrecoMercado.melhor_preco;

        // Se o melhor preço do mercado é maior que nosso mínimo, podemos competir
        if (melhorPreco > precoMinimo) {
          // Sugerir 1% abaixo do melhor preço, mas respeitando margem mínima
          precoSugerido = Math.max(melhorPreco * 0.99, precoMinimo);
          estrategia = 'competitivo';
        } else {
          // Mercado está abaixo da nossa margem mínima
          aviso = `Melhor preço do mercado (R$ ${melhorPreco.toFixed(2)}) está abaixo da margem mínima de 15%`;
          precoSugerido = precoMinimo;
          estrategia = 'inviavel';
        }
      }

      const margemFinal = ((precoSugerido - custoNum) / custoNum) * 100;

      res.json({
        success: true,
        custo: custoNum,
        preco_minimo: parseFloat(precoMinimo.toFixed(2)),
        preco_sugerido: parseFloat(precoSugerido.toFixed(2)),
        melhor_preco_mercado: melhorPrecoMercado?.melhor_preco || null,
        margem_final: parseFloat(margemFinal.toFixed(2)),
        estrategia,
        aviso
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // ============ JOB AGENDADO ============

  /**
   * Executa análise automaticamente todo dia às 8:00
   */
  cron.schedule('0 8 * * *', async () => {
    console.log('\n⏰ [CRON] Executando análise diária do BoaDica...');

    try {
      const resultado = await scraper.executarAnalise();

      if (resultado.sucesso && resultado.alertasGerados > 0) {
        console.log(`🚨 [CRON] ${resultado.alertasGerados} novos alertas gerados!`);
      }
    } catch (error) {
      console.error('❌ [CRON] Erro na análise:', error);
    }
  }, {
    timezone: "America/Sao_Paulo"
  });

  console.log('✓ Rotas do BoaDica configuradas');
  console.log('✓ Job agendado: Todo dia às 8:00 (America/Sao_Paulo)');
}
