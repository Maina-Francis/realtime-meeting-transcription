import { createClient } from "redis";
import { createLogger } from "../utils";
import { Transcript } from "../types/transcript";

const logger = createLogger("redis");

// TTL Configuration
const TTL_SETTINGS = {
  ACTIVE_MEETING: 24 * 60 * 60,     // 24 hours for active meetings
  COMPLETED_MEETING: 7 * 24 * 60 * 60, // 7 days for completed meetings
  MINIMUM_RETENTION: 3 * 24 * 60 * 60  // 3 days minimum retention
};

export class RedisService {
    private client;
    private publisher;
    private subscriber;
    private readonly TRANSCRIPT_CHANNEL = "transcripts:stream";
    
    constructor() {
        this.client = createClient({
            url: process.env.REDIS_URL
        });
        this.publisher = this.client.duplicate();
        this.subscriber = this.client.duplicate();

        this.client.on("error", (err) => logger.error("Redis Client Error", err));
        this.client.on("connect", () => logger.info("Redis client connected"));
        this.client.on("ready", () => logger.info("Redis client ready"));

        Promise.all([
            this.client.connect(),
            this.publisher.connect(),
            this.subscriber.connect()
        ]).then(() => {
            logger.info("All Redis clients connected");
        }).catch(err => {
            logger.error("Failed to connect Redis clients:", err);
        });
    }

    private getTranscriptsKey(meetingUrl: string): string {
        return `transcripts:${meetingUrl}`;
    }

    private getMeetingKey(meetingUrl: string): string {
        return `meeting:${meetingUrl}`;
    }

    async storeTranscript(
        meetingUrl: string,
        text: string,
        startTime: number,
        endTime: number
    ): Promise<boolean> {
        try {
            const transcript = {
                text,
                startTime,
                endTime,
                timestamp: Date.now(),
            };

            // Store transcript
            await this.client.lPush(
                this.getTranscriptsKey(meetingUrl),
                JSON.stringify(transcript)
            );

            // Update meeting metadata
            await this.client.hSet(this.getMeetingKey(meetingUrl), {
                lastUpdated: Date.now(),
                status: "active",
            });

            // Extend TTL for active meeting
            await this.client.expire(this.getTranscriptsKey(meetingUrl), TTL_SETTINGS.ACTIVE_MEETING);
            await this.client.expire(this.getMeetingKey(meetingUrl), TTL_SETTINGS.ACTIVE_MEETING);
            
            return true;
        } catch (error) {
            logger.error("Error storing transcript:", error);
            return false;
        }
    }

    async getTranscriptsByMeeting(meetingUrl: string): Promise<any[]> {
        try {
            const transcripts = await this.client.lRange(
                this.getTranscriptsKey(meetingUrl),
                0,
                -1
            );
            return transcripts.map((t) => JSON.parse(t));
        } catch (error) {
            logger.error("Error getting transcripts:", error);
            return [];
        }
    }

    async completeMeeting(meetingUrl: string): Promise<void> {
        try {
            await this.client.hSet(this.getMeetingKey(meetingUrl), {
                status: "completed",
                completedAt: Date.now(),
            });

            // Set longer TTL for completed meeting
            await this.client.expire(this.getTranscriptsKey(meetingUrl), TTL_SETTINGS.COMPLETED_MEETING);
            await this.client.expire(this.getMeetingKey(meetingUrl), TTL_SETTINGS.COMPLETED_MEETING);
        } catch (error) {
            logger.error("Error completing meeting:", error);
        }
    }

    async deleteMeetingData(meetingUrl: string): Promise<void> {
        try {
            await this.client.del(this.getTranscriptsKey(meetingUrl));
            await this.client.del(this.getMeetingKey(meetingUrl));
        } catch (error) {
            logger.error("Error deleting meeting data:", error);
        }
    }

    async getTranscriptById(id: string): Promise<any | null> {
        try {
            const [meetingUrl, timestamp] = id.split(":");
            const transcripts = await this.getTranscriptsByMeeting(meetingUrl);
            return transcripts.find((t) => t.timestamp === parseInt(timestamp)) || null;
        } catch (error) {
            logger.error("Error getting transcript by ID:", error);
            return null;
        }
    }

    onTranscript(callback: (transcript: Transcript) => void) {
        this.subscriber.subscribe(this.TRANSCRIPT_CHANNEL, (err, count) => {
            if (err) {
                logger.error("Failed to subscribe to transcript channel:", err);
            } else {
                logger.info(`Subscribed to ${count} channels`);
            }
        });
        this.subscriber.on('message', (channel: string, message: string) => {
            if (channel === this.TRANSCRIPT_CHANNEL) {
                try {
                    const transcript = JSON.parse(message);
                    callback({
                        id: `${transcript.meetingUrl}:${transcript.timestamp}`,
                        ...transcript
                    });
                } catch (error) {
                    logger.error("Failed to parse transcript message", error);
                }
            }
        });
    }
}

export const redisService = new RedisService();