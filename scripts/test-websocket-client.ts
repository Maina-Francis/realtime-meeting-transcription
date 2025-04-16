import WebSocket from 'ws';
import { createLogger } from '../src/utils';

const logger = createLogger('TestClient');

// Create WebSocket connection
const ws = new WebSocket('ws://localhost:5000');

// Handle connection events
ws.on('open', () => {
    logger.info('Connected to proxy server');
    
    // Send registration message with meeting URL
    const registerMsg = {
        type: 'register',
        client: 'bot',
        meetingUrl: 'https://meet.google.com/test-meeting'
    };
    ws.send(JSON.stringify(registerMsg));
    logger.info('Sent registration message');
});

// Handle incoming messages
ws.on('message', (data) => {
    try {
        // Try to parse as JSON first
        const message = JSON.parse(data.toString());
        
        if (message.type === 'transcription') {
            const { text, isFinal } = message.data;
            logger.info(`Received transcription ${isFinal ? '(final)' : '(partial)'}: ${text}`);
        } else {
            logger.info('Received message:', message);
        }
    } catch (error) {
        // If not JSON, it's probably binary audio data
        const buffer = Buffer.from(data as Buffer);
        logger.info(`Received binary audio data: ${buffer.length} bytes`);
    }
});

ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
});

ws.on('close', () => {
    logger.info('Connection closed');
});

// Keep the script running
process.on('SIGINT', () => {
    logger.info('Closing connection...');
    ws.close();
    process.exit(0);
}); 