import Bull from 'bull';
import dbClient from './db.js';

// Existing fileQueue configuration
const fileQueue = new Bull('fileQueue', {
    redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
    },
});

// New userQueue configuration
const userQueue = new Bull('userQueue', {
    redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
    },
});

// File processing worker
fileQueue.process(async (job) => {
    const { fileId, userId } = job.data;

    if (!fileId) {
        throw new Error('Missing fileId');
    }
    if (!userId) {
        throw new Error('Missing userId');
    }

    const file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(fileId), userId });

    if (!file) {
        throw new Error('File not found');
    }

    if (file.type !== 'image') {
        throw new Error('File is not an image');
    }

    const { localPath } = file;
    const sizes = [500, 250, 100];

    for (const size of sizes) {
        const thumbnailPath = `${localPath}_${size}`;

        // Generate thumbnail
        try {
            const thumbnail = await require('image-thumbnail')(localPath, { width: size });
            require('fs').writeFileSync(thumbnailPath, thumbnail);
        } catch (error) {
            throw new Error(`Error generating thumbnail: ${error.message}`);
        }
    }
});

// User processing worker
userQueue.process(async (job) => {
    const { userId } = job.data;

    if (!userId) {
        throw new Error('Missing userId');
    }

    const user = await dbClient.db.collection('users').findOne({ _id: new ObjectId(userId) });

    if (!user) {
        throw new Error('User not found');
    }

    console.log(`Welcome ${user.email}!`);

});

export { fileQueue, userQueue };