import {
  parseKifuText,
  buildGameStates,
  boardPieceAt,
  fileLabels,
  rankLabels,
  pieceOrder,
  formatHandCount,
  metaDisplayEntries,
  formatResult,
  destinationText,
  formatMoveLabel,
} from "./shogi-core.js";

const manifestUrl = "./data/manifest.json";
const authStorageKey = "shogi-daily-viewer-authenticated";
const authPasswordHash = "379fb1eb999bfb776c12bc25e7d4c248ab718490f43c760e51c641ab083b0779";

const dom = {
  authScreen: document.getElementById("authScreen"),
  authForm: document.getElementById("authForm"),
  authPassword: document.getElementById("authPassword"),
  authError: document.getElementById("authError"),
  stageMetaGrid: document.getElementById("stageMetaGrid"),
  metaGrid: document.getElementById("metaGrid"),
  boardGrid: document.getElementById("boardGrid"),
  boardFilesTop: document.getElementById("boardFilesTop"),
  boardRanksRight: document.getElementById("boardRanksRight"),
  whiteHand: document.getElementById("whiteHand"),
  blackHand: document.getElementById("blackHand"),
  moveSlider: document.getElementById("moveSlider"),
  moveSummary: document.getElementById("moveSummary"),
  resultSummary: document.getElementById("resultSummary"),
  moveList: document.getElementById("moveList"),
  movesCount: document.getElementById("movesCount"),
  gameSelect: document.getElementById("gameSelect"),
  prevGameBtn: document.getElementById("prevGameBtn"),
  nextGameBtn: document.getElementById("nextGameBtn"),
  startBtn: document.getElementById("startBtn"),
  prevBtn: document.getElementById("prevBtn"),
  playBtn: document.getElementById("playBtn"),
  nextBtn: document.getElementById("nextBtn"),
  endBtn: document.getElementById("endBtn"),
};

const state = {
  manifest: [],
  currentGameIndex: 0,
  parsedGame: null,
  gameStates: [],
  currentMoveIndex: 0,
  autoplayTimer: null,
};

const pieceImageCache = new Map();

