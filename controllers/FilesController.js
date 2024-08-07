import { ObjectId } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import dbClient from "../utils/db.js";
import redisClient from "../utils/redis.js";
import fileQueue from '../utils/queue.js';
import mime from 'mime-types';

class FilesController {
    static async postUpload(req, res) {
        const { name, type, parentId, isPublic = false, data } = req.body;
        const token = req.headers["x-token"];

        if (!token) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const tokenKey = `auth_${token}`;
        const userId = await redisClient.get(tokenKey);

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!name) {
            return res.status(400).json({ error: "Missing name" });
        }

        if (!type || !["folder", "file", "image"].includes(type)) {
            return res.status(400).json({ error: "Missing or invalid type" });
        }

        if (type !== "folder" && !data) {
            return res.status(400).json({ error: "Missing data" });
        }

        if (parentId) {
            const parentFile = await dbClient.db
                .collection("files")
                .findOne({ _id: new ObjectId(parentId) });

            if (!parentFile) {
                return res.status(400).json({ error: "Parent not found" });
            }

            if (parentFile.type !== "folder") {
                return res.status(400).json({ error: "Parent is not a folder" });
            }
        }

        const folderPath = process.env.FOLDER_PATH || "/tmp/files_manager";
        const filePath = path.join(folderPath, uuidv4());

        if (type !== "folder") {
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
            }

            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
        }

        const fileDoc = {
            userId,
            name,
            type,
            isPublic,
            parentId: parentId || 0,
            localPath: type !== "folder" ? filePath : null,
        };

        const result = await dbClient.db.collection("files").insertOne(fileDoc);

        return res.status(201).json({ id: result.insertedId, ...fileDoc });
    }

    static async getShow(req, res) {
        const token = req.headers["x-token"];
        const { id } = req.params;

        if (!token) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const tokenKey = `auth_${token}`;
        const userId = await redisClient.get(tokenKey);

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const file = await dbClient.db
            .collection("files")
            .findOne({ _id: new ObjectId(id), userId });

        if (!file) {
            return res.status(404).json({ error: "Not found" });
        }

        return res.status(200).json(file);
    }
    static async getIndex(req, res) {
        const token = req.headers["x-token"];
        const { parentId = 0, page = 0 } = req.query;
        const pageSize = 20;
        const skip = page * pageSize;

        if (!token) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const tokenKey = `auth_${token}`;
        const userId = await redisClient.get(tokenKey);

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const files = await dbClient.db
            .collection("files")
            .find({ userId })
            .skip(skip)
            .limit(pageSize)
            .toArray();


        return res.status(200).json(files);
    }
    static async putPublish(req, res) {
        const token = req.headers["x-token"];
        const { id } = req.params;

        if (!token) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const tokenKey = `auth_${token}`;
        const userId = await redisClient.get(tokenKey);

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const file = await dbClient.db
            .collection("files")
            .findOne({ _id: new ObjectId(id), userId });

        if (!file) {
            return res.status(404).json({ error: "Not found" });
        }

        const result = await dbClient.db
            .collection("files")
            .updateOne(
                { _id: new ObjectId(id), userId },
                { $set: { isPublic: true } }
            );

        if (result.modifiedCount === 0) {
            return res.status(500).json({ error: "Failed to update the file" });
        }

        const updatedFile = await dbClient.db
            .collection("files")
            .findOne({ _id: new ObjectId(id), userId });

        return res.status(200).json(updatedFile);
    }

    static async putUnpublish(req, res) {
        const token = req.headers["x-token"];
        const { id } = req.params;

        if (!token) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const tokenKey = `auth_${token}`;
        const userId = await redisClient.get(tokenKey);

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const file = await dbClient.db
            .collection("files")
            .findOne({ _id: new ObjectId(id), userId });

        if (!file) {
            return res.status(404).json({ error: "Not found" });
        }

        const result = await dbClient.db
            .collection("files")
            .updateOne(
                { _id: new ObjectId(id), userId },
                { $set: { isPublic: false } }
            );

        if (result.modifiedCount === 0) {
            return res.status(500).json({ error: "Failed to update the file" });
        }

        const updatedFile = await dbClient.db
            .collection("files")
            .findOne({ _id: new ObjectId(id), userId });

        return res.status(200).json(updatedFile);
    }
    static async getFile(req, res) {
        const token = req.headers['x-token'];
        const { id } = req.params;
        const { size } = req.query;

        // Retrieve file document
        const file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(id) });

        if (!file) {
            return res.status(404).json({ error: 'Not found' });
        }

        // Check if file is public or user is authenticated and is the owner
        if (!file.isPublic) {
            if (!token) {
                return res.status(404).json({ error: 'Not found' });
            }

            const tokenKey = `auth_${token}`;
            const userId = await redisClient.get(tokenKey);

            if (!userId || file.userId !== userId) {
                return res.status(404).json({ error: 'Not found' });
            }
        }

        // Check if the type is folder
        if (file.type === 'folder') {
            return res.status(400).json({ error: 'A folder doesn\'t have content' });
        }

        // Determine the correct file path based on size
        let filePath = file.localPath;

        if (size) {
            const validSizes = [500, 250, 100];
            const numericSize = parseInt(size, 10);

            if (!validSizes.includes(numericSize)) {
                return res.status(400).json({ error: 'Invalid size' });
            }

            filePath = `${file.localPath}_${numericSize}`;
        }

        // Check if the file exists locally
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Not found' });
        }

        // Determine MIME type
        const mimeType = mime.lookup(file.name);
        if (!mimeType) {
            return res.status(500).json({ error: 'Unable to determine MIME type' });
        }

        // Send file content
        res.setHeader('Content-Type', mimeType);
        fs.createReadStream(filePath).pipe(res);
    }
    static async postUpload(req, res) {
        const file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(id), userId });
        const { name, type, parentId, isPublic = false, data } = req.body;
        const token = req.headers['x-token'];

        if (!token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const tokenKey = `auth_${token}`;
        const userId = await redisClient.get(tokenKey);

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!name) {
            return res.status(400).json({ error: 'Missing name' });
        }

        if (!type || !['folder', 'file', 'image'].includes(type)) {
            return res.status(400).json({ error: 'Missing or invalid type' });
        }

        if (type !== 'folder' && !data) {
            return res.status(400).json({ error: 'Missing data' });
        }

        if (parentId) {
            const parentFile = await dbClient.db.collection('files').findOne({ _id: new ObjectId(parentId) });

            if (!parentFile) {
                return res.status(400).json({ error: 'Parent not found' });
            }

            if (parentFile.type !== 'folder') {
                return res.status(400).json({ error: 'Parent is not a folder' });
            }
        }

        const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
        const filePath = path.join(folderPath, uuidv4());

        if (type !== 'folder') {
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
            }

            fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
        }

        const fileDoc = {
            userId,
            name,
            type,
            isPublic,
            parentId: parentId || 0,
            localPath: type !== 'folder' ? filePath : null,
        };

        const result = await dbClient.db.collection('files').insertOne(fileDoc);

        // Add job to the queue for image thumbnail processing if the file is an image
        if (type === 'image') {
            await fileQueue.add({ fileId: result.insertedId, userId });
        }

        return res.status(201).json({ id: result.insertedId, ...fileDoc });
    }
}

export default FilesController;