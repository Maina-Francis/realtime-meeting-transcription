import express from 'express';
import { RedisService } from '../services/redis';
import { createLogger } from '../utils';

const router = express.Router();
const redisService = new RedisService();
const logger = createLogger('API');

// Get all transcripts for a bot
router.get('/:meetingUrl', async (req, res) => {
    try {
        const { meetingUrl } = req.params;
        const decodedUrl = decodeURIComponent(meetingUrl);
        const transcripts = await redisService.getTranscriptsByMeeting(decodedUrl);
        res.json(transcripts);
    } catch (error) {
        logger.error('Error getting transcripts:', error);
        res.status(500).json({ error: 'Failed to get transcripts' });
    }
});

// Get a specific transcript by ID
router.get('/id/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const transcript = await redisService.getTranscriptById(id);
        if (!transcript) {
            return res.status(404).json({ error: 'Transcript not found' });
        }
        res.json(transcript);
    } catch (error) {
        logger.error('Error getting transcript:', error);
        res.status(500).json({ error: 'Failed to get transcript' });
    }
});

// Delete all transcripts for a meeting
router.delete('/:meetingUrl', async (req, res) => {
    try {
        const { meetingUrl } = req.params;
        const decodedUrl = decodeURIComponent(meetingUrl);
        await redisService.deleteMeetingData(decodedUrl);
        res.json({ message: 'Transcripts deleted successfully' });
    } catch (error) {
        logger.error('Error deleting transcripts:', error);
        res.status(500).json({ error: 'Failed to delete transcripts' });
    }
});

export default router; 