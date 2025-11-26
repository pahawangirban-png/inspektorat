const { google } = require('googleapis');

exports.handler = async (event, context) => {
  // Setup Koneksi Google
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
  const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  const action = event.queryStringParameters.action;

  try {
    
    // === 1. AKSI: AMBIL DATA DROPDOWN (DARI SHEET 'auth') ===
    if (action === 'get_data') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'auth!A2:E100', // Kita baca sheet AUTH
      });
      const rows = response.data.values || [];
      
      let kabupatens = [];
      let opds = [];
      let kabSet = new Set();
      let opdSet = new Set();

      rows.forEach(row => {
        // ASUMSI STRUKTUR SHEET AUTH BERDASARKAN PENJELASAN ANDA:
        // row[0] = Username / Kode Kabupaten (Dipakai buat Login)
        // row[1] = Password
        // row[2] = Nama Kabupaten (Tampilan Visual)
        // row[3] = Nama OPD (Tampilan Visual)

        const kodeUser = row[0]; // Value (Dikirim ke sistem)
        const namaKab = row[2];  // Label (Dilihat user) -> INI YANG PENTING AGAR TIDAK MUNCUL ANGKA 1
        const namaOpd = row[3];  // Label OPD

        // Simpan Kabupaten (Cegah Duplikat)
        if(kodeUser && namaKab && !kabSet.has(namaKab)) {
            kabupatens.push({ label: namaKab, value: kodeUser });
            kabSet.add(namaKab);
        }

        // Simpan OPD
        if(namaOpd && !opdSet.has(namaOpd)) {
            opds.push({ label: namaOpd, value: namaOpd });
            opdSet.add(namaOpd);
        }
      });

      return { statusCode: 200, body: JSON.stringify({ kabupaten: kabupatens, opd: opds }) };
    }

    // === 2. AKSI: LOGIN (CEK SHEET 'auth') ===
    else if (action === 'login') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
      const { username, password } = JSON.parse(event.body);

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'auth!A2:B100', // Cek Kolom Username & Password saja
      });
      
      const rows = response.data.values || [];
      
      // Cari kecocokan Username & Password
      const userFound = rows.find(row => 
          String(row[0]).trim() === String(username).trim() && 
          String(row[1]).trim() === String(password).trim()
      );

      return { statusCode: 200, body: JSON.stringify({ success: !!userFound }) };
    }

    // === 3. AKSI: SUBMIT (Kirim Jawaban) ===
    else if (action === 'submit') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
      const data = JSON.parse(event.body);
      
      // Upload Files
      let fileLinks = [];
      if (data.files && data.files.length > 0) {
        for (const file of data.files) {
          const buffer = Buffer.from(file.content.split(',')[1], 'base64');
          const uploadRes = await drive.files.create({
            resource: { name: file.name, parents: [DRIVE_FOLDER_ID] },
            media: { mimeType: file.type, body: require('stream').Readable.from(buffer) },
            fields: 'webViewLink'
          });
          fileLinks.push(uploadRes.data.webViewLink);
        }
      }

      // Simpan Jawaban ke Sheet 'database'
      const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'database!A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[now, data.kabupaten, data.opd, data.jawaban, data.penjelasan, fileLinks.join(',\n'), data.alasan]] }
      });

      return { statusCode: 200, body: JSON.stringify({ message: "Sukses" }) };
    }

    return { statusCode: 400, body: "Aksi tidak dikenal" };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
