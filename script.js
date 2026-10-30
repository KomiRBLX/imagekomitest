/* =====================================================================
   CONFIGURAÇÃO PADRÃO — valores iniciais do painel.
   Os ajustes feitos no painel ficam salvos no navegador (localStorage);
   "Restaurar padrão" volta para os valores abaixo.
   ===================================================================== */
const PADRAO = {
  texto: "Meu texto aqui",                 // Texto exibido sobre a imagem
  porLinha: false,                         // true: uma linha do texto para cada imagem
  fonte: "Montserrat, Arial, sans-serif",  // Família da fonte
  peso: "700",                             // "400", "600", "700" ou "800"
  tamanho: 4,                              // % da largura da imagem
  corTexto: "#ffffff",
  opTexto: 100,                            // 0–100
  sombra: true,
  zoom: 100,                               // 100 = sem zoom; corte centralizado, mantém a resolução
  ancoraH: "direita",                      // "direita", "centro" ou "esquerda"
  ancoraV: "baixo",                        // "baixo", "centro" ou "topo"
  margemH: 2,                              // distância da lateral (% da largura)
  margemV: 2,                              // distância do rodapé/topo (% da largura)
  larguraMax: 90,                          // largura máx. do bloco de texto (% da largura)
};
const ALTURA_LINHA = 1.25;                 // espaçamento entre linhas
const SUFIXO_ARQUIVO = "-editada";         // sufixo dos arquivos exportados
const CHAVE_STORAGE = "editorImagemLote.cfg.v2";
const ATRASO_RERENDER = 350;               // ms de espera após mexer no painel
/* ===================================================================== */

const $ = id => document.getElementById(id);
const entrada = $("entrada"), zona = $("zona"), grade = $("grade");
const btnZip = $("btnZip"), btnLimpar = $("btnLimpar"), msg = $("msg");

const itens = [];            // { file, nome, blob, url, img }
const nomesUsados = new Set();
let token = 0;               // invalida renderizações antigas
let timer = null;

function mostrar(texto, tipo = "") {
  msg.textContent = texto;
  msg.className = tipo;
}

/* ---------- Painel de configurações ---------- */
function ler(id) {
  const el = $(id);
  if (el.type === "checkbox") return el.checked;
  if (el.type === "range") return parseFloat(el.value);
  return el.value;
}

function escrever(id, valor) {
  const el = $(id);
  if (el.type === "checkbox") el.checked = valor;
  else el.value = valor;
  atualizarSaida(el);
}

function atualizarSaida(el) {
  if (el.type !== "range") return;
  const saida = el.closest("label").querySelector("output");
  if (saida) saida.textContent = `${el.value} ${el.dataset.un || ""}`;
}

const lerConfig = () => Object.fromEntries(Object.keys(PADRAO).map(k => [k, ler(k)]));

function salvarConfig() {
  try { localStorage.setItem(CHAVE_STORAGE, JSON.stringify(lerConfig())); } catch {}
}

function aplicarConfig(cfg) {
  for (const k of Object.keys(PADRAO)) escrever(k, cfg[k] ?? PADRAO[k]);
}

function carregarConfig() {
  let salvo = {};
  try { salvo = JSON.parse(localStorage.getItem(CHAVE_STORAGE)) || {}; } catch {}
  aplicarConfig({ ...PADRAO, ...salvo });
}

function agendar() {
  salvarConfig();
  clearTimeout(timer);
  timer = setTimeout(renderizarTodos, ATRASO_RERENDER);
}

/* ---------- Desenho ---------- */
// Quebra o texto em linhas que caibam na largura máxima
function quebrarLinhas(ctx, texto, larguraMax) {
  const linhas = [];
  for (const paragrafo of texto.split("\n")) {
    let atual = "";
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const teste = atual ? atual + " " + palavra : palavra;
      if (!atual || ctx.measureText(teste).width <= larguraMax) atual = teste;
      else { linhas.push(atual); atual = palavra; }
    }
    linhas.push(atual);
  }
  return linhas;
}

