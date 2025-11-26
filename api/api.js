const { google } = require('googleapis');
const stream = require('stream');

// --- 1. SETUP AUTH ---
let authClient;
try {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (rawCreds) {
        const credentials = JSON.parse(rawCreds);
        authClient = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
        );
    }
} catch (error) {
    console.error("Auth Error:", error.message);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });
const drive = google.drive({ version: 'v3', auth: authClient });
const spreadsheetId = process.env.SPREADSHEET_ID;
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

// --- 2. HELPER UPLOAD ---
async function uploadToDrive(fileData, folderId) {
    try {
        if (!authClient) throw new Error("Auth belum siap");
        const base64Data = fileData.content.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const response = await drive.files.create({
            requestBody: {
                name: fileData.name,
                parents: folderId ? [folderId] : [],
            },
            media: { mimeType: fileData.type, body: bufferStream },
            fields: 'webViewLink'
        });
        return response.data.webViewLink;
    } catch (error) {
        return "Gagal Upload";
    }
}

// --- 3. MAIN HANDLER (VERCEL VERSION) ---
module.exports = async (req, res) => {
    // Setup CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    try {
        if (authClient) await authClient.authorize();

        // === ACTION: GET DATA ===
        if (action === 'get_data') {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!C2:D', 
            });
            const rows = response.data.values || [];
            const kabs = [...new Set(rows.map(r => r[0]).filter(Boolean))].map(k => ({label: k, value: k})).sort((a,b) => a.label.localeCompare(b.label));
            const opds = [...new Set(rows.map(r => r[1]).filter(Boolean))].map(o => ({label: o, value: o})).sort((a,b) => a.label.localeCompare(b.label));

            return res.status(200).json({ kabupaten: kabs, opd: opds });
        }

        // === ACTION: LOGIN ===
        else if (action === 'login') {
            // Vercel otomatis parse body, jadi kita cek tipe datanya dulu
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { username, password } = body;

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!A2:D', 
            });
            const rows = response.data.values || [];
            const user = rows.find(r => r[0] == username && r[1] == password);

            if (user) {
                return res.status(200).json({ success: true, kabupaten: user[2], opd: user[3] });
            }
            return res.status(401).json({ success: false });
        }

        // === ACTION: GET SOAL ===
        else if (action === 'get_soal') {
            const { kabupaten, opd } = req.query;
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'master_pertanyaan!A2:L',
            });
            const rows = response.data.values || [];
            const result = rows
                .filter(r => (r[1]||'').toLowerCase().trim() === kabupaten.toLowerCase() && (r[2]||'').toLowerCase().trim() === opd.toLowerCase())
                .map(r => ({
                    id: r[3],
                    pertanyaan: r[4],
                    tipe: r[5],
                    bukti_dukung: (r[6] || '').split(/\r?\n/).filter(x => x.trim()),
                    butuh_file: (r[8] === 'Ya' || r[8] === 'TRUE'),
                    judul_section: r[10] || '',
                    sub_judul: r[11] || ''
                }));
            return res.status(200).json({ success: true, data: result });
        }

        // === ACTION: SUBMIT ===
        else if (action === 'submit') {
            // Vercel parsing check
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kabupaten, opd, data_jawaban } = body;

            const rowsToSave = [];
            if (data_jawaban && Array.isArray(data_jawaban)) {
                for (const item of data_jawaban) {
                    let linkFiles = [];
                    if (item.files && item.files.length > 0) {
                        for (const f of item.files) {
                            const link = await uploadToDrive(f, driveFolderId);
                            linkFiles.push(link);
                        }
                    }
                    rowsToSave.push([
                        new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                        kabupaten,
                        opd,
                        item.id_pertanyaan,
                        item.pertanyaan,
                        item.jawaban,
                        item.penjelasan,
                        item.alasan,
                        linkFiles.join(',\n')
                    ]);
                }
                if (rowsToSave.length > 0) {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId,
                        range: 'database!A2',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: rowsToSave }
                    });
                }
            }
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Action salah" });

    } catch (e) {
        console.error("API Error:", e);
        return res.status(500).json({ error: e.message });
    }
};
