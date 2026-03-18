/**
 * 인디언 포커 게임 로직
 * Host가 게임 상태를 관리하고, 양쪽이 동기화
 */

// 메시지 타입
const MSG = {
  // 연결 & 셋업
  PLAYER_INFO: 'PLAYER_INFO',
  GAME_START: 'GAME_START',

  // 카드 분배
  CARD_INFO: 'CARD_INFO',
  CARDS_DEALT: 'CARDS_DEALT',

  // 베팅
  BET_TURN: 'BET_TURN',
  BET_ACTION: 'BET_ACTION',
  POT_UPDATE: 'POT_UPDATE',

  // 결과
  REVEAL_REQUEST: 'REVEAL_REQUEST',
  REVEAL_CARD: 'REVEAL_CARD',
  ROUND_RESULT: 'ROUND_RESULT',

  // 게임 흐름
  NEXT_ROUND: 'NEXT_ROUND',
  GAME_OVER: 'GAME_OVER',
  NEW_GAME: 'NEW_GAME',
  RECONNECT_STATE: 'RECONNECT_STATE',
  DECK_SHUFFLED: 'DECK_SHUFFLED',
};

// 게임 상태
const STATE = {
  WAITING: 'WAITING',
  DEALING: 'DEALING',
  BETTING: 'BETTING',
  REVEAL: 'REVEAL',
  ROUND_END: 'ROUND_END',
  GAME_OVER: 'GAME_OVER',
};

// 게임 설정 상수
const STARTING_CHIPS = 20;
const MAX_RAISES_PER_ROUND = 3;
const BET_TIMER_SECONDS = 30;
// 블라인드 레벨: 라운드 3부터 2라운드마다 앤티 2배 증가 (홀덤 블라인드 구조)
const BLIND_INCREASE_START = 3;
const BLIND_INCREASE_INTERVAL = 2;
// ⚠️ 10카드 폴드 패널티: 밸런스 테스트 완료값. 이 값을 낮추지 마세요.
const FOLD_PENALTY_10 = 5;

class Game {
  constructor(connectionManager) {
    this.conn = connectionManager;
    this.state = STATE.WAITING;

    // 플레이어 정보
    this.myName = '';
    this.opponentName = '';
    this.myChips = STARTING_CHIPS;
    this.opponentChips = STARTING_CHIPS;

    // 라운드 정보
    this.myCard = null;
    this.opponentCard = null;
    this.pot = 0;
    this.currentBet = 0;
    this.myBetTotal = 0;
    this.opponentBetTotal = 0;
    this.isMyTurn = false;
    this.roundNumber = 0;
    this.ante = 1;
    this._betActionsCount = 0;
    this._raiseCount = 0;
    this._isGameOver = false;
    this._lastRoundLoser = null;
    this._carryPot = 0;

    // 라운드 히스토리 (게임 오버 시 요약용)
    this._roundHistory = [];

    // 라운드 전환 중복 방지
    this._nextRoundRequested = false;
    this._newGameRequested = false;

    // Host 전용
    this._hostCards = { host: null, guest: null };

    // 덱 시스템
    this._deck = [];
    this._deckSize = 0;
    this.remainingCards = 0;

    // 카드 히스토리 (덱 리셔플 시 초기화)
    this.playedCards = [];

    // UI 콜백
    this.onStateChange = null;
    this.onCardDealt = null;
    this.onRoundResult = null;
    this.onGameOver = null;
    this.onDeckShuffled = null;

    // 메시지 핸들러 등록
    this.conn.onMessage = (data) => this._handleMessage(data);
  }

  // ========== localStorage 저장/복원 ==========

  static STORAGE_KEY = 'indian-poker-session';

