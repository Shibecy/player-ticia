/**
 * Rotas e Job Agendado para monitoramento do BoaDica
 */

import cron from 'node-cron';
import { BoadicaScraper } from './boadica-scraper.js';

export function setupBoadicaRoutes(app, db) {
  const scraper = new BoadicaScraper(db);

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
          (SELECT COUNT(*) FROM boadica_alertas WHERE visualizado = 0) as alertas_pendentes,
          (SELECT MAX(ultima_atualizacao) FROM boadica_produtos) as ultima_atualizacao
      `).get();

      res.json({
        success: true,
        ...stats
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