// Todas as distâncias são proporcionais à largura da imagem e medidas a partir da borda ancorada
function desenharTexto(ctx, largura, altura, cfg, texto) {
  const tamanho = Math.max(10, Math.round(largura * cfg.tamanho / 100));
  const margemH = Math.round(largura * cfg.margemH / 100);
  const margemV = Math.round(largura * cfg.margemV / 100);

  ctx.font = `${cfg.peso} ${tamanho}px ${cfg.fonte}`;
  ctx.textBaseline = "middle";

  const maxBloco = Math.min(largura * cfg.larguraMax / 100, largura - 2 * margemH);
  const linhas = quebrarLinhas(ctx, texto, Math.max(maxBloco, tamanho));
  const passo = tamanho * ALTURA_LINHA;
  const alturaBloco = linhas.length * passo;

  let y;
  if (cfg.ancoraV === "baixo") y = altura - margemV - alturaBloco;
  else if (cfg.ancoraV === "topo") y = margemV;
  else y = (altura - alturaBloco) / 2;

  let xTexto;
  if (cfg.ancoraH === "direita") { ctx.textAlign = "right"; xTexto = largura - margemH; }
  else if (cfg.ancoraH === "esquerda") { ctx.textAlign = "left"; xTexto = margemH; }
  else { ctx.textAlign = "center"; xTexto = largura / 2; }

  ctx.globalAlpha = cfg.opTexto / 100;
  ctx.fillStyle = cfg.corTexto;
  if (cfg.sombra) {
    ctx.shadowColor = "rgba(0,0,0,.75)";
    ctx.shadowBlur = tamanho * 0.25;
  }
  linhas.forEach((linha, i) => ctx.fillText(linha, xTexto, y + passo * i + passo / 2));
  ctx.globalAlpha = 1;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function carregarImagem(arquivo) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("imagem inválida")); };
    img.src = url;
  });
}

// Gera o PNG final na resolução original
async function renderizar(arquivo, cfg, texto) {
  const img = await carregarImagem(arquivo);
  const canvas = document.createElement("canvas");
  const w = canvas.width = img.naturalWidth;
  const h = canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  // Zoom: recorta a região central e amplia até a resolução original
  const z = Math.max(cfg.zoom, 100) / 100;
  const sw = w / z, sh = h / z;
  ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, w, h);
  // Garante que a fonte (ex.: Montserrat) esteja carregada antes de desenhar
  try { await document.fonts.load(`${cfg.peso} 40px ${cfg.fonte}`); } catch {}
  if (texto.trim()) desenharTexto(ctx, canvas.width, canvas.height, cfg, texto);
  return new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error("falha ao gerar PNG")), "image/png"));
}

/* ---------- Itens e cards ---------- */
function nomeUnico(base) {
  let nome = `${base}${SUFIXO_ARQUIVO}.png`, n = 2;
  while (nomesUsados.has(nome)) nome = `${base}${SUFIXO_ARQUIVO}-${n++}.png`;
  nomesUsados.add(nome);
  return nome;
}

function baixarBlob(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copiarBlob(blob) {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error("navegador sem suporte à cópia de imagem");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    mostrar("Imagem copiada para a área de transferência!", "ok");
  } catch (e) {
    mostrar("Não foi possível copiar: " + e.message + ". Use o botão Baixar.", "erro");
  }
}

