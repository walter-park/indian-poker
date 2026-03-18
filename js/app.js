/**
 * 인디언 포커 - 메인 앱 (UI 바인딩 & 화면 전환)
 */

// ========== 게임 설정 (사운드/진동 토글) ==========
const GameSettings = {
  _key: 'indian-poker-settings',
  _data: null,
  load() {
    if (this._data) return this._data;
    try {
      this._data = JSON.parse(localStorage.getItem(this._key)) || {};
    } catch (e) {
      this._data = {};
    }
    return this._data;
  },
  save() {
    try { localStorage.setItem(this._key, JSON.stringify(this._data)); } catch (e) {}
  },
  get soundEnabled() { return this.load().sound !== false; },
  set soundEnabled(v) { this.load().sound = v; this.save(); },
  get vibrationEnabled() { return this.load().vibration !== false; },
  set vibrationEnabled(v) { this.load().vibration = v; this.save(); },
  get tutorialSeen() { return this.load().tutorialSeen === true; },
  set tutorialSeen(v) { this.load().tutorialSeen = v; this.save(); },
};

// ========== 게임 통계 ==========
const GameStats = {
  _key: 'indian-poker-stats',
  _data: null,
  load() {
    if (this._data) return this._data;
    try {
      this._data = JSON.parse(localStorage.getItem(this._key)) || this._default();
    } catch (e) {
      this._data = this._default();
    }
    return this._data;
  },
  _default() {
    return { gamesPlayed: 0, gamesWon: 0, totalRounds: 0, biggestPot: 0, currentStreak: 0, bestStreak: 0 };
  },
  save() {
    try { localStorage.setItem(this._key, JSON.stringify(this._data)); } catch (e) {}
  },
  recordGameEnd(won, rounds, biggestPot) {
    const d = this.load();
    d.gamesPlayed++;
    d.totalRounds += rounds;
    if (biggestPot > d.biggestPot) d.biggestPot = biggestPot;
    if (won) {
      d.gamesWon++;
      d.currentStreak++;
      if (d.currentStreak > d.bestStreak) d.bestStreak = d.currentStreak;
    } else {
      d.currentStreak = 0;
    }
    this.save();
  },
  get() { return this.load(); },
};

// ========== 사운드 매니저 (Web Audio API) ==========
const SoundManager = {
  _ctx: null,
  _getCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  },
  _play(freq, duration, type = 'sine', volume = 0.12) {
    if (!GameSettings.soundEnabled) return;
    try {
      const ctx = this._getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  },
  cardDeal() { this._play(800, 0.1, 'square'); },
  bet() { this._play(600, 0.08, 'square'); },
  win() {
    this._play(523, 0.15);
    setTimeout(() => this._play(659, 0.15), 150);
    setTimeout(() => this._play(784, 0.3), 300);
  },
  lose() {
    this._play(400, 0.15);
    setTimeout(() => this._play(350, 0.15), 150);
    setTimeout(() => this._play(300, 0.3), 300);
  },
  draw() { this._play(500, 0.2); },
  tick() { this._play(1000, 0.05, 'square'); },
  fold() { this._play(300, 0.2); },
  shuffle() {
    this._play(400, 0.08, 'square');
    setTimeout(() => this._play(500, 0.08, 'square'), 80);
    setTimeout(() => this._play(600, 0.1, 'square'), 160);
  },
  gameOver() {
    this._play(523, 0.2);
    setTimeout(() => this._play(392, 0.2), 200);
    setTimeout(() => this._play(330, 0.4), 400);
  },
  timeout() {
    this._play(440, 0.15);
    setTimeout(() => this._play(440, 0.15), 200);
  },
};

function vibrate(pattern) {
  if (!GameSettings.vibrationEnabled) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// ========== 토스트 알림 ==========
function showToast(message, duration = 2800) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  const fadeStart = Math.max(0, duration - 300);
  toast.style.animation = `toastIn 0.3s ease-out, toastOut 0.3s ease-in ${fadeStart}ms forwards`;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, duration);
}

