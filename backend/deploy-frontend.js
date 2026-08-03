const admin = require('firebase-admin');
const { execSync } = require('child_process');
const path = require('path');

// Initialize Firebase Admin using the service-account.json from frontend directory
const serviceAccount = require('../frontend/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function main() {
  console.log('🔑 Requesting access token from service account...');
  const credential = admin.app().options.credential;
  const tokenObj = await credential.getAccessToken();
  const token = tokenObj.accessToken;
  
  if (!token) {
    throw new Error('Could not retrieve access token.');
  }
  
  console.log('🚀 Authenticated. Deploying to Firebase Hosting...');
  execSync(`npx firebase deploy --only hosting --token "${token}" --project base-tribe-invite`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '../frontend')
  });
  console.log('✅ Deployment finished successfully!');
}

main().catch(err => {
  console.error('❌ Deployment script failed:', err);
  process.exit(1);
});
