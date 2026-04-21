const FILE_KANJI_TO_INT = {
  "１": 1,
  "２": 2,
  "３": 3,
  "４": 4,
  "５": 5,
  "６": 6,
  "７": 7,
  "８": 8,
  "９": 9,
};

const RANK_KANJI_TO_INT = {
  "一": 1,
  "二": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
};

const RANK_INT_TO_KANJI = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const FILE_LABELS = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];

const PIECE_ORDER = ["飛", "角", "金", "銀", "桂", "香", "歩"];
const BOARD_PIECES = ["玉", "王", "飛", "角", "金", "銀", "桂", "香", "歩", "龍", "竜", "馬", "成銀", "成桂", "成香", "と"];
const PIECE_ALIASES = {
  王: "玉",
  竜: "龍",
};
const PROMOTION_MAP = {
  歩: "と",
  香: "成香",
  桂: "成桂",
  銀: "成銀",
  角: "馬",
  飛: "龍",
};
const DEMOTION_MAP = {
  と: "歩",
  成香: "香",
  成桂: "桂",
  成銀: "銀",
  馬: "角",
  龍: "飛",
  竜: "飛",
};
function normalizePiece(piece) {
  return PIECE_ALIASES[piece] || piece;
}

function cloneState(state) {
  return {
    board: state.board.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
    hands: {
      black: { ...state.hands.black },
      white: { ...state.hands.white },
    },
    moveNumber: state.moveNumber,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    notes: state.notes ? [...state.notes] : [],
  };
}

function createEmptyBoard() {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
}

function setPiece(board, file, rank, owner, piece) {
  board[rank - 1][file - 1] = { owner, piece };
}

export function createInitialState() {
  const board = createEmptyBoard();

  const topBack = ["香", "桂", "銀", "金", "玉", "金", "銀", "桂", "香"];
  const bottomBack = ["香", "桂", "銀", "金", "玉", "金", "銀", "桂", "香"];

  for (let file = 1; file <= 9; file += 1) {
    setPiece(board, file, 1, "white", topBack[file - 1]);
    setPiece(board, file, 9, "black", bottomBack[file - 1]);
    setPiece(board, file, 3, "white", "歩");
    setPiece(board, file, 7, "black", "歩");
  }

  setPiece(board, 2, 2, "white", "角");
  setPiece(board, 8, 2, "white", "飛");
  setPiece(board, 8, 8, "black", "角");
  setPiece(board, 2, 8, "black", "飛");

  return {
    board,
    hands: {
      black: { 飛: 0, 角: 0, 金: 0, 銀: 0, 桂: 0, 香: 0, 歩: 0 },
      white: { 飛: 0, 角: 0, 金: 0, 銀: 0, 桂: 0, 香: 0, 歩: 0 },
    },
    moveNumber: 0,
    lastMove: null,
    notes: [],
  };
}

function formatDestination(dest) {
  return `${dest.file}${RANK_INT_TO_KANJI[dest.rank]}`;
}

function stripMoveTiming(rest) {
  return rest.replace(/\s+\(\s*\d+:\d+\/\d{2}:\d{2}:\d{2}\)\s*$/, "").trim();
}

function parseMoveBody(moveBody, previousDestination) {
  const trimmed = moveBody.trim();
  if (["投了", "中断", "持将棋", "千日手", "詰み", "切れ負け", "反則負け", "反則勝ち"].includes(trimmed)) {
    return { special: trimmed };
  }

  let destination = null;
  let rest = trimmed;
  if (trimmed.startsWith("同")) {
    destination = previousDestination ? { ...previousDestination } : null;
    rest = trimmed.replace(/^同[　\s]*/, "");
  } else {
    const destMatch = trimmed.match(/^([１２３４５６７８９])([一二三四五六七八九])(.*)$/);
    if (!destMatch) {
      throw new Error(`指し手の解析に失敗しました: ${moveBody}`);
    }
    destination = {
      file: FILE_KANJI_TO_INT[destMatch[1]],
      rank: RANK_KANJI_TO_INT[destMatch[2]],
    };
    rest = destMatch[3];
  }

  let source = null;
  const sourceMatch = rest.match(/\((\d)(\d)\)\s*$/);
  if (sourceMatch) {
    source = {
      file: Number(sourceMatch[1]),
      rank: Number(sourceMatch[2]),
    };
    rest = rest.slice(0, sourceMatch.index).trim();
  }

  let action = "";
  if (rest.endsWith("不成")) {
    action = "不成";
    rest = rest.slice(0, -2);
  } else if (rest.endsWith("成")) {
    action = "成";
    rest = rest.slice(0, -1);
  } else if (rest.endsWith("打")) {
    action = "打";
    rest = rest.slice(0, -1);
  }

  let piece = null;
  for (const candidate of [...BOARD_PIECES].sort((a, b) => b.length - a.length)) {
    if (rest.startsWith(candidate)) {
      piece = normalizePiece(candidate);
      rest = rest.slice(candidate.length);
      break;
    }
  }

  if (!piece) {
    throw new Error(`駒種の解析に失敗しました: ${moveBody}`);
  }

  return {
    special: null,
    destination,
    source,
    piece,
    action,
    qualifier: rest,
  };
}