  _saveSession() {
    let carryPot = this._carryPot;
    let playedCards = this.playedCards;
    let deck = this._deck;

    // 라운드 중 끊김: 팟 금액을 이월팟으로 보존하고, 배당된 카드를 히스토리에 추가
    const isMidRound = this.state === STATE.DEALING || this.state === STATE.BETTING;
    if (isMidRound) {
      // 팟에 걸린 칩을 다음 라운드로 이월 (증발 방지)
      if (this.pot > 0) {
        carryPot = this.pot;
      }
      // Host: 이번 라운드에 배당된 카드를 히스토리에 추가
      if (this.conn.isHost) {
        playedCards = [...this.playedCards];
        if (this._hostCards.host !== null) playedCards.push(this._hostCards.host);
        if (this._hostCards.guest !== null) playedCards.push(this._hostCards.guest);
      }
    }

    const session = {
      hostId: this.conn.isHost ? this.conn.peerId : this._hostPeerId,
      myChips: this.myChips,
      opponentChips: this.opponentChips,
      roundNumber: this.roundNumber,
      myName: this.myName,
      opponentName: this.opponentName,
      isHost: this.conn.isHost,
      timestamp: Date.now(),
      // 덱/카드로그/이월팟 상태 보존
      deck: deck,
      playedCards: playedCards,
      carryPot: carryPot,
      lastRoundLoser: this._lastRoundLoser,
    };
    try {
      localStorage.setItem(Game.STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
      console.warn('[Game] Failed to save session:', e);
    }
  }

  static loadSession() {
    try {
      const raw = localStorage.getItem(Game.STORAGE_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (Date.now() - session.timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(Game.STORAGE_KEY);
        return null;
      }
      return session;
    } catch (e) {
      return null;
    }
  }

  static clearSession() {
    localStorage.removeItem(Game.STORAGE_KEY);
  }

  start(nickname, savedSession) {
    this.myName = nickname;
    this._hostPeerId = this.conn.isHost ? this.conn.peerId : null;

    this.conn.send({
      type: MSG.PLAYER_INFO,
      name: nickname,
    });

    if (savedSession && this.conn.isHost) {
      this.myChips = savedSession.myChips;
      this.opponentChips = savedSession.opponentChips;
      this.roundNumber = savedSession.roundNumber;
      // 덱/카드로그/이월팟 복원
      if (savedSession.deck && savedSession.deck.length > 0) {
        this._deck = savedSession.deck;
      }
      if (savedSession.playedCards) {
        this.playedCards = savedSession.playedCards;
      }
      if (savedSession.carryPot) {
        this._carryPot = savedSession.carryPot;
      }
      if (savedSession.lastRoundLoser) {
        this._lastRoundLoser = savedSession.lastRoundLoser;
      }
      this.remainingCards = this._deck.length;

      setTimeout(() => {
        this.conn.send({
          type: MSG.RECONNECT_STATE,
          yourChips: this.opponentChips,
          opponentChips: this.myChips,
          roundNumber: this.roundNumber,
          playedCards: this.playedCards,
          remainingCards: this.remainingCards,
          carryPot: this._carryPot,
        });
        this._updateUI();
        setTimeout(() => this._startNewRound(), 1000);
      }, 1500);
    } else if (this.conn.isHost) {
      setTimeout(() => this._startNewRound(), 1500);
    }
  }

  _handleMessage(data) {
    switch (data.type) {
      case MSG.PLAYER_INFO:
        this.opponentName = data.name;
        // 상대방과 이름이 같으면 내 이름에 랜덤 접미사 재생성
        if (this.myName === this.opponentName) {
          this.myName = '플레이어#' + Math.floor(Math.random() * 1000);
          this.conn.send({ type: MSG.PLAYER_INFO, name: this.myName });
        }
        if (!this.conn.isHost) {
          this._hostPeerId = this.conn.conn ? this.conn.conn.peer : null;
        }
        this._updateUI();
        break;

      case MSG.CARD_INFO:
        this.opponentCard = data.value;
        if (data.remainingCards !== undefined) {
          this.remainingCards = data.remainingCards;
        }
        if (this.onCardDealt) {
          this.onCardDealt(data.value);
        }
        break;

      case MSG.CARDS_DEALT: {
        this.state = STATE.BETTING;
        this.pot = data.pot;
        // 블라인드 레벨 업 알림 (게스트)
        const blindLevel = data.blindLevel || data.ante;
        if (blindLevel > 1 && blindLevel > (this._lastBlindLevel || 1)) {
          if (this.onBlindUp) this.onBlindUp(blindLevel);
        }
        this._lastBlindLevel = blindLevel;
        this.ante = blindLevel;
        this.currentBet = data.ante;
        this.myBetTotal = data.ante;
        this.opponentBetTotal = data.ante;
        this.myChips = data.yourChips;
        this.opponentChips = data.opponentChips;
        this._raiseCount = 0;
        if (data.playedCards) this.playedCards = data.playedCards;
        if (data.roundNumber) this.roundNumber = data.roundNumber;
        this._updateUI();
        break;
      }

      case MSG.BET_TURN:
        this.isMyTurn = data.isYourTurn;
        if (data.raiseCount !== undefined) this._raiseCount = data.raiseCount;
        this._updateUI();
        break;

      case MSG.BET_ACTION:
        this._handleOpponentBet(data);
        break;

      case MSG.POT_UPDATE:
        this.pot = data.pot;
        this.myChips = data.yourChips;
        this.opponentChips = data.opponentChips;
        this.myBetTotal = data.yourBet;
        this.opponentBetTotal = data.opponentBet;
        if (data.raiseCount !== undefined) this._raiseCount = data.raiseCount;
        this._updateUI();
        break;

      case MSG.REVEAL_CARD:
        this.myCard = data.value;
        break;

      case MSG.ROUND_RESULT:
        this.state = STATE.ROUND_END;
        this.myCard = data.yourCard;
        this.opponentCard = data.opponentCard;
        this.myChips = data.yourChips;
        this.opponentChips = data.opponentChips;
        if (data.playedCards) this.playedCards = data.playedCards;
        if (data.roundNumber) this.roundNumber = data.roundNumber;
        this._saveSession();
        if (this.onRoundResult) {
          this.onRoundResult({
            myCard: data.yourCard,
            opponentCard: data.opponentCard,
            winner: data.winner,
            potWon: data.potWon,
            myBetTotal: data.yourBetTotal,
            foldPenalty: data.foldPenalty || 0,
            roundNumber: data.roundNumber,
          });
        }
        break;

      case MSG.NEXT_ROUND:
        if (this.state === STATE.DEALING || this.state === STATE.BETTING) break;
        if (this._nextRoundRequested) break;
        this._resetRound();
        if (this.conn.isHost) {
          setTimeout(() => this._startNewRound(), 500);
        }
        break;

      case MSG.GAME_OVER:
        this.state = STATE.GAME_OVER;
        if (this.onGameOver) {
          this.onGameOver({
            winner: data.winner,
            yourChips: data.yourChips,
            opponentChips: data.opponentChips,
          });
        }
        break;

      case MSG.NEW_GAME:
        if (this._newGameRequested) break;
        this._resetGame();
        if (this.conn.isHost) {
          setTimeout(() => this._startNewRound(), 1000);
        }
        break;

      case MSG.RECONNECT_STATE:
        this.myChips = data.yourChips;
        this.opponentChips = data.opponentChips;
        this.roundNumber = data.roundNumber;
        if (data.playedCards) this.playedCards = data.playedCards;
        if (data.remainingCards !== undefined) this.remainingCards = data.remainingCards;
        if (data.carryPot) this._carryPot = data.carryPot;
        this._updateUI();
        break;

      case MSG.DECK_SHUFFLED:
        this.remainingCards = data.deckSize;
        this.playedCards = [];
        if (this.onDeckShuffled) this.onDeckShuffled(data.deckSize);
        this._updateUI();
        break;
    }
  }

  // ========== 덱 관리 (Host 전용) ==========

  _createDeck() {
    this._deck = [];
    for (let i = 1; i <= 10; i++) {
      this._deck.push(i, i);
    }
    // Fisher-Yates shuffle with crypto-safe random
    for (let i = this._deck.length - 1; i > 0; i--) {
      const j = this._cryptoRandInt(i + 1);
      [this._deck[i], this._deck[j]] = [this._deck[j], this._deck[i]];
    }
    this._deckSize = this._deck.length;
  }

  _cryptoRandInt(max) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  _drawCard() {
    return this._deck.pop();
  }

  // ========== Host 전용 로직 ==========

  _startNewRound() {
    if (!this.conn.isHost) return;
    if (this._isGameOver) return;
    if (this.myChips <= 0 || this.opponentChips <= 0) return;
    // 이미 딜링/베팅 중이면 중복 라운드 방지
    if (this.state === STATE.DEALING || this.state === STATE.BETTING) return;

    // 덱 부족 시 리셔플
    if (this._deck.length < 2) {
      this._createDeck();
      this.playedCards = [];
      this.conn.send({ type: MSG.DECK_SHUFFLED, deckSize: this._deck.length });
      if (this.onDeckShuffled) this.onDeckShuffled(this._deck.length);
    }

    this.roundNumber++;
    this.state = STATE.DEALING;
    this._raiseCount = 0;

    const hostCard = this._drawCard();
    const guestCard = this._drawCard();
    this._hostCards = { host: hostCard, guest: guestCard };
    this.remainingCards = this._deck.length;

    const ante = this._getAnte();
    this.ante = ante;
    // 앤티가 칩보다 많으면 올인 앤티 (가진 칩만큼만)
    const myAnte = Math.min(ante, this.myChips);
    const oppAnte = Math.min(ante, this.opponentChips);
    this.myChips -= myAnte;
    this.opponentChips -= oppAnte;
    this.pot = myAnte + oppAnte + this._carryPot;
    this._carryPot = 0;

    // 블라인드 레벨 업 알림 (호스트)
    if (this.roundNumber === BLIND_INCREASE_START ||
        (this.roundNumber > BLIND_INCREASE_START && (this.roundNumber - BLIND_INCREASE_START) % BLIND_INCREASE_INTERVAL === 0)) {
      if (this.onBlindUp) this.onBlindUp(ante);
    }

    this.conn.send({
      type: MSG.CARD_INFO,
      value: hostCard,
      remainingCards: this.remainingCards,
    });

    this.opponentCard = guestCard;
    if (this.onCardDealt) {
      this.onCardDealt(guestCard);
    }

    this.conn.send({
      type: MSG.CARDS_DEALT,
      pot: this.pot,
      ante: oppAnte,
      blindLevel: ante,
      yourChips: this.opponentChips,
      opponentChips: this.myChips,
      playedCards: this.playedCards,
      roundNumber: this.roundNumber,
    });

    this.state = STATE.BETTING;
    this.currentBet = Math.max(myAnte, oppAnte);
    this.myBetTotal = myAnte;
    this.opponentBetTotal = oppAnte;
    this._betActionsCount = 0;

    // 선공: 이전 라운드 패자 우선 (첫 라운드는 번갈아)
    let hostFirst;
    if (this._lastRoundLoser === null) {
      hostFirst = this.roundNumber % 2 === 1;
    } else {
      hostFirst = this._lastRoundLoser === 'host';
    }
    this.isMyTurn = hostFirst;

    this.conn.send({
      type: MSG.BET_TURN,
      isYourTurn: !hostFirst,
      raiseCount: 0,
    });

    this._updateUI();
  }

  _processBet(action, amount, fromHost) {
    if (!this.conn.isHost) return;

    if (action === 'fold') {
      const winner = fromHost ? 'guest' : 'host';
      this._endRound(winner);
      return;
    }

    if (action === 'call') {
      if (fromHost) {
        const diff = this.opponentBetTotal - this.myBetTotal;
        const actualDiff = Math.min(diff, this.myChips);
        this.myChips -= actualDiff;
        this.pot += actualDiff;
        this.myBetTotal += actualDiff;
        if (actualDiff < diff) {
          const excess = diff - actualDiff;
          this.opponentChips += excess;
          this.pot -= excess;
          this.opponentBetTotal -= excess;
        }
      } else {
        const diff = this.myBetTotal - this.opponentBetTotal;
        const actualDiff = Math.min(diff, this.opponentChips);
        this.opponentChips -= actualDiff;
        this.pot += actualDiff;
        this.opponentBetTotal += actualDiff;
        if (actualDiff < diff) {
          const excess = diff - actualDiff;
          this.myChips += excess;
          this.pot -= excess;
          this.myBetTotal -= excess;
        }
      }

      // 초과분 환급 포함 최신 상태를 Guest에 동기화
      this._syncState(fromHost);

      const betDiff = fromHost
        ? (this.opponentBetTotal - this.myBetTotal)
        : (this.myBetTotal - this.opponentBetTotal);
      if (betDiff === 0 && this._betActionsCount === 0) {
        this._betActionsCount++;
        this.isMyTurn = !fromHost;
        this.conn.send({
          type: MSG.BET_TURN,
          isYourTurn: fromHost,
          raiseCount: this._raiseCount,
        });
        this._updateUI();
        return;
      }

      this._endRound(null);
      return;
    }

    if (action === 'raise') {
      if (!Number.isFinite(amount) || amount <= 0) {
        this.isMyTurn = fromHost;
        if (!fromHost) {
          this.conn.send({ type: MSG.BET_TURN, isYourTurn: true, raiseCount: this._raiseCount });
        }
        this._updateUI();
        return;
      }

      if (fromHost) {
        const callDiff = this.opponentBetTotal - this.myBetTotal;
        const totalCost = callDiff + amount;
        const actualCost = Math.min(totalCost, this.myChips);
        this.myChips -= actualCost;
        this.pot += actualCost;
        this.myBetTotal += actualCost;
      } else {
        const callDiff = this.myBetTotal - this.opponentBetTotal;
        const totalCost = callDiff + amount;
        const actualCost = Math.min(totalCost, this.opponentChips);
        this.opponentChips -= actualCost;
        this.pot += actualCost;
        this.opponentBetTotal += actualCost;
      }

      this._raiseCount++;
      this._betActionsCount++;
      this._syncState(fromHost);

      this.isMyTurn = !fromHost;
      this.conn.send({
        type: MSG.BET_TURN,
        isYourTurn: fromHost,
        raiseCount: this._raiseCount,
      });

      this._updateUI();
    }
  }

  _syncState(actionFromHost) {
    this.conn.send({
      type: MSG.POT_UPDATE,
      pot: this.pot,
      yourChips: this.opponentChips,
      opponentChips: this.myChips,
      yourBet: this.opponentBetTotal,
      opponentBet: this.myBetTotal,
      raiseCount: this._raiseCount,
    });
  }

  _endRound(winnerByFold) {
    if (!this.conn.isHost) return;

    this.state = STATE.REVEAL;

    let winner;
    const hostCard = this._hostCards.host;
    const guestCard = this._hostCards.guest;
    let foldPenalty = 0;

    if (winnerByFold) {
      winner = winnerByFold;

      const folderCard = winnerByFold === 'guest' ? hostCard : guestCard;
      if (folderCard === 10) {
        // 폴드한 쪽의 현재 칩(팟 반환 전)으로 패널티 상한, 음수 방지
        const folderChips = winnerByFold === 'guest' ? this.myChips : this.opponentChips;
        foldPenalty = Math.min(FOLD_PENALTY_10, Math.max(0, folderChips));
        if (winnerByFold === 'guest') {
          this.myChips -= foldPenalty;
          this.opponentChips += foldPenalty;
        } else {
          this.opponentChips -= foldPenalty;
          this.myChips += foldPenalty;
        }
      }
    } else {
      if (hostCard > guestCard) winner = 'host';
      else if (guestCard > hostCard) winner = 'guest';
      else winner = 'draw';
    }

    // 칩 분배
    if (winner === 'host') {
      this.myChips += this.pot;
    } else if (winner === 'guest') {
      this.opponentChips += this.pot;
    } else {
      // 무승부: 균등 분배, 홀수 칩은 다음 라운드로 이월
      const half = Math.floor(this.pot / 2);
      this.myChips += half;
      this.opponentChips += half;
      this._carryPot = this.pot - half * 2;
    }

    // 패자 기록 (다음 라운드 선공 결정용)
    if (winner === 'host') {
      this._lastRoundLoser = 'guest';
    } else if (winner === 'guest') {
      this._lastRoundLoser = 'host';
    }

    // 카드 히스토리에 추가
    this.playedCards.push(hostCard, guestCard);

    // 라운드 히스토리 기록
    this._roundHistory.push({
      round: this.roundNumber,
      hostCard,
      guestCard,
      winner,
      pot: this.pot,
      foldPenalty,
    });

    const hostResult = {
      myCard: hostCard,
      opponentCard: guestCard,
      winner: winner === 'host' ? 'you' : winner === 'guest' ? 'opponent' : 'draw',
      potWon: this.pot,
      myBetTotal: this.myBetTotal,
      foldPenalty: foldPenalty,
      roundNumber: this.roundNumber,
    };
    this.myCard = hostCard;
    this.state = STATE.ROUND_END;
    if (this.onRoundResult) {
      this.onRoundResult(hostResult);
    }

    this.conn.send({
      type: MSG.ROUND_RESULT,
      yourCard: guestCard,
      opponentCard: hostCard,
      winner: winner === 'guest' ? 'you' : winner === 'host' ? 'opponent' : 'draw',
      potWon: this.pot,
      yourBetTotal: this.opponentBetTotal,
      yourChips: this.opponentChips,
      opponentChips: this.myChips,
      foldPenalty: foldPenalty,
      playedCards: this.playedCards,
      roundNumber: this.roundNumber,
    });

    this._saveSession();
    this._checkGameOver();
  }

  _checkGameOver() {
    if (!this.conn.isHost) return;

    if (this.myChips <= 0 || this.opponentChips <= 0) {
      this._isGameOver = true;
      Game.clearSession();

      const winner = this.myChips > 0 ? 'host' : 'guest';

      setTimeout(() => {
        this.state = STATE.GAME_OVER;

        if (this.onGameOver) {
          this.onGameOver({
            winner: winner === 'host' ? 'you' : 'opponent',
            yourChips: this.myChips,
            opponentChips: this.opponentChips,
          });
        }

        this.conn.send({
          type: MSG.GAME_OVER,
          winner: winner === 'guest' ? 'you' : 'opponent',
          yourChips: this.opponentChips,
          opponentChips: this.myChips,
        });
      }, 2000);
    }
  }

  // ========== 공통 액션 ==========

  doBet(action, amount = 0) {
    if (!this.isMyTurn || this.state !== STATE.BETTING) return;

    this.isMyTurn = false;

    if (this.conn.isHost) {
      this._processBet(action, amount, true);
    } else {
      this.conn.send({
        type: MSG.BET_ACTION,
        action: action,
        amount: amount,
      });
    }

    this._updateUI();
  }

  _handleOpponentBet(data) {
    if (this.conn.isHost) {
      // Guest 입력 검증: 허용된 액션만 처리
      const action = data.action;
      if (action !== 'call' && action !== 'fold' && action !== 'raise') return;
      let amount = Number(data.amount) || 0;
      // 악의적 값 방어: 음수, 비정상 값, 상대 칩 초과 차단
      if (action === 'raise') {
        if (!Number.isFinite(amount) || amount <= 0) return;
        amount = Math.min(amount, this.opponentChips);
      }
      this._processBet(action, amount, false);
    }
  }

  requestNextRound() {
    if (this._isGameOver) return;
    if (this._nextRoundRequested) return;
    this._nextRoundRequested = true;
    this.conn.send({ type: MSG.NEXT_ROUND });
    this._resetRound();
    if (this.conn.isHost) {
      setTimeout(() => {
        this._nextRoundRequested = false;
        this._startNewRound();
      }, 500);
    } else {
      this._nextRoundRequested = false;
    }
  }

  requestNewGame() {
    if (this._newGameRequested) return;
    this._newGameRequested = true;
    this.conn.send({ type: MSG.NEW_GAME });
    this._resetGame();
    if (this.conn.isHost) {
      setTimeout(() => {
        this._newGameRequested = false;
        this._startNewRound();
      }, 1000);
    } else {
      this._newGameRequested = false;
    }
  }

  _getAnte() {
    // 라운드 1-2: 앤티 1, 라운드 3-4: 앤티 2, 라운드 5-6: 앤티 4, ...
    if (this.roundNumber < BLIND_INCREASE_START) return 1;
    const level = Math.floor((this.roundNumber - BLIND_INCREASE_START) / BLIND_INCREASE_INTERVAL);
    return Math.pow(2, level + 1);
  }

  _resetRound() {
    this.state = STATE.WAITING;
    this.myCard = null;
    this.opponentCard = null;
    this.pot = 0;
    this.currentBet = 0;
    this.myBetTotal = 0;
    this.opponentBetTotal = 0;
    this.isMyTurn = false;
    this._betActionsCount = 0;
    this._raiseCount = 0;
    this._hostCards = { host: null, guest: null };
    this._updateUI();
  }

  _resetGame() {
    this._resetRound();
    this.myChips = STARTING_CHIPS;
    this.opponentChips = STARTING_CHIPS;
    this.roundNumber = 0;
    this.ante = 1;
    this._isGameOver = false;
    this._lastRoundLoser = null;
    this._carryPot = 0;
    this._lastBlindLevel = 1;
    this._roundHistory = [];
    this._deck = [];
    this.remainingCards = 0;
    this.playedCards = [];
    this._nextRoundRequested = false;
    this._newGameRequested = false;
    Game.clearSession();
    this._updateUI();
  }

  _updateUI() {
    if (this.onStateChange) {
      this.onStateChange({
        state: this.state,
        myChips: this.myChips,
        opponentChips: this.opponentChips,
        pot: this.pot,
        isMyTurn: this.isMyTurn,
        myBetTotal: this.myBetTotal,
        opponentBetTotal: this.opponentBetTotal,
        myName: this.myName,
        opponentName: this.opponentName,
        roundNumber: this.roundNumber,
        remainingCards: this.remainingCards,
        raiseCount: this._raiseCount,
        maxRaises: MAX_RAISES_PER_ROUND,
        playedCards: this.playedCards,
        carryPot: this._carryPot,
        roundHistory: this._roundHistory,
        ante: this.ante || 1,
      });
    }
  }
}
