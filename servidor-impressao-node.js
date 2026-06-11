// ================================================================
// IMAC — Servidor de Impressão (Node.js)
// Envia ZPL direto para a Zebra via TCP — zero popup, zero diálogo
// Compatível com Node.js 6.x ou superior, Windows 7/8/10
// ================================================================

// ── CONFIGURE AQUI ───────────────────────────────────────────────
var IMPRESSORA_IP    = '192.168.1.100'; // IP da impressora Zebra na rede
var IMPRESSORA_PORTA = 9100;            // porta padrão ZPL (não alterar)
var POLL_MS          = 2000;            // checar fila a cada 2 segundos
// ─────────────────────────────────────────────────────────────────
// COMO DESCOBRIR O IP DA ZEBRA:
//   No painel da impressora: segure o botão Feed por ~2s → imprime
//   uma folha de configuração com o IP da rede.
// ─────────────────────────────────────────────────────────────────

var https = require('https');
var net   = require('net');

var DB_HOST = 'etiquetas-84828-default-rtdb.firebaseio.com';

// Remove acentos e caracteres não-ASCII para compatibilidade ZPL
function limpar(s, max) {
  return ((s || '-') + '')
    .replace(/[áàãâä]/gi, 'a').replace(/[éèêë]/gi, 'e')
    .replace(/[íìîï]/gi,  'i').replace(/[óòõôö]/gi, 'o')
    .replace(/[úùûü]/gi,  'u').replace(/[çÇ]/g, 'c')
    .replace(/[ñÑ]/g,     'n').replace(/[^\x20-\x7E]/g, '?')
    .slice(0, max || 30);
}

function log(msg) {
  var ts = new Date().toLocaleTimeString('pt-BR');
  process.stdout.write('[' + ts + '] ' + msg + '\n');
}

