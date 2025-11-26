const { google } = require('googleapis');
// const stream = require('stream'); // Aktifkan jika nanti mau upload file

// --- 1. SETUP AUTH (METODE BARU: TERPISAH) ---
let authClient;
try {
    // Ambil variabel yang sudah dipisah
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    // Trik Khusus: Mengganti karakter baris baru (\n) yang sering rusak saat di-copy ke Vercel
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (clientEmail && privateKey) {
        authClient = new google.auth.JWT(
            clientEmail,
            null,
            privateKey,
            ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
        );
    } else {
        console.error("Error: GOOGLE_CLIENT_EMAIL atau GOOGLE_PRIVATE_KEY belum diisi di Vercel.");
    }
} catch (error) {
    console.error("Auth Setup Error:", error.message);
}

const sheets = google.sheets({ version: 'v4', auth: authClient });
const spreadsheetId = process.env.SPREADSHEET_ID;
// const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID; // Aktifkan nanti

module.exports = async (req, res) => {
    // --- HEADER CORS (Agar browser tidak error) ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Preflight Request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action } = req.query;

    try {
        // Cek apakah Auth berhasil
        if (!authClient) {
            return res.status(500).json({ 
                error: "Konfigurasi Server Belum Lengkap", 
                detail: "Cek Environment Variables: GOOGLE_CLIENT_EMAIL & GOOGLE_PRIVATE_KEY" 
            });
        }
        
        await authClient.authorize();

        // === 1. ACTION: GET DATA (Dropdown) ===
        if (action === 'get_data') {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!C2:D', 
            });
            const rows = response.data.values || [];
            
            // Filter Unik
            const kabs = [...new Set(rows.map(r => r[0]).filter(Boolean))].map(k => ({label: k, value: k})).sort((a,b) => a.label.localeCompare(b.label));
            const opds = [...new Set(rows.map(r => r[1]).filter(Boolean))].map(o => ({label: o, value: o})).sort((a,b) => a.label.localeCompare(b.label));

            return res.status(200).json({ kabupaten: kabs, opd: opds });
        }

        // === 2. ACTION: LOGIN ===
        else if (action === 'login') {
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
            return res.status(401).json({ success: false, message: "Username/Password Salah" });
        }

        // === 3. ACTION: GET SOAL ===
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
                    id: r[3], pertanyaan: r[4], tipe: r[5],
                    bukti_dukung: (r[6] || '').split(/\r?\n/).filter(Boolean),
                    butuh_file: (r[8] === 'Ya' || r[8] === 'TRUE'),
                    judul_section: r[10] || '', sub_judul: r[11] || ''
                }));

            return res.status(200).json({ success: true, data: result });
        }
        
        // (Action Submit bisa ditambahkan nanti setelah ini stabil)

        return res.status(400).json({ error: "Action tidak dikenal" });

    } catch (e) {
        console.error("API Error:", e);
        return res.status(500).json({ error: "Terjadi kesalahan di server.", detail: e.message });
    }
};
