const { google } = require('googleapis');

// --- PENGAMAN ENV VARIABLE ---
let authClient;
let authError = null; // Simpan pesan error jika ada

try {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (rawCreds) {
        // INI BAGIAN YANG SERING BIKIN SYNTAX ERROR
        const credentials = JSON.parse(rawCreds); 
        authClient = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
        );
    } else {
        authError = "GOOGLE_CREDENTIALS Kosong/Tidak Ditemukan di Vercel Settings.";
    }
} catch (error) {
    // TANGKAP SYNTAX ERROR DISINI
    console.error("Gagal Parse JSON:", error.message);
    authError = "FORMAT JSON SALAH (SyntaxError). Cek Environment Variables Anda. Pastikan copy-paste JSON lengkap dari '{' sampai '}'.";
}

const sheets = google.sheets({ version: 'v4', auth: authClient });
const spreadsheetId = process.env.SPREADSHEET_ID;

module.exports = async (req, res) => {
    // Headers Wajib
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // JIKA AUTH ERROR DARI AWAL, LANGSUNG LAPOR
    if (authError) {
        return res.status(500).json({ 
            error: "KONFIGURASI AUTH ERROR", 
            detail: authError 
        });
    }

    const { action } = req.query;

    try {
        if (!authClient) throw new Error("Auth Client belum siap.");
        await authClient.authorize();

        if (action === 'get_data') {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!C2:D', 
            });
            const rows = response.data.values || [];
            const kabs = [...new Set(rows.map(r => r[0]).filter(Boolean))].map(k => ({label: k, value: k}));
            const opds = [...new Set(rows.map(r => r[1]).filter(Boolean))].map(o => ({label: o, value: o}));
            return res.status(200).json({ kabupaten: kabs, opd: opds });
        }
        
        else if (action === 'login') {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { username, password } = body;
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!A2:D', 
            });
            const rows = response.data.values || [];
            const user = rows.find(r => r[0] == username && r[1] == password);
            if (user) return res.status(200).json({ success: true, kabupaten: user[2], opd: user[3] });
            return res.status(401).json({ success: false });
        }
        
        // ... (Kode get_soal dan submit bisa pakai yang lama) ...

        return res.status(400).json({ error: "Action tidak dikenal" });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
