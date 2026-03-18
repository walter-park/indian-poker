/**
 * 인디언 포커 게임 로직
 * Host가 게임 상태를 관리하고, 양쪽이 동기화
 */

// 메시지 타입
const MSG = {
  // 연결 & 셋업
  PLAYER_INFO: 'PLAYER_INFO',       // 닉네임 교환
  GAME_START: 'GAME_START',         // 게임 시작 알림

  // 카드 분배
  CARD_INFO: 'CARD_INFO',           // 상대방에게 보여줄 카드 번호
  CARDS_DEALT: 'CARDS_DEALT',       // 카드 분배 완료 (베팅 시작 신호)

  // 베팅
  BET_TURN: 'BET_TURN',             // 베팅 차례 알림
  BET_ACTION: 'BET_ACTION',         // 베팅 액션 (call, raise, fold)
  POT_UPDATE: 'POT_UPDATE',         // 팟 금액 업데이트

  // 결과
  REVEAL_REQUEST: 'REVEAL_REQUEST', // 카드 공개 요청
  REVEAL_CARD: 'REVEAL_CARD',       // 실제 카드 값 공개
  ROUND_RESULT: 'ROUND_RESULT',     // 라운드 결과 (Host가 결정)

  // 게임 흐름
  NEXT_ROUND: 'NEXT_ROUND',         // 다음 라운드
  GAME_OVER: 'GAME_OVER',           // 게임 종료
  NEW_GAME: 'NEW_GAME',             // 새 게임
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

class Game {
  constructor(connectionManager) {
    this.conn = connectionManager;
    this.state = STATE.WAITING;

    // 플레이어 정보
    this.myName = '';
    this.opponentName = '';
    this.myChips = 10;
    this.opponentChips = 10;

    // 라운드 정보
    this.myCard = null;           // 내 카드 (내가 모름, Host만 알고 있음)
    this.opponentCard = null;     // 상대 카드 (내 화면에 보임)
    this.pot = 0;
    this.currentBet = 0;          // 현재 라운드의 기본 베팅
    this.myBetTotal = 0;          // 이번 라운드 내 총 베팅
    this.opponentBetTotal = 0;    // 이번 라운드 상대 총 베팅
    this.isMyTurn = false;
    this.roundNumber = 0;

    // Host 전용: 양쪽 카드 보관
    this._hostCards = { host: null, guest: null };

    // UI 콜백
    this.onStateChange = null;
    this.onCardDealt = null;
    this.onBetUpdate = null;
    this.onRoundResult = null;
    this.onGameOver = null;

    // 메시지 핸들러 등록
    this.conn.onMessage = (data) => this._handleMessage(data);
  }

  /**
   * 게임 시작 (연결 후 호출)
   */
  start(nickname) {
    this.myName = nickname;

    // 닉네임 교환
    this.conn.send({
      type: MSG.PLAYER_INFO,
      name: nickname,
    });

    // Host는 잠시 후 게임 시작
    if (this.conn.isHost) {
      setTimeout(() => this._startNewRound(), 1500);
    }
  }

  /**
   * 메시지 수신 처리
   */
  _handleMessage(data) {
    switch (data.type) {
      case MSG.PLAYER_INFO:
        this.opponentName = data.name;
        this._updateUI();
        break;

      case MSG.CARD_INFO:
        // 상대방의 카드가 내 화면에 표시됨
        this.opponentCard = data.value;
        if (this.onCardDealt) {
          this.onCardDealt(data.value);
        }
        break;

      case MSG.CARDS_DEALT:
        this.state = STATE.BETTING;
        this.pot = data.pot;
        this.currentBet = data.ante;
        this.myBetTotal = data.ante;
        this.opponentBetTotal = data.ante;
        this.myChips = data.yourChips;
        this.opponentChips = data.opponentChips;
        this._updateUI();
        break;

      case MSG.BET_TURN:
        this.isMyTurn = data.isYourTurn;
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
        this._updateUI();
        break;

      case MSG.REVEAL_CARD:
        // 라운드 종료 시 내 카드를 알게 됨
        this.myCard = data.value;
        break;

      case MSG.ROUND_RESULT:
        this.state = STATE.ROUND_END;
        this.myCard = data.yourCard;
        this.opponentCard = data.opponentCard;
        this.myChips = data.yourChips;
        this.opponentChips = data.opponentChips;
        if (this.onRoundResult) {
          this.onRoundResult({
            myCard: data.yourCard,
            opponentCard: data.opponentCard,
            winner: data.winner,  // 'you', 'opponent', 'draw'
            potWon: data.potWon,
          });
        }
        break;

      case MSG.NEXT_ROUND:
        this._resetRound();
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
        this._resetGame();
        if (this.conn.isHost) {
          setTimeout(() => this._startNewRound(), 1000);
        }
        break;
    }
  }

  // ========== Host 전용 로직 ==========

  /**
   * Host: 새 라운드 시작
   */
  _startNewRound() {
    if (!this.conn.isHost) return;

    this.roundNumber++;
    this.state = STATE.DEALING;

    // 카드 2장 뽑기 (1~10)
    const hostCard = Math.floor(Math.random() * 10) + 1;
    const guestCard = Math.floor(Math.random() * 10) + 1;
    this._hostCards = { host: hostCard, guest: guestCard };

    const ante = 1; // 앤티

    // 양쪽 칩 차감 (앤티)
    this.myChips -= ante;
    this.opponentChips -= ante;
    this.pot = ante * 2;

    // Guest에게 Host의 카드를 보여줌 (Guest 화면에 표시)
    this.conn.send({
      type: MSG.CARD_INFO,
      value: hostCard,
    });

    // Host 자신의 화면에는 Guest 카드 표시
    this.opponentCard = guestCard;
    if (this.onCardDealt) {
      this.onCardDealt(guestCard);
    }

    // 양쪽에 분배 완료 알림
    // Guest에게 보내는 정보 (Guest 관점)
    this.conn.send({
      type: MSG.CARDS_DEALT,
      pot: this.pot,
      ante: ante,
      yourChips: this.opponentChips,      // Guest의 칩
      opponentChips: this.myChips,         // Host의 칩 (Guest 관점에서의 상대)
    });

    // Host 자신 업데이트
    this.state = STATE.BETTING;
    this.currentBet = ante;
    this.myBetTotal = ante;
    this.opponentBetTotal = ante;

    this._updateUI();

    // 선공: 라운드 번호에 따라 번갈아가며
    const hostFirst = this.roundNumber % 2 === 1;
    this.isMyTurn = hostFirst;

    // Guest에게 턴 알림
    this.conn.send({
      type: MSG.BET_TURN,
      isYourTurn: !hostFirst,
    });

    this._updateUI();
  }

  /**
   * Host: 베팅 액션 처리 (양쪽 공통)
   */
  _processBet(action, amount, fromHost) {
    if (!this.conn.isHost) return;

    if (action === 'fold') {
      // 폴드한 쪽이 짐
      const winner = fromHost ? 'guest' : 'host';
      this._endRound(winner);
      return;
    }

    if (action === 'call') {
      // 콜: 상대방 베팅에 맞춤
      if (fromHost) {
        const diff = this.opponentBetTotal - this.myBetTotal;
        this.myChips -= diff;
        this.pot += diff;
        this.myBetTotal = this.opponentBetTotal;
      } else {
        const diff = this.myBetTotal - this.opponentBetTotal;
        this.opponentChips -= diff;
        this.pot += diff;
        this.opponentBetTotal = this.myBetTotal;
      }
      // 콜이면 라운드 종료 (첫 턴 체크/콜 제외)
      this._endRound(null); // null = 카드 비교
      return;
    }

    if (action === 'raise') {
      if (fromHost) {
        // Host의 레이즈
        const callDiff = this.opponentBetTotal - this.myBetTotal;
        const totalCost = callDiff + amount;
        this.myChips -= totalCost;
        this.pot += totalCost;
        this.myBetTotal = this.opponentBetTotal + amount;
      } else {
        // Guest의 레이즈
        const callDiff = this.myBetTotal - this.opponentBetTotal;
        const totalCost = callDiff + amount;
        this.opponentChips -= totalCost;
        this.pot += totalCost;
        this.opponentBetTotal = this.myBetTotal + amount;
      }

      // 상대에게 턴 넘기기
      this._syncState(fromHost);

      // 턴 전환
      this.isMyTurn = !fromHost;
      this.conn.send({
        type: MSG.BET_TURN,
        isYourTurn: fromHost,
      });

      this._updateUI();
    }
  }

  /**
   * Host: 상태 동기화 전송
   */
  _syncState(actionFromHost) {
    // Guest에게 동기화 (Guest 관점으로 변환)
    this.conn.send({
      type: MSG.POT_UPDATE,
      pot: this.pot,
      yourChips: this.opponentChips,
      opponentChips: this.myChips,
      yourBet: this.opponentBetTotal,
      opponentBet: this.myBetTotal,
    });
  }

  /**
   * Host: 라운드 종료 처리
   */
  _endRound(winnerByFold) {
    if (!this.conn.isHost) return;

    this.state = STATE.REVEAL;

    let winner; // 'host', 'guest', 'draw'
    const hostCard = this._hostCards.host;
    const guestCard = this._hostCards.guest;

    if (winnerByFold) {
      winner = winnerByFold;
    } else {
      // 카드 비교
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
      // 무승부: 반반
      this.myChips += Math.floor(this.pot / 2);
      this.opponentChips += Math.ceil(this.pot / 2);
    }

    // Host에게 결과 표시
    const hostResult = {
      myCard: hostCard,
      opponentCard: guestCard,
      winner: winner === 'host' ? 'you' : winner === 'guest' ? 'opponent' : 'draw',
      potWon: this.pot,
    };
    this.myCard = hostCard;
    this.state = STATE.ROUND_END;
    if (this.onRoundResult) {
      this.onRoundResult(hostResult);
    }

    // Guest에게 결과 전송 (Guest 관점으로 변환)
    this.conn.send({
      type: MSG.ROUND_RESULT,
      yourCard: guestCard,
      opponentCard: hostCard,
      winner: winner === 'guest' ? 'you' : winner === 'host' ? 'opponent' : 'draw',
      potWon: this.pot,
      yourChips: this.opponentChips,
      opponentChips: this.myChips,
    });

    // 게임 오버 체크
    this._checkGameOver();
  }

  /**
   * Host: 게임 오버 확인
   */
  _checkGameOver() {
    if (!this.conn.isHost) return;

    if (this.myChips <= 0 || this.opponentChips <= 0) {
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
      }, 3000);
    }
  }

  // ========== 공통 액션 ==========

  /**
   * 베팅 액션 수행
   */
  doBet(action, amount = 0) {
    if (!this.isMyTurn || this.state !== STATE.BETTING) return;

    this.isMyTurn = false;

    if (this.conn.isHost) {
      // Host는 직접 처리
      this._processBet(action, amount, true);
    } else {
      // Guest는 Host에게 전송
      this.conn.send({
        type: MSG.BET_ACTION,
        action: action,
        amount: amount,
      });
    }

    this._updateUI();
  }

  /**
   * 상대방 베팅 처리 (Host가 수신)
   */
  _handleOpponentBet(data) {
    if (this.conn.isHost) {
      // Host: Guest의 베팅 처리
      this._processBet(data.action, data.amount, false);
    }
  }

  /**
   * 다음 라운드 요청
   */
  requestNextRound() {
    if (this.conn.isHost) {
      this.conn.send({ type: MSG.NEXT_ROUND });
      this._resetRound();
      setTimeout(() => this._startNewRound(), 500);
    } else {
      this.conn.send({ type: MSG.NEXT_ROUND });
    }
  }

  /**
   * 새 게임 요청
   */
  requestNewGame() {
    this.conn.send({ type: MSG.NEW_GAME });
    this._resetGame();
    if (this.conn.isHost) {
      setTimeout(() => this._startNewRound(), 1000);
    }
  }

  /**
   * 라운드 초기화
   */
  _resetRound() {
    this.myCard = null;
    this.opponentCard = null;
    this.pot = 0;
    this.currentBet = 0;
    this.myBetTotal = 0;
    this.opponentBetTotal = 0;
    this.isMyTurn = false;
    this._hostCards = { host: null, guest: null };
    this._updateUI();
  }

  /**
   * 게임 전체 초기화
   */
  _resetGame() {
    this._resetRound();
    this.myChips = 10;
    this.opponentChips = 10;
    this.roundNumber = 0;
    this.state = STATE.WAITING;
    this._updateUI();
  }

  /**
   * UI 갱신 트리거
   */
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
      });
    }
  }
}
