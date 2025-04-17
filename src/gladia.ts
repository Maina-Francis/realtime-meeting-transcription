import axios from "axios";
import WebSocket from "ws";
import { apiKeys } from "./config";
import { createLogger } from "./utils";
import { RedisService } from "./services/redis";
import { wsService } from "./services/websocket";

const logger = createLogger("Gladia");

// Gladia API client for real-time transcription
class GladiaClient {
  private apiKey: string;
  private apiUrl: string = "https://api.gladia.io";
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private onTranscriptionCallback:
    | ((text: string, isFinal: boolean) => void)
    | null = null;
  private redisService: RedisService;
  private meetingUrl: string | null = null;

  constructor(redisService: RedisService) {
    this.apiKey = apiKeys.gladia || "";
    this.redisService = redisService;
    if (!this.apiKey) {
      logger.error(
        "Gladia API key not found. Please set GLADIA_API_KEY in .env"
      );
    }
  }

  // Initialize a streaming session with Gladia
  async initSession(): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/v2/live`,
        {
          encoding: "wav/pcm",
          bit_depth: 16,
          sample_rate: 16000,
          channels: 1,
          model: "accurate",
          language_config: {
            languages: ["en"], // Set to English by default
            code_switching: false,
          },
          messages_config: {
            receive_partial_transcripts: true,
            receive_final_transcripts: true,
          },
        },
        {
          headers: {
            "x-gladia-key": this.apiKey,
          },
        }
      );

      this.sessionId = response.data.id;
      const wsUrl = response.data.url;

      logger.info(`Gladia session initialized: ${this.sessionId}`);

      // Connect to the WebSocket
      this.connectWebSocket(wsUrl);
      return true;
    } catch (error) {
      logger.error("Failed to initialize Gladia session:", error);
      return false;
    }
  }

  // Connect to Gladia's WebSocket for real-time transcription
  private connectWebSocket(url: string) {
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      logger.info("Connected to Gladia WebSocket");
    });

    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "transcript") {
          const utterance = message.data.utterance;
          const isFinal = message.data.is_final;

          if (utterance && utterance.text) {
            if (isFinal && this.meetingUrl) {
              logger.info(
                `Transcription (final): ${utterance.text}`
              );

              // Store final transcript in Redis
              const success = this.redisService.storeTranscript(
                this.meetingUrl,
                utterance.text,
                utterance.start_time,
                utterance.end_time
              );
              if (!success) {
                logger.error("Failed to store transcript in Redis");
              }

              // Broadcast to frontend clients
              wsService.broadcastTranscript({
                id: `${this.meetingUrl}:${Date.now()}`,
                meetingUrl: this.meetingUrl,
                text: utterance.text,
                isFinal: true,
                timestamp: Date.now()
              });
            } else if (!isFinal && this.meetingUrl) {
              // Broadcast partial transcripts too
              wsService.broadcastTranscript({
                id: `${this.meetingUrl}:${Date.now()}`,
                meetingUrl: this.meetingUrl,
                text: utterance.text,
                isFinal: false,
                timestamp: Date.now()
              });
            }

            if (this.onTranscriptionCallback) {
              this.onTranscriptionCallback(utterance.text, isFinal);
            }
          }
        }
      } catch (error) {
        logger.error("Error parsing Gladia message:", error);
      }
    });

    this.ws.on("error", (error) => {
      logger.error("Gladia WebSocket error:", error);
    });

    this.ws.on("close", () => {
      logger.info("Gladia WebSocket connection closed");
    });
  }

  // Send audio chunk to Gladia for transcription
  sendAudioChunk(audioData: Buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn("WebSocket not connected, ignoring audio chunk");
      return false;
    }

    try {
      // Send audio chunk message
      const message = {
        type: "audio_chunk",
        data: {
          chunk: audioData.toString("base64"),
        },
      };

      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error("Error sending audio chunk to Gladia:", error);
      return false;
    }
  }

  // Set callback for transcription results
  onTranscription(callback: (text: string, isFinal: boolean) => void) {
    this.onTranscriptionCallback = callback;
  }

  // Set meeting URL for transcript storage
  setMeetingUrl(url: string) {
    this.meetingUrl = url;
    logger.info(`Meeting URL set to: ${url}`);
  }

  // End transcription session
  endSession() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send stop recording message
      this.ws.send(JSON.stringify({ type: "stop_recording" }));
      this.ws.close();
    }
    this.ws = null;
    this.sessionId = null;
    this.meetingUrl = null;
  }

  private async handleMessage(message: string) {
    try {
      const data = JSON.parse(message);
      
      if (data.type === "transcript") {
        const transcript = data.transcript;
        const isFinal = transcript.type === "final";
        
        if (isFinal) {
          // Store in Redis
          if (this.meetingUrl) {
            const success = await this.redisService.storeTranscript(
              this.meetingUrl,
              transcript.text,
              transcript.start_time,
              transcript.end_time
            );
            
            if (!success) {
              logger.error("Failed to store transcript in Redis");
            }
          } else {
            logger.error("No meeting URL set, cannot store transcript");
          }
        }
        
        // Send to callback
        if (this.onTranscriptionCallback) {
          this.onTranscriptionCallback(transcript.text, isFinal);
        }
      }
    } catch (error) {
      logger.error("Error handling Gladia message:", error);
    }
  }
}

export { GladiaClient };
