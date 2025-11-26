const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    // Ambil data yang dikirim dari Frontend
    const { mode, opd, kabupaten, password } = event.queryStringParameters;

    try {
        // 1. KONEKSI KE GOOGLE SHEET
        const serviceAccountAuth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        // --- MODUL 1: LOGIN ---
        if (mode === 'login') {
            const sheet = doc.sheetsByTitle['auth']; 
            if (!sheet) throw new Error("Tab 'auth' tidak ditemukan");
            
            const rows = await sheet.getRows();
            const user = rows.find(r => r.get('kabupaten') === kabupaten && r.get('opd') === opd && r.get('password') == password);

            if (user) {
                return { statusCode: 200, body: JSON.stringify({ status: 'ok', data: { opd, kabupaten } }) };
            }
            return { statusCode: 401, body: JSON.stringify({ status: 'fail', message: 'Password/OPD Salah' }) };
        }

        // --- MODUL 2: AMBIL PERTANYAAN ---
        if (mode === 'get_questions') {
            const sheet = doc.sheetsByTitle['master_pertanyaan'];
            if (!sheet) throw new Error("Tab 'master_pertanyaan' tidak ditemukan");

            const rows = await sheet.getRows();
            
            // Filter Data
            const data = rows
                .filter(r => r.get('opd') === opd && r.get('kabupaten') === kabupaten)
                .map(r => ({
                    pertanyaan: r.get('pertanyaan'),
                    tipe: r.get('tipe_jawaban'),       // pilihan / teks
                    opsi: r.get('data_permintaan'),    // isi dropdown
                    upload: r.get('file_upload'),      // ya / tidak
                    limit: r.get('jumlah_file'),
                    alasan: r.get('input_alasan'),     // ya / tidak
                    judul: r.get('judul'),
                    sub: r.get('sub_judul')
                }));

            return { statusCode: 200, body: JSON.stringify(data) };
        }

        return { statusCode: 400, body: "Mode tidak valid" };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
