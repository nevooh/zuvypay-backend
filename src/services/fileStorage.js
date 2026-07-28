const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function saveFile(key, buffer) {
    const dataUri = `data:application/octet-stream;base64,${buffer.toString('base64')}`;
    await cloudinary.uploader.upload(dataUri, {
        public_id: key,
        resource_type: 'raw',
        overwrite: true
    });
    return key;
}

/**
 * The actual Cloudinary link for a stored file. Pure URL construction
 * (cloud_name + key), no network call — safe/cheap to call anywhere you
 * want to show someone the real link.
 */
function getFileUrl(key) {
    return cloudinary.url(key, { resource_type: 'raw', type: 'upload' });
}

async function getFile(key) {
    const url = cloudinary.url(key, { resource_type: 'raw', type: 'upload' });
    const response = await fetch(url);

    if (!response.ok) {
        const err = new Error(`File not found in Cloudinary: ${key}`);
        err.code = 'ENOENT';
        throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function copyFile(sourceKey, destKey) {
    const buffer = await getFile(sourceKey);
    return saveFile(destKey, buffer);
}

module.exports = { saveFile, getFile, copyFile, getFileUrl };