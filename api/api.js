const { google } = require('googleapis');
// const stream = require('stream'); // Opsional jika belum upload file

// --- SETUP AUTH ---
// Menggunakan Environment Variable
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
    console.error("Auth Error:", error);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });
const spreadsheetId = process.env.SPREADSHEET_ID;

module.exports = async (req, res) => {
    // 1. CORS HEADERS (Agar browser tidak memblokir)
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
            
            // Logika asli Anda untuk filter unik
            const kabs = [...new Set(rows.map(r => r[0]).filter(Boolean))].map(k => ({label: k, value: k}));
            const opds = [...new Set(rows.map(r => r[1]).filter(Boolean))].map(o => ({label: o, value: o}));

            return res.status(200).json({ kabupaten: kabs, opd: opds });
        }

        // === ACTION: LOGIN ===
        else if (action === 'login') {
            // PERBAIKAN PENTING UNTUK VERCEL:
            // Cek apakah body sudah berupa object atau masih string
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
        
        // ... (Kode action lain seperti get_soal biarkan sesuai logika Anda) ...

        return res.status(400).json({ error: "Action tidak dikenal" });

    } catch (e) {
        console.error("API Error:", e);
        return res.status(500).json({ error: e.message });
    }
};
