/**
 * Script para investigar se o BoaDica tem uma API interna
 * Execute: node investigar-api-boadica.js
 */

import fetch from 'node-fetch';

const PRODUTO_ID = '144528';
const PRODUTO_URL = `https://boadica.com.br/produtos/p${PRODUTO_ID}`;

async function investigarAPI() {
  console.log('🔍 Investigando possíveis APIs do BoaDica...\n');

  // Possíveis endpoints de API baseados em padrões comuns
  const possiveisAPIs = [
    `https://boadica.com.br/api/produtos/${PRODUTO_ID}`,
    `https://boadica.com.br/api/produto/${PRODUTO_ID}`,
    `https://boadica.com.br/api/v1/produtos/${PRODUTO_ID}`,
    `https://api.boadica.com.br/produtos/${PRODUTO_ID}`,
    `https://boadica.com.br/produtos/detalhes/${PRODUTO_ID}`,
    `https://boadica.com.br/api/precos/produto/${PRODUTO_ID}`,
    `https://boadica.com.br/api/ofertas/produto/${PRODUTO_ID}`,
  ];

  console.log('📡 Testando possíveis endpoints:\n');

  for (const url of possiveisAPIs) {
    try {
      console.log(`   Tentando: ${url}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json, text/plain, */*',
          'Referer': PRODUTO_URL
        },
        timeout: 5000
      });

      console.log(`   Status: ${response.status}`);

      if (response.ok) {
        const contentType = response.headers.get('content-type');
        console.log(`   Content-Type: ${contentType}`);

        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          console.log(`   ✅ ENCONTROU JSON!`);
          console.log(`   Dados:`, JSON.stringify(data, null, 2).substring(0, 500));
          console.log('\n');
        } else {
          const text = await response.text();
          console.log(`   Texto (primeiros 200 chars): ${text.substring(0, 200)}`);
        }
      }
      console.log('');

    } catch (error) {
      console.log(`   ❌ Erro: ${error.message}`);
      console.log('');
    }

    // Pequeno delay entre requisições
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Tentar interceptar chamadas que o Angular faz
  console.log('\n🌐 Buscando chamadas XHR no HTML...\n');

  try {
    const response = await fetch(PRODUTO_URL);
    const html = await response.text();

    // Procurar por URLs de API no código JavaScript
    const apiPatterns = [
      /api[\/\w-]+(produtos|produto|precos|ofertas)[\/\w-]*/gi,
      /\/(api|rest|service)[\/\w-]*/gi,
      /environment\s*=\s*\{[^}]*apiUrl[^}]*\}/gi
    ];

    console.log('   Procurando padrões de API no código...\n');

    for (const pattern of apiPatterns) {
      const matches = [...html.matchAll(pattern)];
      if (matches.length > 0) {
        const uniqueMatches = [...new Set(matches.map(m => m[0]))];
        console.log(`   Padrão encontrado (${pattern}):`);
        uniqueMatches.slice(0, 5).forEach(match => {
          console.log(`      - ${match}`);
        });
        console.log('');
      }
    }

    // Procurar por configurações da API
    const envMatch = html.match(/environment\s*[:=]\s*({[^}]+})/);
    if (envMatch) {
      console.log('   ✅ Configuração de ambiente encontrada:');
      console.log(`   ${envMatch[0].substring(0, 500)}`);
    }

  } catch (error) {
    console.error('   ❌ Erro ao buscar HTML:', error.message);
  }

  console.log('\n✅ Investigação concluída!');
  console.log('\n💡 Próximos passos:');
  console.log('   1. Se encontrou uma API funcional, podemos usá-la diretamente');
  console.log('   2. Se não, podemos tentar extrair dados dos scripts inline');
  console.log('   3. Ou usar um serviço externo de scraping (como ScrapingBee)');
}

investigarAPI();
