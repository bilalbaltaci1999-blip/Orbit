import { getStoredToken } from './api.ts';

export type WsConnectionState = 'connected' | 'connecting' | 'disconnected';

export interface WsEvent {
  type: string;
  payload: Record<string, unknown>;
}

type EventHandler = (event: WsEvent) => void;
type StateHandler = (state: WsConnectionState) => void;

class OrbitWsClient {
  private ws: WebSocket | null = null;
  private subscribedRooms = new Set<string>();
  private listeners = new Set<EventHandler>();
  private stateListeners = new Set<StateHandler>();
  private state: WsConnectionState = 'disconnected';
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private manuallyClosed = false;

  public getState(): WsConnectionState {
    return this.state;
  }

  private setState(next: WsConnectionState): void {
    this.state = next;
    for (const cb of this.stateListeners) cb(next);
  }

  public onStateChange(cb: StateHandler): () => void {
    this.stateListeners.add(cb);
    cb(this.state);
    return () => this.stateListeners.delete(cb);
  }

  public onEvent(cb: EventHandler): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public connect(): void {
    const token = getStoredToken();
    if (!token) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manuallyClosed = false;
    this.setState('connecting');

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    const sock = new WebSocket(url);
    this.ws = sock;

    sock.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      for (const room of this.subscribedRooms) {
        sock.send(JSON.stringify({ type: 'room:subscribe', payload: { room } }));
      }
    };

    sock.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as WsEvent;
        for (const cb of this.listeners) cb(parsed);
      } catch {
        // Ignore invalid JSON
      }
    };

    sock.onclose = () => {
      this.ws = null;
      this.setState('disconnected');
      if (!this.manuallyClosed && getStoredToken()) {
        const delay = Math.min(1000 * Math.pow(1.6, this.reconnectAttempts), 12000);
        this.reconnectAttempts += 1;
        this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
      }
    };

    sock.onerror = () => {
      // onclose will trigger reconnect
    };
  }

  public disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribedRooms.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  public subscribe(room: string): void {
    this.subscribedRooms.add(room);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:subscribe', payload: { room } }));
    }
  }

  public unsubscribe(room: string): void {
    this.subscribedRooms.delete(room);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'room:unsubscribe', payload: { room } }));
    }
  }

  public send(type: string, payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }
}

export const wsClient = new OrbitWsClient();
