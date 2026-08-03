const admin = require('firebase-admin');

// Make sure your key.json path is correct
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function debugFirestore() {
  try {
    console.log('🚀 Testing Firestore connection...');

    // List top-level collections
    const collections = await db.listCollections();
    console.log('Collections in DB:', collections.map(c => c.id));

    // Try fetching a known collection
    const snapshot = await db.collection('targetUsers').get();
    console.log('Documents in targetUsers:');
    snapshot.docs.forEach(doc => console.log(doc.id, doc.data()));
  } catch (err) {
    console.error('Firestore debug error:', err);
  }
}

debugFirestore();