export function parseKifuText(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const metadata = {};
  const comments = [];
  const moves = [];
  let inMoves = false;
  let previousDestination = null;
  let result = "";

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("*")) {
      comments.push(line);
      continue;
    }

    if (!inMoves) {
      if (line.startsWith("手数----指手")) {
        inMoves = true;
        continue;
      }
      const metaMatch = line.match(/^([^：]+)：(.*)$/);
      if (metaMatch) {
        metadata[metaMatch[1].trim()] = metaMatch[2].trim();
      }
      continue;
    }

    const resultMatch = line.match(/^まで(\d+)手で(.+)$/);
    if (resultMatch) {
      result = line.trim();
      continue;
    }

    const moveMatch = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!moveMatch) {
      continue;
    }

    const moveNumber = Number(moveMatch[1]);
    const moveBody = stripMoveTiming(moveMatch[2]);
    const parsed = parseMoveBody(moveBody, previousDestination);
    if (!parsed.special && parsed.destination) {
      previousDestination = parsed.destination;
    }
    moves.push({
      number: moveNumber,
      raw: moveBody,
      ...parsed,
    });
  }

  return { metadata, comments, moves, result };
}

function insideBoard(file, rank) {
  return file >= 1 && file <= 9 && rank >= 1 && rank <= 9;
}

function promotionBase(piece) {
  return DEMOTION_MAP[piece] || piece;
}

function movementVectors(piece) {
  switch (piece) {
    case "歩":
      return { step: [[0, -1]], slide: [] };
    case "香":
      return { step: [], slide: [[0, -1]] };
    case "桂":
      return { step: [[-1, -2], [1, -2]], slide: [] };
    case "銀":
      return { step: [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]], slide: [] };
    case "金":
    case "と":
    case "成香":
    case "成桂":
    case "成銀":
      return { step: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]], slide: [] };
    case "角":
      return { step: [], slide: [[-1, -1], [1, -1], [-1, 1], [1, 1]] };
    case "飛":
      return { step: [], slide: [[0, -1], [0, 1], [-1, 0], [1, 0]] };
    case "玉":
      return { step: [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]], slide: [] };
    case "馬":
      return { step: [[0, -1], [0, 1], [-1, 0], [1, 0]], slide: [[-1, -1], [1, -1], [-1, 1], [1, 1]] };
    case "龍":
      return { step: [[-1, -1], [1, -1], [-1, 1], [1, 1]], slide: [[0, -1], [0, 1], [-1, 0], [1, 0]] };
    default:
      return { step: [], slide: [] };
  }
}

function orient(owner, [dx, dy]) {
  return owner === "black" ? [dx, dy] : [-dx, -dy];
}

function canReach(board, source, destination, piece, owner) {
  const vectors = movementVectors(piece);
  for (const step of vectors.step) {
    const [dx, dy] = orient(owner, step);
    if (source.file + dx === destination.file && source.rank + dy === destination.rank) {
      const target = board[destination.rank - 1][destination.file - 1];
      if (!target || target.owner !== owner) {
        return true;
      }
    }
  }

  for (const slide of vectors.slide) {
    const [dx, dy] = orient(owner, slide);
    let file = source.file + dx;
    let rank = source.rank + dy;
    while (insideBoard(file, rank)) {
      if (file === destination.file && rank === destination.rank) {
        const target = board[destination.rank - 1][destination.file - 1];
        if (!target || target.owner !== owner) {
          return true;
        }
        break;
      }
      if (board[rank - 1][file - 1]) {
        break;
      }
      file += dx;
      rank += dy;
    }
  }

  return false;
}

function satisfiesQualifier(source, destination, owner, qualifier) {
  if (!qualifier) {
    return true;
  }

  const forwardDistance = owner === "black"
    ? source.rank - destination.rank
    : destination.rank - source.rank;

  if (qualifier.includes("直") && source.file !== destination.file) {
    return false;
  }
  if (qualifier.includes("寄") && source.rank !== destination.rank) {
    return false;
  }
  if (qualifier.includes("上") && forwardDistance <= 0) {
    return false;
  }
  if (qualifier.includes("引") && forwardDistance >= 0) {
    return false;
  }

  return true;
}

