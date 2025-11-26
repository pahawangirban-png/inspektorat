const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    // Ambil parameter
    const { mode, opd, kabupaten, password } = event.queryStringParameters;

    try {
        // 1. KONEKSI KE SHEET
        const auth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();

        // 2. LOGIKA LOGIN (SAYA PERBAIKI AGAR TIDAK SENSITIF SPASI)
        if (mode === 'login') {
            const sheet = doc.sheetsByTitle['auth'];
            const rows = await sheet.getRows();

            // Debugging: Paksa konversi ke String dan buang spasi (Trim)
            const user = rows.find(r => {
                const sheetKab = String(r.get('kabupaten')).trim().toLowerCase();
                const sheetOpd = String(r.get('opd')).trim().toLowerCase();
                const sheetPass = String(r.get('password')).trim();

                const inputKab = String(kabupaten).trim().toLowerCase();
                const inputOpd = String(opd).trim().toLowerCase();
                const inputPass = String(password).trim();

                return sheetKab === inputKab && sheetOpd === inputOpd && sheetPass === inputPass;
            });

            if (user) {
                return { statusCode: 200, body: JSON.stringify({ status: 'ok', data: { opd, kabupaten } }) };
            } else {
                return { statusCode: 401, body: JSON.stringify({ status: 'fail', message: 'Password Salah. Pastikan data di Excel sama persis.' }) };
            }
        }

        // 3. LOGIKA AMBIL PERTANYAAN
        if (mode === 'get_questions') {
            const sheet = doc.sheetsByTitle['master_pertanyaan'];
            const rows = await sheet.getRows();

            const data = rows
                .filter(r => String(r.get('opd')).trim().toLowerCase() === String(opd).trim().toLowerCase())
                .map(r => ({
                    pertanyaan: r.get('pertanyaan'),
                    tipe: r.get('tipe_jawaban'),
                    opsi: r.get('data_permintaan'),
                    upload: r.get('file_upload'),
                    limit: r.get('jumlah_file'),
                    alasan: r.get('input_alasan'),
                    judul: r.get('judul'),
                    sub: r.get('sub_judul')
                }));

            return { statusCode: 200, body: JSON.stringify(data) };
        }

        return { statusCode: 400, body: "Mode tidak dikenali" };

    } catch (error) {
        console.log("System Error:", error);
        // Jika error ini muncul, berarti package.json belum terinstall dengan benar
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
