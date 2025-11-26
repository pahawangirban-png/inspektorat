const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    // Ambil data dari Frontend
    const { mode, opd, kabupaten, password } = event.queryStringParameters;

    try {
        const auth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();

        // --- LOGIKA LOGIN ANTI-GAGAL ---
        if (mode === 'login') {
            const sheet = doc.sheetsByTitle['auth'];
            if (!sheet) throw new Error("Tab 'auth' tidak ditemukan di Google Sheet");
            
            const rows = await sheet.getRows();

            // KITA CARI DENGAN CARA KASAR (PAKSA JADI STRING & HAPUS SPASI)
            const user = rows.find(row => {
                // Ambil data dari Excel, jika kosong anggap string kosong ''
                // Pakai || row.get('...') untuk jaga-jaga kalau header di Excel pakai Huruf Besar
                const dbKab = String(row.get('kabupaten') || row.get('Kabupaten') || '').trim().toLowerCase();
                const dbOpd = String(row.get('opd') || row.get('OPD') || '').trim().toLowerCase();
                const dbPass = String(row.get('password') || row.get('Password') || '').trim(); // JANGAN toLowerCase password

                // Ambil data dari Inputan User
                const inputKab = String(kabupaten).trim().toLowerCase();
                const inputOpd = String(opd).trim().toLowerCase();
                const inputPass = String(password).trim();

                // Cek apakah cocok?
                return dbKab === inputKab && dbOpd === inputOpd && dbPass === inputPass;
            });

            if (user) {
                return { statusCode: 200, body: JSON.stringify({ status: 'ok', data: { opd, kabupaten } }) };
            } else {
                // Debugging: Beritahu kenapa salah
                return { 
                    statusCode: 401, 
                    body: JSON.stringify({ 
                        status: 'fail', 
                        message: 'Data tidak cocok. Cek spasi atau penulisan di Excel.' 
                    }) 
                };
            }
        }

        // --- LOGIKA AMBIL PERTANYAAN ---
        if (mode === 'get_questions') {
            const sheet = doc.sheetsByTitle['master_pertanyaan'];
            if (!sheet) throw new Error("Tab 'master_pertanyaan' tidak ditemukan");
            
            const rows = await sheet.getRows();

            const data = rows
                .filter(row => {
                    const dbOpd = String(row.get('opd') || row.get('OPD') || '').trim().toLowerCase();
                    const inputOpd = String(opd).trim().toLowerCase();
                    return dbOpd === inputOpd;
                })
                .map(r => ({
                    // Mapping data (Pastikan header di excel benar)
                    pertanyaan: r.get('pertanyaan') || r.get('Pertanyaan'),
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

    } catch (e) {
        console.log(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
