const { google } = require('googleapis');

exports.handler = async (event, context) => {
  // Hanya terima method POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    
    // --- SETUP AUTH GOOGLE ---
    // Kita ambil credential dari Environment Variable Netlify nanti
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    });

    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // ID DATABASE ANDA (GANTI DISINI ATAU PAKAI ENV)
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID; 
    const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

    // --- 1. PROSES UPLOAD FILE KE DRIVE ---
    let fileLinks = [];
    
    if (data.files && data.files.length > 0) {
      for (const file of data.files) {
        // file.content adalah base64 string
        const buffer = Buffer.from(file.content.split(',')[1], 'base64');
        
        const fileMetadata = {
          name: file.name,
          parents: [DRIVE_FOLDER_ID]
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

    // --- 2. SIMPAN KE SPREADSHEET ---
    const linkString = fileLinks.join(',\n');
    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'database!A:G', // Pastikan nama sheet Anda 'database'
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now,
          data.kabupaten,
          data.opd,
          data.jawaban,
          data.penjelasan,
          linkString, // Link drive
          data.alasan
        ]]
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Sukses tersimpan!" })
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
