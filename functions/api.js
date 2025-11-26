const { google } = require('googleapis');
const stream = require('stream');

// --- 1. SETUP AUTHENTICATION (Lebih Aman) ---
let authClient;
try {
    // Membaca Environment Variable GOOGLE_CREDENTIALS
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (!rawCreds) throw new Error("GOOGLE_CREDENTIALS tidak ditemukan di Environment Variables.");

    const credentials = JSON.parse(rawCreds);
    
    authClient = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
    );
} catch (error) {
    console.error("FATAL ERROR: Gagal setup Google Auth.", error.message);
    // Kita biarkan authClient null, nanti akan dicek di handler
}

const sheets = google.sheets({ version: 'v4', auth: authClient });
const drive = google.drive({ version: 'v3', auth: authClient });

const spreadsheetId = process.env.SPREADSHEET_ID;
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

// --- 2. FUNGSI UPLOAD HELPER ---
async function uploadToDrive(fileData, folderId) {
    try {
        if (!authClient) throw new Error("Auth gagal.");
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
        console.error("Upload Error:", error);
        return "Gagal Upload";
    }
}

// --- 3. MAIN API HANDLER ---
module.exports = async (req, res) => {
    // Setup CORS agar tidak error saat diakses browser
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Cek Kesiapan Auth
    if (!authClient) {
        return res.status(500).json({ error: "Server Error: Konfigurasi Auth Gagal." });
    }

    const { action } = req.query;

    try {
        await authClient.authorize(); // Pastikan token aktif

        // === ACTION: GET DATA (Untuk Dropdown Login) ===
        if (action === 'get_data') {
            // Ambil kolom C (Kabupaten) dan D (OPD) dari sheet 'auth'
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!C2:D', 
            });

            const rows = response.data.values || [];
            
            // Filter data unik dan buang yang kosong
            const kabSet = new Set();
            const opdSet = new Set();

            rows.forEach(row => {
                if (row[0]) kabSet.add(row[0].trim());
                if (row[1]) opdSet.add(row[1].trim());
            });

            // Ubah ke format array objek untuk frontend
            const kabs = Array.from(kabSet).sort().map(k => ({ label: k, value: k }));
            const opds = Array.from(opdSet).sort().map(o => ({ label: o, value: o }));

            return res.status(200).json({ kabupaten: kabs, opd: opds });
        }

        // === ACTION: LOGIN ===
        else if (action === 'login') {
            const body = req.body ? JSON.parse(req.body) : {};
            const { username, password } = body;

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!A2:D', 
            });

            const rows = response.data.values || [];
            // Cocokkan username (A) dan password (B)
            const user = rows.find(r => r[0] == username && r[1] == password);

            if (user) {
                return res.status(200).json({ 
                    success: true, 
                    kabupaten: user[2], 
                    opd: user[3] 
                });
            }
            return res.status(401).json({ success: false, message: 'Login Gagal' });
        }

        // === ACTION: GET SOAL (Filter berdasarkan OPD) ===
        else if (action === 'get_soal') {
            const { kabupaten, opd } = req.query;
            if(!kabupaten || !opd) return res.status(400).json({ error: "Parameter kurang" });

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'master_pertanyaan!A2:L',
            });

            const rows = response.data.values || [];
            // Filter: Kolom B (Index 1) = Kab, Kolom C (Index 2) = OPD
            const filtered = rows.filter(r => {
                const rKab = (r[1] || '').toLowerCase().trim();
                const rOpd = (r[2] || '').toLowerCase().trim();
                return rKab === kabupaten.toLowerCase() && rOpd === opd.toLowerCase();
            });

            const result = filtered.map(r => ({
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
            const body = req.body ? JSON.parse(req.body) : {};
            const { kabupaten, opd, data_jawaban } = body;

            if (!data_jawaban || !Array.isArray(data_jawaban)) {
                return res.status(400).json({ error: 'Data jawaban invalid' });
            }

            const rowsToSave = [];
            for (const item of data_jawaban) {
                let linkFiles = [];
                // Upload file jika ada
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
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Action tidak dikenal" });

    } catch (e) {
        console.error("API RUNTIME ERROR:", e);
        return res.status(500).json({ error: e.message });
    }
};