// ── Firebase REST (sem npm, usa apenas https nativo) ─────────────
function fbReq(metodo, caminho) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: DB_HOST,
      path: caminho,
      method: metodo,
      headers: { 'Accept': 'application/json' }
    }, function(res) {
      var corpo = '';
      res.on('data', function(c) { corpo += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(corpo)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Envia ZPL para a Zebra por TCP ───────────────────────────────
function enviarZPL(zpl) {
  return new Promise(function(resolve, reject) {
    var cliente  = new net.Socket();
    var cancelar = setTimeout(function() {
      cliente.destroy();
      reject(new Error('Impressora nao respondeu em 5s. Verifique IP ' + IMPRESSORA_IP + ' e cabo de rede.'));
    }, 5000);

    cliente.connect(IMPRESSORA_PORTA, IMPRESSORA_IP, function() {
      cliente.write(zpl, 'ascii', function() {
        clearTimeout(cancelar);
        cliente.destroy();
        resolve();
      });
    });

    cliente.on('error', function(err) {
      clearTimeout(cancelar);
      cliente.destroy();
      reject(err);
    });
  });
}

// ── Gera ZPL para etiqueta 90 × 50 mm a 203 DPI (8 dot/mm) ──────
function gerarZPL(d) {
  var hoje    = new Date().toLocaleDateString('pt-BR');
  var produto = limpar(d.produto, 26).toUpperCase();
  var lote    = limpar(d.loteImac, 22);
  var loteForn= limpar(d.loteForn, 20);
  var nf      = limpar(d.nf, 16);
  var forn    = limpar(d.fornecedor, 20);
  var val     = limpar(d.validade, 12);
  var qtd     = limpar(d.quantidade, 12);
  var end_    = limpar(d.endereco, 18);
  var resp    = d.responsavel ? 'Op: ' + limpar(d.responsavel, 12) + '  ' : '';
  var entrada = limpar(d.dataRec, 10);

  // ^PW720  = largura 90mm × 8 dot/mm
  // ^LL400  = altura  50mm × 8 dot/mm
  // ^A0N,h,w = fonte escalável nativa, altura h, largura w (dots)
  // ^GB w,h,t = caixa gráfica (t=h → preenchida)
  // ^FR      = texto reverso (branco em preto)

  return [
    '^XA',
    '^PW720',
    '^LL400',
    '^LH0,0',

    // Cabeçalho
    '^FO8,5^A0N,18,18^FDIMAC - CONTROLE DE ESTOQUE^FS',
    '^FO550,5^A0N,14,14^FDRastreabilidade^FS',
    '^FO5,26^GB710,2,2^FS',

    // Produto (destaque)
    '^FO5,31^A0N,46,46^FD' + produto + '^FS',

    // Lote IMAC em caixa preta / texto branco
    '^FO5,84^GB155,30,30^FS',
    '^FO9,87^A0N,20,20^FR^FDLOTE IMAC^FS',
    '^FO165,86^A0N,24,24^FD' + lote + '^FS',

    // Linha 1: Lote Fornecedor | Nota Fiscal
    '^FO5,120^A0N,13,13^FDLote Fornecedor^FS',
    '^FO5,135^A0N,20,20^FD' + loteForn + '^FS',
    '^FO365,120^A0N,13,13^FDNota Fiscal^FS',
    '^FO365,135^A0N,20,20^FD' + nf + '^FS',

    // Linha 2: Fornecedor | Validade
    '^FO5,160^A0N,13,13^FDFornecedor^FS',
    '^FO5,175^A0N,18,18^FD' + forn + '^FS',
    '^FO365,160^A0N,13,13^FDValidade^FS',
    '^FO365,175^A0N,22,22^FD' + val + '^FS',

    // Linha 3: Quantidade | Endereço
    '^FO5,202^A0N,13,13^FDQuantidade^FS',
    '^FO5,217^A0N,18,18^FD' + qtd + '^FS',
    '^FO365,202^A0N,13,13^FDEndereco / Local^FS',
    '^FO365,217^A0N,18,18^FD' + end_ + '^FS',

    // Rodapé
    '^FO5,242^GB710,2,2^FS',
    '^FO5,248^A0N,14,14^FD' + resp + 'IMAC Rastreabilidade^FS',
    '^FO430,248^A0N,14,14^FDEntrada: ' + entrada + '  Imp: ' + hoje + '^FS',

    '^XZ'
  ].join('\n');
}

// ── Loop principal ────────────────────────────────────────────────
var ocupado = false;

function verificarFila() {
  if (ocupado) return;
  ocupado = true;

  fbReq('GET', '/imac-fila-impressao.json')
    .then(function(fila) {
      if (!fila || typeof fila !== 'object') { ocupado = false; return; }

      var ids = Object.keys(fila);
      if (ids.length === 0) { ocupado = false; return; }

      log('Fila: ' + ids.length + ' trabalho(s). Processando...');

      function proximo(i) {
        if (i >= ids.length) { ocupado = false; return; }
        var id  = ids[i];
        var job = fila[id];
        if (!job) { proximo(i + 1); return; }

        // Remove do Firebase ANTES de imprimir — evita duplicata
        fbReq('DELETE', '/imac-fila-impressao/' + id + '.json')
          .then(function() {
            return enviarZPL(gerarZPL(job));
          })
          .then(function() {
            log('OK  ' + (job.produto || '') + ' | ' + (job.loteImac || ''));
            proximo(i + 1);
          })
          .catch(function(err) {
            log('ERRO: ' + err.message);
            proximo(i + 1);
          });
      }

      proximo(0);
    })
    .catch(function(err) {
      log('ERRO Firebase: ' + err.message);
      ocupado = false;
    });
}

log('=== IMAC Servidor de Impressao (Node.js) ===');
log('Impressora: ' + IMPRESSORA_IP + ':' + IMPRESSORA_PORTA);
log('Verificando fila a cada ' + POLL_MS + 'ms...');
log('Pressione Ctrl+C para parar.');
log('');

verificarFila();
setInterval(verificarFila, POLL_MS);
