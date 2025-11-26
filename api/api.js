const { google } = require('googleapis');

// --- 1. SETUP AUTH ---
let authClient;
try {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    // Bersihkan private key dari karakter baris baru (\n) yang sering rusak
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (clientEmail && privateKey) {
        authClient = new google.auth.JWT(
            clientEmail, null, privateKey,
            ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
        );
    }
} catch (error) {
    console.error("Auth Setup Error:", error.message);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });
const spreadsheetId = process.env.SPREADSHEET_ID;
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

// --- 2. HELPER UPLOAD ---
async function uploadToDrive(fileData, folderId) {
    try {
        if (!authClient) throw new Error("Auth belum siap");
        const { google } = require('googleapis');
        const stream = require('stream');
        
        const drive = google.drive({ version: 'v3', auth: authClient });
        const base64Data = fileData.content.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const response = await drive.files.create({
            requestBody: { name: fileData.name, parents: folderId ? [folderId] : [] },
            media: { mimeType: fileData.type, body: bufferStream },
            fields: 'webViewLink'
        });
        return response.data.webViewLink;
    } catch (error) {
        return "Gagal Upload";
    }
}

// --- 3. MAIN API HANDLER ---
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.query;

    try {
        if (!authClient) return res.status(500).json({ error: "Auth Gagal. Cek Env Var." });
        await authClient.authorize();

        // === ACTION: GET DATA (DROPDOWN) ===
        if (action === 'get_data') {
            // Ambil Kolom A, B, C (Kabupaten, OPD, Password)
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!A2:C', 
            });
            const rows = response.data.values || [];
            
            // --- MAPPING SESUAI INSTRUKSI ANDA ---
            // Index 0 = Kolom A = Kabupaten
            // Index 1 = Kolom B = OPD
            
            const kabs = [...new Set(rows.map(r => r[0]).filter(k => k && k.trim() !== ''))].sort();
            const opds = [...new Set(rows.map(r => r[1]).filter(o => o && o.trim() !== ''))].sort();

            return res.status(200).json({
                kabupaten: kabs.map(k => ({ label: k, value: k })),
                opd: opds.map(o => ({ label: o, value: o }))
            });
        }

        // === ACTION: LOGIN ===
        else if (action === 'login') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { username, password } = body; // username = Kabupaten

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!A2:C', 
            });
            const rows = response.data.values || [];
            
            // Logika Login:
            // Cek Kolom A (Index 0) == Username (Kabupaten)
            // Cek Kolom C (Index 2) == Password
            const user = rows.find(r => r[0] == username && r[2] == password);

            if (user) {
                // Return data: Kabupaten (Index 0) dan OPD (Index 1)
                return res.status(200).json({ success: true, kabupaten: user[0], opd: user[1] });
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
                .filter(r => (r[1]||'').trim().toLowerCase() === kabupaten.trim().toLowerCase() && 
                             (r[2]||'').trim().toLowerCase() === opd.trim().toLowerCase())
                .map(r => ({
                    id: r[3], pertanyaan: r[4], tipe: r[5],
                    bukti_dukung: (r[6] || '').split(/\r?\n/).filter(Boolean),
                    butuh_file: (r[8] === 'Ya' || r[8] === 'TRUE'),
                    judul_section: r[10] || '', sub_judul: r[11] || ''
                }));

            return res.status(200).json({ success: true, data: result });
        }

        // === ACTION: SUBMIT ===
        else if (action === 'submit') {
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
                        kabupaten, opd, item.id_pertanyaan, item.pertanyaan,
                        item.jawaban, item.penjelasan, item.alasan, linkFiles.join(',\n')
                    ]);
                }
                if (rowsToSave.length > 0) {
                    await sheets.spreadsheets.values.append({
                        spreadsheetId, range: 'database!A2',
                        valueInputOption: 'USER_ENTERED', requestBody: { values: rowsToSave }
                    });
                }
            }
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Action Unknown" });

    } catch (e) {
        console.error("API Error:", e);
        return res.status(500).json({ error: e.message });
    }
};
