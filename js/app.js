/**
 * 인디언 포커 - 메인 앱 (UI 바인딩 & 화면 전환)
 */
(function () {
  const connMgr = new ConnectionManager();
  let game = null;
  let qrScanner = null;
  let betAmount = 1;

  // ========== DOM 요소 ==========
  const $ = (id) => document.getElementById(id);

  const screens = {
    lobby: $('screen-lobby'),
    hostWaiting: $('screen-host-waiting'),
    guestJoin: $('screen-guest-join'),
    game: $('screen-game'),
  };

  let savedSession = null; // 재연결용 세션 정보

  const ui = {
    nicknameInput: $('nickname-input'),
    btnCreateRoom: $('btn-create-room'),
    btnJoinRoom: $('btn-join-room'),
    // Resume
    resumeSection: $('resume-section'),
    resumeDetail: $('resume-detail'),
    btnResume: $('btn-resume'),
    btnDiscardSession: $('btn-discard-session'),
    // Host waiting
    hostPeerId: $('host-peer-id'),
    qrContainer: $('qr-code-container'),
    hostStatus: $('host-status'),
    btnBackHost: $('btn-back-host'),
    // Guest join
    manualPeerId: $('manual-peer-id'),
    btnManualConnect: $('btn-manual-connect'),
    guestStatus: $('guest-status'),
    btnBackGuest: $('btn-back-guest'),
    // Game
    opponentName: $('opponent-name'),
    opponentChips: $('opponent-chips'),
    opponentCard: $('opponent-card'),
    opponentCardValue: $('opponent-card-value'),
    myName: $('my-name'),
    myChips: $('my-chips'),
    potAmount: $('pot-amount'),
    gameStatus: $('game-status'),
    bettingControls: $('betting-controls'),
    betAmountDisplay: $('bet-amount'),
    btnBetMinus: $('btn-bet-minus'),
    btnBetPlus: $('btn-bet-plus'),
    btnCall: $('btn-call'),
    btnRaise: $('btn-raise'),
    btnFold: $('btn-fold'),
    // Result
    roundResult: $('round-result'),
    resultTitle: $('result-title'),
    resultMyName: $('result-my-name'),
    resultMyCard: $('result-my-card'),
    resultOpponentName: $('result-opponent-name'),
    resultOpponentCard: $('result-opponent-card'),
    resultMessage: $('result-message'),
    btnNextRound: $('btn-next-round'),
    // Game Over
    gameOver: $('game-over'),
    gameOverTitle: $('game-over-title'),
    gameOverMessage: $('game-over-message'),
    btnNewGame: $('btn-new-game'),
    // Disconnect
    disconnectOverlay: $('disconnect-overlay'),
    btnBackLobby: $('btn-back-lobby'),
    // Room Info
    roomInfoBadge: $('room-info-badge'),
    roomInfoQr: $('room-info-qr'),
    roomInfoId: $('room-info-id'),
    roomInfoOverlay: $('room-info-overlay'),
    roomInfoExpandedQr: $('room-info-expanded-qr'),
    roomInfoExpandedId: $('room-info-expanded-id'),
    btnCloseRoomInfo: $('btn-close-room-info'),
  };

  // ========== 화면 전환 ==========
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ========== 닉네임 ==========
  function getNickname() {
    return ui.nicknameInput.value.trim() || '플레이어';
  }

  // ========== 세션 복원 체크 ==========
  function checkSavedSession() {
    savedSession = Game.loadSession();
    if (savedSession) {
      ui.resumeDetail.textContent = `${savedSession.isHost ? '방장' : '참가자'} · 칩: 나 ${savedSession.myChips} / 상대 ${savedSession.opponentChips} · 라운드 ${savedSession.roundNumber}`;
      ui.resumeSection.style.display = 'block';
      if (savedSession.myName) {
        ui.nicknameInput.value = savedSession.myName;
      }
    } else {
      ui.resumeSection.style.display = 'none';
    }
  }

  // 페이지 로드 시 세션 체크
  checkSavedSession();

  // 이어하기 버튼
  ui.btnResume.addEventListener('click', async () => {
    if (!savedSession) return;

    try {
      ui.btnResume.disabled = true;
      ui.btnResume.textContent = '연결 중...';

      if (savedSession.isHost) {
        // Host: 같은 ID로 방 재생성
        const peerId = await connMgr.createHost(savedSession.hostId);
        ui.hostPeerId.textContent = peerId;

        // QR 코드 생성
        ui.qrContainer.innerHTML = '';
        const qr = qrcode(0, 'M');
        qr.addData(peerId);
        qr.make();
        const qrImg = document.createElement('div');
        qrImg.innerHTML = qr.createImgTag(5, 10);
        ui.qrContainer.appendChild(qrImg.firstChild);

        connMgr.onConnected = () => {
          ui.hostStatus.textContent = '✅ 상대방 재연결됨!';
          ui.hostStatus.style.color = '#2ecc71';
          startGame(savedSession);
        };

        connMgr.onDisconnected = handleDisconnect;

        ui.hostStatus.textContent = '이전 방 ID로 대기 중... 상대방이 같은 ID로 연결하세요';
        ui.hostStatus.style.color = '#f39c12';
        showScreen('hostWaiting');
      } else {
        // Guest: 저장된 Host ID로 바로 연결 시도
        connMgr.onConnected = () => {
          startGame(savedSession);
        };
        connMgr.onDisconnected = handleDisconnect;

        await connMgr.joinHost(savedSession.hostId);
      }
    } catch (err) {
      alert('재연결 실패: ' + err.message);
    } finally {
      ui.btnResume.disabled = false;
      ui.btnResume.textContent = '이어하기';
    }
  });

  // 세션 삭제 버튼
  ui.btnDiscardSession.addEventListener('click', () => {
    Game.clearSession();
    savedSession = null;
    ui.resumeSection.style.display = 'none';
  });

  // ========== 로비 이벤트 ==========
  ui.btnCreateRoom.addEventListener('click', async () => {
    try {
      ui.btnCreateRoom.disabled = true;
      ui.btnCreateRoom.textContent = '생성 중...';

      const peerId = await connMgr.createHost();

      ui.hostPeerId.textContent = peerId;

      // QR 코드 생성
      ui.qrContainer.innerHTML = '';
      const qr = qrcode(0, 'M');
      qr.addData(peerId);
      qr.make();
      const qrImg = document.createElement('div');
      qrImg.innerHTML = qr.createImgTag(5, 10);
      ui.qrContainer.appendChild(qrImg.firstChild);

      // 연결 콜백 설정
      connMgr.onConnected = () => {
        ui.hostStatus.textContent = '✅ 상대방 연결됨!';
        ui.hostStatus.style.color = '#2ecc71';
        startGame();
      };

      connMgr.onDisconnected = handleDisconnect;

      showScreen('hostWaiting');
    } catch (err) {
      alert('방 생성 실패: ' + err.message);
    } finally {
      ui.btnCreateRoom.disabled = false;
      ui.btnCreateRoom.textContent = '방 만들기';
    }
  });

  ui.btnJoinRoom.addEventListener('click', () => {
    // 이전 방 ID 복원
    const lastRoomId = localStorage.getItem('lastRoomId');
    if (lastRoomId) {
      ui.manualPeerId.value = lastRoomId;
      $('btn-clear-peer-id').style.display = 'flex';
    } else {
      ui.manualPeerId.value = '';
      $('btn-clear-peer-id').style.display = 'none';
    }
    showScreen('guestJoin');
    startQrScanner();
  });

  // ========== QR 스캐너 ==========
  async function startQrScanner() {
    await stopQrScanner();

    qrScanner = new Html5Qrcode('qr-reader');

    qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 200, height: 200 } },
      (decodedText) => {
        // QR 스캔 성공
        stopQrScanner();
        connectToHost(decodedText);
      },
      () => {} // 스캔 실패 (무시)
    ).catch((err) => {
      console.warn('카메라 시작 실패:', err);
      // 카메라 없으면 수동 입력만 사용
    });
  }

  async function stopQrScanner() {
    if (!qrScanner) return;
    const scanner = qrScanner;
    qrScanner = null;
    try {
      await scanner.stop();
    } catch (e) {
      // 스캐너가 시작되지 않은 상태에서 stop 호출 시 무시
    }
    try {
      scanner.clear();
    } catch (e) {
      // DOM 정리 실패 시 무시
    }
  }

  // ========== Guest 연결 ==========
  async function connectToHost(hostId) {
    const trimmedId = hostId.trim();
    try {
      ui.guestStatus.textContent = '연결 중...';
      ui.guestStatus.style.color = '#f39c12';

      connMgr.onConnected = () => {
        // 연결 성공 시 방 ID 저장
        localStorage.setItem('lastRoomId', trimmedId);
        ui.guestStatus.textContent = '✅ 연결 성공!';
        ui.guestStatus.style.color = '#2ecc71';
        startGame();
      };

      connMgr.onDisconnected = handleDisconnect;

      await connMgr.joinHost(trimmedId);
    } catch (err) {
      ui.guestStatus.textContent = '❌ 연결 실패: ' + err.message;
      ui.guestStatus.style.color = '#e74c3c';
    }
  }

  ui.btnManualConnect.addEventListener('click', () => {
    const hostId = ui.manualPeerId.value.trim();
    if (!hostId) return;
    stopQrScanner();
    connectToHost(hostId);
  });

  // X 버튼: 방 ID 초기화
  $('btn-clear-peer-id').addEventListener('click', () => {
    ui.manualPeerId.value = '';
    $('btn-clear-peer-id').style.display = 'none';
    localStorage.removeItem('lastRoomId');
    ui.manualPeerId.focus();
  });

  // input 변경 시 X 버튼 표시/숨김
  ui.manualPeerId.addEventListener('input', () => {
    $('btn-clear-peer-id').style.display = ui.manualPeerId.value ? 'flex' : 'none';
  });

  // ========== 뒤로가기 ==========
  ui.btnBackHost.addEventListener('click', () => {
    connMgr.destroy();
    showScreen('lobby');
    checkSavedSession();
  });

  ui.btnBackGuest.addEventListener('click', () => {
    stopQrScanner();
    connMgr.destroy();
    showScreen('lobby');
    checkSavedSession();
  });

  // ========== 방 정보 배지 ==========
  function showRoomInfoBadge() {
    // Host의 Peer ID (방 ID) 가져오기
    const roomId = connMgr.isHost
      ? connMgr.peerId
      : (connMgr.conn ? connMgr.conn.peer : null);

    if (!roomId) {
      ui.roomInfoBadge.style.display = 'none';
      return;
    }

    // 미니 QR 생성
    ui.roomInfoQr.innerHTML = '';
    const miniQr = qrcode(0, 'M');
    miniQr.addData(roomId);
    miniQr.make();
    const miniImg = document.createElement('div');
    miniImg.innerHTML = miniQr.createImgTag(1, 0);
    const imgEl = miniImg.querySelector('img');
    if (imgEl) {
      imgEl.style.width = '40px';
      imgEl.style.height = '40px';
      imgEl.style.borderRadius = '4px';
    }
    ui.roomInfoQr.appendChild(imgEl || miniImg.firstChild);

    // 방 ID 표시
    ui.roomInfoId.textContent = roomId;

    // 확대 오버레이용 QR
    ui.roomInfoExpandedQr.innerHTML = '';
    const bigQr = qrcode(0, 'M');
    bigQr.addData(roomId);
    bigQr.make();
    const bigImg = document.createElement('div');
    bigImg.innerHTML = bigQr.createImgTag(5, 10);
    ui.roomInfoExpandedQr.appendChild(bigImg.firstChild);

    ui.roomInfoExpandedId.textContent = roomId;

    ui.roomInfoBadge.style.display = 'flex';
  }

  // 배지 클릭 → 확대 오버레이
  ui.roomInfoBadge.addEventListener('click', () => {
    ui.roomInfoOverlay.style.display = 'flex';
  });

  ui.btnCloseRoomInfo.addEventListener('click', () => {
    ui.roomInfoOverlay.style.display = 'none';
  });

  // 오버레이 배경 클릭으로도 닫기
  ui.roomInfoOverlay.addEventListener('click', (e) => {
    if (e.target === ui.roomInfoOverlay) {
      ui.roomInfoOverlay.style.display = 'none';
    }
  });

  // ========== 게임 시작 ==========
  function startGame(resumeSession) {
    stopQrScanner();

    game = new Game(connMgr);

    // UI 콜백 설정
    game.onStateChange = updateGameUI;
    game.onCardDealt = onCardDealt;
    game.onRoundResult = onRoundResult;
    game.onGameOver = onGameOver;
    game.onDeckShuffled = onDeckShuffled;

    showScreen('game');
    showRoomInfoBadge();
    game.start(getNickname(), resumeSession || null);
  }

  // ========== Game UI 갱신 ==========
  function updateGameUI(state) {
    ui.myName.textContent = state.myName || '나';
    ui.opponentName.textContent = state.opponentName || '상대방';
    ui.myChips.textContent = `💰 ${state.myChips}`;
    ui.opponentChips.textContent = `💰 ${state.opponentChips}`;
    ui.potAmount.textContent = state.pot;
    $('remaining-cards').textContent = state.remainingCards !== undefined ? state.remainingCards : '-';

    // 상대가 다음 라운드를 시작했으면 결과 화면 자동 닫기
    if (state.state === STATE.BETTING || state.state === STATE.DEALING || state.state === STATE.WAITING) {
      ui.roundResult.style.display = 'none';
    }

    // 게임 상태 텍스트
    if (state.state === STATE.BETTING) {
      if (state.isMyTurn) {
        ui.gameStatus.textContent = `라운드 ${state.roundNumber} - 당신의 차례`;
        ui.gameStatus.style.color = '#2ecc71';
      } else {
        ui.gameStatus.textContent = `라운드 ${state.roundNumber} - 상대방 차례`;
        ui.gameStatus.style.color = '#f39c12';
      }
    } else if (state.state === STATE.DEALING) {
      ui.gameStatus.textContent = '카드 분배 중...';
      ui.gameStatus.style.color = '#a0a0b0';
    } else if (state.state === STATE.WAITING) {
      ui.gameStatus.textContent = '게임 준비 중...';
      ui.gameStatus.style.color = '#a0a0b0';
    }

    // 베팅 컨트롤 표시/숨김
    const showBetting = state.state === STATE.BETTING && state.isMyTurn;
    ui.bettingControls.style.display = showBetting ? 'block' : 'none';

    if (showBetting) {
      const maxRaise = state.myChips - (Math.max(0, state.opponentBetTotal - state.myBetTotal));
      betAmount = Math.min(betAmount, maxRaise);
      betAmount = Math.max(1, betAmount);
      ui.betAmountDisplay.textContent = betAmount;

      // 콜 금액 표시
      const callDiff = state.opponentBetTotal - state.myBetTotal;
      if (callDiff > 0) {
        ui.btnCall.textContent = `콜 (${callDiff})`;
        ui.btnCall.disabled = state.myChips < callDiff;
      } else {
        ui.btnCall.textContent = '체크';
        ui.btnCall.disabled = false;
      }

      // 레이즈 가능 여부
      ui.btnRaise.disabled = maxRaise < 1;
    }
  }

  function onCardDealt(cardValue) {
    // 상대방 카드가 내 화면에 보임
    ui.opponentCardValue.textContent = cardValue;
    ui.opponentCard.classList.add('revealed', 'card-deal-animation');

    setTimeout(() => {
      ui.opponentCard.classList.remove('card-deal-animation');
    }, 500);
  }

  function onRoundResult(result) {
    ui.bettingControls.style.display = 'none';

    ui.resultMyName.textContent = game.myName || '나';
    ui.resultOpponentName.textContent = game.opponentName || '상대방';
    ui.resultMyCard.textContent = result.myCard;
    ui.resultOpponentCard.textContent = result.opponentCard;

    const penaltyText = result.penalty > 0 ? `\n⚠️ 10 카드 폴드 패널티: ${result.penalty}칩 추가!` : '';

    if (result.winner === 'you') {
      ui.resultTitle.textContent = '🎉 승리!';
      ui.resultMessage.textContent = `+${result.netGain} 칩 획득${penaltyText}`;
      ui.resultMessage.style.color = '#2ecc71';
    } else if (result.winner === 'opponent') {
      ui.resultTitle.textContent = '😢 패배';
      ui.resultMessage.textContent = `-${Math.abs(result.netGain)} 칩 손실${penaltyText}`;
      ui.resultMessage.style.color = '#e74c3c';
    } else {
      ui.resultTitle.textContent = '🤝 무승부';
      ui.resultMessage.textContent = '베팅이 반환됩니다';
      ui.resultMessage.style.color = '#f39c12';
    }

    ui.roundResult.style.display = 'flex';
  }

  function onDeckShuffled(deckSize) {
    // 덱 리셔플 시 잠시 표시
    const el = $('remaining-cards');
    el.textContent = deckSize;
    el.style.color = '#e94560';
    setTimeout(() => { el.style.color = ''; }, 1500);

    ui.gameStatus.textContent = '🔄 덱이 리셔플되었습니다!';
    setTimeout(() => { ui.gameStatus.textContent = ''; }, 2000);
  }

  function onGameOver(result) {
    ui.roundResult.style.display = 'none';

    if (result.winner === 'you') {
      ui.gameOverTitle.textContent = '🏆 승리!';
      ui.gameOverMessage.textContent = '상대방의 칩이 모두 소진되었습니다.';
    } else {
      ui.gameOverTitle.textContent = '💀 패배...';
      ui.gameOverMessage.textContent = '당신의 칩이 모두 소진되었습니다.';
    }

    ui.gameOver.style.display = 'flex';
  }

  // ========== 베팅 컨트롤 ==========
  ui.btnBetMinus.addEventListener('click', () => {
    if (betAmount > 1) {
      betAmount--;
      ui.betAmountDisplay.textContent = betAmount;
    }
  });

  ui.btnBetPlus.addEventListener('click', () => {
    if (!game) return;
    // 콜 비용을 제외한 레이즈 가능 최대치
    const callCost = Math.max(0, game.opponentBetTotal - game.myBetTotal);
    const maxRaise = game.myChips - callCost;
    if (betAmount < maxRaise) {
      betAmount++;
      ui.betAmountDisplay.textContent = betAmount;
    }
  });

  ui.btnCall.addEventListener('click', () => {
    if (game) game.doBet('call');
  });

  ui.btnRaise.addEventListener('click', () => {
    if (game) game.doBet('raise', betAmount);
  });

  ui.btnFold.addEventListener('click', () => {
    if (game) game.doBet('fold');
  });

  // ========== 라운드/게임 흐름 ==========
  ui.btnNextRound.addEventListener('click', () => {
    ui.roundResult.style.display = 'none';
    // 카드 리셋
    ui.opponentCardValue.textContent = '?';
    ui.opponentCard.classList.remove('revealed');
    if (game) game.requestNextRound();
  });

  ui.btnNewGame.addEventListener('click', () => {
    ui.gameOver.style.display = 'none';
    ui.roundResult.style.display = 'none';
    ui.opponentCardValue.textContent = '?';
    ui.opponentCard.classList.remove('revealed');
    if (game) game.requestNewGame();
  });

  // ========== 연결 끊김 ==========
  function handleDisconnect() {
    ui.disconnectOverlay.style.display = 'flex';
  }

  ui.btnBackLobby.addEventListener('click', () => {
    ui.disconnectOverlay.style.display = 'none';
    connMgr.destroy();
    game = null;
    showScreen('lobby');
    checkSavedSession();
  });

})();
