const { google } = require('googleapis');

exports.handler = async (event, context) => {
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
    
    // === 1. AKSI: AMBIL DATA (REVISI URUTAN KOLOM) ===
    if (action === 'get_data') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'auth!A2:C100', // Ambil Kolom A, B, C
      });
      const rows = response.data.values || [];
      
      let kabupatens = [];
      let opds = [];
      let kabSet = new Set();
      let opdSet = new Set();

      rows.forEach(row => {
        // PERBAIKAN URUTAN KOLOM DISINI:
        // Kolom A (0) = Kabupaten
        // Kolom B (1) = OPD
        // Kolom C (2) = Password (Jangan diambil untuk dropdown)

        const valKab = row[0]; // Nama Kabupaten
        const valOpd = row[1]; // Nama OPD

        // Masukkan ke List Kabupaten (Cegah Duplikat)
        if(valKab && !kabSet.has(valKab)) {
            // Label & Value sama-sama Nama Kabupaten
            kabupatens.push({ label: valKab, value: valKab });
            kabSet.add(valKab);
        }

        // Masukkan ke List OPD
        if(valOpd && !opdSet.has(valOpd)) {
            opds.push({ label: valOpd, value: valOpd });
            opdSet.add(valOpd);
        }
      });

      return { statusCode: 200, body: JSON.stringify({ kabupaten: kabupatens, opd: opds }) };
    }

    // === 2. AKSI: LOGIN (REVISI URUTAN KOLOM) ===
    else if (action === 'login') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
      const { username, password } = JSON.parse(event.body);

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'auth!A2:C100', 
      });
      
      const rows = response.data.values || [];
      
      // Cek Login:
      // Username user == Row[0] (Kabupaten)
      // Password user == Row[2] (Password)
      const userFound = rows.find(row => 
          String(row[0]).trim() === String(username).trim() && 
          String(row[2]).trim() === String(password).trim()
      );

      return { statusCode: 200, body: JSON.stringify({ success: !!userFound }) };
    }

    // === 3. AKSI: SUBMIT (TIDAK BERUBAH) ===
    else if (action === 'submit') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
      const data = JSON.parse(event.body);
      
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