function pieceImageUrl(piece, owner, compact = false) {
  const key = `${piece}:${owner}:${compact ? "compact" : "board"}`;
  if (pieceImageCache.has(key)) {
    return pieceImageCache.get(key);
  }

  const width = compact ? 44 : 52;
  const height = compact ? 52 : 62;
  const fontSize = compact ? 22 : 27;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fff7df"/>
          <stop offset="55%" stop-color="#f2ddb6"/>
          <stop offset="100%" stop-color="#e1bf87"/>
        </linearGradient>
      </defs>
      <g transform="${owner === "white" ? `translate(${width} ${height}) rotate(180)` : ""}">
        <path d="M${width / 2} 2 L${width - 8} 14 L${width - 3} ${height - 3} L3 ${height - 3} L8 14 Z" fill="url(#g)" stroke="#694221" stroke-width="1.3"/>
        <path d="M${width / 2} 5 L${width - 11.5} 15.5 L${width - 7.5} ${height - 6} L7.5 ${height - 6} L11.5 15.5 Z" fill="none" stroke="rgba(255,255,255,0.42)" stroke-width="1"/>
        <text x="${width / 2}" y="${height * 0.69}" text-anchor="middle" font-family="Shippori Mincho, serif" font-size="${fontSize}" font-weight="700" fill="#1f140e">${piece}</text>
      </g>
    </svg>
  `.trim();

  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  pieceImageCache.set(key, url);
  return url;
}

function stopAutoplay() {
  if (state.autoplayTimer) {
    clearInterval(state.autoplayTimer);
    state.autoplayTimer = null;
    dom.playBtn.textContent = "自動再生";
  }
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function unlockViewer() {
  dom.authScreen.classList.add("hidden");
  document.body.classList.add("viewer-unlocked");
}

async function requireAuth() {
  if (localStorage.getItem(authStorageKey) === "yes") {
    unlockViewer();
    return;
  }

  dom.authPassword.focus();
  await new Promise((resolve) => {
    dom.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      dom.authError.textContent = "";
      const inputHash = await sha256Hex(dom.authPassword.value);
      if (inputHash !== authPasswordHash) {
        dom.authError.textContent = "パスワードが違います。";
        dom.authPassword.select();
        return;
      }
      localStorage.setItem(authStorageKey, "yes");
      unlockViewer();
      resolve();
    });
  });
}

function ensureBoardSkeleton() {
  if (dom.boardGrid.childElementCount) {
    return;
  }

  fileLabels().forEach((label) => {
    const node = document.createElement("div");
    node.textContent = label;
    dom.boardFilesTop.appendChild(node);
  });

  rankLabels().forEach((label) => {
    const node = document.createElement("div");
    node.textContent = label;
    dom.boardRanksRight.appendChild(node);
  });

  for (let displayRank = 0; displayRank < 9; displayRank += 1) {
    for (let displayFile = 0; displayFile < 9; displayFile += 1) {
      const cell = document.createElement("div");
      cell.className = "board-cell";
      cell.dataset.displayFile = String(displayFile);
      cell.dataset.displayRank = String(displayRank);
      dom.boardGrid.appendChild(cell);
    }
  }
}

function renderMeta(metadata) {
  const stageLabels = ["先手", "後手", "戦型"];
  dom.stageMetaGrid.innerHTML = "";
  stageLabels.forEach((label) => {
    const card = document.createElement("div");
    card.className = "meta-card stage-meta-card";
    card.innerHTML = `
      <div class="meta-label">${label}</div>
      <div class="meta-value">${metadata[label] || "-"}</div>
    `;
    dom.stageMetaGrid.appendChild(card);
  });

  dom.metaGrid.innerHTML = "";
  metaDisplayEntries(metadata)
    .filter(([label]) => !stageLabels.includes(label))
    .forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "meta-card";
      card.innerHTML = `
        <div class="meta-label">${label}</div>
        <div class="meta-value">${value}</div>
      `;
      dom.metaGrid.appendChild(card);
    });
}

function renderHands(container, hands) {
  container.innerHTML = "";
  const fragments = pieceOrder()
    .filter((piece) => hands[piece] > 0)
    .map((piece) => {
      const node = document.createElement("div");
      node.className = "hand-piece";
      node.textContent = `${piece}${formatHandCount(hands[piece])}`;
      return node;
    });

  if (!fragments.length) {
    const empty = document.createElement("div");
    empty.className = "hand-empty";
    empty.textContent = "なし";
    container.appendChild(empty);
    return;
  }

  fragments.forEach((node) => container.appendChild(node));
}

function renderBoard(gameState) {
  const highlight = gameState.lastMove?.destination ? destinationText(gameState.lastMove.destination) : "";
  [...dom.boardGrid.children].forEach((cell) => {
    const displayFile = Number(cell.dataset.displayFile);
    const displayRank = Number(cell.dataset.displayRank);
    const piece = boardPieceAt(gameState.board, displayFile, displayRank);
    const boardFile = 9 - displayFile;
    const boardRank = displayRank + 1;
    const coordText = `${boardFile}${["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][boardRank]}`;
    cell.classList.toggle("highlight", coordText === highlight);
    cell.innerHTML = "";
    if (!piece) {
      return;
    }
    const pieceNode = document.createElement("img");
    pieceNode.className = "piece-image";
    pieceNode.src = pieceImageUrl(piece.piece, piece.owner);
    pieceNode.alt = piece.piece;
    cell.appendChild(pieceNode);
  });

  renderHands(dom.blackHand, gameState.hands.black);
  renderHands(dom.whiteHand, gameState.hands.white);
}

function renderMoves() {
  dom.moveList.innerHTML = "";
  state.parsedGame.moves.forEach((move, index) => {
    const item = document.createElement("li");
    item.className = "move-item";
    if (index + 1 === state.currentMoveIndex) {
      item.classList.add("current");
    }
    item.innerHTML = `
      <div class="move-number">${move.number}</div>
      <div class="move-body">
        <div class="move-text">${move.number % 2 === 1 ? "▲" : "△"}${formatMoveLabel(move)}</div>
        ${move.special ? '<div class="move-note">終局操作</div>' : ""}
      </div>
    `;
    item.addEventListener("click", () => {
      stopAutoplay();
      setMoveIndex(index + 1);
    });
    dom.moveList.appendChild(item);
  });
}

