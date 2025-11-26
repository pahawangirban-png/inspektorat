const { google } = require('googleapis');

// 1. SETUP AUTH MENGGUNAKAN 'GOOGLE_CREDENTIALS'
// Kita parse string JSON dari Env Variable Netlify menjadi Object
let credentials;
try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} catch (e) {
    console.error("Gagal membaca GOOGLE_CREDENTIALS. Pastikan format JSON benar.", e);
    credentials = {}; // Fallback agar tidak crash total saat start
}

// Konfigurasi Auth Client
const auth = new google.auth.JWT(
    credentials.client_email, // Ambil email dari JSON
    null,
    credentials.private_key,  // Ambil private key dari JSON
    [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
);

const sheets = google.sheets({ version: 'v4', auth });
// Variabel lain tetap diambil dari Env terpisah sesuai screenshot Anda
const spreadsheetId = process.env.SPREADSHEET_ID;
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

module.exports = async (req, res) => {
    // 2. SETUP HEADER CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { action } = req.query;

    try {
        await auth.authorize(); // Verifikasi koneksi ke Google

        // ---------------------------------------------------------
        // ACTION: GET_SOAL (Mengambil pertanyaan spesifik OPD)
        // ---------------------------------------------------------
        if (action === 'get_soal') {
            const { kabupaten, opd } = req.query;

            if (!kabupaten || !opd) {
                return res.status(400).json({ error: 'Kabupaten dan OPD diperlukan' });
            }

            // Baca sheet 'master_pertanyaan'
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'master_pertanyaan!A2:L', 
            });

            const rows = response.data.values || [];

            // FILTER DATA
            // Index 1: Kabupaten, Index 2: OPD
            const filteredRows = rows.filter(row => {
                const rowKab = (row[1] || '').trim().toLowerCase();
                const rowOpd = (row[2] || '').trim().toLowerCase();
                return rowKab === kabupaten.toLowerCase() && rowOpd === opd.toLowerCase();
            });

            // FORMAT JSON UNTUK FRONTEND
            const questions = filteredRows.map(row => {
                // Index 6: Bukti Dukung (misal dipisah enter)
                const rawBukti = row[6] || ''; 
                const listBukti = rawBukti.split(/\r?\n/).filter(t => t.trim().length > 0);

                return {
                    id: row[3],             // id_pertanyaan
                    pertanyaan: row[4],     // pertanyaan
                    tipe: row[5],           // tipe_jawaban
                    bukti_dukung: listBukti,// array string
                    butuh_file: (row[8] === 'Ya' || row[8] === 'TRUE'), // file_upload
                    judul_section: row[10] || '', // judul
                    sub_judul: row[11] || ''      // sub_judul
                };
            });

            return res.status(200).json({ success: true, data: questions });
        }

        // ---------------------------------------------------------
        // ACTION: LOGIN
        // ---------------------------------------------------------
        else if (action === 'login') {
            const body = req.body ? JSON.parse(req.body) : {};
            const { username, password } = body;

            // Ambil data user dari sheet 'auth'
            // Asumsi kolom: A=Username, B=Password, C=Kabupaten, D=OPD
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!A2:D', 
            });

            const rows = response.data.values || [];
            
            // Cari user yang cocok
            const user = rows.find(row => row[0] == username && row[1] == password);

            if (user) {
                return res.status(200).json({ 
                    success: true, 
                    kabupaten: user[2], 
                    opd: user[3] 
                });
            } else {
                return res.status(401).json({ success: false, message: 'Login gagal' });
            }
        }

        // ---------------------------------------------------------
        // ACTION: GET_DATA (Dropdown Awal)
        // ---------------------------------------------------------
        else if (action === 'get_data') {
            // Ambil list unik dari sheet auth untuk dropdown login
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!C2:D', 
            });
            
            const rows = response.data.values || [];
            
            const kabs = [...new Set(rows.map(r => r[0]).filter(Boolean))].map(k => ({label: k, value: k}));
            const opds = [...new Set(rows.map(r => r[1]).filter(Boolean))].map(o => ({label: o, value: o}));

            return res.status(200).json({
                kabupaten: kabs,
                opd: opds
            });
        }
        
        else {
            res.status(400).json({ error: 'Action tidak valid' });
        }

    } catch (error) {
        console.error("API Error Details:", error);
        res.status(500).json({ error: error.message });
    }
};
