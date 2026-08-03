const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize using the service account key file
const serviceAccount = require("./service-account.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function uploadSettings() {
  try {
    const rawData = fs.readFileSync('./settings.json', 'utf8');
    const settings = JSON.parse(rawData);
    const plainSettings = {};

    Object.keys(settings.fields).forEach(key => {
      const valueObj = settings.fields[key];
      const type = Object.keys(valueObj)[0];
      
      if (type === 'integerValue') {
        plainSettings[key] = parseInt(valueObj[type], 10);
      } else if (type === 'doubleValue') {
        plainSettings[key] = parseFloat(valueObj[type]);
      } else if (type === 'booleanValue') {
        plainSettings[key] = valueObj[type];
      } else {
        plainSettings[key] = valueObj[type];
      }
    });

    console.log('⏳ Syncing settings to config/botSettings...');
    
    // TARGET THE CORRECT PATH FROM YOUR IMAGE
    await db.collection('config').doc('botSettings').set(plainSettings, { merge: true });
    
    console.log('✅ Success! Existing botSettings document updated.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Sync Failed:', err.message);
    process.exit(1);
  }
}

uploadSettings();