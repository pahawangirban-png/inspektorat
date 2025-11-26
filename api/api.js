const { google } = require('googleapis');
// const stream = require('stream'); // Hapus dulu biar simpel

let authClient;
try {
    if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        authClient = new google.auth.JWT(
            credentials.client_email, null, credentials.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
        );
    }
} catch (e) { console.error("Auth Err:", e); }

const sheets = google.sheets({ version: 'v4', auth: authClient });

module.exports = async (req, res) => {
    // Header Wajib
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (!authClient) throw new Error("Auth Gagal. Cek Env Variables.");
        await authClient.authorize();

        if (req.query.action === 'get_data') {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'auth!C2:D', 
            });
            const rows = response.data.values || [];
            // Kirim data dummy dulu kalau kosong biar gak error
            return res.status(200).json({ 
                kabupaten: rows.length ? rows.map(r=>({label:r[0], value:r[0]})) : [], 
                opd: [] 
            });
        }
        return res.status(200).json({ message: "Server Hidup!" });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
