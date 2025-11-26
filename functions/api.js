const { google } = require('googleapis');

exports.handler = async (event, context) => {
  // Setup Koneksi Google (Sama seperti sebelumnya)
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
  const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  // === LOGIKA TUNGGAL (ROUTER) ===
  // Kita cek "action" apa yang diminta: 'login', 'get_data', atau 'submit'
  const action = event.queryStringParameters.action;

  try {
    
    // 1. AKSI: AMBIL DATA (Untuk Dropdown)
    if (action === 'get_data') {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'master_pertanyaan!A2:D100', // Asumsi: A=Nama Kab, B=Kode, C=Nama OPD, D=Kode
      });
      const rows = response.data.values || [];
      
      // Filter Data Unik
      let kabupatens = [], opds = [];
      let kabSet = new Set(), opdSet = new Set();

      rows.forEach(row => {
        if(row[0] && !kabSet.has(row[1])) { kabupatens.push({ label: row[0], value: row[1] }); kabSet.add(row[1]); }
        if(row[2] && !opdSet.has(row[3])) { opds.push({ label: row[2], value: row[3] }); opdSet.add(row[3]); }
      });

      return { statusCode: 200, body: JSON.stringify({ kabupaten: kabupatens, opd: opds }) };
    }

    // 2. AKSI: LOGIN
    else if (action === 'login') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
      const { username, password } = JSON.parse(event.body);

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'auth!A2:B100',
      });
      
      const rows = response.data.values || [];
      const userFound = rows.find(row => String(row[0]).trim() === String(username).trim() && String(row[1]).trim() === String(password).trim());

      return { statusCode: 200, body: JSON.stringify({ success: !!userFound }) };
    }

    // 3. AKSI: SUBMIT (Kirim Jawaban & File)
    else if (action === 'submit') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
      const data = JSON.parse(event.body);
      
      // Upload Files ke Drive
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

      // Simpan ke Sheet
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
