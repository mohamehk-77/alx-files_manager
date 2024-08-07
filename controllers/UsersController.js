import sha1 from 'sha1';
import { ObjectId } from 'mongodb'; // Import ObjectId from mongodb
import dbClient from '../utils/db.js';
import redisClient from '../utils/redis.js';

class UsersController {
    static async postNew(req, res) {
        const { email, password } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Missing email' });
        }

        if (!password) {
            return res.status(400).json({ error: 'Missing password' });
        }

        const userExists = await dbClient.db.collection('users').findOne({ email });

        if (userExists) {
            return res.status(400).json({ error: 'Already exists' });
        }

        const hashedPassword = sha1(password);
        const newUser = {
            email,
            password: hashedPassword,
        };

        const result = await dbClient.db.collection('users').insertOne(newUser);

        return res.status(201).json({ id: result.insertedId, email });
    }

    static async getMe(req, res) {
        const token = req.headers['x-token'];

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const tokenKey = `auth_${token}`;
        const userId = await redisClient.get(tokenKey);

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await dbClient.db.collection('users').findOne({ _id: new ObjectId(userId) });

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        return res.status(200).json({ id: user._id.toString(), email: user.email });
    }
    static async postUser(req, res) {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Missing email or password' });
        }

        const existingUser = await dbClient.db.collection('users').findOne({ email });

        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const newUser = {
            email,
            password,
        };

        const result = await dbClient.db.collection('users').insertOne(newUser);
        const userId = result.insertedId;

        await userQueue.add({ userId });

        return res.status(201).json({ id: userId, email });
    }
}

export default UsersController;