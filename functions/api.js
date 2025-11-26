const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event) => {
    const { mode, opd, kabupaten, password } = event.queryStringParameters;

    try {
        const auth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
        await doc.loadInfo();

        if (mode === 'login') {
            const sheet = doc.sheetsByTitle['auth'];
            const rows = await sheet.getRows();
            
            // PENCARIAN & PEMBERSIHAN DATA (TRIM)
            // Ini memperbaiki masalah "Password Salah" padahal benar
            const user = rows.find(row => {
                const rowOpd = row.get('opd') ? row.get('opd').trim() : '';
                const rowKab = row.get('kabupaten') ? row.get('kabupaten').trim() : '';
                const rowPass = row.get('password') ? row.get('password').toString().trim() : '';
                
                return rowOpd === opd && rowKab === kabupaten && rowPass === password;
            });

            if (user) {
                return { statusCode: 200, body: JSON.stringify({ user: { opd, kabupaten } }) };
            } else {
                return { statusCode: 401, body: JSON.stringify({ message: "Password atau OPD salah (Cek Excel)" }) };
            }
        }

        if (mode === 'get_questions') {
            const sheet = doc.sheetsByTitle['master_pertanyaan'];
            const rows = await sheet.getRows();
            
            const data = rows
                .filter(r => r.get('opd') === opd)
                .map(r => ({
                    pertanyaan: r.get('pertanyaan'),
                    tipe: r.get('tipe_jawaban'),
                    opsi: r.get('data_permintaan'),
                    upload: r.get('file_upload')
                }));
                
            return { statusCode: 200, body: JSON.stringify(data) };
        }

        return { statusCode: 400, body: "Mode salah" };

    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
