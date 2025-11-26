const { google } = require('googleapis');
const stream = require('stream'); // Module bawaan Node.js untuk handle upload file

// 1. SETUP AUTH & CONFIG
let credentials;
try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} catch (e) {
    console.error("Gagal membaca GOOGLE_CREDENTIALS. Pastikan format JSON benar.", e);
    credentials = {};
}

const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
);

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

const spreadsheetId = process.env.SPREADSHEET_ID;
// ID Folder Drive untuk menyimpan bukti dukung (Pastikan variabel ini ada di Netlify)
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID; 

// --- HELPER FUNCTION: UPLOAD KE DRIVE ---
async function uploadToDrive(fileData, folderId) {
    try {
        // fileData.content adalah base64 string (data:image/png;base64,.....)
        // Kita perlu membuang header "data:xxx;base64,"
        const base64Data = fileData.content.split(',')[1]; 
        const buffer = Buffer.from(base64Data, 'base64');
        
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const response = await drive.files.create({
            requestBody: {
                name: fileData.name,
                parents: folderId ? [folderId] : [], // Simpan di folder khusus jika ada ID-nya
            },
            media: {
                mimeType: fileData.type,
                body: bufferStream
            },
            fields: 'id, webViewLink' // Kita minta ID dan Link file
        });

        return response.data.webViewLink; // Kembalikan Link File
    } catch (error) {
        console.error("Gagal upload file:", fileData.name, error);
        return `Error Upload: ${fileData.name}`;
    }
}

// --- MAIN HANDLER ---
module.exports = async (req, res) => {
    // Setup CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { action } = req.query;

    try {
        await auth.authorize();

        // ---------------------------------------------------------
        // ACTION: LOGIN
        // ---------------------------------------------------------
        if (action === 'login') {
            const body = req.body ? JSON.parse(req.body) : {};
            const { username, password } = body;

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!A2:D', 
            });

            const rows = response.data.values || [];
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
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'auth!C2:D', 
            });
            const rows = response.data.values || [];
            const kabs = [...new Set(rows.map(r => r[0]).filter(Boolean))].map(k => ({label: k, value: k}));
            const opds = [...new Set(rows.map(r => r[1]).filter(Boolean))].map(o => ({label: o, value: o}));

            return res.status(200).json({ kabupaten: kabs, opd: opds });
        }

        // ---------------------------------------------------------
        // ACTION: GET_SOAL
        // ---------------------------------------------------------
        else if (action === 'get_soal') {
            const { kabupaten, opd } = req.query;
            if (!kabupaten || !opd) return res.status(400).json({ error: 'Data tidak lengkap' });

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: 'master_pertanyaan!A2:L', 
            });

            const rows = response.data.values || [];
            const filteredRows = rows.filter(row => {
                const rowKab = (row[1] || '').trim().toLowerCase();
                const rowOpd = (row[2] || '').trim().toLowerCase();
                return rowKab === kabupaten.toLowerCase() && rowOpd === opd.toLowerCase();
            });

            const questions = filteredRows.map(row => {
                const rawBukti = row[6] || ''; 
                const listBukti = rawBukti.split(/\r?\n/).filter(t => t.trim().length > 0);
                return {
                    id: row[3],
                    pertanyaan: row[4],
                    tipe: row[5],
                    bukti_dukung: listBukti,
                    butuh_file: (row[8] === 'Ya' || row[8] === 'TRUE'),
                    judul_section: row[10] || '',
                    sub_judul: row[11] || ''
                };
            });

            return res.status(200).json({ success: true, data: questions });
        }

        // ---------------------------------------------------------
        // ACTION: SUBMIT (SIMPAN JAWABAN + UPLOAD FILE)
        // ---------------------------------------------------------
        else if (action === 'submit') {
            const body = req.body ? JSON.parse(req.body) : {};
            const { kabupaten, opd, data_jawaban } = body;

            if (!data_jawaban || !Array.isArray(data_jawaban)) {
                return res.status(400).json({ error: 'Format data jawaban salah' });
            }

            const rowsToAppend = [];

            // Loop setiap jawaban dari frontend
            for (const item of data_jawaban) {
                // 1. Handle File Upload jika ada
                let fileLinks = [];
                if (item.files && item.files.length > 0) {
                    for (const file of item.files) {
                        const link = await uploadToDrive(file, driveFolderId);
                        fileLinks.push(link);
                    }
                }

                // 2. Siapkan Baris Data untuk Excel
                // Urutan Kolom di Sheet 'database':
                // A: Waktu, B: Kabupaten, C: OPD, D: ID Soal, E: Pertanyaan, F: Jawaban, G: Penjelasan, H: Alasan, I: Link File
                rowsToAppend.push([
                    new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), // Timestamp
                    kabupaten,
                    opd,
                    item.id_pertanyaan,
                    item.pertanyaan,
                    item.jawaban,
                    item.penjelasan,
                    item.alasan,
                    fileLinks.join(',\n') // Gabung link file dengan enter jika ada banyak
                ]);
            }

            // 3. Simpan ke Google Sheets (Batch Append)
            if (rowsToAppend.length > 0) {
                await sheets.spreadsheets.values.append({
                    spreadsheetId,
                    range: 'database!A2', // Mulai append dari baris kosong setelah header
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: rowsToAppend
                    }
                });
            }

            return res.status(200).json({ success: true, message: 'Data berhasil disimpan' });
        }
        
        else {
            res.status(400).json({ error: 'Action tidak valid' });
        }

    } catch (error) {
        console.error("API Error Details:", error);
        res.status(500).json({ error: error.message });
    }
};
