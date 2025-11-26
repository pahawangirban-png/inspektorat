const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    const { mode, opd, kabupaten, password } = event.queryStringParameters;

    try {
        // 1. KONEKSI
        const auth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();

        // 2. FUNGSI PENCARI KOLOM (MENGATASI CASE SENSITIVE HEADER)
        // Fungsi ini mencari nama kolom yang benar di Excel Bapak (misal: "OPD" vs "opd")
        const getColumnValue = (row, columnName) => {
            // Cari key di row yang cocok dengan columnName (ignore case)
            const exactKey = Object.keys(row).find(key => key.toLowerCase().trim() === columnName.toLowerCase());
            if (exactKey) {
                return String(row[exactKey]).trim(); // Ambil value dan bersihkan spasi
            }
            // Fallback: Coba akses langsung via method google-spreadsheet jika ada
            if (typeof row.get === 'function') {
                // Coba variasi umum
                const val = row.get(columnName) || row.get(columnName.toUpperCase()) || row.get(columnName.charAt(0).toUpperCase() + columnName.slice(1));
                return val ? String(val).trim() : '';
            }
            return '';
        };

        // --- MODE LOGIN ---
        if (mode === 'login') {
            const sheet = doc.sheetsByTitle['auth'];
            if (!sheet) return { statusCode: 500, body: JSON.stringify({ message: "Tab 'auth' tidak ditemukan" }) };
            
            const rows = await sheet.getRows();

            // CARI USER DENGAN PENCARIAN FLEKSIBEL
            const user = rows.find(row => {
                // Ambil data dari excel menggunakan fungsi pintar di atas
                const dbOpd = getColumnValue(row, 'opd').toLowerCase();
                const dbKab = getColumnValue(row, 'kabupaten').toLowerCase();
                const dbPass = getColumnValue(row, 'password'); // Password jangan di-lowercase

                // Bandingkan
                return dbOpd === String(opd).trim().toLowerCase() &&
                       dbKab === String(kabupaten).trim().toLowerCase() &&
                       dbPass === String(password).trim();
            });

            if (user) {
                return { statusCode: 200, body: JSON.stringify({ status: 'ok', data: { opd, kabupaten } }) };
            } else {
                // DEBUGGING: Jika gagal, intip baris pertama untuk lihat apa yang salah
                const firstRow = rows[0] ? `Contoh data baris 1: OPD=${getColumnValue(rows[0], 'opd')}, Pass=${getColumnValue(rows[0], 'password')}` : 'Excel Kosong';
                return { 
                    statusCode: 401, 
                    body: JSON.stringify({ 
                        status: 'fail', 
                        message: `Login Gagal. Server membaca: ${firstRow}. Pastikan ejaan sama.` 
                    }) 
                };
            }
        }

        // --- MODE GET QUESTIONS ---
        if (mode === 'get_questions') {
            const sheet = doc.sheetsByTitle['master_pertanyaan'];
            const rows = await sheet.getRows();

            const data = rows
                .filter(row => getColumnValue(row, 'opd').toLowerCase() === String(opd).trim().toLowerCase())
                .map(row => ({
                    pertanyaan: getColumnValue(row, 'pertanyaan'),
                    tipe: getColumnValue(row, 'tipe_jawaban'),
                    opsi: getColumnValue(row, 'data_permintaan'),
                    upload: getColumnValue(row, 'file_upload'),
                    limit: getColumnValue(row, 'jumlah_file'),
                    alasan: getColumnValue(row, 'input_alasan'),
                    judul: getColumnValue(row, 'judul'),
                    sub: getColumnValue(row, 'sub_judul')
                }));

            return { statusCode: 200, body: JSON.stringify(data) };
        }

        return { statusCode: 400, body: "Mode salah" };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
