import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

class DBClient {
    constructor() {
        const host = process.env.DB_HOST || 'localhost';
        const port = process.env.DB_PORT || 27017;
        const database = process.env.DB_DATABASE || 'files_manager';
        const url = `mongodb://${host}:${port}`;

        this.client = new MongoClient(url, { useNewUrlParser: true, useUnifiedTopology: true });
        this.client.connect().then(() => {
            this.db = this.client.db(database);
        }).catch((err) => {
            console.error('MongoDB Client Error', err);
        });
    }

    isAlive() {
        return this.client.topology && this.client.topology.isConnected();
    }

    async nbUsers() {
        try {
            const usersCollection = this.db.collection('users');
            const count = await usersCollection.countDocuments();
            return count;
        } catch (err) {
            console.error('Error counting users', err);
            return 0;
        }
    }

    async nbFiles() {
        try {
            const filesCollection = this.db.collection('files');
            const count = await filesCollection.countDocuments();
            return count;
        } catch (err) {
            console.error('Error counting files', err);
            return 0;
        }
    }
}

const dbClient = new DBClient();
export default dbClient;