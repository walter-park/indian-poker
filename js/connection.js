/**
 * P2P 연결 관리 모듈
 * PeerJS를 사용한 Host-Guest 연결 처리
 */
class ConnectionManager {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.peerId = null;
    this.onMessage = null;        // 메시지 수신 콜백
    this.onConnected = null;      // 연결 성공 콜백
    this.onDisconnected = null;   // 연결 끊김 콜백
    this.onError = null;          // 에러 콜백
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this._reconnectTimer = null;
  }

  /**
   * Host: Peer 생성 및 QR 코드용 ID 반환
   * @param {string} [fixedId] - 재연결 시 사용할 고정 ID
   */
  createHost(fixedId) {
    return new Promise((resolve, reject) => {
      const shortId = fixedId || 'ip-' + Math.random().toString(36).substring(2, 8);

      this.peer = new Peer(shortId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ]
        }
      });

      this.isHost = true;

      this.peer.on('open', (id) => {
        this.peerId = id;
        this._createRetries = 0;
        console.log('[Host] Peer opened with ID:', id);
        resolve(id);
      });

      // Guest가 연결해 올 때
      this.peer.on('connection', (conn) => {
        console.log('[Host] Guest connected:', conn.peer);
        this._setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        // 이미 연결된 상태에서의 시그널링 서버 에러는 무시
        if (this.conn && this.conn.open && (err.type === 'network' || err.type === 'server-error')) {
          console.warn('[Host] Signaling server error (data channel still open, ignoring):', err.type);
          return;
        }
        console.error('[Host] Peer error:', err);
        if (err.type === 'unavailable-id' && (this._createRetries || 0) < 3) {
          this._createRetries = (this._createRetries || 0) + 1;
          this.peer.destroy();
          this.createHost().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.peer.on('disconnected', () => {
        // 데이터 채널이 살아있으면 시그널링 서버 끊김은 무시 (백그라운드 재연결만)
        if (this.conn && this.conn.open) {
          console.log('[Host] Signaling server disconnected, but data channel is still open. Reconnecting silently...');
          this._tryReconnectPeer();
        } else {
          console.log('[Host] Peer disconnected from signaling server');
          this._tryReconnectPeer();
        }
      });
    });
  }

  /**
   * Guest: Host의 Peer ID로 연결
   */
  joinHost(hostId) {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(undefined, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ]
        }
      });

      this.isHost = false;

      this.peer.on('open', (id) => {
        this.peerId = id;
        console.log('[Guest] Peer opened with ID:', id);

        const conn = this.peer.connect(hostId, {
          reliable: true,
          serialization: 'json',
        });

        const timeoutId = setTimeout(() => {
          if (!this.conn) {
            reject(new Error('연결 시간 초과'));
          }
        }, 15000);

        conn.on('open', () => {
          clearTimeout(timeoutId);
          console.log('[Guest] Connected to host');
          this._setupConnection(conn);
          resolve();
        });

        conn.on('error', (err) => {
          clearTimeout(timeoutId);
          console.error('[Guest] Connection error:', err);
          reject(err);
        });
      });

      this.peer.on('error', (err) => {
        // 이미 연결된 상태에서의 시그널링 서버 에러는 무시
        if (this.conn && this.conn.open && err.type === 'network') {
          console.warn('[Guest] Signaling server error (data channel still open, ignoring):', err.type);
          return;
        }
        console.error('[Guest] Peer error:', err);
        reject(err);
      });

      this.peer.on('disconnected', () => {
        if (this.conn && this.conn.open) {
          console.log('[Guest] Signaling server disconnected, but data channel is still open. Reconnecting silently...');
          this._tryReconnectPeer();
        } else {
          console.log('[Guest] Peer disconnected from signaling server');
          this._tryReconnectPeer();
        }
      });
    });
  }

  /**
   * DataConnection 설정 (공통)
   */
  _setupConnection(conn) {
    this.conn = conn;
    this.reconnectAttempts = 0;

    conn.on('data', (data) => {
      console.log('[P2P] Received:', data.type);
      if (this.onMessage) {
        this.onMessage(data);
      }
    });

    conn.on('close', () => {
      console.log('[P2P] Connection closed');
      this.conn = null;
      if (this.onDisconnected) {
        this.onDisconnected();
      }
    });

    conn.on('error', (err) => {
      console.error('[P2P] Connection error:', err);
      if (this.onError) {
        this.onError(err);
      }
    });

    if (this.onConnected) {
      this.onConnected();
    }
  }

  /**
   * 시그널링 서버 재연결 시도 (exponential backoff)
   */
  _tryReconnectPeer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);
      console.log(`[P2P] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} (in ${delay}ms)`);
      this._reconnectTimer = setTimeout(() => {
        if (this.peer && !this.peer.destroyed) {
          try {
            this.peer.reconnect();
          } catch (e) {
            console.warn('[P2P] Reconnect failed:', e.message);
            // 데이터 채널이 살아있으면 문제 없음
            if (this.conn && this.conn.open) {
              console.log('[P2P] Data channel still open, continuing without signaling server');
            }
          }
        }
      }, delay);
    } else {
      // 최대 재시도 초과, 데이터 채널 상태 확인
      if (this.conn && this.conn.open) {
        console.log('[P2P] Max reconnect attempts reached, but data channel is still open. Continuing...');
        // 30초 후 재시도 카운터 리셋하여 다시 시도할 수 있게
        this._reconnectTimer = setTimeout(() => {
          this.reconnectAttempts = 0;
          this._tryReconnectPeer();
        }, 30000);
      } else {
        console.warn('[P2P] Max reconnect attempts reached and data channel is closed');
        if (this.onDisconnected) {
          this.onDisconnected();
        }
      }
    }
  }

  /**
   * 메시지 전송
   */
  send(data) {
    if (this.conn && this.conn.open) {
      this.conn.send(data);
      return true;
    }
    console.warn('[P2P] Cannot send - connection not open');
    return false;
  }

  /**
   * 연결 정리
   */
  destroy() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.isHost = false;
    this.peerId = null;
    this.reconnectAttempts = 0;
  }

  /**
   * 연결 상태 확인
   */
  get isConnected() {
    return this.conn && this.conn.open;
  }
}