function criarCard(item) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<img alt=""><div class="nome"></div>
    <div class="botoes">
      <button class="mini">Copiar</button>
      <button class="mini sec">Baixar PNG</button>
    </div>`;
  item.card = card;
  item.img = card.querySelector("img");
  const nome = card.querySelector(".nome");
  nome.textContent = nome.title = item.nome;
  const [bCopiar, bBaixar] = card.querySelectorAll("button");
  bCopiar.onclick = () => item.blob && copiarBlob(item.blob);
  bBaixar.onclick = () => item.blob && baixarBlob(item.blob, item.nome);
  grade.appendChild(card);
}

function removerItem(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.card.remove();
  nomesUsados.delete(item.nome);
  itens.splice(itens.indexOf(item), 1);
}

// Renderiza todas as imagens em sequência; uma nova chamada cancela a anterior
async function renderizarTodos() {
  if (!itens.length) return;
  const meu = ++token;
  const cfg = lerConfig();
  const linhas = cfg.porLinha ? cfg.texto.split("\n") : null;
  btnZip.disabled = true;
  let pos = 0, falhas = 0;

  for (const item of [...itens]) {
    if (meu !== token) return;
    mostrar(`Processando ${pos + 1} de ${itens.length}...`);
    const texto = linhas ? (linhas[pos] ?? "") : cfg.texto;
    try {
      const blob = await renderizar(item.file, cfg, texto);
      if (meu !== token) return;
      if (item.url) URL.revokeObjectURL(item.url);
      item.blob = blob;
      item.url = URL.createObjectURL(blob);
      item.img.src = item.url;
      pos++;
    } catch {
      removerItem(item);
      falhas++;
    }
    await new Promise(r => setTimeout(r)); // libera a interface entre imagens
  }

  if (meu !== token) return;
  btnZip.disabled = btnLimpar.disabled = !itens.length;
  mostrar(`${itens.length} imagem(ns) pronta(s).` + (falhas ? ` ${falhas} falha(s) ao ler.` : ""), falhas ? "erro" : "ok");
}

function adicionar(lista) {
  const arquivos = [...lista];
  const imagens = arquivos.filter(f => f.type.startsWith("image/"));
  const ignorados = arquivos.length - imagens.length;
  if (!imagens.length) { mostrar("Nenhum arquivo de imagem válido.", "erro"); return; }

  for (const file of imagens) {
    const item = { file, nome: nomeUnico(file.name.replace(/\.[^.]+$/, "") || "imagem"), blob: null, url: null };
    itens.push(item);
    criarCard(item);
  }
  btnLimpar.disabled = false;
  renderizarTodos().then(() => {
    if (ignorados) mostrar(msg.textContent + ` ${ignorados} arquivo(s) ignorado(s) (não são imagens).`, "erro");
  });
}

/* ---------- ZIP (sem bibliotecas, método "store" sem compressão) ---------- */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(dados) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function criarZip(lista) {
  const enc = new TextEncoder();
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const locais = [], centrais = [];
  let offset = 0, tamCentral = 0;

  for (const { nome, blob } of lista) {
    const dados = new Uint8Array(await blob.arrayBuffer());
    const nomeB = enc.encode(nome);
    const crc = crc32(dados);

    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);            // nomes em UTF-8
    l.setUint16(10, hora, true);
    l.setUint16(12, data, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, dados.length, true);
    l.setUint32(22, dados.length, true);
    l.setUint16(26, nomeB.length, true);
    locais.push(l, nomeB, dados);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, data, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, dados.length, true);
    c.setUint32(24, dados.length, true);
    c.setUint16(28, nomeB.length, true);
    c.setUint32(42, offset, true);
    centrais.push(c, nomeB);

    offset += 30 + nomeB.length + dados.length;
    tamCentral += 46 + nomeB.length;
  }

  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, lista.length, true);
  fim.setUint16(10, lista.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, offset, true);

  return new Blob([...locais, ...centrais, fim], { type: "application/zip" });
}

/* ---------- Eventos ---------- */
for (const k of Object.keys(PADRAO)) {
  const el = $(k);
  el.addEventListener("input", () => { atualizarSaida(el); agendar(); });
}

$("btnPadrao").addEventListener("click", () => { aplicarConfig(PADRAO); agendar(); });

btnZip.addEventListener("click", async () => {
  try {
    btnZip.disabled = true;
    mostrar("Gerando ZIP...");
    const zip = await criarZip(itens.filter(i => i.blob));
    baixarBlob(zip, "imagens-editadas.zip");
    mostrar(`ZIP com ${itens.length} imagem(ns) gerado.`, "ok");
  } catch (e) {
    mostrar("Erro ao gerar o ZIP: " + e.message, "erro");
  } finally {
    btnZip.disabled = !itens.length;
  }
});

btnLimpar.addEventListener("click", () => {
  token++;
  [...itens].forEach(removerItem);
  btnZip.disabled = btnLimpar.disabled = true;
  mostrar("");
});

entrada.addEventListener("change", () => {
  adicionar(entrada.files);
  entrada.value = "";
});

// Arrastar e soltar (em toda a página)
["dragenter", "dragover"].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("sobre"); }));
["dragleave", "drop"].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("sobre"); }));
window.addEventListener("drop", e => adicionar(e.dataTransfer.files));

carregarConfig();
