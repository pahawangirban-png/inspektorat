const { google } = require('googleapis');

exports.handler = async (event, context) => {
  // 1. Cek Metode Pengiriman (Harus POST)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    
    // 2. AMBIL KUNCI DARI RAHASIA NETLIFY (Environment Variables)
    // Perhatikan: Kita memanggil "process.env", bukan menulis ID manual.
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID; 
    const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

    // 3. Setup Koneksi Google
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    });

    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 4. Proses Upload File ke Drive (Jika ada file)
    let fileLinks = [];
    
    if (data.files && data.files.length > 0) {
      for (const file of data.files) {
        // Mengubah text base64 kembali menjadi file fisik di memory server
        const buffer = Buffer.from(file.content.split(',')[1], 'base64');
        
        const fileMetadata = {
          name: file.name,
          parents: [DRIVE_FOLDER_ID] // Upload ke folder ID dari Secret
        };
        
        const media = {
          mimeType: file.type,
          body: require('stream').Readable.from(buffer)
        };

        const uploadRes = await drive.files.create({
          resource: fileMetadata,
          media: media,
          fields: 'webViewLink'
        });
        
        fileLinks.push(uploadRes.data.webViewLink);
      }
    }

    // 5. Simpan Data ke Spreadsheet
    const linkString = fileLinks.join(',\n'); // Gabung link jadi satu string
    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, // Simpan ke Sheet ID dari Secret
      range: 'database!A:G',         // Pastikan nama sheet di Google Sheet adalah 'database'
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now,
          data.kabupaten,
          data.opd,
          data.jawaban,
          data.penjelasan,
          linkString, 
          data.alasan
        ]]
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Sukses tersimpan!" })
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