(function () {
  const connMgr = new ConnectionManager();
  let game = null;
  let qrScanner = null;
  let roundHistory = [];

  // ========== DOM 요소 ==========
  const $ = (id) => document.getElementById(id);

  const screens = {
    lobby: $('screen-lobby'),
    hostWaiting: $('screen-host-waiting'),
    guestJoin: $('screen-guest-join'),
    game: $('screen-game'),
  };

  let savedSession = null;

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
    hostPeerIdCopy: $('host-peer-id-copy'),
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
    btnDdadang: $('btn-ddadang'),
    btnHalf: $('btn-half'),
    btnQuarter: $('btn-quarter'),
    btnPping: $('btn-pping'),
    btnCheck: $('btn-check'),
    btnCall: $('btn-call'),
    btnFold: $('btn-fold'),
    // Timer
    betTimer: $('bet-timer'),
    betTimerBar: $('bet-timer-bar'),
    betTimerText: $('bet-timer-text'),
    // Card Log
    cardLogItems: $('card-log-items'),
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
    // Settings
    btnToggleSound: $('btn-toggle-sound'),
    btnToggleVibration: $('btn-toggle-vibration'),
    // Tutorial
    tutorialOverlay: $('tutorial-overlay'),
    btnCloseTutorial: $('btn-close-tutorial'),
    btnShowTutorial: $('btn-show-tutorial'),
    // Carry pot
    carryPotDisplay: $('carry-pot-display'),
    // Game Over Stats
    gameOverStats: $('game-over-stats'),
    // Room Info
    roomInfoBadge: $('room-info-badge'),
    roomInfoQr: $('room-info-qr'),
    roomInfoId: $('room-info-id'),
    roomInfoOverlay: $('room-info-overlay'),
    roomInfoExpandedQr: $('room-info-expanded-qr'),
    roomInfoExpandedId: $('room-info-expanded-id'),
    roomInfoCopyBtn: $('room-info-copy-btn'),
    roomInfoExpandedCopyBtn: $('room-info-expanded-copy-btn'),
    btnCloseRoomInfo: $('btn-close-room-info'),
    // History
    btnToggleHistory: $('btn-toggle-history'),
    historyPanel: $('history-panel'),
    historySummary: $('history-summary'),
    historyList: $('history-list'),
  };

  // ========== 베팅 타이머 ==========
  let betTimerInterval = null;
  let betTimerSeconds = 0;
  let wasMyTurn = false;

  function startBetTimer() {
    clearBetTimer();
    betTimerSeconds = BET_TIMER_SECONDS;
    if (ui.betTimer) ui.betTimer.style.display = 'block';
    updateTimerDisplay();

    betTimerInterval = setInterval(() => {
      betTimerSeconds--;
      updateTimerDisplay();

      if (betTimerSeconds <= 5 && betTimerSeconds > 0) {
        SoundManager.tick();
        vibrate(50);
      }

      if (betTimerSeconds <= 0) {
        clearBetTimer();
        // race condition 방지: 게임이 존재하고 내 턴이며 베팅 상태일 때만 자동 콜
        if (game && game.isMyTurn && game.state === STATE.BETTING) {
          SoundManager.timeout();
          showToast('⏰ 시간 초과 - 자동 콜');
          game.doBet('call');
        }
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    if (!ui.betTimerBar) return;
    const pct = (betTimerSeconds / BET_TIMER_SECONDS) * 100;
    ui.betTimerBar.style.width = pct + '%';
    if (ui.betTimerText) ui.betTimerText.textContent = betTimerSeconds;

    ui.betTimerBar.classList.remove('warning', 'danger');
    if (betTimerSeconds <= 5) ui.betTimerBar.classList.add('danger');
    else if (betTimerSeconds <= 10) ui.betTimerBar.classList.add('warning');
  }

  function clearBetTimer() {
    if (betTimerInterval) {
      clearInterval(betTimerInterval);
      betTimerInterval = null;
    }
    if (ui.betTimer) ui.betTimer.style.display = 'none';
  }

  // ========== 카드 로그 업데이트 (색맹 접근성 포함) ==========
  function updateCardLog(playedCards) {
    if (!ui.cardLogItems) return;

    const usedCount = {};
    for (let i = 1; i <= 10; i++) usedCount[i] = 0;
    if (playedCards) {
      playedCards.forEach((card) => {
        if (usedCount[card] !== undefined) usedCount[card]++;
      });
    }

    ui.cardLogItems.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
      const item = document.createElement('div');
      item.className = 'card-log-item';
      const remain = 2 - usedCount[i];

      // 색상 + 패턴 + 기호로 상태 표시 (색맹 접근성)
      if (usedCount[i] >= 2) {
        item.classList.add('used-all');
        item.setAttribute('aria-label', `카드 ${i}: 모두 사용됨`);
      } else if (usedCount[i] === 1) {
        item.classList.add('used-one');
        item.setAttribute('aria-label', `카드 ${i}: 1장 남음`);
      } else {
        item.setAttribute('aria-label', `카드 ${i}: 2장 남음`);
      }

      const num = document.createElement('span');
      num.className = 'card-log-num';
      num.textContent = i;
      item.appendChild(num);

      // 접근성: 숫자 + 기호로 남은 수 표시
      const badge = document.createElement('span');
      badge.className = 'card-log-remain';
      // ●● = 2장 남음, ●○ = 1장 남음, ○○ = 0장 남음
      if (remain === 2) badge.textContent = '●●';
      else if (remain === 1) badge.textContent = '●○';
      else badge.textContent = '××';
      item.appendChild(badge);

      ui.cardLogItems.appendChild(item);
    }
  }

  // ========== 화면 전환 ==========
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function generateDefaultNickname() {
    return '플레이어#' + Math.floor(Math.random() * 1000);
  }

  function getNickname() {
    return ui.nicknameInput.value.trim() || generateDefaultNickname();
  }

  // ========== 세션 복원 체크 ==========
  function checkSavedSession() {
    savedSession = Game.loadSession();
    if (savedSession) {
      ui.resumeDetail.textContent = `칩: 나 ${savedSession.myChips} / 상대 ${savedSession.opponentChips} · 라운드 ${savedSession.roundNumber}`;
      ui.resumeSection.style.display = 'block';
      if (savedSession.myName) {
        ui.nicknameInput.value = savedSession.myName;
      }
    } else {
      ui.resumeSection.style.display = 'none';
    }
  }

  // 닉네임이 비어있으면 기본 랜덤 닉네임 설정
  if (!ui.nicknameInput.value.trim()) {
    ui.nicknameInput.value = generateDefaultNickname();
  }

  checkSavedSession();

  // 이어하기 — 항상 새 방을 만들고 상태만 복원
  ui.btnResume.addEventListener('click', async () => {
    if (!savedSession) return;

    try {
      ui.btnResume.disabled = true;
      ui.btnResume.textContent = '방 생성 중...';

      // 항상 새 방 생성 (이전 방은 이미 폭파됨)
      const peerId = await connMgr.createHost();
      ui.hostPeerId.textContent = peerId;

      ui.qrContainer.innerHTML = '';
      const qr = qrcode(0, 'M');
      qr.addData(peerId);
      qr.make();
      const qrImg = document.createElement('div');
      qrImg.innerHTML = qr.createImgTag(5, 10);
      ui.qrContainer.appendChild(qrImg.firstChild);

      // 세션을 호스트 기준으로 변환 (원래 게스트였어도 이제 호스트)
      const resumeSession = { ...savedSession, isHost: true };

      connMgr.onConnected = () => {
        ui.hostStatus.textContent = '✅ 상대방 연결됨! 게임 복원 중...';
        ui.hostStatus.style.color = '#2ecc71';
        startGame(resumeSession);
      };
      connMgr.onDisconnected = handleDisconnect;

      ui.hostStatus.textContent = '새 방이 생성되었습니다. 상대방에게 QR 코드를 보여주세요.';
      ui.hostStatus.style.color = '#f39c12';
      showScreen('hostWaiting');
    } catch (err) {
      alert('방 생성 실패: ' + err.message);
    } finally {
      ui.btnResume.disabled = false;
      ui.btnResume.textContent = '이어하기';
    }
  });

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

      ui.qrContainer.innerHTML = '';
      const qr = qrcode(0, 'M');
      qr.addData(peerId);
      qr.make();
      const qrImg = document.createElement('div');
      qrImg.innerHTML = qr.createImgTag(5, 10);
      ui.qrContainer.appendChild(qrImg.firstChild);

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
      (decodedText) => { stopQrScanner(); connectToHost(decodedText); },
      () => {}
    ).catch((err) => {
      console.warn('카메라 시작 실패:', err);
      showToast('카메라를 사용할 수 없습니다. ID를 직접 입력해주세요.');
    });
  }

  async function stopQrScanner() {
    if (!qrScanner) return;
    const scanner = qrScanner;
    qrScanner = null;
    try { await scanner.stop(); } catch (e) {}
    try { scanner.clear(); } catch (e) {}
  }

  // ========== Guest 연결 ==========
  async function connectToHost(hostId) {
    const trimmedId = hostId.trim();
    try {
      ui.guestStatus.textContent = '연결 중...';
      ui.guestStatus.style.color = '#f39c12';

      connMgr.onConnected = () => {
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

  $('btn-clear-peer-id').addEventListener('click', () => {
    ui.manualPeerId.value = '';
    $('btn-clear-peer-id').style.display = 'none';
    localStorage.removeItem('lastRoomId');
    ui.manualPeerId.focus();
  });

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
    const roomId = connMgr.isHost
      ? connMgr.peerId
      : (connMgr.conn ? connMgr.conn.peer : null);

    if (!roomId) {
      ui.roomInfoBadge.style.display = 'none';
      return;
    }

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
    ui.roomInfoId.textContent = roomId;

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

  function copyRoomId(btn) {
    const roomId = ui.roomInfoId.textContent;
    if (!roomId || roomId === '-') return;
    navigator.clipboard.writeText(roomId).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => {
      showToast('복사 실패 - ID를 직접 선택해 복사하세요');
    });
  }

  ui.roomInfoBadge.addEventListener('click', (e) => {
    if (e.target.closest('.room-info-copy-btn') || e.target.closest('.room-info-id')) return;
    ui.roomInfoOverlay.style.display = 'flex';
  });
  ui.roomInfoId.addEventListener('click', (e) => { e.stopPropagation(); copyRoomId(ui.roomInfoCopyBtn); });
  ui.roomInfoCopyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyRoomId(ui.roomInfoCopyBtn); });
  ui.roomInfoExpandedId.addEventListener('click', () => { copyRoomId(ui.roomInfoExpandedCopyBtn); });
  ui.roomInfoExpandedCopyBtn.addEventListener('click', () => { copyRoomId(ui.roomInfoExpandedCopyBtn); });
  ui.btnCloseRoomInfo.addEventListener('click', () => { ui.roomInfoOverlay.style.display = 'none'; });
  ui.roomInfoOverlay.addEventListener('click', (e) => {
    if (e.target === ui.roomInfoOverlay) ui.roomInfoOverlay.style.display = 'none';
  });

  // Host waiting screen copy
  function copyHostPeerId(btn) {
    const id = ui.hostPeerId.textContent;
    if (!id || id === '-') return;
    navigator.clipboard.writeText(id).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => {
      showToast('복사 실패 - ID를 직접 선택해 복사하세요');
    });
  }
  if (ui.hostPeerId) ui.hostPeerId.addEventListener('click', () => { copyHostPeerId(ui.hostPeerIdCopy); });
  if (ui.hostPeerIdCopy) ui.hostPeerIdCopy.addEventListener('click', () => { copyHostPeerId(ui.hostPeerIdCopy); });

  // ========== 게임 시작 ==========
  function startGame(resumeSession) {
    stopQrScanner();
    clearBetTimer();
    wasMyTurn = false;
    roundHistory = [];

    game = new Game(connMgr);

    game.onStateChange = updateGameUI;
    game.onCardDealt = onCardDealt;
    game.onRoundResult = onRoundResult;
    game.onGameOver = onGameOver;
    game.onDeckShuffled = onDeckShuffled;

    showScreen('game');
    showRoomInfoBadge();
    updateCardLog([]);
    game.start(getNickname(), resumeSession || null);
  }

  // ========== Game UI 갱신 ==========
  function updateGameUI(state) {
    if (!ui.myName || !ui.bettingControls) return;
    ui.myName.textContent = state.myName || '나';
    ui.opponentName.textContent = state.opponentName || '상대방';
    ui.myChips.textContent = `💰 ${state.myChips}`;
    ui.opponentChips.textContent = `💰 ${state.opponentChips}`;
    ui.potAmount.textContent = state.pot;
    const remainingEl = $('remaining-cards');
    if (remainingEl) remainingEl.textContent = state.remainingCards !== undefined ? state.remainingCards : '-';

    // 이월 팟 표시
    if (ui.carryPotDisplay) {
      if (state.carryPot > 0) {
        ui.carryPotDisplay.textContent = `(이월 +${state.carryPot})`;
        ui.carryPotDisplay.style.display = 'inline';
      } else {
        ui.carryPotDisplay.style.display = 'none';
      }
    }

    updateCardLog(state.playedCards);

    if (state.state === STATE.BETTING || state.state === STATE.DEALING || state.state === STATE.WAITING) {
      if (ui.roundResult) ui.roundResult.style.display = 'none';
    }

    // 게임 상태 텍스트
    if (ui.gameStatus) {
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
    }

    // 베팅 컨트롤
    const showBetting = state.state === STATE.BETTING && state.isMyTurn;
    if (ui.bettingControls) ui.bettingControls.style.display = showBetting ? 'block' : 'none';

    // 타이머: 내 턴이 새로 시작되면 가동
    if (showBetting && !wasMyTurn) {
      startBetTimer();
      vibrate(100);
    }
    if (!showBetting) {
      clearBetTimer();
    }
    wasMyTurn = showBetting;

    if (showBetting) {
      const callDiff = Math.max(0, state.opponentBetTotal - state.myBetTotal);
      const chipsAfterCall = state.myChips - callDiff;
      const raiseMaxed = state.raiseCount >= state.maxRaises;

      // 하프/쿼터/삥 금액 계산
      const halfAmt = Math.max(1, Math.ceil(state.pot / 2));
      const quarterAmt = Math.max(1, Math.ceil(state.pot / 4));
      const ppingAmt = 1;

      // 올인 판정 함수: 레이즈 금액이 남은 칩 이상이면 올인
      function updateRaiseBtn(btn, label, amount) {
        if (!btn) return;
        const totalCost = callDiff + amount;
        const isAllIn = totalCost >= state.myChips;
        const disabled = raiseMaxed || chipsAfterCall < 1;
        btn.disabled = disabled;
        if (disabled) {
          btn.textContent = label;
        } else if (isAllIn) {
          btn.textContent = `올인 (${state.myChips})`;
        } else {
          btn.textContent = `${label} (${amount})`;
        }
      }

      // 따당: 상대 레이즈 금액만큼 되돌려 레이즈 (callDiff가 0이면 비활성화)
      if (ui.btnDdadang) {
        if (callDiff === 0 || raiseMaxed || chipsAfterCall < 1) {
          ui.btnDdadang.disabled = true;
          ui.btnDdadang.textContent = '따당';
        } else {
          updateRaiseBtn(ui.btnDdadang, '따당', callDiff);
        }
      }

      updateRaiseBtn(ui.btnHalf, '하프', halfAmt);
      updateRaiseBtn(ui.btnQuarter, '쿼터', quarterAmt);
      updateRaiseBtn(ui.btnPping, '삥', ppingAmt);

      // 체크: 차이 없을 때만 활성화
      if (ui.btnCheck) {
        ui.btnCheck.style.display = callDiff === 0 ? '' : 'none';
        ui.btnCheck.disabled = callDiff > 0;
      }

      // 콜: 차이 있을 때만 활성화
      if (ui.btnCall) {
        if (callDiff > 0) {
          ui.btnCall.style.display = '';
          if (callDiff >= state.myChips) {
            ui.btnCall.textContent = `올인 (${state.myChips})`;
          } else {
            ui.btnCall.textContent = `콜 (${callDiff})`;
          }
          ui.btnCall.disabled = false;
        } else {
          ui.btnCall.style.display = 'none';
        }
      }
    } else {
      if (ui.btnDdadang) ui.btnDdadang.textContent = '따당';
      if (ui.btnHalf) ui.btnHalf.textContent = '하프';
      if (ui.btnQuarter) ui.btnQuarter.textContent = '쿼터';
      if (ui.btnPping) ui.btnPping.textContent = '삥';
      if (ui.btnCheck) ui.btnCheck.textContent = '체크';
      if (ui.btnCall) ui.btnCall.textContent = '콜';
    }
  }

  function onCardDealt(cardValue) {
    if (!ui.opponentCardValue || !ui.opponentCard) return;
    ui.opponentCardValue.textContent = cardValue;
    ui.opponentCard.classList.add('revealed', 'card-deal-animation');
    SoundManager.cardDeal();
    vibrate(80);
    setTimeout(() => { ui.opponentCard.classList.remove('card-deal-animation'); }, 500);
  }

  function onRoundResult(result) {
    if (!ui.bettingControls || !ui.resultMyName) return;
    ui.bettingControls.style.display = 'none';
    clearBetTimer();

    ui.resultMyName.textContent = game.myName || '나';
    ui.resultOpponentName.textContent = game.opponentName || '상대방';
    ui.resultMyCard.textContent = result.myCard;
    ui.resultOpponentCard.textContent = result.opponentCard;

    // 순이익 계산: 팟 획득 - 내가 베팅한 금액
    const myBet = result.myBetTotal || 1;
    let netProfit = 0;

    if (result.winner === 'you') {
      netProfit = result.potWon - myBet + (result.foldPenalty || 0);
      ui.resultTitle.textContent = '🎉 승리!';
      let msg = `+${netProfit} 칩`;
      ui.resultMessage.textContent = msg;
      ui.resultMessage.style.color = '#2ecc71';
      SoundManager.win();
      vibrate([100, 50, 100]);
    } else if (result.winner === 'opponent') {
      netProfit = -(myBet + (result.foldPenalty || 0));
      ui.resultTitle.textContent = '😢 패배';
      let msg = `${netProfit} 칩`;
      ui.resultMessage.textContent = msg;
      ui.resultMessage.style.color = '#e74c3c';
      SoundManager.lose();
      vibrate(200);
    } else {
      netProfit = 0;
      ui.resultTitle.textContent = '🤝 무승부';
      ui.resultMessage.textContent = '±0 칩';
      ui.resultMessage.style.color = '#f39c12';
      SoundManager.draw();
    }

    // 히스토리 기록
    roundHistory.push({
      round: result.roundNumber || roundHistory.length + 1,
      myCard: result.myCard,
      opponentCard: result.opponentCard,
      winner: result.winner,
      netProfit: netProfit,
    });
    updateHistoryPanel();

    ui.roundResult.style.display = 'flex';
  }

  // ========== 라운드 히스토리 ==========
  function updateHistoryPanel() {
    if (!ui.historyList) return;

    const wins = roundHistory.filter(r => r.winner === 'you').length;
    const losses = roundHistory.filter(r => r.winner === 'opponent').length;
    const draws = roundHistory.filter(r => r.winner === 'draw').length;
    const totalNet = roundHistory.reduce((sum, r) => sum + r.netProfit, 0);

    if (ui.historySummary) {
      const netStr = totalNet >= 0 ? `+${totalNet}` : `${totalNet}`;
      ui.historySummary.textContent = `${wins}승 ${losses}패 ${draws}무 (${netStr})`;
    }

    ui.historyList.innerHTML = '';
    for (let i = roundHistory.length - 1; i >= 0; i--) {
      const r = roundHistory[i];
      const row = document.createElement('div');
      row.className = 'history-row';

      let icon, colorClass;
      if (r.winner === 'you') { icon = 'W'; colorClass = 'history-win'; }
      else if (r.winner === 'opponent') { icon = 'L'; colorClass = 'history-lose'; }
      else { icon = 'D'; colorClass = 'history-draw'; }

      const netStr = r.netProfit >= 0 ? `+${r.netProfit}` : `${r.netProfit}`;

      const roundSpan = document.createElement('span');
      roundSpan.className = 'history-round';
      roundSpan.textContent = '#' + r.round;
      row.appendChild(roundSpan);

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'history-badge ' + colorClass;
      badgeSpan.textContent = icon;
      row.appendChild(badgeSpan);

      const cardsSpan = document.createElement('span');
      cardsSpan.className = 'history-cards';
      cardsSpan.textContent = r.myCard + ' vs ' + r.opponentCard;
      row.appendChild(cardsSpan);

      const netSpan = document.createElement('span');
      netSpan.className = 'history-net ' + colorClass;
      netSpan.textContent = netStr;
      row.appendChild(netSpan);

      ui.historyList.appendChild(row);
    }
  }

  function onDeckShuffled(deckSize) {
    showToast('🔄 덱이 새로 섞였습니다! 카드 로그 초기화');
    SoundManager.shuffle();
    vibrate([50, 30, 50, 30, 50]);
    updateCardLog([]);
  }

  function onGameOver(result) {
    if (!ui.roundResult || !ui.gameOverTitle) return;
    ui.roundResult.style.display = 'none';
    clearBetTimer();

    const won = result.winner === 'you';
    const biggestPot = roundHistory.reduce((max, r) => {
      const abs = Math.abs(r.netProfit);
      return abs > max ? abs : max;
    }, 0);
    GameStats.recordGameEnd(won, roundHistory.length, biggestPot);

    if (won) {
      ui.gameOverTitle.textContent = '승리!';
      ui.gameOverMessage.textContent = '상대방의 칩이 모두 소진되었습니다.';
      SoundManager.win();
      vibrate([200, 100, 200, 100, 200]);
    } else {
      ui.gameOverTitle.textContent = '패배...';
      ui.gameOverMessage.textContent = '당신의 칩이 모두 소진되었습니다.';
      SoundManager.gameOver();
      vibrate(500);
    }

    // 게임 통계 표시
    if (ui.gameOverStats) {
      const stats = GameStats.get();
      const wins = roundHistory.filter(r => r.winner === 'you').length;
      const losses = roundHistory.filter(r => r.winner === 'opponent').length;
      const draws = roundHistory.filter(r => r.winner === 'draw').length;

      ui.gameOverStats.textContent = '';

      function createStatItem(label, value) {
        const item = document.createElement('div');
        item.className = 'stat-item';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'stat-label';
        labelSpan.textContent = label;
        const valueSpan = document.createElement('span');
        valueSpan.className = 'stat-value';
        valueSpan.textContent = value;
        item.appendChild(labelSpan);
        item.appendChild(valueSpan);
        return item;
      }

      function createStatsSection(title, items) {
        const section = document.createElement('div');
        section.className = 'game-over-stats-section';
        const h4 = document.createElement('h4');
        h4.textContent = title;
        section.appendChild(h4);
        const grid = document.createElement('div');
        grid.className = 'stats-grid';
        items.forEach(([label, value]) => grid.appendChild(createStatItem(label, value)));
        section.appendChild(grid);
        return section;
      }

      const winRate = stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
      ui.gameOverStats.appendChild(createStatsSection('이번 게임', [
        ['라운드', roundHistory.length],
        ['승/패/무', wins + '/' + losses + '/' + draws],
      ]));
      ui.gameOverStats.appendChild(createStatsSection('누적 전적', [
        ['총 게임', stats.gamesPlayed],
        ['승률', winRate + '%'],
        ['연승', stats.currentStreak],
        ['최고 연승', stats.bestStreak],
      ]));
      ui.gameOverStats.style.display = 'block';
    }

    ui.gameOver.style.display = 'flex';
  }

  // ========== 베팅 컨트롤 ==========
  function getRaiseAmount(type) {
    if (!game) return 1;
    const pot = game.pot;
    if (type === 'ddadang') {
      const callDiff = Math.max(0, game.opponentBetTotal - game.myBetTotal);
      return Math.max(1, callDiff);
    }
    if (type === 'half') return Math.max(1, Math.ceil(pot / 2));
    if (type === 'quarter') return Math.max(1, Math.ceil(pot / 4));
    return 1; // 삥
  }

  function doRaise(type) {
    if (!game) return;
    const callDiff = Math.max(0, game.opponentBetTotal - game.myBetTotal);
    const amount = getRaiseAmount(type);
    const totalCost = callDiff + amount;
    const actualAmount = totalCost >= game.myChips ? Math.max(1, game.myChips - callDiff) : amount;
    SoundManager.bet();
    game.doBet('raise', actualAmount);
  }

  if (ui.btnDdadang) ui.btnDdadang.addEventListener('click', () => doRaise('ddadang'));
  if (ui.btnHalf) ui.btnHalf.addEventListener('click', () => doRaise('half'));
  if (ui.btnQuarter) ui.btnQuarter.addEventListener('click', () => doRaise('quarter'));
  if (ui.btnPping) ui.btnPping.addEventListener('click', () => doRaise('pping'));

  if (ui.btnCheck) ui.btnCheck.addEventListener('click', () => {
    if (game) { SoundManager.bet(); game.doBet('call'); }
  });

  if (ui.btnCall) ui.btnCall.addEventListener('click', () => {
    if (game) { SoundManager.bet(); game.doBet('call'); }
  });

  if (ui.btnFold) ui.btnFold.addEventListener('click', () => {
    if (game) { SoundManager.fold(); game.doBet('fold'); }
  });

  // ========== 히스토리 토글 ==========
  if (ui.btnToggleHistory) {
    ui.btnToggleHistory.addEventListener('click', () => {
      const panel = ui.historyPanel;
      if (!panel) return;
      const isVisible = panel.style.display !== 'none';
      panel.style.display = isVisible ? 'none' : 'block';
      ui.btnToggleHistory.classList.toggle('active', !isVisible);
    });
  }

  // ========== 라운드/게임 흐름 ==========
  if (ui.btnNextRound) ui.btnNextRound.addEventListener('click', () => {
    if (ui.roundResult) ui.roundResult.style.display = 'none';
    if (ui.opponentCardValue) ui.opponentCardValue.textContent = '?';
    if (ui.opponentCard) ui.opponentCard.classList.remove('revealed');
    if (game) game.requestNextRound();
  });

  if (ui.btnNewGame) ui.btnNewGame.addEventListener('click', () => {
    if (ui.gameOver) ui.gameOver.style.display = 'none';
    if (ui.roundResult) ui.roundResult.style.display = 'none';
    if (ui.opponentCardValue) ui.opponentCardValue.textContent = '?';
    if (ui.opponentCard) ui.opponentCard.classList.remove('revealed');
    roundHistory = [];
    updateHistoryPanel();
    if (ui.historyPanel) ui.historyPanel.style.display = 'none';
    if (ui.btnToggleHistory) ui.btnToggleHistory.classList.remove('active');
    if (game) game.requestNewGame();
  });

  // ========== 연결 끊김 ==========
  function handleDisconnect() {
    clearBetTimer();
    // 게임 상태 정리 (백그라운드 타이머 방지)
    game = null;
    if (ui.disconnectOverlay) ui.disconnectOverlay.style.display = 'flex';
  }

  if (ui.btnBackLobby) ui.btnBackLobby.addEventListener('click', () => {
    if (ui.disconnectOverlay) ui.disconnectOverlay.style.display = 'none';
    connMgr.destroy();
    game = null;
    showScreen('lobby');
    checkSavedSession();
  });

  // ========== 설정 토글 (사운드/진동) ==========
  function updateSettingsUI() {
    if (ui.btnToggleSound) {
      ui.btnToggleSound.textContent = GameSettings.soundEnabled ? '🔊' : '🔇';
      ui.btnToggleSound.setAttribute('aria-label', GameSettings.soundEnabled ? '사운드 끄기' : '사운드 켜기');
    }
    if (ui.btnToggleVibration) {
      ui.btnToggleVibration.textContent = GameSettings.vibrationEnabled ? '📳' : '📴';
      ui.btnToggleVibration.setAttribute('aria-label', GameSettings.vibrationEnabled ? '진동 끄기' : '진동 켜기');
    }
  }
  updateSettingsUI();

  if (ui.btnToggleSound) {
    ui.btnToggleSound.addEventListener('click', () => {
      GameSettings.soundEnabled = !GameSettings.soundEnabled;
      updateSettingsUI();
      showToast(GameSettings.soundEnabled ? '사운드 ON' : '사운드 OFF', 1500);
    });
  }
  if (ui.btnToggleVibration) {
    ui.btnToggleVibration.addEventListener('click', () => {
      GameSettings.vibrationEnabled = !GameSettings.vibrationEnabled;
      updateSettingsUI();
      showToast(GameSettings.vibrationEnabled ? '진동 ON' : '진동 OFF', 1500);
    });
  }

  // ========== 튜토리얼 ==========
  function showTutorial() {
    if (ui.tutorialOverlay) ui.tutorialOverlay.style.display = 'flex';
  }
  function hideTutorial() {
    if (ui.tutorialOverlay) ui.tutorialOverlay.style.display = 'none';
    GameSettings.tutorialSeen = true;
  }

  // 첫 방문 시 자동 표시
  if (!GameSettings.tutorialSeen) {
    showTutorial();
  }

  if (ui.btnCloseTutorial) {
    ui.btnCloseTutorial.addEventListener('click', hideTutorial);
  }
  if (ui.tutorialOverlay) {
    ui.tutorialOverlay.addEventListener('click', (e) => {
      if (e.target === ui.tutorialOverlay) hideTutorial();
    });
  }
  if (ui.btnShowTutorial) {
    ui.btnShowTutorial.addEventListener('click', showTutorial);
  }

})();
