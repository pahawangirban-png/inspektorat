const { google } = require('googleapis');

// --- SETUP AUTH ---
// Kode ini aman, jika Env Var salah dia hanya akan diam, tidak bikin server meledak/crash.
let authClient;
try {
    if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        authClient = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
        );
    }
} catch (error) {
    console.error("Auth Error (Cek Env Var):", error.message);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });
const spreadsheetId = process.env.SPREADSHEET_ID;

module.exports = async (req, res) => {
    // 1. SETUP HEADER (PENTING AGAR TIDAK BLOKIR KONEKSI)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Jawab "OK" jika browser hanya mengecek koneksi (Preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    try {
        // Cek apakah Auth berhasil dibaca
        if (!authClient) {
            throw new Error("Kredensial Google (Env Variables) belum disetting di Vercel!");
        }
        await authClient.authorize();

        // === 1. ACTION: GET DATA (Untuk Dropdown) ===
        if (action === 'get_data') {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!C2:D', 
            });
            
            const rows = response.data.values || [];
            
            // Ambil data unik
            const kabs = [...new Set(rows.map(r => r[0]).filter(Boolean))].sort();
            const opds = [...new Set(rows.map(r => r[1]).filter(Boolean))].sort();

            // Kirim ke Frontend
            return res.status(200).json({
                kabupaten: kabs.map(k => ({ label: k, value: k })),
                opd: opds.map(o => ({ label: o, value: o }))
            });
        }

        // === 2. ACTION: LOGIN ===
        else if (action === 'login') {
            // Vercel otomatis membaca body JSON
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

        // === 3. ACTION: GET SOAL ===
        else if (action === 'get_soal') {
            const { kabupaten, opd } = req.query;
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'master_pertanyaan!A2:L',
            });
            const rows = response.data.values || [];
            
            // Filter sederhana
            const result = rows
                .filter(r => (r[1]||'').toLowerCase().trim() === kabupaten.toLowerCase() && (r[2]||'').toLowerCase().trim() === opd.toLowerCase())
                .map(r => ({
                    id: r[3], pertanyaan: r[4], tipe: r[5],
                    bukti_dukung: (r[6] || '').split(/\r?\n/).filter(Boolean),
                    butuh_file: (r[8] === 'Ya' || r[8] === 'TRUE'),
                    judul_section: r[10] || '', sub_judul: r[11] || ''
                }));

            return res.status(200).json({ success: true, data: result });
        }

        return res.status(400).json({ error: "Action tidak dikenal" });

    } catch (e) {
        // Jika error, kirim pesan jelas ke frontend agar kita tahu salahnya dimana
        console.error("API Error:", e);
        return res.status(500).json({ error: e.message });
    }
};
