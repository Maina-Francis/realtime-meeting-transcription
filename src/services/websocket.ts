import WebSocket from 'ws';
import { createLogger } from '../utils';
import { Transcript } from '../types/transcript';

const logger = createLogger('WebSocket');

export class WebSocketService {
    private wss: WebSocket.Server;
    private clients: Set<WebSocket> = new Set();

    constructor(port: number = 5001) {
        this.wss = new WebSocket.Server({ port });
        
        this.wss.on('connection', (ws) => {
            logger.info('New client connected');
            this.clients.add(ws);

            ws.on('close', () => {
                this.clients.delete(ws);
                logger.info('Client disconnected');
            });

            ws.on('error', (error) => {
                logger.error('WebSocket client error:', error);
            });
        });

        logger.info(`WebSocket server started on port ${port}`);
    }

    // Broadcast transcript to all connected clients
    broadcastTranscript(transcript: Transcript) {
        const message = JSON.stringify({
            type: 'transcript',
            data: transcript
        });

        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Get current number of connected clients
    getConnectedClientsCount(): number {
        return this.clients.size;
    }
}

export const wsService = new WebSocketService(); 