function updateSummary() {
  if (!state.parsedGame) {
    return;
  }
  if (state.currentMoveIndex === 0) {
    dom.moveSummary.textContent = "初期局面";
  } else {
    const move = state.parsedGame.moves[state.currentMoveIndex - 1];
    dom.moveSummary.textContent = `${move.number}手目: ${move.number % 2 === 1 ? "▲" : "△"}${move.raw}`;
  }
  dom.resultSummary.textContent = formatResult(state.parsedGame.result);
  dom.movesCount.textContent = `${state.parsedGame.moves.length}手`;
  dom.moveSlider.max = String(state.parsedGame.moves.length);
  dom.moveSlider.value = String(state.currentMoveIndex);
}

function setMoveIndex(index) {
  state.currentMoveIndex = Math.max(0, Math.min(index, state.gameStates.length - 1));
  renderBoard(state.gameStates[state.currentMoveIndex]);
  updateSummary();
  renderMoves();

  const currentNode = dom.moveList.querySelector(".move-item.current");
  if (currentNode) {
    const listTop = dom.moveList.scrollTop;
    const listBottom = listTop + dom.moveList.clientHeight;
    const itemTop = currentNode.offsetTop;
    const itemBottom = itemTop + currentNode.offsetHeight;
    if (itemTop < listTop) {
      dom.moveList.scrollTop = itemTop;
    } else if (itemBottom > listBottom) {
      dom.moveList.scrollTop = itemBottom - dom.moveList.clientHeight;
    }
  }
}

async function loadGame(index) {
  stopAutoplay();
  state.currentGameIndex = ((index % state.manifest.length) + state.manifest.length) % state.manifest.length;
  const entry = state.manifest[state.currentGameIndex];
  dom.gameSelect.value = entry.id;

  const response = await fetch(`./data/games/${entry.file}`);
  const text = await response.text();
  const parsed = parseKifuText(text);
  const gameStates = buildGameStates(parsed);

  state.parsedGame = parsed;
  state.gameStates = gameStates;

  renderMeta({
    ...parsed.metadata,
    データ元: entry.source,
  });

  state.currentMoveIndex = 0;
  renderBoard(gameStates[0]);
  updateSummary();
  renderMoves();
}

function setupEvents() {
  dom.gameSelect.addEventListener("change", () => {
    stopAutoplay();
    const index = state.manifest.findIndex((entry) => entry.id === dom.gameSelect.value);
    if (index >= 0) {
      loadGame(index);
    }
  });

  dom.prevGameBtn.addEventListener("click", () => {
    loadGame(state.currentGameIndex - 1);
  });

  dom.nextGameBtn.addEventListener("click", () => {
    loadGame(state.currentGameIndex + 1);
  });

  dom.moveSlider.addEventListener("input", () => {
    stopAutoplay();
    setMoveIndex(Number(dom.moveSlider.value));
  });

  dom.startBtn.addEventListener("click", () => {
    stopAutoplay();
    setMoveIndex(0);
  });

  dom.prevBtn.addEventListener("click", () => {
    stopAutoplay();
    setMoveIndex(state.currentMoveIndex - 1);
  });

  dom.nextBtn.addEventListener("click", () => {
    stopAutoplay();
    setMoveIndex(state.currentMoveIndex + 1);
  });

  dom.endBtn.addEventListener("click", () => {
    stopAutoplay();
    setMoveIndex(state.gameStates.length - 1);
  });

  dom.playBtn.addEventListener("click", () => {
    if (state.autoplayTimer) {
      stopAutoplay();
      return;
    }
    dom.playBtn.textContent = "停止";
    state.autoplayTimer = setInterval(() => {
      if (state.currentMoveIndex >= state.gameStates.length - 1) {
        stopAutoplay();
        return;
      }
      setMoveIndex(state.currentMoveIndex + 1);
    }, 900);
  });
}

async function bootstrap() {
  await requireAuth();
  ensureBoardSkeleton();
  setupEvents();

  const manifest = await fetch(manifestUrl).then((res) => res.json());
  state.manifest = manifest.games;

  manifest.games.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.title} (${entry.category})`;
    dom.gameSelect.appendChild(option);
  });

  await loadGame(Math.floor(Math.random() * state.manifest.length));
}

bootstrap().catch((error) => {
  console.error(error);
});
