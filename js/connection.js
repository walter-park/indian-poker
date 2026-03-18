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
    this.maxReconnectAttempts = 3;
  }

  /**
   * Host: Peer 생성 및 QR 코드용 ID 반환
   */
  createHost() {
    return new Promise((resolve, reject) => {
      // 짧은 ID 생성 (6자리 영숫자)
      const shortId = 'ip-' + Math.random().toString(36).substring(2, 8);

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
        console.log('[Host] Peer opened with ID:', id);
        resolve(id);
      });

      // Guest가 연결해 올 때
      this.peer.on('connection', (conn) => {
        console.log('[Host] Guest connected:', conn.peer);
        this._setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('[Host] Peer error:', err);
        if (err.type === 'unavailable-id') {
          // ID 충돌 시 재시도
          this.peer.destroy();
          this.createHost().then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });

      this.peer.on('disconnected', () => {
        console.log('[Host] Peer disconnected from signaling server');
        this._tryReconnectPeer();
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

        conn.on('open', () => {
          console.log('[Guest] Connected to host');
          this._setupConnection(conn);
          resolve();
        });

        conn.on('error', (err) => {
          console.error('[Guest] Connection error:', err);
          reject(err);
        });

        // 연결 타임아웃
        setTimeout(() => {
          if (!this.conn) {
            reject(new Error('연결 시간 초과'));
          }
        }, 15000);
      });

      this.peer.on('error', (err) => {
        console.error('[Guest] Peer error:', err);
        reject(err);
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
   * 시그널링 서버 재연결 시도
   */
  _tryReconnectPeer() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[P2P] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      setTimeout(() => {
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      }, 2000 * this.reconnectAttempts);
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
