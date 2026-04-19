import { type ClientMessage, type ServerMessage } from '@/shared/protocol';

const RECONNECT_INTERVAL = 3000;

export class McpConnection {
  private ws: WebSocket | null = null;
  private messageHandler: ((message: ServerMessage) => void) | null = null;
  private openHandler: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private reconnectDisabled = false;

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.disposed) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.openHandler?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          this.messageHandler?.(message);
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }

  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }

  /**
   * Stop the reconnect loop. Used after a fatal, non-recoverable close such as
   * a protocol-version mismatch — retrying won't change the outcome and would
   * just spam errors.
   */
  stopReconnect(): void {
    this.reconnectDisabled = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectDisabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, RECONNECT_INTERVAL);
  }
}