function candidateSources(state, move, owner) {
  const board = state.board;
  const desiredPiece =
    move.action === "成"
      ? move.piece
      : move.action === "打"
        ? move.piece
        : normalizePiece(move.piece);

  const candidates = [];
  for (let rank = 1; rank <= 9; rank += 1) {
    for (let file = 1; file <= 9; file += 1) {
      const cell = board[rank - 1][file - 1];
      if (!cell || cell.owner !== owner) {
        continue;
      }

      if (move.action === "成") {
        if (promotionBase(cell.piece) !== desiredPiece || DEMOTION_MAP[cell.piece]) {
          continue;
        }
      } else if (normalizePiece(cell.piece) !== desiredPiece) {
        continue;
      }

      const source = { file, rank };
      if (canReach(board, source, move.destination, cell.piece, owner) && satisfiesQualifier(source, move.destination, owner, move.qualifier)) {
        candidates.push(source);
      }
    }
  }

  if (move.qualifier.includes("右") || move.qualifier.includes("左")) {
    candidates.sort((a, b) => {
      const axisA = owner === "black" ? a.file : -a.file;
      const axisB = owner === "black" ? b.file : -b.file;
      return move.qualifier.includes("右") ? axisA - axisB : axisB - axisA;
    });
  }

  return candidates;
}

function applyRegularMove(nextState, move, owner) {
  const destination = move.destination;
  const board = nextState.board;
  const handKey = owner;
  const enemyKey = owner === "black" ? "white" : "black";
  let source = move.source;

  if (move.action === "打") {
    if (nextState.hands[handKey][move.piece] > 0) {
      nextState.hands[handKey][move.piece] -= 1;
    }
    board[destination.rank - 1][destination.file - 1] = { owner, piece: move.piece };
    nextState.lastMove = {
      number: move.number,
      destination,
      notation: move.raw,
    };
    return;
  }

  if (!source) {
    const sources = candidateSources(nextState, move, owner);
    if (sources.length === 0) {
      const target = board[destination.rank - 1][destination.file - 1];
      if (!target && nextState.hands[handKey][move.piece] > 0) {
        nextState.hands[handKey][move.piece] -= 1;
        board[destination.rank - 1][destination.file - 1] = { owner, piece: move.piece };
        nextState.lastMove = {
          number: move.number,
          destination,
          notation: move.raw,
        };
        nextState.notes.push(`手数${move.number}: 打の省略として処理しました`);
        return;
      }
      throw new Error(`指し手の元位置を推定できません: ${move.raw}`);
    }
    source = sources[0];
    if (sources.length > 1) {
      nextState.notes.push(`手数${move.number}: 候補が複数あったため ${source.file}${source.rank} を採用しました`);
    }
  }

  const origin = board[source.rank - 1][source.file - 1];
  if (!origin || origin.owner !== owner) {
    throw new Error(`移動元の駒が見つかりません: ${move.raw}`);
  }

  const captured = board[destination.rank - 1][destination.file - 1];
  if (captured && captured.owner === enemyKey) {
    const capturedBase = promotionBase(captured.piece);
    nextState.hands[handKey][capturedBase] += 1;
  }

  board[source.rank - 1][source.file - 1] = null;
  const movedPiece = move.action === "成" ? PROMOTION_MAP[origin.piece] : origin.piece;
  board[destination.rank - 1][destination.file - 1] = {
    owner,
    piece: movedPiece,
  };
  nextState.lastMove = {
    number: move.number,
    destination,
    notation: move.raw,
  };
}

export function buildGameStates(game) {
  const states = [createInitialState()];
  for (const move of game.moves) {
    const previous = states[states.length - 1];
    const nextState = cloneState(previous);
    nextState.moveNumber = move.number;
    nextState.notes = [];
    if (!move.special) {
      const owner = move.number % 2 === 1 ? "black" : "white";
      applyRegularMove(nextState, move, owner);
    } else {
      nextState.lastMove = {
        number: move.number,
        destination: previous.lastMove ? previous.lastMove.destination : null,
        notation: move.raw,
      };
    }
    states.push(nextState);
  }
  return states;
}

export function boardDisplayRows(board) {
  return board.map((row) => [...row]).reverse().map((row) => [...row].reverse());
}

export function boardPieceAt(board, displayFileIndex, displayRankIndex) {
  const boardFile = 9 - displayFileIndex;
  const boardRank = displayRankIndex + 1;
  return board[boardRank - 1][boardFile - 1];
}

export function formatMoveLabel(move) {
  if (move.special) {
    return move.raw;
  }
  return move.raw;
}

export function fileLabels() {
  return FILE_LABELS;
}

export function rankLabels() {
  return RANK_INT_TO_KANJI.slice(1);
}

export function pieceOrder() {
  return PIECE_ORDER;
}

export function formatHandCount(count) {
  return count > 1 ? `×${count}` : "";
}

export function metaDisplayEntries(metadata) {
  const preferred = ["先手", "後手", "棋戦", "開始日時", "勝者"];
  const hidden = new Set(["手合割", "データ元"]);
  const entries = [];
  for (const key of preferred) {
    if (metadata[key]) {
      entries.push([key, metadata[key]]);
    }
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!preferred.includes(key) && !hidden.has(key)) {
      entries.push([key, value]);
    }
  }
  return entries.slice(0, 8);
}

export function describeSelection(dateString, index, total, title) {
  return `${dateString} は ${total} 局中 ${index + 1} 局目の「${title}」に対応しています。`;
}

export function formatResult(result) {
  return result || "終局情報なし";
}

export function destinationText(destination) {
  return destination ? formatDestination(destination) : "";
}
